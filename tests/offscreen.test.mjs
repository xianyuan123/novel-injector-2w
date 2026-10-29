// 后台动向（其他视角）— 纯函数与接线测试
// 跑法：node tests/offscreen.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN_ROOT } from './_paths.mjs';
import {
    NI_OFFSCREEN_MODES,
    NI_OFFSCREEN_MAX_THREADS,
    niNormalizeOffscreenMode,
    NI_DEFAULT_OFFSCREEN_PROMPT,
    niFillOffscreenTemplate,
    niTailClip,
    niBuildOffscreenMessages,
    niParseOffscreenReply,
    niMergeOffscreenThreads,
    niFormatOffscreenInjection,
    niShouldRunOffscreen,
    niNormalizeChatEndpoint,
    niExtractAssistantText,
    niCallExternalChat,
} from '../lib/offscreen-system.js';

const ROOT = PLUGIN_ROOT;
const idxSrc = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
const tbSrc = fs.readFileSync(path.join(ROOT, 'lib/transbook-system.js'), 'utf8');
const tplSrc = fs.readFileSync(path.join(ROOT, 'template.html'), 'utf8');
const cssSrc = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');

let pass = 0;
const fails = [];
function ok(name, cond, extra) {
    if (cond) { pass++; return; }
    fails.push(name + (extra ? ` :: ${extra}` : ''));
}
function eq(name, actual, expected) {
    ok(name, Object.is(actual, expected), `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
}

// ── A 模式归一化 ──────────────────────────────────────────────
{
    eq('A1 合法值原样', niNormalizeOffscreenMode('always'), 'always');
    eq('A2 未知值回退 node', niNormalizeOffscreenMode('whatever'), 'node');
    eq('A3 空值回退 node', niNormalizeOffscreenMode(''), 'node');
    eq('A4 null 回退 node', niNormalizeOffscreenMode(null), 'node');
    ok('A5 三种模式齐全', NI_OFFSCREEN_MODES.length === 3 && NI_OFFSCREEN_MODES.includes('off'));
}

// ── B 模板填充 ────────────────────────────────────────────────
{
    const out = niFillOffscreenTemplate('视角={POV} 阶段={STAGE_TITLE} 未知={NOPE}', {
        POV: '林师妹', STAGE_TITLE: '第二章',
    });
    ok('B1 已知占位符替换', out.includes('视角=林师妹') && out.includes('阶段=第二章'), out);
    ok('B2 未知占位符原样保留', out.includes('{NOPE}'), out);
    eq('B3 空模板回退默认', niFillOffscreenTemplate('', { POV: 'x' }),
        niFillOffscreenTemplate(NI_DEFAULT_OFFSCREEN_PROMPT, { POV: 'x' }));
    ok('B4 默认模板含四个以上占位符',
        ['{POV}', '{STAGE_TITLE}', '{NODE_TITLE}', '{NODE_BODY}', '{RECENT_CHAT}'].every(k => NI_DEFAULT_OFFSCREEN_PROMPT.includes(k)));
    eq('B5 数字值也替换', niFillOffscreenTemplate('{POV}', { POV: 0 }), '0');
}

// ── C 尾部截断 ────────────────────────────────────────────────
{
    eq('C1 未超限原样返回', niTailClip('abc', 10), 'abc');
    const cut = niTailClip('A'.repeat(100) + 'TAIL', 10);
    ok('C2 超限保留尾部', cut.endsWith('TAIL'), cut);
    ok('C3 超限带省略提示', cut.includes('前面省略'), cut);
    eq('C4 limit<=0 原样返回', niTailClip('abcdef', 0), 'abcdef');
    eq('C5 null 安全', niTailClip(null, 10), '');
}

// ── D 拼请求 ──────────────────────────────────────────────────
{
    const msgs = niBuildOffscreenMessages({
        pov: '林师妹', stageTitle: '第二章', nodeTitle: '夜行',
        nodeText: '他推开门。', recentChat: '角色：我进去了。',
        existingThreads: [{ subject: '师父', summary: '已下山' }],
    });
    eq('D1 两条消息', msgs.length, 2);
    eq('D2 首条是 system', msgs[0].role, 'system');
    eq('D3 次条是 user', msgs[1].role, 'user');
    const body = msgs[1].content;
    ok('D4 主视角替换', body.includes('林师妹'), body.slice(0, 80));
    ok('D5 节点正文替换', body.includes('他推开门。'));
    ok('D6 已有动向带入', body.includes('师父：已下山'));
    const empty = niBuildOffscreenMessages({});
    ok('D7 空参数有兜底文案', empty[1].content.includes('当前主视角角色') && empty[1].content.includes('暂无'));
    const longNode = niBuildOffscreenMessages({ nodeText: 'N'.repeat(5000), maxNodeChars: 100 });
    ok('D8 节点正文按上限截断', longNode[1].content.length < 4000, String(longNode[1].content.length));
}

// ── E 解析回复 ────────────────────────────────────────────────
{
    const obj = niParseOffscreenReply('{"threads":[{"subject":"师父","summary":"已下山"}]}');
    ok('E1 对象包 threads', obj.ok && obj.threads.length === 1 && obj.threads[0].subject === '师父');

    const bare = niParseOffscreenReply('[{"subject":"师姐","summary":"去了城东"}]');
    ok('E2 裸数组', bare.ok && bare.threads[0].subject === '师姐');

    const items = niParseOffscreenReply('{"items":[{"who":"掌门","event":"闭关"}]}');
    ok('E3 items + who/event 别名', items.ok && items.threads[0].subject === '掌门');

    const fenced = niParseOffscreenReply('好的，结果如下：\n```json\n{"threads":[{"subject":"掌柜","summary":"报官了"}]}\n```\n以上。');
    ok('E4 围栏与前后废话', fenced.ok && fenced.threads[0].summary === '报官了');

    eq('E5 空回复失败', niParseOffscreenReply('').ok, false);
    eq('E6 无 JSON 失败', niParseOffscreenReply('这一轮没事发生').ok, false);
    eq('E7 没有 threads 失败', niParseOffscreenReply('{"foo":1}').ok, false);
    eq('E8 空数组成功但零条', niParseOffscreenReply('{"threads":[]}').threads.length, 0);
    eq('E9 缺 summary 的条目被跳过',
        niParseOffscreenReply('{"threads":[{"subject":"甲"},{"subject":"乙","summary":"走了"}]}').threads.length, 1);
    const longSubject = niParseOffscreenReply(JSON.stringify({ threads: [{ subject: 'S'.repeat(50), summary: 'M'.repeat(90) }] }));
    ok('E10 主体与摘要按上限截断',
        longSubject.threads[0].subject.length === 24 && longSubject.threads[0].summary.length === 60);
    eq('E11 null 安全', niParseOffscreenReply(null).ok, false);
}

// ── F 合并动向 ────────────────────────────────────────────────
{
    const prev = [
        { subject: '师父', summary: '旧', stageIdx: 1, nodeId: 'a', at: 100, since: 50 },
        { subject: '掌门', summary: '闭关', stageIdx: 1, nodeId: 'a', at: 90, since: 40 },
    ];
    const merged = niMergeOffscreenThreads(prev, [{ subject: '师父', summary: '新' }], { stageIdx: 2, nodeId: 'b', now: 200 });
    const master = merged.find(t => t.subject === '师父');
    eq('F1 同主体覆盖摘要', master.summary, '新');
    eq('F2 同主体保留 since', master.since, 50);
    eq('F3 同主体更新 at', master.at, 200);
    eq('F4 不同主体保留', merged.some(t => t.subject === '掌门'), true);
    eq('F5 总数', merged.length, 2);
    eq('F6 按 at 倒序', merged[0].subject, '师父');
    eq('F7 新主体排在最前',
        niMergeOffscreenThreads([], [{ subject: '甲', summary: '一' }], { now: 1 })[0].subject, '甲');
    const many = Array.from({ length: 40 }, (_, i) => ({ subject: `S${i}`, summary: 'x' }));
    eq('F8 超过上限截断', niMergeOffscreenThreads([], many, { now: 1 }).length, NI_OFFSCREEN_MAX_THREADS);
    eq('F9 空输入安全', niMergeOffscreenThreads(null, null).length, 0);
}

// ── G 注入文本 ────────────────────────────────────────────────
{
    eq('G1 空列表返回空串', niFormatOffscreenInjection([]), '');
    eq('G2 null 安全', niFormatOffscreenInjection(null), '');
    const text = niFormatOffscreenInjection([
        { subject: '师父', summary: '已下山', stageIdx: 2 },
        { subject: '掌门', summary: '闭关', stageIdx: 0 },
    ]);
    ok('G3 带头尾标记', text.startsWith('[后台动向') && text.endsWith('[/后台动向]'), text);
    ok('G4 有阶段号时带前缀', text.includes('第 2 阶段｜师父：已下山'), text);
    ok('G5 无阶段号不带前缀', text.includes('· 掌门：闭关'), text);
    const clipped = niFormatOffscreenInjection([
        { subject: '甲', summary: '一'.repeat(20) },
        { subject: '乙', summary: '二'.repeat(20) },
        { subject: '丙', summary: '三'.repeat(20) },
    ], { maxChars: 30 });
    ok('G6 超上限丢条目并注明', clipped.includes('因字数上限未注入'), clipped);
}

// ── H 该不该跑 ────────────────────────────────────────────────
{
    eq('H1 未启用不跑', niShouldRunOffscreen({ enabled: false }).run, false);
    eq('H2 未启用原因', niShouldRunOffscreen({ enabled: false }).reason, 'disabled');
    eq('H3 off 模式不跑', niShouldRunOffscreen({ enabled: true, mode: 'off' }).run, false);
    eq('H4 always 模式总跑', niShouldRunOffscreen({ enabled: true, mode: 'always' }).run, true);
    eq('H5 node 模式同节点不跑',
        niShouldRunOffscreen({ enabled: true, mode: 'node', curNodeId: 'a', lastRunNodeId: 'a' }).run, false);
    eq('H6 node 模式换节点跑',
        niShouldRunOffscreen({ enabled: true, mode: 'node', curNodeId: 'b', lastRunNodeId: 'a' }).run, true);
    eq('H7 node 模式没有节点不跑',
        niShouldRunOffscreen({ enabled: true, mode: 'node', curNodeId: '', lastRunNodeId: 'a' }).run, false);
    eq('H8 首次没有记录时跑',
        niShouldRunOffscreen({ enabled: true, mode: 'node', curNodeId: 'a', lastRunNodeId: '' }).run, true);
}

// ── I 接口地址归一化 ──────────────────────────────────────────
{
    eq('I1 裸域名补全', niNormalizeChatEndpoint('https://api.x.com'), 'https://api.x.com/v1/chat/completions');
    eq('I2 已带 v1', niNormalizeChatEndpoint('https://api.x.com/v1'), 'https://api.x.com/v1/chat/completions');
    eq('I3 已完整', niNormalizeChatEndpoint('https://api.x.com/v1/chat/completions'), 'https://api.x.com/v1/chat/completions');
    eq('I4 去尾斜杠', niNormalizeChatEndpoint('https://api.x.com/v1/'), 'https://api.x.com/v1/chat/completions');
    eq('I5 models 端点改写', niNormalizeChatEndpoint('https://api.x.com/v1/models'), 'https://api.x.com/v1/chat/completions');
    eq('I6 空值返回空', niNormalizeChatEndpoint(''), '');
    eq('I7 null 返回空', niNormalizeChatEndpoint(null), '');
}

// ── J 取回复文本 ──────────────────────────────────────────────
{
    eq('J1 choices.message.content', niExtractAssistantText({ choices: [{ message: { content: '甲' } }] }), '甲');
    eq('J2 choices.text', niExtractAssistantText({ choices: [{ text: '乙' }] }), '乙');
    eq('J3 数组 content', niExtractAssistantText({ choices: [{ message: { content: [{ text: '丙' }, { text: '丁' }] } }] }), '丙丁');
    eq('J4 顶层 content', niExtractAssistantText({ content: '戊' }), '戊');
    eq('J5 空返回空', niExtractAssistantText(null), '');
    eq('J6 空 choices 返回空', niExtractAssistantText({ choices: [] }), '');
}

// ── K 接线：index.js ──────────────────────────────────────────
{
    ok('K1 导入 8 个纯函数', idxSrc.includes("from './lib/offscreen-system.js'")
        && ['NI_DEFAULT_OFFSCREEN_PROMPT', 'niNormalizeOffscreenMode', 'niBuildOffscreenMessages',
            'niParseOffscreenReply', 'niMergeOffscreenThreads', 'niFormatOffscreenInjection',
            'niShouldRunOffscreen', 'niCallExternalChat'].every(n => idxSrc.includes(n)));
    ok('K2 注入主链有独立注入点', idxSrc.includes('${EXT_NAME}_offscreen'));
    ok('K3 注入用预告同组位置参数', /\$\{EXT_NAME\}_offscreen`, offscreenText, plotPos, plotDepth, plotRole/.test(idxSrc));
    ok('K4 注入预览含后台动向分区', idxSrc.includes("push('offscreen', '后台动向（其他视角）'"));
    ok('K5 外接接口优先', idxSrc.includes('const apiUrl = String(cfg.tbOffscreenApiUrl || \'\').trim();')
        && idxSrc.includes('niCallExternalChat({'));
    ok('K6 三种模型来源都接上', idxSrc.includes('callCleanApi(messages, {})')
        && idxSrc.includes('niGenerateWithTavernMainPreset(messages, { responseLength: 400 })'));
    ok('K7 解析失败也记账节点', idxSrc.includes('window.niTbSetOffscreenState?.({ lastRunNodeId: ctx.curNodeId, lastRunAt: now })'));
    ok('K8 推进成功后触发节点推演', idxSrc.includes("niRunOffscreenSimulation({ reason: 'node', silent: true })"));
    ok('K9 always 模式每回合触发', idxSrc.includes('niMaybeRunOffscreenAlways')
        && idxSrc.includes("niNormalizeOffscreenMode(cfg.tbOffscreenMode) !== 'always'"));
    ok('K10 设置回写函数存在', idxSrc.includes('function niSaveOffscreenSettingsFromUi()'));
    ok('K11 渲染函数转义输出', idxSrc.includes('niEscHtml(String(t.subject || \'\'))'));
    ok('K12 弹窗入口阻止冒泡', idxSrc.includes("ev?.stopPropagation?.();\n        niOpenOffscreenModal();"));
}

