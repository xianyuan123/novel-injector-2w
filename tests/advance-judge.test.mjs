// 自动推进判定 — 纯函数与接线测试
// 跑法：node tests/advance-judge.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN_ROOT } from './_paths.mjs';
import {
    NI_DEFAULT_ADVANCE_JUDGE_PROMPT,
    niFillAdvanceJudgeTemplate,
    niTailTruncate,
    niBuildAdvanceJudgeMessages,
    niParseAdvanceJudgeReply,
    niDecideAutoAdvance,
} from '../lib/advance-judge.js';

const ROOT = PLUGIN_ROOT;
const idxSrc = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
const tbSrc = fs.readFileSync(path.join(ROOT, 'lib/transbook-system.js'), 'utf8');
const tplSrc = fs.readFileSync(path.join(ROOT, 'template.html'), 'utf8');

let pass = 0;
const fails = [];
function ok(name, cond, extra) {
    if (cond) { pass++; return; }
    fails.push(name + (extra ? ` :: ${extra}` : ''));
}
function eq(name, actual, expected) {
    ok(name, Object.is(actual, expected), `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
}

// ── A 模板填充 ────────────────────────────────────────────────
{
    const out = niFillAdvanceJudgeTemplate('阶段={STAGE_TITLE} 节点={NODE_TITLE} 未知={NOPE}', {
        STAGE_TITLE: '第一章', NODE_TITLE: '出发',
    });
    ok('A1 替换已知占位符', out.includes('阶段=第一章') && out.includes('节点=出发'), out);
    ok('A2 未知占位符原样保留', out.includes('{NOPE}'), out);
    eq('A3 空模板回退到默认', niFillAdvanceJudgeTemplate('', { STAGE_TITLE: 'x' }),
        niFillAdvanceJudgeTemplate(NI_DEFAULT_ADVANCE_JUDGE_PROMPT, { STAGE_TITLE: 'x' }));
    ok('A4 默认模板含四个占位符',
        ['{STAGE_TITLE}', '{NODE_TITLE}', '{NODE_BODY}', '{RECENT_CHAT}'].every(k => NI_DEFAULT_ADVANCE_JUDGE_PROMPT.includes(k)));
    eq('A5 数字值也替换', niFillAdvanceJudgeTemplate('{STAGE_TITLE}', { STAGE_TITLE: 0 }), '0');
}

// ── B 尾部截断 ────────────────────────────────────────────────
{
    eq('B1 未超限原样返回', niTailTruncate('abc', 10), 'abc');
    const long = 'A'.repeat(100) + 'TAIL';
    const cut = niTailTruncate(long, 10);
    ok('B2 超限保留尾部', cut.endsWith('TAIL'), cut);
    ok('B3 超限带省略提示', cut.includes('前面省略'), cut);
    eq('B4 limit<=0 原样返回', niTailTruncate('abcdef', 0), 'abcdef');
    eq('B5 null 安全', niTailTruncate(null, 10), '');
}

// ── C 拼请求 ──────────────────────────────────────────────────
{
    const msgs = niBuildAdvanceJudgeMessages({
        stageTitle: '第一章', nodeTitle: '夜行', nodeText: '他推开门。', recentChat: '角色：我进去了。',
    });
    eq('C1 两条消息', msgs.length, 2);
    eq('C2 首条是 system', msgs[0].role, 'system');
    eq('C3 次条是 user', msgs[1].role, 'user');
    ok('C4 带阶段标题', msgs[1].content.includes('第一章'), msgs[1].content.slice(0, 80));
    ok('C5 带节点标题', msgs[1].content.includes('夜行'));
    ok('C6 带节点正文', msgs[1].content.includes('他推开门。'));
    ok('C7 带最近对话', msgs[1].content.includes('我进去了。'));
    ok('C8 没有残留占位符', !/\{(STAGE_TITLE|NODE_TITLE|NODE_BODY|RECENT_CHAT)\}/.test(msgs[1].content));

    const big = niBuildAdvanceJudgeMessages({ nodeText: 'X'.repeat(9000), maxNodeChars: 100 });
    ok('C9 节点正文被截断', big[1].content.includes('前面省略'));
    ok('C10 截断后长度受控', big[1].content.length < 9000);

    const empty = niBuildAdvanceJudgeMessages({});
    ok('C11 空节点给占位说明', empty[1].content.includes('节点没有正文'));
    ok('C12 空对话给占位说明', empty[1].content.includes('没有可用的对话记录'));
    ok('C13 空标题给占位说明', empty[1].content.includes('未命名阶段') && empty[1].content.includes('未命名节点'));
}

// ── D 解析回复 ────────────────────────────────────────────────
{
    const a = niParseAdvanceJudgeReply('{"completed":true,"confidence":0.85,"reason":"已演到推门"}');
    ok('D1 纯 JSON 可解析', a.ok === true);
    eq('D2 completed 为 true', a.completed, true);
    eq('D3 confidence 为 0.85', a.confidence, 0.85);
    ok('D4 reason 带出', a.reason.includes('推门'), a.reason);

    const b = niParseAdvanceJudgeReply('好的，我的判断是：\n```json\n{"completed":false,"confidence":0.2,"reason":"还在铺垫"}\n```\n以上。');
    ok('D5 围栏+前后废话可解析', b.ok === true);
    eq('D6 completed 为 false', b.completed, false);
    eq('D7 confidence 为 0.2', b.confidence, 0.2);

    ok('D8 done 字段兼容', niParseAdvanceJudgeReply('{"done":true}').completed === true);
    ok('D9 finished 字段兼容', niParseAdvanceJudgeReply('{"finished":true}').completed === true);
    ok('D10 字符串 true 兼容', niParseAdvanceJudgeReply('{"completed":"true"}').completed === true);
    ok('D11 score 兼容', niParseAdvanceJudgeReply('{"completed":true,"score":0.9}').confidence === 0.9);
    eq('D12 置信度上溢钳到 1', niParseAdvanceJudgeReply('{"completed":true,"confidence":5}').confidence, 1);
    eq('D13 置信度下溢钳到 0', niParseAdvanceJudgeReply('{"completed":false,"confidence":-3}').confidence, 0);

    const noJson = niParseAdvanceJudgeReply('我觉得还早');
    ok('D14 无 JSON 判失败', noJson.ok === false && noJson.reason.includes('没有 JSON'), JSON.stringify(noJson));
    const broken = niParseAdvanceJudgeReply('{completed:true}');
    ok('D15 坏 JSON 判失败', broken.ok === false, JSON.stringify(broken));
    eq('D16 空回复给原因', niParseAdvanceJudgeReply('').reason, '空回复');
    eq('D17 null 安全', niParseAdvanceJudgeReply(null).ok, false);
    ok('D18 失败时 completed 恒 false', niParseAdvanceJudgeReply('乱码').completed === false);
}

// ── E 是否推进 ────────────────────────────────────────────────
{
    const v = (completed, confidence, okFlag = true) => ({ ok: okFlag, completed, confidence });
    eq('E1 恰好达阈值 → 推进', niDecideAutoAdvance(v(true, 0.7), 0.7), true);
    eq('E2 略低于阈值 → 不推进', niDecideAutoAdvance(v(true, 0.69), 0.7), false);
    eq('E3 未完成 → 不推进', niDecideAutoAdvance(v(false, 1), 0.7), false);
    eq('E4 解析失败 → 不推进', niDecideAutoAdvance(v(true, 1, false), 0.7), false);
    eq('E5 null → 不推进', niDecideAutoAdvance(null, 0.7), false);
    eq('E6 阈值非法回退 0.7', niDecideAutoAdvance(v(true, 0.69), NaN), false);
    eq('E7 阈值 0 时全部放行', niDecideAutoAdvance(v(true, 0), 0), true);
    eq('E8 阈值 1 需要满分', niDecideAutoAdvance(v(true, 0.99), 1), false);
    eq('E9 缺 confidence 视作 1', niDecideAutoAdvance({ ok: true, completed: true }, 0.7), true);
    eq('E10 阈值 >1 钳到 1', niDecideAutoAdvance(v(true, 0.95), 9), false);
}

// ── F 接线 ────────────────────────────────────────────────────
{
    ok('F1 index.js 导入判定纯函数',
        /import\s*\{[^}]*niBuildAdvanceJudgeMessages[^}]*\}\s*from\s*'\.\/lib\/advance-judge\.js'/.test(idxSrc));
    ok('F2 index.js 导入默认提示词', idxSrc.includes('NI_DEFAULT_ADVANCE_JUDGE_PROMPT'));
    ok('F3 deps 传入 defaultAdvanceJudgePrompt', /defaultAdvanceJudgePrompt\s*:\s*NI_DEFAULT_ADVANCE_JUDGE_PROMPT/.test(idxSrc));
    ok('F4 判定器函数存在', idxSrc.includes('async function niTbMaybeAutoAdvance('));
    ok('F5 判定器调推进', idxSrc.includes('window.niTbAdvanceOneNode?.(ctx.curNode)'));
    ok('F6 判定器用上下文接口', idxSrc.includes('window.niTbGetAutoAdvanceContext?.()'));
    ok('F7 MESSAGE_RECEIVED 里触发判定', /MESSAGE_RECEIVED[\s\S]{0,900}niTbMaybeAutoAdvance/.test(idxSrc));
    ok('F8 跳过用户消息', /chat\[chat\.length - 1\]\?\.is_user\)\s*return/.test(idxSrc));

    ok('F9 旧的「手动一键推进」设置项已删', !tbSrc.includes('tbQuickAdvance'));
    ok('F10 旧按钮 id 已删', !tbSrc.includes('ni-tb-btn-advance'));
    ok('F11 新默认设置齐全',
        ['tbAutoAdvance', 'tbAutoAdvanceCrossStage', 'tbAutoAdvanceModel', 'tbAutoAdvanceEvery', 'tbAutoAdvanceThreshold', 'tbAutoAdvancePrompt']
            .every(k => tbSrc.includes(`DEFAULT_SETTINGS.${k}`)));
    ok('F12 跨阶段函数存在', tbSrc.includes('async function niTbAutoEnterNextStage('));
    ok('F13 跨阶段受开关控制', /tbAutoAdvanceCrossStage\s*!==\s*false/.test(tbSrc));
    ok('F14 上下文工厂导出', tbSrc.includes('niTbGetAutoAdvanceContext') && tbSrc.includes('window.niTbGetAutoAdvanceContext'));
    ok('F15 判定中状态可写', tbSrc.includes('niTbSetAutoAdvanceJudging'));

    ok('F16 模板有自动推进开关', tplSrc.includes('id="ni-tb-auto-advance"'));
    ok('F17 模板有跨阶段开关', tplSrc.includes('id="ni-tb-auto-cross-stage"'));
    ok('F18 模板有判定模型下拉', tplSrc.includes('id="ni-tb-auto-advance-model"'));
    ok('F19 模板有判定提示词框', tplSrc.includes('id="ni-tb-advance-judge-prompt"'));
    ok('F20 模板有判定提示词重置', tplSrc.includes('id="ni-tb-advance-judge-reset"'));
    ok('F21 模板已无手动推进块', !tplSrc.includes('ni-tb-quick-advance'));
    ok('F22 模板保留节点推进提示词', tplSrc.includes('id="ni-tb-advance-prompt"'));
}

// ── 汇总 ──────────────────────────────────────────────────────
const total = pass + fails.length;
if (fails.length) {
    console.log(`FAIL ${fails.length}/${total}`);
    for (const f of fails) console.log('  ✗ ' + f);
    process.exit(1);
}
console.log(`PASS ${total}/${total}`);
