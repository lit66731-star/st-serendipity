import { extension_settings } from '../../../extensions.js';
import {
    chat,
    event_types,
    eventSource,
    generateRaw,
    saveSettingsDebounced,
    setExtensionPrompt,
    extension_prompt_types,
} from '../../../../script.js';

const extensionName = 'serendipity';

const TIER_LIMIT = 10; // 满 10 条晋级

const defaultSettings = {
    memories: [],           // 短期记忆（详细总结）[{ id, time, text }]
    longMemories: [],       // 长期记忆（短期满 10 合并而来）
    permanentMemories: [],  // 永久记忆（长期满 10 合并而来，只增不删）
    memoryEnabled: true,    // 自动记忆开关
    blockedWords: [],       // 屏蔽词列表
    censorEnabled: true,    // 屏蔽开关
    btnLeft: null,          // 主按钮位置（可拖动）
    btnTop: null,
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
    for (const key of ['memories', 'longMemories', 'permanentMemories', 'blockedWords']) {
        if (!Array.isArray(s[key])) s[key] = [];
    }
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
    return {
        systemPrompt: [
            '你是剧情记忆助手。请阅读下面这轮对话，提取信息并总结。只输出总结本身，不要复述、不要添加任何解释或客套。严格按照以下格式逐行输出（某项信息未提及时写「无」）：',
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
        ].join('\n'),
        prompt: userMsg.name + '：' + userMsg.mes + '\n\n' + charMsg.name + '：' + charMsg.mes,
    };
}

// 把一组记忆合并成一段文本（带序号），用于晋级时“清空并总结”
function mergeEntries(arr) {
    return arr.map((m, i) => `(${i + 1}) ${m.text}`).join('\n\n');
}

// 记忆三档晋级：短期满 10 → 合并入长期并清空短期；长期满 10 → 合并入永久并清空长期；永久只增不删
function promoteMemories() {
    if (settings.memories.length >= TIER_LIMIT) {
        settings.longMemories.push({ id: uid(), time: Date.now(), text: mergeEntries(settings.memories) });
        settings.memories = [];
        saveSettings();
    }
    if (settings.longMemories.length >= TIER_LIMIT) {
        settings.permanentMemories.push({ id: uid(), time: Date.now(), text: mergeEntries(settings.longMemories) });
        settings.longMemories = [];
        saveSettings();
    }
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
        const { systemPrompt, prompt } = buildSummaryPrompt(userMsg, last);
        const result = await generateRaw({ prompt, systemPrompt });
        if (result && result.trim()) {
            // 只追加，绝不覆盖或删除已有记忆
            settings.memories.push({ id: uid(), time: Date.now(), text: result.trim() });
            promoteMemories();
            saveSettings();
            updatePromptInjection();
            renderMemories();
        }
    } catch (e) {
        console.error('[Serendipity] 记忆总结失败：', e);
    } finally {
        isSummarizing = false;
    }
}

// ---------------- 记忆注入正文（防失忆） ----------------
function buildMemoryBlock() {
    const parts = [];
    if (settings.permanentMemories.length) {
        parts.push('【永久记忆】\n' + settings.permanentMemories.map(m => m.text).join('\n\n'));
    }
    if (settings.longMemories.length) {
        parts.push('【长期记忆】\n' + settings.longMemories.map(m => m.text).join('\n\n'));
    }
    if (settings.memories.length) {
        parts.push('【短期记忆】\n' + settings.memories.map(m => m.text).join('\n\n'));
    }
    return parts.join('\n\n');
}

// 把记忆 + 禁止词注入正文 prompt（IN_PROMPT：进入系统提示，正文生成时会被模型读取）
function updatePromptInjection() {
    // 记忆注入
    const mem = settings.memoryEnabled ? buildMemoryBlock().trim() : '';
    setExtensionPrompt(
        'serendipity_memory',
        mem ? '[Serendipity 剧情记忆]\n以下是此前剧情的记忆总结，请在后续生成中严格遵守并延续这些设定、人物、事件与承诺，避免遗忘或前后矛盾。\n\n' + mem : '',
        extension_prompt_types.IN_PROMPT,
        0,
    );

    // 禁止词注入
    const censorActive = settings.censorEnabled && settings.blockedWords.length > 0;
    setExtensionPrompt(
        'serendipity_censor',
        censorActive ? '[Serendipity 禁止词]\n以下是剧情中禁止出现的词眼，请绝对不要在你的回复中输出这些词：' + settings.blockedWords.join('、') : '',
        extension_prompt_types.IN_PROMPT,
        0,
    );
}

// ---------------- 记忆 UI ----------------
function memoryItemHtml(m, deletable, tier) {
    const del = deletable
        ? `<button type="button" class="st-sd__memory-del" data-id="${m.id}" data-tier="${tier}" title="删除此条记忆">删除</button>`
        : '';
    return `<div class="st-sd__memory" data-id="${m.id}">
        <div class="st-sd__memory-head">
            <span class="st-sd__memory-time">${escapeHtml(fmtTime(m.time))}</span>
            ${del}
        </div>
        <pre class="st-sd__memory-text">${escapeHtml(m.text)}</pre>
    </div>`;
}

