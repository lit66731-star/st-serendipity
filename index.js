import { extension_settings } from '../../../extensions.js';
import * as stExt from '../../../extensions.js';
import {
    chat,
    chat_metadata,
    characters,
    this_chid,
    event_types,
    eventSource,
    getRequestHeaders,
    saveSettingsDebounced,
    setExtensionPrompt,
    extension_prompt_types,
    saveChat,
    reloadCurrentChat,
} from '../../../../script.js';
import { loadWorldInfo, createWorldInfoEntry, saveWorldInfo, world_names, updateWorldInfoList, selected_world_info, world_info } from '../../../world-info.js';
import { power_user } from '../../../power-user.js';
import { selected_group } from '../../../group-chats.js';
import { getStringHash, copyText } from '../../../utils.js';
import { textgen_types, textgenerationwebui_settings } from '../../../textgen-settings.js';
import { oai_settings } from '../../../openai.js';

const extensionName = 'serendipity';
const VERSION = '2.3.14'; // 面板标题旁展示，更新时与 manifest.json 同步

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
const WORLD_CATS = ['物品', '日程'];  // 世界状态现在只放非人物信息；年龄/好感/关系已并入「人物」体系（NPC + 关系线）

// 伏笔/未完成事项的状态（点击状态标签循环切换）
const FORESHADOW_STATUSES = ['未揭示', '未解决', '进行中', '已回收'];

// 一致性检查结果的类型（展示用中文标签）
const CHECK_TYPE_LABELS = { time: '时间冲突', state: '状态冲突', other: '其他' };

// 记忆功能开启时注入给模型的底层记忆规则（维护剧情时间/事件/人物/世界状态的连续性）
const MEMORY_RULES = `你正在使用 Serendipity 剧情记忆系统。

你的首要任务之一，是维持长篇剧情的时间连续性、事件连续性、人物连续性和世界状态连续性。

一、剧情时间是绝对坐标

Serendipity 中记录的剧情时间，是剧情世界内部的时间，不是聊天轮数，也不是消息发送时间。

当记忆中存在明确的剧情时间时，必须优先依据该时间理解历史事件。

例如：

* 第 3 天发生的事件，就是第 3 天发生的事件。
* 即使当前剧情已经推进到第 87 天，也不能把第 3 天的事件理解为“昨天发生”。
* 不得因为某段历史记忆距离当前上下文较远，就改变它原本的时间位置。

已确定的历史时间不得无依据修改。

⸻

二、区分“剧情时间”和“现实记录时间”

Serendipity 中可能同时存在：

* 剧情时间：故事世界中的时间
* 记录时间：该记忆实际被插件保存的时间

两者不是同一个概念。

进行剧情推理时，必须优先使用剧情时间。

不得使用现实聊天时间推断剧情经过了多久。

⸻

三、时间必须连续推进

每一轮剧情都必须参考当前已确认的剧情时间。

只有当剧情内容明确表明时间发生推进时，才推进剧情时间。

例如：

* “第二天早晨” → 可以进入下一天
* “三天后” → 推进三天
* “过了两个小时” → 推进两个小时
* 单纯进行了新一轮对话 → 不能默认过去了一天

如果剧情没有明确说明时间推进，不要擅自跳跃时间。

⸻

四、相对时间必须转换为绝对时间

当出现：

* 今天
* 昨天
* 前天
* 明天
* 上周
* 几天前
* 不久前
* 刚才
* 之前

等相对时间表达时，必须结合当前剧情时间和已有时间线进行判断。

优先将其转换成明确的剧情时间。

例如：

当前为第 87 天：

“昨天发生的事”

应理解为：

第 86 天发生的事。

如果无法确定具体时间，不得自行编造确定的日期，应保留不确定性。

⸻

五、历史事件与当前状态必须区分

历史记忆描述的是：

过去发生过什么。

世界状态描述的是：

当前世界处于什么状态。

过去发生的事件不会因为当前状态变化而消失。

例如：

第 10 天：

两人关系紧张。

第 30 天：

两人已经和解。

不能因此修改第 10 天的历史，使其变成“当时两人关系很好”。

历史保持历史，当前状态保持当前状态。

⸻

六、不得为了让剧情看起来顺畅而修改历史

如果当前剧情与历史记忆发生冲突：

1. 优先检查剧情时间。
2. 检查事件发生的先后顺序。
3. 检查当前世界状态。
4. 判断是否真的构成矛盾。
5. 如果无法确定，不要擅自修改既有历史。

宁可保留冲突并指出不确定性，也不要为了让剧情连贯而篡改已经确定的事实。

⸻

七、人物、物品和承诺具有时间连续性

人物状态、关系、物品、承诺和重要事件都具有时间属性。

例如：

第 12 天：顾清辞获得玉佩。

那么在没有后续事件表明玉佩丢失、转交或损坏之前：

第 13 天、第 20 天、第 50 天……

都应默认该物品仍然存在。

同理：

已经做出的承诺、已经发生的人物关系变化、已经确认的重要事件，都应保持连续。

⸻

八、记忆优先级

理解当前剧情时，优先级如下：

1. 当前明确剧情内容
2. 当前剧情时间
3. 已确认的世界状态
4. 已确认的历史时间线
5. 与当前剧情直接相关的历史记忆
6. 其他较早的历史记忆

较新的信息可以改变“当前状态”，但不能无依据地改写已经发生的历史事件。

⸻

九、不要把记忆当成“昨天发生的事情”

这是最重要的规则之一。

历史记忆只是历史记忆。

除非时间线明确表明该事件发生在昨天，否则不得使用“昨天”描述历史事件。

尤其在长篇剧情中，即使某件事情刚刚从记忆中被重新召回，也不代表它刚刚发生。

“刚刚想起” ≠ “刚刚发生”。

⸻

十、长篇剧情原则

无论剧情已经进行：

* 100 轮
* 500 轮
* 1000 轮
* 甚至更多轮

都必须保持已经确认的剧情时间和事件顺序。

上下文窗口的滚动、历史消息被压缩、记忆被重新注入，都不能改变剧情世界本身已经确定的时间线。

核心原则

记住发生过什么。

记住它什么时候发生。

记住现在进行到哪里。

不要因为记忆距离当前剧情很远，就把过去错误地变成“昨天”。

如果时间无法确定：

不要猜。

如果历史已经确定：

不要改。

如果当前状态发生变化：

更新当前状态，但保留历史。

⸻

十一、人物关系与情感变化

除了剧情事件，还必须关注本轮剧情中人物之间关系、好感、态度或情绪的变化。

只有剧情中确实发生了明确的变化时才记录；没有变化时不要虚构，更不要因为普通对话就写“感情更加深厚”。

记录时应包含：变化的双方（谁对谁）、变化前关系、变化后关系、好感变化（如能明确判断）、当前态度或情绪变化、导致变化的具体剧情事件、发生时间。

规则：

1. 关系变化必须有剧情依据，不得凭空推断。
2. 不要因为本轮没有提到某段关系，就认为这段关系不存在或已经结束。
3. 不要覆盖已经发生的历史关系变化；历史只追加，不改写。
4. 当前关系是历史变化累积后的结果。
5. 后续发生冲突时，应记录新的关系变化，而不是修改过去的历史。
6. 关系可以变好，也可以恶化、疏远、决裂或恢复。
7. 描述感情变化应尽量说明“为什么变化”，而不仅仅是给一个好感数字。
8. 关系变化必须结合当前剧情时间记录，不能用模糊的“最近”“之前”代替已确定的剧情时间。

⸻

十二、角色身份与同名角色规则

角色姓名不能作为唯一身份标识。

当剧情中出现多个同名角色时，必须结合以下信息判断角色身份：

1. 所属世界 / 平行世界
2. 所属时间线 / 前世今生
3. 当前身份、职业、阵营或其他稳定身份特征
4. 与其他角色的既有关系
5. 首次出现及最近出现的剧情时间
6. 当前场景与剧情上下文

不同世界、不同时间线、不同前世今生身份的同名角色，默认视为不同角色，不得因为姓名相同而合并记忆、关系、经历、状态或物品。

如果无法确定两个同名角色是否为同一人：

* 不得擅自合并；
* 不得把其中一人的经历写入另一人的记忆；
* 不得继承另一人的关系、好感、年龄、身份或状态；
* 应保持角色身份独立，直到剧情明确确认二者为同一人。

只有当剧情明确表明两个同名角色属于同一角色实体时，才允许合并或建立身份关联。

“前世”“今生”“平行世界”“时间穿越”“不同时间节点”等设定，不应自动视为同一角色。

特别注意：

同名 ≠ 同一人。
同名 ≠ 同一身份。
同名 ≠ 同一世界。`;

const defaultSettings = {
    chars: {},       // { [角色+聊天键]: 该聊天的记忆/时间轴/人物等数据 }
    shared: {},      // 全局：屏蔽词 + 屏蔽开关（所有角色、所有聊天共用）
    charPrefs: {},   // { [角色键]: { instructions } }：同一张角色卡的所有聊天共用的指令
};

let globalSettings = null;   // 顶层设置（按角色唯一键分组）
let settings = null;         // 当前角色的数据（便捷引用）
let activeChar = '';         // 当前绑定角色的显示名
let activeCharKey = '';      // 当前绑定角色的唯一键（avatar，同名卡也唯一）
let isSummarizing = false;
let isCompressing = false;   // 压缩聊天历史进行中标记（防连点）
let noCharSettings = null; // 无角色/群组时的临时数据（不入库）
const noCharPrefs = { instructions: [] }; // 无角色/群组时的临时指令（不入库）
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
        compressKeep: 20,       // 压缩聊天历史时保留最近多少条消息
        roundsSinceSummary: 0,  // 距上次总结已过的轮数
        lastSummaryIndex: -1,   // 上次总结到的聊天消息下标（-1=尚未总结），用于跨轮总结窗口不丢剧情
        storyTime: '',          // 当前剧情时间（AI 接力维护，每次总结时更新）
        storyDay: null,         // 结构化时间轴：第X天（null=尚未建立）
        storyPeriod: '',        // 当前时段（深夜/清晨/上午/中午/下午/傍晚/夜晚）
        storyLocation: '',      // 当前地点
        pendingJump: null,      // 待确认的大跨度时间跳跃 { day, period, location, storyTime, event, recollection, from, memIds }（null=无）
        worldState: [],         // 世界状态列表（非人物信息）[{ id, cat: '物品'|'日程', text }]
        entities: [],           // 角色实体 [{ id, name, age, note, world, timeline, identity, body, mind, goal, secret, promise }]（姓名/年龄/简介 + 身份域 + 人物状态）
        autoRegisterEntities: true, // 总结时是否自动把「在场人物」登记进角色实体（默认开）
        pendingEntityAssignments: [], // 待人工确认的同名角色归属 [{ id, name, age, note, world, timeline, identity, body, mind, goal, secret, promise, candidates:[entityId] }]
        relationshipLines: [],  // 情感线/关系轨迹 [{ id, a, b, current:{affection,relationship,attitude}, history:[{id,day,from,to,change,reason,event}] }]
        timeline: [],           // 时间线列表 [{ id, day, time, location, event }]，不断叠加
        checks: [],             // 剧情一致性检查结果 [{ id, type:'time'|'state'|'other', text, day }]
        ignoredChecks: [],      // 用户忽略/删除过的本地时间检查文本（不再重复提示；情况消失后自动清除）
        timeFixLog: [],         // 时间数据修复记录 [{ time, text }]（只记录对结构化时间数据做过的修正，不改模型生成的文本）
        autoFixTime: false,     // 每轮总结后是否自动修复时间数据（默认关：只检测提醒）
        summaryJournal: [],     // 总结回滚日志 [{ idx, sig, snap }]：每次总结前的状态快照，用户重新生成/滑动/删除对应消息时据此回滚
        foreshadows: [],        // 伏笔/未完成事项 [{ id, title, status, note, day }]
        injectForeshadows: false, // 是否把未完成伏笔注入正文提醒模型（默认关，以本地管理为主）
        injectChecks: true,      // 是否把已发现的一致性冲突注入正文提醒模型避免重犯（默认开，验证层闭环）
        worldReminderShown: false, // 长期记忆满 10 的归档提醒是否已弹过（归档后重置）
        worldBook: '',          // 用户选择要注入的世界书名（不一定用角色绑定的那本）
        archivedWorldBook: '',  // 上次归档到哪本世界书（用于「未激活」常驻黄条提醒）
        archiveVectorized: false, // 归档条目是否标记 vectorized（交给酒馆向量存储做语义召回，需 ST 向量存储已启用并配好 embedding 源）
        semanticRecall: {         // 对 Serendipity 自己数据做语义召回注入正文（复用酒馆 embedding 源，独立集合）
            enabled: false,       // 是否注入（默认关，避免默认开启影响现有用户）
            topK: 4,              // 每轮注入条数上限
            charBudget: 1500,     // 每轮注入资料总字数预算（0=不限），先到哪个上限就停
            threshold: 0.25,      // 相似度阈值
            queryTopK: 20,        // 查询候选数（用于本地重要性/时间/角色重排）
            index: { model: '', items: {} }, // 已索引快照 { id: hash }，model=embedding 源签名（变了就全量重建）
        },
    };
}

// 规范化单个角色的数据（补默认值 + 指令结构迁移）
function normalizeCharSettings(cs) {
    if (!cs || typeof cs !== 'object') cs = {};
    for (const key of ['memories', 'longMemories', 'worldState', 'entities', 'relationshipLines', 'timeline', 'checks', 'foreshadows', 'summaryJournal', 'timeFixLog', 'ignoredChecks']) {
        if (!Array.isArray(cs[key])) cs[key] = [];
    }
    cs.ignoredChecks = cs.ignoredChecks.filter(t => typeof t === 'string').slice(-100);
    // 记忆重要度：非 S/A/B 一律归为 ''（未评级，注入时按 B 处理）
    for (const arr of [cs.memories, cs.longMemories]) {
        for (const m of arr) {
            if (m.importance !== 'S' && m.importance !== 'A' && m.importance !== 'B') m.importance = '';
            m.entityRef = typeof m.entityRef === 'string' ? m.entityRef : ''; // 关联角色实体（空=未关联）
        }
    }
    // 旧字段 npcs → entities 一次性迁移（同名角色隔离的数据地基）
    if (Array.isArray(cs.npcs) && cs.npcs.length) {
        cs.entities = cs.npcs.concat(cs.entities);
    }
    delete cs.npcs;
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
        period: typeof e.period === 'string' ? e.period : '',
        origDay: (e.origDay == null || isNaN(e.origDay)) ? null : Number(e.origDay), // 被自动修复前的原始天数
    }));
    cs.timeFixLog = cs.timeFixLog.filter(e => e && typeof e.text === 'string').slice(-30);
    cs.checks = cs.checks.filter(e => e && e.id && typeof e.text === 'string' && e.text.trim()).map(e => ({
        id: e.id,
        type: ['time', 'state', 'other'].includes(e.type) ? e.type : 'other',
        text: e.text,
        day: (e.day == null || isNaN(e.day)) ? null : Number(e.day),
    }));
    cs.foreshadows = cs.foreshadows.filter(e => e && e.id && typeof e.title === 'string' && e.title.trim()).map(e => ({
        id: e.id,
        title: e.title,
        status: FORESHADOW_STATUSES.includes(e.status) ? e.status : '未揭示',
        note: typeof e.note === 'string' ? e.note : '',
        day: (e.day == null || isNaN(e.day)) ? null : Number(e.day),
    }));
    cs.relationshipLines = cs.relationshipLines.filter(e => e && e.id && typeof e.a === 'string' && typeof e.b === 'string' && (e.a.trim() || e.b.trim())).map(e => {
        const cur = (e.current && typeof e.current === 'object') ? e.current : {};
        return {
            id: e.id,
            a: String(e.a),
            b: String(e.b),
            current: {
                affection: typeof cur.affection === 'string' ? cur.affection : (cur.affection == null ? '' : String(cur.affection)),
                relationship: typeof cur.relationship === 'string' ? cur.relationship : '',
                attitude: typeof cur.attitude === 'string' ? cur.attitude : '',
                score: (typeof cur.score === 'number' && isFinite(cur.score)) ? cur.score : null, // 好感累计值（总结只给增减量，这里累加）
            },
            history: (Array.isArray(e.history) ? e.history : []).filter(h => h && h.id).map(h => ({
                id: h.id,
                day: (h.day == null || isNaN(h.day)) ? null : Number(h.day),
                from: typeof h.from === 'string' ? h.from : '',
                to: typeof h.to === 'string' ? h.to : '',
                change: typeof h.change === 'string' ? h.change : '',
                reason: typeof h.reason === 'string' ? h.reason : '',
                event: typeof h.event === 'string' ? h.event : '',
                affection: typeof h.affection === 'string' ? h.affection : '',
            })),
        };
    });
    cs.entities = cs.entities.filter(e => e && e.id && typeof e.name === 'string' && e.name.trim()).map(e => ({
        id: e.id,
        name: String(e.name),
        age: typeof e.age === 'string' ? e.age : (e.age == null ? '' : String(e.age)),
        note: typeof e.note === 'string' ? e.note : '',
        world: typeof e.world === 'string' ? e.world : '',
        timeline: typeof e.timeline === 'string' ? e.timeline : '',
        identity: typeof e.identity === 'string' ? e.identity : '',
        body: typeof e.body === 'string' ? e.body : '',
        mind: typeof e.mind === 'string' ? e.mind : '',
        goal: typeof e.goal === 'string' ? e.goal : '',
        secret: typeof e.secret === 'string' ? e.secret : '',
        promise: typeof e.promise === 'string' ? e.promise : '',
    }));
    // 一次性迁移：把旧世界状态里的「年龄」转成角色实体；「好感/关系」已被关系线取代（丢弃旧扁平条目，需在「人物→关系」里重建）
    if (!cs._relUnified) {
        const remaining = [];
        for (const e of cs.worldState) {
            if (e.cat === '年龄') {
                const m = String(e.text).match(/^(.+?)\s*(\d+)\s*岁/);
                const name = (m ? m[1] : String(e.text)).trim();
                const age = m ? m[2] : '';
                if (name) cs.entities.push({ id: uid(), name, age, note: '', world: '', timeline: '', identity: '' });
            } else if (e.cat === '好感' || e.cat === '关系') {
                continue;
            } else {
                remaining.push(e);
            }
        }
        cs.worldState = remaining;
        cs._relUnified = true;
    }
    // 关系线 a/b 迁移：旧裸名字 → 实体引用（'你' / '@<id>' / 裸名）；幂等（已是引用则原样保留）
    const mapRef = (name) => {
        const n = String(name || '').trim();
        if (!n || n === '你' || n.startsWith('@')) return n || '你';
        const ms = cs.entities.filter(e => e.name === n);
        if (ms.length === 1) return '@' + ms[0].id;
        if (ms.length > 1) return '@' + ms[ms.length - 1].id;
        return n;
    };
    for (const l of cs.relationshipLines) {
        l.a = mapRef(l.a);
        l.b = mapRef(l.b);
    }
    if (cs.injectForeshadows === undefined) cs.injectForeshadows = false;
    if (cs.injectChecks === undefined) cs.injectChecks = true;
    if (cs.autoFixTime === undefined) cs.autoFixTime = false;
    if (cs.autoRegisterEntities === undefined) cs.autoRegisterEntities = true;
    // 待确认同名角色归属：规范化 + 清理失效项（候选实体已删光、或姓名空的丢弃）
    if (!Array.isArray(cs.pendingEntityAssignments)) cs.pendingEntityAssignments = [];
    cs.pendingEntityAssignments = cs.pendingEntityAssignments.filter(p => p && typeof p.name === 'string' && p.name.trim()).map(p => ({
        id: p.id || uid(),
        name: String(p.name),
        age: typeof p.age === 'string' ? p.age : '',
        note: typeof p.note === 'string' ? p.note : '',
        world: typeof p.world === 'string' ? p.world : '',
        timeline: typeof p.timeline === 'string' ? p.timeline : '',
        identity: typeof p.identity === 'string' ? p.identity : '',
        body: typeof p.body === 'string' ? p.body : '',
        mind: typeof p.mind === 'string' ? p.mind : '',
        goal: typeof p.goal === 'string' ? p.goal : '',
        secret: typeof p.secret === 'string' ? p.secret : '',
        promise: typeof p.promise === 'string' ? p.promise : '',
        candidates: Array.isArray(p.candidates) ? p.candidates.filter(c => typeof c === 'string') : [],
    })).filter(p => p.candidates.some(cid => cs.entities.some(e => e.id === cid)));
    if (cs.memoryEnabled === undefined) cs.memoryEnabled = true;
    if (!(cs.summarizeEvery >= 1)) cs.summarizeEvery = 1;
    else cs.summarizeEvery = Math.floor(cs.summarizeEvery);
    cs.roundsSinceSummary = Number(cs.roundsSinceSummary) || 0;
    cs.lastSummaryIndex = (typeof cs.lastSummaryIndex === 'number' && cs.lastSummaryIndex >= 0) ? Math.floor(cs.lastSummaryIndex) : -1;
    cs.compressKeep = (Number(cs.compressKeep) >= 2 && Number(cs.compressKeep) <= 200) ? Math.floor(Number(cs.compressKeep)) : 20;
    if (typeof cs.storyTime !== 'string') cs.storyTime = '';
    if (cs.storyDay === undefined || cs.storyDay === null || isNaN(cs.storyDay)) cs.storyDay = null;
    else cs.storyDay = Number(cs.storyDay);
    if (typeof cs.storyPeriod !== 'string') cs.storyPeriod = '';
    if (typeof cs.storyLocation !== 'string') cs.storyLocation = '';
    {
        const pj = cs.pendingJump;
        if (pj && typeof pj === 'object' && Number.isFinite(Number(pj.day)) && cs.storyDay != null) {
            cs.pendingJump = {
                day: Number(pj.day),
                period: typeof pj.period === 'string' ? pj.period : '',
                location: typeof pj.location === 'string' ? pj.location : '',
                storyTime: typeof pj.storyTime === 'string' ? pj.storyTime : '',
                event: typeof pj.event === 'string' ? pj.event : '',
                recollection: !!pj.recollection,
                from: Number.isFinite(Number(pj.from)) ? Number(pj.from) : cs.storyDay,
                memIds: Array.isArray(pj.memIds) ? pj.memIds.filter(x => typeof x === 'string') : [],
            };
        } else cs.pendingJump = null;
    }
    if (cs.worldReminderShown === undefined) cs.worldReminderShown = false;
    if (typeof cs.worldBook !== 'string') cs.worldBook = '';
    if (typeof cs.archivedWorldBook !== 'string') cs.archivedWorldBook = '';
    if (cs.archiveVectorized === undefined) cs.archiveVectorized = false;
    if (!cs.semanticRecall || typeof cs.semanticRecall !== 'object' || Array.isArray(cs.semanticRecall)) cs.semanticRecall = {};
    cs.semanticRecall = {
        enabled: !!cs.semanticRecall.enabled,
        topK: (Number(cs.semanticRecall.topK) || 4),
        threshold: (cs.semanticRecall.threshold != null ? Number(cs.semanticRecall.threshold) : 0.25),
        queryTopK: (Number(cs.semanticRecall.queryTopK) || 20),
        charBudget: (cs.semanticRecall.charBudget != null && Number(cs.semanticRecall.charBudget) >= 0 ? Number(cs.semanticRecall.charBudget) : 1500),
        index: (cs.semanticRecall.index && typeof cs.semanticRecall.index === 'object' && !Array.isArray(cs.semanticRecall.index))
            ? { model: typeof cs.semanticRecall.index.model === 'string' ? cs.semanticRecall.index.model : '', items: (cs.semanticRecall.index.items && typeof cs.semanticRecall.index.items === 'object') ? cs.semanticRecall.index.items : {} }
            : { model: '', items: {} },
    };
    return cs;
}

// 指令列表规范化（兼容旧版纯字符串条目）
function normalizeInstructions(list) {
    if (!Array.isArray(list)) return [];
    return list.map(it => {
        if (typeof it === 'string') return it.trim() ? { id: uid(), text: it, enabled: true } : null;
        if (it && typeof it === 'object' && typeof it.text === 'string' && it.text.trim()) {
            return { id: typeof it.id === 'string' && it.id ? it.id : uid(), text: it.text, enabled: it.enabled !== false };
        }
        return null;
    }).filter(Boolean);
}

function normalizeWordList(list) {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const w of list) {
        if (typeof w !== 'string') continue;
        const v = w.trim();
        if (v && !out.includes(v)) out.push(v);
    }
    return out;
}

// 全局设置补全：屏蔽词/屏蔽开关（全局共用），指令按角色卡存放
function ensureGlobalPrefs(g) {
    if (!g.chars || typeof g.chars !== 'object' || Array.isArray(g.chars)) g.chars = {};
    if (!g.shared || typeof g.shared !== 'object' || Array.isArray(g.shared)) g.shared = {};
    g.shared.blockedWords = normalizeWordList(g.shared.blockedWords);
    g.shared.censorEnabled = g.shared.censorEnabled !== false;
    if (typeof g.shared.theme !== 'string') g.shared.theme = 'quiet';
    if (!g.charPrefs || typeof g.charPrefs !== 'object' || Array.isArray(g.charPrefs)) g.charPrefs = {};
    return g;
}

function sharedPrefs() { return globalSettings.shared; }
function blockedWordList() { return globalSettings && globalSettings.shared ? globalSettings.shared.blockedWords : []; }
function censorOn() { return !!(globalSettings && globalSettings.shared && globalSettings.shared.censorEnabled); }

// 当前角色卡的指令（读：不存在返回空数组，不产生空条目；写：用 writableInstructions）
function instructionList() {
    if (!activeCharKey) return noCharPrefs.instructions;
    const p = globalSettings.charPrefs[activeCharKey];
    return p && Array.isArray(p.instructions) ? p.instructions : [];
}
function writableInstructions() {
    if (!activeCharKey) return noCharPrefs.instructions;
    let p = globalSettings.charPrefs[activeCharKey];
    if (!p || typeof p !== 'object') p = globalSettings.charPrefs[activeCharKey] = { instructions: [] };
    if (!Array.isArray(p.instructions)) p.instructions = [];
    return p.instructions;
}

// 旧版把屏蔽词/指令/屏蔽开关存在「每个聊天」里，新聊天会重置。这里一次性并入全局/角色级存储（取各聊天的并集），然后删掉旧字段。
// 只处理形如 avatar::/name::/group:: 的键；仍是旧版裸角色名的键留待 activateCharacter 转成唯一键后再迁。
function migrateLegacyPrefs(g) {
    let changed = false;
    let onCount = 0, offCount = 0;
    for (const [key, cs] of Object.entries(g.chars)) {
        if (!cs || typeof cs !== 'object') continue;
        if (!/^(avatar|name|group)::/.test(key)) continue;
        const hasWords = Array.isArray(cs.blockedWords);
        const hasInstr = Array.isArray(cs.instructions);
        const hasFlag = cs.censorEnabled !== undefined;
        if (!hasWords && !hasInstr && !hasFlag) continue;
        if (hasWords) {
            const words = normalizeWordList(cs.blockedWords);
            for (const w of words) if (!g.shared.blockedWords.includes(w)) g.shared.blockedWords.push(w);
            if (words.length) { if (cs.censorEnabled === false) offCount++; else onCount++; }
        }
        if (hasInstr) {
            const charKey = key.replace(/::(chat|integrity)::[\s\S]*$/, '');
            const mine = normalizeInstructions(cs.instructions);
            if (mine.length) {
                let p = g.charPrefs[charKey];
                if (!p || typeof p !== 'object') p = g.charPrefs[charKey] = { instructions: [] };
                p.instructions = normalizeInstructions(p.instructions);
                for (const it of mine) if (!p.instructions.some(x => x.text === it.text)) p.instructions.push(it);
            }
        }
        delete cs.blockedWords;
        delete cs.instructions;
        delete cs.censorEnabled;
        changed = true;
    }
    // 所有带屏蔽词的旧聊天都曾手动关闭屏蔽 → 保持关闭；否则按默认开启
    if (changed && offCount > 0 && onCount === 0 && !g.shared._migrated) g.shared.censorEnabled = false;
    if (changed) g.shared._migrated = true;
    return changed;
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
    // 群聊时 this_chid 为空：用群组 id 作键，避免所有群聊/无角色状态共用同一份数据
    if (this_chid === undefined && selected_group) return 'group::' + selected_group;
    return '';
}

// 当前聊天的唯一标识：ST 用 characters[this_chid].chat（当前聊天文件名，官方唯一标识）区分不同聊天；
// 取不到时退回 chat_metadata.integrity（聊天文件头里的 UUID，同样唯一且稳定）。
function currentChatId() {
    const c = (this_chid !== undefined && Array.isArray(characters) && characters[this_chid]) ? characters[this_chid] : null;
    if (c && typeof c.chat === 'string' && c.chat) return 'chat::' + c.chat;
    const cm = (typeof chat_metadata === 'object' && chat_metadata) ? chat_metadata : null;
    if (cm && cm.integrity) return 'integrity::' + cm.integrity;
    return '';
}

// 数据存储键：角色 + 聊天双维度，同一角色卡的不同聊天界面各自独立、互不串扰
function currentDataKey() {
    const ck = currentCharKey();
    const cid = currentChatId();
    return (ck && cid) ? (ck + '::' + cid) : ck;
}

function charData(key) {
    if (!globalSettings.chars[key]) globalSettings.chars[key] = freshCharSettings();
    return normalizeCharSettings(globalSettings.chars[key]);
}

// 切换到当前角色卡 + 当前聊天的数据（换角色/换聊天即换一套干净/对应的数据）
function activateCharacter() {
    activeChar = currentCharName();
    activeCharKey = currentCharKey();
    // 老版本按 name 存的数据 → 迁到唯一键下（每个角色一次）
    if (activeChar && activeCharKey && globalSettings.chars[activeChar] && !globalSettings.chars[activeCharKey]) {
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
    // 旧版「按角色」存的数据 → 迁到「按角色+聊天」键下；仅当当前聊天有历史才迁，空的新对话不迁（避免旧记忆带进新对话）
    const dataKey = currentDataKey();
    if (dataKey && dataKey !== activeCharKey && !globalSettings.chars[dataKey] && globalSettings.chars[activeCharKey]) {
        const hasHistory = Array.isArray(chat) && chat.some(m => m && typeof m.mes === 'string' && m.mes.trim() && !m.is_system);
        if (hasHistory) {
            globalSettings.chars[dataKey] = normalizeCharSettings(globalSettings.chars[activeCharKey]);
            delete globalSettings.chars[activeCharKey];
            saveSettings();
        }
    }
    if (migrateLegacyPrefs(globalSettings)) saveSettings();
    // 没有任何可用的角色/群组时用一份不入库的临时数据，避免往 chars[''] 写脏条目
    settings = dataKey ? charData(dataKey) : (noCharSettings || (noCharSettings = normalizeCharSettings(freshCharSettings())));
}

function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    const s = extension_settings[extensionName];

    // 摘要 API 与总结 API 合并为一份插件 API：老版本单独的 compressApi 若已配置、而 api 未配置，则并入 api
    if (s.compressApi && s.compressApi.url && s.compressApi.model && !(s.api && s.api.url && s.api.model)) {
        s.api = { ...(s.api || {}), ...s.compressApi };
    }
    delete s.compressApi;

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
    ensureGlobalPrefs(s);
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

// ---------------- 模型调用（只用插件自带 API，未设置就直接报错，绝不回退到聊天 API） ----------------
function getApiCfg() {
    const r = extension_settings[extensionName] || {};
    return r.api || {};
}
function apiConfigured() {
    const c = getApiCfg();
    return !!(c.url && c.model);
}
function apiEndpoint(url) {
    url = String(url || '').trim().replace(/\/+$/, '');
    if (/\/chat\/completions$/i.test(url)) return url;
    return url + '/chat/completions';
}
// 把可能出现在报错里的密钥抹掉（报错会弹 toast / 进控制台，可能被截图或转发）
function redactSecrets(text, key) {
    let t = String(text == null ? '' : text);
    const k = String(key || '').trim();
    if (k.length >= 6) t = t.split(k).join('***');
    return t
        .replace(/Bearer\s+[A-Za-z0-9._~+\/=-]{6,}/gi, 'Bearer ***')
        .replace(/\b(sk|rk|pk|ak|key)-[A-Za-z0-9_*-]{6,}/gi, '$1-***')
        .replace(/([?&](?:key|api[_-]?key|token|access_token)=)[^&\s"']+/gi, '$1***')
        .replace(/("?(?:api[_-]?key|authorization|token)"?\s*[:=]\s*"?)[A-Za-z0-9._~+\/=-]{8,}/gi, '$1***');
}
// 错误文本 → 可安全展示的一小段（去 HTML 标签、折叠空白、抹密钥、截断）
function safeErrorText(e, key, max = 120) {
    const raw = (e && e.message) ? e.message : e;
    const t = redactSecrets(raw, key).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max) + '…' : t;
}
const LLM_TIMEOUT_MS = 120000; // 单次模型调用上限，防止请求挂起导致并发锁永远不释放
async function callCustomApi({ prompt, systemPrompt, cfg }) {
    const c = cfg || getApiCfg();
    const headers = { 'Content-Type': 'application/json' };
    if (c.key) headers.Authorization = 'Bearer ' + c.key.trim();
    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: prompt });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), LLM_TIMEOUT_MS);
    let res;
    try {
        res = await fetch(apiEndpoint(c.url), {
            method: 'POST',
            headers,
            body: JSON.stringify({ model: c.model.trim(), messages, stream: false }),
            signal: ctrl.signal,
        });
    } catch (e) {
        if (e && e.name === 'AbortError') throw new Error('请求超时（' + Math.round(LLM_TIMEOUT_MS / 1000) + ' 秒）');
        throw new Error(safeErrorText(e, c.key) || '网络请求失败');
    } finally {
        clearTimeout(timer);
    }
    if (!res.ok) {
        const t = await res.text().catch(() => '');
        const detail = safeErrorText(t, c.key);
        throw new Error('HTTP ' + res.status + (detail ? ' ' + detail : ''));
    }
    const d = await res.json();
    const out = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
    if (!out) throw new Error('返回内容为空');
    return out;
}
async function callLLM({ prompt, systemPrompt }) {
    if (!apiConfigured()) {
        throw new Error('未配置插件 API（不会回退到聊天 API）');
    }
    return callCustomApi({ prompt, systemPrompt });
}

