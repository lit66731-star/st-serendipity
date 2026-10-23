// Serendipity 摘要提交状态机（T002）生产代码回归测试
// 运行：node test/summary-commit.test.mjs
// 直接导入 src/summary-commit.js（生产代码，非复刻），验证核心不变量：
//   只有摘要数据确认持久化成功后，游标才允许推进；失败不推进；重试幂等；重新打开聊天后能恢复。

import assert from 'node:assert';
import { hasMemoryForSource, commitSummary } from '../src/summary-commit.js';

let passed = 0;
async function t(name, fn) { await fn(); passed++; console.log('  ✓ ' + name); }

const mkSettings = () => ({
    memories: [],
    lastSummaryIndex: -1,
    lastCommittedMessageKey: '',
});

// 可编程 save：failOn 指定第几次调用失败；成功后把关键字段快照进 disk（模拟 ST 的整对象持久化）
function failingSave(settingsRef, { failOn = [] } = {}) {
    let call = 0;
    const disk = {};
    const save = async () => {
        call++;
        if (failOn.includes(call)) throw new Error('save #' + call + ' failed');
        disk.lastSummaryIndex = settingsRef.lastSummaryIndex;
        disk.lastCommittedMessageKey = settingsRef.lastCommittedMessageKey;
        disk.memories = (settingsRef.memories || []).slice();
    };
    return { save, disk };
}

console.log('summary-commit.test.mjs');

// 1) 摘要成功但保存失败：游标绝不能推进，本批保持待总结
await t('数据保存失败：游标不推进、本批保持待总结', async () => {
    const settings = mkSettings();
    settings.memories.push({ id: 'm1', src: 'sig-1', text: '记忆' });
    const { save, disk } = failingSave(settings, { failOn: [1] });
    const r = await commitSummary({ settings, lastIdx: 5, sigBefore: 'sig-1', save });
    assert.equal(r.committed, false);
    assert.equal(r.phase, 'data_save_failed');
    assert.equal(r.cursorAdvanced, false, '数据没落盘，游标不得推进');
    assert.equal(settings.lastSummaryIndex, -1, 'lastSummaryIndex 保持旧值');
    assert.equal(settings.lastCommittedMessageKey, '', '身份键保持旧值');
    assert.equal(disk.lastSummaryIndex, undefined, '磁盘未写入游标');
});

// 2) 保存成功但游标提交失败：数据已落盘、游标在内存推进但磁盘未推进；重试靠 hasMemoryForSource 幂等补提交
await t('游标提交保存失败：数据落盘、磁盘游标未推进，重试幂等补提交', async () => {
    const settings = mkSettings();
    settings.memories.push({ id: 'm1', src: 'sig-1', text: '记忆' });
    const { save, disk } = failingSave(settings, { failOn: [2] }); // 第 2 次（游标落盘）失败
    const r = await commitSummary({ settings, lastIdx: 5, sigBefore: 'sig-1', save });
    assert.equal(r.committed, false);
    assert.equal(r.phase, 'cursor_save_failed');
    assert.equal(r.cursorAdvanced, true, '数据已落盘，内存游标允许推进');
    assert.equal(settings.lastSummaryIndex, 5);
    assert.equal(disk.memories.length, 1, '数据已落盘');
    assert.equal(disk.lastSummaryIndex, -1, '磁盘游标仍是旧值（游标未提交）');
    assert.equal(disk.lastCommittedMessageKey, '', '磁盘身份键仍是旧值');
    // 幂等：重试时应识别本批已有记忆，不再重复写入，只补提交游标
    assert.equal(hasMemoryForSource(settings, 'sig-1'), true, '识别到本批已写入的记忆');
    const { save: save2, disk: disk2 } = failingSave(settings, { failOn: [] });
    const r2 = await commitSummary({ settings, lastIdx: 5, sigBefore: 'sig-1', save: save2 });
    assert.equal(r2.committed, true);
    assert.equal(settings.memories.length, 1, '重试不重复添加记忆');
    assert.equal(disk2.lastSummaryIndex, 5, '补提交后磁盘游标推进');
});

// 3) 连续重试：前两次数据保存失败，第三次成功，收敛且不重复写入
await t('连续重试收敛：失败后再试成功，不重复写入', async () => {
    const settings = mkSettings();
    settings.memories.push({ id: 'm1', src: 'sig-1', text: '记忆' });
    const { save } = failingSave(settings, { failOn: [1, 2] }); // 前两次 save 调用失败
    const r1 = await commitSummary({ settings, lastIdx: 3, sigBefore: 'sig-1', save });
    assert.equal(r1.committed, false);
    assert.equal(settings.lastSummaryIndex, -1, '第一次失败后游标仍未推进');
    const r2 = await commitSummary({ settings, lastIdx: 3, sigBefore: 'sig-1', save });
    assert.equal(r2.committed, false);
    assert.equal(settings.lastSummaryIndex, -1, '第二次失败后游标仍未推进');
    const r3 = await commitSummary({ settings, lastIdx: 3, sigBefore: 'sig-1', save }); // 第 3 次成功
    assert.equal(r3.committed, true);
    assert.equal(settings.lastSummaryIndex, 3);
    assert.equal(settings.memories.length, 1, '连续重试不重复记忆');
});

// 4) 重新打开聊天后的恢复：磁盘游标决定边界；数据已持久化但游标未提交时识别并补提交
await t('重新打开聊天恢复：识别已持久化记忆并补提交游标', async () => {
    // 磁盘状态：记忆已持久化，但游标还是旧值（上次游标提交失败）
    const onDisk = mkSettings();
    onDisk.memories = [{ id: 'm1', src: 'sig-1', text: '记忆' }];
    onDisk.lastSummaryIndex = -1;
    onDisk.lastCommittedMessageKey = '';
    const restored = JSON.parse(JSON.stringify(onDisk)); // 重开后内存 = 磁盘快照
    assert.equal(hasMemoryForSource(restored, 'sig-1'), true, '重开后识别到已持久化的本批记忆');
    const { save, disk } = failingSave(restored, { failOn: [] });
    const r = await commitSummary({ settings: restored, lastIdx: 5, sigBefore: 'sig-1', save });
    assert.equal(r.committed, true);
    assert.equal(restored.memories.length, 1, '恢复补提交不重复记忆');
    assert.equal(disk.lastSummaryIndex, 5);
});

console.log('全部通过：' + passed + ' 项');
