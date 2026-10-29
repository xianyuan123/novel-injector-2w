// 阶段页「注入策略」折叠条：纯函数 + 接线回归
// 运行：node tests/inj-ui.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { niFormatStageInjSummary, niFormatStageSpan, niResolveProgressAnchorStage, niSummarizeInjectionSections } from '../lib/ui-system.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const idx = read('index.js');
const tpl = read('template.html');
const css = read('style.css');
const ui = read('lib/ui-system.js');

let pass = 0;
const failures = [];
function check(label, fn) {
    try {
        const ret = fn();
        if (ret === false) throw new Error('断言返回 false');
        pass++;
        console.log(`  ok   ${label}`);
    } catch (e) {
        failures.push(`${label} :: ${e.message}`);
        console.log(`  FAIL ${label} :: ${e.message}`);
    }
}
function eq(actual, expected, label) {
    check(label, () => {
        const a = JSON.stringify(actual);
        const b = JSON.stringify(expected);
        if (a !== b) throw new Error(`期望 ${b}，实际 ${a}`);
        return true;
    });
}

console.log('== A 组：阶段号缩写 ==');
eq(niFormatStageSpan([8]), '第 8', '单个阶段');
eq(niFormatStageSpan([1, 2, 3, 4, 5, 6, 7]), '第 1–7', '连续区间用连接号');
eq(niFormatStageSpan([2, 5]), '第 2、5', '不连续用顿号');
eq(niFormatStageSpan([5, 2, 2, 9, 1]), '第 1、2、5、9', '去重并按升序');
eq(niFormatStageSpan([]), '', '空数组');
eq(niFormatStageSpan([0, -3, 'x', null, undefined, 4]), '第 4', '过滤非法阶段号');
eq(niFormatStageSpan('not-an-array'), '', '非数组不崩');
eq(niFormatStageSpan(['7', 8]), '第 7–8', '字符串阶段号也认');

console.log('== B 组：策略条摘要 ==');
eq(niFormatStageInjSummary({
    recallStages: [1, 2, 3, 4, 5, 6, 7],
    directStageStages: [8],
    fullInjectApplied: true,
}), '召回 第 1–7 · 直注 第 8（全量）', '召回 + 全量直注');

eq(niFormatStageInjSummary({
    recallStages: [1, 2],
    directStageStages: [8],
}), '召回 第 1–2 · 直注 第 8', '直注不带全量标记');

eq(niFormatStageInjSummary({
    vectorInjectionDisabled: true,
    recallStages: [1, 2],
}), '召回·手动关闭', '手动关掉召回时明说');

eq(niFormatStageInjSummary({}), '召回·无', '什么都没开时只说召回无');

eq(niFormatStageInjSummary({
    recallStages: [1],
    futureEnabled: true,
    futureStageIndices: [8, 9],
    currentStageIdx: 8,
    futureIncludeCurrent: true,
}), '召回 第 1 · 预告 本阶段剩余 + 第 9', '预告含当前阶段剩余');

eq(niFormatStageInjSummary({
    recallStages: [1],
    futureEnabled: true,
    futureStageIndices: [9, 10],
    currentStageIdx: 8,
    futureIncludeCurrent: false,
}), '召回 第 1 · 预告 第 9–10', '预告不含当前阶段');

eq(niFormatStageInjSummary({
    recallStages: [1],
    futureEnabled: true,
    futureStageIndices: [],
    currentStageIdx: 8,
    futureIncludeCurrent: false,
}), '召回 第 1 · 预告·本轮无', '预告没有可用阶段时也显示出来');

eq(niFormatStageInjSummary({
    recallStages: [1, 2],
    blockedStageCount: 7,
    blockedNodeCount: 3,
}), '召回 第 1–2 · 屏蔽 7 个阶段/3 个节点', '屏蔽同时报阶段与节点');

