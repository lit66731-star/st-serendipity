// Serendipity Token 预算模块（Phase 3）纯逻辑回归测试
// 运行：node test/token-budget.test.mjs
// 覆盖：token 保守估算（区分 CJK/拉丁/空白）、按预算分段（不切断单条消息 + 重叠不重复记账）、
// 触发阈值判定、预算解析（已知/未知上下文）、消息内容签名（原地编辑可被检出）。
// 复刻 index.js 里 countTokens / chunkMessagesByTokenBudget / shouldTriggerSummary /
// resolveTokenBudget / contentSignature 的核心（去掉 browser/网络副作用），若算法改动请同步。

import assert from 'node:assert';

const TOKEN_EST = {
    cjkPerChar: 1.0,
    latinPerToken: 4,
    overheadPerMessage: 4,
};

function countTokens(text) {
    const t = String(text == null ? '' : text);
    if (!t) return { tokens: 0, estimated: true };
    let cjk = 0, latin = 0, other = 0;
    for (const ch of t) {
        const code = ch.codePointAt(0);
        if ((code >= 0x4E00 && code <= 0x9FFF) || (code >= 0x3000 && code <= 0x30FF) || (code >= 0xFF00 && code <= 0xFFEF) || (code >= 0x3400 && code <= 0x4DBF)) cjk++;
        else if (ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r') other++;
        else if (/[A-Za-z0-9]/.test(ch)) latin++;
        else other++;
    }
    const tokens = cjk + Math.ceil(latin / TOKEN_EST.latinPerToken) + Math.ceil(other / TOKEN_EST.latinPerToken);
    return { tokens, estimated: true };
}

function chunkMessagesByTokenBudget(items, opts) {
    const max = Math.max(1, Math.floor(Number(opts.maxChunkTokens) || 0));
    const overlap = Math.max(0, Math.floor(Number(opts.overlapTokens) || 0));
    const tokOf = (it) => {
        const text = it && typeof it.text === 'string' ? it.text : '';
        return countTokens(text).tokens + TOKEN_EST.overheadPerMessage;
    };
    const chunks = [];
    let cur = { items: [], tokens: 0 };
    const push = () => { if (cur.items.length) chunks.push({ items: cur.items, tokens: cur.tokens }); };
    for (const it of items) {
        const tok = tokOf(it);
        if (cur.items.length && cur.tokens + tok > max) {
            push();
            cur = { items: [], tokens: 0 };
            if (overlap > 0) {
                const prev = chunks[chunks.length - 1];
                let o = 0;
                const back = [];
                for (let k = prev.items.length - 1; k >= 0 && o < overlap; k--) {
                    const bk = prev.items[k];
                    back.unshift({ ...bk, overlap: true });
                    o += tokOf(bk);
                }
                if (back.length && back.length < prev.items.length) { cur.items = back; cur.tokens = o; }
            }
        }
        cur.items.push(it);
        cur.tokens += tok;
    }
    push();
    return chunks;
}

function shouldTriggerSummary(pendingTokens, budget) {
    const b = budget || {};
    const input = Math.max(0, Math.floor(Number(b.inputTokenBudget) || 0));
    const reserved = Math.max(0, Math.floor(Number(b.reservedContextTokens) || 0));
    const usable = Math.max(0, input - reserved);
    if (usable <= 0) return false;
    const ratio = Math.min(1, Math.max(0, Number(b.summaryTriggerRatio) || 0.8));
    return Math.max(0, Math.floor(Number(pendingTokens) || 0)) >= usable * ratio;
}

function resolveTokenBudget(budget, modelContextTokens) {
    const b = budget || {};
    const ctx = Math.max(0, Math.floor(Number(modelContextTokens) || 0));
    const hasCtx = ctx > 0;
    const num = (v, def) => { const n = Math.floor(Number(v)); return n > 0 ? n : def; };
    const reserved = hasCtx ? num(b.reservedContextTokens, Math.max(256, Math.floor(ctx * 0.15))) : num(b.reservedContextTokens, 0);
    const output = hasCtx ? num(b.outputTokenBudget, Math.max(256, Math.floor(ctx * 0.2))) : num(b.outputTokenBudget, 0);
    const available = hasCtx ? Math.max(0, ctx - reserved - output) : 0;
    const input = hasCtx ? (Number(b.inputTokenBudget) > 0 ? Math.min(available, Math.floor(Number(b.inputTokenBudget))) : available) : num(b.inputTokenBudget, 0);
    const maxChunk = hasCtx ? num(b.maxChunkTokens, Math.max(512, Math.floor(input * 0.5))) : num(b.maxChunkTokens, 0);
    const target = hasCtx ? num(b.summaryTargetTokens, Math.max(200, Math.floor(ctx * 0.1))) : num(b.summaryTargetTokens, 0);
    const overlap = Math.max(0, Math.floor(Number(b.overlapTokens) || 0));
    return { input, output, reserved, maxChunk, overlap, target, estimated: !hasCtx, modelContext: ctx };
}

function contentSignature(text) {
    const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    if (!t) return '';
    // 用一个简单稳定哈希模拟 getStringHash（测试只关心归一化 + 确定性 + 差异可检出）
    let h = 0;
    for (let i = 0; i < t.length; i++) { h = ((h << 5) - h + t.charCodeAt(i)) | 0; }
    return String(h >>> 0);
}

function truncateTextToTokens(text, maxTokens) {
    const t = String(text == null ? '' : text);
    if (!maxTokens || maxTokens <= 0) return t;
    if (countTokens(t).tokens <= maxTokens) return t;
    let lo = 0, hi = t.length;
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (countTokens(t.slice(0, mid)).tokens <= maxTokens) lo = mid;
        else hi = mid - 1;
    }
    return t.slice(0, lo);
}

