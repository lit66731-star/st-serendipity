import { extension_settings } from '../../../extensions.js';
import {
    chat,
    characters,
    this_chid,
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
    chars: {},       // { [角色名]: 该角色的记忆/屏蔽词/指令等数据 }
};

let globalSettings = null;   // 顶层设置（按角色分组 + 按钮位置）
let settings = null;         // 当前角色的数据（便捷引用）
let activeChar = '';         // 当前绑定的角色名
let isSummarizing = false;
let pendingMigration = null; // 旧版扁平数据迁移挂起（角色卡尚未加载完成时暂存）

// ---------------- 设置 ----------------
// 每张角色卡独立的干净数据
function freshCharSettings() {
    return {
        memories: [],           // 短期记忆（详细总结）[{ id, time, text }]
        longMemories: [],       // 长期记忆（短期满 10 合并而来）
        permanentMemories: [],  // 永久记忆（长期满 10 合并而来，默认只增，可手动删）
        memoryEnabled: true,    // 自动记忆开关
        blockedWords: [],       // 屏蔽词列表
        censorEnabled: true,    // 屏蔽开关
        instructions: [],       // 指令列表（每轮生成都注入）
        storyTime: '',          // 当前剧情时间（AI 接力维护，每次总结时更新）
    };
}

// 规范化单个角色的数据（补默认值 + 指令结构迁移）
function normalizeCharSettings(cs) {
    if (!cs || typeof cs !== 'object') cs = {};
    for (const key of ['memories', 'longMemories', 'permanentMemories', 'blockedWords', 'instructions']) {
        if (!Array.isArray(cs[key])) cs[key] = [];
    }
    if (cs.memoryEnabled === undefined) cs.memoryEnabled = true;
    if (cs.censorEnabled === undefined) cs.censorEnabled = true;
    if (typeof cs.storyTime !== 'string') cs.storyTime = '';
    cs.instructions = cs.instructions.map(it => {
        if (typeof it === 'string') return { id: uid(), text: it, enabled: true };
        if (it && typeof it === 'object' && typeof it.text === 'string') {
            return { id: it.id || uid(), text: it.text, enabled: it.enabled !== false };
        }
        return null;
    }).filter(Boolean);
    return cs;
}

// 当前选中角色卡的名字（未选中返回空字符串）
function currentCharName() {
    if (this_chid !== undefined && characters && characters[this_chid] && characters[this_chid].name) {
        return String(characters[this_chid].name);
    }
    return '';
}

function charData(name) {
    if (!globalSettings.chars[name]) globalSettings.chars[name] = freshCharSettings();
    return normalizeCharSettings(globalSettings.chars[name]);
}

// 切换到当前角色卡的数据（换角色即换一套干净/对应的数据）
function activateCharacter() {
    activeChar = currentCharName();
    // 挂起的旧版扁平数据：等角色名真正可用时挂到该角色名下，避免启动时角色尚未加载导致丢数据
    if (pendingMigration && activeChar) {
        globalSettings.chars[activeChar] = normalizeCharSettings(pendingMigration);
        pendingMigration = null;
        saveSettings();
    }
    settings = charData(activeChar);
}

