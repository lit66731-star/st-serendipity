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
import { loadWorldInfo, createWorldInfoEntry, saveWorldInfo, world_names, updateWorldInfoList, selected_world_info } from '../../../world-info.js';

const extensionName = 'serendipity';

const TIER_LIMIT = 10; // 满 10 条晋级

// 结构化时间轴：时段选项 + 相对时间词（单位：天，正=未来）
const PERIODS = ['深夜', '清晨', '上午', '中午', '下午', '傍晚', '夜晚'];
const RELATIVE_DAYS = {
    '昨天': -1, '今天': 0, '明天': 1,
    '前天': -2, '后天': 2,
    '上周': -7, '下周': 7,
    '上个月': -30, '下个月': 30,
    '去年': -365, '明年': 365,
};

// 世界状态类别（列表格式，按类别分组展示/注入）
const WORLD_CATS = ['年龄', '好感', '关系', '物品', '日程'];

const defaultSettings = {
    chars: {},       // { [角色名]: 该角色的记忆/屏蔽词/指令等数据 }
};

let globalSettings = null;   // 顶层设置（按角色唯一键分组）
let settings = null;         // 当前角色的数据（便捷引用）
let activeChar = '';         // 当前绑定角色的显示名
let activeCharKey = '';      // 当前绑定角色的唯一键（avatar，同名卡也唯一）
let isSummarizing = false;
let pendingMigration = null; // 旧版扁平数据迁移挂起（角色卡尚未加载完成时暂存）
let editingId = null;        // 当前处于编辑态的记忆条目 id（null 表示无）
let isInjecting = false;     // 世界书注入进行中标记（防连点/并发注入）

// ---------------- 设置 ----------------
// 每张角色卡独立的干净数据
function freshCharSettings() {
    return {
        memories: [],           // 短期记忆（详细总结）[{ id, time, text }]
        longMemories: [],       // 长期记忆（短期满 10 合并而来；满 10 提醒归档到世界书）
        memoryEnabled: true,    // 自动记忆开关
        summarizeEvery: 1,      // 每 N 轮总结一次（1=每轮都总结）
        roundsSinceSummary: 0,  // 距上次总结已过的轮数
        lastSummaryIndex: -1,   // 上次总结到的聊天消息下标（-1=尚未总结），用于跨轮总结窗口不丢剧情
        blockedWords: [],       // 屏蔽词列表
        censorEnabled: true,    // 屏蔽开关
        instructions: [],       // 指令列表（每轮生成都注入）
        storyTime: '',          // 当前剧情时间（AI 接力维护，每次总结时更新）
        storyDay: null,         // 结构化时间轴：第X天（null=尚未建立）
        storyPeriod: '',        // 当前时段（深夜/清晨/上午/中午/下午/傍晚/夜晚）
        storyLocation: '',      // 当前地点
        worldState: [],         // 世界状态列表 [{ id, cat: '年龄'|'好感'|'关系'|'物品'|'日程', text }]
        timeline: [],           // 时间线列表 [{ id, day, time, location, event }]，不断叠加
        worldReminderShown: false, // 长期记忆满 10 的归档提醒是否已弹过（归档后重置）
        worldBook: '',          // 用户选择要注入的世界书名（不一定用角色绑定的那本）
        archivedWorldBook: '',  // 上次归档到哪本世界书（用于「未激活」常驻黄条提醒）
    };
}

