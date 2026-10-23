// Serendipity 记忆回滚安全（Phase 1）纯逻辑回归测试
// 运行：node test/rollback-safety.test.mjs
// 覆盖 spec 里的 T05（重进不丢记忆）、T06（重roll 只失效来源记忆）、
// T07（删未总结消息不全量回滚）、T08（删已总结消息只失效来源）、T13（连续重roll 幂等）。
// 注意：这里复刻的是 index.js 里 reconcileWithChat 的核心算法（去掉 UI/保存副作用），
// 若算法改动请同步这份测试。

import assert from 'node:assert';

function messageSig(m) {
    if (!m) return '';
    return [m.gen_started || '', m.send_date || '', m.swipe_id == null ? 0 : m.swipe_id].join('|');
}

// 复刻 reconcileWithChat 的核心（纯函数）：失效 src 已不存在的记忆/时间线条目
function reconcileCore(chat, memories, timeline) {
    const live = new Set();
    for (const m of chat) {
        const s = messageSig(m);
        if (s) live.add(s);
    }
    let changed = false;
    let minSrcIdx = Infinity;
    const dropStale = (arr) => {
        if (!Array.isArray(arr)) return;
        for (let i = arr.length - 1; i >= 0; i--) {
            const e = arr[i];
            if (e && typeof e.src === 'string' && e.src && !live.has(e.src)) {
                if (typeof e.srcIdx === 'number' && e.srcIdx < minSrcIdx) minSrcIdx = e.srcIdx;
                arr.splice(i, 1);
                changed = true;
            }
        }
    };
    dropStale(memories);
    dropStale(timeline);
    return { changed, minSrcIdx: minSrcIdx === Infinity ? null : minSrcIdx };
}

// 造一条消息
let seq = 0;
function ai(i, mes, extra = {}) {
    return { name: '角色', is_user: false, mes, send_date: 1000 + i, gen_started: 1000 + i, swipe_id: 0, ...extra };
}
function user(i, mes) {
    return { name: '用户', is_user: true, mes, send_date: 1000 + i, gen_started: 1000 + i, swipe_id: 0 };
}
function mem(id, src, srcIdx) {
    return { id, time: 0, src, srcIdx, text: '记忆' + id };
}

let passed = 0;
function t(name, fn) {
    fn();
    passed++;
    console.log('  ✓ ' + name);
}

console.log('rollback-safety.test.mjs');

// T06：重roll 最后一条回复 → 只失效来源命中的记忆，无关记忆保留
t('T06 重roll最后一条：只失效来源记忆，无关记忆保留', () => {
    const chat = [ai(0, '开场白'), user(1, '你好'), ai(2, '第一次回复')];
    const sig2 = messageSig(chat[2]);
    // 记忆 A 来自第2条回复；记忆 B 来自更早的开场白（src=开场白签名）
    const memories = [mem('A', sig2, 2), mem('B', messageSig(chat[0]), 0)];
    const timeline = [];
    // 重roll：第2条被替换成新版本（时间戳 + swipe_id 变化）
    chat[2] = ai(2, '第一次回复（新版）', { send_date: 9999, gen_started: 9999, swipe_id: 1 });
    const r = reconcileCore(chat, memories, timeline);
    assert.equal(r.changed, true);
    assert.deepEqual(memories.map(m => m.id), ['B'], '只有来源被替换的记忆 A 被删，B 保留');
    assert.equal(r.minSrcIdx, 2, '水位线退回到第2条之前');
});

// T05：退出重进（签名不变）→ 什么都不失效
t('T05 退出重进（消息未变）：不失效任何记忆', () => {
    const chat = [ai(0, '开场白'), user(1, '你好'), ai(2, '回复')];
    const memories = [mem('A', messageSig(chat[2]), 2), mem('B', messageSig(chat[0]), 0)];
    const r = reconcileCore(chat, memories, []);
    assert.equal(r.changed, false);
    assert.equal(memories.length, 2);
});

// T08：删除已总结消息 → 只失效来源，无关记忆保留
t('T08 删除已总结消息：只失效来源，无关记忆保留', () => {
    const chat = [ai(0, '开场白'), user(1, '你好'), ai(2, '回复')];
    const memories = [mem('A', messageSig(chat[2]), 2), mem('B', messageSig(chat[0]), 0)];
    chat.splice(2, 1); // 删除第2条
    const r = reconcileCore(chat, memories, []);
    assert.equal(r.changed, true);
    assert.deepEqual(memories.map(m => m.id), ['B']);
    assert.equal(r.minSrcIdx, 2);
});

// T07：删除未总结消息（无 src 指向它）→ 不全量回滚
t('T07 删除未总结消息：不影响任何记忆', () => {
    const chat = [ai(0, '开场白'), user(1, '你好'), ai(2, '回复'), user(3, '再说点')];
    const memories = [mem('A', messageSig(chat[2]), 2)];
    chat.splice(3, 1); // 删除尚未总结的第3条（用户消息）
    const r = reconcileCore(chat, memories, []);
    assert.equal(r.changed, false, '没有记忆的来源命中被删消息，不应回滚');
    assert.equal(memories.length, 1);
});

