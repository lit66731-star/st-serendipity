// 摘要「提交」阶段的状态机（纯逻辑，无酒馆依赖，便于生产代码直接测试）。
// 核心不变量（T002）：只有摘要结果及其关联状态确认持久化成功后，才允许推进已提交游标。

// 本批消息是否已有对应记忆（src 命中）：用于幂等恢复——上一轮数据已写入但游标未提交时，
// 重试不再重复写入，只补提交游标。
export function hasMemoryForSource(settings, sigBefore) {
    return !!(settings && Array.isArray(settings.memories)
        && settings.memories.some(m => m && m.src === sigBefore));
}

// 两段式提交：① 先落盘数据（游标保持旧值）；② 数据确认落盘后才推进游标并再次落盘。
// save 由调用方注入（生产里是 saveSettingsImmediate），便于测试注入失败点。
// clearFailStreak 由调用方注入（生产里清 summaryFailStreak[key]）。
// 返回 { committed, cursorAdvanced, phase }：
//   committed       = 游标也已确认落盘（整批真正完成）
//   cursorAdvanced  = 游标是否已在内存里推进（data_save_failed 时为 false，其余为 true）
//   phase           = 'data_save_failed' | 'cursor_save_failed' | 'committed'
export async function commitSummary({ settings, lastIdx, sigBefore, save, clearFailStreak, onSaveFailed }) {
    // ① 落盘数据（游标保持旧值）
    let persisted = false;
    try {
        await save();
        persisted = true;
    } catch (e) {
        if (onSaveFailed) onSaveFailed('data', e);
    }
    if (!persisted) {
        // 数据没落盘：游标不推进，本批保持待总结；重试时 hasMemoryForSource 会拦住重复写入
        return { committed: false, cursorAdvanced: false, phase: 'data_save_failed' };
    }

    // ② 数据已落盘 → 推进游标并二次落盘
    settings.lastSummaryIndex = lastIdx;
    settings.lastCommittedMessageKey = sigBefore;
    if (clearFailStreak) clearFailStreak();

    let cursorPersisted = false;
    try {
        await save();
        cursorPersisted = true;
    } catch (e) {
        if (onSaveFailed) onSaveFailed('cursor', e);
    }
    return {
        committed: cursorPersisted,
        cursorAdvanced: true,
        phase: cursorPersisted ? 'committed' : 'cursor_save_failed',
    };
}