// 规范化单个角色的数据（补默认值 + 指令结构迁移）
function normalizeCharSettings(cs) {
    if (!cs || typeof cs !== 'object') cs = {};
    for (const key of ['memories', 'longMemories', 'blockedWords', 'instructions', 'worldState', 'timeline']) {
        if (!Array.isArray(cs[key])) cs[key] = [];
    }
    // 迁移：旧版「永久记忆」档已取消，原永久记忆并入长期记忆（随后一起归档到世界书）
    if (Array.isArray(cs.permanentMemories) && cs.permanentMemories.length) {
        cs.longMemories = [...cs.permanentMemories, ...cs.longMemories];
    }
    delete cs.permanentMemories;
    cs.worldState = cs.worldState.filter(e => e && typeof e.cat === 'string' && typeof e.text === 'string').map(e => ({ id: e.id || uid(), cat: e.cat, text: e.text }));
    cs.timeline = cs.timeline.filter(e => e && e.id).map(e => ({
        id: e.id,
        day: (e.day == null || isNaN(e.day)) ? null : Number(e.day),
        time: typeof e.time === 'string' ? e.time : '',
        location: typeof e.location === 'string' ? e.location : '',
        event: typeof e.event === 'string' ? e.event : '',
    }));
    if (cs.memoryEnabled === undefined) cs.memoryEnabled = true;
    if (cs.censorEnabled === undefined) cs.censorEnabled = true;
    if (!(cs.summarizeEvery >= 1)) cs.summarizeEvery = 1;
    else cs.summarizeEvery = Math.floor(cs.summarizeEvery);
    cs.roundsSinceSummary = Number(cs.roundsSinceSummary) || 0;
    cs.lastSummaryIndex = (typeof cs.lastSummaryIndex === 'number' && cs.lastSummaryIndex >= 0) ? Math.floor(cs.lastSummaryIndex) : -1;
    if (typeof cs.storyTime !== 'string') cs.storyTime = '';
    if (cs.storyDay === undefined || cs.storyDay === null || isNaN(cs.storyDay)) cs.storyDay = null;
    else cs.storyDay = Number(cs.storyDay);
    if (typeof cs.storyPeriod !== 'string') cs.storyPeriod = '';
    if (typeof cs.storyLocation !== 'string') cs.storyLocation = '';
    if (cs.worldReminderShown === undefined) cs.worldReminderShown = false;
    if (typeof cs.worldBook !== 'string') cs.worldBook = '';
    if (typeof cs.archivedWorldBook !== 'string') cs.archivedWorldBook = '';
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

// 当前选中角色卡的唯一键：ST 里 avatar 是角色卡的唯一标识（同名不同图的两张卡 avatar 也不同）；无头像时退回 name
function currentCharKey() {
    if (this_chid !== undefined && characters && characters[this_chid]) {
        const c = characters[this_chid];
        if (c.avatar && c.avatar !== 'none') return 'avatar::' + c.avatar;
        if (c.name) return 'name::' + c.name;
    }
    return '';
}

function charData(key) {
    if (!globalSettings.chars[key]) globalSettings.chars[key] = freshCharSettings();
    return normalizeCharSettings(globalSettings.chars[key]);
}

// 切换到当前角色卡的数据（换角色即换一套干净/对应的数据）
function activateCharacter() {
    activeChar = currentCharName();
    activeCharKey = currentCharKey();
    // 老版本按 name 存的数据 → 迁到唯一键下（每个角色一次）
    if (activeCharKey && globalSettings.chars[activeChar] && !globalSettings.chars[activeCharKey]) {
        globalSettings.chars[activeCharKey] = normalizeCharSettings(globalSettings.chars[activeChar]);
        delete globalSettings.chars[activeChar];
        saveSettings();
    }
    // 挂起的旧版扁平数据：等角色真正可用时挂到该角色名下，避免启动时角色尚未加载导致丢数据
    if (pendingMigration && activeCharKey) {
        globalSettings.chars[activeCharKey] = normalizeCharSettings(pendingMigration);
        pendingMigration = null;
        saveSettings();
    }
    settings = charData(activeCharKey);
}

function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    const s = extension_settings[extensionName];

    // 旧版扁平结构 → 新版按角色分组（迁移一次，挂到当前角色名下）
    if (s.chars === undefined) {
        const oldLong = Array.isArray(s.longMemories) ? s.longMemories : [];
        const oldPerm = Array.isArray(s.permanentMemories) ? s.permanentMemories : [];
        const migrated = {
            memories: Array.isArray(s.memories) ? s.memories : [],
            longMemories: [...oldPerm, ...oldLong], // 旧永久记忆并入长期
            memoryEnabled: s.memoryEnabled !== false,
            blockedWords: Array.isArray(s.blockedWords) ? s.blockedWords : [],
            censorEnabled: s.censorEnabled !== false,
            instructions: Array.isArray(s.instructions) ? s.instructions : [],
        };
        s.chars = {};
        const key = currentCharKey();
        if (key) {
            s.chars[key] = normalizeCharSettings(migrated);
        } else {
            // 角色卡此时尚未加载完成（currentCharKey 为空），先暂存，待 activateCharacter 挂到真实角色名下
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
function buildSummaryPrompt(transcript, userName, charName, storyTime) {
    // 时间锚点：把上一次剧情时间传进去，让模型接力推进，避免每轮孤立猜测导致时间线乱掉
    const timeAnchor = storyTime
        ? '当前剧情时间基准（上一次剧情进行到）：' + storyTime + '。若本段对话没有明确推进时间，请沿用这个时间；若剧情明确推进了时间，请给出推进后的具体时间。'
        : '请根据本段内容判断剧情发生的大致时间（年/月/日 周几 几时几分）；若内容未明确，请给出合理推断的具体时间。';
    // 结构化时间轴锚点（第X天 + 年月日几时几分 + 地点）：让模型接力推进天数，而不是每轮孤立猜测
    const timeAxisAnchor = (settings.storyDay != null)
        ? '当前剧情时间轴：第' + settings.storyDay + '天' + (settings.storyTime ? ' · ' + settings.storyTime : '') + (settings.storyLocation ? ' · ' + settings.storyLocation : '') + '。若本段剧情没有明确推进天数，请沿用第' + settings.storyDay + '天；若明确过了若干天，请给出推进后的天数。'
        : '请根据本段内容，从故事开始估算当前是「第几天」（第X天），以及当前具体时间（年月日几时几分）和发生地点；若未明确，请给出合理推断。';
    // 世界状态锚点：把当前已知状态回传，让模型增量更新（某类别无变化写「无」），而不是每轮从零重造
    const worldStateAnchor = settings.worldState.length
        ? '当前已知的世界状态（请在此基础上增量更新，某个类别没有新变化就写「无」）：\n' + worldStateLines(worldStateByCat())
        : '请根据本段内容提取当前世界状态（年龄/好感/关系/物品/日程），没有的类别写「无」。';
    return {
        systemPrompt: [
            '你是剧情记忆助手。请阅读下面这段对话，提取信息并总结。只输出总结本身，不要复述、不要添加任何解释或客套。',
            '',
            timeAnchor,
            '',
            timeAxisAnchor,
            '',
            worldStateAnchor,
            '',
            '严格按照以下格式逐行输出（除【时间】外，某项信息未提及时写「无」）：',
            '',
            '【时间】剧情中的具体时间（年/月/日 周几 几时几分，必须给出具体时间，不要写「无」）',
            '【天气】天气情况',
            '【在场人物】有哪些人在场',
            '【地点】发生地点/场景',
            '【关键事件】本段发生的关键事件',
            '【角色衣着】' + charName + '的衣着',
            '【用户衣着】' + userName + '的衣着',
            '【物品】出现或获得的物品',
            '【约定/承诺】新产生的约定或承诺',
            '【已完成约定】已完成的约定或承诺',
            '【详细总结】本段对话的详细总结',
            '【时间轴】本段结束时的剧情进度，严格写成「第X天|地点|本段重要事情」三段（X 是从故事开始算的天数，如「第27天|北境营地|与斥候队长会面」；地点或事情未知写「无」）',
            '【世界状态】当前累计的世界状态，严格写成「类别：内容；类别：内容」单行（类别取：年龄/好感/关系/物品/日程，内容用顿号分隔；某类别无内容或未变化写「无」，需要清空某类写「空」）',
        ].join('\n'),
        prompt: transcript,
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

// 从总结结果里解析【时间轴】行 → { day, period, location, event }（解析不出返回 null）
// 时间轴格式已改为「第X天|地点|重要事情」三段；旧版「第X天|时段|地点|重要事情」四段也兼容解析。
function extractTimeAxis(text) {
    const m = String(text).match(/【时间轴】\s*([^\n]+)/);
    if (!m || !m[1]) return null;
    const raw = m[1].trim();
    if (!raw || raw === '无') return null;
    const parts = raw.split(/[|｜]/).map(s => s.trim()).filter(Boolean);
    const dayM = parts[0] && parts[0].match(/第\s*(\d+)\s*天/);
    const day = dayM ? parseInt(dayM[1], 10) : null;
    let period = '';
    let location = '';
    let event = '';
    if (parts.length >= 4 && PERIODS.includes(parts[1])) {
        // 旧四段格式：第二段是已知时段则跳过
        period = parts[1];
        location = (parts[2] && parts[2] !== '无') ? parts[2] : '';
        event = (parts[3] && parts[3] !== '无') ? parts[3] : '';
    } else {
        location = (parts[1] && parts[1] !== '无') ? parts[1] : '';
        event = (parts[2] && parts[2] !== '无') ? parts[2] : '';
    }
    if (day == null && !location && !event) return null;
    return { day, period, location, event, raw };
}

// 时间线列表：叠加新场景（第X天/年月日几时几分/地点/重要事情）；连续完全重复的场景不重复叠加
function pushTimelineEntry(day, time, location, event) {
    if (day == null && !time && !location && !event) return;
    const last = settings.timeline[settings.timeline.length - 1];
    if (last && last.day === day && last.time === time && last.location === location && last.event === event) return;
    settings.timeline.push({ id: uid(), day, time, location, event });
}

// 把世界状态按类别分组（供注入与展示复用）
function worldStateByCat() {
    const map = {};
    for (const cat of WORLD_CATS) map[cat] = [];
    for (const e of settings.worldState) {
        if (map[e.cat]) map[e.cat].push(e.text);
    }
    return map;
}
function worldStateLines(byCat) {
    return WORLD_CATS.map(cat => cat + '：' + (byCat[cat] && byCat[cat].length ? byCat[cat].join('、') : '无')).join('\n');
}
// 从总结结果里解析【世界状态】行 → { entries: [{ cat, text }], clearCats: [cat] }
// 约定：某类别写「无」= 保留原样；写「空」= 清空该类
function extractWorldState(text) {
    const m = String(text).match(/【世界状态】\s*([^\n]+)/);
    if (!m || !m[1]) return { entries: [], clearCats: [] };
    const raw = m[1].trim();
    if (!raw || raw === '无') return { entries: [], clearCats: [] };
    const entries = [];
    const clearCats = [];
    const segs = raw.split(/[；;]/).map(s => s.trim()).filter(Boolean);
    for (const seg of segs) {
        const ci = seg.indexOf('：');
        const ci2 = seg.indexOf(':');
        const idx = ci >= 0 ? ci : ci2;
        if (idx <= 0) continue;
        const cat = seg.slice(0, idx).trim();
        const content = seg.slice(idx + 1).trim();
        if (!content || content === '无') continue;
        if (content === '空') { clearCats.push(cat); continue; }
        for (const item of content.split(/[、，,]/).map(s => s.trim()).filter(Boolean)) {
            entries.push({ cat, text: item });
        }
    }
    return { entries, clearCats };
}
// 快照式合并：某类别本次有输出就替换整类；「空」则清空该类；无输出保留原样
function applyWorldState(parsed) {
    const entries = parsed.entries || [];
    const clearCats = parsed.clearCats || [];
    for (const cat of clearCats) {
        settings.worldState = settings.worldState.filter(e => e.cat !== cat);
    }
    for (const cat of WORLD_CATS) {
        const items = entries.filter(e => e.cat === cat);
        if (!items.length) continue;
        settings.worldState = settings.worldState.filter(e => e.cat !== cat);
        for (const it of items) settings.worldState.push({ id: uid(), cat, text: it.text });
    }
}

// 把一组记忆合并成一段文本（带序号），用于晋级时“清空并总结”
function mergeEntries(arr) {
    return arr.map((m, i) => `(${i + 1}) ${m.text}`).join('\n\n');
}

// 按 id 在三档记忆里查找某条记忆（用于编辑/保存）
function findMemory(id) {
    for (const arr of [settings.memories, settings.longMemories]) {
        const m = arr.find(x => x.id === id);
        if (m) return m;
    }
    return null;
}

// 记忆晋级：短期满 10 → 合并入长期并清空短期（长期不再自动晋级，满 10 时提醒归档到世界书）
// 返回本次是否触发了晋级，供总结弹窗提示
function promoteMemories() {
    let toLong = false;
    if (settings.memories.length >= TIER_LIMIT) {
        // 合并后的条目沿用「最新一条」的剧情时间与时间轴，保持时间线可读
        const last = settings.memories[settings.memories.length - 1];
        const lastStoryTime = last.storyTime || settings.storyTime || '';
        settings.longMemories.push({ id: uid(), time: Date.now(), storyTime: lastStoryTime, storyDay: last.storyDay, storyPeriod: last.storyPeriod, storyLocation: last.storyLocation, text: mergeEntries(settings.memories) });
        settings.memories = [];
        saveSettings();
        toLong = true;
    }
    return { toLong };
}

async function summarizeLastRound() {
    activateCharacter(); // 每次总结前重新绑定到当前角色，避免切换角色后总结写错档
    if (!settings.memoryEnabled || isSummarizing) return;
    if (!Array.isArray(chat) || chat.length < 2) return;

    // 取「上次总结以来」的新消息窗口：每 N 轮才总结时，把中间跳过的几轮一并带上，避免漏剧情
    const indexed = chat.map((m, i) => ({ m, i })).filter(x => x.m && typeof x.m.mes === 'string' && x.m.mes.trim() && !x.m.is_system);
    if (indexed.length < 2) return;
    const start = (settings.lastSummaryIndex != null && settings.lastSummaryIndex >= 0) ? settings.lastSummaryIndex + 1 : 0;
    let sel = indexed.filter(x => x.i >= start);
    if (sel.length < 2) {
        // 水位线越界（消息被删除/回滚等）：退化为最近一轮，避免从此再也不总结
        let lastCharIdx = -1;
        for (let i = indexed.length - 1; i >= 0; i--) { if (!indexed[i].m.is_user) { lastCharIdx = i; break; } }
        if (lastCharIdx < 0) return;
        let userIdx = -1;
        for (let i = lastCharIdx - 1; i >= 0; i--) { if (indexed[i].m.is_user) { userIdx = i; break; } }
        if (userIdx < 0) return;
        sel = [indexed[userIdx], indexed[lastCharIdx]];
    }
    const lastMsg = sel[sel.length - 1].m;
    if (lastMsg.is_user) return; // 最后一条是用户消息（尚未回复），跳过

    const lastCharMsg = [...sel].reverse().find(x => !x.m.is_user).m;
    const lastUserMsg = [...sel].reverse().find(x => x.m.is_user).m;
    if (!lastCharMsg || !lastUserMsg) return;

    const transcript = sel.map(x => (x.m.name || (x.m.is_user ? '用户' : '角色')) + '：' + x.m.mes).join('\n\n');

    isSummarizing = true;
    try {
        const { systemPrompt, prompt } = buildSummaryPrompt(transcript, lastUserMsg.name || '用户', lastCharMsg.name || '角色', settings.storyTime);
        const result = await generateRaw({ prompt, systemPrompt });
        if (result && result.trim()) {
            // 解析出新剧情时间，解析失败则沿用上一次（保证时间线不倒退、不丢失）
            const newStoryTime = extractStoryTime(result) || settings.storyTime;
            settings.storyTime = newStoryTime;
            // 解析结构化时间轴（第X天/地点/重要事情），解析失败则沿用上一次，保证时间轴不倒退
            const axis = extractTimeAxis(result);
            if (axis) {
                if (axis.day != null) settings.storyDay = axis.day;
                if (axis.period) settings.storyPeriod = axis.period;
                if (axis.location) settings.storyLocation = axis.location;
                // 时间轴列表：叠加本段场景（第X天/年月日几时几分/地点/重要事情）；时间取【时间】里的具体时间
                pushTimelineEntry(axis.day, newStoryTime, axis.location, axis.event);
            }
            // 世界状态：解析并按类别快照合并（「无」保留、「空」清空、有新内容替换）
            applyWorldState(extractWorldState(result));
            // 记忆正文去掉【时间轴】【世界状态】行（结构化数据已单独存，正文保持干净）
            const memoryText = result.trim().replace(/【时间轴】[^\n]*\n?/, '').replace(/【世界状态】[^\n]*\n?/, '').trim();
            // 只追加，绝不覆盖或删除已有记忆
            settings.memories.push({ id: uid(), time: Date.now(), storyTime: newStoryTime, storyDay: settings.storyDay, storyPeriod: settings.storyPeriod, storyLocation: settings.storyLocation, text: memoryText });
            settings.lastSummaryIndex = chat.length - 1; // 记录已总结到的消息下标，下次只总结新增部分
            const promoted = promoteMemories();
            saveSettings();
            updatePromptInjection();
            renderMemories();
            renderTimeAxis();
            renderWorldState();

            // 弹窗提示：总结成功 + 是否触发晋级
            let msg = '本轮记忆总结成功';
            const parts = [];
            if (promoted.toLong) parts.push('短期已满十轮，自动放入长期记忆');
            if (parts.length) msg += '；' + parts.join('；');
            toastr.success(msg);

            // 长期记忆满 10 条：提醒归档到世界书（只提醒一次，归档后重置）
            if (settings.longMemories.length >= TIER_LIMIT && !settings.worldReminderShown) {
                settings.worldReminderShown = true;
                saveSettings();
                toastr.warning('长期记忆已满 ' + TIER_LIMIT + ' 条，建议点「注入世界书」归档并清空长期记忆，避免正文越塞越长', undefined, { timeOut: 8000 });
            }
            updateInjectHint();
        } else {
            // 模型偶发返回空内容：明确提示，避免无声跳过
            toastr.warning('本轮总结返回空内容，已跳过（未写入记忆）');
        }
    } catch (e) {
        console.error('[Serendipity] 记忆总结失败：', e);
        toastr.error('本轮记忆总结失败');
    } finally {
        isSummarizing = false;
    }
}

// ---------------- 记忆注入正文（防失忆） ----------------
function buildMemoryBlock() {
    const parts = [];
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

    // 结构化时间轴注入（一行极简锚点，让模型知道当前第X天/年月日几时几分/地点，保持时间一致）
    const hasAxis = settings.storyDay != null || settings.storyTime || settings.storyLocation;
    const axisLine = hasAxis
        ? '当前剧情时间：第' + (settings.storyDay != null ? settings.storyDay : '?') + '天' + (settings.storyTime ? ' · ' + settings.storyTime : '') + (settings.storyLocation ? ' · ' + settings.storyLocation : '')
        : '';
    setExtensionPrompt(
        'serendipity_time',
        axisLine ? '[Serendipity 当前时间]\n' + axisLine + '\n请在后续生成中与这个时间保持一致，不要随意跳转；若剧情需要推进时间，请自然推进。' : '',
        extension_prompt_types.IN_PROMPT,
        0,
    );

    // 世界状态注入（列表格式，模型每轮读取并遵守）
    const worldLines = settings.worldState.length ? worldStateLines(worldStateByCat()) : '';
    setExtensionPrompt(
        'serendipity_world',
        worldLines ? '[Serendipity 世界状态]\n' + worldLines + '\n请记住并在后续生成中遵守这些世界状态（年龄/好感/关系/物品/日程），剧情产生新变化时自然更新。' : '',
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

// ---------------- 世界书自动注入 ----------------
// 用户自己选要注入的世界书名（存于每角色设置里，不一定用角色绑定的那本）
function getSelectedWorldBook() {
    return typeof settings.worldBook === 'string' ? settings.worldBook.trim() : '';
}

// 判断这本世界书当前是否已「激活」（设为全局世界书，或绑定为当前角色的主要世界书）。
// 只有激活的世界书，酒馆才会把里面的条目拼进发给模型的 prompt，否则模型读不到。
function isWorldBookActive(name) {
    if (!name) return false;
    if (Array.isArray(selected_world_info) && selected_world_info.includes(name)) return true;
    if (this_chid !== undefined && characters && characters[this_chid]) {
        const w = characters[this_chid].data?.extensions?.world;
        if (typeof w === 'string' && w === name) return true;
    }
    return false;
}

// 把长期记忆归档到用户选择的世界书：合并进同一条常驻条目（避免世界书越攒越多条），归档后清空长期记忆
async function injectToWorldBook() {
    if (isInjecting) return; // 上一次注入还没结束，忽略重复点击
    isInjecting = true;
    toastr.info('正在归档长期记忆到世界书…', undefined, { timeOut: 1500 });
    try {
        activateCharacter();
        const worldName = getSelectedWorldBook();
        if (!worldName) {
            toastr.warning('请先在上方选择一个世界书');
            return;
        }
        const memBlock = settings.longMemories.length ? mergeEntries(settings.longMemories).trim() : '';
        if (!memBlock) {
            toastr.warning('当前还没有长期记忆，先积累一些记忆再归档');
            return;
        }
        const data = await loadWorldInfo(worldName);
        if (!data || typeof data !== 'object' || !data.entries) {
            toastr.error('读取世界书「' + worldName + '」失败，可能已被删除，请重新选择');
            return;
        }
        // 找到既有的归档条目并追加，找不到才新建一条
        const MARK = '[Serendipity] 剧情记忆归档';
        let entry = data.entries.find(e => e && e.comment === MARK);
        if (!entry) {
            entry = createWorldInfoEntry(worldName, data);
            if (!entry) {
                toastr.error('在世界书中创建新条目失败');
                return;
            }
            entry.comment = MARK;
            entry.content = memBlock;
        } else {
            entry.content = entry.content ? entry.content + '\n\n' + memBlock : memBlock;
        }
        entry.constant = true;    // 常驻：每轮都注入，不靠关键词触发
        entry.selective = false;
        entry.key = [];           // 不加关键词
        entry.keysecondary = [];
        entry.scanDepth = 1;                    // 注入时直接把扫描深度改为 1
        entry.matchCreatorNotes = true;          // 额外匹配来源：创作者注释
        entry.characterFilterNames = [currentCharName()]; // 绑定到当前角色（按名字）
        entry.characterFilterExclude = false;
        entry.position = 4;            // 插入位置：插入深度 @D（4 = atDepth）
        entry.role = 0;                // 系统角色 [系统]（0 = SYSTEM）
        entry.depth = 4;               // 插入深度值 @4
        await saveWorldInfo(worldName, data, true);
        settings.archivedWorldBook = worldName; // 记录归档目标，用于「未激活」常驻黄条提醒
        // 归档后清空长期记忆（正文注入保持有界），并重置提醒
        settings.longMemories = [];
        settings.worldReminderShown = false;
        saveSettings();
        updatePromptInjection();
        renderMemories();
        if (isWorldBookActive(worldName)) {
            toastr.success('已归档长期记忆到世界书「' + worldName + '」并清空长期记忆');
        } else {
            toastr.warning('已归档到世界书「' + worldName + '」，但这本世界书还没激活，模型暂时读不到。请到酒馆世界书界面把它设为全局世界书，或绑定到此角色。');
        }
    } catch (e) {
        console.error('[Serendipity] 注入世界书失败：', e);
        toastr.error('注入世界书失败' + (e && e.message ? '：' + e.message : ''));
    } finally {
        isInjecting = false;
    }
}

// 世界书下拉：列出全部世界书，让用户自己选要注入到哪一本
function renderWorldSelect() {
    const selectEl = $('#st-serendipity .st-sd__world-select');
    if (!selectEl.length) return;
    const names = Array.isArray(world_names) ? world_names : [];
    const current = getSelectedWorldBook();
    let html = '<option value="">未选择世界书</option>';
    for (const n of names) {
        const selected = n === current ? ' selected' : '';
        html += `<option value="${escapeHtml(n)}"${selected}>${escapeHtml(n)}</option>`;
    }
    selectEl.html(html);
}

// 长期记忆满 10 时高亮「注入世界书」按钮，提醒用户归档
function updateInjectHint() {
    const btn = $('#st-serendipity .st-sd__inject-world');
    if (!btn.length) return;
    const full = settings.longMemories.length >= TIER_LIMIT;
    btn.toggleClass('st-sd__inject-world--hint', full);
    btn.attr('title', full ? '长期记忆已满，建议归档到世界书' : '把长期记忆归档到世界书');
}

// 世界书未激活的常驻黄条：归档过后若那本世界书一直没被激活，就一直在面板上提醒
function renderWorldAlert() {
    const el = $('#st-serendipity .st-sd__world-alert');
    if (!el.length) return;
    const name = settings.archivedWorldBook || '';
    if (name && !isWorldBookActive(name)) {
        el.text('世界书「' + name + '」里已归档了长期记忆，但它尚未激活，模型读不到。请到酒馆「世界书」界面把它设为全局世界书，或绑定到当前角色。');
        el.show();
    } else {
        el.hide();
    }
}

// ---------------- 记忆 UI ----------------
function memoryItemHtml(m, deletable, tier) {
    // 优先显示剧情时间（时间线连贯），真实记录时间放在 tooltip 里备查
    const timeLabel = m.storyTime ? escapeHtml(m.storyTime) : escapeHtml(fmtTime(m.time));
    const wallTitle = m.storyTime ? ` title="记录于 ${fmtTime(m.time)}"` : '';

    if (m.id === editingId) {
        // 编辑态：文本变为可编辑 textarea，操作区换成保存/取消
        return `<div class="st-sd__memory is-editing" data-id="${m.id}">
            <div class="st-sd__memory-head">
                <span class="st-sd__memory-time"${wallTitle}>${timeLabel}</span>
                <span class="st-sd__memory-actions">
                    <button type="button" class="st-sd__memory-save" data-id="${m.id}" title="保存修改">保存</button>
                    <button type="button" class="st-sd__memory-cancel" data-id="${m.id}" title="放弃修改">取消</button>
                </span>
            </div>
            <textarea class="st-sd__memory-edit-text" spellcheck="false">${escapeHtml(m.text)}</textarea>
        </div>`;
    }

    const edit = `<button type="button" class="st-sd__memory-edit" data-id="${m.id}" data-tier="${tier}" title="修改此条记忆">编辑</button>`;
    const del = deletable
        ? `<button type="button" class="st-sd__memory-del" data-id="${m.id}" data-tier="${tier}" title="删除此条记忆">删除</button>`
        : '';
    return `<div class="st-sd__memory" data-id="${m.id}">
        <div class="st-sd__memory-head">
            <span class="st-sd__memory-time"${wallTitle}>${timeLabel}</span>
            <span class="st-sd__memory-actions">${edit}${del}</span>
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
    renderWorldSelect();
    updateInjectHint();
    renderWorldAlert();
    const everyInput = $('#st-serendipity .st-sd__every-input');
    if (everyInput.length) everyInput.val(settings.summarizeEvery || 1);

    const hasAny = settings.memories.length || settings.longMemories.length;
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
    // 长期记忆：可折叠，默认收起；满 10 条会提醒归档到世界书
    if (settings.longMemories.length) {
        html += `<details class="st-sd__tier"><summary class="st-sd__tier-title">长期记忆（${settings.longMemories.length}/${TIER_LIMIT}）</summary>`;
        html += [...settings.longMemories].reverse().map(m => memoryItemHtml(m, true, 'long')).join('');
        html += '</details>';
    }
    list.html(html);
}

// ---------------- 时间轴 UI ----------------
// 当前锚点 + 时间线列表（已过X天 / 第X天·年月日几时几分·地点 / 重要事情，不断叠加，可编辑/删除）
let timelineEditingId = null;

function renderTimeAxis() {
    const cur = $('#st-serendipity .st-sd__axis-current');
    if (cur.length) {
        const day = settings.storyDay != null ? '已过' + settings.storyDay + '天' : '（待首次总结）';
        const parts = [day];
        if (settings.storyTime) parts.push(settings.storyTime);
        if (settings.storyLocation) parts.push(settings.storyLocation);
        cur.text(parts.join(' · '));
    }
    const list = $('#st-serendipity .st-sd__axis-list');
    if (list.length) {
        const entries = settings.timeline.slice().sort((a, b) =>
            (a.day == null ? 1 : 0) - (b.day == null ? 1 : 0) || (a.day || 0) - (b.day || 0)
        );
        if (!entries.length) {
            list.html('<div class="st-sd__empty">暂无时间轴，总结后自动叠加场景（第X天 / 年月日几时几分 / 地点 / 重要事情）</div>');
        } else {
            list.html(entries.map(e => {
                if (e.id === timelineEditingId) {
                    return '<div class="st-sd__tl-item st-sd__tl-item--edit" data-id="' + e.id + '">'
                        + '<div class="st-sd__tl-edit-row">'
                        + '<input type="number" class="st-sd__tl-e-day" placeholder="第几天" min="0" value="' + (e.day != null ? e.day : '') + '">'
                        + '<input type="text" class="st-sd__tl-e-time" placeholder="年月日几时几分" value="' + escapeHtml(e.time) + '">'
                        + '<input type="text" class="st-sd__tl-e-loc" placeholder="地点" value="' + escapeHtml(e.location) + '">'
                        + '</div>'
                        + '<input type="text" class="st-sd__tl-e-event" placeholder="重要事情" value="' + escapeHtml(e.event) + '">'
                        + '<div class="st-sd__tl-edit-actions"><button type="button" class="st-sd__tl-save" data-id="' + e.id + '">保存</button><button type="button" class="st-sd__tl-cancel">取消</button></div>'
                        + '</div>';
                }
                return '<div class="st-sd__tl-item" data-id="' + e.id + '">'
                    + '<div class="st-sd__tl-head">'
                    + '<span class="st-sd__tl-day">' + (e.day != null ? '第' + e.day + '天' : '—') + '</span>'
                    + (e.time ? '<span class="st-sd__tl-time">' + escapeHtml(e.time) + '</span>' : '')
                    + (e.location ? '<span class="st-sd__tl-loc">' + escapeHtml(e.location) + '</span>' : '')
                    + '<span class="st-sd__memory-actions"><button type="button" class="st-sd__tl-edit" data-id="' + e.id + '">编辑</button><button type="button" class="st-sd__tl-del" data-id="' + e.id + '">删除</button></span>'
                    + '</div>'
                    + (e.event ? '<div class="st-sd__tl-event">' + escapeHtml(e.event) + '</div>' : '')
                    + '</div>';
            }).join(''));
        }
    }
    renderRelativeHints();
}

// 检测最新一条 AI 回复里的相对时间词（昨天/前天…），换算成第X天供用户核对
function detectRelativeTimeHints() {
    const hints = [];
    if (!Array.isArray(chat) || !chat.length) return hints;
    const last = chat[chat.length - 1];
    if (!last || last.is_user || last.is_system || typeof last.mes !== 'string') return hints;
    const text = last.mes;
    const currentDay = settings.storyDay;
    for (const [word, offset] of Object.entries(RELATIVE_DAYS)) {
        if (!text.includes(word)) continue;
        hints.push({ word, offset, implied: currentDay != null ? '第' + (currentDay + offset) + '天' : '' });
    }
    return hints;
}

function renderRelativeHints() {
    const box = $('#st-serendipity .st-sd__axis-hints');
    if (!box.length) return;
    const hints = detectRelativeTimeHints();
    if (!hints.length) { box.html(''); return; }
    box.html(hints.map(h =>
        '<div class="st-sd__axis-hint">⚠ 本段使用了「' + escapeHtml(h.word) + '」' + (h.implied ? '（约等于 ' + h.implied + '）' : '') + '，请核对是否与时间轴一致</div>'
    ).join(''));
}

// 世界状态（列表格式，按类别分组展示）
let worldEditingId = null; // 当前编辑中的世界状态条目 id

function renderWorldState() {
    const list = $('#st-serendipity .st-sd__world-list');
    if (!list.length) return;
    if (!settings.worldState.length) {
        list.html('<div class="st-sd__empty">暂无世界状态，总结后自动提取，或在上方手动添加</div>');
        return;
    }
    let html = '';
    for (const cat of WORLD_CATS) {
        const items = settings.worldState.filter(e => e.cat === cat);
        if (!items.length) continue;
        html += '<div class="st-sd__world-cat-title">' + escapeHtml(cat) + '</div>';
        html += items.map(e => {
            if (e.id === worldEditingId) {
                return '<div class="st-sd__world-item" data-id="' + e.id + '">'
                    + '<input type="text" class="st-sd__world-edit-text" value="' + escapeHtml(e.text) + '">'
                    + '<span class="st-sd__memory-actions"><button type="button" class="st-sd__world-save" data-id="' + e.id + '">保存</button><button type="button" class="st-sd__world-cancel">取消</button></span>'
                    + '</div>';
            }
            return '<div class="st-sd__world-item" data-id="' + e.id + '">'
                + '<span class="st-sd__world-item-text">' + escapeHtml(e.text) + '</span>'
                + '<span class="st-sd__memory-actions"><button type="button" class="st-sd__world-edit" data-id="' + e.id + '">编辑</button><button type="button" class="st-sd__world-del" data-id="' + e.id + '">删除</button></span>'
                + '</div>';
        }).join('');
    }
    list.html(html);
}

// 导出全部记忆为 txt 文件
function exportMemories() {
    const lines = ['Serendipity 剧情记忆·时间线·世界状态导出', '导出时间：' + fmtTime(Date.now()), ''];

    const tier = (title, arr) => {
        if (!arr.length) return;
        lines.push('========== ' + title + ' ==========');
        for (const m of arr) {
            lines.push('[' + fmtTime(m.time) + ']');
            lines.push(m.text);
            lines.push('');
        }
    };
    tier('长期记忆', settings.longMemories);
    tier('短期记忆', settings.memories);

    // 时间线
    lines.push('========== 时间线 ==========');
    const tl = settings.timeline.slice().sort((a, b) =>
        (a.day == null ? 1 : 0) - (b.day == null ? 1 : 0) || (a.day || 0) - (b.day || 0)
    );
    if (tl.length) {
        for (const e of tl) {
            const day = e.day != null ? '第' + e.day + '天' : '—';
            lines.push(day + (e.time ? ' · ' + e.time : '') + (e.location ? ' · ' + e.location : ''));
            if (e.event) lines.push('    ' + e.event);
            lines.push('');
        }
    } else {
        lines.push('（暂无）');
        lines.push('');
    }

    // 世界状态
    lines.push('========== 世界状态 ==========');
    if (settings.worldState.length) {
        for (const cat of WORLD_CATS) {
            const items = settings.worldState.filter(e => e.cat === cat);
            if (!items.length) continue;
            lines.push(cat + '：' + items.map(e => e.text).join('、'));
        }
    } else {
        lines.push('（暂无）');
    }

    const content = '﻿' + lines.join('\n'); // BOM，避免记事本中文乱码
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'serendipity-export-' + new Date().toISOString().slice(0, 10) + '.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 手动补记一条记忆：不等自动总结，直接把手写的设定/事件塞进短期记忆（沿用当前剧情时间）
function addManualNote() {
    activateCharacter();
    const input = $('#st-serendipity .st-sd__note-input');
    if (!input.length) return;
    const text = input.val().trim();
    if (!text) { toastr.warning('先写点内容再补记'); return; }
    settings.memories.push({
        id: uid(),
        time: Date.now(),
        storyTime: settings.storyTime || '',
        storyDay: settings.storyDay,
        storyPeriod: settings.storyPeriod || '',
        storyLocation: settings.storyLocation || '',
        text: text,
    });
    saveSettings();
    updatePromptInjection();
    renderMemories();
    input.val('');
    toastr.success('已补记一条记忆');
}

// 一键清空当前角色数据（二次确认），重开这个角色时插件就是干净的一套
function resetCurrentChar() {
    activateCharacter();
    const name = activeChar || '当前角色';
    if (!confirm('确定清空「' + name + '」的全部 Serendipity 数据吗？记忆、时间轴、世界状态、屏蔽词、指令都会被清空，且不可撤销。')) return;
    const keepWorldBook = settings.worldBook;
    Object.assign(settings, freshCharSettings());
    settings.worldBook = keepWorldBook; // 保留用户选择的世界书，方便下次直接注入
    saveSettings();
    updatePromptInjection();
    renderMemories();
    renderTimeAxis();
    renderWorldState();
    renderBlockedWords();
    renderInstructions();
    toastr.success('已清空「' + name + '」的 Serendipity 数据');
}

// 开启新对话时清空「剧情记录」（记忆/时间轴/世界状态/剧情时间），保留配置（屏蔽词/指令/开关/世界书选择）
function resetStoryRecords() {
    settings.memories = [];
    settings.longMemories = [];
    settings.worldState = [];
    settings.timeline = [];
    settings.storyTime = '';
    settings.storyDay = null;
    settings.storyPeriod = '';
    settings.storyLocation = '';
    settings.lastSummaryIndex = -1;
    settings.roundsSinceSummary = 0;
    settings.archivedWorldBook = '';
    settings.worldReminderShown = false;
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
        <button type="button" class="st-sd__tab" data-tab="time">时间轴</button>
        <button type="button" class="st-sd__tab" data-tab="world">世界</button>
      </div>

      <div class="st-sd__pane" data-pane="memory">
        <div class="st-sd__toolbar">
          <span class="st-sd__label">自动记忆</span>
          <label class="st-sd__switch"><input type="checkbox" class="st-sd__mem-toggle"><span class="st-sd__switch-slider"></span></label>
          <button type="button" class="st-sd__summarize">立即总结</button>
          <button type="button" class="st-sd__export">导出</button>
        </div>
        <div class="st-sd__every-row">
          <span class="st-sd__label">每</span>
          <input type="number" class="st-sd__every-input" min="1" max="50" title="每 N 轮自动总结一次，1=每轮都总结">
          <span class="st-sd__label">轮总结一次</span>
        </div>
        <div class="st-sd__add-row">
          <input type="text" class="st-sd__note-input" placeholder="手动补记一条记忆（立刻记下某个设定/事件，不等自动总结）">
          <button type="button" class="st-sd__add-note">补记</button>
        </div>
        <div class="st-sd__world-row">
          <select class="st-sd__world-select" title="选择要注入记忆的世界书"></select>
        </div>
        <div class="st-sd__world-row">
          <button type="button" class="st-sd__inject-world">注入世界书</button>
        </div>
        <div class="st-sd__world-alert" style="display:none"></div>
        <div class="st-sd__story-time"></div>
        <div class="st-sd__memory-list"></div>
        <div class="st-sd__hint">短期满 ${TIER_LIMIT} 条自动合并入长期；长期满 ${TIER_LIMIT} 条会提醒你「注入世界书」归档并清空。记忆会注入正文，防止模型失忆。</div>
        <div class="st-sd__reset-row">
          <button type="button" class="st-sd__reset">清空本角色数据</button>
        </div>
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

      <div class="st-sd__pane" data-pane="time" style="display:none">
        <div class="st-sd__toolbar">
          <span class="st-sd__label">当前时间轴</span>
          <span class="st-sd__axis-current"></span>
        </div>
        <div class="st-sd__add-row">
          <input type="number" class="st-sd__axis-day" placeholder="第几天" min="0">
          <input type="text" class="st-sd__axis-time" placeholder="年月日几时几分">
          <input type="text" class="st-sd__axis-loc" placeholder="地点">
          <button type="button" class="st-sd__axis-save">设定</button>
        </div>
        <div class="st-sd__hint">手动设定时间轴锚点（第X天 + 年月日几时几分 + 地点），下次总结从这里接力推进。下方时间线按「第X天 / 年月日几时几分 / 地点 / 重要事情」不断叠加，可编辑/删除。</div>
        <div class="st-sd__axis-hints"></div>
        <div class="st-sd__axis-list"></div>
      </div>

      <div class="st-sd__pane" data-pane="world" style="display:none">
        <div class="st-sd__add-row">
          <select class="st-sd__world-cat">
            ${WORLD_CATS.map(c => `<option value="${c}">${c}</option>`).join('')}
          </select>
          <input type="text" class="st-sd__world-input" placeholder="如：艾莉丝 23岁">
          <button type="button" class="st-sd__world-add">添加</button>
        </div>
        <div class="st-sd__hint">世界状态按类别分组列出，总结时自动快照更新（某类别有新内容就替换整类，无变化保留）。可手动添加/编辑/删除。</div>
        <div class="st-sd__world-list"></div>
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
    // 每 N 轮总结一次
    panel.find('.st-sd__every-input').on('change', function () {
        let v = parseInt(this.value, 10);
        if (isNaN(v) || v < 1) v = 1;
        if (v > 50) v = 50;
        settings.summarizeEvery = v;
        this.value = v;
        saveSettings();
        toastr.success('每 ' + v + ' 轮总结一次');
    });
    // 注入世界书（事件委托，按钮即使被重建也始终能触发）
    panel.on('click', '.st-sd__inject-world', injectToWorldBook);
    // 选择要注入的世界书（事件委托）
    panel.on('change', '.st-sd__world-select', function () {
        settings.worldBook = this.value || '';
        saveSettings();
    });
    // 手动补记一条记忆
    panel.find('.st-sd__add-note').on('click', addManualNote);
    panel.find('.st-sd__note-input').on('keydown', (e) => { if (e.key === 'Enter') addManualNote(); });
    // 一键清空当前角色数据
    panel.find('.st-sd__reset').on('click', resetCurrentChar);

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

    // 进入编辑态
    panel.on('click', '.st-sd__memory-edit', function () {
        editingId = String($(this).data('id'));
        renderMemories();
        const ta = panel.find('.st-sd__memory-edit-text');
        if (ta.length) {
            ta.focus();
            const v = ta.val();
            ta[0].setSelectionRange(v.length, v.length);
        }
    });
    // 取消编辑
    panel.on('click', '.st-sd__memory-cancel', function () {
        editingId = null;
        renderMemories();
    });
    // 保存编辑
    panel.on('click', '.st-sd__memory-save', function () {
        const id = String($(this).data('id'));
        const m = findMemory(id);
        if (!m) { editingId = null; renderMemories(); return; }
        const ta = panel.find('.st-sd__memory-edit-text');
        const v = (ta.val() || '').trim();
        if (!v) { toastr.warning('内容不能为空'); return; }
        m.text = v;
        editingId = null;
        saveSettings();
        updatePromptInjection();
        renderMemories();
        toastr.success('已保存修改');
    });

    // 事件委托：删除记忆 / 删除屏蔽词
    panel.on('click', '.st-sd__memory-del', function () {
        const id = $(this).data('id');
        const tier = $(this).data('tier');
        if (tier === 'short') settings.memories = settings.memories.filter(m => m.id !== id);
        else if (tier === 'long') settings.longMemories = settings.longMemories.filter(m => m.id !== id);
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

    // 时间轴：手动设定锚点
    const saveAxis = () => {
        const dayVal = parseInt(panel.find('.st-sd__axis-day').val(), 10);
        const storyTime = panel.find('.st-sd__axis-time').val().trim();
        const location = panel.find('.st-sd__axis-loc').val().trim();
        if (isNaN(dayVal) && !storyTime && !location) { toastr.warning('请至少填一项（天数/年月日几时几分/地点）'); return; }
        if (!isNaN(dayVal) && dayVal >= 0) settings.storyDay = dayVal;
        if (storyTime) settings.storyTime = storyTime;
        if (location) settings.storyLocation = location;
        saveSettings();
        updatePromptInjection();
        renderTimeAxis();
        panel.find('.st-sd__axis-day').val('');
        panel.find('.st-sd__axis-time').val('');
        panel.find('.st-sd__axis-loc').val('');
        toastr.success('已设定时间轴');
    };
    panel.find('.st-sd__axis-save').on('click', saveAxis);
    panel.find('.st-sd__axis-time').on('keydown', (e) => { if (e.key === 'Enter') saveAxis(); });
    panel.find('.st-sd__axis-loc').on('keydown', (e) => { if (e.key === 'Enter') saveAxis(); });

    // 世界状态：添加/编辑/删除
    const addWorld = () => {
        const cat = panel.find('.st-sd__world-cat').val() || WORLD_CATS[0];
        const text = panel.find('.st-sd__world-input').val().trim();
        if (!text) return;
        settings.worldState.push({ id: uid(), cat, text });
        saveSettings();
        updatePromptInjection();
        renderWorldState();
        panel.find('.st-sd__world-input').val('');
    };
    panel.find('.st-sd__world-add').on('click', addWorld);
    panel.find('.st-sd__world-input').on('keydown', (e) => { if (e.key === 'Enter') addWorld(); });

    panel.on('click', '.st-sd__world-edit', function () {
        worldEditingId = String($(this).data('id'));
        renderWorldState();
        const inp = panel.find('.st-sd__world-edit-text');
        if (inp.length) { inp.focus(); const v = inp.val(); inp[0].setSelectionRange(v.length, v.length); }
    });
    panel.on('click', '.st-sd__world-cancel', function () {
        worldEditingId = null;
        renderWorldState();
    });
    panel.on('click', '.st-sd__world-save', function () {
        const id = String($(this).data('id'));
        const e = settings.worldState.find(x => x.id === id);
        if (!e) { worldEditingId = null; renderWorldState(); return; }
        const v = panel.find('.st-sd__world-edit-text').val().trim();
        if (!v) { toastr.warning('内容不能为空'); return; }
        e.text = v;
        worldEditingId = null;
        saveSettings();
        updatePromptInjection();
        renderWorldState();
        toastr.success('已保存');
    });
    panel.on('click', '.st-sd__world-del', function () {
        const id = String($(this).data('id'));
        settings.worldState = settings.worldState.filter(x => x.id !== id);
        saveSettings();
        updatePromptInjection();
        renderWorldState();
    });

    // 时间线列表：编辑/删除/保存
    panel.on('click', '.st-sd__tl-edit', function () {
        timelineEditingId = String($(this).data('id'));
        renderTimeAxis();
        const inp = panel.find('.st-sd__tl-e-event');
        if (inp.length) inp.focus();
    });
    panel.on('click', '.st-sd__tl-cancel', function () {
        timelineEditingId = null;
        renderTimeAxis();
    });
    panel.on('click', '.st-sd__tl-save', function () {
        const id = String($(this).data('id'));
        const e = settings.timeline.find(x => x.id === id);
        if (!e) { timelineEditingId = null; renderTimeAxis(); return; }
        const dayVal = parseInt(panel.find('.st-sd__tl-e-day').val(), 10);
        e.day = isNaN(dayVal) ? null : dayVal;
        e.time = panel.find('.st-sd__tl-e-time').val().trim();
        e.location = panel.find('.st-sd__tl-e-loc').val().trim();
        e.event = panel.find('.st-sd__tl-e-event').val().trim();
        timelineEditingId = null;
        saveSettings();
        renderTimeAxis();
        toastr.success('已保存');
    });
    panel.on('click', '.st-sd__tl-del', function () {
        const id = String($(this).data('id'));
        settings.timeline = settings.timeline.filter(x => x.id !== id);
        saveSettings();
        renderTimeAxis();
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
        renderTimeAxis();
        renderWorldState();
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

    // 世界书列表可能尚未加载完成，异步刷新一次下拉
    updateWorldInfoList().then(() => renderWorldSelect()).catch(() => {});

    // 初始屏蔽 + 注入正文提示
    applyCensorAll();
    initCensorObserver();
    updatePromptInjection();

    // 生成结束后按设定频率自动总结（每 N 轮一次）
    eventSource.on(event_types.GENERATION_ENDED, () => {
        setTimeout(() => {
            if (!settings || !settings.memoryEnabled) return;
            settings.roundsSinceSummary = (settings.roundsSinceSummary || 0) + 1;
            const every = settings.summarizeEvery || 1;
            if (settings.roundsSinceSummary >= every) {
                settings.roundsSinceSummary = 0;
                summarizeLastRound();
            }
        }, 200);
    });
    // 切换聊天/角色后：切换到该角色对应的数据；开启新对话（空聊天）时清空上一段聊天的剧情记录
    eventSource.on(event_types.CHAT_CHANGED, () => {
        setTimeout(() => {
            activateCharacter();
            const msgs = Array.isArray(chat) ? chat.filter(m => m && typeof m.mes === 'string' && m.mes.trim() && !m.is_system) : [];
            if (msgs.length <= 1) resetStoryRecords(); // 新对话几乎为空 → 视为新开一局
            saveSettings();
            updatePromptInjection();
            applyCensorAll();
            renderMemories();
            renderTimeAxis();
            renderWorldState();
            renderBlockedWords();
            renderInstructions();
            renderCharBinding();
        }, 150);
    });

    // 屏幕尺寸变化（转屏/键盘）时重新定位面板
    $(window).on('resize.st-sd', fitPanelToViewport);
    $(window).on('orientationchange.st-sd', () => setTimeout(fitPanelToViewport, 300));

    renderMemories();
    renderTimeAxis();
    renderWorldState();
    renderBlockedWords();
    renderInstructions();
    renderCharBinding();
});

// ST 自动更新扩展后会调用 manifest.hooks.update 指向的这个函数（此时新代码已 git pull 到磁盘），
// 在这里刷新页面以加载新版本，无需手动刷新。
export function reloadOnUpdate() {
    toastr.info('Serendipity 已更新，正在刷新页面以应用新版本...', undefined, { timeOut: 1500 });
    setTimeout(() => location.reload(), 1500);
}