// T13：连续重roll 幂等——第二次检测不再重复撤销、不倒退
t('T13 连续重roll：幂等，不反复倒退', () => {
    const chat = [ai(0, '开场白'), user(1, '你好'), ai(2, '回复')];
    const memories = [mem('A', messageSig(chat[2]), 2), mem('B', messageSig(chat[0]), 0)];
    chat[2] = ai(2, '回复 v2', { send_date: 2000, gen_started: 2000, swipe_id: 1 });
    const r1 = reconcileCore(chat, memories, []);
    assert.equal(r1.changed, true);
    assert.deepEqual(memories.map(m => m.id), ['B']);
    // 同一状态下再跑一次：没有新的失效，不倒退
    const r2 = reconcileCore(chat, memories, []);
    assert.equal(r2.changed, false);
    assert.deepEqual(memories.map(m => m.id), ['B']);
});

// 迁移安全：旧记忆（无 src 字段）永远不被失效
t('迁移安全：无 src 的旧记忆一律保留', () => {
    const chat = [ai(0, '开场白'), user(1, '你好'), ai(2, '回复')];
    const memories = [{ id: 'OLD', time: 0, text: '旧记忆（无src）' }];
    chat[2] = ai(2, '回复 v2', { send_date: 2000, gen_started: 2000, swipe_id: 1 });
    const r = reconcileCore(chat, memories, []);
    assert.equal(r.changed, false);
    assert.equal(memories.length, 1, '无 src 的旧记忆不能被静默清空');
});

// 时间线同样按来源失效
t('时间线：来源被替换的时间线条目同样失效', () => {
    const chat = [ai(0, '开场白'), user(1, '你好'), ai(2, '回复')];
    const timeline = [
        { id: 'tA', day: 1, src: messageSig(chat[2]), srcIdx: 2, event: 'A' },
        { id: 'tB', day: 1, src: messageSig(chat[0]), srcIdx: 0, event: 'B' },
    ];
    chat[2] = ai(2, '回复 v2', { send_date: 2000, gen_started: 2000, swipe_id: 1 });
    const r = reconcileCore(chat, [], timeline);
    assert.equal(r.changed, true);
    assert.deepEqual(timeline.map(e => e.id), ['tB']);
});

// 复刻 index.js reconcileWithChat 里「归档待核对」的核心（纯函数，C05/M07）：
// 归档来源消息（srcKeys）被重roll/删除后标记 needsReview，绝不删归档；无 srcKeys 的旧归档一律不判
function markStaleArchiveCore(chat, archive) {
    const live = new Set();
    for (const m of chat) { const s = messageSig(m); if (s) live.add(s); }
    let changed = false;
    for (const a of archive) {
        if (!a || !Array.isArray(a.srcKeys) || !a.srcKeys.length) continue;
        if (!a.needsReview && a.srcKeys.some(k => !live.has(k))) {
            a.needsReview = true;
            changed = true;
        }
    }
    return { changed, archive };
}

// C05：归档来源消息被重roll → 标记待核对，不删归档、无关归档不动
t('C05 归档来源被重roll：标记待核对、不删归档', () => {
    const chat = [ai(0, '开场白'), user(1, '你好'), ai(2, '回复'), user(3, '再聊'), ai(4, '收尾')];
    const arch = [
        { id: 'A1', srcKeys: [messageSig(chat[2]), messageSig(chat[4])], needsReview: false },
        { id: 'A2', srcKeys: [messageSig(chat[0])], needsReview: false },
    ];
    chat[4] = ai(4, '收尾 v2', { send_date: 9999, gen_started: 9999, swipe_id: 1 });
    const r = markStaleArchiveCore(chat, arch);
    assert.equal(r.changed, true);
    assert.equal(arch.length, 2, '归档不被删除');
    assert.equal(arch[0].needsReview, true, '来源命中的归档标记待核对');
    assert.equal(arch[1].needsReview, false, '无关归档不动');
});

// C05：无 srcKeys 的旧归档 → 永不判、永不删
t('C05 旧归档（无 srcKeys）：保留不判', () => {
    const chat = [ai(0, '开场白'), user(1, '你好'), ai(2, '回复')];
    const arch = [{ id: 'OLD', from: 1, to: 2, needsReview: false }];
    chat[2] = ai(2, '回复 v2', { send_date: 9999, gen_started: 9999, swipe_id: 1 });
    const r = markStaleArchiveCore(chat, arch);
    assert.equal(r.changed, false);
    assert.equal(arch[0].needsReview, false);
});

console.log('全部通过：' + passed + ' 项');
