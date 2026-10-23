// Serendipity 旧设置迁移 + 故障兜底（Phase 9）纯逻辑回归测试
// 运行：node test/migration.test.mjs
// 覆盖：旧 api/embedApi → 提供方播种（ensureModelLayer）、tokenBudget/事务状态机/归档字段规范化（normalizeCharSettings）、
// 任务配置解析回退（getTaskCfg：绑定 → 旧全局配置）。
// 复刻 index.js 的纯核心（去掉 browser/network 副作用），若算法改动请同步。

import assert from 'node:assert';

const TX_LIMIT = 50;
const TX_STATUS = ['idle', 'requesting', 'validated', 'committed', 'failed_retryable', 'invalidated'];

// ---- 复刻 ensureModelLayer 的核心（纯函数，原地改 s 并返回） ----
function ensureModelLayerCore(s) {
    if (!s || typeof s !== 'object') return s;
    if (!Array.isArray(s.providers)) {
        s.providers = [];
        const api = s.api || {};
        if (api && api.url) s.providers.push({ id: 'legacy_chat', name: '插件 API', baseUrl: api.url, key: api.key || '', protocol: 'openai' });
        const ea = s.embedApi || {};
        if (ea && ea.url) s.providers.push({ id: 'legacy_embed', name: 'embeddings API', baseUrl: ea.url, key: ea.key || '', protocol: 'openai' });
    }
    if (!s.taskBindings || typeof s.taskBindings !== 'object' || Array.isArray(s.taskBindings)) s.taskBindings = {};
    if (!s.modelCache || typeof s.modelCache !== 'object' || Array.isArray(s.modelCache)) s.modelCache = {};
    if (!(s.schemaVersion >= 2)) s.schemaVersion = 2;
    return s;
}

// ---- 复刻 normalizeCharSettings 里 tokenBudget / 事务 / 版本 的核心 ----
function normalizeBudget(cs) {
    cs.tokenBudget = (cs.tokenBudget && typeof cs.tokenBudget === 'object' && !Array.isArray(cs.tokenBudget)) ? cs.tokenBudget : {};
    cs.tokenBudget = {
        inputTokenBudget: Math.max(0, Math.floor(Number(cs.tokenBudget.inputTokenBudget) || 0)),
        outputTokenBudget: Math.max(0, Math.floor(Number(cs.tokenBudget.outputTokenBudget) || 0)),
        reservedContextTokens: Math.max(0, Math.floor(Number(cs.tokenBudget.reservedContextTokens) || 0)),
        summaryTriggerRatio: Math.min(1, Math.max(0, (Number(cs.tokenBudget.summaryTriggerRatio) || 0.8))),
        maxChunkTokens: Math.max(0, Math.floor(Number(cs.tokenBudget.maxChunkTokens) || 0)),
        overlapTokens: Math.max(0, Math.floor(Number(cs.tokenBudget.overlapTokens) || 0)),
        summaryTargetTokens: Math.max(0, Math.floor(Number(cs.tokenBudget.summaryTargetTokens) || 0)),
    };
    cs.summaryVersion = Math.max(0, Math.floor(Number(cs.summaryVersion) || 0));
    cs.summaryState = (cs.summaryState && typeof cs.summaryState === 'object' && !Array.isArray(cs.summaryState)) ? cs.summaryState : {};
    cs.summaryState = {
        status: TX_STATUS.includes(cs.summaryState.status) ? cs.summaryState.status : 'idle',
        pendingBatchId: typeof cs.summaryState.pendingBatchId === 'string' ? cs.summaryState.pendingBatchId : '',
        lastSuccessfulAt: Number(cs.summaryState.lastSuccessfulAt) || 0,
    };
    cs.compressionState = (cs.compressionState && typeof cs.compressionState === 'object' && !Array.isArray(cs.compressionState)) ? cs.compressionState : {};
    cs.compressionState = {
        status: TX_STATUS.includes(cs.compressionState.status) ? cs.compressionState.status : 'idle',
        lastCommittedArchiveId: typeof cs.compressionState.lastCommittedArchiveId === 'string' ? cs.compressionState.lastCommittedArchiveId : '',
    };
    if (!Array.isArray(cs.summaryTransactions)) cs.summaryTransactions = [];
    cs.summaryTransactions = cs.summaryTransactions.filter(t => t && typeof t.batchId === 'string' && t.batchId).slice(-TX_LIMIT);
    if (!Array.isArray(cs.compressionTransactions)) cs.compressionTransactions = [];
    cs.compressionTransactions = cs.compressionTransactions.filter(t => t && typeof t.batchId === 'string' && t.batchId).slice(-TX_LIMIT);
    return cs;
}

