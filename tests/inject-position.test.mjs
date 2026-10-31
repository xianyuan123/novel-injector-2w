/**
 * 注入位置：主提示前 / 主提示后 / 聊天内。
 *
 * 以前「主提示前」是在 messages 最前面 unshift 一条独立消息——Claude/Gemini 的适配器
 * 会合并或丢弃它，中转服务也常把 messages[0] 当成主提示词替换，表现就是「注入了但没生效」。
 * 现在改成并进第一条 system 的文本里。这组测试盯着这个行为别再退回去。
 */
import assert from 'node:assert/strict';
import { readPlugin, pluginUrl } from './_paths.mjs';

const apiSrc = readPlugin('lib/api-system.js');
const idx = readPlugin('index.js');

const { createGlobalPromptTools } = await import(pluginUrl('lib/api-system.js'));
const { niInsertGlobalPromptMessage, niInsertIntoEventChat } = createGlobalPromptTools();

let pass = 0;
const failures = [];
function check(name, fn) {
    try {
        fn();
        pass += 1;
        console.log(`  ok   ${name}`);
    } catch (error) {
        failures.push({ name, error });
        console.log(`  FAIL ${name}\n       ${error?.message || error}`);
    }
}
const group = title => console.log(title);

/** 角色编号：0 = system，1 = user，2 = assistant（见 niGlobalRoleName） */
const ROLE_SYSTEM = 0;
const ROLE_USER = 1;

function makeChat() {
    return [
        { role: 'system', content: '主提示词：你是小说助手。' },
        { role: 'user', content: '继续' },
        { role: 'assistant', content: '好' },
    ];
}

// ───────────────────────── A. 主提示前 ─────────────────────────
group('A. 主提示前（pos=2）');

check('A1 有 system + 系统角色：并进第一条 system 的开头，不新增消息', () => {
    const chat = makeChat();
    const out = niInsertGlobalPromptMessage(chat, '【世界设定】王朝末年', {
        pos: 2, depth: 0, role: ROLE_SYSTEM, preferPrependSystem: true,
    });
    assert.equal(out.length, chat.length, '不该新增消息');
    assert.ok(out[0].content.startsWith('【世界设定】王朝末年'), '内容应在 system 开头');
    assert.ok(out[0].content.endsWith('主提示词：你是小说助手。'), '原主提示词应保留在后面');
    assert.equal(out[0].role, 'system');
});

check('A2 有 system 但角色不是 system：插到 system 之后，数组仍以 system 开头', () => {
    const chat = makeChat();
    const out = niInsertGlobalPromptMessage(chat, '【用户设定】我是读者', {
        pos: 2, depth: 0, role: ROLE_USER, preferPrependSystem: true,
    });
    assert.equal(out.length, chat.length + 1);
    assert.equal(out[0].role, 'system', '首条必须还是 system');
    assert.equal(out[1].content, '【用户设定】我是读者');
});

check('A3 没有 system 消息：退回插到最前面', () => {
    const chat = [{ role: 'user', content: '继续' }];
    const out = niInsertGlobalPromptMessage(chat, '【阶段】第 3 阶段', {
        pos: 2, depth: 0, role: ROLE_SYSTEM, preferPrependSystem: true,
    });
    assert.equal(out.length, 2);
    assert.equal(out[0].content, '【阶段】第 3 阶段');
});

check('A4 关掉合并（preferPrependSystem=false）：保持旧的独立消息行为', () => {
    const chat = makeChat();
    const out = niInsertGlobalPromptMessage(chat, '【旧行为】', {
        pos: 2, depth: 0, role: ROLE_SYSTEM, preferPrependSystem: false,
    });
    assert.equal(out.length, chat.length + 1, '不合并时应新增一条');
    assert.equal(out[1].role, 'system', '独立消息仍在 system 之后，不会破坏首条');
});

check('A5 连续注入两块：顺序不倒（先注入的在前）', () => {
    let chat = makeChat();
    chat = niInsertGlobalPromptMessage(chat, '【第一块】', { pos: 2, depth: 0, role: ROLE_SYSTEM, preferPrependSystem: true });
    chat = niInsertGlobalPromptMessage(chat, '【第二块】', { pos: 2, depth: 0, role: ROLE_SYSTEM, preferPrependSystem: true });
    assert.ok(chat[0].content.startsWith('【第二块】'), '后注入的贴在最外层');
    assert.ok(chat[0].content.includes('【第一块】'));
    assert.ok(chat[0].content.includes('主提示词'));
});

// ───────────────────────── B. 主提示后 ─────────────────────────
group('B. 主提示后（pos=0）');

