// 阶段批量勾选：纯函数 + 模板结构 + 接线断言
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN_ROOT } from './_paths.mjs';

const ROOT = PLUGIN_ROOT;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const ui = await import('../lib/ui-system.js');

let pass = 0;
const fails = [];
function ok(name, cond, extra = '') {
    if (cond) { pass++; return; }
    fails.push(`${name}${extra ? ' → ' + extra : ''}`);
}
function eq(name, actual, expected) {
    ok(name, Object.is(actual, expected), `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}
function deep(name, actual, expected) {
    const a = JSON.stringify(actual), b = JSON.stringify(expected);
    ok(name, a === b, `期望 ${b}，实际 ${a}`);
}

const tpl = read('template.html');
const css = read('style.css');
const src = read('index.js');
const story = read('lib/story-data.js');

// ── A. niBuildStageBatchPage ────────────────────────────────
{
    const r = ui.niBuildStageBatchPage({ total: 47, page: 1, pageSize: 20 });
    eq('A1 首页 page', r.page, 1);
    eq('A2 首页 pageCount', r.pageCount, 3);
    eq('A3 首页 start', r.start, 1);
    eq('A4 首页 end', r.end, 20);
    eq('A5 首页 countOnPage', r.countOnPage, 20);

    const last = ui.niBuildStageBatchPage({ total: 47, page: 3, pageSize: 20 });
    eq('A6 末页 start', last.start, 41);
    eq('A7 末页 end', last.end, 47);
    eq('A8 末页 countOnPage', last.countOnPage, 7);

    const over = ui.niBuildStageBatchPage({ total: 47, page: 99, pageSize: 20 });
    eq('A9 超页夹紧', over.page, 3);

    const low = ui.niBuildStageBatchPage({ total: 47, page: -5, pageSize: 20 });
    eq('A10 负页夹紧', low.page, 1);

    const zero = ui.niBuildStageBatchPage({ total: 0, page: 1, pageSize: 20 });
    eq('A11 零总数 pageCount', zero.pageCount, 1);
    eq('A12 零总数 countOnPage', zero.countOnPage, 0);

    const size30 = ui.niBuildStageBatchPage({ total: 47, page: 2, pageSize: 30 });
    eq('A13 每页30 start', size30.start, 31);
    eq('A14 每页30 end', size30.end, 47);
    eq('A15 每页30 pageCount', size30.pageCount, 2);

    const bad = ui.niBuildStageBatchPage({ total: 5, page: 1, pageSize: 0 });
    eq('A16 size 0 兜底 20', bad.pageSize, 20);
    eq('A17 size 0 时全在一页', bad.countOnPage, 5);

    const none = ui.niBuildStageBatchPage();
    eq('A18 无参安全', none.total, 0);
}

// ── B. niStageBatchSelectionMap ────────────────────────────
{
    const map = ui.niStageBatchSelectionMap([2, 4], [1, 2, 3, 4, 5]);
    deep('B1 子集映射', map, { 1: false, 2: true, 3: false, 4: true, 5: false });

    const all = ui.niStageBatchSelectionMap([1, 2], [1, 2]);
    deep('B2 全选', all, { 1: true, 2: true });

    const empty = ui.niStageBatchSelectionMap([], [1, 2, 3]);
    deep('B3 全不选', empty, { 1: false, 2: false, 3: false });

    const invalid = ui.niStageBatchSelectionMap([0, -1, 'x', 2], [0, 1, 2]);
    deep('B4 非法 id 被过滤', invalid, { 1: false, 2: true });

    const noIds = ui.niStageBatchSelectionMap([1, 2], []);
    deep('B5 无阶段列表返回空对象', noIds, {});
}

// ── C. 模板结构 ────────────────────────────────────────────
{
    ok('C1 入口按钮存在', tpl.includes('id="ni-stage-batch-open"'));
    ok('C2 入口按钮在批量行内', /ni-stage-bulk-row[\s\S]{0,1600}ni-stage-batch-open/.test(tpl));
    ok('C3 弹窗存在', tpl.includes('id="ni-stage-batch-modal"'));
    ok('C4 弹窗是 modal-bg 且默认隐藏', /class="ni-modal-bg" id="ni-stage-batch-modal" style="display:none"/.test(tpl));
    ok('C5 列表容器存在', tpl.includes('id="ni-stage-batch-list"'));
    ok('C6 每页选择器 20/30', /<select id="ni-stage-batch-size">[\s\S]*?value="20"[\s\S]*?value="30"/.test(tpl));
    ok('C7 本页全选按钮', tpl.includes('id="ni-stage-batch-all-page"'));
    ok('C8 本页清空按钮', tpl.includes('id="ni-stage-batch-none-page"'));
    ok('C9 已选计数', tpl.includes('id="ni-stage-batch-count"'));
    ok('C10 页码', tpl.includes('id="ni-stage-batch-pageno"'));
    ok('C11 上一页/下一页', tpl.includes('id="ni-stage-batch-prev"') && tpl.includes('id="ni-stage-batch-next"'));
    ok('C12 应用/取消', tpl.includes('id="ni-stage-batch-apply"') && tpl.includes('id="ni-stage-batch-cancel"'));
    ok('C13 弹窗有 aria-modal', /id="ni-stage-batch-modal"[\s\S]{0,400}aria-modal="true"/.test(tpl));
}

// ── D. 样式 ────────────────────────────────────────────────
for (const cls of [
    '.ni-stage-batch-card', '.ni-stage-batch-hint', '.ni-stage-batch-tools',
    '.ni-stage-batch-list', '.ni-stage-batch-row', '.ni-stage-batch-num',
    '.ni-stage-batch-title', '.ni-stage-batch-meta', '.ni-stage-batch-pager',
]) {
    ok(`D 样式 ${cls}`, css.includes(cls));
}

// ── E. index.js 接线 ───────────────────────────────────────
{
    const defs = [...src.matchAll(/function (ni(?:OpenStageBatchModal|CloseStageBatchModal|RenderStageBatchList|ApplyStageBatch|StageBatchSetPage|StageBatchToggle|StageBatchApplyPage|StageBatchAllIds|StageBatchPageIds|StageBatchStageMeta))\b/g)];
    eq('E1 十个函数各定义一次', defs.length, 10);
    eq('E2 函数名不重复', new Set(defs.map(m => m[1])).size, 10);

    ok('E3 导入分页纯函数', src.includes('niBuildStageBatchPage'));
    ok('E4 导入映射纯函数', src.includes('niStageBatchSelectionMap'));
    ok('E5 解构 niSetStagesState', /niSetStagesState,/.test(src));
    ok('E6 每页 20/30 常量', src.includes('NI_STAGE_BATCH_PAGE_SIZES = [20, 30]'));
    ok('E7 分页切片用纯函数', /function niStageBatchPageIds[\s\S]{0,400}niBuildStageBatchPage/.test(src));
    ok('E7b 渲染走分页切片', /function niRenderStageBatchList[\s\S]{0,400}niStageBatchPageIds\(ids\)/.test(src));
    ok('E8 复选框 data 属性', src.includes('data-batch-check="'));
    ok('E9 应用调 niSetStagesState', /function niApplyStageBatch[\s\S]{0,600}niSetStagesState\(map\)/.test(src));
    ok('E10 应用后刷新策略条', /function niApplyStageBatch[\s\S]{0,900}niRefreshInjStrategyUi\(\)/.test(src));
    ok('E11 应用后刷新时间线', /function niApplyStageBatch[\s\S]{0,900}niRenderTimeline\(\)/.test(src));
    ok('E12 打开时用当前启用态初始化', /_niStageBatchSel = new Set\(ids\.filter\(idx => S\.stageStates\?\.\[idx\] !== false\)\)/.test(src));
    ok('E13 空阶段给提示', /function niOpenStageBatchModal[\s\S]{0,300}toastr\.info/.test(src));

    for (const sel of [
        '#ni-stage-batch-open', '#ni-stage-batch-cancel', '#ni-stage-batch-apply',
        '#ni-stage-batch-prev', '#ni-stage-batch-next', '#ni-stage-batch-all-page',
        '#ni-stage-batch-none-page', '#ni-stage-batch-size', '#ni-stage-batch-list',
    ]) {
        ok(`E 绑定 ${sel}`, src.includes(`'${sel}'`));
    }
    ok('E14 背景点击关闭', /\$app\.on\('click', '#ni-stage-batch-modal'[\s\S]{0,200}niCloseStageBatchModal/.test(src));
    ok('E15 入口按钮阻止冒泡', /#ni-stage-batch-open[\s\S]{0,120}stopPropagation/.test(src));
    ok('E16 复选框 change 触发 toggle', /#ni-stage-batch-list[\s\S]{0,300}niStageBatchToggle/.test(src));
    ok('E17 换页数后回到第一页', /#ni-stage-batch-size[\s\S]{0,400}_niStageBatchPage = 1/.test(src));
}

// ── F. story-data 批量写入 ─────────────────────────────────
{
    ok('F1 niSetStagesState 定义', story.includes('function niSetStagesState(stateMap)'));
    ok('F2 挂 window', story.includes('window.niSetStagesState = niSetStagesState'));
    ok('F3 出现在导出列表', /^\s{8}niSetStagesState,$/m.test(story));
    ok('F4 只刷新一次依赖', /function niSetStagesState[\s\S]{0,1400}niRefreshStageStateDependents\(\{ charactersChanged \}\)/.test(story));
    ok('F5 同步卡片 DOM', /function niSetStagesState[\s\S]{0,1200}niSyncStageToggleDom/.test(story));
    ok('F6 过滤越界阶段号', /function niSetStagesState[\s\S]{0,400}idx <= S\.stageMapN/.test(story));
    ok('F7 无变化返回 0', /function niSetStagesState[\s\S]{0,1200}if \(!changedStages\.length\) return 0;/.test(story));
}

// ── 结果 ───────────────────────────────────────────────────
console.log(`\n阶段批量勾选：${pass} 通过，${fails.length} 失败`);
if (fails.length) {
    for (const f of fails) console.log('  ✗ ' + f);
    process.exit(1);
}
console.log('全部通过 ✅');