function buildSummaryWindowBudgeted(sel, budgetTokens, maxChars) {
    const tokMode = budgetTokens > 0;
    const cap = tokMode ? budgetTokens : Math.max(1, Math.floor(Number(maxChars) || 1));
    const buildLine = (x) => {
        const text = (x.m && typeof x.m.mes === 'string') ? x.m.mes : '';
        const head = '【第' + (x.i + 1) + '楼】' + (x.m.name || (x.m.is_user ? '用户' : '角色')) + '：';
        const bodyCap = Math.max(1, cap - countTokens(head).tokens - (tokMode ? TOKEN_EST.overheadPerMessage : 0));
        const body = tokMode ? truncateTextToTokens(text, bodyCap) : (text.length > bodyCap ? text.slice(0, bodyCap) : text);
        return head + body;
    };
    const costOf = (line) => tokMode ? countTokens(line).tokens + TOKEN_EST.overheadPerMessage : line.length;
    const firstLine = buildLine(sel[0]);
    const lines = [];
    let used = costOf(firstLine);
    for (let k = sel.length - 1; k >= 1; k--) {
        const line = buildLine(sel[k]);
        const cost = costOf(line);
        if (lines.length >= 2 && used + cost > cap) break;
        lines.unshift(line);
        used += cost;
    }
    lines.unshift(firstLine);
    return { transcript: lines.join('\n\n'), count: lines.length, total: sel.length };
}

function buildCompressTranscript(items, chunkMax, chunkMaxTokens) {
    const tokMode = chunkMaxTokens > 0;
    const cap = tokMode ? chunkMaxTokens : Math.max(1, Math.floor(Number(chunkMax) || 1));
    const chunks = [];
    let cur = [];
    let used = 0;
    const flush = () => { if (cur.length) { chunks.push(cur.join('\n\n')); cur = []; used = 0; } };
    const costOf = (line) => tokMode ? countTokens(line).tokens + TOKEN_EST.overheadPerMessage : line.length;
    for (const it of items) {
        const m = it && it.m;
        if (!m || typeof m.mes !== 'string') continue;
        const label = m.is_system ? '系统' : (m.name || (m.is_user ? '用户' : '角色'));
        const head = '【第' + ((it.i != null ? it.i : 0) + 1) + '楼】' + label + '：';
        const text = m.mes.trim();
        const bodyCap = Math.max(1, cap - countTokens(head).tokens - (tokMode ? TOKEN_EST.overheadPerMessage : 0));
        const line = head + (tokMode ? truncateTextToTokens(text, bodyCap) : (text.length > bodyCap ? text.slice(0, bodyCap) : text));
        const cost = costOf(line);
        if (cur.length && used + cost > cap) flush();
        cur.push(line);
        used += cost;
    }
    flush();
    return chunks;
}