function renderMemories() {
    const list = $('#st-serendipity .st-sd__memory-list');
    if (!list.length) return;

    const hasAny = settings.memories.length || settings.longMemories.length || settings.permanentMemories.length;
    if (!hasAny) {
        list.html('<div class="st-sd__empty">暂无记忆，每轮对话结束后会自动总结叠加</div>');
        return;
    }

    let html = '';
    if (settings.permanentMemories.length) {
        html += `<div class="st-sd__tier-title">永久记忆（只增不删）</div>`;
        html += [...settings.permanentMemories].reverse().map(m => memoryItemHtml(m, false, 'permanent')).join('');
    }
    if (settings.longMemories.length) {
        html += `<div class="st-sd__tier-title">长期记忆（${settings.longMemories.length}/${TIER_LIMIT}）</div>`;
        html += [...settings.longMemories].reverse().map(m => memoryItemHtml(m, true, 'long')).join('');
    }
    if (settings.memories.length) {
        html += `<div class="st-sd__tier-title">短期记忆（${settings.memories.length}/${TIER_LIMIT}）</div>`;
        html += [...settings.memories].reverse().map(m => memoryItemHtml(m, true, 'short')).join('');
    }
    list.html(html);
}

// 导出全部记忆为 txt 文件
function exportMemories() {
    const lines = ['Serendipity 剧情记忆导出', '导出时间：' + fmtTime(Date.now()), ''];

    const tier = (title, arr) => {
        if (!arr.length) return;
        lines.push('========== ' + title + ' ==========');
        for (const m of arr) {
            lines.push('[' + fmtTime(m.time) + ']');
            lines.push(m.text);
            lines.push('');
        }
    };
    tier('永久记忆', settings.permanentMemories);
    tier('长期记忆', settings.longMemories);
    tier('短期记忆', settings.memories);

    const content = '﻿' + lines.join('\n'); // BOM，避免记事本中文乱码
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'serendipity-memories-' + new Date().toISOString().slice(0, 10) + '.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------- 屏蔽词功能 ----------------
const CENSOR_EXCLUDE = 'script, style, textarea, input, select, option, #st-serendipity, .st-sd, [contenteditable]';

function censorText(text) {
    if (!settings.censorEnabled || !settings.blockedWords.length) return text;
    let out = text;
    for (const w of settings.blockedWords) {
        if (!w) continue;
        const esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        out = out.replace(new RegExp(esc, 'g'), '');
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
    initButtonDrag(btn);
}

function initButtonDrag(btn) {
    const clampBtn = (x, y) => {
        const w = btn[0].offsetWidth || 42;
        const h = btn[0].offsetHeight || 42;
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
            settings.btnLeft = parseFloat(btn.css('left'));
            settings.btnTop = parseFloat(btn.css('top'));
            saveSettings();
        } else {
            togglePanel(); // 单击（未拖动）→ 打开/关闭面板
        }
        drag = null;
    });
}

// ---------------- 面板 ----------------
function buildPanel() {
    if ($('#st-serendipity').length) return;
    const html = `
    <div id="st-serendipity" class="st-sd" style="display:none">
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
          <button type="button" class="st-sd__export">导出</button>
        </div>
        <div class="st-sd__memory-list"></div>
        <div class="st-sd__hint">短期满 ${TIER_LIMIT} 条自动合并入长期，长期满 ${TIER_LIMIT} 条合并入永久（永久只增不删）。记忆会注入正文，防止模型失忆。</div>
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
        <div class="st-sd__hint">添加后立即删除剧情与状态栏中的该词眼，并注入正文提示，禁止模型再输出这些词。</div>
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
        updatePromptInjection();
    });
    panel.find('.st-sd__censor-toggle').prop('checked', !!settings.censorEnabled).on('change', function () {
        settings.censorEnabled = this.checked;
        saveSettings();
        updatePromptInjection();
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
    // 导出记忆
    panel.find('.st-sd__export').on('click', exportMemories);

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
            updatePromptInjection();
        }
        input.val('');
    };
    panel.find('.st-sd__add-word').on('click', addWord);
    panel.find('.st-sd__word-input').on('keydown', (e) => { if (e.key === 'Enter') addWord(); });

    // 事件委托：删除记忆（永久记忆无删除按钮）/ 删除屏蔽词
    panel.on('click', '.st-sd__memory-del', function () {
        const id = $(this).data('id');
        const tier = $(this).data('tier');
        if (tier === 'short') settings.memories = settings.memories.filter(m => m.id !== id);
        else if (tier === 'long') settings.longMemories = settings.longMemories.filter(m => m.id !== id);
        else if (tier === 'permanent') settings.permanentMemories = settings.permanentMemories.filter(m => m.id !== id);
        saveSettings();
        updatePromptInjection();
        renderMemories();
    });
    panel.on('click', '.st-sd__word-del', function () {
        const w = String($(this).data('word'));
        settings.blockedWords = settings.blockedWords.filter(x => x !== w);
        saveSettings();
        renderBlockedWords();
        updatePromptInjection();
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

    // 初始屏蔽 + 注入正文提示
    applyCensorAll();
    initCensorObserver();
    updatePromptInjection();

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