eq(niFormatStageInjSummary({
    recallStages: [1],
    blockedStageCount: 0,
    blockedNodeCount: 2,
}), '召回 第 1 · 屏蔽 2 个节点', '只屏蔽节点时不写阶段');

eq(niFormatStageInjSummary({
    vectorInjectionDisabled: true,
    blockedStageCount: 0,
    blockedNodeCount: 0,
    futureEnabled: false,
}), '召回·手动关闭', '全关时不会拼出空串');

console.log('== C 组：模板结构 ==');
check('模板有策略条外壳', () => tpl.includes('id="ni-stage-inj-bar"'));
check('模板有折叠内容区', () => tpl.includes('id="ni-stage-inj-body"'));
check('模板有摘要文本节点', () => tpl.includes('id="ni-stage-inj-summary"'));
check('外壳带 aria 语义', () => /id="ni-stage-inj-bar"[^>]*aria-expanded="false"/.test(tpl));
check('策略条有 title 说明', () => /id="ni-stage-inj-bar"[\s\S]{0,400}?title="/.test(tpl));
check('四组开关都在折叠区内', () => {
    const start = tpl.indexOf('id="ni-stage-inj-body"');
    const end = tpl.indexOf('id="ni-stage-pagination"');
    if (start < 0 || end < 0 || end < start) throw new Error('找不到折叠区范围');
    const body = tpl.slice(start, end);
    ['ni-stage-full-inject', 'ni-stage-future-inject', 'ni-stage-block-prev', 'ni-stage-inj-budget-note']
        .forEach(id => {
            if (!body.includes(`id="${id}"`)) throw new Error(`折叠区里缺 ${id}`);
        });
    return true;
});
check('原来的多合一提示已拆短', () => {
    const start = tpl.indexOf('<div class="ni-hint-box">');
    if (start < 0) throw new Error('找不到 hint-box');
    const hint = tpl.slice(start, tpl.indexOf('</div>', start));
    if (hint.length > 400) throw new Error(`提示还是太长（${hint.length} 字符）`);
    return true;
});
check('div 标签配平', () => {
    const open = (tpl.match(/<div\b/g) || []).length;
    const close = (tpl.match(/<\/div>/g) || []).length;
    if (open !== close) throw new Error(`<div> ${open} / </div> ${close}`);
    return true;
});

console.log('== D 组：样式 ==');
check('有策略条样式', () => css.includes('.ni-stage-inj-bar {'));
check('有摘要省略号样式', () => /\.ni-stage-inj-summary \{[\s\S]*?text-overflow: ellipsis/.test(css));
check('折叠态默认隐藏', () => /\.ni-stage-inj-body \{ display: none; \}/.test(css));
check('展开态显示', () => /\.ni-stage-inj-body\.on \{ display: block; \}/.test(css));
check('展开时箭头翻转', () => /\.ni-stage-inj-bar\.open \.ni-stage-inj-chevron \{ transform: rotate\(180deg\)/.test(css));

console.log('== E 组：index.js 接线 ==');
check('默认收起状态写进设置', () => /stageInjExpanded: false/.test(idx));
check('有展开/收起函数', () => idx.includes('function niToggleStageInjPanel()'));
check('展开状态会落盘', () => /cfg\.stageInjExpanded = open;[\s\S]{0,80}?niSaveSettings\(\)/.test(idx));
check('点击与键盘都能切换', () => {
    if (!/\$app\.on\('click', '#ni-stage-inj-bar'/.test(idx)) throw new Error('缺 click 绑定');
    if (!/\$app\.on\('keydown', '#ni-stage-inj-bar'/.test(idx)) throw new Error('缺 keydown 绑定');
    return true;
});
check('刷新入口会更新摘要', () => {
    const fn = idx.slice(idx.indexOf('function niUpdateVecOffBtn()'), idx.indexOf('function niUpdateVecOffBtn()') + 1600);
    if (!fn.includes('niUpdateStageInjSummary(plan)')) throw new Error('niUpdateVecOffBtn 里没更新摘要');
    if (!fn.includes('niUpdateStageInjPanel()')) throw new Error('niUpdateVecOffBtn 里没同步折叠态');
    return true;
});
check('三个预告开关都走统一刷新', () => {
    const hits = (idx.match(/niRefreshInjStrategyUi\(\)/g) || []).length;
    if (hits < 4) throw new Error(`niRefreshInjStrategyUi 只出现 ${hits} 次（应≥4：定义+3 处调用）`);
    return true;
});
check('预算预览复用已解析的计划', () => {
    if (!idx.includes('function niBuildStageInjectionBudgetPreview(precomputedPlan = null)')) throw new Error('预算预览没支持复用计划');
    if (!idx.includes('niBuildStageInjectionBudgetPreview(precomputedPlan)')) throw new Error('预算预览没把计划传下去');
    if (!/niUpdateStageInjectionBudgetNote\(null, \{ plan \}\)/.test(idx)) throw new Error('调用点没复用 plan');
    return true;
});
check('摘要函数从 ui-system 引入', () => /import \{[\s\S]*?niFormatStageInjSummary[\s\S]*?\} from '\.\/lib\/ui-system\.js';/.test(idx));

console.log('== F 组：注入预览统计 ==');
{
    const report = niSummarizeInjectionSections([
        { id: 'char', title: '人设', text: 'x'.repeat(300), meta: '主提示前' },
        { id: 'plot', title: '阶段', text: 'y'.repeat(1500), meta: '' },
        { id: 'vec', title: '召回', text: '', meta: '实时' },
    ]);
    eq(report.totalChars, 1800, '总字符数');
    eq(report.totalTokens, 1200, '按 1.5 字符/token 估算');
    eq(report.count, 2, '只统计有内容的段');
    eq(report.sections.length, 3, '空段也保留在列表里');
    eq(report.sections[0].share.toFixed(3), '0.167', '第一段占比');
    eq(report.sections[2].tokens, 0, '空段 token 为 0');
    eq(niSummarizeInjectionSections([]).totalChars, 0, '空列表不崩');
    eq(niSummarizeInjectionSections([{ title: 'a', text: 'zz' }], { charsPerToken: 2 }).totalTokens, 1, '自定义换算比例');
    eq(niSummarizeInjectionSections(null).count, 0, 'null 输入安全');
}

console.log('== G 组：预览弹窗结构 ==');
check('模板有预览弹窗', () => tpl.includes('id="ni-inj-preview-modal"'));
check('模板有统计行与列表', () => tpl.includes('id="ni-inj-preview-sum"') && tpl.includes('id="ni-inj-preview-list"'));
check('模板有召回与关闭按钮', () => tpl.includes('id="ni-inj-preview-recall"') && tpl.includes('id="ni-inj-preview-close"'));
check('预览入口在折叠条里', () => {
    const bar = tpl.slice(tpl.indexOf('id="ni-stage-inj-bar"'), tpl.indexOf('id="ni-stage-inj-body"'));
    if (!bar.includes('id="ni-inj-preview-open"')) throw new Error('折叠条里没有预览按钮');
    return true;
});

console.log('== H 组：预览与注入主链共用构造函数 ==');
check('人设正文只有一个构造函数', () => {
    const defs = (idx.match(/function niBuildCharInjectionText\(/g) || []).length;
    if (defs !== 1) throw new Error(`niBuildCharInjectionText 定义了 ${defs} 次`);
    const calls = (idx.match(/niBuildCharInjectionText\(/g) || []).length - defs;
    if (calls < 2) throw new Error(`niBuildCharInjectionText 只被调用 ${calls} 次（应≥2：注入 + 预览；定义不计）`);
    return true;
});
check('注入主链用共用的人设构造函数', () => {
    const fn = idx.slice(idx.indexOf('async function onPromptReady('), idx.indexOf('async function onPromptReady(') + 12000);
    if (!/const charContent = niBuildCharInjectionText\(stageInjectionPlan\);/.test(fn)) throw new Error('注入主链没用人设构造函数（应传 stageInjectionPlan）');
    return true;
});
check('召回查询只有一个构造入口', () => {
    const defs = (idx.match(/function niBuildVectorRecallInputs\(/g) || []).length;
    if (defs !== 1) throw new Error(`niBuildVectorRecallInputs 定义了 ${defs} 次`);
    const uses = (idx.match(/niBuildVectorRecallInputs\(/g) || []).length;
    if (uses < 3) throw new Error(`调用 ${uses} 次（应≥3：定义+注入主链+预览召回）`);
    return true;
});
check('注入主链用共用的召回查询', () => {
    const fn = idx.slice(idx.indexOf('async function onPromptReady('), idx.indexOf('async function onPromptReady(') + 12000);
    if (!fn.includes('} = niBuildVectorRecallInputs(stageInjectionPlan, chat, { allNodes: allPlotNodes });')) throw new Error('注入主链没走共用召回查询');
    return true;
});
check('预览复用阶段与预告构造函数', () => {
    const fn = idx.slice(idx.indexOf('function niBuildInjectionPreviewSections('), idx.indexOf('function niRenderInjectionPreview('));
    if (!fn.includes('niBuildStageInjectionPayloadForPlan(plan, cfg)')) throw new Error('预览没复用阶段构造函数');
    if (!fn.includes('niBuildFuturePlotInjectionPayload(plan, cfg)')) throw new Error('预览没复用预告构造函数');
    return true;
});
check('渲染用统计函数算总账', () => {
    const fn = idx.slice(idx.indexOf('function niRenderInjectionPreview('), idx.indexOf('function niOpenInjectionPreview('));
    if (!fn.includes('niSummarizeInjectionSections(')) throw new Error('渲染时没用统计函数');
    if (!fn.includes('niEscHtml(')) throw new Error('正文没有转义');
    return true;
});
check('预览按钮不会误触折叠', () => {
    const h = idx.slice(idx.indexOf("$app.on('click', '#ni-inj-preview-open'"), idx.indexOf("$app.on('click', '#ni-inj-preview-close'"));
    if (!h.includes('stopPropagation')) throw new Error('缺 stopPropagation');
    if (!h.includes('niOpenInjectionPreview()')) throw new Error('没打开预览');
    return true;
});
check('预览弹窗有四个绑定', () => {
    ['#ni-inj-preview-open', '#ni-inj-preview-close', '#ni-inj-preview-recall', '#ni-inj-preview-modal']
        .forEach(sel => {
            if (!idx.includes(`$app.on('click', '${sel}'`)) throw new Error(`缺 ${sel} 绑定`);
        });
    return true;
});
check('预览样式齐全', () => {
    ['ni-stage-inj-preview', 'ni-inj-preview-item', 'ni-inj-preview-item-body', 'ni-inj-preview-empty']
        .forEach(cls => { if (!css.includes(`.${cls}`)) throw new Error(`缺 .${cls}`); });
    return true;
});

console.log('== I 组：进度锚点 ==');
eq(niResolveProgressAnchorStage({ progressStageIdx: 3, stageCount: 10 }), 3, '正常锚定第 3 阶段');
eq(niResolveProgressAnchorStage({ progressStageIdx: 0, stageCount: 10 }), null, '0 表示自动');
eq(niResolveProgressAnchorStage({ progressStageIdx: -2, stageCount: 10 }), null, '负数当没设');
eq(niResolveProgressAnchorStage({ progressStageIdx: 12, stageCount: 10 }), null, '越界退回自动');
eq(niResolveProgressAnchorStage({ progressStageIdx: 5, stageCount: 0 }), 5, '阶段数未知时不做越界判断');
eq(niResolveProgressAnchorStage({ transBookMode: true, progressStageIdx: 3, stageCount: 10 }), null, '穿书模式忽略锚点');
eq(niResolveProgressAnchorStage({ progressStageIdx: '4', stageCount: 10 }), 4, '字符串阶段号也能用');
eq(niResolveProgressAnchorStage({}), null, '空参数');
check('锚点解析抽成纯函数', () => {
    const defs = (ui.match(/export function niResolveProgressAnchorStage\(/g) || []).length;
    if (defs !== 1) throw new Error(`niResolveProgressAnchorStage 定义了 ${defs} 次`);
    if (!idx.includes('niResolveProgressAnchorStage({')) throw new Error('index.js 没调用纯函数');
    return true;
});
check('进度锚点 UI 三件套都在', () => {
    ['ni-stage-progress-row', 'ni-progress-stage', 'ni-progress-node', 'ni-progress-clear', 'ni-stage-progress-hint']
        .forEach(id => { if (!tpl.includes(`id="${id}"`)) throw new Error(`模板缺 ${id}`); });
    return true;
});
check('进度锚点样式齐全', () => {
    ['ni-stage-progress-row', 'ni-stage-progress-field', 'ni-stage-progress-node', 'ni-stage-progress-hint']
        .forEach(cls => { if (!css.includes(`.${cls}`)) throw new Error(`缺 .${cls}`); });
    return true;
});
check('进度锚点三个绑定', () => {
    ["$app.on('change', '#ni-progress-stage'", "$app.on('change', '#ni-progress-node'", "$app.on('click', '#ni-progress-clear'"]
        .forEach(s => { if (!idx.includes(s)) throw new Error(`缺绑定 ${s}`); });
    return true;
});
check('锚点进了执行计划', () => {
    const fn = idx.slice(idx.indexOf('function niResolveStageInjectionExecutionPlan('), idx.indexOf('function niResolveStageInjectionExecutionPlan(') + 3000);
    if (!fn.includes('niResolveProgressAnchorStageIdx(cfg)')) throw new Error('计划没用锚点');
    return true;
});
check('预告从锚定节点之后开始', () => {
    const fn = idx.slice(idx.indexOf('function niBuildFuturePlotInjectionPayload('), idx.indexOf('function niUpdateVecOffBtn('));
    if (!fn.includes('niGetProgressAnchorNodeId(cfg)')) throw new Error('预告没接锚定节点');
    return true;
});
check('摘要显示锚点', () => {
    const fn = idx.slice(idx.indexOf('function niUpdateStageInjSummary('), idx.indexOf('function niUpdateStageInjPanel('));
    if (!fn.includes('锚点 ')) throw new Error('摘要没显示锚点');
    if (!fn.includes('niResolveProgressAnchorStageIdx(cfg)')) throw new Error('摘要没读锚点');
    return true;
});
check('设置项有默认值', () => {
    if (!/progressStageIdx\s*:\s*0/.test(idx)) throw new Error('缺 progressStageIdx 默认值');
    if (!/progressNodeId\s*:\s*''/.test(idx)) throw new Error('缺 progressNodeId 默认值');
    return true;
});
check('切到阶段页会刷新锚点', () => {
    const fn = idx.slice(idx.indexOf('function niUpdateVecOffBtn('), idx.indexOf('function niUpdateVecOffBtn(') + 4000);
    if (!fn.includes('niUpdateProgressAnchorUI()')) throw new Error('niUpdateVecOffBtn 没刷新锚点 UI');
    return true;
});

console.log('== G 组：折叠区分组排版 ==');
check('折叠区拆成 5 张分组卡', () => {
    const body = tpl.slice(tpl.indexOf('id="ni-stage-inj-body"'), tpl.indexOf('id="ni-stage-pagination"'));
    const n = (body.match(/class="ni-inj-group"/g) || []).length;
    if (n !== 5) throw new Error('分组卡数量是 ' + n + '，期望 5');
    return true;
});
check('每组都有标题与说明', () => {
    const heads = tpl.match(/class="ni-inj-head"/g) || [];
    const titles = tpl.match(/class="ni-inj-title"/g) || [];
    const subs = tpl.match(/class="ni-inj-sub"/g) || [];
    if (heads.length !== 5 || titles.length !== 5 || subs.length !== 5) {
        throw new Error(`head/title/sub 数量 ${heads.length}/${titles.length}/${subs.length}`);
    }
    return true;
});
check('分组顺序：阶段启用 → 注入范围 → 提前预告 → 召回屏蔽 → 进度锚点', () => {
    const seq = [...tpl.matchAll(/class="ni-inj-title">([^<]+)</g)].map(m => m[1]);
    const want = ['阶段启用', '注入范围', '提前预告', '召回屏蔽', '进度锚点'];
    if (seq.join('|') !== want.join('|')) throw new Error('实际顺序：' + seq.join('|'));
    return true;
});
check('原来的四组开关 id 全在折叠区里', () => {
    const body = tpl.slice(tpl.indexOf('id="ni-stage-inj-body"'), tpl.indexOf('id="ni-stage-pagination"'));
    ['ni-stage-enable-all', 'ni-stage-disable-all', 'ni-stage-batch-open', 'ni-raw-inj-mode',
     'ni-stage-full-inject', 'ni-stage-full-inject-note', 'ni-stage-future-inject', 'ni-future-stages',
     'ni-future-nodes', 'ni-future-include-cur', 'ni-stage-future-note', 'ni-stage-block-prev',
     'ni-stage-block-pick-stages', 'ni-stage-block-hint', 'ni-progress-stage', 'ni-progress-node',
     'ni-progress-clear', 'ni-stage-progress-hint', 'ni-stage-inj-budget-note'].forEach(id => {
        if (!body.includes(`id="${id}"`)) throw new Error('折叠区缺 ' + id);
    });
    return true;
});
check('组内不再重复画底板（盒中盒）', () => {
    const from = css.indexOf('.ni-inj-group .ni-stage-bulk-row');
    if (from < 0) throw new Error('缺组内去底板规则');
    const rule = css.slice(from, css.indexOf('}', from));
    ['ni-stage-bulk-row', 'ni-stage-future-row', 'ni-stage-progress-row', 'ni-stage-block-bar']
        .forEach(cls => { if (!rule.includes('.' + cls)) throw new Error('去底板规则缺 ' + cls); });
    if (!rule.includes('background: none')) throw new Error('去底板规则没写 background: none');
    if (!rule.includes('border: none')) throw new Error('去底板规则没写 border: none');
    return true;
});
check('空说明行不占位', () => {
    if (!/\.ni-inj-group \.ni-stage-full-inject-note:empty/.test(css)) throw new Error('缺 :empty 隐藏规则');
    return true;
});
check('分组样式齐全', () => {
    ['.ni-inj-group {', '.ni-inj-head {', '.ni-inj-title {', '.ni-inj-sub {']
        .forEach(sel => { if (!css.includes(sel)) throw new Error('缺样式 ' + sel); });
    return true;
});
check('说明文字改成左侧细线，不再整块色底', () => {
    if (!/\.ni-inj-group \.ni-stage-full-inject-note,[\s\S]{0,200}border-left: 2px solid/.test(css)) {
        throw new Error('说明没改成左侧细线');
    }
    return true;
});

const total = pass + failures.length;
console.log('\n========================================');
if (failures.length) {
    console.log(`结果：${pass} 项通过，${failures.length} 项失败`);
    failures.forEach(f => console.log(` - ${f}`));
    process.exitCode = 1;
} else {
    console.log(`全部通过：注入策略折叠条 ${pass} 项，0 BUG`);
}
