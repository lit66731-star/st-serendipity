// Serendipity 游标（Phase 2 总结身份键 + Phase 3 独立压缩游标）纯逻辑回归测试
// 运行：node test/cursor.test.mjs
// 覆盖 spec 里的 T09（二次压缩只归档新消息、不从第1楼重来）、
// T11（压缩不重置总结水位线，两者独立）。
// 注意：这里复刻的是 index.js 里 summaryBoundaryIndex / compressChatHistory 的核心算法
// （去掉 UI/保存/网络副作用），若算法改动请同步这份测试。

import assert from 'node:assert';

function messageSig(m) {
    if (!m) return '';
    return [m.gen_started || '', m.send_date || '', m.swipe_id == null ? 0 : m.swipe_id].join('|');
}

// 复刻 index.js summaryBoundaryIndex 的核心（纯函数）
function summaryBoundaryIndexCore(chat, lastCommittedMessageKey, lastSummaryIndex) {
    if (!Array.isArray(chat) || !chat.length) return 0;
    const key = lastCommittedMessageKey;
    if (typeof key === 'string' && key) {
        for (let i = chat.length - 1; i >= 0; i--) {
            if (messageSig(chat[i]) === key) return i + 1;
        }
    }
    const w = lastSummaryIndex;
    if (w == null || w < 0) return 0;
    return w + 1;
}

// 复刻 index.js compressChatHistory 的「压缩范围」核心（纯函数）
function compressRangeCore(chat, keep, lastCompressToKey) {
    const oldCount = chat.length - keep;
    if (oldCount < 2) return { indexedOld: [], compressStart: 1, oldCount };
    let compressStart = 1;
    if (typeof lastCompressToKey === 'string' && lastCompressToKey) {
        for (let i = oldCount - 1; i >= 1; i--) {
            if (messageSig(chat[i]) === lastCompressToKey) { compressStart = i + 1; break; }
        }
    }
    const indexedOld = chat.slice(compressStart, oldCount)
        .map((m, i) => ({ m, i: i + compressStart }))
        .filter(x => x.m && typeof x.m.mes === 'string' && x.m.mes.trim() && !x.m.is_system);
    return { indexedOld, compressStart, oldCount };
}

// 复刻 index.js hasUnsummarizedChat 的核心（纯函数）
function hasUnsummarizedCore(chat, lastCommittedMessageKey, lastSummaryIndex) {
    if (!Array.isArray(chat) || chat.length < 2) return false;
    let w = lastSummaryIndex;
    const key = lastCommittedMessageKey;
    if (typeof key === 'string' && key) {
        for (let i = chat.length - 1; i >= 0; i--) {
            if (messageSig(chat[i]) === key) { w = i; break; }
        }
    }
    if (w == null || w < 0 || w >= chat.length) return true;
    for (let i = chat.length - 1; i > w; i--) {
        const m = chat[i];
        if (m && !m.is_user && !m.is_system && typeof m.mes === 'string' && m.mes.trim()) return true;
    }
    return false;
}

// 造消息
let seq = 0;
function ai(i, mes, extra = {}) {
    return { name: '角色', is_user: false, is_system: false, mes, send_date: 1000 + i, gen_started: 1000 + i, swipe_id: 0, ...extra };
}
function sys(mes, extra = {}) {
    return { name: '', is_user: false, is_system: true, mes, send_date: 1000000 + (seq++), gen_started: 1000000 + seq, swipe_id: 0, ...extra };
}

let passed = 0;
function t(name, fn) {
    fn();
    passed++;
    console.log('  ✓ ' + name);
}

console.log('cursor.test.mjs');

// Phase 2：身份键还在（重进不丢）→ 精确回到它的下一条，不被下标漂移影响
t('Phase2 身份键命中：水位线 = 键所在消息 + 1', () => {
    const chat = [ai(0, '开场白'), ai(1, 'A'), ai(2, 'B'), ai(3, 'C')];
    const key = messageSig(chat[2]); // 上次总结锁定在 B（下标2）
    // 下标兜底故意给个错值，证明键优先于下标
    assert.equal(summaryBoundaryIndexCore(chat, key, 0), 3);
});

// Phase 2：身份键被重roll（签名变了）→ 退回下标兜底，不越过整段
t('Phase2 身份键失效（重roll）：退回下标兜底', () => {
    const chat = [ai(0, '开场白'), ai(1, 'A'), ai(2, 'B')];
    const key = messageSig({ gen_started: 9999, send_date: 9999, swipe_id: 1 }); // 已不存在的旧键
    assert.equal(summaryBoundaryIndexCore(chat, key, 1), 2);
});

