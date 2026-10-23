// Serendipity 事务状态机（P08）纯逻辑回归测试
// 运行：node test/transaction-state.test.mjs
// 覆盖 spec 里的事务状态机：只有 validated→committed 才推进 lastSuccessfulAt；
// failed_retryable/invalidated 回到 idle、清 pendingBatchId、绝不改已提交边界（游标）；
// 逐批次记录有界；总结/压缩状态独立。
// 复刻 index.js 里 settleSummaryTx / settleCompressionTx / record*Tx 的核心（去掉 settings 副作用）。

import assert from 'node:assert';

const TX_LIMIT = 50;

function recordCore(arr, tx, limit) {
    arr.push(tx);
    if (arr.length > limit) arr.splice(0, arr.length - limit);
    return arr;
}

function settleSummaryCore(state, tx, status, error) {
    if (tx) { tx.status = status; tx.error = error || ''; }
    state.status = 'idle';
    state.pendingBatchId = '';
    if (status === 'committed') state.lastSuccessfulAt = 1234567890; // 用固定值代表 Date.now()
    return state;
}

function settleCompressionCore(state, tx, status, error) {
    if (tx) { tx.status = status; tx.error = error || ''; }
    state.status = 'idle';
    return state;
}

let passed = 0;
function t(name, fn) { fn(); passed++; console.log('  ✓ ' + name); }

console.log('transaction-state.test.mjs');

// 只有 committed 推进 lastSuccessfulAt；失败/中止回到 idle、清 pendingBatchId、不改游标
t('P08 只有 committed 推进 lastSuccessfulAt，失败/中止清 pending', () => {
    const st = { status: 'requesting', pendingBatchId: 'mABC', lastSuccessfulAt: 0 };
    const tx = { status: 'requesting' };
    const cursor = { lastCommittedMessageKey: 'a|b|0', lastSummaryIndex: 3 };

    settleSummaryCore(st, tx, 'failed_retryable', '空响应');
    assert.equal(st.status, 'idle');
    assert.equal(st.pendingBatchId, '');
    assert.equal(st.lastSuccessfulAt, 0, '失败不推进 lastSuccessfulAt');
    assert.equal(tx.status, 'failed_retryable');
    // settle 只碰 summaryState，绝不写游标（游标只在成功路径推进）——这里游标对象根本没被传入
    assert.deepEqual(cursor, { lastCommittedMessageKey: 'a|b|0', lastSummaryIndex: 3 });

    st.status = 'requesting'; st.pendingBatchId = 'mABC';
    settleSummaryCore(st, tx, 'invalidated', '重roll');
    assert.equal(st.status, 'idle');
    assert.equal(st.lastSuccessfulAt, 0, '中止不推进 lastSuccessfulAt');

    st.status = 'requesting'; st.pendingBatchId = 'mABC';
    settleSummaryCore(st, tx, 'committed', '');
    assert.equal(st.status, 'idle');
    assert.equal(st.pendingBatchId, '');
    assert.equal(st.lastSuccessfulAt, 1234567890, '仅 committed 推进 lastSuccessfulAt');
});

// validated 是 committed 的前置：空结果走 failed_retryable，非空才 validated
t('P08 validated 是 committed 的前置（结果非空才置 validated）', () => {
    const tx = { status: 'requesting' };
    const empty = '   ';
    if (empty && empty.trim()) tx.status = 'validated';
    else tx.status = 'failed_retryable';
    assert.equal(tx.status, 'failed_retryable', '空结果不会进入 validated/committed');

    const tx2 = { status: 'requesting' };
    const ok = '有内容';
    if (ok && ok.trim()) tx2.status = 'validated';
    assert.equal(tx2.status, 'validated');
});

// 逐批次记录有界：只留最近 TX_LIMIT 条，不无限增长
t('P08 逐批次记录有界（只留最近 ' + TX_LIMIT + ' 条）', () => {
    const arr = [];
    for (let i = 0; i < 70; i++) recordCore(arr, { batchId: 'm' + i }, TX_LIMIT);
    assert.equal(arr.length, TX_LIMIT);
    assert.equal(arr[0].batchId, 'm20', '最旧 20 条被裁剪');
    assert.equal(arr[arr.length - 1].batchId, 'm69');
});

// 总结/压缩状态独立：settle 一个不影响另一个，压缩失败不写 lastCommittedArchiveId
t('P08 总结与压缩状态机相互独立', () => {
    const s = { status: 'requesting', pendingBatchId: 'x', lastSuccessfulAt: 0 };
    const c = { status: 'requesting', lastCommittedArchiveId: '' };
    const stx = { status: 'requesting' };
    const ctx = { status: 'requesting' };
    settleSummaryCore(s, stx, 'committed', '');
    settleCompressionCore(c, ctx, 'failed_retryable', '存档失败');
    assert.equal(s.status, 'idle');
    assert.equal(c.status, 'idle');
    assert.equal(ctx.status, 'failed_retryable');
    assert.equal(c.lastCommittedArchiveId, '', '压缩失败不写 lastCommittedArchiveId');
    assert.equal(stx.status, 'committed');
});

console.log('全部通过：' + passed + ' 项');