let passed = 0;
function t(name, fn) { fn(); passed++; console.log('  ✓ ' + name); }

console.log('token-budget.test.mjs');

// countTokens：区分 CJK / 拉丁 / 空白，且标记为估算值
t('countTokens 区分 CJK 与拉丁，标记 estimated', () => {
    const cjk = countTokens('你好世界');
    assert.equal(cjk.tokens, 4, '4 个中文字 ≈ 4 token');
    const latin = countTokens('hello');
    assert.equal(latin.tokens, Math.ceil(5 / 4), '5 个英文字母 ≈ ceil(5/4)');
    const empty = countTokens('');
    assert.equal(empty.tokens, 0);
    assert.equal(cjk.estimated, true, '未接真实 tokenizer 必须标记估算');
});

// chunkMessagesByTokenBudget：不切断单条消息、单条超预算独占一块、按预算分行
t('chunkMessages 不切断单条消息，超预算消息独占一块', () => {
    const items = [
        { key: 'a', text: '你好' },          // 2 token + 4 开销 = 6
        { key: 'b', text: '世界世界世界' },    // 6 token + 4 = 10
        { key: 'c', text: 'hi' },            // 1 + 4 = 5
    ];
    // maxChunk=16：a(6)+b(10)=16 恰好塞下；再加 c(5) 超 → c 成第二块
    const chunks = chunkMessagesByTokenBudget(items, { maxChunkTokens: 16, overlapTokens: 0 });
    assert.equal(chunks.length, 2);
    assert.deepEqual(chunks[0].items.map(x => x.key), ['a', 'b']);
    assert.deepEqual(chunks[1].items.map(x => x.key), ['c']);
    // 单条超预算：独占一块、不切断
    const big = [{ key: 'x', text: '很'.repeat(100) }]; // 100 token
    const c2 = chunkMessagesByTokenBudget(big, { maxChunkTokens: 10, overlapTokens: 0 });
    assert.equal(c2.length, 1);
    assert.equal(c2[0].items.length, 1, '单条再大也不切断');
});

// chunkMessagesByTokenBudget：重叠只作为新块开头的上下文，且不把整块全当重叠
t('chunkMessages 重叠标记 overlap，不整块重复', () => {
    const items = ['甲', '乙', '丙', '丁'].map(k => ({ key: k, text: k })); // 每条约 1 token + 4 开销 = 5
    const chunks = chunkMessagesByTokenBudget(items, { maxChunkTokens: 12, overlapTokens: 5 });
    // 甲(5)+乙(5)=10；丙(5) 超 → 切。第二块开头带上一块末尾（乙，overlap=true）
    assert.ok(chunks.length >= 2);
    const second = chunks[1];
    const overlapItems = second.items.filter(x => x.overlap === true);
    const ownItems = second.items.filter(x => x.overlap !== true);
    assert.ok(overlapItems.length > 0, '第二块有重叠上下文');
    assert.ok(overlapItems.length < second.items.length, '重叠只是前缀，不是整块');
    assert.ok(ownItems.length > 0, '第二块仍有自己的新内容');
});

// shouldTriggerSummary：占输入预算比例达阈值才触发；预留会压缩可用预算
t('shouldTriggerSummary 按比例阈值 + 预留预算', () => {
    const b = { inputTokenBudget: 1000, reservedContextTokens: 200, summaryTriggerRatio: 0.8 };
    // 可用 = 1000-200 = 800，阈值 = 640
    assert.equal(shouldTriggerSummary(639, b), false);
    assert.equal(shouldTriggerSummary(640, b), true);
    assert.equal(shouldTriggerSummary(5000, b), true);
    assert.equal(shouldTriggerSummary(100, { inputTokenBudget: 0, reservedContextTokens: 0, summaryTriggerRatio: 0.8 }), false, '无输入预算不触发');
    assert.equal(shouldTriggerSummary(100, { inputTokenBudget: 100, reservedContextTokens: 100, summaryTriggerRatio: 0.8 }), false, '预留吃掉全部预算不触发');
});

