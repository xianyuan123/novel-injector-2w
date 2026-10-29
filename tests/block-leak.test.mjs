// 回归：被「召回屏蔽」整段屏蔽的阶段，绝不能通过「摘要兜底」把阶段概括注入出去。
// 真实路径：index.js niBuildStageInjectionPayloadForPlan -> niBuildStageInjectionPayload
//         -> niBuildBoundedStageInjection（detail 为空时回落到 summary）
// 这里把真扩展复制到临时目录、只给 index.js 补两个测试钩子（不改生产逻辑），
// 用真实代码跑出「修之前会漏、修之后不漏」。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PLUGIN_ROOT } from './_paths.mjs';
import { pathToFileURL } from 'node:url';

const SRC = PLUGIN_ROOT;
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ni-leak-'));
const dest = path.join(tmpRoot, 'novel-injector');
fs.cpSync(SRC, dest, { recursive: true });

const indexPath = path.join(dest, 'index.js');
let indexSrc = fs.readFileSync(indexPath, 'utf8');
const hookAnchor = 'const S = {';
if (!indexSrc.includes(hookAnchor)) throw new Error('找不到 const S 锚点，无法打测试钩子');
indexSrc = indexSrc.replace(
    hookAnchor,
    'export function __niTestSetState(next) { Object.assign(S, next); }\n'
    + 'export function __niTestGetState() { return S; }\n'
    + hookAnchor,
);
// 生产函数本身不导出（扩展不需要），打一个测试钩子把它放出来，
// 保证跑的是真正的注入组装逻辑，而不是抄一份。
indexSrc = indexSrc.replace(
    'function niBuildStageInjectionPayloadForPlan(',
    'export function niBuildStageInjectionPayloadForPlan(',
);
if (!indexSrc.includes('export function niBuildStageInjectionPayloadForPlan(')) {
    throw new Error('给 niBuildStageInjectionPayloadForPlan 打测试钩子失败');
}
fs.writeFileSync(indexPath, indexSrc, 'utf8');

// 自检：把修复临时还原成「修复前」的写法，稍后用同一套断言跑一遍，
// 必须看到「阶段概括照样被注入」这条复现。不做这一步，永远通过的断言等于没测。
const fixedSnippet = `    const stageIndices = niExcludeBlockedStageIndices(
        plan.directStageInjectionStages,
        blockedRecallContext,
    );`;
if (!indexSrc.includes(fixedSnippet)) throw new Error('找不到修复代码，无法做「还原后必须失败」的自检');
const beforeSrcPath = path.join(dest, '_index-before-fix.js');
fs.writeFileSync(beforeSrcPath, indexSrc.replace(fixedSnippet, '    const stageIndices = plan.directStageInjectionStages;'), 'utf8');

// ── 给酒馆宿主模块打桩 ─────────────────────────────────────────────
// index.js 顶部 import 了 /scripts/extensions.js、/script.js 等酒馆宿主模块。
// 这些是「盘根绝对路径」，Node 下不存在；C:\ 根目录又不让写（EPERM），
// 于是改用 Node 的模块解析钩子把这些说明符重定向到临时目录里的桩文件。
const stubDir = path.join(tmpRoot, 'host-stubs');
fs.mkdirSync(stubDir, { recursive: true });
const stubSpecifiers = {
    '/scripts/extensions.js': "exports.extension_settings = globalThis.extension_settings || (globalThis.extension_settings = {});\n"
        + "exports.getContext = () => globalThis.__niCtx || (globalThis.__niCtx = { chat: [], characters: [], name1: 'User', name2: 'Char', chatId: 'test', saveMetadata() {} });\n"
        + "exports.renderExtensionTemplateAsync = async () => '';\n"
        + "exports.saveMetadataDebounced = () => {};\n",
    '/script.js': "exports.saveSettingsDebounced = () => {};\n"
        + "exports.cleanUpMessage = t => t;\n"
        + "exports.chat_metadata = {};\n"
        + "exports.event_types = { MESSAGE_SENT: 'message_sent', MESSAGE_RECEIVED: 'message_received', CHAT_CHANGED: 'chat_changed', MESSAGE_SWIPED: 'message_swiped', MESSAGE_UPDATED: 'message_updated', MESSAGE_EDITED: 'message_edited', MESSAGE_SWIPE_DELETED: 'message_swipe_deleted', MESSAGE_DELETED: 'message_deleted', CHAT_COMPLETION_PROMPT_READY: 'chat_completion_prompt_ready', GENERATION_AFTER_COMMANDS: 'generation_after_commands' };\n"
        + "exports.eventSource = { on() {}, off() {}, emit() {}, once() {} };\n"
        + "exports.extractMessageFromData = d => d?.mes || '';\n"
        + "exports.getCurrentChatId = () => 'test';\n"
        + "exports.getRequestHeaders = () => ({});\n"
        + "exports.messageFormatting = t => t;\n"
        + "exports.name1 = 'User';\n"
        + "exports.substituteParams = t => t;\n",
    '/scripts/openai.js': "exports.promptManager = { getPromptOrderForCharacter: () => [], messages: [], tokenHandler: { countTokens: async t => String(t || '').length } };\n",
    '/scripts/popup.js': "class Popup { constructor() {} async show() { return 0; } }\nexports.Popup = Popup;\nexports.POPUP_RESULT = { AFFIRMATIVE: 1, NEGATIVE: 0, CANCELLED: -1 };\n",
    '/scripts/preset-manager.js': "exports.getPresetManager = () => ({ getPresetList: () => [], getCompletionPresetByName: () => null });\n",
};
const stubFileFor = spec => path.join(stubDir, spec.replace(/[^a-zA-Z0-9]/g, '_') + '.cjs');
Object.entries(stubSpecifiers).forEach(([spec, body]) => {
    fs.writeFileSync(stubFileFor(spec), body, 'utf8');
});
const loaderPath = path.join(stubDir, 'loader.mjs');
fs.writeFileSync(loaderPath, `import { pathToFileURL } from 'node:url';\n`
    + `const MAP = ${JSON.stringify(Object.fromEntries(Object.keys(stubSpecifiers).map(spec => [spec, pathToFileURL(stubFileFor(spec)).href]))) };\n`
    + `export async function resolve(specifier, context, nextResolve) {\n`
    + `    if (MAP[specifier]) return { url: MAP[specifier], shortCircuit: true, format: 'commonjs' };\n`
    + `    return nextResolve(specifier, context);\n`
    + `}\n`, 'utf8');
