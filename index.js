import { extension_settings } from '../../../extensions.js';
import { chat, event_types, eventSource, generateQuietPrompt, saveSettingsDebounced } from '../../../../script.js';

const extensionName = 'serendipity';

const defaultSettings = {
    memories: [],          // [{ id, time, text }]
    memoryEnabled: true,   // 自动记忆开关
    blockedWords: [],      // 屏蔽词列表
    censorEnabled: true,   // 屏蔽开关
};

let settings = null;
let isSummarizing = false;

// ---------------- 设置 ----------------
function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    const s = extension_settings[extensionName];
    for (const [k, v] of Object.entries(defaultSettings)) {
        if (s[k] === undefined) s[k] = v;
    }
    if (!Array.isArray(s.memories)) s.memories = [];
    if (!Array.isArray(s.blockedWords)) s.blockedWords = [];
    return s;
}
function saveSettings() { saveSettingsDebounced(); }
function uid() { return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function pad(n) { return String(n).padStart(2, '0'); }
function fmtTime(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------- 记忆功能 ----------------
function buildSummaryPrompt(userMsg, charMsg) {
    return [
        '你是剧情记忆助手。请阅读下面这一轮对话，提取信息并总结。严格按照以下格式逐行输出（某项信息未提及时写「无」）：',
        '',
        '【时间】剧情中的具体时间（年/月/日 周几 几时几分）',
        '【天气】天气情况',
        '【在场人物】有哪些人在场',
        '【关键事件】本段发生的关键事件',
        '【角色衣着】' + charMsg.name + '的衣着',
        '【用户衣着】' + userMsg.name + '的衣着',
        '【物品】出现或获得的物品',
        '【约定/承诺】新产生的约定或承诺',
        '【已完成约定】已完成的约定或承诺',
        '【详细总结】本段对话的详细总结',
        '',
        '对话如下：',
        userMsg.name + '：' + userMsg.mes,
        charMsg.name + '：' + charMsg.mes,
    ].join('\n');
}

async function summarizeLastRound() {
    if (!settings.memoryEnabled || isSummarizing) return;
    if (!Array.isArray(chat) || chat.length < 2) return;

    // 过滤掉系统消息，取最近一轮：最后一条 char 回复 + 它前面最近的 user 消息
    const msgs = chat.filter(m => m && typeof m.mes === 'string' && m.mes.trim() && !m.is_system);
    if (msgs.length < 2) return;
    const last = msgs[msgs.length - 1];
    if (last.is_user) return; // 最后一条是用户消息（尚未回复），跳过

    let userMsg = null;
    for (let i = msgs.length - 2; i >= 0; i--) {
        if (msgs[i].is_user) { userMsg = msgs[i]; break; }
    }
    if (!userMsg) return;

    isSummarizing = true;
    try {
        const prompt = buildSummaryPrompt(userMsg, last);
        const result = await generateQuietPrompt({ quietPrompt: prompt, skipWIAN: true });
        if (result && result.trim()) {
            // 只追加，绝不覆盖或删除已有记忆
            settings.memories.push({ id: uid(), time: Date.now(), text: result.trim() });
            saveSettings();
            renderMemories();
        }
    } catch (e) {
        console.error('[Serendipity] 记忆总结失败：', e);
    } finally {
        isSummarizing = false;
    }
}

function renderMemories() {
    const list = $('#st-serendipity .st-sd__memory-list');
    if (!list.length) return;
    if (!settings.memories.length) {
        list.html('<div class="st-sd__empty">暂无记忆，每轮对话结束后会自动总结叠加</div>');
        return;
    }
    const items = [...settings.memories].reverse().map(m => {
        const del = `<button type="button" class="st-sd__memory-del" data-id="${m.id}" title="删除此条记忆">删除</button>`;
        return `<div class="st-sd__memory" data-id="${m.id}">
            <div class="st-sd__memory-head">
                <span class="st-sd__memory-time">${escapeHtml(fmtTime(m.time))}</span>
                ${del}
            </div>
            <pre class="st-sd__memory-text">${escapeHtml(m.text)}</pre>
        </div>`;
    }).join('');
    list.html(items);
}

// ---------------- 屏蔽词功能 ----------------
const CENSOR_EXCLUDE = 'script, style, textarea, input, select, option, #st-serendipity, .st-sd, [contenteditable]';

function censorText(text) {
    if (!settings.censorEnabled || !settings.blockedWords.length) return text;
    let out = text;
    for (const w of settings.blockedWords) {
        if (!w) continue;
        const esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        out = out.replace(new RegExp(esc, 'g'), '████');
    }
    return out;
}

function censorTextInNode(node) {
    if (!settings.censorEnabled || !settings.blockedWords.length) return;
    if (node.nodeType === 3) { // 文本节点
        const v = node.nodeValue;
        if (!v) return;
        const nv = censorText(v);
        if (nv !== v) node.nodeValue = nv;
        return;
    }
    if (node.nodeType !== 1) return; // 元素
    if (node.matches && node.matches(CENSOR_EXCLUDE)) return;
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
        acceptNode(n) {
            const p = n.parentElement;
            if (!p || (p.closest && p.closest(CENSOR_EXCLUDE))) return NodeFilter.FILTER_REJECT;
            if (!n.nodeValue) return NodeFilter.FILTER_REJECT;
            for (const w of settings.blockedWords) {
                if (w && n.nodeValue.includes(w)) return NodeFilter.FILTER_ACCEPT;
            }
            return NodeFilter.FILTER_REJECT;
        },
    });
    let n;
    while ((n = walker.nextNode())) {
        n.nodeValue = censorText(n.nodeValue);
    }
}

