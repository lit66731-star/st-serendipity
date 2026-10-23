// Serendipity 模型管理（Phase 5+6）纯逻辑回归测试
// 运行：node test/model-management.test.mjs
// 覆盖：能力检测（未知不臆测）、任务级打分（embedding 任务要 embedding 模型、对话任务排除 embedding 模型）、
// 模型列表去重校验保留原始 id、自动选型（取最高分，无合适候选不臆造）。
// 复刻 index.js 里 detectCapabilities / scoreModelForTask / 列表去重 / 自动选型的核心，若算法改动请同步。

import assert from 'node:assert';

const EMBED_HINT = /embed|bge|e5-|text-embedding|jina|m3e|gte-|sentence/i;
const CAP_KEYS = ['chatCompletion', 'longContext', 'structuredOutput', 'embedding', 'tokenCounting', 'streaming'];

function detectCapabilities(model) {
    const id = String((model && (model.id || model.model)) || '').toLowerCase();
    const c = {};
    for (const k of CAP_KEYS) c[k] = 'unknown';
    if (EMBED_HINT.test(id)) c.embedding = 'confirmed';
    const caps = model && (model.capabilities || model.caps || model.supports);
    if (Array.isArray(caps)) { for (const k of caps) if (CAP_KEYS.includes(k)) c[k] = 'confirmed'; }
    else if (caps && typeof caps === 'object') { for (const k of CAP_KEYS) if (caps[k] === true) c[k] = 'confirmed'; }
    return c;
}

function scoreModelForTask(modelId, capabilities, taskId) {
    const caps = capabilities || {};
    const id = String(modelId || '').toLowerCase();
    if (taskId === 'embedding') {
        if (caps.embedding === 'confirmed') return 2;
        if (EMBED_HINT.test(id)) return 1;
        return 0;
    }
    if (caps.embedding === 'confirmed') return 0;
    return 1;
}

function dedupModels(raw) {
    const seen = new Set();
    return raw.map(m => {
        const id = (m && typeof m.id === 'string') ? m.id : (m && typeof m === 'string' ? m : '');
        if (!id) return null;
        return { id };
    }).filter(Boolean).filter(m => { if (seen.has(m.id)) return false; seen.add(m.id); return true; });
}

function autoSelectCore(candidates, taskId) {
    let best = null;
    for (const c of candidates) {
        const s = scoreModelForTask(c.modelId, c.capabilities, taskId);
        if (!best || s > best.score) best = { ...c, score: s };
    }
    return (best && best.score > 0) ? best : null;
}

let passed = 0;
function t(name, fn) { fn(); passed++; console.log('  ✓ ' + name); }

console.log('model-management.test.mjs');

// 能力检测：默认 unknown，未知能力不臆测为支持
t('detectCapabilities 默认 unknown，不臆测支持', () => {
    const c = detectCapabilities({ id: 'gpt-4o' });
    assert.equal(c.chatCompletion, 'unknown', '模型列表没有返回能力，chatCompletion 不得认定为支持');
    assert.equal(c.embedding, 'unknown');
    assert.equal(c.longContext, 'unknown');
});

// 能力检测：id 明确暗示 embedding → embedding confirmed
t('detectCapabilities 识别 embedding 模型', () => {
    assert.equal(detectCapabilities({ id: 'BAAI/bge-m3' }).embedding, 'confirmed');
    assert.equal(detectCapabilities({ id: 'text-embedding-3-small' }).embedding, 'confirmed');
    assert.equal(detectCapabilities({ id: 'qwen2.5' }).embedding, 'unknown', '普通对话模型不得误判为 embedding');
});

// 能力检测：服务端明确返回的能力才 confirmed
t('detectCapabilities 服务端能力元数据', () => {
    const c = detectCapabilities({ id: 'some-model', capabilities: ['chatCompletion', 'streaming'] });
    assert.equal(c.chatCompletion, 'confirmed');
    assert.equal(c.streaming, 'confirmed');
    assert.equal(c.embedding, 'unknown');
});

// 打分：embedding 任务要 embedding 模型，对话任务排除 embedding 模型，不凭名字论优劣
t('scoreModelForTask 任务能力匹配', () => {
    assert.ok(scoreModelForTask('BAAI/bge-m3', { embedding: 'confirmed' }, 'embedding') > scoreModelForTask('gpt-4o', {}, 'embedding'), 'embedding 任务优先 embedding 模型');
    assert.equal(scoreModelForTask('BAAI/bge-m3', { embedding: 'confirmed' }, 'memory_summary'), 0, '对话任务排除 embedding 模型');
    assert.equal(scoreModelForTask('gpt-4o', {}, 'memory_summary'), scoreModelForTask('qwen2.5', {}, 'memory_summary'), '无能力数据时不凭名字论优劣');
});

// 模型列表去重：去重、丢空 id、保留原始 id
t('模型列表去重校验保留原始 id', () => {
    const raw = [
        { id: 'gpt-4o' },
        { id: 'gpt-4o' },
        { id: 'BAAI/bge-m3' },
        { id: '' },
        null,
        'qwen2.5',
    ];
    const list = dedupModels(raw);
    assert.deepEqual(list.map(x => x.id), ['gpt-4o', 'BAAI/bge-m3', 'qwen2.5']);
});

// 自动选型：取最高分；对话任务只剩 embedding 模型时返回 null（不臆造）
t('autoSelect 取最高分，无合适候选返回 null', () => {
    const chat = autoSelectCore([
        { modelId: 'gpt-4o', capabilities: {} },
        { modelId: 'qwen2.5', capabilities: {} },
    ], 'memory_summary');
    assert.ok(chat && chat.modelId === 'gpt-4o');

    const emb = autoSelectCore([
        { modelId: 'gpt-4o', capabilities: {} },
        { modelId: 'BAAI/bge-m3', capabilities: { embedding: 'confirmed' } },
    ], 'embedding');
    assert.equal(emb.modelId, 'BAAI/bge-m3');

    const none = autoSelectCore([{ modelId: 'BAAI/bge-m3', capabilities: { embedding: 'confirmed' } }], 'memory_summary');
    assert.equal(none, null, '对话任务只剩 embedding 模型：返回 null 而非乱选');
});

console.log('全部通过：' + passed + ' 项');
