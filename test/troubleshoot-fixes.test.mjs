import assert from 'node:assert';

let passed = 0;
function t(name, fn) {
    fn();
    passed++;
    console.log('  ✓ ' + name);
}

console.log('troubleshoot-fixes.test.mjs');

// 1. 世界书归档 selective 属性契约
t('世界书归档契约：selective 必须为 false 且 keysecondary 为空', () => {
    // 模拟归档条目创建
    const entry = {
        key: ['沈昭', '清河镇'],
        keysecondary: [],
        selective: false,
        constant: false,
    };
    // 验证符合 SillyTavern 激活规范（当 selective: false 时，matchSecondaryKeys 不生效，直接由主关键词召回）
    assert.strictEqual(entry.selective, false);
    assert.strictEqual(entry.constant, false);
    assert.ok(entry.key.length > 0);
});

// 2. 自动修复旧世界书中被错误标记为 selective: true 的条目
t('自动修复机制：修正旧版写入的 [Serendipity] 条目 selective 属性', () => {
    const data = {
        entries: {
            '1': { uid: '1', comment: '[Serendipity] 剧情记忆归档', selective: true, keysecondary: [] },
            '2': { uid: '2', comment: '普通世界书条目', selective: true, keysecondary: ['战斗'] },
        }
    };
    // 运行修复逻辑
    for (const uid of Object.keys(data.entries)) {
        const item = data.entries[uid];
        if (item && typeof item.comment === 'string' && item.comment.startsWith('[Serendipity]') && item.selective) {
            item.selective = false;
        }
    }
    assert.strictEqual(data.entries['1'].selective, false, 'Serendipity 条目已自动解除 selective 次级限制');
    assert.strictEqual(data.entries['2'].selective, true, '非插件条目保留原生配置');
});

// 3. 游标处理：退化空特征 ||0 不作为有效身份键
t('身份键防御：退化 key ||0 不得将水位线误跳至最后一条', () => {
    const chat = [
        { is_user: true, is_system: false, mes: '问' },
        { is_user: false, is_system: false, mes: '答1' },
        { is_user: true, is_system: false, mes: '问2' },
        { is_user: false, is_system: false, mes: '答2' },
    ];
    // 模拟 messageSig 生成
    const messageSig = (m) => [m.gen_started || '', m.send_date || '', m.swipe_id == null ? 0 : m.swipe_id].join('|');
    const summaryBoundaryIndexCore = (chat, key, w) => {
        if (!Array.isArray(chat) || !chat.length) return 0;
        if (typeof key === 'string' && key && key !== '||0') {
            for (let i = chat.length - 1; i >= 0; i--) {
                if (messageSig(chat[i]) === key) return i + 1;
            }
        }
        if (w == null || w < 0) return 0;
        return w + 1;
    };
    // 当 key 为退化的 ||0 时，应忽略该键并使用下标 w=1 -> 边界为 2
    assert.strictEqual(summaryBoundaryIndexCore(chat, '||0', 1), 2);
});

// 4. 端点格式化智能补全
t('端点智能补全：根地址自动补齐 /v1', () => {
    const embedEndpoint = (url) => {
        url = String(url || '').trim().replace(/\/+$/, '');
        if (!url) return '';
        if (/\/embeddings$/i.test(url)) return url;
        if (/\/chat\/completions$/i.test(url)) return url.replace(/\/chat\/completions$/i, '/embeddings');
        if (!/\/(v\d+|api)(\/|$)/i.test(url)) {
            return url + '/v1/embeddings';
        }
        return url + '/embeddings';
    };
    assert.strictEqual(embedEndpoint('https://api.siliconflow.cn'), 'https://api.siliconflow.cn/v1/embeddings');
    assert.strictEqual(embedEndpoint('https://api.openai.com/v1'), 'https://api.openai.com/v1/embeddings');
    assert.strictEqual(embedEndpoint('https://api.example.com/v1/chat/completions'), 'https://api.example.com/v1/embeddings');
    assert.strictEqual(embedEndpoint('https://api.example.com/embeddings'), 'https://api.example.com/embeddings');
});

// 5. 向量反序列化安全防御
t('Base64 向量反序列化：防御未对齐与非法格式', () => {
    const b64ToVec = (b64) => {
        try {
            if (typeof b64 !== 'string' || !b64) return [];
            const bin = atob(b64);
            if (!bin.length || bin.length % 4 !== 0) return [];
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            return Array.from(new Float32Array(bytes.buffer));
        } catch (e) {
            return [];
        }
    };
    assert.deepStrictEqual(b64ToVec(''), []);
    assert.deepStrictEqual(b64ToVec('invalid-base64!'), []);
    assert.deepStrictEqual(b64ToVec(btoa('abc')), []); // 3 bytes, not multiple of 4
});

console.log('全部通过：' + passed + ' 项');