const { register } = await import('node:module');
register(pathToFileURL(loaderPath).href);

let pass = 0, fail = 0;
const check = (label, fn) => {
    try {
        const result = fn();
        if (result === true || result === undefined) { pass++; console.log('  ok   ' + label); }
        else { fail++; console.log('  FAIL ' + label + ' -> ' + result); }
    } catch (e) { fail++; console.log('  FAIL ' + label + ' -> 抛错: ' + e.message); }
};

globalThis.extension_settings = { 'novel-injector': {} };
globalThis.console = console;
globalThis.indexedDB = {};          // 只被存起来当参数用，导入期不会真的调用
globalThis.alert = () => {};
globalThis.prompt = () => null;
globalThis.confirm = () => false;
globalThis.toastr = { info() {}, success() {}, warning() {}, error() {} };
globalThis.DOMPurify = { sanitize: t => t };
globalThis.FileReader = class { readAsText() {} readAsArrayBuffer() {} };
globalThis.URL.createObjectURL = () => 'blob:test';
globalThis.URL.revokeObjectURL = () => {};
globalThis.Blob = class { constructor() {} };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.document = {
    querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} } }),
    addEventListener() {}, body: { appendChild() {} },
};
globalThis.window = globalThis;
// index.js 结尾是 jQuery(async () => {...}) 的启动回调：这里只「抓走」回调不执行，
// 避免在 Node 里跑 DOM 初始化。$ 与 jQuery 同一个实现。
const bootCallbacks = [];
const makeJq = arg => {
    if (typeof arg === 'function') { bootCallbacks.push(arg); return undefined; }
    const el = { on() { return el; }, off() { return el; }, find() { return el; }, get: () => undefined, each() { return el; }, data: () => undefined, attr() { return el; }, addClass() { return el; }, removeClass() { return el; }, append() { return el; }, html() { return el; }, val: () => '', prop() { return el; }, closest() { return el; }, ready(cb) { if (typeof cb === 'function') bootCallbacks.push(cb); return el; }, length: 0 };
    return el;
};
makeJq.ajax = () => ({ done() { return this; }, fail() { return this; } });
globalThis.$ = makeJq;
globalThis.jQuery = makeJq;

const story = await import(pathToFileURL(path.join(dest, 'lib/story-data.js')).href);
const index = await import(pathToFileURL(indexPath).href);

const cfg = {
    rawInjMode: 'nodes',
    plotInjMaxTokens: 32000,
    vecInjDisabled: false,
    vecInjDisabledByUser: false,
    transBookMode: false,
    curStageFullInject: false,
};

// 同一套「准备状态 + 三种计划」探针，既跑修复版，也跑还原成修复前的版本。
// 只有两边结果不同（修复前会漏、修复后不漏），这个断言才算真的测到了东西。
function runProbe(mod, storyMod) {
    const state = mod.__niTestGetState();
    Object.assign(state, {
        stageMapN: 4,
        stageMap: {},
        stageSummaries: {
            3: '第三阶段的概括：主角在此遇见了旧友。',
            4: '第四阶段的概括。',
        },
        plots: {
            main: [{ title: '节点A', body: '正文A', stageIdx: 3, _chunkIdx: 5 }],
            sub: [], pivot: [],
        },
        chunks: { 5: '第五段原始文本' },
        chunkResults: {},
    });
    const nodeId = storyMod.niPlotNodeId(state.plots.main[0], 'main', 0);
    const basePlan = {
        directStageInjectionStages: [3, 4],
        directStageCurrentIdx: 4,
        blockedRecallContext: null,
        blockedRecallChunkIdxs: [],
        fullStageInjectionApplied: false,
        curTbNode: null,
    };
    const oneNodeCtx = storyMod.niBuildBlockedRecallContext({ blockedRecallNodes: { [nodeId]: true } });
    const blockedCtx = storyMod.niBuildBlockedRecallContext({ blockedRecallStages: { 3: true } });
    return {
        nodeId,
        // L1：只屏蔽节点 -> 该阶段 detail 被摘空 -> 摘要兜底把阶段概括发出去（漏网机制）
        nodeBlocked: mod.niBuildStageInjectionPayloadForPlan({
            ...basePlan,
            directStageInjectionStages: [3],
            directStageCurrentIdx: 3,
            blockedRecallContext: oneNodeCtx,
        }, cfg),
        // L2：整段屏蔽该阶段 -> 概括与节点正文都不该出现，但别的阶段不受影响
        stageBlocked: mod.niBuildStageInjectionPayloadForPlan({
            ...basePlan,
            blockedRecallContext: blockedCtx,
            blockedRecallChunkIdxs: [...blockedCtx.collectFullyBlockedChunkIdxs(
                storyMod.getAllPlotsInStoryOrder(state),
            )],
        }, cfg),
        excludedStages: storyMod.niExcludeBlockedStageIndices([3, 4], blockedCtx),
    };
}