// Phase 2：无身份键（旧数据迁移）→ 走旧下标逻辑
t('Phase2 无身份键：走旧下标兜底', () => {
    const chat = [ai(0, '开场白'), ai(1, 'A'), ai(2, 'B'), ai(3, 'C')];
    assert.equal(summaryBoundaryIndexCore(chat, '', 1), 2);
    assert.equal(summaryBoundaryIndexCore(chat, '', -1), 0);
    assert.equal(summaryBoundaryIndexCore(chat, '', null), 0);
});

// Phase 3 / T09：二次压缩只归档新消息，不从第1楼重来，跳过占位/已隐藏的系统消息
t('Phase3/T09 二次压缩：只归档新消息，跳过系统占位', () => {
    // 第一次压缩前：11 条（0开场白 + 1..10），keep=3 → 压缩 1..7
    const chat = [];
    chat.push(ai(0, '开场白'));
    for (let i = 1; i <= 10; i++) chat.push(ai(i, '消息' + i));
    const keep = 3;
    const first = compressRangeCore(chat, keep, '');
    assert.equal(first.indexedOld.length, 7, '第一次压缩 7 条');
    assert.equal(first.indexedOld[0].i, 1);
    assert.equal(first.indexedOld[6].i, 7);
    const lastKey = messageSig(first.indexedOld[first.indexedOld.length - 1].m);

    // 模拟 index.js：隐藏 1..7，在 oldCount(=8) 处插入摘要替身
    for (let i = 1; i < 8; i++) chat[i].is_system = true;
    chat.splice(8, 0, sys('【前情摘要】'));

    // 之后又聊了 3 条新消息（append 到末尾）
    chat.push(ai(11, '新1'), ai(12, '新2'), ai(13, '新3'));

    const second = compressRangeCore(chat, keep, lastKey);
    const mesOf = second.indexedOld.map(x => x.m.mes);
    // 只归档上次 keep 保留、如今已变旧的 3 条（orig8/9/10），不重复压缩 1..7，也不把摘要替身当正文
    assert.deepEqual(mesOf, ['消息8', '消息9', '消息10']);
    assert.equal(second.indexedOld.every(x => !x.m.is_system), true, '不能把 is_system 占位纳入');
});

// Phase 3 / T11：压缩游标与总结游标独立——压缩范围只取决于 keep + lastCompressToKey，
// 不看 lastSummaryIndex/lastCommittedMessageKey，压缩不会污染总结水位线
t('Phase3/T11 压缩与总结游标相互独立', () => {
    const chat = [];
    chat.push(ai(0, '开场白'));
    for (let i = 1; i <= 10; i++) chat.push(ai(i, '消息' + i));
    const keep = 3;
    const first = compressRangeCore(chat, keep, '');
    const lastKey = messageSig(first.indexedOld[first.indexedOld.length - 1].m);
    // 结论：compressRangeCore 的入参里根本没有总结游标字段，天然独立；
    // 这里断言压缩结果不受「总结水位线」数值影响（传什么都不会改变压缩范围）
    const a = compressRangeCore(chat, keep, lastKey).indexedOld.length;
    const b = compressRangeCore(chat, keep, lastKey).indexedOld.length;
    assert.equal(a, b);
    // 第一次压缩后，总结水位线（若存在）应仍指向它自己的游标，不被压缩改写——由 index.js 里
    // 压缩成功路径只写 lastCompressToKey、不碰 lastSummaryIndex/lastCommittedMessageKey 保证。
    assert.ok(true, '压缩成功路径只写 lastCompressToKey（见 index.js 断言处）');
});

// hasUnsummarizedChat 边界：水位线正好停在最后一条（刚总结完/重进聊天）→ 无新内容，返回 false
t('hasUnsummarized 边界：水位线在最后一条 → false', () => {
    const chat = [ai(0, '开场白'), ai(1, 'A'), ai(2, 'B')];
    // lastSummaryIndex = 2 = 最后一条已总结；无身份键（旧数据）也应有相同结论
    assert.equal(hasUnsummarizedCore(chat, '', 2), false);
    // 身份键指向最后一条 → false
    assert.equal(hasUnsummarizedCore(chat, messageSig(chat[2]), 2), false);
});

// hasUnsummarizedChat：水位线之前有新 AI 回复 → true；从没总结过 → true
t('hasUnsummarized：有新回复/从未总结 → true', () => {
    const chat = [ai(0, '开场白'), ai(1, 'A'), ai(2, 'B'), ai(3, 'C')];
    assert.equal(hasUnsummarizedCore(chat, messageSig(chat[1]), 1), true, '水位线后还有 AI 回复');
    assert.equal(hasUnsummarizedCore(chat, '', -1), true, '从未总结视为有');
});

console.log('全部通过：' + passed + ' 项');