// ---------------- 记忆功能 ----------------
const TIMELINE_ANCHOR_MAX = 12; // 回传给总结模型的最近时间线条数
const TIMELINE_JUMP_WARN = 3;   // 相邻时间线条目天数跳跃超过该值视为可疑

function buildSummaryPrompt(transcript, userName, charName, storyTime) {
    // 时间锚点：把上一次剧情时间传进去，让模型接力推进，避免每轮孤立猜测导致时间线乱掉
    const timeAnchor = storyTime
        ? '当前剧情时间基准（上一次剧情进行到）：' + storyTime + '。若本段对话没有明确推进时间，请沿用这个时间；若剧情明确推进了时间，请给出推进后的具体时间。对话中仅仅回忆、提及过去的事，不算时间推进。'
        : '请根据本段内容判断剧情发生的大致时间（年/月/日 周几 几时几分）；若内容没有明确的时间信息，写出最接近的大致时间即可，不要虚构精确到分钟的具体时间。';
    // 结构化时间轴锚点（第X天 + 年月日几时几分 + 地点）：让模型接力推进天数，而不是每轮孤立猜测
    const timeAxisAnchor = (settings.storyDay != null)
        ? '当前剧情时间轴：第' + settings.storyDay + '天' + (settings.storyTime ? ' · ' + settings.storyTime : '') + (settings.storyLocation ? ' · ' + settings.storyLocation : '') + '。若本段剧情没有明确推进天数，请沿用第' + settings.storyDay + '天；若明确过了若干天，请给出推进后的天数。不得虚构新的具体时间，不得跳到更晚的天数，也不得退回更早的天数；对话中只是回忆、提及过去某一天的事，当前天数不变。'
        : '请根据本段内容，从故事开始估算当前是「第几天」（第X天），以及当前具体时间（年月日几时几分）和发生地点；若没有明确信息，按最保守的估计写，不要虚构。';
    // 已有时间线锚点：把已发生事件的时间事实回传，禁止模型改写历史事件的发生时间
    const timelineAnchor = settings.timeline.length
        ? '已有剧情时间线（历史时间事实，已经发生，不得改写）：\n' + settings.timeline.slice(-TIMELINE_ANCHOR_MAX).map(t => '- ' + [t.day != null ? '第' + t.day + '天' : '', t.time || '', t.location || '', t.event || ''].filter(Boolean).join(' · ')).join('\n') + '\n规则：1) 上面每条事件的发生时间固定不变，不得把它们重新归入当前日期；2) 当前对话只是提及、回忆旧事件时，该事件仍属于它原来的那一天，不要当成本段新发生的事件，【时间轴】里也不要写成回忆的那一天；3) 【时间】和【时间轴】只描述本段结束时「现在」的进度，只能沿用或向后推进，不能倒退。'
        : '';
    // 世界状态锚点：把当前已知状态回传，让模型增量更新（某类别无变化写「无」），而不是每轮从零重造
    const worldStateAnchor = settings.worldState.length
        ? '当前已知的世界状态（请在此基础上增量更新，某个类别没有新变化就写「无」）：\n' + worldStateLines(worldStateByCat())
        : '请根据本段内容提取当前世界状态（物品/日程），没有的类别写「无」。';
    // 关系线锚点：把当前已知关系线回传，让模型增量追加历史（没有新变化写「无」），不覆盖已有轨迹
    const relationshipAnchor = settings.relationshipLines.length
        ? '当前已知的人物关系线（请在此基础上增量追加；本轮没有明确的关系变化就写「无」；发生冲突时追加新变化，不要改写已有历史；这里的好感是累计总值，【关系变化】里的好感变化只写本轮的增减量）：\n' + relationshipCurrentText()
        : '请关注本段剧情中人物之间关系、好感、态度或情绪是否发生明确变化；没有变化写「无」，不要为了填充而虚构变化。';
    return {
        systemPrompt: [
            '你是剧情记忆助手。请阅读下面这段对话，提取信息并总结。只输出总结本身，不要复述、不要添加任何解释或客套。',
            '',
            timeAnchor,
            '',
            timeAxisAnchor,
            '',
            ...(timelineAnchor ? [timelineAnchor, ''] : []),
            worldStateAnchor,
            '',
            relationshipAnchor,
            '',
            '严格按照以下格式逐行输出（除【时间】外，某项信息未提及时写「无」）：',
            '',
            '【时间】本段结束时「现在」的剧情时间（年/月/日 周几 几时几分；沿用当前时间锚点，没有明确推进就写原时间，不要写「无」）',
            '【天气】天气情况',
            '【在场人物】有哪些人在场',
            '【人物档案】在场各角色的身份与状态信息，每个角色写成「姓名|年龄|简介|世界|时间线|身份|身体|心理|目标|秘密|承诺」一段，多个角色用「；」分隔（世界/时间线/身份用于区分同名角色；身体/心理/目标/秘密/承诺是当前状态，无则写「无」，要清除某项写「空」；年龄/简介/身份域没提到写「无」）',
            '【地点】发生地点/场景',
            '【关键事件】本段发生的关键事件',
            '【角色衣着】' + charName + '的衣着',
            '【用户衣着】' + userName + '的衣着',
            '【物品】出现或获得的物品',
            '【约定/承诺】新产生的约定或承诺',
            '【已完成约定】已完成的约定或承诺',
            '【详细总结】本段对话的详细总结',
            '【重要度】本段剧情的重要度，只写一个字母：S=绝对不能忘（重大转折/死亡/背叛/确认关系/世界规则/重大秘密/主线真相/重要承诺），A=重要剧情（关键事件/重要关系变化/重要道具），B=普通日常；拿不准写 B',
            '【时间轴】本段结束时的剧情进度，严格写成「第X天|地点|本段重要事情」三段（X 是从故事开始算的天数，如「第27天|北境营地|与斥候队长会面」；地点或事情未知写「无」）',
            '【世界状态】当前累计的世界状态，严格写成「类别：内容；类别：内容」单行（类别取：物品/日程，内容用顿号分隔；某类别无内容或未变化写「无」，需要清空某类写「空」）',
            '【关系变化】本轮人物关系是否发生明确变化；没有写「无」，有则严格写成「A→B|变化|变化前|变化后|好感变化|当前态度|原因|事件|第X天」单行（A→B=谁对谁；变化如「好感上升/关系升温/产生信任」；好感变化如「+10」「-5」，写不出写「无」；当前态度写不出写「无」；原因与事件写具体剧情；第X天为该变化发生的剧情天数）',
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

// 「第X天」里的 X：支持阿拉伯数字 / 全角数字 / 中文数字（三、十二、二十三、一百零五）；解析不出返回 null
function parseDayNumber(str) {
    let t = String(str == null ? '' : str).trim().replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
    if (!t) return null;
    if (/^\d+$/.test(t)) { const n = parseInt(t, 10); return n <= 36500 ? n : null; }
    const D = { '零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
    if (!/^[零〇一二两三四五六七八九十百]+$/.test(t)) return null;
    let total = 0, cur = 0;
    for (const ch of t) {
        if (ch in D) cur = D[ch];
        else if (ch === '十') { total += (cur || 1) * 10; cur = 0; }
        else if (ch === '百') { total += (cur || 1) * 100; cur = 0; }
    }
    total += cur;
    return total <= 36500 ? total : null;
}

// 事件描述是不是「回忆/追述」而不是现在发生的场景
const RECOLLECTION_RE = /回忆|回想|想起|忆起|忆及|追忆|闪回|梦见|梦到|梦境/;

// 从总结结果里解析【时间轴】行 → { day, period, location, event, recollection, raw }（解析不出返回 null）
// 时间轴格式已改为「第X天|地点|重要事情」三段；旧版「第X天|时段|地点|重要事情」四段也兼容解析。
function extractTimeAxis(text) {
    const m = String(text).match(/【时间轴】\s*([^\n]+)/);
    if (!m || !m[1]) return null;
    const raw = m[1].trim();
    if (!raw || raw === '无') return null;
    const parts = raw.split(/[|｜]/).map(s => s.trim()).filter(Boolean);
    const dayM = parts[0] && (parts[0].match(/第\s*([0-9０-９零〇一二两三四五六七八九十百]+)\s*天/) || parts[0].match(/\bDay\s*(\d+)/i));
    const day = dayM ? parseDayNumber(dayM[1]) : null;
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
    return { day, period, location, event, recollection: RECOLLECTION_RE.test(event), raw };
}

// 判断新进度天数相对当前天数的走向：backward=倒退 / jump=一次跳过太多天 / ok
function checkTimeAdvance(day) {
    const prev = settings.storyDay;
    if (day == null || prev == null) return { kind: 'ok', prev };
    if (day < prev) return { kind: 'backward', prev };
    if (day - prev > TIMELINE_JUMP_WARN) return { kind: 'jump', prev };
    return { kind: 'ok', prev };
}

// 采用待确认的大跨度跳跃：时间轴推进到该天，补记当时的时间线条目，并把挂起期间写下的记忆改标到新日期
function applyPendingJump() {
    const p = settings.pendingJump;
    if (!p) return;
    settings.pendingJump = null;
    settings.storyDay = p.day;
    if (p.period) settings.storyPeriod = p.period;
    if (p.location) settings.storyLocation = p.location;
    if (p.storyTime) settings.storyTime = p.storyTime;
    if (!p.recollection) pushTimelineEntry(p.day, settings.storyTime, p.location, p.event, p.period);
    for (const m of settings.memories) {
        if (!p.memIds.includes(m.id)) continue;
        m.storyDay = p.day;
        if (p.period) m.storyPeriod = p.period;
        if (p.location) m.storyLocation = p.location;
        if (p.storyTime) m.storyTime = p.storyTime;
    }
}

// 时间线列表：叠加新场景（第X天/年月日几时几分/地点/重要事情）
// 去重：同一天里描述相同的事件只记一次（不只比对最后一条，避免重新总结/回滚重做后出现重复）；返回新增的条目，重复返回 null
function pushTimelineEntry(day, time, location, event, period) {
    if (day == null && !time && !location && !event) return null;
    const norm = t => String(t || '').replace(/\s+/g, '');
    const ev = norm(event);
    const dup = settings.timeline.some(e => e.day === day && (ev
        ? norm(e.event) === ev
        : (e.time === time && e.location === location && !e.event)));
    if (dup) return null;
    const entry = { id: uid(), day, time, location, event, period: period || '', origDay: null };
    settings.timeline.push(entry);
    return entry;
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

// 把当前关系线渲染成紧凑文本（供总结锚点与正文注入复用）
function relationshipCurrentText() {
    return settings.relationshipLines.map(l =>
        resolveEntityRef(l.a).display + '→' + resolveEntityRef(l.b).display + '：关系 ' + (l.current.relationship || '未知')
        + (l.current.affection ? '，好感 ' + l.current.affection : '')
        + (l.current.attitude ? '，态度 ' + l.current.attitude : '')
    ).join('\n');
}

// 角色实体字段分两类：稳定字段（年龄/简介/身份域，只补空、不覆盖）；状态字段（身体/心理/目标/秘密/承诺，快照式：非空替换、「空」清空、「无」保留）
const ENTITY_STABLE_FIELDS = ['age', 'note', 'world', 'timeline', 'identity'];
const ENTITY_STATE_FIELDS = ['body', 'mind', 'goal', 'secret', 'promise'];

// 角色实体渲染成紧凑文本（供正文注入复用；身份域非空时拼成「世界·时间线·身份」标签）
function entityDomain(n) {
    return [n.world, n.timeline, n.identity].filter(Boolean).join('·');
}
// 关系线引用解析：'你' → 用户；'@<entityId>' → 实体；裸字符串 → 未登记名字（尽量按名匹配唯一实体以带上身份域）
function resolveEntityRef(ref) {
    const r = typeof ref === 'string' ? ref : '';
    if (r.startsWith('@')) {
        const id = r.slice(1);
        const e = settings.entities.find(x => x.id === id);
        if (e) {
            const domain = entityDomain(e);
            return { name: e.name, display: e.name + (domain ? '（' + domain + '）' : ''), entityId: id };
        }
        return { name: r, display: r, entityId: '' };
    }
    const matches = settings.entities.filter(e => e.name === r);
    if (matches.length === 1) {
        const domain = entityDomain(matches[0]);
        return { name: r, display: r + (domain ? '（' + domain + '）' : ''), entityId: matches[0].id };
    }
    return { name: r, display: r, entityId: '' };
}
// 名字 → 关系线引用（总结解析/手动建立时用）：'你' 保留；唯一同名 → 该实体；多个同名 → 取最新（第 3 步再做智能识别）；无实体 → 保留裸名
function nameToRef(name) {
    const n = String(name || '').trim();
    if (!n || n === '你') return '你';
    const ms = settings.entities.filter(e => e.name === n);
    if (ms.length === 1) return '@' + ms[0].id;
    if (ms.length > 1) return '@' + ms[ms.length - 1].id;
    return n;
}
// 记忆按角色挂靠：文本里出现且只出现一个实体的名字 → 关联该实体；多个名字/同名多个 → 留空（避免误挂）
function inferMemoryEntity(text) {
    const t = String(text || '');
    const hits = settings.entities.filter(e => e.name && t.includes(e.name));
    return hits.length === 1 ? hits[0].id : '';
}
function npcText() {
    return settings.entities.map(n => n.name
        + (entityDomain(n) ? '（' + entityDomain(n) + '）' : '')
        + (n.age ? '，' + n.age + '岁' : '')
        + (n.note ? '，' + n.note : '')
        + (n.goal ? '；目标：' + n.goal : '')
        + (n.secret ? '；秘密：' + n.secret : '')
        + (n.promise ? '；承诺：' + n.promise : '')).join('\n');
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

// ---------------- 情感线 / 关系轨迹 ----------------
// 从总结结果里解析【关系变化】行 → { a, b, change, from, to, affection, attitude, reason, event, day }（无变化/解析失败返回 null）
// 格式：A→B|变化|变化前|变化后|好感变化|当前态度|原因|事件|第X天
function extractRelationshipChange(text) {
    const m = String(text).match(/【关系变化】\s*([^\n]+)/);
    if (!m || !m[1]) return null;
    const raw = m[1].trim();
    if (!raw || raw === '无') return null;
    const p = raw.split(/[|｜]/).map(s => s.trim());
    const pair = (p[0] || '').split(/→|->|➜|⟶/).map(s => s.trim()).filter(Boolean);
    if (pair.length < 2) return null;
    const dayM = (p[8] || '').match(/第\s*(\d+)\s*天/);
    const clean = (idx) => {
        const v = p[idx];
        return (v && v !== '无' && v !== '未知') ? v : '';
    };
    return {
        a: pair[0],
        b: pair[1],
        change: clean(1),
        from: clean(2),
        to: clean(3),
        affection: clean(4),
        attitude: clean(5),
        reason: clean(6),
        event: clean(7),
        day: dayM ? parseInt(dayM[1], 10) : null,
    };
}

// 找到（或新建）一条 A→B 的关系线（方向敏感：A 对 B）
function findRelationshipLine(a, b) {
    let line = settings.relationshipLines.find(l => l.a === a && l.b === b);
    if (!line) {
        line = { id: uid(), a, b, current: { affection: '', relationship: '', attitude: '' }, history: [] };
        settings.relationshipLines.push(line);
    }
    return line;
}

// 追加关系变化：历史只追加不改写；current 更新为最新状态
function applyRelationshipChange(ch) {
    if (!ch || !ch.a || !ch.b) return;
    const line = findRelationshipLine(nameToRef(ch.a), nameToRef(ch.b));
    if (ch.to) line.current.relationship = ch.to;
    // 好感：总结给的是本轮增减量（如 +10 / -5），累加成总好感；写不成数字的文字描述则直接作为当前好感
    if (ch.affection) {
        const dm = String(ch.affection).replace(/[＋]/g, '+').replace(/[－−–]/g, '-').match(/^\s*([+-]?\d+)\s*(?:点|分)?\s*$/);
        if (dm) {
            if (line.current.score == null) {
                const base = parseInt(String(line.current.affection).replace(/[＋]/g, '+').replace(/[－−–]/g, '-'), 10);
                line.current.score = isNaN(base) ? 0 : base;
            }
            line.current.score = Math.max(-100, Math.min(100, line.current.score + parseInt(dm[1], 10)));
            line.current.affection = (line.current.score > 0 ? '+' : '') + line.current.score;
        } else {
            line.current.affection = ch.affection;
            line.current.score = null;
        }
    }
    if (ch.attitude) line.current.attitude = ch.attitude;
    line.history.push({
        id: uid(),
        day: (ch.day != null) ? ch.day : settings.storyDay,
        from: ch.from,
        to: ch.to,
        change: ch.change,
        reason: ch.reason,
        event: ch.event,
        affection: ch.affection || '',
    });
}

// ---------------- 角色实体自动登记 ----------------
// 从总结结果里解析【在场人物】行 → 名字数组（过滤代词/无意义指称）
const ENTITY_PRONOUNS = new Set(['你', '我', '他', '她', '它', '你们', '我们', '他们', '她们', '大家', '众人', '自己', '某人', '路人', '群众', '主角', '那个人', '那个男人', '那个女人', '这位', '那位']);
function extractPresentChars(text) {
    const m = String(text).match(/【在场人物】\s*([^\n]+)/);
    if (!m || !m[1]) return [];
    const raw = m[1].trim();
    if (!raw || raw === '无') return [];
    return raw.split(/[、，,；;\s]+/)
        .map(s => s.replace(/^[「『"']+|[」』"']+$/g, '').trim())
        .filter(Boolean)
        .filter(name => !ENTITY_PRONOUNS.has(name));
}
// 把名字登记为角色实体（身份域留空；同名已存在则不重复，不自动拆分同名）
function registerEntities(names) {
    if (!Array.isArray(names)) return;
    for (const name of names) {
        if (!name) continue;
        if (settings.entities.some(e => e.name === name)) continue;
        settings.entities.push({ id: uid(), name, age: '', note: '', world: '', timeline: '', identity: '', body: '', mind: '', goal: '', secret: '', promise: '' });
    }
}
// 从总结结果里解析【重要度】行 → 'S' | 'A' | 'B'（解析失败/非 S/A 默认 'B'）
function extractImportance(text) {
    const m = String(text).match(/【重要度】\s*([^\n]+)/);
    if (!m || !m[1]) return 'B';
    const v = m[1].trim().toUpperCase().replace(/[^SAB]/g, '');
    return (v === 'S' || v === 'A') ? v : 'B';
}
// 从总结结果里解析【人物档案】行 → [{ name, age, note, world, timeline, identity, body, mind, goal, secret, promise }]（过滤代词/空名/「无」；「空」保留为清除标记）
function extractEntityInfos(text) {
    const m = String(text).match(/【人物档案】\s*([^\n]+)/);
    if (!m || !m[1]) return [];
    const raw = m[1].trim();
    if (!raw || raw === '无') return [];
    const FIELDS = ['name', 'age', 'note', 'world', 'timeline', 'identity', 'body', 'mind', 'goal', 'secret', 'promise'];
    const infos = [];
    for (const seg of raw.split(/[；;]+/)) {
        const parts = seg.split(/[|｜]/).map(s => s.replace(/^[「『"']+|[」』"']+$/g, '').trim());
        const info = {};
        for (let i = 0; i < FIELDS.length; i++) {
            const v = (parts[i] || '').trim();
            info[FIELDS[i]] = (v === '空') ? '空' : ((v && v !== '无' && v !== '未知') ? v : '');
        }
        const name = String(info.name || '').trim();
        if (!name || ENTITY_PRONOUNS.has(name)) continue;
        infos.push(info);
    }
    return infos;
}
// 身份域匹配得分：逐字段（世界/时间线/身份）比较，score=双方都非空且完全一致的字段数，overlap=双方都非空的字段数
function entityDomainScore(a, b) {
    let score = 0, overlap = 0;
    for (const f of ['world', 'timeline', 'identity']) {
        const av = String(a[f] || '').trim();
        const bv = String(b[f] || '').trim();
        if (av && bv) {
            overlap++;
            if (av === bv) score++;
        }
    }
    return { score, overlap };
}
// 从一条人物信息构建全新实体（「空」/空值都归一为 ''）
function entityFromInfo(name, info) {
    const clean = v => (v && v !== '空') ? v : '';
    return {
        id: uid(), name,
        age: clean(info.age), note: clean(info.note),
        world: clean(info.world), timeline: clean(info.timeline), identity: clean(info.identity),
        body: clean(info.body), mind: clean(info.mind), goal: clean(info.goal), secret: clean(info.secret), promise: clean(info.promise),
    };
}
// 合并一条人物信息到实体：稳定字段只补空、不覆盖手填；状态字段快照式（非空替换、「空」清空、「无」保留）
function applyEntityInfo(e, info) {
    for (const k of ENTITY_STABLE_FIELDS) {
        if (!e[k] && info[k] && info[k] !== '空') e[k] = info[k];
    }
    for (const k of ENTITY_STATE_FIELDS) {
        if (info[k] === '空') e[k] = '';
        else if (info[k]) e[k] = info[k];
    }
}
// 把人物档案信息合并进角色实体：
//   新名字 → 新建实体；
//   唯一同名 → 先比身份域：双方都有的域全部一致或有一方没给域 → 合并（稳定字段补空、状态字段快照替换）；域完全不同 → 新建独立实体；部分一致部分冲突 → 排队待人工确认；
//   同名多个 → 按身份域（世界/时间线/身份）匹配：唯一最佳命中 → 合并；无任何命中但模型给了身份域 → 默认新建独立实体；并列最高分或没给身份域 → 排队待人工确认
function mergeEntityInfos(infos) {
    if (!Array.isArray(infos)) return;
    for (const info of infos) {
        const name = String(info.name || '').trim();
        if (!name) continue;
        const matches = settings.entities.filter(e => e.name === name);
        if (matches.length === 0) {
            settings.entities.push(entityFromInfo(name, info));
        } else if (matches.length === 1) {
            const { score, overlap } = entityDomainScore(info, matches[0]);
            if (overlap === 0 || score === overlap) applyEntityInfo(matches[0], info);
            else if (score === 0) settings.entities.push(entityFromInfo(name, info));
            else queueEntityAssignment(info, matches);
        } else {
            // 同名多个：按身份域找唯一最佳归属
            let best = null, bestScore = 0, unique = true;
            for (const e of matches) {
                const s = entityDomainScore(info, e).score;
                if (s > bestScore) { bestScore = s; best = e; unique = true; }
                else if (s === bestScore && s > 0) unique = false;
            }
            if (best && bestScore >= 1 && unique) {
                applyEntityInfo(best, info);
            } else if (bestScore === 0 && (info.world || info.timeline || info.identity)) {
                // 无任何命中、但模型给了身份域：默认新建独立实体（域不同即不同人）
                settings.entities.push(entityFromInfo(name, info));
            } else {
                // 并列最高分、或模型没给身份域：无法确定归属，排队待人工确认
                queueEntityAssignment(info, matches);
            }
        }
    }
}
// 排队待人工确认的同名角色归属（同名已有未处理项则去重，不重复排队）
function queueEntityAssignment(info, matches) {
    if (settings.pendingEntityAssignments.some(p => p.name === info.name)) return;
    settings.pendingEntityAssignments.push({
        id: uid(),
        name: info.name,
        age: info.age || '', note: info.note || '',
        world: info.world || '', timeline: info.timeline || '', identity: info.identity || '',
        body: info.body || '', mind: info.mind || '', goal: info.goal || '', secret: info.secret || '', promise: info.promise || '',
        candidates: matches.map(e => e.id),
    });
}

// ---------------- 剧情一致性检查 ----------------
// 本地（免费、不调模型）时间冲突启发式：时间线/记忆里出现「第N天」晚于当前天 → 时间倒退/超前冲突
// 两条时间线之间的空档（prev 与 day 之间不含两端）里，有没有任何时间线事件或记忆覆盖
function gapHasRecord(prev, day) {
    for (let d = prev + 1; d < day; d++) {
        const { facts, memCount } = dayFacts(d);
        if (facts.length || memCount) return true;
    }
    return false;
}
function localConsistencyCheck() {
    const items = [];
    const cur = settings.storyDay;
    if (cur == null) return items;
    const seen = new Set();
    let prev = null;
    for (const e of settings.timeline) {
        if (e.day == null) continue;
        if (prev != null && e.day < prev) {
            const text = '时间线出现倒退：「第' + e.day + '天」' + (e.event ? '（' + e.event + '）' : '') + '排在「第' + prev + '天」之后，可能是回忆被记成了当前进度';
            if (!seen.has(text)) { seen.add(text); items.push({ type: 'time', text }); }
        } else if (prev != null && e.day - prev > TIMELINE_JUMP_WARN && !gapHasRecord(prev, e.day)) {
            const text = '时间线从「第' + prev + '天」直接跳到「第' + e.day + '天」' + (e.event ? '（' + e.event + '）' : '') + '，中间缺了' + (e.day - prev - 1) + '天';
            if (!seen.has(text)) { seen.add(text); items.push({ type: 'time', text }); }
        }
        prev = e.day;
    }
    for (const e of settings.timeline) {
        if (e.day != null && e.day > cur) {
            const text = '时间线记录到「第' + e.day + '天」' + (e.event ? '（' + e.event + '）' : '') + '，但当前剧情才进行到第' + cur + '天';
            if (!seen.has(text)) { seen.add(text); items.push({ type: 'time', text }); }
        }
    }
    // 最新一条 AI 回复里的相对时间（昨天/前天/N天前）→ 换算成第几天 → 对照时间轴有没有那天的记录
    const lastMsg = Array.isArray(chat) ? chat[chat.length - 1] : null;
    if (lastMsg && !lastMsg.is_user && !lastMsg.is_system && typeof lastMsg.mes === 'string' && settings.timeline.length) {
        const firstDay = Math.min(...settings.timeline.filter(e => e.day != null).map(e => e.day), cur);
        for (const r of parseRelativeDayRefs(lastMsg.mes)) {
            const target = cur + r.offset;
            if (target < 0 || target < firstDay) {
                const text = '文中提到「' + r.word + '」（对应第' + target + '天），早于时间轴记录的起点（第' + firstDay + '天），请确认';
                if (!seen.has(text)) { seen.add(text); items.push({ type: 'time', text }); }
                continue;
            }
            const { facts, memCount } = dayFacts(target);
            if (!facts.length && !memCount) {
                const text = '文中提到「' + r.word + '」（对应第' + target + '天），但时间轴和记忆里没有那天的记录，请确认是否真有此事';
                if (!seen.has(text)) { seen.add(text); items.push({ type: 'time', text }); }
            }
        }
    }
    for (const arr of [settings.memories, settings.longMemories]) {
        for (const m of arr) {
            if (m.storyDay != null && m.storyDay > cur) {
                const text = '记忆里有「第' + m.storyDay + '天」的内容，但当前剧情才进行到第' + cur + '天';
                if (!seen.has(text)) { seen.add(text); items.push({ type: 'time', text }); }
            }
        }
    }
    return items;
}

// ---------------- 时间数据修复（只修结构化时间数据，绝不改写模型生成的文本；每次修正都留记录） ----------------
function logTimeFix(text) {
    settings.timeFixLog.push({ time: Date.now(), text });
    if (settings.timeFixLog.length > 30) settings.timeFixLog.splice(0, settings.timeFixLog.length - 30);
}

// 修复规则：① 同一天里重复的时间线事件只留一条；② 超过当前天数的时间线/记忆天数压回当前天数（保留原始值）；
// ③ 记忆缺天数时，按剧情时间和时间线对上号补回。返回修复条数
function repairTimeData() {
    const cur = settings.storyDay;
    let n = 0;
    const norm = t => String(t || '').replace(/\s+/g, '');
    const keys = new Set();
    const kept = [];
    for (const e of settings.timeline) {
        const k = e.day + '|' + (norm(e.event) || (e.time + '|' + e.location));
        if (keys.has(k)) { n++; logTimeFix('删除重复的时间线条目：' + (e.day != null ? '第' + e.day + '天 ' : '') + (e.event || e.time || e.location)); continue; }
        keys.add(k);
        kept.push(e);
    }
    settings.timeline = kept;
    if (cur != null) {
        for (const e of settings.timeline) {
            if (e.day != null && e.day > cur) {
                logTimeFix('时间线条目「' + (e.event || e.time || '') + '」从第' + e.day + '天压回当前第' + cur + '天');
                e.origDay = e.day; e.day = cur; n++;
            }
        }
        for (const arr of [settings.memories, settings.longMemories]) {
            for (const m of arr) {
                if (m.storyDay != null && m.storyDay > cur) {
                    logTimeFix('一条记忆的天数从第' + m.storyDay + '天压回当前第' + cur + '天');
                    m.storyDay = cur; if (m.dayTo != null && m.dayTo > cur) m.dayTo = cur; if (m.dayFrom != null && m.dayFrom > cur) m.dayFrom = cur; n++;
                }
            }
        }
    }
    for (const arr of [settings.memories, settings.longMemories]) {
        for (const m of arr) {
            if (m.storyDay != null || !m.storyTime) continue;
            const hit = settings.timeline.find(e => e.day != null && e.time === m.storyTime);
            if (hit) { m.storyDay = hit.day; logTimeFix('按剧情时间「' + m.storyTime + '」给一条记忆补上第' + hit.day + '天'); n++; }
        }
    }
    return n;
}

function runTimeRepair(manual) {
    const n = repairTimeData();
    if (n) {
        saveSettings();
        refreshLocalChecks();
        updatePromptInjection();
        renderMemories();
        renderTimeAxis();
        if (manual) toastr.success('已修复 ' + n + ' 处时间数据（详情见控制台 / 修复记录）');
    } else if (manual) {
        toastr.info('时间数据没有发现需要修复的地方');
    }
    return n;
}

// 解析模型一致性检查输出 → [{ type, text }]
function parseChecks(text) {
    const items = [];
    const s = String(text || '').trim();
    if (!s || s === '无' || s === '无冲突') return items;
    for (const rawLine of s.split(/\n/)) {
        const line = rawLine.replace(/^[-*•·\d.、)\s]+/, '').trim();
        if (!line || line === '无') continue;
        const m = line.match(/^(时间冲突|状态冲突|其他)\s*[：:]\s*(.+)$/);
        let type = 'other', desc = line;
        if (m) {
            type = m[1] === '时间冲突' ? 'time' : (m[1] === '状态冲突' ? 'state' : 'other');
            desc = m[2].trim();
        }
        if (!desc) continue;
        items.push({ type, text: desc });
    }
    return items;
}

// 每次总结后刷新本地（免费）时间冲突检查，合并进现有结果：本地项重算，AI 的状态冲突项保留
// 本地检查结果去掉用户已忽略的；已忽略但当前不再出现的条目顺手清掉（情况消失后再出现时视为新问题）
function activeLocalChecks() {
    const all = localConsistencyCheck();
    const texts = new Set(all.map(i => i.text));
    settings.ignoredChecks = settings.ignoredChecks.filter(t => texts.has(t));
    const ign = new Set(settings.ignoredChecks);
    return all.filter(i => !ign.has(i.text));
}
function ignoreLocalChecks(items) {
    for (const c of items) {
        if (c.type === 'time' && !settings.ignoredChecks.includes(c.text)) settings.ignoredChecks.push(c.text);
    }
    if (settings.ignoredChecks.length > 100) settings.ignoredChecks.splice(0, settings.ignoredChecks.length - 100);
}
function refreshLocalChecks() {
    const aiItems = settings.checks.filter(c => c.type !== 'time');
    const merged = [];
    const seen = new Set();
    for (const it of [...aiItems, ...activeLocalChecks()]) {
        if (seen.has(it.text)) continue;
        seen.add(it.text);
        merged.push(it);
    }
    settings.checks = merged.slice(0, 20).map(t => ({ id: t.id || uid(), type: t.type, text: t.text, day: settings.storyDay }));
    saveSettings();
    renderChecks();
}

// 手动「立即检查」：调一次模型，对照时间轴/时间线/世界状态/记忆排查矛盾（不往每轮正文里塞）
async function runConsistencyCheck() {
    if (isSummarizing) return; // 复用并发锁，防止连点/与总结抢跑
    if (!apiConfigured()) { toastr.warning('请先在「记忆」页配置插件 API（一致性检查不回退聊天 API）'); return; }
    activateCharacter();
    const keyBefore = currentDataKey();
    const stBefore = settings;
    isSummarizing = true;
    toastr.info('正在检查剧情一致性…', undefined, { timeOut: 1500 });
    try {
        const anchor = '当前剧情时间轴：第' + (settings.storyDay != null ? settings.storyDay : '?') + '天'
            + (settings.storyTime ? ' · ' + settings.storyTime : '') + (settings.storyLocation ? ' · ' + settings.storyLocation : '');
        const tlLines = settings.timeline.length
            ? settings.timeline.map(e => '第' + (e.day != null ? e.day : '?') + '天' + (e.time ? ' ' + e.time : '') + (e.location ? ' ' + e.location : '') + (e.event ? '：' + e.event : '')).join('\n')
            : '（暂无时间线）';
        const worldLines = settings.worldState.length ? worldStateLines(worldStateByCat()) : '（暂无世界状态）';
        const memLines = [...settings.longMemories, ...settings.memories]
            .map(m => (m.storyTime ? m.storyTime + '：' : '') + m.text)
            .slice(-30).join('\n\n') || '（暂无记忆）';
        const systemPrompt = [
            '你是剧情一致性检查员。请对比「当前时间轴」与「已有时间线/世界状态/记忆」，找出剧情中的矛盾冲突。只输出冲突清单，确实没有就只输出「无」。',
            '',
            anchor,
            '',
            '已有时间线：\n' + tlLines,
            '',
            '当前世界状态：\n' + worldLines,
            '',
            '近期记忆：\n' + memLines,
            '',
            '逐行输出发现的冲突，格式「类型：描述」，类型取「时间冲突」「状态冲突」「其他」。示例：「时间冲突：记忆里第12天发生的事，但当前才第10天」「状态冲突：林昭第8天已离开京城，第10天却仍在京城」。最多列 10 条，确实没有就只写「无」。',
        ].join('\n');
        const result = await callLLM({ prompt: '请给出剧情一致性检查结果。', systemPrompt });
        if (currentDataKey() !== keyBefore || settings !== stBefore) { console.warn('[Serendipity] 检查期间切换了聊天，结果已丢弃'); return; }
        const merged = [];
        const seen = new Set();
        for (const it of [...parseChecks(result), ...activeLocalChecks()]) {
            if (seen.has(it.text)) continue;
            seen.add(it.text);
            merged.push(it);
        }
        settings.checks = merged.slice(0, 20).map(t => ({ id: uid(), type: t.type, text: t.text, day: settings.storyDay }));
        saveSettings();
        renderChecks();
        updatePromptInjection();
        toastr.success(settings.checks.length ? ('发现 ' + settings.checks.length + ' 处剧情冲突，见「检查」页') : '未发现剧情冲突');
    } catch (e) {
        console.error('[Serendipity] 一致性检查失败：', e);
        toastr.error('一致性检查失败');
    } finally {
        isSummarizing = false;
    }
}

// 把一组记忆合并成一段文本（带序号），用于晋级时“清空并总结”
const LONG_MEMORY_TARGET = 900; // 压缩后长期记忆的目标字数
const MEMORY_INJECT_MAX = 6000; // 记忆注入正文的字数预算
// 去掉对长期保存没意义的行（天气/衣着/重要度）；短期记忆原样注入，衣着在近期还有连续性价值
function stripMemoryNoise(text) {
    return String(text || '').replace(/^【(?:天气|角色衣着|用户衣着|重要度)】[^\n]*\n?/gm, '').trim();
}
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

// 记忆覆盖的天数范围 [起, 止]：短期记忆是单个时刻（起=止），长期记忆是合并来的区间
function memDayRange(m) {
    if (!m) return [null, null];
    const to = (m.dayTo != null) ? m.dayTo : (m.storyDay != null ? m.storyDay : null);
    const from = (m.dayFrom != null) ? m.dayFrom : to;
    return [from, to];
}
function memDayLabel(m) {
    const [f, t] = memDayRange(m);
    if (f == null && t == null) return '';
    return (f != null && t != null && f !== t) ? '第' + f + '–' + t + '天' : '第' + (t != null ? t : f) + '天';
}

// 记忆晋级：短期满 10 → 合并入长期并清空短期（长期不再自动晋级，满 10 时提醒归档到世界书）
// 返回本次是否触发了晋级，供总结弹窗提示
function promoteMemories() {
    let toLong = false;
    if (settings.memories.length >= TIER_LIMIT) {
        // 合并后的条目沿用「最新一条」的剧情时间与时间轴，保持时间线可读
        const last = settings.memories[settings.memories.length - 1];
        const lastStoryTime = last.storyTime || settings.storyTime || '';
        const imp = settings.memories.some(m => m.importance === 'S') ? 'S' : (settings.memories.some(m => m.importance === 'A') ? 'A' : 'B');
        // 合并条目：只有当这一批短期记忆全部挂靠同一个角色时才带上该关联，混合多角色则留空（归「剧情整体」）
        const refs = [...new Set(settings.memories.map(m => m.entityRef || '').filter(Boolean))];
        const entityRef = refs.length === 1 ? refs[0] : '';
        const longId = uid();
        const sources = settings.memories.slice();
        settings.longMemories.push({ id: longId, time: Date.now(), storyTime: lastStoryTime, storyDay: last.storyDay, dayFrom: memDayRange(settings.memories[0])[0], dayTo: memDayRange(last)[1], storyPeriod: last.storyPeriod, storyLocation: last.storyLocation, importance: imp, entityRef: entityRef, text: mergeEntries(settings.memories) });
        settings.memories = [];
        saveSettings();
        return { toLong: true, longId, sources };
    }
    return { toLong: false };
}

// 长期记忆压缩：晋级时只是把 10 条原文拼接，这里让模型合并成一段精炼文本，避免长期记忆越攒越长。
// 失败/结果不合格就保留拼接原文；压缩前的原文留在 rawText 里
async function compressLongMemory(longId, sources, key, st) {
    if (!longId || !Array.isArray(sources) || sources.length < 2) return;
    const input = sources.map((m, i) => '(' + (i + 1) + ') 【' + [memDayLabel(m), m.storyTime, m.storyLocation].filter(Boolean).join(' · ') + '】\n' + stripMemoryNoise(m.text)).join('\n\n');
    const orig = mergeEntries(sources);
    try {
        const out = await callLLM({
            prompt: input,
            systemPrompt: [
                '你是剧情记忆压缩助手。下面是按时间顺序排列的若干段剧情记忆，请合并成一段连贯、精炼的「长期记忆」。',
                '必须保留：每件事发生在第几天/什么时间/什么地点、人物之间的关系与好感变化、约定与承诺（含是否完成）、重要物品的得失、重大转折与秘密。',
                '可以删去：天气、衣着等琐碎描写，以及重复表述。按时间顺序写，事件不要合并成含糊的「期间」。',
                '只输出压缩后的正文，不要标题、解释、序号。控制在 ' + LONG_MEMORY_TARGET + ' 字以内。',
            ].join('\n'),
        });
        const text = String(out || '').replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').trim();
        if (currentDataKey() !== key || settings !== st) return;
        const m = settings.longMemories.find(x => x.id === longId);
        if (!m || m.rawText) return;
        if (text.length < 80 || text.length > orig.length * 0.9) return; // 太短像拒答、没变短就没意义
        m.rawText = m.text;
        m.text = text;
        saveSettings();
        updatePromptInjection();
        renderMemories();
        scheduleSemanticSync();
    } catch (e) {
        console.warn('[Serendipity] 长期记忆压缩失败，保留原文：', e);
    }
}

// ---------------- 重新生成/滑动/删除 → 记忆回滚 ----------------
// 每次总结前给「会被总结改动的状态」拍快照，连同被总结的那条 AI 消息的签名存进日志；
// 之后若那条消息被重新生成 / 滑动换版本 / 删除，就回滚到快照，让下一次总结按新内容重做
const JOURNAL_MAX = 3;
const JOURNAL_KEYS = ['storyTime', 'storyDay', 'storyPeriod', 'storyLocation', 'pendingJump', 'memories', 'longMemories', 'timeline', 'worldState', 'entities', 'pendingEntityAssignments', 'relationshipLines', 'lastSummaryIndex'];

function messageSig(m) {
    if (!m) return '';
    return [m.gen_started || '', m.send_date || '', m.swipe_id == null ? 0 : m.swipe_id].join('|');
}
function takeStateSnapshot() {
    const snap = {};
    for (const k of JOURNAL_KEYS) snap[k] = JSON.parse(JSON.stringify(settings[k] === undefined ? null : settings[k]));
    return snap;
}
function pushSummaryJournal(idx, snap, sig) {
    settings.summaryJournal.push({ idx, sig: sig != null ? sig : messageSig(chat[idx]), snap });
    if (settings.summaryJournal.length > JOURNAL_MAX) settings.summaryJournal.splice(0, settings.summaryJournal.length - JOURNAL_MAX);
}
// 对照当前聊天：日志里被总结过的消息不在了/被换了 → 回滚到最早失效条目的快照，返回是否发生回滚
function reconcileWithChat() {
    if (!settings || isSummarizing || !Array.isArray(chat) || !chat.length) return false;
    const j = settings.summaryJournal;
    if (!Array.isArray(j) || !j.length) return false;
    const bad = j.findIndex(e => !chat[e.idx] || messageSig(chat[e.idx]) !== e.sig);
    if (bad < 0) return false;
    const snap = j[bad].snap;
    for (const k of JOURNAL_KEYS) {
        if (snap[k] !== undefined) settings[k] = JSON.parse(JSON.stringify(snap[k]));
    }
    settings.summaryJournal = j.slice(0, bad);
    settings.roundsSinceSummary = Math.max(0, (settings.summarizeEvery || 1) - 1); // 下一次生成结束立即重新总结
    refreshLocalChecks();
    updatePromptInjection();
    renderMemories();
    renderTimeAxis();
    renderPeople();
    toastr.info('检测到消息被重新生成/删除，已回滚对应的记忆与时间轴，将按新内容重新总结');
    return true;
}

// 水位线之后是否出现了新的 AI 回复（越界视为有，交给总结去修正水位线）
function hasUnsummarizedChat() {
    if (!Array.isArray(chat) || chat.length < 2) return false;
    const w = settings.lastSummaryIndex;
    if (w == null || w < 0 || w >= chat.length) return true;
    for (let i = chat.length - 1; i > w; i--) {
        const m = chat[i];
        if (m && !m.is_user && !m.is_system && typeof m.mes === 'string' && m.mes.trim()) return true;
    }
    return false;
}

const SUMMARY_TRANSCRIPT_MAX = 16000; // 单次总结发给模型的对话字数上限
const SUMMARY_FAIL_LIMIT = 3;         // 同一聊天连续失败这么多次后跳过这段对话，避免永远卡在同一段
const summaryFailStreak = {};
function noteSummaryFailure(st, key, lastIdx) {
    summaryFailStreak[key] = (summaryFailStreak[key] || 0) + 1;
    if (summaryFailStreak[key] < SUMMARY_FAIL_LIMIT) return;
    summaryFailStreak[key] = 0;
    st.lastSummaryIndex = lastIdx;
    saveSettings();
    toastr.warning('连续 ' + SUMMARY_FAIL_LIMIT + ' 次总结失败，已跳过这段对话以免一直卡住；请检查插件 API（见「记忆」页）', undefined, { timeOut: 10000 });
}

async function summarizeLastRound() {
    activateCharacter(); // 每次总结前重新绑定到当前角色，避免切换角色后总结写错档
    reconcileWithChat();
    if (!settings.memoryEnabled || isSummarizing) return;
    if (!currentDataKey()) return; // 没有选中角色/群组，没有可写入的档案
    if (!Array.isArray(chat) || chat.length < 2) return;
    if (!apiConfigured()) return; // 未配置插件 API：跳过本次总结，不回退聊天 API

    // 取「上次总结以来」的新消息窗口：每 N 轮才总结时，把中间跳过的几轮一并带上，避免漏剧情
    const indexed = chat.map((m, i) => ({ m, i })).filter(x => x.m && typeof x.m.mes === 'string' && x.m.mes.trim() && !x.m.is_system);
    if (indexed.length < 2) return;
    const start = (settings.lastSummaryIndex != null && settings.lastSummaryIndex >= 0) ? settings.lastSummaryIndex + 1 : 0;
    let sel = indexed.filter(x => x.i >= start);
    if (sel.length < 2) {
        // 水位线之后没有新对话（重新进入聊天、其他扩展的后台生成等也会触发生成结束事件）：不重复总结
        if (start <= chat.length - 1) return;
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

    const lastCharMsg = ([...sel].reverse().find(x => !x.m.is_user) || {}).m;
    const lastUserMsg = ([...sel].reverse().find(x => x.m.is_user) || {}).m;
    if (!lastCharMsg || !lastUserMsg) return;

    // 总结窗口上限：从最新往前取，总长超过预算就丢掉更早的（至少保留最后两条）。首次启用的老聊天、
    // 以及连续失败后越积越长的窗口，都不会再整段发给模型
    const lines = [];
    let used = 0;
    for (let k = sel.length - 1; k >= 0; k--) {
        const x = sel[k];
        let line = (x.m.name || (x.m.is_user ? '用户' : '角色')) + '：' + x.m.mes;
        if (line.length > SUMMARY_TRANSCRIPT_MAX) line = line.slice(0, SUMMARY_TRANSCRIPT_MAX);
        if (lines.length >= 2 && used + line.length > SUMMARY_TRANSCRIPT_MAX) break;
        lines.unshift(line);
        used += line.length;
    }
    const transcript = lines.join('\n\n');
    if (lines.length < sel.length) toastr.info('这段对话较长，本次只总结最近 ' + lines.length + ' 条（更早的 ' + (sel.length - lines.length) + ' 条未纳入记忆）', undefined, { timeOut: 6000 });

    // await 之前先记下「写给谁」和「总结的是哪条消息」，回来后核对，避免切换聊天串档、滑动后签名记错
    const keyBefore = currentDataKey();
    const stBefore = settings;
    const lastIdx = sel[sel.length - 1].i;
    const sigBefore = messageSig(lastMsg);
    isSummarizing = true;
    try {
        const { systemPrompt, prompt } = buildSummaryPrompt(transcript, lastUserMsg.name || '用户', lastCharMsg.name || '角色', settings.storyTime);
        const raw = await callLLM({ prompt, systemPrompt });
        if (currentDataKey() !== keyBefore || settings !== stBefore) {
            console.warn('[Serendipity] 总结期间切换了聊天/角色，本次结果已丢弃，不会写入当前聊天');
            return;
        }
        if (!chat[lastIdx] || messageSig(chat[lastIdx]) !== sigBefore) {
            settings.roundsSinceSummary = Math.max(0, (settings.summarizeEvery || 1) - 1);
            toastr.info('总结期间那条消息被重新生成/删除，本次结果已丢弃，将按新内容重新总结');
            return;
        }
        // 去掉思维链块，避免推理过程被当成记忆存进去
        const result = String(raw || '').replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '');
        if (result && result.trim()) {
            // 解析出新剧情时间，解析失败则沿用上一次（保证时间线不倒退、不丢失）
            // 总结前先拍快照入日志，供重新生成/滑动/删除时回滚
            pushSummaryJournal(lastIdx, takeStateSnapshot(), sigBefore);
            let newStoryTime = extractStoryTime(result) || settings.storyTime;
            // 解析结构化时间轴（第X天/地点/重要事情），解析失败则沿用上一次，保证时间轴不倒退
            const axis = extractTimeAxis(result);
            // 写入保护：天数比当前小 = 模型把「回忆过去」写成了当前进度，不回退时间轴、不记成当前条目
            let adv = axis ? checkTimeAdvance(axis.day) : { kind: 'ok' };
            // 已有待确认的大跨度：新总结回到原进度附近 = 上次误判，丢弃；与待确认天数吻合 = 采用
            if (axis && axis.day != null && settings.pendingJump && adv.prev != null) {
                const pj = settings.pendingJump;
                if (adv.kind === 'ok') {
                    settings.pendingJump = null;
                    toastr.info('上次挂起的「跳到第' + pj.day + '天」没有被这次总结印证，已丢弃，时间轴仍按第' + adv.prev + '天推进');
                } else if (axis.day > adv.prev && Math.abs(axis.day - pj.day) <= TIMELINE_JUMP_WARN) {
                    applyPendingJump();
                    adv = { kind: 'ok', prev: settings.storyDay };
                    toastr.info('连续两次总结都指向第' + axis.day + '天附近，已采用这次时间跳跃');
                }
            }
            const jump = adv.kind === 'jump';
            const backward = adv.kind === 'backward' || jump; // 倒退或大跨度：都先不改动时间轴
            // 回忆类事件：只是在追述过去，不是现在发生的场景，不记成当前日期的时间线条目
            const recollection = !!axis && axis.recollection && !backward;
            if (jump) {
                settings.pendingJump = { day: axis.day, period: axis.period || '', location: axis.location || '', storyTime: newStoryTime || '', event: axis.event || '', recollection: !!axis.recollection, from: adv.prev, memIds: [] };
                newStoryTime = settings.storyTime;
                toastr.warning('时间轴想从第' + adv.prev + '天一次跳到第' + axis.day + '天，已先挂起、暂不生效。到面板的时间轴区确认，或下一轮总结仍指向这附近时会自动采用', undefined, { timeOut: 10000 });
            } else if (backward) {
                newStoryTime = settings.storyTime;
                toastr.warning('总结把当前进度写成了第' + axis.day + '天（当前第' + adv.prev + '天），疑似只是回忆过去，已保持时间轴不变', undefined, { timeOut: 8000 });
            }
            settings.storyTime = newStoryTime;
            if (axis && !backward) {
                if (axis.day != null) settings.storyDay = axis.day;
                if (axis.period) settings.storyPeriod = axis.period;
                if (axis.location) settings.storyLocation = axis.location;
                // 时间轴列表：叠加本段场景（第X天/年月日几时几分/地点/重要事情）；时间取【时间】里的具体时间
                if (recollection) logTimeFix('时间轴事件「' + axis.event + '」看起来是回忆，没有记成第' + settings.storyDay + '天的当前场景');
                else pushTimelineEntry(axis.day, newStoryTime, axis.location, axis.event, axis.period);
            }
            // 世界状态：解析并按类别快照合并（「无」保留、「空」清空、有新内容替换）
            applyWorldState(extractWorldState(result));
            // 情感线：解析并追加关系变化（无变化/解析失败则不动；历史只追加不改写）
            applyRelationshipChange(extractRelationshipChange(result));
            // 角色实体自动登记（开关开启时）：优先用【人物档案】带出年龄/简介/身份域；模型没输出该行时退回只登记【在场人物】名字
            if (settings.autoRegisterEntities) {
                const infos = extractEntityInfos(result);
                if (infos.length) mergeEntityInfos(infos);
                else registerEntities(extractPresentChars(result));
            }
            // 记忆正文去掉【时间轴】【世界状态】【关系变化】【人物档案】行（结构化数据已单独存，正文保持干净）
            const memoryText = result.trim().replace(/【时间轴】[^\n]*\n?/, '').replace(/【世界状态】[^\n]*\n?/, '').replace(/【关系变化】[^\n]*\n?/, '').replace(/【人物档案】[^\n]*\n?/, '').trim();
            // 只追加，绝不覆盖或删除已有记忆
            const newMemId = uid();
            settings.memories.push({ id: newMemId, time: Date.now(), storyTime: newStoryTime, storyDay: settings.storyDay, storyPeriod: settings.storyPeriod, storyLocation: settings.storyLocation, importance: extractImportance(result), entityRef: inferMemoryEntity(memoryText), text: memoryText });
            if (jump && settings.pendingJump) settings.pendingJump.memIds.push(newMemId);
            settings.lastSummaryIndex = lastIdx; // 记录已总结到的消息下标，下次只总结新增部分（用总结时的位置，期间新到的消息留给下一次）
            summaryFailStreak[keyBefore] = 0;
            const promoted = promoteMemories();
            if (settings.autoFixTime) repairTimeData();
            saveSettings();
            refreshLocalChecks(); // 先重算本地时间冲突，再注入正文，保证本轮就提醒模型
            updatePromptInjection();
            renderMemories();
            renderTimeAxis();
            renderPeople();

            // 弹窗提示：总结成功 + 是否触发晋级
            let msg = '本轮记忆总结成功';
            const parts = [];
            if (promoted.toLong) parts.push('短期已满十轮，自动放入长期记忆');
            if (parts.length) msg += '；' + parts.join('；');
            toastr.success(msg);
            if (promoted.toLong) compressLongMemory(promoted.longId, promoted.sources, keyBefore, stBefore);

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
            noteSummaryFailure(stBefore, keyBefore, lastIdx);
        }
    } catch (e) {
        console.error('[Serendipity] 记忆总结失败：', e);
        toastr.error('本轮记忆总结失败');
        noteSummaryFailure(stBefore, keyBefore, lastIdx);
    } finally {
        isSummarizing = false;
        // 总结期间若有重新生成/滑动，isSummarizing 会让对账被跳过，这里补一次
        setTimeout(() => { if (settings) { activateCharacter(); reconcileWithChat(); } }, 0);
    }
}

// ---------------- 压缩聊天历史（手动按钮：超长聊天救急） ----------------
const COMPRESS_CHUNK_MAX = 12000; // 单次总结输入的最大字符数（太小段数多、太大会触发中转超长断连，取折中）
const COMPRESS_CONCURRENCY = 4;   // 并行总结的并发数（串行太慢，并行能显著缩短压缩时间）
const COMPRESS_REDUCE_BATCH = 6;  // 合并摘要时每批最多合并几段（控制合并输入的字符数，避免又超长）
const COMPRESS_KEEP_DEFAULT = 20; // 压缩时默认保留最近多少条消息

// 把一组消息拼成可读对话文本，按 chunkMax 切成多段（太长时 map-reduce 分段总结）
function buildCompressTranscript(messages, chunkMax) {
    const chunks = [];
    let cur = [];
    let used = 0;
    const flush = () => { if (cur.length) { chunks.push(cur.join('\n\n')); cur = []; used = 0; } };
    for (const m of messages) {
        if (!m || typeof m.mes !== 'string') continue;
        const label = m.is_system ? '系统' : (m.name || (m.is_user ? '用户' : '角色'));
        let line = label + '：' + m.mes.trim();
        if (line.length > chunkMax) line = line.slice(0, chunkMax);
        if (cur.length && used + line.length > chunkMax) flush();
        cur.push(line);
        used += line.length;
    }
    flush();
    return chunks;
}

// 调一次总结模型：把一段文本压成剧情摘要（输入可能是原始对话，也可能是若干段已压缩的摘要）
async function compressChunk(text) {
    const systemPrompt = [
        '你是剧情压缩助手。请把下面已经发生过的故事内容（可能是原始对话，也可能是若干段已压缩的摘要），压缩成一段连贯、精炼的剧情摘要。',
        '要求：',
        '1. 只输出摘要正文本身，不要任何解释、客套、序号或标记。',
        '2. 保留关键事件、人物关系变化、重要约定/伏笔、当前人物与世界状态。',
        '3. 压缩掉寒暄、日常琐事、重复内容。',
        '4. 用中文、第三人称叙述，按时间先后顺序；若输入本身是摘要，请合并成一段完整、不重复、时间线连贯的摘要。',
    ].join('\n');
    const raw = await callCustomApi({ prompt: text, systemPrompt, cfg: getApiCfg() });
    const out = String(raw || '').replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').trim();
    if (!out) throw new Error('压缩总结返回空内容');
    return out;
}

// 总结调用带重试：中转断连（Load failed）或限流（429）时多等一会再重试，不轻易放弃
async function compressChunkRetry(text) {
    let lastErr;
    for (let attempt = 1; attempt <= 5; attempt++) {
        try {
            return await compressChunk(text);
        } catch (e) {
            lastErr = e;
            const msg = String(e && e.message ? e.message : e);
            const rateLimited = /429|rate.?limit|rate_limit_exceeded|频繁|过于频繁/i.test(msg);
            console.warn('[Serendipity] 压缩分段第 ' + attempt + ' 次失败' + (rateLimited ? '（限流）' : '') + '：', e);
            if (attempt < 5) {
                // 限流时多等一会（中转常见 15 次/分钟 → 约 7~10 秒后重试；普通断连短一点）
                const delay = rateLimited ? 8000 * attempt : 1500 * attempt;
                await new Promise(r => setTimeout(r, delay));
            }
        }
    }
    throw lastErr;
}

// 有限并发跑一批任务，结果顺序与 tasks 一致
async function runCompressPool(tasks, concurrency) {
    const results = new Array(tasks.length);
    let idx = 0;
    async function worker() {
        while (true) {
            const i = idx++;
            if (i >= tasks.length) break;
            results[i] = await tasks[i]();
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));
    return results;
}

// 手动压缩聊天历史：把旧消息总结成一段摘要替换掉，只保留最近 compressKeep 条
async function compressChatHistory() {
    activateCharacter();
    if (isCompressing) { toastr.info('正在压缩中，请稍候…'); return; }
    if (selected_group) { toastr.warning('群聊暂不支持压缩聊天历史'); return; }
    if (!apiConfigured()) {
        toastr.warning('请先在「记忆」页配置插件 API（压缩不回退到聊天 API）');
        return;
    }
    if (!Array.isArray(chat) || chat.length < 3) { toastr.warning('聊天消息太少，无需压缩'); return; }

    const keep = Math.max(2, Math.min(200, Math.floor(Number(settings.compressKeep) || COMPRESS_KEEP_DEFAULT)));
    const oldCount = chat.length - keep;
    if (oldCount < 2) { toastr.info('当前聊天还不长（不足 ' + (keep + 1) + ' 条），无需压缩'); return; }

    const oldMsgs = chat.slice(0, oldCount).filter(m => m && typeof m.mes === 'string' && m.mes.trim());
    if (oldMsgs.length < 2) { toastr.info('没有足够的旧消息可压缩'); return; }

    // 先导出旧消息备份（压缩不可逆，备份后可自行找回）
    downloadText(
        'serendipity-compress-backup-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json',
        JSON.stringify({ at: new Date().toISOString(), chatKey: currentDataKey(), removedCount: oldMsgs.length, keptCount: keep, messages: oldMsgs }, null, 2),
        'application/json;charset=utf-8'
    );

    isCompressing = true;
    try {
        // map：把旧消息切成小段，并行总结；reduce：多段摘要分批合并成最终摘要
        const chunks = buildCompressTranscript(oldMsgs, COMPRESS_CHUNK_MAX);
        toastr.info('开始压缩，共 ' + chunks.length + ' 段（并行处理，请稍候…）', undefined, { timeOut: 3000 });
        let done = 0;
        const parts = await runCompressPool(chunks.map((c) => async () => {
            const r = await compressChunkRetry(c);
            done++;
            if (done % 10 === 0 || done === chunks.length) {
                toastr.info('已压缩 ' + done + '/' + chunks.length + ' 段…', undefined, { timeOut: 1500 });
            }
            return r;
        }), COMPRESS_CONCURRENCY);

        // 分批合并：多段摘要逐层并成一段，避免合并输入又超长
        let summaries = parts;
        while (summaries.length > 1) {
            const batches = [];
            for (let i = 0; i < summaries.length; i += COMPRESS_REDUCE_BATCH) {
                batches.push(summaries.slice(i, i + COMPRESS_REDUCE_BATCH).join('\n\n'));
            }
            toastr.info('正在合并摘要（' + summaries.length + ' 段 → ' + batches.length + ' 段）…', undefined, { timeOut: 3000 });
            summaries = await runCompressPool(batches.map((b) => () => compressChunkRetry(b)), COMPRESS_CONCURRENCY);
        }
        const summary = summaries[0];

        // 构造摘要消息：系统消息，不参与角色/用户对话，但会被带入上下文
        const summaryMsg = {
            name: '',
            is_user: false,
            is_system: true,
            mes: '【前情摘要】\n' + summary,
            send_date: Date.now(),
            gen_started: Date.now(),
            gen_finished: Date.now(),
            swipe_id: 0,
            extra: {},
        };

        // 替换掉旧消息，只保留摘要 + 最近 keep 条
        chat.splice(0, oldCount, summaryMsg);

        // 旧消息已被替换：清空总结回滚日志并把水位线重置到末尾，防止下次对账误判「消息被删」而回滚记忆
        settings.summaryJournal = [];
        settings.lastSummaryIndex = chat.length - 1;
        saveSettings();

        await saveChat();
        await reloadCurrentChat();

        // 记录本次压缩结果，显示在「摘要」页的卡片里
        settings.lastCompress = {
            at: Date.now(),
            removed: oldMsgs.length,
            kept: keep,
            text: summary,
        };
        saveSettings();
        renderCompressResult();

        toastr.success('已把 ' + oldMsgs.length + ' 条历史消息压缩为一段摘要，保留最近 ' + keep + ' 条');
    } catch (e) {
        console.error('[Serendipity] 压缩聊天历史失败：', e);
        // 中途失败时内存里的 chat 可能已被 splice 过，重新从磁盘读回原样
        try { await reloadCurrentChat(); } catch (_) { /* 忽略 */ }
        toastr.error('压缩失败：' + safeErrorText(e) + '（旧消息未改动，已导出备份文件可找回）');
    } finally {
        isCompressing = false;
    }
}

// 把上次压缩的结果渲染成「摘要」页里的卡片
function renderCompressResult() {
    const box = $('#st-serendipity .st-sd__compress-result');
    if (!box.length) return;
    const lc = settings && settings.lastCompress;
    if (!lc || typeof lc.text !== 'string' || !lc.text.trim()) { box.hide(); return; }
    const head = '上次压缩：' + new Date(lc.at).toLocaleString() + ' · 压掉 ' + (lc.removed || 0) + ' 条 · 保留 ' + (lc.kept || 0) + ' 条';
    box.show().html(
        '<div class="st-sd__compress-result-head">' + escapeHtml(head) + '</div>' +
        '<div class="st-sd__compress-result-body">' + escapeHtml(lc.text) + '</div>'
    );
}

// ---------------- 记忆注入正文（防失忆） ----------------
// S 级记忆排最前并加醒目标记，A 级次之，B/未评级正常排后；让「不能忘」的内容始终压在最前面
function buildMemoryBlock() {
    const rank = v => (v === 'S' ? 0 : v === 'A' ? 1 : 2);
    const fmt = (m, isLong) => {
        const t = isLong ? stripMemoryNoise(m.text) : m.text;
        return m.importance === 'S' ? '⚠ 绝对不能忘：' + t : t;
    };
    // 字数预算：S > A > 短期 B(新→旧) > 长期 B(新→旧) 依次占用，放不下的较早记忆不注入（仍可通过语义召回找回）
    const cands = [
        ...settings.longMemories.map((m, i) => ({ m, isLong: true, i, text: fmt(m, true) })),
        ...settings.memories.map((m, i) => ({ m, isLong: false, i, text: fmt(m, false) })),
    ];
    const prio = c => rank(c.m.importance) * 2 + (c.isLong ? 1 : 0);
    const order = [...cands].sort((a, b) => prio(a) - prio(b) || b.m.time - a.m.time);
    const keep = new Set();
    let used = 0;
    for (const c of order) {
        if (used + c.text.length > MEMORY_INJECT_MAX && keep.size) continue;
        keep.add(c);
        used += c.text.length;
    }
    const join = isLong => cands.filter(c => c.isLong === isLong && keep.has(c))
        .sort((a, b) => rank(a.m.importance) - rank(b.m.importance) || a.i - b.i).map(c => c.text).join('\n\n');
    const parts = [];
    const longTxt = join(true);
    const shortTxt = join(false);
    if (longTxt) parts.push('【长期记忆】\n' + longTxt);
    if (shortTxt) parts.push('【短期记忆】\n' + shortTxt);
    const dropped = cands.length - keep.size;
    if (dropped > 0) parts.push('（另有 ' + dropped + ' 条较早的记忆因篇幅限制未注入）');
    return parts.join('\n\n');
}

// 情感线注入正文：当前关系（始终）+ 最近变化（限 5 条）+ 关键节点（每条线第一条），控制 token 不爆
function buildRelationshipBlock() {
    const lines = settings.relationshipLines;
    if (!lines.length) return '';
    const parts = [];

    // 当前关系：始终注入
    const cur = lines.map(l => {
        let s = resolveEntityRef(l.a).display + ' → ' + resolveEntityRef(l.b).display + '：关系 ' + (l.current.relationship || '未知');
        if (l.current.affection) s += '，好感 ' + l.current.affection;
        if (l.current.attitude) s += '，态度 ' + l.current.attitude;
        return s;
    }).join('\n');
    parts.push('当前关系：\n' + cur);

    // 最近变化：所有线取最近 3 条，按天数降序后取前 5 条
    const recent = [];
    for (const l of lines) {
        for (const h of l.history.slice(-3)) {
            recent.push({
                day: h.day,
                text: resolveEntityRef(l.a).display + '→' + resolveEntityRef(l.b).display + '：' + (h.to ? '变为' + h.to : (h.change || '关系变化')) + (h.reason ? '，因为' + h.reason : ''),
            });
        }
    }
    recent.sort((x, y) => (y.day == null ? -1 : y.day) - (x.day == null ? -1 : x.day));
    const recentTop = recent.slice(0, 5);
    if (recentTop.length) {
        parts.push('最近关系变化：\n' + recentTop.map(r => (r.day != null ? '第' + r.day + '天 ' : '') + r.text).join('\n'));
    }

    // 关键节点：每条线的第一条（建立/首次变化）
    const nodes = lines.map(l => {
        const first = l.history[0];
        if (!first) return null;
        return resolveEntityRef(l.a).display + '→' + resolveEntityRef(l.b).display + '：' + (first.day != null ? '第' + first.day + '天 ' : '') + (first.to || first.change || '建立关系');
    }).filter(Boolean);
    if (nodes.length) {
        parts.push('关系关键节点：\n' + nodes.join('\n'));
    }

    return parts.join('\n\n');
}

// 把记忆 + 禁止词注入正文 prompt（IN_PROMPT：进入系统提示，正文生成时会被模型读取）
function updatePromptInjection() {
    // 记忆底层规则注入（记忆开启时常驻，让模型遵守剧情时间/事件/人物/世界状态的连续性规则）
    setExtensionPrompt(
        'serendipity_memory_rules',
        settings.memoryEnabled ? '[Serendipity 记忆底层规则]\n' + MEMORY_RULES : '',
        extension_prompt_types.IN_PROMPT,
        0,
    );

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
        worldLines ? '[Serendipity 世界状态]\n' + worldLines + '\n请记住并在后续生成中遵守这些世界状态（物品/日程），剧情产生新变化时自然更新。' : '',
        extension_prompt_types.IN_PROMPT,
        0,
    );

    // 人物档案注入：姓名/身份域/年龄/简介（有数据才注入）
    const npcLines = settings.entities.length ? npcText() : '';
    setExtensionPrompt(
        'serendipity_npcs',
        npcLines ? '[Serendipity 人物档案]\n以下是登场角色的实体档案（姓名/身份域/年龄/简介，以及需要牢记的目标/秘密/承诺）。同名角色按「世界·时间线·身份」区分，不要因姓名相同而合并。\n' + npcLines : '',
        extension_prompt_types.IN_PROMPT,
        0,
    );

    // 情感线注入：当前关系 + 最近变化 + 关键节点（有数据才注入）
    const relBlock = settings.memoryEnabled ? buildRelationshipBlock().trim() : '';
    setExtensionPrompt(
        'serendipity_relationship',
        relBlock ? '[Serendipity 情感线]\n以下是人物之间的关系轨迹（当前关系 + 最近变化 + 关键节点）。请保持关系连续、不要倒退或遗忘；历史关系只追加不改写，只有剧情明确发生分手/决裂/失忆/关系重建等时才记录新的变化。\n\n' + relBlock : '',
        extension_prompt_types.IN_PROMPT,
        0,
    );

    // 伏笔注入（可选，默认关闭）：把未完成的伏笔/未完成事项紧凑提醒模型，避免遗忘或提前说破
    const openFores = settings.injectForeshadows ? settings.foreshadows.filter(f => f && f.status !== '已回收' && f.title && f.title.trim()) : [];
    setExtensionPrompt(
        'serendipity_foreshadow',
        openFores.length ? '[Serendipity 未完成伏笔]\n以下伏笔/未完成事项尚未回收，请在剧情中记住它们、不要遗忘，也不要提前揭晓；时机成熟时自然回收：\n' + openFores.map((f, i) => (i + 1) + '. [' + f.status + '] ' + f.title).join('\n') : '',
        extension_prompt_types.IN_PROMPT,
        0,
    );

    // 一致性检查结果注入（默认开）：把已发现的冲突/矛盾压成紧凑提醒，让模型在后续生成中避免重复犯错——验证层闭环
    const openChecks = settings.injectChecks ? settings.checks.filter(c => c && c.text && c.text.trim()) : [];
    setExtensionPrompt(
        'serendipity_checks',
        openChecks.length ? '[Serendipity 一致性提醒]\n以下是此前剧情中已发现、尚未解决的矛盾/冲突。请在后续生成中保持剧情一致、避免再犯同样的错——不要改写已经发生的历史，只需今后不再自相矛盾：\n' + openChecks.slice(-5).map((c, i) => (i + 1) + '. [' + (CHECK_TYPE_LABELS[c.type] || '其他') + '] ' + c.text).join('\n') : '',
        extension_prompt_types.IN_PROMPT,
        0,
    );

    // 禁止词注入（同样放最顶端，确保模型生成时绝不输出这些词）
    const censorActive = censorOn() && blockedWordList().length > 0;
    setExtensionPrompt(
        'serendipity_censor',
        censorActive ? '[Serendipity 禁止词（绝对不得出现）]\n以下词眼在任何情况下都绝对不要出现在你的回复中：' + blockedWordList().join('、') : '',
        extension_prompt_types.BEFORE_PROMPT,
        0,
    );

    // 指令注入（无数量限制，只注入已开启的指令，每轮生成都读取）
    // 放在 BEFORE_PROMPT（prompt 最顶端、角色描述之前），确保模型把指令当作最高优先级指令严格遵守，
    // 而不是像 IN_PROMPT 那样被埋在剧情里被角色设定/聊天记录盖过去。
    const enabledInstr = instructionList().filter(it => it && it.enabled && typeof it.text === 'string' && it.text.trim());
    setExtensionPrompt(
        'serendipity_instructions',
        enabledInstr.length ? '[Serendipity 指令（必须严格遵守）]\n以下是你必须严格遵守的用户指令，优先级高于一切剧情、角色设定与历史对话，每轮回复都必须逐条执行：\n' + enabledInstr.map((it, i) => (i + 1) + '. ' + it.text).join('\n') : '',
        extension_prompt_types.BEFORE_PROMPT,
        0,
    );

    // 语义召回注入：开启时按需（防抖）同步索引，召回块本身由 GENERATION_ENDED 更新，不在这里清空；关闭时清空
    if (settings.semanticRecall && settings.semanticRecall.enabled) {
        scheduleSemanticSync();
    } else {
        setExtensionPrompt('serendipity_semantic_recall', '', extension_prompt_types.IN_PROMPT, 0);
    }
}

// ---------------- 世界书自动注入 ----------------
// 用户自己选要注入的世界书名（存于每角色设置里，不一定用角色绑定的那本）
function getSelectedWorldBook() {
    return typeof settings.worldBook === 'string' ? settings.worldBook.trim() : '';
}

// 判断这本世界书当前是否已「激活」（设为全局世界书，或绑定为当前角色的主要世界书）。
// 只有激活的世界书，酒馆才会把里面的条目拼进发给模型的 prompt，否则模型读不到。
// 当前角色的酒馆「文件名」标识（头像文件名去扩展名，酒馆世界书的角色过滤、附加世界书都用它）；群聊/无角色返回 ''
function currentCharFileName() {
    const ch = (this_chid !== undefined && characters) ? characters[this_chid] : null;
    return (ch && typeof ch.avatar === 'string') ? ch.avatar.replace(/\.[^/.]+$/, '') : '';
}

function isWorldBookActive(name) {
    if (!name) return false;
    // 全局世界书
    if (Array.isArray(selected_world_info) && selected_world_info.includes(name)) return true;
    // 当前聊天绑定的世界书
    if (chat_metadata && chat_metadata.world_info === name) return true;
    // 当前人设绑定的世界书
    if (power_user && power_user.persona_description_lorebook === name) return true;
    if (this_chid !== undefined && characters && characters[this_chid]) {
        // 角色主要世界书
        const w = characters[this_chid].data?.extensions?.world;
        if (typeof w === 'string' && w === name) return true;
        // 角色附加世界书
        const fileName = currentCharFileName();
        const extra = world_info && Array.isArray(world_info.charLore) ? world_info.charLore.find(e => e && e.name === fileName) : null;
        if (extra && Array.isArray(extra.extraBooks) && extra.extraBooks.includes(name)) return true;
    }
    return false;
}

// 每条长期记忆的关键词：正文里出现过的实体名 + 关联实体 + 地点；都没有时兜底用当前角色名，保证能被召回
function memoryKeywords(m) {
    const keys = new Set();
    const text = String(m.text || '');
    if (m.entityRef) {
        const e = (settings.entities || []).find(x => x && x.id === m.entityRef);
        if (e && e.name && e.name.trim().length >= 2) keys.add(e.name.trim());
    }
    for (const e of (settings.entities || [])) {
        if (e && e.name && e.name.trim().length >= 2 && text.includes(e.name)) keys.add(e.name.trim());
    }
    const loc = (m.storyLocation || '').trim();
    if (loc.length >= 2 && !/^(这里|那里|某处|室内|室外|原地|当地)$/.test(loc)) keys.add(loc);
    const arr = [...keys];
    if (!arr.length) {
        const cn = currentCharName();
        if (cn && cn.trim()) arr.push(cn.trim());
    }
    return arr.slice(0, 8);
}

// 条目内容 = 原文 + 时间前缀，召回后模型能知道这是哪天的事
function memoryEntryContent(m) {
    const day = memDayLabel(m);
    const time = m.storyTime || '';
    const when = [day, time, m.storyLocation || ''].filter(Boolean).join(' · ');
    if (!when) return m.text;
    return '【历史记录 · ' + when + '】（以下事件发生在这个时间，属于过去，不是当前正在发生；除非剧情明确说再次发生）\n' + m.text;
}

// 条目标题：重要度 + 短摘要，便于在世界书里一眼辨认
function memoryEntryComment(m) {
    const snippet = String(m.text || '').replace(/\s+/g, ' ').trim().slice(0, 30);
    const imp = (m.importance === 'S' || m.importance === 'A') ? ('[' + m.importance + '] ') : '';
    const d = memDayLabel(m);
    return '[Serendipity] ' + imp + (d ? d + ' ' : '') + snippet;
}

// 把长期记忆归档到用户选择的世界书：每条长期记忆单独写成一条带关键词的条目，
// 让酒馆按关键词按需召回原文（而不是合并成一条常驻条目每轮全量注入），归档后清空长期记忆
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
        if (!settings.longMemories.length) {
            toastr.warning('当前还没有长期记忆，先积累一些记忆再归档');
            return;
        }
        const data = await loadWorldInfo(worldName);
        if (!data || typeof data !== 'object' || !data.entries) {
            toastr.error('读取世界书「' + worldName + '」失败，可能已被删除，请重新选择');
            return;
        }
        const charFile = currentCharFileName();
        let written = 0;
        for (const m of settings.longMemories) {
            if (!m || !m.text) continue;
            const entry = createWorldInfoEntry(worldName, data);
            if (!entry) continue;
            entry.comment = memoryEntryComment(m);
            entry.content = memoryEntryContent(m);
            entry.key = memoryKeywords(m);        // 关键词：按人物/地点等召回
            entry.constant = false;               // 不常驻，靠关键词触发按需召回
            entry.selective = true;               // 选择性触发（关键词匹配）
            // 绑定当前角色：酒馆的过滤字段是 characterFilter.names，值为头像文件名去扩展名；群聊/无角色时不设过滤
            if (charFile) entry.characterFilter = { isExclude: false, names: [charFile], tags: [] };
            entry.vectorized = !!settings.archiveVectorized; // 语义召回：标 true 交给酒馆向量存储按语义召回（需 ST 向量存储已启用并配好 embedding 源）
            entry.position = 0;                   // 注入位置：角色设定之前（召回时作为权威背景）
            entry.role = 0;                       // 系统角色
            written++;
        }
        if (!written) {
            toastr.error('在世界书中创建条目失败');
            return;
        }
        await saveWorldInfo(worldName, data, true);
        settings.archivedWorldBook = worldName; // 记录归档目标，用于「未激活」常驻黄条提醒
        settings.longMemories = [];              // 归档后清空长期记忆（正文注入保持有界）
        settings.summaryJournal = [];            // 归档改动了长期记忆，旧快照不能再回滚
        settings.worldReminderShown = false;
        saveSettings();
        updatePromptInjection();
        renderMemories();
        if (isWorldBookActive(worldName)) {
            toastr.success('已归档 ' + written + ' 条长期记忆到世界书「' + worldName + '」并清空长期记忆（按关键词召回原文）');
        } else {
            toastr.warning('已归档 ' + written + ' 条长期记忆到世界书「' + worldName + '」，但这本世界书还没激活，模型暂时读不到。请到酒馆世界书界面把它设为全局世界书，或绑定到此角色。');
        }
    } catch (e) {
        console.error('[Serendipity] 注入世界书失败：', e);
        toastr.error('注入世界书失败' + (e && e.message ? '：' + e.message : ''));
    } finally {
        isInjecting = false;
    }
}

// 世界书下拉：列出全部世界书，让用户自己选要注入到哪一本
function filterWorldNames(names, query) {
    const terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return names;
    return names.filter(n => { const l = String(n).toLowerCase(); return terms.every(t => l.includes(t)); });
}

function renderWorldSelect() {
    const selectEl = $('#st-serendipity .st-sd__world-select');
    if (!selectEl.length) return;
    const names = Array.isArray(world_names) ? world_names : [];
    const current = getSelectedWorldBook();
    const query = String($('#st-serendipity .st-sd__world-search').val() || '').trim();
    const shown = filterWorldNames(names, query);
    // 已选中的那本即使不匹配也保留，避免搜索时悄悄改掉选择
    if (current && names.includes(current) && !shown.includes(current)) shown.unshift(current);
    let html = '<option value="">未选择世界书</option>';
    for (const n of shown) {
        const selected = n === current ? ' selected' : '';
        html += `<option value="${escapeHtml(n)}"${selected}>${escapeHtml(n)}</option>`;
    }
    if (query && !filterWorldNames(names, query).length) html += '<option value="" disabled>没有匹配的世界书</option>';
    selectEl.html(html);
    $('#st-serendipity .st-sd__world-search').attr('title', query ? ('匹配 ' + filterWorldNames(names, query).length + ' / ' + names.length + ' 本') : ('共 ' + names.length + ' 本世界书'));
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
    // 剧情档案式排版：第X天 / 年月日几时几分 / 地点 / 事件内容 / 记录时间
    const dayLabel = m.storyDay != null ? ('第 ' + m.storyDay + ' 天') : '';
    let timeLabel = m.storyTime ? escapeHtml(m.storyTime) : '';
    const locLabel = [m.storyLocation, m.storyPeriod].filter(Boolean).map(escapeHtml).join(' · ');
    const recLabel = escapeHtml(fmtTime(m.time));
    const hasStory = !!(dayLabel || timeLabel);
    if (!hasStory) timeLabel = recLabel; // 无剧情时间时回退显示记录时间
    const impBadge = m.importance === 'S' ? '<span class="st-sd__memory-imp st-sd__memory-imp--s">S·不能忘</span>'
        : m.importance === 'A' ? '<span class="st-sd__memory-imp st-sd__memory-imp--a">A·重要</span>' : '';
    const ent = settings.entities.find(e => e.id === m.entityRef);
    const entityBadge = ent ? `<span class="st-sd__memory-ent" title="关联角色">👤${escapeHtml(ent.name)}</span>` : '';
    const entOptions = '<option value=""' + (!m.entityRef ? ' selected' : '') + '>未关联角色</option>'
        + settings.entities.map(e => `<option value="${e.id}"${m.entityRef === e.id ? ' selected' : ''}>${escapeHtml(e.name + (entityDomain(e) ? '（' + entityDomain(e) + '）' : ''))}</option>`).join('');

    if (m.id === editingId) {
        // 编辑态：文本变为可编辑 textarea，操作区换成保存/取消
        return `<div class="st-sd__memory is-editing" data-id="${m.id}">
            <div class="st-sd__memory-head">
                <div class="st-sd__memory-meta">
                    ${dayLabel ? `<span class="st-sd__memory-day">${dayLabel}</span>` : ''}
                    ${timeLabel ? `<span class="st-sd__memory-clock">${timeLabel}</span>` : ''}
                    ${impBadge}
                    ${entityBadge}
                </div>
                ${locLabel ? `<div class="st-sd__memory-loc">${locLabel}</div>` : ''}
                <span class="st-sd__memory-actions">
                    <button type="button" class="st-sd__memory-save" data-id="${m.id}" title="保存修改">保存</button>
                    <button type="button" class="st-sd__memory-cancel" title="放弃修改">取消</button>
                </span>
            </div>
            <select class="st-sd__memory-imp-select">
                <option value="S"${m.importance === 'S' ? ' selected' : ''}>S·不能忘</option>
                <option value="A"${m.importance === 'A' ? ' selected' : ''}>A·重要</option>
                <option value="B"${(!m.importance || m.importance === 'B') ? ' selected' : ''}>B·普通</option>
            </select>
            <select class="st-sd__memory-ent-select">${entOptions}</select>
            <textarea class="st-sd__memory-edit-text" spellcheck="false">${escapeHtml(m.text)}</textarea>
        </div>`;
    }

    const edit = `<button type="button" class="st-sd__memory-edit" data-id="${m.id}" data-tier="${tier}" title="修改此条记忆">编辑</button>`;
    const del = deletable
        ? `<button type="button" class="st-sd__memory-del" data-id="${m.id}" data-tier="${tier}" title="删除此条记忆">删除</button>`
        : '';
    return `<div class="st-sd__memory" data-id="${m.id}">
        <div class="st-sd__memory-head">
            <div class="st-sd__memory-meta">
                ${dayLabel ? `<span class="st-sd__memory-day">${dayLabel}</span>` : ''}
                ${timeLabel ? `<span class="st-sd__memory-clock">${timeLabel}</span>` : ''}
                ${impBadge}
                ${entityBadge}
            </div>
            ${locLabel ? `<div class="st-sd__memory-loc">${locLabel}</div>` : ''}
        </div>
        <pre class="st-sd__memory-text">${escapeHtml(m.text)}</pre>
        <div class="st-sd__memory-foot">
            ${hasStory ? `<span class="st-sd__memory-rec">记录于 ${recLabel}</span>` : ''}
            <span class="st-sd__memory-actions">${edit}${del}</span>
        </div>
    </div>`;
}

function renderStoryTime() {
    const el = $('#st-serendipity .st-sd__story-time');
    if (!el.length) return;
    const day = settings.storyDay != null ? ('第 ' + settings.storyDay + ' 天') : '';
    const time = settings.storyTime ? escapeHtml(settings.storyTime) : '';
    let hero = time || day || '';
    const metaParts = [day, settings.storyPeriod, settings.storyLocation].filter(Boolean);
    if (hero === day) { // 主角时间用了「第X天」时，副行不再重复它
        const i = metaParts.indexOf(day);
        if (i >= 0) metaParts.splice(i, 1);
    }
    if (!hero) {
        el.html(`<div class="st-sd__story-eyebrow">STORY TIME</div>
            <div class="st-sd__story-hero is-empty">尚未开始</div>
            <div class="st-sd__story-meta"><span>等待首次总结，时间锚点会从这里自动推进</span></div>`);
        return;
    }
    const metaHtml = metaParts.length
        ? '<div class="st-sd__story-meta">' + metaParts.map(s => `<span>${escapeHtml(s)}</span>`).join('<span class="st-sd__story-dot">·</span>') + '</div>'
        : '';
    const pj = settings.pendingJump;
    const jumpHtml = pj
        ? `<div class="st-sd__jump"><div class="st-sd__jump-text">待确认：时间想从第 ${pj.from} 天跳到第 ${pj.day} 天${pj.location ? '（' + escapeHtml(pj.location) + '）' : ''}，尚未生效</div>
            <div class="st-sd__jump-btns"><button class="st-sd__jump-ok">采用</button><button class="st-sd__jump-no">忽略</button></div></div>`
        : '';
    el.html(`<div class="st-sd__story-eyebrow">STORY TIME</div>
        <div class="st-sd__story-hero">${hero}</div>${metaHtml}${jumpHtml}`);
}

function renderMemories() {
    const list = $('#st-serendipity .st-sd__memory-list');
    if (!list.length) return;

    $('#st-serendipity .st-sd__mem-toggle').prop('checked', !!settings.memoryEnabled);
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

// ---------------- 向量召回（语义搜索）UI ----------------
// 单独一个类目：输入一句话，直接调酒馆「向量存储」查一次，列出按相似度排序、会被语义召回的记忆原文。
// 复刻 ST 向量存储扩展的请求体构造（读 extension_settings.vectors 的源/模型），保证与每轮真实召回同配置。

const VECTOR_SOURCE_LABELS = {
    transformers: '本地 (transformers)',
    openai: 'OpenAI',
    ollama: 'Ollama',
    siliconflow: '硅基流动',
    vllm: 'vLLM（可当通用 OpenAI 兼容接口）',
    llamacpp: 'llama.cpp',
    koboldcpp: 'KoboldCpp',
    palm: 'Google (Palm)',
    vertexai: 'Google Vertex AI',
    cohere: 'Cohere',
    openrouter: 'OpenRouter',
    togetherai: 'Together AI',
    mistral: 'Mistral',
    nomicai: 'Nomic AI',
    chutes: 'Chutes',
    nanogpt: 'NanoGPT',
    electronhub: 'ElectronHub',
    workers_ai: 'Cloudflare Workers AI',
    webllm: 'WebLLM（浏览器本地）',
    extras: 'Extras',
};

function vectorSourceLabel(src) {
    return VECTOR_SOURCE_LABELS[src] || src || '（未设置）';
}

function vectorSourceModel(vs) {
    if (!vs) return '';
    const m = {
        openai: vs.openai_model,
        electronhub: vs.electronhub_model,
        openrouter: vs.openrouter_model,
        cohere: vs.cohere_model,
        togetherai: vs.togetherai_model,
        ollama: vs.ollama_model,
        vllm: vs.vllm_model,
        webllm: vs.webllm_model,
        palm: vs.google_model,
        vertexai: vs.google_model,
        chutes: vs.chutes_model,
        nanogpt: vs.nanogpt_model,
        siliconflow: vs.siliconflow_model,
        workers_ai: vs.workers_ai_model,
    }[vs.source];
    return m ? String(m) : '';
}

// 与酒馆 vectors 扩展 getVectorsRequestBody 保持一致：读源对应的模型/接口地址拼进请求体
function vectorsRequestBody(args = {}) {
    const vs = extension_settings.vectors;
    const body = Object.assign({}, args);
    if (!vs) return body;
    switch (vs.source) {
        case 'extras':
            body.extrasUrl = extension_settings.apiUrl;
            body.extrasKey = extension_settings.apiKey;
            break;
        case 'electronhub':
            body.model = vs.electronhub_model;
            break;
        case 'openrouter':
            body.model = vs.openrouter_model;
            break;
        case 'togetherai':
            body.model = vs.togetherai_model;
            break;
        case 'openai':
            body.model = vs.openai_model;
            break;
        case 'cohere':
            body.model = vs.cohere_model;
            break;
        case 'ollama':
            body.model = vs.ollama_model;
            body.apiUrl = vs.use_alt_endpoint ? vs.alt_endpoint_url : textgenerationwebui_settings.server_urls[textgen_types.OLLAMA];
            body.keep = !!vs.ollama_keep;
            break;
        case 'llamacpp':
            body.apiUrl = vs.use_alt_endpoint ? vs.alt_endpoint_url : textgenerationwebui_settings.server_urls[textgen_types.LLAMACPP];
            break;
        case 'vllm':
            body.apiUrl = vs.use_alt_endpoint ? vs.alt_endpoint_url : textgenerationwebui_settings.server_urls[textgen_types.VLLM];
            body.model = vs.vllm_model;
            break;
        case 'webllm':
            body.model = vs.webllm_model;
            break;
        case 'palm':
            body.model = vs.google_model;
            body.api = 'makersuite';
            break;
        case 'vertexai':
            body.model = vs.google_model;
            body.api = 'vertexai';
            body.vertexai_auth_mode = oai_settings.vertexai_auth_mode;
            body.vertexai_region = oai_settings.vertexai_region;
            body.vertexai_express_project_id = oai_settings.vertexai_express_project_id;
            break;
        case 'chutes':
            body.model = vs.chutes_model;
            break;
        case 'nanogpt':
            body.model = vs.nanogpt_model;
            break;
        case 'siliconflow':
            body.model = vs.siliconflow_model;
            body.siliconflow_endpoint = oai_settings.siliconflow_endpoint;
            break;
        case 'workers_ai':
            body.model = vs.workers_ai_model || '@cf/baai/bge-m3';
            body.workers_ai_account_id = oai_settings.workers_ai_account_id;
            break;
        default:
            break;
    }
    return body;
}

function recallScopeNames() {
    const names = Array.isArray(world_names) ? [...world_names] : [];
    const archived = settings.archivedWorldBook || settings.worldBook || '';
    if (archived && !names.includes(archived)) names.unshift(archived);
    return names;
}

// 预览范围下拉：可按搜索框过滤；已选中的范围即使不匹配也保留，避免搜索时悄悄换掉
function renderRecallScope() {
    const panel = $('#st-serendipity');
    const worldSelect = panel.find('.st-sd__recall-world');
    if (!worldSelect.length) return;
    const prevScope = String(worldSelect.val() || '');
    const names = recallScopeNames();
    const query = String(panel.find('.st-sd__recall-world-search').val() || '').trim();
    const hits = filterWorldNames(names, query);
    const shown = hits.slice();
    if (prevScope.startsWith('world:') && names.includes(prevScope.slice(6)) && !shown.includes(prevScope.slice(6))) shown.unshift(prevScope.slice(6));
    let html = '<option value="own">Serendipity 当前聊天的索引（实际召回用的）</option>'
        + shown.map(n => `<option value="world:${escapeHtml(n)}">世界书：${escapeHtml(n)}</option>`).join('');
    if (query && !hits.length) html += '<option value="" disabled>没有匹配的世界书</option>';
    worldSelect.html(html);
    const keep = prevScope && worldSelect.find('option').filter(function () { return this.value === prevScope; }).length;
    worldSelect.val(keep ? prevScope : 'own');
    panel.find('.st-sd__recall-world-search').attr('title', query ? ('匹配 ' + hits.length + ' / ' + names.length + ' 本') : ('共 ' + names.length + ' 本世界书'));
}

function renderRecall() {
    const panel = $('#st-serendipity');
    const statusEl = panel.find('.st-sd__recall-status');
    const worldSelect = panel.find('.st-sd__recall-world');
    if (!statusEl.length) return;
    panel.find('.st-sd__vec-toggle').prop('checked', !!settings.archiveVectorized);

    const vs = extension_settings.vectors;
    if (!vs) {
        statusEl.html('<div class="st-sd__recall-warn">未检测到酒馆「向量存储」扩展（没装或没启用），语义搜索需要它。</div>');
    } else {
        const chips = ['<span class="st-sd__recall-chip">源：' + escapeHtml(vectorSourceLabel(vs.source)) + '</span>'];
        const model = vectorSourceModel(vs);
        if (model) chips.push('<span class="st-sd__recall-chip">模型：' + escapeHtml(model) + '</span>');
        chips.push(vs.enabled_world_info
            ? '<span class="st-sd__recall-chip st-sd__recall-chip--ok" title="仅「预览酒馆世界书向量」时需要；Serendipity 自己的索引不依赖它">酒馆世界书向量化：已启用</span>'
            : '<span class="st-sd__recall-chip st-sd__recall-chip--warn" title="仅「预览酒馆世界书向量」时需要；Serendipity 自己的索引不依赖它">酒馆世界书向量化：未启用</span>');
        statusEl.html(chips.join(''));
    }

    // 预览调参默认值：沿用酒馆向量存储当前的阈值/条数；用户手改过就保留
    const thresholdInput = panel.find('.st-sd__recall-threshold');
    const topkInput = panel.find('.st-sd__recall-topk');
    if (vs) {
        if (!thresholdInput.val()) thresholdInput.val(vs.score_threshold != null ? vs.score_threshold : 0.25);
        if (!topkInput.val()) topkInput.val(vs.max_entries != null ? vs.max_entries : 5);
    }

    // 预览范围：默认是 Serendipity 自己的索引；也可以选一本世界书看酒馆向量存储里的归档向量
    renderRecallScope();

    // 注入正文控件回填（只在首次/切角色时覆盖，避免用户正在输入时被刷新打断）
    const sr = settings.semanticRecall || {};
    const injectToggle = panel.find('.st-sd__recall-inject-toggle');
    const injectTopk = panel.find('.st-sd__recall-inject-topk');
    const injectThreshold = panel.find('.st-sd__recall-inject-threshold');
    const injectQueryTopk = panel.find('.st-sd__recall-inject-querytopk');
    if (injectToggle.length) injectToggle.prop('checked', !!sr.enabled);
    if (injectTopk.length) injectTopk.val(Number(sr.topK) || 4);
    if (injectThreshold.length) injectThreshold.val(sr.threshold != null ? Number(sr.threshold) : 0.25);
    if (injectQueryTopk.length) injectQueryTopk.val(Number(sr.queryTopK) || 20);
    panel.find('.st-sd__recall-inject-budget').val(sr.charBudget != null ? Number(sr.charBudget) : 1500);
    renderRecallIndexState();
}

// 预览 Serendipity 自己的索引：和实际召回用同一个集合、同一套查询参数，只是不加权重排、不去重，直接看向量相似度排序
async function runOwnSemanticSearch(query) {
    const panel = $('#st-serendipity');
    const list = panel.find('.st-sd__recall-list');
    const vs = extension_settings.vectors;
    const issue = semanticSourceIssue(vs);
    if (issue) { list.html('<div class="st-sd__empty">' + escapeHtml(issue) + '。</div>'); return; }
    const key = currentDataKey();
    if (!key) { list.html('<div class="st-sd__empty">当前没有选中角色或群聊，没有可预览的索引。</div>'); return; }
    const st = settings;
    const thresholdRaw = parseFloat(panel.find('.st-sd__recall-threshold').val());
    const topkRaw = parseInt(panel.find('.st-sd__recall-topk').val(), 10);
    const threshold = (!isNaN(thresholdRaw) && thresholdRaw >= 0) ? thresholdRaw : 0;
    const topK = (!isNaN(topkRaw) && topkRaw >= 1) ? topkRaw : 5;
    list.html('<div class="st-sd__empty">正在语义搜索…</div>');
    try {
        const collectionId = semanticCollectionId();
        const indexed = await semanticList(collectionId, vs);
        if (currentDataKey() !== key || settings !== st) return;
        if (!indexed.length) {
            list.html('<div class="st-sd__empty">本聊天的索引还是空的（当前 embedding 源/模型下没有向量）。到上面开启「注入正文」让它自动建索引，或点「清空并重建」。</div>');
            return;
        }
        const resp = await semanticVectorFetch('/api/vector/query', semanticBody(collectionId, vs, { searchText: query, topK, threshold }), 30000);
        const data = await resp.json();
        if (currentDataKey() !== key || settings !== st) return;
        const meta = Array.isArray(data.metadata) ? data.metadata : [];
        if (!meta.length) {
            list.html('<div class="st-sd__empty">没有召回任何条目（索引里有 ' + indexed.length + ' 条向量，但相似度都低于阈值 ' + escapeHtml(String(threshold)) + '）。把「阈值」调低到 0 再试。</div>');
            return;
        }
        const itemMap = {};
        for (const it of buildRecallItems()) itemMap[it.id] = it;
        let stale = 0;
        list.html(meta.map((m, i) => {
            const it = itemMap[m.index];
            const ok = it && Number(m.hash) === recallHash(it);
            if (!ok) stale++;
            const head = ok ? (recallTimeLabel(it) + (it.tag ? ' [' + it.tag + ']' : '') + (it.importance ? ' ' + it.importance + '级' : '')) : '（该条已被删改，索引尚未同步，不会被注入）';
            const body = ok ? it.body : String(m.text || '').trim();
            return '<div class="st-sd__recall-item' + (ok ? '' : ' st-sd__recall-item--stale') + '">'
                + '<div class="st-sd__recall-rank">#' + (i + 1) + '</div>'
                + '<div class="st-sd__recall-body"><div class="st-sd__recall-meta">' + escapeHtml(head) + '</div>' + escapeHtml(body) + '</div>'
                + '<button type="button" class="st-sd__recall-copy" title="复制这段记忆原文">复制</button>'
                + '</div>';
        }).join(''));
        toastr.success('命中 ' + meta.length + ' 条（按相似度从高到低）' + (stale ? '，其中 ' + stale + ' 条已过期' : ''));
    } catch (e) {
        console.error('[Serendipity] 预览语义搜索失败：', e);
        list.html('<div class="st-sd__empty">语义搜索失败：' + escapeHtml(e && e.message ? e.message : String(e)) + '</div>');
    }
}

async function runSemanticSearch() {
    const panel = $('#st-serendipity');
    const scope = String(panel.find('.st-sd__recall-world').val() || 'own');
    const query = String(panel.find('.st-sd__recall-input').val() || '').trim();
    const list = panel.find('.st-sd__recall-list');
    if (!query) { toastr.warning('请输入要搜索的一句话'); return; }
    if (scope === 'own') { await runOwnSemanticSearch(query); return; }
    const world = scope.replace(/^world:/, '').trim();
    if (!world) { toastr.warning('请先选择要查询的范围'); return; }
    const vs = extension_settings.vectors;
    const issue = semanticSourceIssue(vs);
    if (issue) { list.html('<div class="st-sd__empty">' + escapeHtml(issue) + '。</div>'); return; }
    if (!vs.enabled_world_info) {
        toastr.warning('酒馆向量存储的「世界书向量化」还没启用，向量库里可能没有数据', undefined, { timeOut: 4000 });
    }
    list.html('<div class="st-sd__empty">正在语义搜索…</div>');
    try {
        const body = vectorsRequestBody({});
        body.collectionId = 'world_' + getStringHash(world);
        body.searchText = query;
        const thresholdRaw = parseFloat(panel.find('.st-sd__recall-threshold').val());
        const topkRaw = parseInt(panel.find('.st-sd__recall-topk').val(), 10);
        body.topK = (!isNaN(topkRaw) && topkRaw >= 1) ? topkRaw : (Number(vs.max_entries) || 5);
        body.threshold = (!isNaN(thresholdRaw) && thresholdRaw >= 0) ? thresholdRaw : (Number(vs.score_threshold) || 0);
        body.source = vs.source;
        const resp = await fetch('/api/vector/query', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify(body),
        });
        if (!resp.ok) {
            const t = await resp.text();
            throw new Error('HTTP ' + resp.status + (t ? '：' + String(t).slice(0, 200) : ''));
        }
        const data = await resp.json();
        const meta = Array.isArray(data.metadata) ? data.metadata : [];
        if (!meta.length) {
            list.html('<div class="st-sd__empty">没有召回任何记忆。可能原因：这本世界书还没被向量化（需开着世界书向量化、跑过至少一轮生成，向量库才会索引这些条目）、相似度都低于阈值（' + escapeHtml(String(body.threshold)) + '）、或这本世界书里没有标记为向量化的条目。</div>');
            return;
        }
        list.html(meta.map((it, i) => {
            const text = String(it.text || '').trim();
            return '<div class="st-sd__recall-item">'
                + '<div class="st-sd__recall-rank">#' + (i + 1) + '</div>'
                + '<div class="st-sd__recall-body">' + escapeHtml(text) + '</div>'
                + '<button type="button" class="st-sd__recall-copy" title="复制这段记忆原文">复制</button>'
                + '</div>';
        }).join(''));
        toastr.success('语义召回命中 ' + meta.length + ' 条（按相似度从高到低）');
    } catch (e) {
        console.error('[Serendipity] 语义搜索失败：', e);
        list.html('<div class="st-sd__empty">语义搜索失败：' + escapeHtml(e && e.message ? e.message : String(e)) + '</div>');
    }
}

// ---------------- 语义召回注入（对 Serendipity 自己的数据做语义召回，注入正文） ----------------
// 复用酒馆向量存储的 embedding 源，把记忆/时间线/人物/关系/伏笔/世界状态存进独立集合，
// 数据变化后同步索引；每次生成前按最新对话语义召回 + 重要性/时间/角色加权重排 + 去重，注入正文。

function semanticCollectionId() {
    return 'serendipity_' + getStringHash(currentDataKey() || currentCharKey() || 'default');
}

// embedding 源签名：源 + 模型变了就视为不兼容（向量需全量重建）
function semanticModelSignature(vs) {
    if (!vs) return '';
    return String(vs.source) + '|' + vectorSourceModel(vs);
}

// 单个人物实体 → 一行文本（与 npcText 同格式，供嵌入/注入）
function entityRecallText(e) {
    return e.name
        + (entityDomain(e) ? '（' + entityDomain(e) + '）' : '')
        + (e.age ? '，' + e.age + '岁' : '')
        + (e.note ? '，' + e.note : '')
        + (e.goal ? '；目标：' + e.goal : '')
        + (e.secret ? '；秘密：' + e.secret : '')
        + (e.promise ? '；承诺：' + e.promise : '');
}

// text = 写入向量库的文本（改动会触发重新嵌入，保持不变）；extra = 注入时用的结构化时间元数据：
// { tag: 类型标签, body: 不含时间前缀的正文, time: 具体时间, location: 地点 }
function recallItem(type, id, text, importance, day, entityRef, extra) {
    const x = extra || {};
    return {
        type, id, text,
        importance: importance || '',
        day: (day == null || isNaN(day)) ? null : Number(day),
        entityRef: entityRef || '',
        tag: x.tag || '',
        body: x.body != null ? String(x.body) : text,
        time: x.time || '',
        location: x.location || '',
        dayLabel: x.dayLabel || '',
    };
}

// ---------------- 相对时间 → 时间轴（语义负责找「发生过什么」，时间轴负责决定「什么时候发生」） ----------------
// 从文本里找出相对时间词并换算成相对今天的天数偏移（只处理能精确到「天」的：昨天/昨晚/前天/大前天/N天前）；
// 以前/之前/那时候这类模糊说法不处理（只需要事件存在，不查日期）
function parseRelativeDayRefs(text) {
    const t = String(text || '');
    const refs = [];
    const seen = new Set();
    const add = (word, offset) => { if (!seen.has(word)) { seen.add(word); refs.push({ word, offset }); } };
    let rest = t;
    for (const m of t.matchAll(/大前天/g)) add(m[0], -3);
    rest = rest.replace(/大前天/g, '');
    // 排除常见误判：「前天空/前天地」「昨日重现」「第三天前往…」「三天前来…」（不用后行断言，兼容旧版 Safari）
    for (const m of rest.matchAll(/前天(?![空地际使赋然下命])|前晚|前夜(?![之])/g)) add(m[0], -2);
    for (const m of rest.matchAll(/昨天|昨晚|昨夜|昨早|昨晨|昨日(?![重再之])/g)) add(m[0], -1);
    for (const m of rest.matchAll(/(^|[^第0-9０-９一二两三四五六七八九十])([0-9０-９一二两三四五六七八九十]+)\s*天(?:之)?前(?![往进来去夕方后面])/g)) {
        const n = parseDayNumber(m[2]);
        if (n != null && n >= 1 && n <= 60) add(m[0].slice(m[1].length).replace(/\s+/g, ''), -n);
    }
    return refs;
}

// 某一天在时间轴/记忆里的已知事实（时间线事件为主）
function dayFacts(day) {
    const facts = [];
    for (const e of settings.timeline) {
        if (e.day !== day) continue;
        const bits = [e.time, e.location, e.event].filter(Boolean).join(' · ');
        if (bits) facts.push(bits);
    }
    let memCount = 0;
    for (const arr of [settings.memories, settings.longMemories]) {
        for (const m of arr) {
            const [f, t] = memDayRange(m);
            if (f != null && t != null && day >= f && day <= t) memCount++;
        }
    }
    return { facts, memCount };
}

// 把对话里的相对时间换算成第几天，并附上时间轴里该天的记录：返回 { text, days }（没有相对时间返回 null）
function buildRelativeTimeBridge(queryText) {
    const cur = settings.storyDay;
    if (cur == null) return null;
    const lines = [];
    const days = new Set();
    const seenDay = new Set();
    const refs = parseRelativeDayRefs(queryText).map(r => ({ word: r.word, day: cur + r.offset }));
    for (const m of String(queryText || '').matchAll(/第\s*([0-9０-９零〇一二两三四五六七八九十百]+)\s*天/g)) {
        const d = parseDayNumber(m[1]);
        if (d != null && d !== cur) refs.push({ word: m[0].replace(/\s+/g, ''), day: d });
    }
    for (const r of refs) {
        if (r.day === cur || seenDay.has(r.word)) continue;
        seenDay.add(r.word);
        if (r.day < 0) { lines.push('- 「' + r.word + '」会早于故事开始，当前才第' + cur + '天，不要据此编造事件。'); continue; }
        if (r.day > cur) { lines.push('- 「' + r.word + '」指向第' + r.day + '天，但当前才第' + cur + '天，那是还没发生的未来。'); continue; }
        days.add(r.day);
        const { facts, memCount } = dayFacts(r.day);
        if (facts.length) lines.push('- 「' + r.word + '」= 第' + r.day + '天。时间线记录：' + facts.slice(0, 3).join('；'));
        else if (memCount) lines.push('- 「' + r.word + '」= 第' + r.day + '天。时间线没有具体事件，但那天有 ' + memCount + ' 段记忆，以资料里标注为第' + r.day + '天的内容为准。');
        else lines.push('- 「' + r.word + '」= 第' + r.day + '天。时间轴和记忆里没有那天的记录，不要编造那天发生了什么具体事件。');
    }
    if (!lines.length) return null;
    return { text: '时间对照（对话里出现了相对时间，已按当前第' + cur + '天换算，以此为准）：\n' + lines.join('\n'), days };
}

// 历史事实标签：【第N天 · 具体时间 · 地点】；没有发生时间的（人物/关系/世界状态）标为当前状态快照
function recallTimeLabel(it) {
    if (it.day == null && !it.time) return '【当前状态】';
    const parts = [];
    if (it.dayLabel) parts.push(it.dayLabel);
    else if (it.day != null) parts.push('第' + it.day + '天');
    if (it.time) parts.push(it.time);
    if (it.location) parts.push(it.location);
    return '【' + parts.join(' · ') + '】';
}

// 把当前角色所有可召回数据拍平成条目列表（每条 = 一个可被语义检索的文本块）
function buildRecallItems() {
    const items = [];
    const memText = (m, tier) => {
        const day = m.storyDay != null ? '第' + m.storyDay + '天' : '';
        const time = m.storyTime || '';
        const when = (day || time) ? (day + (time ? ' · ' + time : '') + '：') : '';
        return '[' + tier + '] ' + when + m.text;
    };
    const memExtra = (m, tag) => ({ tag, body: m.text, time: m.storyTime || '', location: m.storyLocation || '', dayLabel: memDayLabel(m) });
    for (const m of settings.memories) if (m && m.text) items.push(recallItem('memory', m.id, memText(m, '短期记忆'), m.importance, m.storyDay, m.entityRef, memExtra(m, '短期记忆')));
    for (const m of settings.longMemories) if (m && m.text) items.push(recallItem('long', m.id, memText(m, '长期记忆'), m.importance, m.storyDay, m.entityRef, memExtra(m, '长期记忆')));
    for (const t of settings.timeline) if (t && t.id) {
        const line = '第' + (t.day != null ? t.day : '?') + '天' + (t.time ? ' ' + t.time : '') + (t.location ? ' ' + t.location : '') + (t.event ? '：' + t.event : '');
        items.push(recallItem('timeline', t.id, '[时间线] ' + line, '', t.day, '', { tag: '时间线', body: t.event || '', time: t.time || '', location: t.location || '' }));
    }
    for (const e of settings.entities) if (e && e.id) {
        const body = entityRecallText(e);
        items.push(recallItem('entity', e.id, '[人物] ' + body, '', null, e.id, { tag: '人物档案', body }));
    }
    for (const l of settings.relationshipLines) if (l && l.id) {
        const a = resolveEntityRef(l.a).display;
        const b = resolveEntityRef(l.b).display;
        const cur = (l.current.relationship || '未知') + (l.current.affection ? '，好感' + l.current.affection : '') + (l.current.attitude ? '，态度' + l.current.attitude : '');
        items.push(recallItem('relation', l.id, '[关系] ' + a + ' → ' + b + '：' + cur, '', null, '', { tag: '关系', body: a + ' → ' + b + '：' + cur }));
    }
    for (const f of settings.foreshadows) if (f && f.id && f.status !== '已回收') {
        const body = '[' + f.status + '] ' + f.title + (f.note ? '（' + f.note + '）' : '');
        items.push(recallItem('foreshadow', f.id, '[伏笔] ' + body, '', f.day, '', { tag: '伏笔（埋下日）', body }));
    }
    for (const w of settings.worldState) if (w && w.id) items.push(recallItem('world', w.id, '[世界状态] ' + w.cat + '：' + w.text, '', null, '', { tag: '世界状态', body: w.cat + '：' + w.text }));
    return items;
}

// 向量库里的唯一键：id + 文本。id 参与哈希，避免两条文字相同的条目共用一个 hash（酒馆按 hash 删除，会误删另一条）；
// 文本参与哈希，内容一变 hash 就变，旧向量能被识别为过期并删除
function recallHash(it) {
    return getStringHash(it.id + '\u0000' + it.text);
}

// 插件当前用不了的 embedding 源 → 返回原因；可用返回 ''
// （WebLLM / KoboldCpp 需要浏览器端先算好向量再随请求带上，插件走的是纯服务端请求，两者都不支持）
function semanticSourceIssue(vs) {
    if (!vs) return '没有检测到酒馆「向量存储」扩展的设置';
    if (!vs.source) return '酒馆「向量存储」还没选择 embedding 源';
    if (vs.source === 'webllm' || vs.source === 'koboldcpp') {
        return '「' + vectorSourceLabel(vs.source) + '」源需要浏览器端先算好向量，插件暂不支持，请改用其他 embedding 源';
    }
    return '';
}

async function semanticVectorFetch(path, body, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs || 120000);
    try {
        const resp = await fetch(path, { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify(body), signal: ctrl.signal });
        if (!resp.ok) {
            const t = await resp.text().catch(() => '');
            throw new Error('HTTP ' + resp.status + (t ? '：' + String(t).slice(0, 200) : '（酒馆后台日志里有详细报错，常见原因：embedding 源没填 key / 模型名 / 接口地址）'));
        }
        return resp;
    } catch (e) {
        if (e && e.name === 'AbortError') throw new Error('请求超时');
        throw e;
    } finally {
        clearTimeout(timer);
    }
}

function semanticBody(collectionId, vs, extra) {
    const body = vectorsRequestBody({});
    body.collectionId = collectionId;
    body.source = vs.source;
    return Object.assign(body, extra || {});
}

async function semanticList(collectionId, vs) {
    const resp = await semanticVectorFetch('/api/vector/list', semanticBody(collectionId, vs));
    const data = await resp.json();
    return Array.isArray(data) ? data.map(Number) : [];
}

async function semanticInsert(collectionId, vs, items) {
    await semanticVectorFetch('/api/vector/insert', semanticBody(collectionId, vs, {
        items: items.map(x => ({ hash: x.hash, text: x.text, index: x.index })),
    }));
}

async function semanticDelete(collectionId, vs, hashes) {
    await semanticVectorFetch('/api/vector/delete', semanticBody(collectionId, vs, { hashes: hashes.map(Number) }));
}

// 删除该集合在所有 embedding 源/模型下的向量（酒馆的 purge 本来就是不分源的）
async function semanticPurge(collectionId) {
    await semanticVectorFetch('/api/vector/purge', { collectionId });
}

// 同步状态（只在内存里，用于面板显示与错误提示）
const semanticStatus = { running: false, done: 0, total: 0, error: '', errorKey: '' };
let semanticLastToast = { msg: '', at: 0 };

function semanticReportError(e, context) {
    const msg = (e && e.message) ? e.message : String(e);
    console.error('[Serendipity] 语义' + context + '失败：', e);
    semanticStatus.error = context + '失败：' + msg;
    semanticStatus.errorKey = currentDataKey();
    // 同一条错误 2 分钟内只弹一次，避免每轮都刷屏
    const now = Date.now();
    if (semanticLastToast.msg !== msg || now - semanticLastToast.at > 120000) {
        semanticLastToast = { msg, at: now };
        toastr.warning('语义' + context + '失败：' + msg, 'Serendipity', { timeOut: 8000 });
    }
    renderRecallIndexState();
}

// 同步索引：以向量库里实际存在的内容为准（/list），而不是本地快照——
// 缺的补、过期/多余/重复的删，先删后插。所以中断后重来、两个标签页同时跑、手动删过向量，结果都是对的。
// job.rebuild = 先清空该集合再全量重建；job.force = 即使没开启注入也同步
async function syncSemanticIndex(job = {}) {
    const vs = extension_settings.vectors;
    if (semanticSourceIssue(vs)) return 0;
    const sr = settings.semanticRecall;
    if (!sr || (!sr.enabled && !job.force && !job.rebuild)) return 0;
    const key = currentDataKey();
    if (!key) return 0;
    const collectionId = semanticCollectionId();
    const idx = sr.index; // 只写开始时捕获的这份聊天的索引，期间切换聊天也不会串档

    const want = new Map(); // hash → 条目
    for (const it of buildRecallItems()) {
        const h = recallHash(it);
        if (!want.has(h)) want.set(h, it);
    }

    if (job.rebuild) {
        await semanticPurge(collectionId);
        idx.items = {};
    }
    const listed = await semanticList(collectionId, vs);
    const count = new Map();
    for (const h of listed) count.set(h, (count.get(h) || 0) + 1);

    const toDelete = [];
    const toInsert = [];
    for (const [h, c] of count) if (!want.has(h) || c > 1) toDelete.push(h); // 酒馆按 hash 删，重复项只能整组删掉重插
    for (const [h, it] of want) if (!count.has(h) || count.get(h) > 1) toInsert.push({ hash: h, text: it.text, index: it.id });

    const present = new Set();
    for (const h of count.keys()) if (want.has(h) && count.get(h) === 1) present.add(h);
    const commit = () => {
        const items = {};
        for (const h of present) { const it = want.get(h); if (it) items[it.id] = h; }
        idx.items = items;
        idx.model = semanticModelSignature(vs);
        saveSettings();
    };

    semanticStatus.total = want.size;
    semanticStatus.done = present.size;
    try {
        for (let i = 0; i < toDelete.length; i += 200) {
            await semanticDelete(collectionId, vs, toDelete.slice(i, i + 200));
        }
        for (let i = 0; i < toInsert.length; i += 20) {
            const batch = toInsert.slice(i, i + 20);
            await semanticInsert(collectionId, vs, batch);
            for (const b of batch) present.add(b.hash);
            semanticStatus.done = present.size;
            if (settings.semanticRecall === sr) renderRecallIndexState();
        }
    } finally {
        commit(); // 中途失败也把已完成的部分记下来
    }
    if (settings.semanticRecall === sr) renderRecallIndexState();
    return want.size;
}

// 单飞同步：同一时间只跑一个；运行期间再来请求就合并成「跑完再补一轮」，不会丢请求也不会并发
let semanticSyncDone = null;
let semanticSyncPending = null;
function requestSemanticSync(opts = {}) {
    const key = currentDataKey();
    if (semanticSyncDone) {
        const p = semanticSyncPending;
        semanticSyncPending = {
            rebuild: !!(opts.rebuild || (p && p.rebuild)),
            force: !!(opts.force || (p && p.force)),
            key,
        };
        return semanticSyncDone;
    }
    semanticStatus.running = true;
    semanticSyncDone = (async () => {
        let job = { rebuild: !!opts.rebuild, force: !!opts.force };
        let ok = true;
        try {
            while (job) {
                semanticSyncPending = null;
                // 排队期间切到了别的聊天：不要把「重建」套到新聊天上
                if (job.rebuild && job.key && job.key !== currentDataKey()) job = { force: job.force };
                try {
                    await syncSemanticIndex(job);
                    if (semanticStatus.errorKey === currentDataKey()) semanticStatus.error = '';
                } catch (e) {
                    ok = false;
                    semanticReportError(e, job.rebuild ? '重建索引' : '索引同步');
                }
                job = semanticSyncPending;
            }
        } finally {
            semanticStatus.running = false;
            semanticSyncDone = null;
            renderRecallIndexState();
        }
        return ok;
    })();
    return semanticSyncDone;
}

// 清掉某个聊天的向量集合（重置数据时用），排在当前同步之后，避免刚清完又被写回去
function purgeSemanticCollectionLater(collectionId) {
    const run = () => semanticPurge(collectionId).catch(e => console.warn('[Serendipity] 清理向量集合失败：', e));
    if (semanticSyncDone) semanticSyncDone.then(run); else run();
}

// 近期对话 → 干净文本（去掉 <think> 和 HTML 标签；重新生成/滑动时最后一条是即将被替换的旧回复，不算）
function recentChatTexts(n, genType) {
    if (!Array.isArray(chat)) return [];
    let msgs = chat.filter(m => m && typeof m.mes === 'string' && m.mes.trim() && !m.is_system);
    if ((genType === 'regenerate' || genType === 'swipe') && msgs.length && !msgs[msgs.length - 1].is_user) msgs = msgs.slice(0, -1);
    return msgs.slice(-n).map(m => m.mes
        .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim()).filter(Boolean);
}

// 最新一条用户消息（关键词通道的查询词；没有用户消息时退回最新一条）
function latestUserText(genType) {
    if (!Array.isArray(chat)) return '';
    let msgs = chat.filter(m => m && typeof m.mes === 'string' && m.mes.trim() && !m.is_system);
    if ((genType === 'regenerate' || genType === 'swipe') && msgs.length && !msgs[msgs.length - 1].is_user) msgs = msgs.slice(0, -1);
    const last = msgs.slice(-2).reverse().find(m => m.is_user) || msgs[msgs.length - 1];
    if (!last) return '';
    const t = last.mes.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    return t.length > 300 ? t.slice(-300) : t;
}

// ---------------- 关键词通道（与向量并行，纯本地计算，不调接口、不耗 token） ----------------
// 中文取相邻两字、英文/数字取整词；用「稀有度」加权，太常见的词（的、我们、今天…）自动不计分。
// 向量擅长「意思相近」，关键词擅长「人名/地名/物品名」这类字面线索，两路用 RRF 合并。
function lexGrams(text) {
    const grams = new Set();
    const t = String(text || '').toLowerCase();
    for (const run of t.match(/[\u3400-\u9fff]+/g) || []) {
        for (let i = 0; i + 1 < run.length; i++) grams.add(run.slice(i, i + 2));
    }
    for (const w of t.match(/[a-z0-9]{2,}/g) || []) grams.add(w);
    return grams;
}

const lexItemCache = new Map();
function lexItemGrams(it) {
    const hit = lexItemCache.get(it.id);
    if (hit && hit.text === it.text) return hit.grams;
    if (lexItemCache.size > 5000) lexItemCache.clear();
    const grams = lexGrams(it.text);
    lexItemCache.set(it.id, { text: it.text, grams });
    return grams;
}

// 返回 [{ item, conf }]，按关键词相关度从高到低；conf∈(0,1] 表示这次字面命中有多可信
function lexicalRank(queryText, items, limit) {
    const q = lexGrams(queryText);
    const N = items.length;
    if (!q.size || N < 8) return [];
    const docs = items.map(it => ({ it, grams: lexItemGrams(it) }));
    const idf = new Map();
    const maxDf = Math.max(3, N * 0.15);
    for (const g of q) {
        let df = 0;
        for (const d of docs) if (d.grams.has(g)) df++;
        if (df > 0 && df <= maxDf) idf.set(g, Math.log(1 + N / df));
    }
    if (!idf.size) return [];
    const minScore = Math.log(1 + N / Math.max(2, N * 0.05)); // 至少要有「一个足够稀有的词」的分量
    const out = [];
    for (const d of docs) {
        let score = 0;
        for (const [g, w] of idf) if (d.grams.has(g)) score += w;
        if (score < minScore) continue;
        // 查询很短（比如只说了个名字）时，命中即可信；查询长时，要多个线索一起命中才给满分
        const conf = q.size <= 4 ? 1 : Math.min(1, score / (2 * minScore));
        out.push({ item: d.it, score, conf });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, limit);
}

// RRF：排名越靠前分越高。名次 1 = 20 分（和原先「相似度排序」的量纲一致，后面的重要度/时间加分不用改）
function rrfPoints(rank1) { return 20 * 11 / (10 + rank1); }

// 语义查询词：最近 3 条，总长超限时保留最新的那部分（本地 embedding 模型通常只吃前几百个 token）
function semanticQueryText(genType) {
    const text = recentChatTexts(3, genType).join('\n');
    return text.length > 700 ? text.slice(-700) : text;
}

// 近期对话里被点名的人物实体 id（用于角色加权）
function recentEntityIds() {
    const ids = new Set();
    if (!Array.isArray(chat)) return [...ids];
    const recent = chat.filter(m => m && typeof m.mes === 'string' && !m.is_system).slice(-8).map(m => m.mes).join('\n');
    for (const e of settings.entities) {
        if (e.name && recent.includes(e.name)) ids.add(e.id);
    }
    return [...ids];
}

let semanticSyncTimer = null;
function scheduleSemanticSync() {
    if (!(settings.semanticRecall && settings.semanticRecall.enabled)) return;
    if (semanticSyncTimer) clearTimeout(semanticSyncTimer);
    semanticSyncTimer = setTimeout(() => {
        semanticSyncTimer = null;
        requestSemanticSync();
    }, 800);
}

// 语义召回 + 加权重排 + 去重 + 注入正文。在每次生成真正组装提示词之前执行（GENERATION_AFTER_COMMANDS，酒馆会等它完成），
// 所以用的是这一轮刚发出的消息，而不是上一轮的
let semanticRecallSeq = 0;
async function runSemanticRecallInjection(genType) {
    const setBlock = (text) => setExtensionPrompt('serendipity_semantic_recall', text, extension_prompt_types.IN_PROMPT, 0);
    const sr = settings.semanticRecall;
    if (!sr || !sr.enabled) return;
    const vs = extension_settings.vectors;
    if (semanticSourceIssue(vs)) return;
    const keyBefore = currentDataKey();
    if (!keyBefore) return;
    const st = settings;
    const seq = ++semanticRecallSeq;
    const queryText = semanticQueryText(genType);
    if (!queryText) { setBlock(''); return; }
    try {
        const resp = await semanticVectorFetch('/api/vector/query', semanticBody(semanticCollectionId(), vs, {
            searchText: queryText,
            topK: Math.max(1, Number(sr.queryTopK) || 20),
            threshold: Number(sr.threshold) || 0,
        }), 15000);
        const data = await resp.json();
        // 查询期间切换了聊天 / 又有新的召回请求：这次结果作废
        if (currentDataKey() !== keyBefore || settings !== st || seq !== semanticRecallSeq) return;
        const meta = Array.isArray(data.metadata) ? data.metadata : [];
        const bridge = buildRelativeTimeBridge(recentChatTexts(2, genType).join('\n'));
        const allItems = buildRecallItems();
        const lex = lexicalRank(latestUserText(genType), allItems, Math.max(1, Number(sr.queryTopK) || 20));
        if (!meta.length && !bridge && !lex.length) { setBlock(''); return; }
        const itemMap = {};
        for (const it of allItems) itemMap[it.id] = it;
        const recentEnts = recentEntityIds();
        const curDay = settings.storyDay;
        const base = new Map(); // id -> { item, pts }
        meta.forEach((m, i) => {
            const it = itemMap[m.index];
            // 条目已被删改（向量库还没同步到）→ 丢弃，绝不把已删除/已改写的旧内容注入
            if (!it || Number(m.hash) !== recallHash(it)) return;
            base.set(it.id, { item: it, pts: rrfPoints(i + 1) });
        });
        lex.forEach((x, i) => {
            const cur = base.get(x.item.id);
            const pts = rrfPoints(i + 1) * x.conf;
            if (cur) cur.pts += pts; else base.set(x.item.id, { item: x.item, pts });
        });
        const scored = [];
        for (const { item: it, pts } of base.values()) {
            let score = pts;
            if (it.importance === 'S') score += 4;
            else if (it.importance === 'A') score += 2;
            if (it.day != null && curDay != null) {
                const diff = curDay - it.day;
                if (diff >= 0 && diff <= 2) score += 2;
                else if (diff > 2 && diff <= 6) score += 1;
            }
            if (it.entityRef && recentEnts.includes(it.entityRef)) score += 2;
            if (bridge && it.day != null && bridge.days.has(it.day)) score += 4; // 对话里提到的那一天的资料优先召回
            scored.push({ score, item: it });
        }

        // 去重（同一条 id、正文归一化后一致）+ 取前 topK
        const picked = [];
        const seenId = new Set();
        const seenText = new Set();
        const budget = sr.charBudget != null ? Number(sr.charBudget) : 1500;
        let used = 0;
        for (const x of scored.sort((a, b) => b.score - a.score)) {
            const norm = x.item.body.replace(/\s+/g, '');
            if (seenId.has(x.item.id) || seenText.has(norm)) continue;
            // 字数预算：放不下的长条目跳过、继续试后面更短的；第一条无论多长都保留，保证至少有一条
            if (budget > 0 && picked.length && used + x.item.body.length > budget) continue;
            seenId.add(x.item.id);
            seenText.add(norm);
            picked.push(x);
            used += x.item.body.length;
            if (picked.length >= (Number(sr.topK) || 4)) break;
        }

        if (!picked.length && !bridge) { setBlock(''); return; }
        // 每条 = 【发生时间】+ 类型 + 正文；时间来自结构化元数据，不依赖模型从正文里自己推断
        const lines = picked.map((x, i) => {
            const it = x.item;
            return (i + 1) + '. ' + recallTimeLabel(it) + '\n   ' + (it.tag ? '[' + it.tag + '] ' : '') + it.body;
        });
        const nowLine = curDay != null
            ? '当前剧情时间：第' + curDay + '天' + (settings.storyTime ? ' · ' + settings.storyTime : '') + (settings.storyLocation ? ' · ' + settings.storyLocation : '') + '\n'
            : '';
        const block = '[Serendipity 语义召回]\n'
            + '以下内容均为历史资料，仅用于保持剧情连续。\n'
            + nowLine
            + '重要规则：\n'
            + '1. 每条历史资料的发生时间以前面【】中的标注为准。\n'
            + '2. 历史事件不得因为当前语境而被重新归入今天、昨晚、昨天等时间。\n'
            + '3. 若某条资料标注的是过去的某一天，即使当前剧情已推进到之后的日期，也必须视为那一天发生的事情。\n'
            + '4. 不要把“曾经发生过”理解成“最近发生过”。\n'
            + '5. 若当前剧情没有明确说明某件事再次发生，不得认为它在当前时间重新发生。\n'
            + '6. 标注为【当前状态】的是现状快照，不是某个具体时间发生的事件。\n'
            + '7. 若无法确认某个相对时间（如“昨天”“前天”）对应的具体事件，避免主动补充具体的历史事件。\n'
            + (bridge ? bridge.text + '\n' : '')
            + (lines.length ? '资料：\n' + lines.join('\n') : '');
        setBlock(block);
        if (semanticStatus.errorKey === keyBefore && /召回/.test(semanticStatus.error)) { semanticStatus.error = ''; renderRecallIndexState(); }
    } catch (e) {
        // 召回失败时清掉旧块：宁可这一轮没有召回，也不能带着上一轮的旧资料
        if (seq === semanticRecallSeq && currentDataKey() === keyBefore) setBlock('');
        semanticReportError(e, '召回');
    }
}

// 面板里显示索引状态
function renderRecallIndexState() {
    const el = $('#st-serendipity .st-sd__recall-index-state');
    if (!el.length) return;
    const sr = settings.semanticRecall;
    const vs = extension_settings.vectors;
    const issue = semanticSourceIssue(vs);
    if (issue) { el.text(issue + '，无法建立索引。'); return; }
    const n = (sr && sr.index && sr.index.items) ? Object.keys(sr.index.items).length : 0;
    let text;
    if (semanticStatus.running) text = '正在同步索引…' + (semanticStatus.total ? '（' + semanticStatus.done + ' / ' + semanticStatus.total + '）' : '');
    else if (!sr.enabled) text = '注入关闭中，开启后自动建索引。';
    else text = '已索引 ' + n + ' 条（源：' + vectorSourceLabel(vs.source) + '）';
    if (!semanticStatus.running && semanticStatus.error && semanticStatus.errorKey === currentDataKey()) text += ' ⚠ ' + semanticStatus.error;
    el.text(text);
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
let npcEditingId = null; // 当前编辑中的人物档案 id

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
                return '<div class="st-sd__world-item is-editing" data-id="' + e.id + '">'
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

// 角色实体（列表：姓名 / 身份域 / 年龄 / 简介）
function renderNpcs() {
    const list = $('#st-serendipity .st-sd__npc-list');
    if (!list.length) return;
    $('#st-serendipity .st-sd__npc-auto').prop('checked', !!settings.autoRegisterEntities);
    if (!settings.entities.length) {
        list.html('<div class="st-sd__empty">暂无人物档案。总结时若出现新人物可手动登记，或在上方添加。</div>');
        return;
    }
    list.html(settings.entities.map(n => {
        if (n.id === npcEditingId) {
            return '<div class="st-sd__npc-item is-editing" data-id="' + n.id + '">'
                + '<input type="text" class="st-sd__npc-e-name" value="' + escapeHtml(n.name) + '" placeholder="姓名">'
                + '<input type="text" class="st-sd__npc-e-world" value="' + escapeHtml(n.world) + '" placeholder="世界/平行世界">'
                + '<input type="text" class="st-sd__npc-e-timeline" value="' + escapeHtml(n.timeline) + '" placeholder="时间线/前世今生">'
                + '<input type="text" class="st-sd__npc-e-identity" value="' + escapeHtml(n.identity) + '" placeholder="身份/职业">'
                + '<input type="text" class="st-sd__npc-e-age" value="' + escapeHtml(n.age) + '" placeholder="年龄">'
                + '<input type="text" class="st-sd__npc-e-note" value="' + escapeHtml(n.note) + '" placeholder="简介">'
                + '<input type="text" class="st-sd__npc-e-body" value="' + escapeHtml(n.body) + '" placeholder="身体（受伤/中毒/健康…）">'
                + '<input type="text" class="st-sd__npc-e-mind" value="' + escapeHtml(n.mind) + '" placeholder="心理（焦虑/放松…）">'
                + '<input type="text" class="st-sd__npc-e-goal" value="' + escapeHtml(n.goal) + '" placeholder="目标">'
                + '<input type="text" class="st-sd__npc-e-secret" value="' + escapeHtml(n.secret) + '" placeholder="秘密">'
                + '<input type="text" class="st-sd__npc-e-promise" value="' + escapeHtml(n.promise) + '" placeholder="承诺">'
                + '<span class="st-sd__memory-actions"><button type="button" class="st-sd__npc-save" data-id="' + n.id + '">保存</button><button type="button" class="st-sd__npc-cancel">取消</button></span>'
                + '</div>';
        }
        const domain = entityDomain(n);
        const stateChips = [['身体', n.body], ['心理', n.mind], ['目标', n.goal], ['秘密', n.secret], ['承诺', n.promise]]
            .filter(x => x[1])
            .map(x => '<span class="st-sd__npc-state">' + x[0] + '：' + escapeHtml(x[1]) + '</span>')
            .join('');
        return '<div class="st-sd__npc-item" data-id="' + n.id + '">'
            + '<span class="st-sd__npc-name">' + escapeHtml(n.name) + '</span>'
            + (domain ? '<span class="st-sd__npc-domain">' + escapeHtml(domain) + '</span>' : '')
            + (n.age ? '<span class="st-sd__npc-age">' + escapeHtml(n.age) + '岁</span>' : '')
            + (n.note ? '<span class="st-sd__npc-note">' + escapeHtml(n.note) + '</span>' : '')
            + stateChips
            + '<span class="st-sd__memory-actions"><button type="button" class="st-sd__npc-edit" data-id="' + n.id + '">编辑</button><button type="button" class="st-sd__npc-del" data-id="' + n.id + '">删除</button></span>'
            + '</div>';
    }).join(''));
}

// 待人工确认的同名角色归属（列表：每个待确认项列出候选实体 + 「新建独立」）
function renderPendingAssignments() {
    const box = $('#st-serendipity .st-sd__pending');
    if (!box.length) return;
    const pend = settings.pendingEntityAssignments;
    if (!pend.length) { box.html(''); return; }
    box.html(pend.map(p => {
        const domainParts = [p.world, p.timeline, p.identity].filter(Boolean);
        const domainText = domainParts.length ? domainParts.join('·') : '未给出身份域';
        const candBtns = p.candidates.map(cid => {
            const e = settings.entities.find(x => x.id === cid);
            if (!e) return '';
            const ed = entityDomain(e);
            const label = e.name + (ed ? '（' + ed + '）' : '（无身份域）');
            return '<button type="button" class="st-sd__pend-merge" data-id="' + escapeHtml(p.id) + '" data-cid="' + escapeHtml(cid) + '">归到 ' + escapeHtml(label) + '</button>';
        }).join('');
        return '<div class="st-sd__pend-item" data-id="' + escapeHtml(p.id) + '">'
            + '<div class="st-sd__pend-head">⚠ 同名角色「' + escapeHtml(p.name) + '」待确认归属 <span class="st-sd__pend-domain">' + escapeHtml(domainText) + '</span></div>'
            + '<div class="st-sd__pend-actions">' + candBtns
            + '<button type="button" class="st-sd__pend-new" data-id="' + escapeHtml(p.id) + '">新建独立实体</button>'
            + '<button type="button" class="st-sd__pend-skip" data-id="' + escapeHtml(p.id) + '">忽略</button>'
            + '</div>'
            + '</div>';
    }).join(''));
}

// 「人物」页统一渲染：人物档案 + 关系线 + 物品/日程
function renderPeople() {
    renderNpcs();
    renderPendingAssignments();
    renderRelationship();
    renderWorldState();
}

// 刷新关系线建立区的人物下拉（「你」+ 所有角色实体）
function renderRelSelects() {
    const opts = ['<option value="你">你</option>']
        .concat(settings.entities.slice().sort((x, y) => x.name.localeCompare(y.name, 'zh')).map(e => {
            const domain = entityDomain(e);
            const label = e.name + (domain ? '（' + domain + '）' : '');
            return '<option value="@' + e.id + '">' + escapeHtml(label) + '</option>';
        }));
    const html = opts.join('');
    $('#st-serendipity .st-sd__rel-a').html(html);
    $('#st-serendipity .st-sd__rel-b').html(html);
}

// 情感线 / 关系轨迹（列表：每条线一张卡片，含当前关系 + 历史轨迹）
function renderRelationship() {
    const list = $('#st-serendipity .st-sd__rel-list');
    if (!list.length) return;
    renderRelSelects();
    if (!settings.relationshipLines.length) {
        list.html('<div class="st-sd__empty">暂无关系线。总结时若发现人物关系变化会自动建立，或在上方手动建立。</div>');
        return;
    }
    const affClass = v => {
        const n = parseInt(String(v).replace(/[＋]/g, '+').replace(/[－−–]/g, '-'), 10);
        return isNaN(n) || n === 0 ? '' : (n > 0 ? ' st-sd__rel-chip--pos' : ' st-sd__rel-chip--neg');
    };
    let html = '';
    for (const l of settings.relationshipLines) {
        const hist = l.history.slice().sort((a, b) => (a.day == null ? 1 : 0) - (b.day == null ? 1 : 0) || (a.day || 0) - (b.day || 0));
        html += '<div class="st-sd__rel-item" data-id="' + l.id + '">';
        html += '<div class="st-sd__rel-head">'
            + '<span class="st-sd__rel-pair">' + escapeHtml(resolveEntityRef(l.a).display) + ' <span class="st-sd__rel-arrow">→</span> ' + escapeHtml(resolveEntityRef(l.b).display) + '</span>'
            + '<button type="button" class="st-sd__rel-del" data-id="' + l.id + '">删除</button>'
            + '</div>';
        html += '<div class="st-sd__rel-chips">'
            + '<span class="st-sd__rel-chip"><em>关系</em>' + escapeHtml(l.current.relationship || '未知') + '</span>'
            + (l.current.affection ? '<span class="st-sd__rel-chip' + affClass(l.current.affection) + '"><em>好感</em>' + escapeHtml(l.current.affection) + '</span>' : '')
            + (l.current.attitude ? '<span class="st-sd__rel-chip"><em>态度</em>' + escapeHtml(l.current.attitude) + '</span>' : '')
            + '</div>';
        if (hist.length) {
            html += '<div class="st-sd__rel-hist">';
            for (const h of hist) {
                const day = h.day != null ? '第' + h.day + '天' : '—';
                const reason = h.reason + (h.event ? (h.reason ? ' · ' : '') + '「' + h.event + '」' : '');
                html += '<div class="st-sd__rel-row">'
                    + '<div class="st-sd__rel-row-top">'
                    + '<span class="st-sd__rel-day">' + day + '</span>'
                    + '<span class="st-sd__rel-to">' + escapeHtml(h.to || h.change || '变化') + '</span>'
                    + (h.affection ? '<span class="st-sd__rel-delta' + affClass(h.affection) + '">' + escapeHtml(h.affection) + '</span>' : '')
                    + '<button type="button" class="st-sd__rel-row-del" data-id="' + h.id + '">删除</button>'
                    + '</div>'
                    + (reason ? '<div class="st-sd__rel-reason">' + escapeHtml(reason) + '</div>' : '')
                    + '</div>';
            }
            html += '</div>';
        }
        html += '<div class="st-sd__rel-addhist">'
            + '<input type="text" class="st-sd__rel-hist-input" placeholder="补记一条变化（如：确认恋爱关系 / 因误会疏远）">'
            + '<button type="button" class="st-sd__rel-hist-add" data-id="' + l.id + '">补记</button>'
            + '</div>';
        html += '</div>';
    }
    list.html(html);
}

// 导出全部记忆为 txt 文件
function exportMemories() {
    const lines = ['Serendipity 剧情记忆·时间线·人物·世界状态导出', '导出时间：' + fmtTime(Date.now()), ''];

    const tier = (title, arr) => {
        if (!arr.length) return;
        lines.push('========== ' + title + ' ==========');
        for (const m of arr) {
            const impTag = m.importance === 'S' ? '[S·不能忘] ' : m.importance === 'A' ? '[A·重要] ' : '';
            const ent = settings.entities.find(e => e.id === m.entityRef);
            const entTag = ent ? '[关于 ' + ent.name + '] ' : '';
            lines.push(entTag + impTag + '[' + fmtTime(m.time) + ']');
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

    // 人物档案（角色实体）
    lines.push('========== 人物档案 ==========');
    if (settings.entities.length) {
        for (const n of settings.entities) {
            const domain = entityDomain(n);
            lines.push(n.name + (domain ? '（' + domain + '）' : '') + (n.age ? '（' + n.age + '岁）' : '') + (n.note ? ' · ' + n.note : '')
                + (n.body ? ' · 身体：' + n.body : '') + (n.mind ? ' · 心理：' + n.mind : '')
                + (n.goal ? ' · 目标：' + n.goal : '') + (n.secret ? ' · 秘密：' + n.secret : '') + (n.promise ? ' · 承诺：' + n.promise : ''));
        }
    } else {
        lines.push('（暂无）');
    }

    // 世界状态
    lines.push('');
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

    // 情感线 / 关系轨迹
    lines.push('');
    lines.push('========== 情感线 / 关系轨迹 ==========');
    if (settings.relationshipLines.length) {
        for (const l of settings.relationshipLines) {
            lines.push(resolveEntityRef(l.a).display + ' → ' + resolveEntityRef(l.b).display + '：关系 ' + (l.current.relationship || '未知')
                + (l.current.affection ? '，好感 ' + l.current.affection : '')
                + (l.current.attitude ? '，态度 ' + l.current.attitude : ''));
            const hist = l.history.slice().sort((a, b) => (a.day == null ? 1 : 0) - (b.day == null ? 1 : 0) || (a.day || 0) - (b.day || 0));
            for (const h of hist) {
                const day = h.day != null ? '第' + h.day + '天' : '—';
                lines.push('  ' + day + '  ' + (h.to || h.change || '变化')
                    + (h.reason ? '（' + h.reason + '）' : '')
                    + (h.event ? '「' + h.event + '」' : ''));
            }
            lines.push('');
        }
    } else {
        lines.push('（暂无）');
    }

    // 伏笔/未完成事项
    lines.push('');
    lines.push('========== 伏笔 / 未完成事项 ==========');
    if (settings.foreshadows.length) {
        for (const f of settings.foreshadows) {
            lines.push('[' + f.status + '] ' + f.title + (f.note ? '（' + f.note + '）' : ''));
        }
    } else {
        lines.push('（暂无）');
    }

    // 剧情一致性检查
    lines.push('');
    lines.push('========== 剧情一致性检查 ==========');
    if (settings.checks.length) {
        for (const c of settings.checks) {
            lines.push('⚠ [' + (CHECK_TYPE_LABELS[c.type] || '其他') + '] ' + c.text);
        }
    } else {
        lines.push('（无冲突）');
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
        importance: 'S',
        entityRef: inferMemoryEntity(text),
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
    if (!confirm('确定清空「' + name + '」的全部 Serendipity 数据吗？这个聊天的记忆、时间轴、人物、世界状态等都会被清空，且不可撤销（屏蔽词和指令是全局/角色级设置，不受影响）。')) return;
    const keepWorldBook = settings.worldBook;
    const hadIndex = !!(settings.semanticRecall && (settings.semanticRecall.enabled || Object.keys(settings.semanticRecall.index.items).length));
    const collectionId = semanticCollectionId();
    Object.assign(settings, freshCharSettings());
    settings.worldBook = keepWorldBook; // 保留用户选择的世界书，方便下次直接注入
    saveSettings();
    if (hadIndex) purgeSemanticCollectionLater(collectionId);
    setExtensionPrompt('serendipity_semantic_recall', '', extension_prompt_types.IN_PROMPT, 0);
    updatePromptInjection();
    renderMemories();
    renderTimeAxis();
    renderPeople();
    renderBlockedWords();
    renderInstructions();
    renderForeshadows();
    renderChecks();
    toastr.success('已清空「' + name + '」的 Serendipity 数据');
}

// ---------------- 屏蔽词功能 ----------------
const CENSOR_EXCLUDE = 'script, style, textarea, input, select, option, #st-serendipity, .st-sd, [contenteditable]';

let censorRegexCache = { key: '', re: null, test: null };
function censorRegex() {
    const words = censorOn() ? blockedWordList().filter(Boolean) : [];
    if (!words.length) return null;
    const key = words.join('\u0000');
    if (censorRegexCache.key !== key) {
        const src = [...words].sort((a, b) => b.length - a.length).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
        censorRegexCache = { key, re: new RegExp(src, 'g'), test: new RegExp(src) };
    }
    return censorRegexCache;
}
function censorText(text) {
    const c = censorRegex();
    return c ? text.replace(c.re, '') : text;
}

function censorTextInNode(node) {
    if (!censorRegex()) return;
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
            return censorRegex().test.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        },
    });
    let n;
    while ((n = walker.nextNode())) {
        n.nodeValue = censorText(n.nodeValue);
    }
}

function applyCensorAll() {
    syncCensorObserver();
    if (!censorRegex()) return;
    censorTextInNode(document.body);
}

// 观察器只在「屏蔽开启且有屏蔽词」时运行；变动先攒起来，下一帧统一处理（流式输出时不会每个字都扫一遍）
let censorObserver = null;
let censorPending = new Set();
let censorRaf = 0;
function flushCensor() {
    censorRaf = 0;
    const nodes = censorPending;
    censorPending = new Set();
    if (!censorRegex()) return;
    for (const n of nodes) {
        if (n.isConnected) censorTextInNode(n);
    }
    if (censorObserver) censorObserver.takeRecords(); // 丢弃我们自己改文本产生的变动
}
function syncCensorObserver() {
    const need = !!censorRegex();
    if (need && !censorObserver) {
        censorObserver = new MutationObserver((mutations) => {
            for (const m of mutations) {
                if (m.type === 'characterData') censorPending.add(m.target);
                else for (const node of m.addedNodes) censorPending.add(node);
            }
            if (!censorRaf) censorRaf = requestAnimationFrame(flushCensor);
        });
        censorObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
    } else if (!need && censorObserver) {
        censorObserver.disconnect();
        censorObserver = null;
        censorPending.clear();
        if (censorRaf) { cancelAnimationFrame(censorRaf); censorRaf = 0; }
    }
}

function renderBlockedWords() {
    const list = $('#st-serendipity .st-sd__word-list');
    if (!list.length) return;
    const words = blockedWordList();
    if (!words.length) {
        list.html('<div class="st-sd__empty">还没有屏蔽词，输入后点击「添加」</div>');
        return;
    }
    const items = words.map(w =>
        `<span class="st-sd__word"><span class="st-sd__word-text">${escapeHtml(w)}</span><button type="button" class="st-sd__word-del" data-word="${escapeHtml(w)}">×</button></span>`
    ).join('');
    list.html(items);
}

function renderInstructions() {
    const list = $('#st-serendipity .st-sd__instr-list');
    if (!list.length) return;
    const instrs = instructionList();
    if (!instrs.length) {
        list.html('<div class="st-sd__empty">还没有指令，输入后点击「添加」</div>');
        return;
    }
    const items = instrs.map(it => {
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

// ---------------- 一致性检查 UI ----------------
function updateCheckBadge() {
    const tab = $('#st-serendipity .st-sd__tab[data-tab="check"]');
    if (!tab.length) return;
    const n = settings.checks.length;
    tab.html(n ? ('检查<span class="st-sd__tab-badge">' + n + '</span>') : '检查');
    tab.toggleClass('st-sd__tab--warn', n > 0);
}

function renderChecks() {
    const list = $('#st-serendipity .st-sd__check-list');
    if (!list.length) return;
    updateCheckBadge();
    const toggle = $('#st-serendipity .st-sd__check-toggle');
    if (toggle.length) toggle.prop('checked', !!settings.injectChecks);
    $('#st-serendipity .st-sd__fix-toggle').prop('checked', !!settings.autoFixTime);
    if (!settings.checks.length) {
        list.html('<div class="st-sd__empty">暂无冲突。点上方「立即检查」让模型对照时间线/世界状态/记忆排查矛盾（每次只调用一次模型）。</div>');
        return;
    }
    list.html(settings.checks.map(c => {
        const label = CHECK_TYPE_LABELS[c.type] || '其他';
        const cls = c.type === 'time' ? 'st-sd__check--time' : (c.type === 'state' ? 'st-sd__check--state' : 'st-sd__check--other');
        return '<div class="st-sd__check ' + cls + '" data-id="' + c.id + '">'
            + '<span class="st-sd__check-badge">⚠ ' + escapeHtml(label) + '</span>'
            + '<span class="st-sd__check-text">' + escapeHtml(c.text) + '</span>'
            + '<button type="button" class="st-sd__check-del" data-id="' + c.id + '" title="忽略此条">×</button>'
            + '</div>';
    }).join(''));
}

// ---------------- 伏笔/未完成事项 UI ----------------
let foreshadowEditingId = null; // 当前编辑中的伏笔条目 id

function updateForeshadowBadge() {
    const tab = $('#st-serendipity .st-sd__tab[data-tab="fore"]');
    if (!tab.length) return;
    const n = settings.foreshadows.filter(f => f.status !== '已回收').length;
    tab.html(n ? ('伏笔<span class="st-sd__tab-badge">' + n + '</span>') : '伏笔');
    tab.toggleClass('st-sd__tab--warn', n > 0);
}

function renderForeshadows() {
    const list = $('#st-serendipity .st-sd__fore-list');
    if (!list.length) return;
    const toggle = $('#st-serendipity .st-sd__fore-toggle');
    if (toggle.length) toggle.prop('checked', !!settings.injectForeshadows);
    updateForeshadowBadge();
    if (!settings.foreshadows.length) {
        list.html('<div class="st-sd__empty">暂无伏笔。把还没揭晓的悬念 / 未完成的承诺记下来，之后回来切换状态回收。</div>');
        return;
    }
    const order = { '未揭示': 0, '进行中': 1, '未解决': 2, '已回收': 3 };
    const items = settings.foreshadows.slice().sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
    list.html(items.map(f => {
        if (f.id === foreshadowEditingId) {
            return '<div class="st-sd__fore st-sd__fore--edit" data-id="' + f.id + '">'
                + '<input type="text" class="st-sd__fore-e-title" value="' + escapeHtml(f.title) + '" placeholder="伏笔/未完成事项">'
                + '<input type="text" class="st-sd__fore-e-note" value="' + escapeHtml(f.note) + '" placeholder="备注（可选）">'
                + '<div class="st-sd__fore-actions"><button type="button" class="st-sd__fore-save" data-id="' + f.id + '">保存</button><button type="button" class="st-sd__fore-cancel">取消</button></div>'
                + '</div>';
        }
        const cls = f.status === '已回收' ? 'st-sd__fore-status--done' : 'st-sd__fore-status--open';
        return '<div class="st-sd__fore" data-id="' + f.id + '">'
            + '<div class="st-sd__fore-head">'
            + '<button type="button" class="st-sd__fore-status ' + cls + '" data-id="' + f.id + '" title="点击切换状态（' + FORESHADOW_STATUSES.join(' / ') + '）">' + escapeHtml(f.status) + '</button>'
            + '<span class="st-sd__fore-title">' + escapeHtml(f.title) + '</span>'
            + '<span class="st-sd__memory-actions"><button type="button" class="st-sd__fore-edit" data-id="' + f.id + '">编辑</button><button type="button" class="st-sd__fore-del" data-id="' + f.id + '">删除</button></span>'
            + '</div>'
            + (f.note ? '<div class="st-sd__fore-note">' + escapeHtml(f.note) + '</div>' : '')
            + '</div>';
    }).join(''));
}

function cycleForeshadowStatus(f) {
    const i = FORESHADOW_STATUSES.indexOf(f.status);
    f.status = FORESHADOW_STATUSES[(i + 1) % FORESHADOW_STATUSES.length];
}

// ---------------- 主题（仅本机偏好，存于全局设置，不进入任何聊天数据） ----------------
const THEMES = [
    { id: 'quiet', name: '静谧', desc: '暖白 · 灰玫瑰 · 编辑式排版（默认）', layout: 'plain', sw: ['#F8F6F2', '#CDB3B0', '#292724'] },
    { id: 'peach', name: '蜜桃牛奶', desc: '奶粉色 · 圆润卡片 · 软萌字体', layout: 'soft', sw: ['#FFF4F1', '#F59BB0', '#D4597A'] },
    { id: 'mint', name: '薄荷汽水', desc: '清爽薄荷 · 圆润卡片', layout: 'soft', sw: ['#F0FAF6', '#7CCBB0', '#2A8A6D'] },
    { id: 'lavender', name: '薰衣草', desc: '淡紫梦境 · 圆润卡片', layout: 'soft', sw: ['#F6F3FD', '#B7A3EB', '#7357C9'] },
    { id: 'cream', name: '奶油布丁', desc: '暖黄奶油 · 圆润卡片 · 衬线标题', layout: 'soft', sw: ['#FFF9EC', '#F2B84B', '#B97A12'] },
    { id: 'sky', name: '云朵蓝', desc: '白 · 浅天蓝 · 简约排版', layout: 'plain', sw: ['#F7FAFD', '#9CC0E6', '#3F78B3'] },
];

function currentThemeId() {
    const id = globalSettings && globalSettings.shared && globalSettings.shared.theme;
    return THEMES.some(t => t.id === id) ? id : 'quiet';
}

function applyTheme() {
    const t = THEMES.find(x => x.id === currentThemeId()) || THEMES[0];
    $('#st-serendipity').attr('data-sd-theme', t.id).attr('data-sd-layout', t.layout);
}

function renderThemePicker() {
    const cur = currentThemeId();
    const items = THEMES.map(t => `
        <button type="button" class="st-sd__theme-item${t.id === cur ? ' is-active' : ''}" data-theme="${t.id}">
          <span class="st-sd__theme-sw">${t.sw.map(c => `<i style="background:${c}"></i>`).join('')}</span>
          <span class="st-sd__theme-txt"><span class="st-sd__theme-name">${t.name}</span><span class="st-sd__theme-desc">${t.desc}</span></span>
          <span class="st-sd__theme-tick">✓</span>
        </button>`).join('');
    $('#st-serendipity .st-sd__theme-pop').html('<div class="st-sd__theme-pop-title">选择主题（只影响本机显示）</div>' + items);
}

function toggleThemePicker(force) {
    const pop = $('#st-serendipity .st-sd__theme-pop');
    const open = force === undefined ? !pop.hasClass('is-open') : force;
    if (open) renderThemePicker();
    pop.toggleClass('is-open', open);
    $('#st-serendipity .st-sd__theme-btn').toggleClass('is-open', open);
}

function bindThemeEvents() {
    const panel = $('#st-serendipity');
    panel.on('click', '.st-sd__theme-btn', e => { e.stopPropagation(); toggleThemePicker(); });
    panel.on('click', '.st-sd__theme-item', function (e) {
        e.stopPropagation();
        const id = String($(this).data('theme'));
        if (!THEMES.some(t => t.id === id)) return;
        globalSettings.shared.theme = id;
        saveSettings();
        applyTheme();
        renderThemePicker();
    });
    panel.on('click', e => {
        if (!$(e.target).closest('.st-sd__theme-pop, .st-sd__theme-btn').length) toggleThemePicker(false);
    });
}

function renderCharBinding() {
    const el = $('#st-serendipity .st-sd__char');
    if (el.length) el.text(activeChar ? ('绑定角色：' + activeChar) : '未绑定角色');
}

// ---------------- 图标 ----------------
const ICONS = {
    palette: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.8 1.8-1.7 0-.5-.2-.8-.5-1.2-.3-.4-.5-.7-.5-1.2 0-.9.8-1.7 1.7-1.7H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10.5" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/></svg>`,
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
          <div class="st-sd__brand">
            <span class="st-sd__title">Serendipity</span>
            <span class="st-sd__version">v${VERSION}</span>
            <button type="button" class="st-sd__chk-update" title="检查插件是否有新版本">检查更新</button>
          </div>
          <div class="st-sd__bindrow">
            <span class="st-sd__char"></span>
            <button type="button" class="st-sd__theme-btn" title="切换面板主题">${ICONS.palette}<span>主题</span></button>
            <div class="st-sd__theme-pop"></div>
          </div>
        </div>
        <button type="button" class="st-sd__close" title="关闭">${ICONS.close}</button>
      </div>
      <div class="st-sd__update" style="display:none">
        <span class="st-sd__update-text"></span>
        <button type="button" class="st-sd__update-go">立即更新</button>
        <button type="button" class="st-sd__update-reload" style="display:none">立即刷新</button>
        <button type="button" class="st-sd__update-later">稍后</button>
      </div>
      <div class="st-sd__tabs">
        <button type="button" class="st-sd__tab is-active" data-tab="memory">记忆</button>
        <button type="button" class="st-sd__tab" data-tab="summary">摘要</button>
        <button type="button" class="st-sd__tab" data-tab="recall">向量召回</button>
        <button type="button" class="st-sd__tab" data-tab="censor">屏蔽词</button>
        <button type="button" class="st-sd__tab" data-tab="instruct">指令</button>
        <button type="button" class="st-sd__tab" data-tab="time">时间轴</button>
        <button type="button" class="st-sd__tab" data-tab="people">人物</button>
        <button type="button" class="st-sd__tab" data-tab="fore">伏笔</button>
        <button type="button" class="st-sd__tab" data-tab="check">检查</button>
      </div>

      <div class="st-sd__pane" data-pane="memory">
        <div class="st-sd__story-time"></div>
        <div class="st-sd__toolbar">
          <span class="st-sd__label">自动记忆</span>
          <label class="st-sd__switch"><input type="checkbox" class="st-sd__mem-toggle"><span class="st-sd__switch-slider"></span></label>
          <button type="button" class="st-sd__summarize">立即总结</button>
          <button type="button" class="st-sd__export">导出</button>
        </div>
        <div class="st-sd__api-box">
          <button type="button" class="st-sd__api-toggle">插件 API 设置</button><span class="st-sd__api-state"></span>
          <div class="st-sd__api-form">
            <input type="text" class="st-sd__api-input st-sd__api-url" placeholder="API 地址，如 https://api.openai.com/v1" autocomplete="off">
            <input type="password" class="st-sd__api-input st-sd__api-key" placeholder="API Key" autocomplete="new-password" spellcheck="false">
            <input type="text" class="st-sd__api-input st-sd__api-model" placeholder="模型名，如 gpt-4o-mini" autocomplete="off">
            <div class="st-sd__api-btns">
              <button type="button" class="st-sd__api-save">保存</button>
              <button type="button" class="st-sd__api-test">测试</button>
              <button type="button" class="st-sd__api-clear">清除</button>
            </div>
            <div class="st-sd__hint">填 OpenAI 兼容接口（地址到 /v1 即可）。设置后，自动总结、剧情一致性检查、长期记忆压缩、聊天历史压缩全都只走这个 API，不会再回退到酒馆的聊天 API。Key 以明文保存在酒馆的设置文件里（所有角色共用），不会写进备份文件；共用/公开的酒馆实例请不要填你自己的 Key。</div>
          </div>
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
          <input type="text" class="st-sd__world-search" placeholder="搜索世界书（空格分隔多个关键词，回车选中第一个）" autocomplete="off">
          <select class="st-sd__world-select" title="选择要注入记忆的世界书"></select>
        </div>
        <div class="st-sd__world-row">
          <button type="button" class="st-sd__inject-world">注入世界书</button>
          <label class="st-sd__switch st-sd__vec-switch" title="开启后，归档条目会标记 vectorized，交给酒馆内置「向量存储」按语义召回原文（需在酒馆扩展里启用向量存储的「世界书向量化」并配好 embedding 源，否则这些条目召回不到）">
            <input type="checkbox" class="st-sd__vec-toggle"><span class="st-sd__switch-slider"></span>
          </label>
          <span class="st-sd__vec-label">归档用向量召回</span>
        </div>
        <div class="st-sd__world-alert" style="display:none"></div>
        <div class="st-sd__memory-list"></div>
        <div class="st-sd__hint">短期满 ${TIER_LIMIT} 条自动合并入长期；长期满 ${TIER_LIMIT} 条会提醒你「注入世界书」归档并清空。记忆会注入正文，防止模型失忆。</div>
        <div class="st-sd__reset-row">
          <button type="button" class="st-sd__backup-export">导出备份</button>
          <button type="button" class="st-sd__backup-import">导入备份</button>
          <input type="file" class="st-sd__backup-file" accept=".json,application/json" style="display:none">
          <button type="button" class="st-sd__reset">清空本聊天数据</button>
        </div>
        <div class="st-sd__hint">备份是一个 JSON 文件，包含全部聊天的记忆、时间轴、人物等数据以及屏蔽词、指令，不含 API Key；换设备或重装前可先导出。</div>
      </div>

      <div class="st-sd__pane" data-pane="summary" style="display:none">
        <div class="st-sd__api-box">
          <button type="button" class="st-sd__compress-api-toggle">插件 API 设置</button><span class="st-sd__compress-api-state"></span>
          <div class="st-sd__compress-api-form">
            <input type="text" class="st-sd__api-input st-sd__compress-api-url" placeholder="API 地址，如 https://api.openai.com/v1" autocomplete="off">
            <input type="password" class="st-sd__api-input st-sd__compress-api-key" placeholder="API Key（可选）" autocomplete="new-password" spellcheck="false">
            <input type="text" class="st-sd__api-input st-sd__compress-api-model" placeholder="模型名，如 gemini-flash / gpt-4o-mini" autocomplete="off">
            <div class="st-sd__api-btns">
              <button type="button" class="st-sd__compress-api-save">保存</button>
              <button type="button" class="st-sd__compress-api-test">测试</button>
              <button type="button" class="st-sd__compress-api-clear">清除</button>
            </div>
            <div class="st-sd__hint">与「记忆」页的插件 API 是同一份配置（两处改的是同一个）。OpenAI 兼容接口，地址到 /v1 即可；建议填一个便宜模型。未配置时点「压缩历史」只会提示、不会回退到聊天 API。Key 明文存在酒馆设置里，共用酒馆实例请勿填自己的 Key。</div>
          </div>
        </div>
        <div class="st-sd__compress-row">
          <span class="st-sd__label">压缩聊天</span>
          <input type="number" class="st-sd__compress-keep" min="2" max="200" step="1" title="压缩时保留最近多少条消息">
          <span class="st-sd__label">条</span>
          <button type="button" class="st-sd__compress">压缩历史</button>
        </div>
        <div class="st-sd__hint">聊天太长报错 / 卡顿时用：把前面旧消息分段总结成一段剧情摘要，只保留最近若干条，token 骤降、剧情不断。压缩前会自动下载旧消息备份；全程只走上面的「插件 API」，不碰聊天 API。</div>
        <div class="st-sd__compress-result" style="display:none"></div>
      </div>

      <div class="st-sd__pane" data-pane="recall" style="display:none">
        <div class="st-sd__recall-status"></div>

        <div class="st-sd__section-title">注入正文（自动语义召回）</div>
        <div class="st-sd__recall-inject">
          <label class="st-sd__switch"><input type="checkbox" class="st-sd__recall-inject-toggle"><span class="st-sd__switch-slider"></span></label>
          <span class="st-sd__label">生成前自动召回相关资料，注入正文</span>
        </div>
        <div class="st-sd__tune">
          <label class="st-sd__tune-cell"><span class="st-sd__tune-name">召回条数</span><input type="number" class="st-sd__recall-inject-topk" min="1" max="20" step="1"><span class="st-sd__tune-sub">最多注入几条</span></label>
          <label class="st-sd__tune-cell"><span class="st-sd__tune-name">字数预算</span><input type="number" class="st-sd__recall-inject-budget" min="0" max="20000" step="100"><span class="st-sd__tune-sub">总字数上限，0 不限</span></label>
          <label class="st-sd__tune-cell"><span class="st-sd__tune-name">候选阈值</span><input type="number" class="st-sd__recall-inject-threshold" min="0" max="1" step="0.05"><span class="st-sd__tune-sub">越低候选越多</span></label>
          <label class="st-sd__tune-cell"><span class="st-sd__tune-name">候选条数</span><input type="number" class="st-sd__recall-inject-querytopk" min="1" max="100" step="1"><span class="st-sd__tune-sub">先取多少再加权挑选</span></label>
        </div>
        <div class="st-sd__recall-rebuild-row">
          <button type="button" class="st-sd__recall-rebuild">清空并重建</button>
          <span class="st-sd__recall-index-state"></span>
        </div>
        <details class="st-sd__note"><summary>说明</summary>
          <p>把本角色当前的数据（记忆/长期记忆/时间线/人物/关系/未回收伏笔/世界状态）写进酒馆向量库的独立集合，数据变化后自动增量同步（只处理新增/改动的条目），每次生成前按最新消息语义召回。</p>
          <p>需要酒馆「扩展 → 向量存储」里配好 embedding 源（WebLLM、KoboldCpp 不支持）。每个条目首次建索引会调用一次 embedding：API 源会产生用量，本地源（Transformers/Ollama 等）免费。换源/换模型后会自动在新模型下补建索引，旧模型的向量留在原处。</p>
        </details>

        <div class="st-sd__section-title">手动预览</div>
        <div class="st-sd__recall-world-row">
          <span class="st-sd__label">范围</span>
          <select class="st-sd__recall-world" title="默认查 Serendipity 自己的索引（和实际召回用的是同一份）；也可选一本世界书，查酒馆向量存储里归档的向量"></select>
        </div>
        <input type="text" class="st-sd__recall-world-search" placeholder="搜索世界书（空格分隔多个关键词，回车选中第一个）" autocomplete="off">
        <div class="st-sd__recall-search">
          <input type="text" class="st-sd__recall-input" placeholder="输入一句话，看语义召回会带回哪几条，如「上次约定的地点」" autocomplete="off">
          <button type="button" class="st-sd__recall-run">语义搜索</button>
        </div>
        <div class="st-sd__tune st-sd__tune--2">
          <label class="st-sd__tune-cell"><span class="st-sd__tune-name">阈值</span><input type="number" class="st-sd__recall-threshold" min="0" max="1" step="0.05"><span class="st-sd__tune-sub">没结果就调到 0</span></label>
          <label class="st-sd__tune-cell"><span class="st-sd__tune-name">条数</span><input type="number" class="st-sd__recall-topk" min="1" max="20" step="1"><span class="st-sd__tune-sub">最多显示几条</span></label>
        </div>
        <details class="st-sd__note"><summary>说明</summary>
          <p>预览的调参只影响这里，不改实际召回。默认查 Serendipity 自己的索引（和实际召回是同一个集合），按语义相似度从高到低列出；只看向量相似度，不含实际注入时的重要性/时间/人物加权、关键词补充和去重。已被删改但索引还没同步的条目会标灰。</p>
          <p>选一本世界书则改查酒馆向量存储里归档的向量，需要酒馆「世界书向量化」已启用且开过至少一轮生成。没结果时把「阈值」调低到 0 试试。</p>
        </details>
        <div class="st-sd__recall-list"></div>
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
        <div class="st-sd__hint">添加后立即删除剧情与状态栏中的该词眼，并注入正文提示，禁止模型再输出这些词。屏蔽词和开关是全局的，所有角色、所有聊天共用，新开聊天不会重置。</div>
      </div>

      <div class="st-sd__pane" data-pane="instruct" style="display:none">
        <div class="st-sd__add-row">
          <input type="text" class="st-sd__instr-input" placeholder="输入一条指令，如「每次回复都用中文」">
          <button type="button" class="st-sd__add-instr">添加</button>
        </div>
        <div class="st-sd__instr-list"></div>
        <div class="st-sd__hint">指令不限制数量，每轮生成都会读取并遵守；可用每条前面的开关单独开启/关闭，删除则彻底移除。指令跟着角色卡走：同一张角色卡的所有聊天共用，新开聊天不会重置。</div>
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

      <div class="st-sd__pane" data-pane="people" style="display:none">
        <div class="st-sd__section-title">人物档案</div>
        <div class="st-sd__toolbar">
          <label class="st-sd__switch" title="开启后，每次总结会自动把在场人物登记进人物档案，并带出模型给出的年龄/简介/身份域与身体/心理/目标/秘密/承诺（身份域只补空字段、状态快照更新；同名多个按身份域自动归属，拿不准的会弹在下方待你确认）">
            <input type="checkbox" class="st-sd__npc-auto"><span class="st-sd__switch-slider"></span>
          </label>
          <span class="st-sd__label">总结时自动登记在场人物</span>
        </div>
        <div class="st-sd__add-row">
          <input type="text" class="st-sd__npc-world" placeholder="世界/平行世界（可空）">
          <input type="text" class="st-sd__npc-timeline" placeholder="时间线/前世今生（可空）">
          <input type="text" class="st-sd__npc-identity" placeholder="身份/职业（可空）">
        </div>
        <div class="st-sd__add-row">
          <input type="text" class="st-sd__npc-name" placeholder="姓名">
          <input type="text" class="st-sd__npc-age" placeholder="年龄（可空，如「24」）">
          <input type="text" class="st-sd__npc-note" placeholder="简介（可空，如「北境斥候队长」）">
          <button type="button" class="st-sd__npc-add">添加</button>
        </div>
        <details class="st-sd__note"><summary>说明</summary><p>身份域（世界·时间线·身份）用来区分同名角色：前世「沈昭·将军」与今生「沈昭·医生」是两个独立实体。身体/心理/目标/秘密/承诺是人物当前状态（总结时快照更新，其中目标/秘密/承诺会注入正文让 AI 牢记，身体/心理只在面板显示）。好感与关系在下方「关系」里按 A→B 配对维护，两者不重复。</p></details>
        <div class="st-sd__pending"></div>
        <div class="st-sd__npc-list"></div>

        <div class="st-sd__section-title">关系 / 好感</div>
        <div class="st-sd__add-row">
          <select class="st-sd__rel-a" title="人物A（谁对谁）"></select>
          <select class="st-sd__rel-b" title="人物B"></select>
          <input type="text" class="st-sd__rel-relation" placeholder="当前关系（如「暧昧」，可空）">
          <button type="button" class="st-sd__rel-add">建立关系线</button>
        </div>
        <details class="st-sd__note"><summary>说明</summary><p>关系回答「现在是什么」，情感线回答「怎么变成现在这样」。人物从下拉里选（可区分同名角色，如「沈昭（现代·医生）」与「沈昭（前世·将军）」）。总结发现关系变化时自动追加到轨迹（历史只追加、不覆盖），可手动补记、删除。</p></details>
        <div class="st-sd__rel-list"></div>

        <div class="st-sd__section-title">物品 · 日程</div>
        <div class="st-sd__add-row">
          <select class="st-sd__world-cat">
            ${WORLD_CATS.map(c => `<option value="${c}">${c}</option>`).join('')}
          </select>
          <input type="text" class="st-sd__world-input" placeholder="如：一把生锈的匕首 / 三天后在城门口见面">
          <button type="button" class="st-sd__world-add">添加</button>
        </div>
        <details class="st-sd__note"><summary>说明</summary><p>世界状态现在只放非人物信息（物品/日程），按类别分组，总结时自动快照更新。可手动添加/编辑/删除。</p></details>
        <div class="st-sd__world-list"></div>
      </div>

      <div class="st-sd__pane" data-pane="fore" style="display:none">
        <div class="st-sd__add-row">
          <input type="text" class="st-sd__fore-input" placeholder="伏笔/未完成事项，如「那封没拆的信」">
          <button type="button" class="st-sd__fore-add">添加</button>
        </div>
        <div class="st-sd__toolbar">
          <label class="st-sd__switch st-sd__fore-switch" title="开启后把未完成的伏笔注入正文提醒模型">
            <input type="checkbox" class="st-sd__fore-toggle"><span class="st-sd__switch-slider"></span>
          </label>
          <span class="st-sd__label">把未完成伏笔注入正文提醒模型</span>
        </div>
        <div class="st-sd__hint">点状态标签切换「未揭示 / 未解决 / 进行中 / 已回收」。未完成的伏笔会显示在页签角标；默认不注入正文，开启上方开关后提醒模型别遗忘、别提前说破。</div>
        <div class="st-sd__fore-list"></div>
      </div>

      <div class="st-sd__pane" data-pane="check" style="display:none">
        <div class="st-sd__toolbar">
          <span class="st-sd__label">剧情一致性</span>
          <button type="button" class="st-sd__check-run">立即检查</button>
          <button type="button" class="st-sd__check-fix" title="删除重复时间线、压回超出当前天数的数据、补全记忆缺失的天数；不改模型生成的文本">修复时间数据</button>
          <button type="button" class="st-sd__check-clear">清空</button>
        </div>
        <div class="st-sd__toolbar">
          <label class="st-sd__switch st-sd__check-switch" title="开启后把已发现的冲突注入正文提醒模型避免重犯">
            <input type="checkbox" class="st-sd__check-toggle"><span class="st-sd__switch-slider"></span>
          </label>
          <span class="st-sd__label">把冲突注入正文提醒模型</span>
        </div>
        <div class="st-sd__toolbar">
          <label class="st-sd__switch st-sd__fix-switch" title="开启后每轮总结完自动修复时间数据（默认关，只检测提醒）">
            <input type="checkbox" class="st-sd__fix-toggle"><span class="st-sd__switch-slider"></span>
          </label>
          <span class="st-sd__label">每轮总结后自动修复时间数据</span>
        </div>
        <div class="st-sd__hint">让模型对照「当前时间轴 + 已有时间线/世界状态/记忆」排查矛盾（如：记忆里第12天发生的事、当前才第10天；某人已离开却仍出场）。只在点按钮时调用一次模型；开启上方开关后，已发现的冲突会注入每轮正文提醒模型避免重犯。</div>
        <div class="st-sd__check-list"></div>
      </div>
    </div>`;
    $('body').append(html);
    bindPanelEvents();
    bindThemeEvents();
    applyTheme();
}

function bindPanelEvents() {
    const panel = $('#st-serendipity');

    // 开关
    panel.find('.st-sd__mem-toggle').on('change', function () {
        settings.memoryEnabled = this.checked;
        saveSettings();
        updatePromptInjection();
    });
    panel.find('.st-sd__censor-toggle').prop('checked', censorOn()).on('change', function () {
        sharedPrefs().censorEnabled = this.checked;
        saveSettings();
        updatePromptInjection();
        if (this.checked) applyCensorAll(); else syncCensorObserver();
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
        if (name === 'recall') renderRecall();
    });

    // 立即总结
    panel.find('.st-sd__summarize').on('click', () => {
        if (!apiConfigured()) { toastr.warning('请先在「记忆」页配置插件 API（不会回退到聊天 API）'); return; }
        summarizeLastRound();
    });
    // 导出记忆
    panel.find('.st-sd__export').on('click', exportMemories);
    // 插件 API 设置
    const refreshApiState = () => {
        const c = getApiCfg();
        panel.find('.st-sd__api-state').text(apiConfigured() ? '已启用：' + c.model : '未设置（不会用聊天 API）');
    };
    {
        const c = getApiCfg();
        panel.find('.st-sd__api-url').val(c.url || '');
        panel.find('.st-sd__api-key').val(c.key || '');
        panel.find('.st-sd__api-model').val(c.model || '');
        refreshApiState();
    }
    panel.find('.st-sd__api-toggle').on('click', () => panel.find('.st-sd__api-form').toggleClass('open'));
    panel.find('.st-sd__api-save').on('click', () => {
        const root = (extension_settings[extensionName] = extension_settings[extensionName] || {});
        root.api = {
            url: String(panel.find('.st-sd__api-url').val() || '').trim(),
            key: String(panel.find('.st-sd__api-key').val() || '').trim(),
            model: String(panel.find('.st-sd__api-model').val() || '').trim(),
        };
        saveSettings();
        refreshApiState();
        toastr.success(apiConfigured() ? '插件 API 已保存' : '地址或模型为空，所有需要 API 的功能将跳过/提示');
    });
    panel.find('.st-sd__api-clear').on('click', () => {
        const root = (extension_settings[extensionName] = extension_settings[extensionName] || {});
        delete root.api;
        panel.find('.st-sd__api-url, .st-sd__api-key, .st-sd__api-model').val('');
        saveSettings();
        refreshApiState();
        toastr.info('已清除插件 API');
    });
    panel.find('.st-sd__api-test').on('click', async () => {
        const url = String(panel.find('.st-sd__api-url').val() || '').trim();
        const model = String(panel.find('.st-sd__api-model').val() || '').trim();
        if (!url || !model) { toastr.warning('请先填写 API 地址和模型名'); return; }
        const root = (extension_settings[extensionName] = extension_settings[extensionName] || {});
        const backup = root.api;
        root.api = { url, key: String(panel.find('.st-sd__api-key').val() || '').trim(), model };
        try {
            const out = await callCustomApi({ prompt: '请回复"OK"两个字母。' });
            toastr.success('连接成功：' + String(out).trim().slice(0, 30));
        } catch (e) {
            toastr.error('连接失败：' + safeErrorText(e, root.api && root.api.key) + '（若是跨域/CORS 报错，换一个允许浏览器直连的中转地址）');
        } finally {
            if (backup) root.api = backup; else delete root.api;
        }
    });
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
    // 摘要（压缩）API：与「插件 API」共用同一份配置（root.api），两个面板改的是同一个，压缩绝不回退到聊天 API
    const refreshCompressApiState = () => {
        const c = getApiCfg();
        panel.find('.st-sd__compress-api-state').text(apiConfigured() ? '已启用：' + c.model : '未设置（不会用聊天 API）');
    };
    {
        const c = getApiCfg();
        panel.find('.st-sd__compress-api-url').val(c.url || '');
        panel.find('.st-sd__compress-api-key').val(c.key || '');
        panel.find('.st-sd__compress-api-model').val(c.model || '');
        panel.find('.st-sd__compress-keep').val(settings.compressKeep || COMPRESS_KEEP_DEFAULT);
        refreshCompressApiState();
        renderCompressResult();
    }
    panel.find('.st-sd__compress-api-toggle').on('click', () => panel.find('.st-sd__compress-api-form').toggleClass('open'));
    panel.find('.st-sd__compress-api-save').on('click', () => {
        const root = (extension_settings[extensionName] = extension_settings[extensionName] || {});
        root.api = {
            url: String(panel.find('.st-sd__compress-api-url').val() || '').trim(),
            key: String(panel.find('.st-sd__compress-api-key').val() || '').trim(),
            model: String(panel.find('.st-sd__compress-api-model').val() || '').trim(),
        };
        saveSettings();
        refreshApiState();
        refreshCompressApiState();
        toastr.success(apiConfigured() ? '插件 API 已保存' : '地址或模型为空，压缩将只提示、不调用任何 API');
    });
    panel.find('.st-sd__compress-api-clear').on('click', () => {
        const root = (extension_settings[extensionName] = extension_settings[extensionName] || {});
        delete root.api;
        panel.find('.st-sd__compress-api-url, .st-sd__compress-api-key, .st-sd__compress-api-model').val('');
        saveSettings();
        refreshApiState();
        refreshCompressApiState();
        toastr.info('已清除插件 API');
    });
    panel.find('.st-sd__compress-api-test').on('click', async () => {
        const url = String(panel.find('.st-sd__compress-api-url').val() || '').trim();
        const model = String(panel.find('.st-sd__compress-api-model').val() || '').trim();
        if (!url || !model) { toastr.warning('请先填写 API 地址和模型名'); return; }
        const root = (extension_settings[extensionName] = extension_settings[extensionName] || {});
        const backup = root.api;
        root.api = { url, key: String(panel.find('.st-sd__compress-api-key').val() || '').trim(), model };
        try {
            const out = await callCustomApi({ prompt: '请回复"OK"两个字母。', cfg: root.api });
            toastr.success('连接成功：' + String(out).trim().slice(0, 30));
        } catch (e) {
            toastr.error('连接失败：' + safeErrorText(e, root.api && root.api.key) + '（若是跨域/CORS 报错，换一个允许浏览器直连的中转地址）');
        } finally {
            if (backup) root.api = backup; else delete root.api;
        }
    });
    // 压缩聊天历史：按钮触发 + 保留条数
    panel.find('.st-sd__compress').on('click', compressChatHistory);
    panel.find('.st-sd__compress-keep').on('change', function () {
        let v = parseInt(this.value, 10);
        if (isNaN(v) || v < 2) v = 2;
        if (v > 200) v = 200;
        settings.compressKeep = v;
        this.value = v;
        saveSettings();
    });
    // 注入世界书（事件委托，按钮即使被重建也始终能触发）
    panel.on('click', '.st-sd__inject-world', injectToWorldBook);
    // 搜索世界书：边输入边过滤下拉；回车选中第一个匹配项
    panel.on('input', '.st-sd__world-search', () => renderWorldSelect());
    panel.on('input', '.st-sd__recall-world-search', () => renderRecallScope());
    panel.on('keydown', '.st-sd__recall-world-search', function (e) {
        if (e.key !== 'Enter') return;
        const hit = filterWorldNames(recallScopeNames(), this.value)[0];
        if (!hit) return;
        this.value = '';
        renderRecallScope();
        panel.find('.st-sd__recall-world').val('world:' + hit);
        toastr.success('预览范围已选「' + hit + '」');
    });
    panel.on('keydown', '.st-sd__world-search', function (e) {
        if (e.key !== 'Enter') return;
        const hit = filterWorldNames(Array.isArray(world_names) ? world_names : [], this.value)[0];
        if (!hit) return;
        settings.worldBook = hit;
        saveSettings();
        this.value = '';
        renderWorldSelect();
        toastr.success('已选择世界书「' + hit + '」');
    });
    // 选择要注入的世界书（事件委托）
    panel.on('change', '.st-sd__world-select', function () {
        settings.worldBook = this.value || '';
        saveSettings();
    });
    // 归档条目是否标记 vectorized（语义召回）
    panel.find('.st-sd__vec-toggle').on('change', function () {
        settings.archiveVectorized = this.checked;
        saveSettings();
    });
    // 手动补记一条记忆
    panel.find('.st-sd__add-note').on('click', addManualNote);
    panel.find('.st-sd__note-input').on('keydown', (e) => { if (e.key === 'Enter') addManualNote(); });
    // 向量召回（语义搜索）：独立类目，输入一句话调酒馆向量存储查一次
    panel.find('.st-sd__recall-run').on('click', runSemanticSearch);
    panel.find('.st-sd__recall-input').on('keydown', (e) => { if (e.key === 'Enter') runSemanticSearch(); });
    // 复制召回结果原文
    panel.on('click', '.st-sd__recall-copy', function () {
        const text = $(this).closest('.st-sd__recall-item').find('.st-sd__recall-body').text();
        if (!text) return;
        copyText(text).then(() => toastr.success('已复制')).catch(() => toastr.error('复制失败'));
    });
    // 注入正文开关
    panel.find('.st-sd__recall-inject-toggle').on('change', function () {
        settings.semanticRecall.enabled = this.checked;
        saveSettings();
        updatePromptInjection();
        renderRecallIndexState();
    });
    // 注入调参（召回条数 / 候选阈值 / 候选条数）
    panel.on('change', '.st-sd__recall-inject-topk, .st-sd__recall-inject-threshold, .st-sd__recall-inject-querytopk, .st-sd__recall-inject-budget', function () {
        const sr = settings.semanticRecall;
        const t = parseInt(panel.find('.st-sd__recall-inject-topk').val(), 10);
        const th = parseFloat(panel.find('.st-sd__recall-inject-threshold').val());
        const qk = parseInt(panel.find('.st-sd__recall-inject-querytopk').val(), 10);
        if (!isNaN(t) && t >= 1) sr.topK = t;
        if (!isNaN(th) && th >= 0) sr.threshold = th;
        if (!isNaN(qk) && qk >= 1) sr.queryTopK = qk;
        const bd = parseInt(panel.find('.st-sd__recall-inject-budget').val(), 10);
        if (!isNaN(bd) && bd >= 0) sr.charBudget = bd;
        saveSettings();
    });
    // 清空并重建索引：先清掉本聊天的向量集合再全量重新嵌入
    panel.find('.st-sd__recall-rebuild').on('click', async function () {
        const issue = semanticSourceIssue(extension_settings.vectors);
        if (issue) { toastr.warning(issue); return; }
        if (!confirm('清空并重建会把本聊天的全部条目重新做一遍 embedding（走你配置的向量源，API 源会产生用量）。确定吗？')) return;
        const btn = $(this);
        btn.prop('disabled', true);
        try {
            const ok = await requestSemanticSync({ rebuild: true });
            if (ok) toastr.success('语义索引已重建');
        } finally {
            btn.prop('disabled', false);
        }
    });
    // 一键清空当前角色数据
    panel.find('.st-sd__reset').on('click', resetCurrentChar);
    // 备份 / 恢复
    panel.find('.st-sd__backup-export').on('click', exportBackup);
    panel.find('.st-sd__backup-import').on('click', () => panel.find('.st-sd__backup-file').trigger('click'));
    panel.find('.st-sd__backup-file').on('change', async function () {
        const f = this.files && this.files[0];
        this.value = '';
        await importBackupFile(f);
    });
    // 插件更新
    panel.find('.st-sd__chk-update').on('click', () => checkPluginUpdate({ manual: true }));
    panel.find('.st-sd__update-go').on('click', performPluginUpdate);
    panel.find('.st-sd__update-reload').on('click', () => location.reload());
    panel.find('.st-sd__update-later').on('click', () => { updateCache().notifiedAt = Date.now(); saveSettings(); panel.find('.st-sd__update').hide(); });
    renderUpdateState();

    // 添加屏蔽词
    const addWord = () => {
        const input = panel.find('.st-sd__word-input');
        const w = input.val().trim();
        if (!w) return;
        if (!blockedWordList().includes(w)) {
            blockedWordList().push(w);
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
        const impSel = panel.find('.st-sd__memory-imp-select');
        if (impSel.length) m.importance = impSel.val() || 'B';
        const entSel = panel.find('.st-sd__memory-ent-select');
        if (entSel.length) m.entityRef = entSel.val() || '';
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
        if (!confirm('确定删除这条' + (tier === 'long' ? '长期' : '短期') + '记忆吗？删除后无法恢复。')) return;
        if (tier === 'short') settings.memories = settings.memories.filter(m => m.id !== id);
        else if (tier === 'long') settings.longMemories = settings.longMemories.filter(m => m.id !== id);
        saveSettings();
        updatePromptInjection();
        renderMemories();
    });
    panel.on('click', '.st-sd__word-del', function () {
        const w = String($(this).data('word'));
        sharedPrefs().blockedWords = blockedWordList().filter(x => x !== w);
        syncCensorObserver();
        saveSettings();
        renderBlockedWords();
        updatePromptInjection();
    });

    // 添加指令
    const addInstr = () => {
        const input = panel.find('.st-sd__instr-input');
        const v = input.val().trim();
        if (!v) return;
        if (!instructionList().some(it => it.text === v)) {
            writableInstructions().push({ id: uid(), text: v, enabled: true });
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
        const it = instructionList().find(x => x.id === id);
        if (it) {
            it.enabled = this.checked;
            saveSettings();
            updatePromptInjection();
        }
    });

    // 删除指令
    panel.on('click', '.st-sd__instr-del', function () {
        const id = $(this).data('id');
        if (activeCharKey && globalSettings.charPrefs[activeCharKey]) globalSettings.charPrefs[activeCharKey].instructions = instructionList().filter(x => x.id !== id);
        else noCharPrefs.instructions = noCharPrefs.instructions.filter(x => x.id !== id);
        saveSettings();
        renderInstructions();
        updatePromptInjection();
    });

    // 待确认的大跨度时间跳跃：采用 / 忽略
    panel.on('click', '.st-sd__jump-ok', function () {
        if (!settings.pendingJump) return;
        applyPendingJump();
        saveSettings();
        updatePromptInjection();
        refreshLocalChecks();
        renderMemories();
        renderTimeAxis();
        toastr.success('已采用时间跳跃');
    });
    panel.on('click', '.st-sd__jump-no', function () {
        settings.pendingJump = null;
        saveSettings();
        renderMemories();
        renderTimeAxis();
    });

    // 时间轴：手动设定锚点
    const saveAxis = () => {
        const dayVal = parseInt(panel.find('.st-sd__axis-day').val(), 10);
        const storyTime = panel.find('.st-sd__axis-time').val().trim();
        const location = panel.find('.st-sd__axis-loc').val().trim();
        if (isNaN(dayVal) && !storyTime && !location) { toastr.warning('请至少填一项（天数/年月日几时几分/地点）'); return; }
        if (!isNaN(dayVal) && dayVal >= 0) { settings.storyDay = dayVal; settings.pendingJump = null; }
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

    // 人物档案（角色实体）：自动登记开关 + 添加/编辑/删除
    panel.find('.st-sd__npc-auto').on('change', function () {
        settings.autoRegisterEntities = this.checked;
        saveSettings();
    });
    const addNpc = () => {
        const name = panel.find('.st-sd__npc-name').val().trim();
        if (!name) { toastr.warning('姓名必填'); return; }
        const world = panel.find('.st-sd__npc-world').val().trim();
        const timeline = panel.find('.st-sd__npc-timeline').val().trim();
        const identity = panel.find('.st-sd__npc-identity').val().trim();
        const age = panel.find('.st-sd__npc-age').val().trim();
        const note = panel.find('.st-sd__npc-note').val().trim();
        settings.entities.push({ id: uid(), name, age, note, world, timeline, identity, body: '', mind: '', goal: '', secret: '', promise: '' });
        saveSettings();
        updatePromptInjection();
        renderNpcs();
        panel.find('.st-sd__npc-name').val('');
        panel.find('.st-sd__npc-world').val('');
        panel.find('.st-sd__npc-timeline').val('');
        panel.find('.st-sd__npc-identity').val('');
        panel.find('.st-sd__npc-age').val('');
        panel.find('.st-sd__npc-note').val('');
        toastr.success('已添加角色实体「' + name + '」');
    };
    panel.find('.st-sd__npc-add').on('click', addNpc);
    panel.find('.st-sd__npc-note').on('keydown', (e) => { if (e.key === 'Enter') addNpc(); });

    panel.on('click', '.st-sd__npc-edit', function () {
        npcEditingId = String($(this).data('id'));
        renderNpcs();
        const inp = panel.find('.st-sd__npc-e-name');
        if (inp.length) inp.focus();
    });
    panel.on('click', '.st-sd__npc-cancel', function () {
        npcEditingId = null;
        renderNpcs();
    });
    panel.on('click', '.st-sd__npc-save', function () {
        const id = String($(this).data('id'));
        const n = settings.entities.find(x => x.id === id);
        if (!n) { npcEditingId = null; renderNpcs(); return; }
        const name = panel.find('.st-sd__npc-e-name').val().trim();
        if (!name) { toastr.warning('姓名不能为空'); return; }
        n.name = name;
        n.world = panel.find('.st-sd__npc-e-world').val().trim();
        n.timeline = panel.find('.st-sd__npc-e-timeline').val().trim();
        n.identity = panel.find('.st-sd__npc-e-identity').val().trim();
        n.age = panel.find('.st-sd__npc-e-age').val().trim();
        n.note = panel.find('.st-sd__npc-e-note').val().trim();
        n.body = panel.find('.st-sd__npc-e-body').val().trim();
        n.mind = panel.find('.st-sd__npc-e-mind').val().trim();
        n.goal = panel.find('.st-sd__npc-e-goal').val().trim();
        n.secret = panel.find('.st-sd__npc-e-secret').val().trim();
        n.promise = panel.find('.st-sd__npc-e-promise').val().trim();
        npcEditingId = null;
        saveSettings();
        updatePromptInjection();
        renderNpcs();
        toastr.success('已保存');
    });
    panel.on('click', '.st-sd__npc-del', function () {
        const id = String($(this).data('id'));
        const ent = settings.entities.find(x => x.id === id);
        if (!ent) return;
        if (!confirm('确定删除人物档案「' + ent.name + '」吗？关联它的记忆会变为「未关联角色」，关系线会保留人物名字。删除后无法恢复。')) return;
        settings.entities = settings.entities.filter(x => x.id !== id);
        for (const m of settings.memories) if (m.entityRef === id) m.entityRef = '';
        for (const m of settings.longMemories) if (m.entityRef === id) m.entityRef = '';
        for (const l of settings.relationshipLines) {
            if (l.a === '@' + id) l.a = ent.name;
            if (l.b === '@' + id) l.b = ent.name;
        }
        for (const p of settings.pendingEntityAssignments) p.candidates = p.candidates.filter(c => c !== id);
        settings.pendingEntityAssignments = settings.pendingEntityAssignments.filter(p => p.candidates.length);
        saveSettings();
        updatePromptInjection();
        renderPeople();
        renderMemories();
    });

    // 待确认同名角色归属：归到某候选 / 新建独立 / 忽略
    const resolvePending = (pid, action) => {
        const idx = settings.pendingEntityAssignments.findIndex(p => p.id === pid);
        if (idx < 0) return;
        const p = settings.pendingEntityAssignments[idx];
        if (action === 'skip') {
            settings.pendingEntityAssignments.splice(idx, 1);
        } else if (action === 'new') {
            settings.entities.push(entityFromInfo(p.name, p));
            settings.pendingEntityAssignments.splice(idx, 1);
            toastr.success('已新建独立实体「' + p.name + '」');
        } else if (action.startsWith('@')) {
            const e = settings.entities.find(x => x.id === action.slice(1));
            if (e) {
                applyEntityInfo(e, p);
                settings.pendingEntityAssignments.splice(idx, 1);
                toastr.success('已归到「' + (e.name + (entityDomain(e) ? '（' + entityDomain(e) + '）' : '')) + '」');
            } else {
                settings.pendingEntityAssignments.splice(idx, 1); // 候选已删，直接清掉
            }
        }
        saveSettings();
        updatePromptInjection();
        renderNpcs();
        renderPendingAssignments();
    };
    panel.on('click', '.st-sd__pend-merge', function () {
        resolvePending(String($(this).data('id')), '@' + String($(this).data('cid')));
    });
    panel.on('click', '.st-sd__pend-new', function () {
        resolvePending(String($(this).data('id')), 'new');
    });
    panel.on('click', '.st-sd__pend-skip', function () {
        resolvePending(String($(this).data('id')), 'skip');
    });

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
        if (!confirm('确定删除这条世界状态吗？')) return;
        settings.worldState = settings.worldState.filter(x => x.id !== id);
        saveSettings();
        updatePromptInjection();
        renderWorldState();
    });

    // 情感线：建立关系线 / 删除线 / 删除单条变化 / 补记变化
    const addRel = () => {
        const a = panel.find('.st-sd__rel-a').val();
        const b = panel.find('.st-sd__rel-b').val();
        if (!a || !b) { toastr.warning('请选择人物A和人物B'); return; }
        const rel = panel.find('.st-sd__rel-relation').val().trim();
        const line = findRelationshipLine(a, b);
        if (rel) line.current.relationship = rel;
        saveSettings();
        updatePromptInjection();
        renderRelationship();
        panel.find('.st-sd__rel-relation').val('');
        toastr.success('已建立/更新关系线「' + resolveEntityRef(a).display + ' → ' + resolveEntityRef(b).display + '」');
    };
    panel.find('.st-sd__rel-add').on('click', addRel);
    panel.find('.st-sd__rel-relation').on('keydown', (e) => { if (e.key === 'Enter') addRel(); });

    panel.on('click', '.st-sd__rel-del', function () {
        const id = String($(this).data('id'));
        if (!confirm('确定删除整条关系线吗？它的全部变化记录都会一起删除，无法恢复。')) return;
        settings.relationshipLines = settings.relationshipLines.filter(l => l.id !== id);
        saveSettings();
        updatePromptInjection();
        renderRelationship();
    });
    panel.on('click', '.st-sd__rel-row-del', function () {
        const id = String($(this).data('id'));
        if (!confirm('确定删除这条关系变化记录吗？')) return;
        for (const l of settings.relationshipLines) {
            l.history = l.history.filter(h => h.id !== id);
        }
        saveSettings();
        updatePromptInjection();
        renderRelationship();
    });
    panel.on('click', '.st-sd__rel-hist-add', function () {
        const id = String($(this).data('id'));
        const line = settings.relationshipLines.find(l => l.id === id);
        if (!line) return;
        const input = $(this).closest('.st-sd__rel-addhist').find('.st-sd__rel-hist-input');
        const text = input.val().trim();
        if (!text) { toastr.warning('先写点内容再补记'); return; }
        line.history.push({
            id: uid(),
            day: settings.storyDay,
            from: line.current.relationship || '',
            to: text,
            change: '',
            reason: '',
            event: '',
        });
        line.current.relationship = text;
        saveSettings();
        updatePromptInjection();
        renderRelationship();
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
        if (!confirm('确定删除这条时间轴记录吗？')) return;
        settings.timeline = settings.timeline.filter(x => x.id !== id);
        saveSettings();
        renderTimeAxis();
    });

    // 伏笔/未完成事项：添加
    const addFore = () => {
        const input = panel.find('.st-sd__fore-input');
        const v = input.val().trim();
        if (!v) return;
        if (!settings.foreshadows.some(f => f.title === v)) {
            settings.foreshadows.push({ id: uid(), title: v, status: '未揭示', note: '', day: settings.storyDay });
            saveSettings();
            renderForeshadows();
        }
        input.val('');
    };
    panel.find('.st-sd__fore-add').on('click', addFore);
    panel.find('.st-sd__fore-input').on('keydown', (e) => { if (e.key === 'Enter') addFore(); });

    // 伏笔：注入开关
    panel.find('.st-sd__fore-toggle').prop('checked', !!settings.injectForeshadows).on('change', function () {
        settings.injectForeshadows = this.checked;
        saveSettings();
        updatePromptInjection();
    });

    // 伏笔：切换状态（循环）
    panel.on('click', '.st-sd__fore-status', function () {
        const id = String($(this).data('id'));
        const f = settings.foreshadows.find(x => x.id === id);
        if (!f) return;
        cycleForeshadowStatus(f);
        saveSettings();
        updatePromptInjection();
        renderForeshadows();
    });

    // 伏笔：编辑/保存/取消/删除
    panel.on('click', '.st-sd__fore-edit', function () {
        foreshadowEditingId = String($(this).data('id'));
        renderForeshadows();
        const inp = panel.find('.st-sd__fore-e-title');
        if (inp.length) inp.focus();
    });
    panel.on('click', '.st-sd__fore-cancel', function () {
        foreshadowEditingId = null;
        renderForeshadows();
    });
    panel.on('click', '.st-sd__fore-save', function () {
        const id = String($(this).data('id'));
        const f = settings.foreshadows.find(x => x.id === id);
        if (!f) { foreshadowEditingId = null; renderForeshadows(); return; }
        const title = panel.find('.st-sd__fore-e-title').val().trim();
        if (!title) { toastr.warning('标题不能为空'); return; }
        f.title = title;
        f.note = panel.find('.st-sd__fore-e-note').val().trim();
        foreshadowEditingId = null;
        saveSettings();
        updatePromptInjection();
        renderForeshadows();
        toastr.success('已保存');
    });
    panel.on('click', '.st-sd__fore-del', function () {
        const id = String($(this).data('id'));
        if (!confirm('确定删除这条伏笔/未完成事项吗？')) return;
        settings.foreshadows = settings.foreshadows.filter(x => x.id !== id);
        saveSettings();
        updatePromptInjection();
        renderForeshadows();
    });

    // 一致性检查：注入开关 / 立即检查 / 清空 / 忽略单条
    panel.find('.st-sd__check-toggle').prop('checked', !!settings.injectChecks).on('change', function () {
        settings.injectChecks = this.checked;
        saveSettings();
        updatePromptInjection();
    });
    panel.find('.st-sd__check-run').on('click', runConsistencyCheck);
    panel.find('.st-sd__check-fix').on('click', () => runTimeRepair(true));
    panel.find('.st-sd__fix-toggle').prop('checked', !!settings.autoFixTime).on('change', function () {
        settings.autoFixTime = this.checked;
        saveSettings();
    });
    panel.find('.st-sd__check-clear').on('click', function () {
        if (!settings.checks.length) return;
        if (!confirm('确定清空全部一致性检查结果吗？')) return;
        ignoreLocalChecks(settings.checks);
        settings.checks = [];
        saveSettings();
        renderChecks();
        updatePromptInjection();
    });
    panel.on('click', '.st-sd__check-del', function () {
        const id = String($(this).data('id'));
        ignoreLocalChecks(settings.checks.filter(x => x.id === id));
        settings.checks = settings.checks.filter(x => x.id !== id);
        saveSettings();
        renderChecks();
        updatePromptInjection();
    });
}

// 用真实视口尺寸定位面板，保证手机端一定不出屏（酒馆移动端 body 是 fixed+overflow:hidden，vh/bottom 会失真）
function fitPanelToViewport() {
    // 面板现在由 CSS 固定铺满全屏（桌面/移动端一致），这里只清除可能残留的内联定位，
    // 避免旧版「浮窗 + 四周边距」的内联样式覆盖掉全屏布局。
    const panel = $('#st-serendipity');
    if (!panel.length) return;
    panel.css({ top: '', bottom: '', left: '', right: '', width: '', maxWidth: '', maxHeight: '' });
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
        renderPeople();
        renderBlockedWords();
        renderInstructions();
        renderForeshadows();
        renderChecks();
        renderCharBinding();
        renderRecall();
    } else {
        toggleThemePicker(false);
        panel.hide();
    }
    // 打开面板时给 body 打标记，用于移动端恢复触摸滚动（ST 移动端给 body 设了 touch-action:none）
    document.body.classList.toggle('st-sd-open', show);
}

// ---------------- 对外只读接口（供第三方插件如 Amor 导演台读取剧情上下文） ----------------
// 无参数调用 → 返回一整段纯文本（旧用法，行为不变）。
// 传入 { purpose, tokenBudget, include } → 返回结构化对象：
//   { schema, revision, tokenBudget, estimatedTokens, truncated, sections: { storyTime, ... }, text }
// 各段按优先级依次占预算，预算不够时低优先级的段被截短或丢弃；revision 随事实内容变化，用于判断「有没有更新」。
const DIRECTOR_SECTIONS = ['storyTime', 'recentMemory', 'timeline', 'characters', 'relationships', 'worldState', 'foreshadows', 'consistency'];
const DIRECTOR_SECTION_TITLES = {
    storyTime: '剧情时间',
    recentMemory: '近期记忆',
    timeline: '时间线（最近）',
    characters: '人物档案',
    relationships: '关系',
    worldState: '世界状态',
    foreshadows: '未完成伏笔',
    consistency: '待处理的一致性问题',
};
const DIRECTOR_DEFAULT_BUDGET = 2500;
const estimateTokens = (t) => Math.ceil(String(t || '').length / 1.5); // 中文偏保守的粗估

function buildDirectorSections() {
    const out = {};
    const timeLine = settings.storyDay != null
        ? '第' + settings.storyDay + '天' + (settings.storyTime ? ' · ' + settings.storyTime : '') + (settings.storyLocation ? ' · ' + settings.storyLocation : '')
        : '';
    if (timeLine) out.storyTime = timeLine;
    const mems = [
        ...(settings.longMemories || []).slice(-3).map(m => '（长期）' + m.text),
        ...(settings.memories || []).slice(-3).map(m => m.text),
    ].filter(Boolean);
    if (mems.length) out.recentMemory = mems.join('\n');
    const tl = (settings.timeline || []).slice(-10).map(t =>
        '第' + (t.day != null ? t.day : '?') + '天' + (t.location ? ' ' + t.location : '') + '：' + (t.event || '')
    ).join('\n');
    if (tl) out.timeline = tl;
    if ((settings.entities || []).length) out.characters = npcText();
    if ((settings.relationshipLines || []).length) out.relationships = relationshipCurrentText();
    const world = (settings.worldState || []).length ? worldStateLines(worldStateByCat()) : '';
    if (world) out.worldState = world;
    const openFores = (settings.foreshadows || []).filter(f => f && f.status !== '已回收' && f.title && f.title.trim()).slice(-5);
    if (openFores.length) out.foreshadows = openFores.map(f => '[' + f.status + '] ' + f.title).join('；');
    const checks = (settings.checks || []).filter(c => c && c.text && c.text.trim());
    if (checks.length) out.consistency = checks.slice(0, 5).map(c => '- ' + (CHECK_TYPE_LABELS[c.type] || '其他') + '：' + c.text).join('\n');
    return out;
}

// 超出预算时按行截断（保留靠前的行）；一行都放不下则整段丢弃
function fitToBudget(text, tokens) {
    if (estimateTokens(text) <= tokens) return text;
    const lines = text.split('\n');
    const kept = [];
    let used = 0;
    for (const ln of lines) {
        const t = estimateTokens(ln + '\n');
        if (used + t > tokens) break;
        kept.push(ln);
        used += t;
    }
    return kept.join('\n');
}

window.Serendipity = window.Serendipity || {};
window.Serendipity.getDirectorContext = function (opts) {
    if (!settings) return (opts && typeof opts === 'object') ? null : '';
    const all = buildDirectorSections();

    // 旧用法：无参数，整段文本，不裁剪（顺序与格式保持不变）
    if (!opts || typeof opts !== 'object') {
        const legacy = [
            ['storyTime', '剧情时间：', ''],
            ['timeline', '时间线（最近）：\n', ''],
            ['characters', '人物档案：\n', ''],
            ['relationships', '关系：\n', ''],
            ['worldState', '世界状态：\n', ''],
            ['foreshadows', '未完成伏笔：', ''],
            ['recentMemory', '近期记忆：\n', ''],
        ];
        return legacy.filter(([k]) => all[k]).map(([k, head]) => head + all[k]).join('\n\n');
    }

    const include = Array.isArray(opts.include) && opts.include.length
        ? DIRECTOR_SECTIONS.filter(k => opts.include.includes(k))
        : DIRECTOR_SECTIONS.filter(k => k !== 'consistency');
    const budget = Math.max(200, parseInt(opts.tokenBudget, 10) || DIRECTOR_DEFAULT_BUDGET);
    let remaining = budget;
    let truncated = false;
    const sections = {};
    const textParts = [];
    for (const k of include) {
        const raw = all[k];
        if (!raw) continue;
        const title = DIRECTOR_SECTION_TITLES[k];
        const head = title + '：\n';
        const room = remaining - estimateTokens(head);
        if (room <= 0) { truncated = true; continue; }
        const fitted = fitToBudget(raw, room);
        if (!fitted) { truncated = true; continue; }
        if (fitted.length < raw.length) truncated = true;
        sections[k] = fitted;
        textParts.push(head + fitted);
        remaining -= estimateTokens(head + fitted + '\n\n');
    }
    const text = textParts.join('\n\n');
    return {
        schema: 1,
        purpose: typeof opts.purpose === 'string' ? opts.purpose : '',
        // 事实内容变化时 revision 随之变化；调用方对比前后两次的值即可知道要不要重新读取
        revision: String(getStringHash(JSON.stringify(all))),
        tokenBudget: budget,
        estimatedTokens: estimateTokens(text),
        truncated,
        sections,
        text,
    };
};

// 只读：完整的伏笔列表（含 id / 状态 / 备注 / 埋下日），供 Amor 等插件按条规划铺垫与回收；不改任何数据
window.Serendipity.getForeshadows = function () {
    if (!settings) return null;
    return {
        storyDay: settings.storyDay != null ? settings.storyDay : null,
        items: (settings.foreshadows || [])
            .filter(f => f && f.id && typeof f.title === 'string' && f.title.trim())
            .map(f => ({ id: f.id, title: f.title.trim(), status: f.status, note: f.note || '', day: f.day == null ? null : f.day })),
    };
};


// ---------------- 备份 / 恢复（JSON） ----------------
const BACKUP_APP = 'serendipity-backup';
const BACKUP_MAX_BYTES = 50 * 1024 * 1024;
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

function downloadText(filename, text, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 备份只含剧情数据 + 屏蔽词/指令；不含 API 地址和 Key；语义索引快照不导出（换环境后需重新同步）
function buildBackup() {
    const chars = JSON.parse(JSON.stringify(globalSettings.chars));
    for (const cs of Object.values(chars)) {
        if (cs && cs.semanticRecall) cs.semanticRecall.index = { model: '', items: {} };
    }
    return {
        app: BACKUP_APP,
        schema: 1,
        version: VERSION,
        exportedAt: Date.now(),
        chars,
        shared: JSON.parse(JSON.stringify(globalSettings.shared)),
        charPrefs: JSON.parse(JSON.stringify(globalSettings.charPrefs)),
    };
}

function exportBackup() {
    if (!globalSettings) return;
    const d = new Date();
    const stamp = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes());
    downloadText('serendipity-backup-' + stamp + '.json', JSON.stringify(buildBackup()), 'application/json;charset=utf-8');
    toastr.success('备份已导出（共 ' + Object.keys(globalSettings.chars).length + ' 个聊天的数据，不含 API Key）');
}

function applyBackup(data) {
    const g = globalSettings;
    let imported = 0, skipped = 0;
    for (const [key, raw] of Object.entries(data.chars)) {
        if (UNSAFE_KEYS.has(key) || !/^(avatar|name|group)::/.test(key) || !isPlainObject(raw)) { skipped++; continue; }
        const cs = normalizeCharSettings(JSON.parse(JSON.stringify(raw)));
        delete cs.blockedWords; delete cs.instructions; delete cs.censorEnabled; // 老版本备份里的旧字段，不再属于单个聊天
        cs.semanticRecall.index = { model: '', items: {} };
        g.chars[key] = cs;
        imported++;
    }
    if (isPlainObject(data.shared)) {
        for (const w of normalizeWordList(data.shared.blockedWords)) if (!g.shared.blockedWords.includes(w)) g.shared.blockedWords.push(w);
        if (data.shared.censorEnabled === false) g.shared.censorEnabled = false;
    }
    if (isPlainObject(data.charPrefs)) {
        for (const [ck, p] of Object.entries(data.charPrefs)) {
            if (UNSAFE_KEYS.has(ck) || !/^(avatar|name|group)::/.test(ck) || !isPlainObject(p)) continue;
            const mine = normalizeInstructions(p.instructions);
            if (!mine.length) continue;
            let cur = g.charPrefs[ck];
            if (!isPlainObject(cur)) cur = g.charPrefs[ck] = { instructions: [] };
            cur.instructions = normalizeInstructions(cur.instructions);
            for (const it of mine) if (!cur.instructions.some(x => x.text === it.text)) cur.instructions.push(it);
        }
    }
    return { imported, skipped };
}

async function importBackupFile(file) {
    if (!file) return;
    if (file.size > BACKUP_MAX_BYTES) { toastr.error('备份文件过大（超过 50 MB），已取消导入'); return; }
    let data;
    try {
        data = JSON.parse(await file.text());
    } catch {
        toastr.error('这不是有效的备份文件（不是合法 JSON）');
        return;
    }
    if (!isPlainObject(data) || data.app !== BACKUP_APP || !isPlainObject(data.chars)) {
        toastr.error('这不是 Serendipity 的备份文件');
        return;
    }
    const total = Object.keys(data.chars).length;
    const when = data.exportedAt ? fmtTime(data.exportedAt) : '未知时间';
    if (!confirm('备份导出于 ' + when + (data.version ? '（v' + data.version + '）' : '') + '，含 ' + total + ' 个聊天的数据。\n\n导入会覆盖同一聊天的现有数据，其它聊天的数据保留；屏蔽词、指令与现有的合并。确定导入吗？')) return;

    const { imported, skipped } = applyBackup(data);
    saveSettings();
    activateCharacter();
    updatePromptInjection();
    applyCensorAll();
    renderMemories();
    renderTimeAxis();
    renderPeople();
    renderBlockedWords();
    renderInstructions();
    renderForeshadows();
    renderChecks();
    renderCharBinding();
    $('#st-serendipity .st-sd__censor-toggle').prop('checked', censorOn());
    if (settings.semanticRecall && settings.semanticRecall.enabled) scheduleSemanticSync();
    toastr.success('已导入 ' + imported + ' 个聊天的数据' + (skipped ? '（跳过 ' + skipped + ' 项无法识别的条目）' : ''));
}

// ---------------- 插件更新提醒 ----------------
const UPDATE_CHECK_INTERVAL = 6 * 3600 * 1000;   // 自动检查间隔
const UPDATE_NOTIFY_INTERVAL = 24 * 3600 * 1000; // 弹窗提醒间隔（点了「稍后」不会反复弹）
const updateState = { phase: 'idle', available: false, updated: false, commit: '', error: '' }; // phase: idle | checking | updating

function pluginFolderName() {
    try {
        const m = new URL(import.meta.url).pathname.match(/\/extensions\/third-party\/([^/]+)\/[^/]*$/);
        return m ? decodeURIComponent(m[1]) : '';
    } catch { return ''; }
}
function pluginIsGlobal(folder) {
    try { return stExt.extensionTypes?.['third-party/' + folder] === 'global'; } catch { return false; }
}
function updateCache() {
    const root = extension_settings[extensionName];
    if (!isPlainObject(root.update)) root.update = {};
    return root.update;
}

async function extensionApi(path, folder, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(path, {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ extensionName: folder, global: pluginIsGlobal(folder) }),
            signal: ctrl.signal,
        });
        if (!res.ok) {
            if (res.status === 403) throw new Error('没有权限：这个插件装在酒馆的全局目录，需要用管理员账号更新');
            const t = safeErrorText(await res.text().catch(() => ''), '', 80);
            throw new Error('HTTP ' + res.status + (t ? ' ' + t : ''));
        }
        return await res.json();
    } catch (e) {
        if (e && e.name === 'AbortError') throw new Error('请求超时');
        throw e;
    } finally {
        clearTimeout(timer);
    }
}

function renderUpdateState() {
    const banner = $('#st-serendipity .st-sd__update');
    const link = $('#st-serendipity .st-sd__chk-update');
    if (!banner.length) return;
    const busy = updateState.phase !== 'idle';
    link.text(updateState.phase === 'checking' ? '检查中…' : '检查更新').prop('disabled', busy);
    banner.toggle(updateState.available || updateState.updated || updateState.phase === 'updating');
    banner.find('.st-sd__update-go').toggle(updateState.available && !updateState.updated).prop('disabled', busy)
        .text(updateState.phase === 'updating' ? '更新中…' : '立即更新');
    banner.find('.st-sd__update-reload').toggle(updateState.updated);
    banner.find('.st-sd__update-later').toggle(updateState.available && !updateState.updated && !busy);
    banner.find('.st-sd__update-text').text(
        updateState.updated ? 'Serendipity 已更新' + (updateState.commit ? '（' + updateState.commit + '）' : '') + '，刷新页面后生效。'
            : updateState.phase === 'updating' ? '正在更新，请稍候（需要服务器能访问 GitHub）…'
                : '发现新版本，当前 v' + VERSION + '。'
    );
}

function showUpdateToast() {
    const html = '<div>Serendipity 有新版本可用（当前 v' + VERSION + '）</div>'
        + '<div class="st-sd-toast-actions">'
        + '<button type="button" class="st-sd-toast-btn st-sd-toast-update">立即更新</button>'
        + '<button type="button" class="st-sd-toast-btn st-sd-toast-open">打开面板</button>'
        + '</div>';
    const t = toastr.info(html, 'Serendipity 插件更新', { timeOut: 0, extendedTimeOut: 0, closeButton: true, tapToDismiss: false, escapeHtml: false });
    if (!t) return;
    t.find('.st-sd-toast-update').on('click', () => { toastr.clear(t); performPluginUpdate(); });
    t.find('.st-sd-toast-open').on('click', () => { toastr.clear(t); togglePanel(true); });
}

function maybeNotifyUpdate() {
    if (!updateState.available || updateState.updated) return;
    const c = updateCache();
    if (Date.now() - (c.notifiedAt || 0) < UPDATE_NOTIFY_INTERVAL) return;
    c.notifiedAt = Date.now();
    saveSettings();
    showUpdateToast();
}

async function checkPluginUpdate({ manual = false } = {}) {
    if (updateState.phase !== 'idle') return;
    const folder = pluginFolderName();
    if (!folder) {
        if (manual) toastr.warning('无法确定插件的安装目录，请到「扩展 → 管理扩展」里更新');
        return;
    }
    updateState.phase = 'checking';
    updateState.error = '';
    renderUpdateState();
    try {
        const data = await extensionApi('/api/extensions/version', folder, 30000);
        updateState.available = !!data && data.isUpToDate === false;
        Object.assign(updateCache(), { at: Date.now(), available: updateState.available, ver: VERSION });
        saveSettings();
    } catch (e) {
        updateState.error = safeErrorText(e);
        console.warn('[Serendipity] 检查更新失败：', updateState.error);
        if (manual) toastr.warning('检查更新失败：' + updateState.error);
    } finally {
        updateState.phase = 'idle';
        renderUpdateState();
    }
    if (updateState.error) return;
    if (updateState.available) {
        if (manual) { updateCache().notifiedAt = Date.now(); showUpdateToast(); } else maybeNotifyUpdate();
    } else if (manual) {
        toastr.success('Serendipity 已是最新版本（v' + VERSION + '）');
    }
}

async function performPluginUpdate() {
    if (updateState.phase !== 'idle') return;
    const folder = pluginFolderName();
    if (!folder) { toastr.warning('无法确定插件的安装目录，请到「扩展 → 管理扩展」里更新'); return; }
    updateState.phase = 'updating';
    updateState.error = '';
    renderUpdateState();
    try {
        const data = await extensionApi('/api/extensions/update', folder, 120000);
        updateState.available = false;
        updateState.updated = true;
        updateState.commit = (data && data.shortCommitHash) || '';
        Object.assign(updateCache(), { at: Date.now(), available: false, ver: VERSION });
        saveSettings();
        const t = toastr.success('<div>Serendipity 已更新' + (updateState.commit ? '（' + escapeHtml(updateState.commit) + '）' : '') + '，刷新页面后生效。</div>'
            + '<div class="st-sd-toast-actions"><button type="button" class="st-sd-toast-btn st-sd-toast-reload">立即刷新</button></div>',
            'Serendipity 插件更新', { timeOut: 0, extendedTimeOut: 0, closeButton: true, tapToDismiss: false, escapeHtml: false });
        if (t) t.find('.st-sd-toast-reload').on('click', () => location.reload());
    } catch (e) {
        updateState.error = safeErrorText(e);
        toastr.error('更新失败：' + updateState.error + '。可以到「扩展 → 管理扩展」里手动更新。');
    } finally {
        updateState.phase = 'idle';
        renderUpdateState();
    }
}

// 启动时：先用上次的检查结果（只在版本没变时有效），再按间隔联网检查
function initUpdateReminder() {
    const c = updateCache();
    if (c.ver === VERSION && c.available) updateState.available = true;
    renderUpdateState();
    maybeNotifyUpdate();
    const stale = !c.at || c.ver !== VERSION || Date.now() - c.at > UPDATE_CHECK_INTERVAL;
    if (stale) setTimeout(() => checkPluginUpdate(), 10000);
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
    syncCensorObserver();
    updatePromptInjection();

    // 生成结束后按设定频率自动总结（每 N 轮一次）
    eventSource.on(event_types.GENERATION_ENDED, () => {
        setTimeout(() => {
            if (!settings) return;
            activateCharacter();
            reconcileWithChat(); // 重新生成/滑动后先回滚旧记忆，再按新内容总结
            if (!settings.memoryEnabled) return;
            if (!hasUnsummarizedChat()) return; // 没有新对话（重新进入聊天等触发的生成结束事件）不计轮、不总结
            settings.roundsSinceSummary = (settings.roundsSinceSummary || 0) + 1;
            const every = settings.summarizeEvery || 1;
            if (settings.roundsSinceSummary >= every) {
                settings.roundsSinceSummary = 0;
                summarizeLastRound();
            }
        }, 200);
    });
    // 语义召回：在每次生成组装提示词之前执行（酒馆会等这个事件的处理函数跑完），用的是这一轮刚发出的消息
    eventSource.on(event_types.GENERATION_AFTER_COMMANDS, async (type, params, dryRun) => {
        if (dryRun || type === 'quiet') return;
        if (!settings || !settings.semanticRecall || !settings.semanticRecall.enabled) return;
        activateCharacter();
        await runSemanticRecallInjection(type);
    });
    // 消息被删除 / 滑动换版本：对应的记忆立刻回滚（重新生成时酒馆也会先发删除事件）
    const onMessageChanged = () => setTimeout(() => { if (settings) { activateCharacter(); reconcileWithChat(); } }, 100);
    eventSource.on(event_types.MESSAGE_DELETED, onMessageChanged);
    eventSource.on(event_types.MESSAGE_SWIPED, onMessageChanged);
    // 切换聊天/角色后：切换到「该角色 + 该聊天」对应的数据（不同聊天界面各自独立）
    eventSource.on(event_types.CHAT_CHANGED, () => {
        // 语义召回块是上个聊天的资料，立刻清掉，免得新聊天第一次生成带着旧剧情
        setExtensionPrompt('serendipity_semantic_recall', '', extension_prompt_types.IN_PROMPT, 0);
        setTimeout(() => {
            activateCharacter();
            updatePromptInjection();
            applyCensorAll();
            renderMemories();
            renderTimeAxis();
            renderPeople();
            renderBlockedWords();
            renderInstructions();
            renderForeshadows();
            renderChecks();
            renderCharBinding();
            renderRecall();
        }, 150);
    });

    // 屏幕尺寸变化（转屏/键盘）时重新定位面板
    $(window).on('resize.st-sd', fitPanelToViewport);
    $(window).on('orientationchange.st-sd', () => setTimeout(fitPanelToViewport, 300));

    renderMemories();
    renderTimeAxis();
    renderPeople();
    renderBlockedWords();
    renderInstructions();
    renderForeshadows();
    renderChecks();
    renderCharBinding();
    initUpdateReminder();
});

// ST 自动更新扩展后会调用 manifest.hooks.update 指向的这个函数（此时新代码已 git pull 到磁盘），
// 在这里刷新页面以加载新版本，无需手动刷新。
export function reloadOnUpdate() {
    toastr.info('Serendipity 已更新，正在刷新页面以应用新版本...', undefined, { timeOut: 1500 });
    setTimeout(() => location.reload(), 1500);
}