// ---- 复刻 getTaskCfg / getEmbedCfg 的任务解析核心（绑定 → 旧全局回退） ----
function resolveTaskCfg(root, taskId) {
    const b = root.taskBindings && root.taskBindings[taskId];
    if (b && b.providerId && b.modelId) {
        const p = (root.providers || []).find(x => x && x.id === b.providerId);
        if (p && p.baseUrl) {
            const base = taskId === 'embedding' ? (p.embeddingEndpoint || p.baseUrl) : (p.requestEndpoint || p.baseUrl);
            return { url: base, key: p.key || '', model: b.modelId, providerId: p.id };
        }
    }
    if (taskId === 'embedding') return embedCfgCore(root);
    return root.api || {};
}
function embedCfgCore(root) {
    const b = root.taskBindings && root.taskBindings.embedding;
    if (b && b.providerId && b.modelId) {
        const p = (root.providers || []).find(x => x && x.id === b.providerId);
        if (p && p.baseUrl) return { url: (p.embeddingEndpoint || p.baseUrl), key: p.key || '', model: b.modelId };
    }
    const main = root.api || {};
    const e = root.embedApi || {};
    const model = String(e.model || root.embedModel || main.model || '').trim();
    if (e.url && String(e.url).trim()) return { url: String(e.url).trim(), key: String(e.key || '').trim(), model };
    return { url: String(main.url || '').trim(), key: String(main.key || '').trim(), model };
}

let passed = 0;
function t(name, fn) { fn(); passed++; console.log('  ✓ ' + name); }

console.log('migration.test.mjs');

// ---- ensureModelLayer：旧 api/embedApi 播种 ----
t('旧 api/embedApi 播种成两个 legacy 提供方', () => {
    const s = { api: { url: 'https://a.example/v1', key: 'sk-a', model: 'gpt-4o' }, embedApi: { url: 'https://e.example/v1', key: 'sk-e', model: 'bge-m3' } };
    ensureModelLayerCore(s);
    assert.equal(s.providers.length, 2);
    assert.deepEqual(s.providers.map(p => p.id), ['legacy_chat', 'legacy_embed']);
    assert.equal(s.providers[0].baseUrl, 'https://a.example/v1');
    assert.equal(s.providers[1].baseUrl, 'https://e.example/v1');
    assert.equal(s.schemaVersion, 2);
    assert.deepEqual(s.taskBindings, {});
    assert.deepEqual(s.modelCache, {});
});

t('只有 api、没有 embedApi → 只播种 legacy_chat', () => {
    const s = { api: { url: 'https://a.example/v1', model: 'gpt-4o' } };
    ensureModelLayerCore(s);
    assert.deepEqual(s.providers.map(p => p.id), ['legacy_chat']);
});

t('已有 providers → 不覆盖、不重复播种', () => {
    const s = { api: { url: 'https://a.example/v1', model: 'gpt-4o' }, providers: [{ id: 'mine', baseUrl: 'https://m.example/v1' }], taskBindings: { memory_summary: { providerId: 'mine', modelId: 'x' } } };
    ensureModelLayerCore(s);
    assert.equal(s.providers.length, 1);
    assert.equal(s.providers[0].id, 'mine');
    assert.deepEqual(s.taskBindings, { memory_summary: { providerId: 'mine', modelId: 'x' } }, '已有 taskBindings 保留');
    assert.equal(s.schemaVersion, 2);
});

t('非对象 → 原样返回不抛错', () => {
    assert.equal(ensureModelLayerCore(null), null);
    assert.equal(ensureModelLayerCore(undefined), undefined);
    assert.equal(ensureModelLayerCore('x'), 'x');
});