function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    const s = extension_settings[extensionName];

    // 旧版扁平结构 → 新版按角色分组（迁移一次，挂到当前角色名下）
    if (s.chars === undefined) {
        const migrated = {
            memories: Array.isArray(s.memories) ? s.memories : [],
            longMemories: Array.isArray(s.longMemories) ? s.longMemories : [],
            permanentMemories: Array.isArray(s.permanentMemories) ? s.permanentMemories : [],
            memoryEnabled: s.memoryEnabled !== false,
            blockedWords: Array.isArray(s.blockedWords) ? s.blockedWords : [],
            censorEnabled: s.censorEnabled !== false,
            instructions: Array.isArray(s.instructions) ? s.instructions : [],
        };
        s.chars = {};
        const name = currentCharName();
        if (name) {
            s.chars[name] = normalizeCharSettings(migrated);
        } else {
            // 角色卡此时尚未加载完成（currentCharName 为空），先暂存，待 activateCharacter 挂到真实角色名下
            pendingMigration = migrated;
        }
        for (const k of ['memories', 'longMemories', 'permanentMemories', 'memoryEnabled', 'blockedWords', 'censorEnabled', 'instructions']) {
            delete s[k];
        }
    }
    if (!s.chars || typeof s.chars !== 'object' || Array.isArray(s.chars)) s.chars = {};
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
function buildSummaryPrompt(userMsg, charMsg, storyTime) {
    // 时间锚点：把上一次剧情时间传进去，让模型接力推进，避免每轮孤立猜测导致时间线乱掉
    const timeAnchor = storyTime
        ? '当前剧情时间基准（上一次剧情进行到）：' + storyTime + '。若本段对话没有明确推进时间，请沿用这个时间；若剧情明确推进了时间，请给出推进后的具体时间。'
        : '请根据本段内容判断剧情发生的大致时间（年/月/日 周几 几时几分）；若内容未明确，请给出合理推断的具体时间。';
    return {
        systemPrompt: [
            '你是剧情记忆助手。请阅读下面这轮对话，提取信息并总结。只输出总结本身，不要复述、不要添加任何解释或客套。',
            '',
            timeAnchor,
            '',
            '严格按照以下格式逐行输出（除【时间】外，某项信息未提及时写「无」）：',
            '',
            '【时间】剧情中的具体时间（年/月/日 周几 几时几分，必须给出具体时间，不要写「无」）',
            '【天气】天气情况',
            '【在场人物】有哪些人在场',
            '【地点】发生地点/场景',
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

// 从总结结果里解析【时间】行，作为剧情时间锚点
function extractStoryTime(text) {
    const m = String(text).match(/【时间】\s*([^\n]+)/);
    if (m && m[1]) {
        const t = m[1].trim();
        if (t && t !== '无') return t;
    }
    return '';
}

// 把一组记忆合并成一段文本（带序号），用于晋级时“清空并总结”
function mergeEntries(arr) {
    return arr.map((m, i) => `(${i + 1}) ${m.text}`).join('\n\n');
}

// 记忆三档晋级：短期满 10 → 合并入长期并清空短期；长期满 10 → 合并入永久并清空长期
function promoteMemories() {
    if (settings.memories.length >= TIER_LIMIT) {
        // 合并后的条目沿用「最新一条」的剧情时间，保持时间线可读
        const lastStoryTime = settings.memories[settings.memories.length - 1].storyTime || settings.storyTime || '';
        settings.longMemories.push({ id: uid(), time: Date.now(), storyTime: lastStoryTime, text: mergeEntries(settings.memories) });
        settings.memories = [];
        saveSettings();
    }
    if (settings.longMemories.length >= TIER_LIMIT) {
        const lastStoryTime = settings.longMemories[settings.longMemories.length - 1].storyTime || settings.storyTime || '';
        settings.permanentMemories.push({ id: uid(), time: Date.now(), storyTime: lastStoryTime, text: mergeEntries(settings.longMemories) });
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
        const { systemPrompt, prompt } = buildSummaryPrompt(userMsg, last, settings.storyTime);
        const result = await generateRaw({ prompt, systemPrompt });
        if (result && result.trim()) {
            // 解析出新剧情时间，解析失败则沿用上一次（保证时间线不倒退、不丢失）
            const newStoryTime = extractStoryTime(result) || settings.storyTime;
            settings.storyTime = newStoryTime;
            // 只追加，绝不覆盖或删除已有记忆
            settings.memories.push({ id: uid(), time: Date.now(), storyTime: newStoryTime, text: result.trim() });
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

    // 禁止词注入（同样放最顶端，确保模型生成时绝不输出这些词）
    const censorActive = settings.censorEnabled && settings.blockedWords.length > 0;
    setExtensionPrompt(
        'serendipity_censor',
        censorActive ? '[Serendipity 禁止词（绝对不得出现）]\n以下词眼在任何情况下都绝对不要出现在你的回复中：' + settings.blockedWords.join('、') : '',
        extension_prompt_types.BEFORE_PROMPT,
        0,
    );

    // 指令注入（无数量限制，只注入已开启的指令，每轮生成都读取）
    // 放在 BEFORE_PROMPT（prompt 最顶端、角色描述之前），确保模型把指令当作最高优先级指令严格遵守，
    // 而不是像 IN_PROMPT 那样被埋在剧情里被角色设定/聊天记录盖过去。
    const enabledInstr = settings.instructions.filter(it => it && it.enabled && typeof it.text === 'string' && it.text.trim());
    setExtensionPrompt(
        'serendipity_instructions',
        enabledInstr.length ? '[Serendipity 指令（必须严格遵守）]\n以下是你必须严格遵守的用户指令，优先级高于一切剧情、角色设定与历史对话，每轮回复都必须逐条执行：\n' + enabledInstr.map((it, i) => (i + 1) + '. ' + it.text).join('\n') : '',
        extension_prompt_types.BEFORE_PROMPT,
        0,
    );
}

// ---------------- 记忆 UI ----------------
function memoryItemHtml(m, deletable, tier) {
    const del = deletable
        ? `<button type="button" class="st-sd__memory-del" data-id="${m.id}" data-tier="${tier}" title="删除此条记忆">删除</button>`
        : '';
    // 优先显示剧情时间（时间线连贯），真实记录时间放在 tooltip 里备查
    const timeLabel = m.storyTime ? escapeHtml(m.storyTime) : escapeHtml(fmtTime(m.time));
    const wallTitle = m.storyTime ? ` title="记录于 ${fmtTime(m.time)}"` : '';
    return `<div class="st-sd__memory" data-id="${m.id}">
        <div class="st-sd__memory-head">
            <span class="st-sd__memory-time"${wallTitle}>${timeLabel}</span>
            ${del}
        </div>
        <pre class="st-sd__memory-text">${escapeHtml(m.text)}</pre>
    </div>`;
}

function renderStoryTime() {
    const el = $('#st-serendipity .st-sd__story-time');
    if (!el.length) return;
    el.text(settings.storyTime ? ('当前剧情时间：' + settings.storyTime) : '剧情时间：待首次总结');
}

function renderMemories() {
    const list = $('#st-serendipity .st-sd__memory-list');
    if (!list.length) return;

    renderStoryTime();

    const hasAny = settings.memories.length || settings.longMemories.length || settings.permanentMemories.length;
    if (!hasAny) {
        list.html('<div class="st-sd__empty">暂无记忆，每轮对话结束后会自动总结叠加</div>');
        return;
    }

    let html = '';
    // 短期记忆置顶、默认展开（最常用）
    if (settings.memories.length) {
        html += `<div class="st-sd__tier-title st-sd__tier-title--static">短期记忆（${settings.memories.length}/${TIER_LIMIT}）</div>`;
        html += [...settings.memories].reverse().map(m => memoryItemHtml(m, true, 'short')).join('');
    }
    // 长期记忆：可折叠，默认收起
    if (settings.longMemories.length) {
        html += `<details class="st-sd__tier"><summary class="st-sd__tier-title">长期记忆（${settings.longMemories.length}/${TIER_LIMIT}）</summary>`;
        html += [...settings.longMemories].reverse().map(m => memoryItemHtml(m, true, 'long')).join('');
        html += '</details>';
    }
    // 永久记忆：可折叠，默认收起，也可手动删除
    if (settings.permanentMemories.length) {
        html += `<details class="st-sd__tier"><summary class="st-sd__tier-title">永久记忆（${settings.permanentMemories.length}）</summary>`;
        html += [...settings.permanentMemories].reverse().map(m => memoryItemHtml(m, true, 'permanent')).join('');
        html += '</details>';
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

function renderInstructions() {
    const list = $('#st-serendipity .st-sd__instr-list');
    if (!list.length) return;
    if (!settings.instructions.length) {
        list.html('<div class="st-sd__empty">还没有指令，输入后点击「添加」</div>');
        return;
    }
    const items = settings.instructions.map(it => {
        const checked = it.enabled ? ' checked' : '';
        return `<div class="st-sd__instr" data-id="${it.id}">
            <label class="st-sd__switch st-sd__instr-switch" title="开启/关闭此指令">
                <input type="checkbox" class="st-sd__instr-toggle" data-id="${it.id}"${checked}>
                <span class="st-sd__switch-slider"></span>
            </label>
            <span class="st-sd__instr-text">${escapeHtml(it.text)}</span>
            <button type="button" class="st-sd__instr-del" data-id="${it.id}">×</button>
        </div>`;
    }).join('');
    list.html(items);
}

function renderCharBinding() {
    const el = $('#st-serendipity .st-sd__char');
    if (el.length) el.text(activeChar ? ('绑定角色：' + activeChar) : '未绑定角色');
}

// ---------------- 图标 ----------------
const ICONS = {
    close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
};

// ---------------- 扩展菜单入口 ----------------
// 把入口挂到酒馆的「扩展」菜单（#extensionsMenu，即 wand 菜单），替代悬浮球，不遮挡聊天区
function buildMenuButton() {
    if ($('#st-serendipity-menu-button').length) return;
    const btn = $(`
        <div id="st-serendipity-menu-button" class="list-group-item flex-container flexGap5 interactable"
             title="Serendipity：剧情记忆 + 屏蔽词 + 指令" tabindex="0" role="listitem">
            <div class="fa-fw fa-solid fa-book-open extensionsMenuExtensionButton"></div>
            <span>Serendipity</span>
        </div>`);
    btn.on('click', () => togglePanel());
    $('#extensionsMenu').append(btn);
}

// ---------------- 面板 ----------------
function buildPanel() {
    if ($('#st-serendipity').length) return;
    const html = `
    <div id="st-serendipity" class="st-sd" style="display:none">
      <div class="st-sd__head">
        <div class="st-sd__head-left">
          <span class="st-sd__title">Serendipity</span>
          <span class="st-sd__char"></span>
        </div>
        <button type="button" class="st-sd__close" title="关闭">${ICONS.close}</button>
      </div>
      <div class="st-sd__tabs">
        <button type="button" class="st-sd__tab is-active" data-tab="memory">记忆</button>
        <button type="button" class="st-sd__tab" data-tab="censor">屏蔽词</button>
        <button type="button" class="st-sd__tab" data-tab="instruct">指令</button>
      </div>

      <div class="st-sd__pane" data-pane="memory">
        <div class="st-sd__toolbar">
          <span class="st-sd__label">自动记忆</span>
          <label class="st-sd__switch"><input type="checkbox" class="st-sd__mem-toggle"><span class="st-sd__switch-slider"></span></label>
          <button type="button" class="st-sd__summarize">立即总结</button>
          <button type="button" class="st-sd__export">导出</button>
        </div>
        <div class="st-sd__story-time"></div>
        <div class="st-sd__memory-list"></div>
        <div class="st-sd__hint">短期满 ${TIER_LIMIT} 条自动合并入长期，长期满 ${TIER_LIMIT} 条合并入永久。记忆会注入正文，防止模型失忆；剧情时间由 AI 每轮接力推进。</div>
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

      <div class="st-sd__pane" data-pane="instruct" style="display:none">
        <div class="st-sd__add-row">
          <input type="text" class="st-sd__instr-input" placeholder="输入一条指令，如「每次回复都用中文」">
          <button type="button" class="st-sd__add-instr">添加</button>
        </div>
        <div class="st-sd__instr-list"></div>
        <div class="st-sd__hint">指令不限制数量，每轮生成都会读取并遵守；可用每条前面的开关单独开启/关闭，删除则彻底移除。</div>
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

    // 事件委托：删除记忆 / 删除屏蔽词
    panel.on('click', '.st-sd__memory-del', function () {
        const id = $(this).data('id');
        const tier = $(this).data('tier');
        if (tier === 'permanent' && !confirm('确定删除这条永久记忆？此操作不可恢复。')) return;
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

    // 添加指令
    const addInstr = () => {
        const input = panel.find('.st-sd__instr-input');
        const v = input.val().trim();
        if (!v) return;
        if (!settings.instructions.some(it => it.text === v)) {
            settings.instructions.push({ id: uid(), text: v, enabled: true });
            saveSettings();
            renderInstructions();
            updatePromptInjection();
        }
        input.val('');
    };
    panel.find('.st-sd__add-instr').on('click', addInstr);
    panel.find('.st-sd__instr-input').on('keydown', (e) => { if (e.key === 'Enter') addInstr(); });

    // 单个指令开关
    panel.on('change', '.st-sd__instr-toggle', function () {
        const id = $(this).data('id');
        const it = settings.instructions.find(x => x.id === id);
        if (it) {
            it.enabled = this.checked;
            saveSettings();
            updatePromptInjection();
        }
    });

    // 删除指令
    panel.on('click', '.st-sd__instr-del', function () {
        const id = $(this).data('id');
        settings.instructions = settings.instructions.filter(x => x.id !== id);
        saveSettings();
        renderInstructions();
        updatePromptInjection();
    });
}

// 用真实视口尺寸定位面板，保证手机端一定不出屏（酒馆移动端 body 是 fixed+overflow:hidden，vh/bottom 会失真）
function fitPanelToViewport() {
    const panel = $('#st-serendipity');
    if (!panel.length) return;
    if (window.innerWidth <= 1000) {
        const margin = 8;
        const top = 56;
        const bottomGap = 60; // 底部留白，避免被输入栏/底部工具条遮挡
        panel.css({
            top: top + 'px',
            bottom: 'auto',
            left: margin + 'px',
            right: 'auto',
            width: (window.innerWidth - margin * 2) + 'px',
            maxWidth: 'none',
            maxHeight: Math.max(200, window.innerHeight - top - bottomGap) + 'px',
        });
    } else {
        // 桌面端恢复 CSS 默认
        panel.css({ top: '', bottom: '', left: '', right: '', width: '', maxWidth: '', maxHeight: '' });
    }
}

function togglePanel(force) {
    const panel = $('#st-serendipity');
    if (!panel.length) return;
    const show = force === undefined ? !panel.is(':visible') : force;
    if (show) {
        fitPanelToViewport();
        panel.show();
        renderMemories();
        renderBlockedWords();
        renderInstructions();
        renderCharBinding();
    } else {
        panel.hide();
    }
}

// ---------------- 初始化 ----------------
jQuery(async () => {
    globalSettings = loadSettings();
    activateCharacter();
    buildMenuButton();
    buildPanel();

    // 初始屏蔽 + 注入正文提示
    applyCensorAll();
    initCensorObserver();
    updatePromptInjection();

    // 每轮生成结束后自动总结
    eventSource.on(event_types.GENERATION_ENDED, () => {
        setTimeout(() => summarizeLastRound(), 200);
    });
    // 切换聊天/角色后：切换到该角色对应的数据
    eventSource.on(event_types.CHAT_CHANGED, () => {
        setTimeout(() => {
            activateCharacter();
            updatePromptInjection();
            applyCensorAll();
            renderMemories();
            renderBlockedWords();
            renderInstructions();
            renderCharBinding();
        }, 150);
    });

    // 屏幕尺寸变化（转屏/键盘）时重新定位面板
    $(window).on('resize.st-sd', fitPanelToViewport);
    $(window).on('orientationchange.st-sd', () => setTimeout(fitPanelToViewport, 300));

    renderMemories();
    renderBlockedWords();
    renderInstructions();
    renderCharBinding();
});
