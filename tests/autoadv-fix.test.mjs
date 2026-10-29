// 自动推进「不生效」的回归测试：钉住这次修的三件事
//  1) 判定用的节点必须是「注入节点」（reconcile 之后的），不能是 list[tbCurIdx] 这个会失真的下标
//  2) 判定不推进时必须给出原因（手动判定要弹出来，自动判定进运行记录）
//  3) 状态栏「自动」徽标可点 → 立刻判一次
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN_ROOT } from './_paths.mjs';

const ROOT = PLUGIN_ROOT;
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const tb = read('lib/transbook-system.js');
const idx = read('index.js');
const tpl = read('template.html');

let pass = 0;
let fail = 0;
function ok(name, cond) {
    if (cond) { pass++; console.log('  ✓ ' + name); }
    else { fail++; console.log('  ✗ ' + name); }
}

console.log('A. 判定节点来源');
const ctxStart = tb.indexOf('function niTbGetAutoAdvanceContext()');
const ctxEnd = tb.indexOf('window.niTbGetAutoAdvanceContext', ctxStart);
const ctxSrc = tb.slice(ctxStart, ctxEnd);
ok('A1 上下文里不再直接用 list[S.tbCurIdx]', !ctxSrc.includes('list[S.tbCurIdx] || null'));
ok('A2 上下文改用 niTbGetInjectionNode(list)', ctxSrc.includes('const curNode = niTbGetInjectionNode(list);'));
ok('A3 上下文先 reconcile 再取节点', ctxSrc.indexOf('niTbReconcileCurrentNode(list);') < ctxSrc.indexOf('const curNode = niTbGetInjectionNode(list);'));
ok('A4 注释里写清了「下标失真导致判定落在旧节点」', ctxSrc.includes('下标会失真') || ctxSrc.includes('已经 done 的旧节点'));

console.log('B. 判定结果必须可解释');
ok('B1 niTbMaybeAutoAdvance 支持 force 参数', idx.includes('async function niTbMaybeAutoAdvance({ force = false } = {}) {'));
ok('B2 force 时跳过「每 N 条」节流', idx.includes('if (!force && every > 1 && (_niAutoAdvanceEligibleTicks % every) !== 0) {'));
ok('B3 不推进时算出了 why', idx.includes("const why = verdict?.ok"));
ok('B4 不推进时记进运行记录', idx.includes("niLogIssue('自动推进', why);"));
ok('B5 返回值带上 why', idx.includes('return { advance: false, verdict, why };'));

console.log('C. 手动判定入口');
ok('C1 挂出 window.niTbForceJudge', idx.includes('window.niTbForceJudge = async () => {'));
ok('C2 无上下文时提示先开穿书模式', idx.includes("先打开「穿书模式」，自动推进才有可判定的节点"));
ok('C3 暂停时提示先继续', idx.includes('穿书推进已暂停，点状态栏「继续」后再判定'));
ok('C4 调用带 force: true', idx.includes('await niTbMaybeAutoAdvance({ force: true })'));
ok('C5 判定为否时把 why 弹出来', idx.includes('} else if (r?.why) {') && idx.includes('toastr?.info?.(r.why'));
ok('C6 判定请求失败时指路红点', idx.includes('判定请求失败，右上角红点里有原因'));

console.log('D. 状态栏徽标可点');
ok('D1 徽标绑定了 click', tb.includes("on('ni-tb-btn-auto-adv', 'click', (e) => {"));
ok('D2 点击调用 niTbForceJudge', tb.includes('window.niTbForceJudge?.();'));
ok('D3 徽标 title 说明可以点', tb.includes('点一下立即判定一次'));

console.log('E. 换对话重置节流计数');
const chatChangedAt = idx.indexOf("eventSource.on(event_types.CHAT_CHANGED, () => {\n        // 换对话后");
const chatChangedSrc = chatChangedAt < 0 ? '' : idx.slice(chatChangedAt, chatChangedAt + 400);
ok('E1 CHAT_CHANGED 里把 _niAutoAdvanceEligibleTicks 清零', chatChangedSrc.includes('_niAutoAdvanceEligibleTicks = 0;'));

console.log('F. 说明文字');
ok('F1 设置页提示可以点徽标判定', tpl.includes('点状态栏那个「自动」徽标'));
ok('F2 提示判定失败时红点里有原因', tpl.includes('判定失败时右上角红点里也有原因'));

console.log('G. 纯函数边界');
const { niDecideAutoAdvance } = await import('../lib/advance-judge.js');
ok('G1 阈值 NaN 时回退 0.7（不会永远不推进）', niDecideAutoAdvance({ ok: true, completed: true, confidence: 0.8 }, Number(undefined)) === true);
ok('G2 阈值 NaN 且置信度 0.5 时不推进', niDecideAutoAdvance({ ok: true, completed: true, confidence: 0.5 }, Number(undefined)) === false);
ok('G3 未完成一律不推进', niDecideAutoAdvance({ ok: true, completed: false, confidence: 1 }, 0.7) === false);

console.log(`\n${fail === 0 ? 'OK' : 'FAIL'} 通过 ${pass} 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