const probe = runProbe(index, story);
const leakDebug = ' selected=' + JSON.stringify(probe.nodeBlocked.selected)
    + ' content=' + JSON.stringify(probe.nodeBlocked.content);

console.log('\n[L1] 机制核对：被屏蔽节点的正文被摘掉后，注入器会回落到「阶段概括」兜底');
check('只屏蔽节点（不屏蔽阶段）时该阶段概括确实会被兜底注入（漏网机制成立）', () =>
    probe.nodeBlocked.content.includes('第三阶段的概括') ? true : '摘要没进入正文，机制变了' + leakDebug);
check('该节点的正文确实已经被摘掉（屏蔽本身生效）', () =>
    probe.nodeBlocked.content.includes('正文A') ? '节点正文还在' + leakDebug : true);
check('兜底走的确实是 summary 种类', () =>
    (probe.nodeBlocked.summaryStages || []).includes(3) ? true : 'summaryStages=' + JSON.stringify(probe.nodeBlocked.summaryStages));

console.log('\n[L2] 修复后：整段屏蔽阶段 3，它的节点与概括都不该再出现');
const payload = probe.stageBlocked;
check('阶段 3 的概括没有出现在注入正文里', () =>
    payload.content.includes('第三阶段的概括') ? '仍然出现了：' + payload.content.slice(0, 200) : true);
check('阶段 3 的节点正文没有出现在注入正文里', () =>
    payload.content.includes('正文A') ? '仍然出现了节点正文' : true);
check('阶段 4 的内容照常注入（不能误伤别的阶段）', () =>
    payload.content.includes('第四阶段的概括') ? true : '阶段 4 也没了：' + payload.content);
check('阶段 3 连阶段号都没进 selected', () =>
    (payload.selected || []).some(item => Number(item.stageIdx) === 3) ? 'selected 里还有阶段 3' : true);
check('niExcludeBlockedStageIndices 把被屏蔽阶段摘掉、留下 4', () =>
    JSON.stringify(probe.excludedStages) === '[4]' ? true : '得到 ' + JSON.stringify(probe.excludedStages));

console.log('\n[L0] 自检：同一套探针跑「还原成修复前」的版本，必须看到 L2 的漏网复现');
const beforeMod = await import(pathToFileURL(beforeSrcPath).href);
const beforeProbe = runProbe(beforeMod, story);
check('修复前：阶段 3 的概括会照样注入出去（证明 L2 断言有效）', () =>
    beforeProbe.stageBlocked.content.includes('第三阶段的概括')
        ? true
        : '修复前竟然也不漏，L2 断言等于没测 content=' + JSON.stringify(beforeProbe.stageBlocked.content));
check('修复后：同一次调用里阶段 3 的概括消失（与修复前形成对照）', () =>
    payload.content.includes('第三阶段的概括') ? '修复后仍然漏' : true);

console.log('\n[L3] 接线核对：index.js 必须先把被屏蔽阶段摘掉再交给注入器');
check('index.js 调用了 niExcludeBlockedStageIndices', () =>
    indexSrc.includes('niExcludeBlockedStageIndices(') ? true : '没找到调用');
check('index.js 已从 story-data 解构导入 niExcludeBlockedStageIndices', () =>
    /import\s*\{[\s\S]*?niExcludeBlockedStageIndices[\s\S]*?\}\s*from\s*'\.\/lib\/story-data\.js'/.test(indexSrc)
        ? true : 'import 里没有');
check('摘除发生在 niBuildStageInjectionPayload 之前', () => {
    const cut = indexSrc.indexOf('const stageIndices = niExcludeBlockedStageIndices(');
    const build = indexSrc.indexOf('niBuildStageInjectionPayload({', cut);
    return cut > 0 && build > cut ? true : `cut=${cut} build=${build}`;
});

fs.rmSync(tmpRoot, { recursive: true, force: true });
console.log(`\n结果：${pass} 项通过，${fail} 项失败`);
process.exitCode = fail ? 1 : 0;
