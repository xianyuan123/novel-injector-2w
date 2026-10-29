// 体验包（撤销浮条 / 运行记录红点 / 上手引导）— 结构、接线与纯函数测试
// 跑法：node tests/ux.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN_ROOT } from './_paths.mjs';

const ROOT = PLUGIN_ROOT;
const idxSrc = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
const uiSrc = fs.readFileSync(path.join(ROOT, 'lib/ui-system.js'), 'utf8');
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

// ── A 撤销浮条：模块导出与实现形态 ───────────────────────────
{
    ok('A1 ui-system 导出 niShowUndoBar', /export function niShowUndoBar\s*\(/.test(uiSrc));
    ok('A2 ui-system 导出 niHideUndoBar', /export function niHideUndoBar\s*\(/.test(uiSrc));
    ok('A3 默认 30 秒', /duration\s*=\s*30000/.test(uiSrc));
    ok('A4 有倒计时定时器', uiSrc.includes('setInterval') && uiSrc.includes('clearInterval'));
    ok('A5 撤销按钮绑 onclick', /btn\.onclick\s*=/.test(uiSrc));
    ok('A6 撤销回调有 try/catch 兜底', /catch\s*\(e\)\s*\{[\s\S]{0,80}撤销失败/.test(uiSrc));
    ok('A7 关闭有淡出类', uiSrc.includes('ni-undo-out') && uiSrc.includes('ni-undo-in'));
}

// ── B 撤销浮条：模板结构 ─────────────────────────────────────
{
    ok('B1 模板有 ni-undo-bar', tplSrc.includes('id="ni-undo-bar"'));
    ok('B2 模板有文案位', tplSrc.includes('id="ni-undo-txt"'));
    ok('B3 模板有撤销按钮', tplSrc.includes('id="ni-undo-btn"'));
    ok('B4 模板有倒计时', tplSrc.includes('id="ni-undo-timer"'));
    ok('B5 默认隐藏', /<div class="ni-undo-bar" id="ni-undo-bar"[^>]*hidden/.test(tplSrc));
}

// ── C 运行记录：模板 + 样式 ──────────────────────────────────
{
    ok('C1 有红点按钮', tplSrc.includes('id="ni-issue-dot"'));
    ok('C2 红点默认隐藏', /id="ni-issue-dot"[^>]*hidden/.test(tplSrc));
    ok('C3 有计数位', tplSrc.includes('id="ni-issue-count"'));
    ok('C4 有记录弹窗', tplSrc.includes('id="ni-issue-modal"'));
    ok('C5 有列表容器', tplSrc.includes('id="ni-issue-list"'));
    ok('C6 有清空与关闭', tplSrc.includes('id="ni-issue-clear"') && tplSrc.includes('id="ni-issue-close"'));
    ok('C7 弹窗是 dialog 语义', /id="ni-issue-modal"[\s\S]{0,200}role="dialog"/.test(tplSrc));
    for (const cls of ['.ni-issue-dot', '.ni-issue-card', '.ni-issue-list', '.ni-issue-item', '.ni-issue-msg', '.ni-issue-empty']) {
        ok(`C8 样式含 ${cls}`, cssSrc.includes(cls));
    }
}

// ── D 运行记录：接线 ────────────────────────────────────────
{
    ok('D1 定义 niLogIssue', /function niLogIssue\s*\(/.test(idxSrc));
    ok('D2 有环形上限', /NI_ISSUE_LOG_LIMIT\s*=\s*\d+/.test(idxSrc));
    ok('D3 同一条去重', /dedupeMs/.test(idxSrc) && /_niIssueLog\.find/.test(idxSrc));
    ok('D4 刷新红点', /function niRefreshIssueDot\s*\(/.test(idxSrc));
    ok('D5 渲染列表并转义', /function niRenderIssueList\s*\(/.test(idxSrc) && /niEscHtml\(entry\.message\)/.test(idxSrc));
    ok('D6 打开/关闭弹窗', /function niOpenIssueModal\s*\(/.test(idxSrc) && /function niCloseIssueModal\s*\(/.test(idxSrc));
    ok('D7 绑定点开红点', /\$app\.on\('click', '#ni-issue-dot'/.test(idxSrc));
    ok('D8 绑定清空', /\$app\.on\('click', '#ni-issue-clear'/.test(idxSrc));
    ok('D9 绑定关闭', /\$app\.on\('click', '#ni-issue-close'/.test(idxSrc));
    ok('D10 点背景关闭', /\$app\.on\('click', '#ni-issue-modal', function/.test(idxSrc));
    const logCalls = [...idxSrc.matchAll(/niLogIssue\('/g)].length;
    ok('D11 至少 4 处失败会写记录', logCalls >= 4, `实际 ${logCalls}`);
    for (const src of ['向量召回', '后台推演', '后台动向注入', '自动推进判定']) {
        ok(`D12 覆盖「${src}」`, idxSrc.includes(`niLogIssue('${src}'`), src);
    }
}

// ── E 上手引导：模板 + 逻辑 ─────────────────────────────────
{
    ok('E1 模板有引导块', tplSrc.includes('id="ni-onboard"'));
    ok('E2 引导默认隐藏', /id="ni-onboard"[^>]*hidden/.test(tplSrc));
    ok('E3 有步骤容器', tplSrc.includes('id="ni-onboard-steps"'));
    ok('E4 有关闭按钮', tplSrc.includes('id="ni-onboard-close"'));
    ok('E5 定义四步', /function niOnboardSteps\s*\(/.test(idxSrc));
    for (const label of ['导入章节', '清洗正文', '拆分阶段', '写入向量']) {
        ok(`E6 含步骤「${label}」`, idxSrc.includes(label), label);
    }
    ok('E7 有本地记忆', idxSrc.includes('NI_ONBOARD_KEY') && idxSrc.includes('localStorage.setItem(NI_ONBOARD_KEY'));
    ok('E8 全部完成后隐藏', /!firstOpen/.test(idxSrc));
    ok('E9 当前步高亮', /step === firstOpen \? 'on'/.test(idxSrc));
    ok('E10 点步骤切页', /\$app\.on\('click', '\.ni-onboard-step'/.test(idxSrc));
    ok('E11 切页会刷新引导', /niUpdateOnboardUI\(\)/.test(idxSrc));
    ok('E12 关闭写入已读', /\$app\.on\('click', '#ni-onboard-close'/.test(idxSrc));
    for (const cls of ['.ni-onboard', '.ni-onboard-step', '.ni-onboard-step.done', '.ni-onboard-step.on', '.ni-onboard-idx']) {
        ok(`E13 样式含 ${cls}`, cssSrc.includes(cls));
    }
}

// ── F 撤销接线点 ────────────────────────────────────────────
{
    ok('F1 定义 niOfferUndo', /function niOfferUndo\s*\(/.test(idxSrc));
    ok('F2 引入 niShowUndoBar', /niShowUndoBar/.test(idxSrc) && /from '\.\/lib\/ui-system\.js'/.test(idxSrc));
    const offers = [...idxSrc.matchAll(/niOfferUndo\(/g)].length;
    ok('F3 至少 4 处危险操作可撤销', offers >= 5, `实际 ${offers}`);
    ok('F4 剧情事件删除可撤销', /已删除 \$\{removed\} 个剧情事件/.test(idxSrc));
    ok('F5 撤销时恢复 S.plots 并重绘', /S\.plots = snapshot/.test(idxSrc) && /renderPlots\(\{ force: true \}\)/.test(idxSrc));
    ok('F6 后台动向清空可撤销', /已清空 \$\{prev\.length\} 条后台动向/.test(idxSrc));
    ok('F7 后台动向单条删除可撤销', /已删除 1 条后台动向/.test(idxSrc));
    ok('F8 变更记录清空可撤销', /已清除 \$\{prevHistory\.length\} 条变更记录/.test(idxSrc));
    ok('F9 快照是浅拷贝数组（不深拷正文）', /main: \[\.\.\.\(S\.plots\?\.main \|\| \[\]\)\]/.test(idxSrc));
}

// ── G 结构完整性 ────────────────────────────────────────────
{
    const open = (tplSrc.match(/<div[\s>]/g) || []).length;
    const close = (tplSrc.match(/<\/div\s*>/g) || []).length;
    eq('G1 div 配平', open, close);
    const ids = [...tplSrc.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
    const dup = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
    ok('G2 无重复 id', dup.length === 0, dup.join(','));
    ok('G3 id 数量合理（模板有 500+ 个 id）', ids.length >= 500, `id 数 ${ids.length}`);
    ok('G4 引导块在处理页内', /id="ni-pg-process"[\s\S]{0,600}id="ni-onboard"/.test(tplSrc));
    ok('G5 撤销条在底栏之前', tplSrc.indexOf('id="ni-undo-bar"') < tplSrc.indexOf('class="ni-btm-nav"'));
}

// ── 汇总 ────────────────────────────────────────────────────
console.log(`\n体验包测试：${pass} 通过, ${fails.length} 失败`);
if (fails.length) {
    for (const f of fails) console.log('  ✗', f);
    process.exitCode = 1;
}