// resolveTokenBudget：已知上下文时自动补默认（输入=上下文−预留−输出），未知时保持 0 且 estimated
t('resolveTokenBudget 已知/未知上下文', () => {
    const known = resolveTokenBudget({}, 32000);
    assert.equal(known.estimated, false);
    assert.ok(known.reserved > 0 && known.output > 0 && known.input > 0, '已知上下文自动补全');
    assert.equal(known.input, 32000 - known.reserved - known.output, '输入 = 上下文 − 预留 − 输出');
    assert.ok(known.input <= 32000, '输入不超上下文');
    assert.ok(known.maxChunk > 0 && known.target > 0);

    const unknown = resolveTokenBudget({}, 0);
    assert.equal(unknown.estimated, true);
    assert.equal(unknown.input, 0, '未知上下文不臆造预算');
    assert.equal(unknown.maxChunk, 0);

    // 显式输入预算不能超过可用
    const explicit = resolveTokenBudget({ inputTokenBudget: 999999 }, 32000);
    assert.equal(explicit.input, 32000 - explicit.reserved - explicit.output);
});

// contentSignature：归一化空白 + 确定 + 原地编辑可检出
t('contentSignature 归一化空白、确定、可检出编辑', () => {
    const a = contentSignature('你好，世界');
    const b = contentSignature('  你好，世界  ');
    const c = contentSignature('你好，世界！');
    assert.equal(a, b, '空白差异归一化后签名一致');
    assert.notEqual(a, c, '正文改动签名必须变化');
    assert.equal(contentSignature(''), '');
    assert.equal(contentSignature(null), '');
    assert.equal(contentSignature('你好，世界'), a, '同一文本签名确定');
});

// truncateTextToTokens：按 token 预算截断，不整条丢弃，超预算时结果不超上限
t('truncateTextToTokens 二分截断，不超预算、不足预算不截', () => {
    assert.equal(truncateTextToTokens('你好世界', 2), '你好', '4 CJK 截到 2 token');
    assert.ok(countTokens(truncateTextToTokens('hello world', 2)).tokens <= 2, '拉丁截断不超预算');
    assert.equal(truncateTextToTokens('你好', 100), '你好', '不足预算原样返回');
    assert.equal(truncateTextToTokens('你好', 0), '你好', '预算 0（未知）不截');
    assert.equal(truncateTextToTokens('', 5), '');
});

// buildSummaryWindowBudgeted：最早一条 + 最新两条保留，中间按预算省略更早的；token 模式与字符回退都成立
t('buildSummaryWindowBudgeted 最早+最新两条保留、超预算省略更早', () => {
    const mk = (i) => ({ m: { name: 'A', is_user: false, mes: '很'.repeat(6) }, i });
    const sel = [0, 1, 2, 3, 4, 5, 6, 7].map(mk);
    const charWin = buildSummaryWindowBudgeted(sel, 0, 40);
    assert.equal(charWin.transcript.indexOf('【第1楼】'), 0, '最早一条始终打头');
    assert.ok(charWin.transcript.includes('【第8楼】'), '最新一条保留');
    const tokWin = buildSummaryWindowBudgeted(sel, 100, 40);
    assert.equal(tokWin.transcript.indexOf('【第1楼】'), 0);
    assert.ok(tokWin.transcript.includes('【第8楼】'));
    assert.ok(tokWin.count >= 3 && tokWin.count < tokWin.total, '首尾都在、中间被省略');
});

// buildCompressTranscript：token 模式按预算分段，字符模式（不传 token 预算）回退旧行为
t('buildCompressTranscript token 模式按预算分段、字符模式回退', () => {
    const mk = (i) => ({ m: { name: 'B', is_user: false, mes: '你好世界' }, i });
    const items = [0, 1, 2, 3, 4].map(mk);
    const charChunks = buildCompressTranscript(items, 60, 0);
    assert.ok(charChunks.length >= 1, '字符模式能分段');
    const tokChunks = buildCompressTranscript(items, 60, 12);
    assert.ok(tokChunks.length > 1, '小 token 预算应切成多段');
    const joined = tokChunks.join('\n\n');
    assert.ok(joined.includes('【第1楼】') && joined.includes('【第5楼】'), '分段不丢首尾消息');
});

console.log('全部通过：' + passed + ' 项');