// ── L 接线：transbook-system.js / 模板 / 样式 ─────────────────
{
    ok('L1 默认设置齐全', ['tbOffscreenEnabled', 'tbOffscreenMode', 'tbOffscreenModel', 'tbOffscreenStages',
        'tbOffscreenMaxChars', 'tbOffscreenPov', 'tbOffscreenApiUrl', 'tbOffscreenApiKey',
        'tbOffscreenApiModel', 'tbOffscreenApiTimeout'].every(k => tbSrc.includes(`DEFAULT_SETTINGS.${k}`)));
    ok('L2 状态三件套', tbSrc.includes('S.tbOffscreen = { threads: [], lastRunNodeId: \'\', lastRunAt: 0 }'));
    ok('L3 存档写入 offscreen', tbSrc.includes('ni_tb.offscreen = {') && tbSrc.includes('lastRunNodeId: String(S.tbOffscreen?.lastRunNodeId'));
    ok('L4 读档恢复 offscreen', /S\.tbOffscreen = \{\s*\n\s*threads:/.test(tbSrc));
    ok('L5 状态读写函数挂 window',
        tbSrc.includes('window.niTbGetOffscreenState = niTbGetOffscreenState')
        && tbSrc.includes('window.niTbSetOffscreenState = niTbSetOffscreenState')
        && tbSrc.includes('window.niTbGetOffscreenContext = niTbGetOffscreenContext'));
    ok('L6 上下文带后续阶段', tbSrc.includes('laterStages:') && tbSrc.includes('niTbGetOffscreenContext'));
    ok('L7 模板有入口按钮', tplSrc.includes('id="ni-offscreen-open"'));
    ok('L8 模板有弹窗', tplSrc.includes('id="ni-offscreen-modal"'));
    ok('L9 模板控件齐全', ['ni-off-enabled', 'ni-off-mode', 'ni-off-model', 'ni-off-pov', 'ni-off-stages',
        'ni-off-maxchars', 'ni-off-api-url', 'ni-off-api-model', 'ni-off-api-key', 'ni-off-api-timeout',
        'ni-off-list', 'ni-off-status', 'ni-off-run', 'ni-off-clear', 'ni-off-close'].every(id => tplSrc.includes(`id="${id}"`)));
    ok('L10 外接接口折叠', tplSrc.includes('class="ni-off-details"') && tplSrc.includes('<summary>外接接口'));
    ok('L11 样式齐全', ['.ni-offscreen-card', '.ni-off-row', '.ni-off-field', '.ni-off-list',
        '.ni-off-item', '.ni-off-empty', '.ni-off-actions'].every(s => cssSrc.includes(s)));
}

// ── M 接线：穿书状态栏里的「后台动向」 ────────────────────────
{
    ok('M1 状态栏区块存在', ['ni-tb-off-block', 'ni-tb-off-toggle', 'ni-tb-off-list',
        'ni-tb-off-count', 'ni-tb-off-run', 'ni-tb-off-body'].every(id => tbSrc.includes(`id="${id}"`)));
    ok('M2 渲染函数挂 window 并导出', tbSrc.includes('window.niTbRenderOffscreenBar = niTbRenderOffscreenBar')
        && tbSrc.includes('niTbRenderOffscreenBar,'));
    ok('M3 渲染函数转义输出', tbSrc.includes('niEsc(t.subject || \'其他视角\')')
        && tbSrc.includes('niEsc(t.summary || \'\')'));
    ok('M4 状态栏重绘时刷新动向', /niTbSyncStoryBar\(snapshot\);\s*\n\s*niTbRenderOffscreenBar\(\);/.test(tbSrc));
    ok('M5 写状态后刷新并派发事件', tbSrc.includes('niTbSaveState();\n        niTbRenderOffscreenBar();')
        && tbSrc.includes("new CustomEvent('ni:offscreen-changed')"));
    ok('M6 三个交互都绑上', tbSrc.includes("on('ni-tb-off-toggle', 'click'")
        && tbSrc.includes("on('ni-tb-off-run', 'click'")
        && tbSrc.includes("closest('[data-ni-off-idx]')"));
    ok('M7 状态栏样式齐全', ['.ni-tb-off-block', '.ni-tb-off-head', '.ni-tb-off-body',
        '.ni-tb-off-item', '.ni-tb-off-sum', '.ni-tb-off-del'].every(s => tbSrc.includes(s)));
    ok('M8 推演按钮走跨文件函数', tbSrc.includes("window.niRunOffscreenSimulation?.({ reason: 'manual', silent: false })"));
    ok('M9 index.js 暴露跨文件函数', idxSrc.includes('window.niRunOffscreenSimulation = niRunOffscreenSimulation;')
        && idxSrc.includes('window.niOpenOffscreenModal = niOpenOffscreenModal;'));
    ok('M10 弹窗跟随状态栏删除刷新', idxSrc.includes("document.addEventListener('ni:offscreen-changed'"));
}

// ── 汇总 ─────────────────────────────────────────────────────
console.log(`\n通过 ${pass} 项，失败 ${fails.length} 项`);
if (fails.length) {
    for (const f of fails) console.log('  BUG ' + f);
    process.exitCode = 1;
}