// ---- normalizeCharSettings：tokenBudget / 事务 ----
t('tokenBudget 负值归 0、ratio 夹 0~1、缺省 ratio=0.8', () => {
    const cs = normalizeBudget({ tokenBudget: { inputTokenBudget: -5, outputTokenBudget: 'abc', summaryTriggerRatio: 2, reservedContextTokens: 100 } });
    assert.equal(cs.tokenBudget.inputTokenBudget, 0);
    assert.equal(cs.tokenBudget.outputTokenBudget, 0);
    assert.equal(cs.tokenBudget.summaryTriggerRatio, 1, 'ratio > 1 夹到 1');
    assert.equal(cs.tokenBudget.reservedContextTokens, 100);
    assert.equal(normalizeBudget({}).tokenBudget.summaryTriggerRatio, 0.8, '缺省 ratio=0.8');
    assert.equal(normalizeBudget({ tokenBudget: 'bad' }).tokenBudget.inputTokenBudget, 0, '非对象 tokenBudget 兜底为 0');
});

t('事务记录有界只留最近 50 条、非法条目过滤', () => {
    const tx = Array.from({ length: 60 }, (_, i) => ({ batchId: 'b' + i }));
    tx.push({ batchId: '' }); // 非法
    tx.push(null);
    const cs = normalizeBudget({ summaryTransactions: tx, compressionTransactions: [{}, { batchId: 'c1' }] });
    assert.equal(cs.summaryTransactions.length, 50);
    assert.equal(cs.summaryTransactions[0].batchId, 'b10', '保留最近 50 条');
    assert.deepEqual(cs.compressionTransactions.map(x => x.batchId), ['c1']);
});

t('summaryState 非法状态归一为 idle、summaryVersion 负值归 0', () => {
    const cs = normalizeBudget({ summaryState: { status: 'weird', pendingBatchId: 123, lastSuccessfulAt: 'x' }, compressionState: { status: 'committed' }, summaryVersion: -3 });
    assert.equal(cs.summaryState.status, 'idle');
    assert.equal(cs.summaryState.pendingBatchId, '', '非字符串 pendingBatchId 清空');
    assert.equal(cs.summaryState.lastSuccessfulAt, 0);
    assert.equal(cs.compressionState.status, 'committed', '合法状态保留');
    assert.equal(cs.summaryVersion, 0);
});

// ---- getTaskCfg：任务解析回退 ----
t('任务绑定 → 提供方配置；embedding 走 embeddingEndpoint', () => {
    const root = {
        providers: [
            { id: 'p1', baseUrl: 'https://c.example/v1', key: 'sk1', requestEndpoint: 'https://c.example/v1/chat', embeddingEndpoint: 'https://c.example/v1/emb' },
        ],
        taskBindings: {
            memory_summary: { providerId: 'p1', modelId: 'gpt-4o' },
            embedding: { providerId: 'p1', modelId: 'bge-m3' },
        },
        api: { url: 'https://legacy/v1', key: 'skL', model: 'legacy-model' },
    };
    const m = resolveTaskCfg(root, 'memory_summary');
    assert.equal(m.url, 'https://c.example/v1/chat');
    assert.equal(m.model, 'gpt-4o');
    const e = resolveTaskCfg(root, 'embedding');
    assert.equal(e.url, 'https://c.example/v1/emb');
    assert.equal(e.model, 'bge-m3');
});

t('绑定失效（提供方不存在）→ 回退旧全局配置', () => {
    const root = {
        providers: [],
        taskBindings: { memory_summary: { providerId: 'ghost', modelId: 'x' } },
        api: { url: 'https://legacy/v1', key: 'skL', model: 'legacy-model' },
        embedApi: { url: 'https://emb/v1', model: 'bge-m3' },
    };
    const m = resolveTaskCfg(root, 'memory_summary');
    assert.equal(m.url, 'https://legacy/v1');
    assert.equal(m.model, 'legacy-model');
    const e = resolveTaskCfg(root, 'embedding');
    assert.equal(e.url, 'https://emb/v1');
    assert.equal(e.model, 'bge-m3');
});

t('embedding 无独立配置 → 回退插件 API 的地址/Key、模型可用 embedModel', () => {
    const root = { api: { url: 'https://legacy/v1', key: 'skL', model: 'gpt-4o' }, embedModel: 'bge-m3' };
    const e = resolveTaskCfg(root, 'embedding');
    assert.equal(e.url, 'https://legacy/v1');
    assert.equal(e.key, 'skL');
    assert.equal(e.model, 'bge-m3');
});

console.log('全部通过：' + passed + ' 项');