function applyCensorAll() {
    if (!settings.censorEnabled || !settings.blockedWords.length) return;
    censorTextInNode(document.body);
}

let censorObserver = null;
function initCensorObserver() {
    if (censorObserver) censorObserver.disconnect();
    const opts = { childList: true, subtree: true, characterData: true };
    censorObserver = new MutationObserver((mutations) => {
        censorObserver.disconnect();
        for (const m of mutations) {
            if (m.type === 'characterData') {
                censorTextInNode(m.target);
            } else if (m.type === 'childList') {
                for (const node of m.addedNodes) censorTextInNode(node);
            }
        }
        censorObserver.observe(document.body, opts);
    });
    censorObserver.observe(document.body, opts);
}

function renderBlockedWords() {
    const list = $('#st-serendipity .st-sd__word-list');
    if (!list.length) return;
    if (!settings.blockedWords.length) {
        list.html('<div class="st-sd__empty">还没有屏蔽词，输入后点击「添加」</div>');
        return;
    }
    const items = settings.blockedWords.map(w =>
        `<span class="st-sd__word"><span class="st-sd__word-text">${escapeHtml(w)}</span><button type="button" class="st-sd__word-del" data-word="${escapeHtml(w)}">×</button></span>`
    ).join('');
    list.html(items);
}