check('B1 有 system + 系统角色：并进第一条 system 的结尾', () => {
    const chat = makeChat();
    const out = niInsertGlobalPromptMessage(chat, '【收尾提醒】别跳阶段', {
        pos: 0, depth: 0, role: ROLE_SYSTEM, preferPrependSystem: true,
    });
    assert.equal(out.length, chat.length);
    assert.ok(out[0].content.startsWith('主提示词'), '原主提示词仍在前');
    assert.ok(out[0].content.endsWith('【收尾提醒】别跳阶段'), '内容接在最后');
});

check('B2 没有 system：插到最前面（不丢内容）', () => {
    const out = niInsertGlobalPromptMessage([{ role: 'user', content: '继续' }], '【收尾】', {
        pos: 0, depth: 0, role: ROLE_SYSTEM, preferPrependSystem: true,
    });
    assert.equal(out.length, 2);
    assert.equal(out[0].content, '【收尾】');
});

check('B3 角色不是 system：插到 system 之后', () => {
    const out = niInsertGlobalPromptMessage(makeChat(), '【收尾】', {
        pos: 0, depth: 0, role: ROLE_USER, preferPrependSystem: true,
    });
    assert.equal(out[0].role, 'system');
    assert.equal(out[1].content, '【收尾】');
});

// ───────────────────────── C. 聊天内 ─────────────────────────
group('C. 聊天内（pos=1）');

check('C1 深度 0：接在最后', () => {
    const chat = makeChat();
    const out = niInsertGlobalPromptMessage(chat, '【最近剧情】', {
        pos: 1, depth: 0, role: ROLE_SYSTEM, preferPrependSystem: true,
    });
    assert.equal(out.length, chat.length + 1);
    assert.equal(out[out.length - 1].content, '【最近剧情】');
});

check('C2 深度 2：后面正好留 2 条消息', () => {
    const chat = makeChat();
    const out = niInsertGlobalPromptMessage(chat, '【深 2】', {
        pos: 1, depth: 2, role: ROLE_SYSTEM, preferPrependSystem: true,
    });
    assert.equal(out.length, chat.length + 1);
    const at = out.findIndex(item => item.content === '【深 2】');
    assert.equal(at, 1, '应插在索引 1（原数组长度 3 - 深度 2）');
    assert.equal(out.length - at - 1, 2, '后面正好 2 条消息');
    assert.equal(out[out.length - 1].content, '好', '最后一条不变');
});

check('C3 深度超过长度：夹到最前面', () => {
    const chat = makeChat();
    const out = niInsertGlobalPromptMessage(chat, '【深 99】', {
        pos: 1, depth: 99, role: ROLE_SYSTEM, preferPrependSystem: true,
    });
    assert.equal(out.length, chat.length + 1);
    assert.equal(out[0].content, '【深 99】');
});

// ───────────────────────── D. 事件路径接线 ─────────────────────────
group('D. 接线');

check('D1 doInject 走事件路径时显式要求合并 system', () => {
    assert.ok(
        idx.includes('niInsertIntoEventChat(eventData.chat, content, pos, depth, role, { mergeSystemHead: true })'),
        'index.js 的 doInject 应传 mergeSystemHead: true',
    );
});

check('D2 niInsertIntoEventChat 默认就合并（默认参数 true）', () => {
    assert.ok(apiSrc.includes('function niInsertIntoEventChat(chat, content, pos, depth, role, { mergeSystemHead = true } = {})'));
    assert.ok(apiSrc.includes('preferPrependSystem: mergeSystemHead'));
});

check('D3 插件自己发请求时的合并路径没被改坏', () => {
    const chat = makeChat();
    const out = niInsertIntoEventChat(chat, '【并进 head】', 2, 0, ROLE_SYSTEM);
    assert.equal(chat.length, 3, '同一个数组里合并，不新增消息');
    assert.ok(chat[0].content.startsWith('【并进 head】'));
    assert.equal(out, undefined, '函数原地改数组，不返回新数组');
});

check('D4 原数组不被就地修改的旧隐患：纯函数返回新数组', () => {
    const chat = makeChat();
    const snapshot = chat.map(item => item.content);
    niInsertGlobalPromptMessage(chat, '【不该改动原数组】', { pos: 2, depth: 0, role: ROLE_SYSTEM, preferPrependSystem: true });
    assert.deepEqual(chat.map(item => item.content), snapshot, '输入数组应保持原样');
});

console.log('');
if (failures.length) {
    console.log(`inject-position: ${failures.length} 个失败 / 共 ${pass + failures.length} 条`);
    for (const { name, error } of failures) console.log(`  - ${name}: ${error?.message || error}`);
    process.exitCode = 1;
} else {
    console.log(`inject-position: 全部通过（${pass} 条）`);
}