// ---------------- 图标 ----------------
const ICONS = {
    menu: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`,
    close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
};

// ---------------- 顶部按钮 ----------------
function buildTopBarButton() {
    if ($('#st-serendipity-button').length) return;
    const btn = $(`<div id="st-serendipity-button" class="st-sd" title="Serendipity（可拖动）">${ICONS.menu}</div>`);
    btn.appendTo('body');
    btn.on('click', () => togglePanel());
    initButtonDrag(btn);
}

function initButtonDrag(btn) {
    const clampBtn = (x, y) => {
        const w = btn[0].offsetWidth || 40;
        const h = btn[0].offsetHeight || 40;
        return {
            left: Math.min(Math.max(0, x), window.innerWidth - w),
            top: Math.min(Math.max(0, y), window.innerHeight - h),
        };
    };
    if (settings.btnLeft != null && settings.btnTop != null) {
        const p = clampBtn(settings.btnLeft, settings.btnTop);
        btn.css({ left: p.left + 'px', top: p.top + 'px', right: 'auto' });
    }
    let drag = null;
    let suppressClickUntil = 0;
    btn.on('pointerdown', (e) => {
        const r = btn[0].getBoundingClientRect();
        drag = { sx: e.clientX, sy: e.clientY, left: r.left, top: r.top, active: false };
    });
    $(document).on('pointermove.st-sd-btn', (e) => {
        if (!drag) return;
        const dx = e.clientX - drag.sx;
        const dy = e.clientY - drag.sy;
        if (!drag.active && Math.hypot(dx, dy) < 6) return;
        drag.active = true;
        const p = clampBtn(drag.left + dx, drag.top + dy);
        btn.css({ right: 'auto', left: p.left + 'px', top: p.top + 'px' });
    });
    $(document).on('pointerup.st-sd-btn', () => {
        if (!drag) return;
        if (drag.active) {
            suppressClickUntil = Date.now() + 300;
            settings.btnLeft = parseFloat(btn.css('left'));
            settings.btnTop = parseFloat(btn.css('top'));
            saveSettings();
        }
        drag = null;
    });
    document.addEventListener('click', (e) => {
        if (Date.now() < suppressClickUntil) {
            e.stopPropagation();
            e.preventDefault();
        }
    }, true);
}

// ---------------- 面板 ----------------
function buildPanel() {
    if ($('#st-serendipity').length) return;
    const html = `
    <div id="st-serendipity" class="st-sd">
      <div class="st-sd__head">
        <span class="st-sd__title">Serendipity</span>
        <button type="button" class="st-sd__close" title="关闭">${ICONS.close}</button>
      </div>
      <div class="st-sd__tabs">
        <button type="button" class="st-sd__tab is-active" data-tab="memory">记忆</button>
        <button type="button" class="st-sd__tab" data-tab="censor">屏蔽词</button>
      </div>

      <div class="st-sd__pane" data-pane="memory">
        <div class="st-sd__toolbar">
          <span class="st-sd__label">自动记忆</span>
          <label class="st-sd__switch"><input type="checkbox" class="st-sd__mem-toggle"><span class="st-sd__switch-slider"></span></label>
          <button type="button" class="st-sd__summarize">立即总结</button>
        </div>
        <div class="st-sd__memory-list"></div>
      </div>

      <div class="st-sd__pane" data-pane="censor" style="display:none">
        <div class="st-sd__toolbar">
          <span class="st-sd__label">屏蔽词</span>
          <label class="st-sd__switch"><input type="checkbox" class="st-sd__censor-toggle"><span class="st-sd__switch-slider"></span></label>
        </div>
        <div class="st-sd__add-row">
          <input type="text" class="st-sd__word-input" placeholder="输入要屏蔽的词，如「极其」">
          <button type="button" class="st-sd__add-word">添加</button>
        </div>
        <div class="st-sd__word-list"></div>
        <div class="st-sd__hint">提示：屏蔽只在界面显示层生效，关闭屏蔽后刷新页面可恢复原文。</div>
      </div>
    </div>`;
    $('body').append(html);
    bindPanelEvents();
}

function bindPanelEvents() {
    const panel = $('#st-serendipity');

    // 开关
    panel.find('.st-sd__mem-toggle').prop('checked', !!settings.memoryEnabled).on('change', function () {
        settings.memoryEnabled = this.checked;
        saveSettings();
    });
    panel.find('.st-sd__censor-toggle').prop('checked', !!settings.censorEnabled).on('change', function () {
        settings.censorEnabled = this.checked;
        saveSettings();
        if (this.checked) applyCensorAll();
    });

    // 关闭
    panel.find('.st-sd__close').on('click', () => togglePanel(false));

    // tab 切换
    panel.find('.st-sd__tab').on('click', function () {
        const name = $(this).data('tab');
        panel.find('.st-sd__tab').removeClass('is-active');
        $(this).addClass('is-active');
        panel.find('.st-sd__pane').hide();
        panel.find(`.st-sd__pane[data-pane="${name}"]`).show();
    });

    // 立即总结
    panel.find('.st-sd__summarize').on('click', () => summarizeLastRound());

    // 添加屏蔽词
    const addWord = () => {
        const input = panel.find('.st-sd__word-input');
        const w = input.val().trim();
        if (!w) return;
        if (!settings.blockedWords.includes(w)) {
            settings.blockedWords.push(w);
            saveSettings();
            renderBlockedWords();
            applyCensorAll();
        }
        input.val('');
    };
    panel.find('.st-sd__add-word').on('click', addWord);
    panel.find('.st-sd__word-input').on('keydown', (e) => { if (e.key === 'Enter') addWord(); });

    // 事件委托：删除记忆 / 删除屏蔽词
    panel.on('click', '.st-sd__memory-del', function () {
        const id = $(this).data('id');
        settings.memories = settings.memories.filter(m => m.id !== id);
        saveSettings();
        renderMemories();
    });
    panel.on('click', '.st-sd__word-del', function () {
        const w = String($(this).data('word'));
        settings.blockedWords = settings.blockedWords.filter(x => x !== w);
        saveSettings();
        renderBlockedWords();
    });
}

function togglePanel(force) {
    const panel = $('#st-serendipity');
    if (!panel.length) return;
    const show = force === undefined ? !panel.is(':visible') : force;
    if (show) {
        panel.show();
        renderMemories();
        renderBlockedWords();
    } else {
        panel.hide();
    }
}

// ---------------- 初始化 ----------------
jQuery(async () => {
    settings = loadSettings();
    buildTopBarButton();
    buildPanel();

    // 初始屏蔽
    applyCensorAll();
    initCensorObserver();

    // 每轮生成结束后自动总结
    eventSource.on(event_types.GENERATION_ENDED, () => {
        setTimeout(() => summarizeLastRound(), 200);
    });
    // 切换聊天后重新应用屏蔽
    eventSource.on(event_types.CHAT_CHANGED, () => {
        setTimeout(applyCensorAll, 150);
    });

    renderMemories();
    renderBlockedWords();
});
