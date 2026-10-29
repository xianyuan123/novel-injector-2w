// 剧情时间线：纯函数 + 接线自检
// 跑法：node tests/timeline.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN_ROOT } from './_paths.mjs';
import {
    NI_TIMELINE_LANE_ORDER,
    niBuildTimelineModel,
    niNormalizeTimelineView,
    niTimelineClip,
    niTimelineNodeLabel,
    niTimelineToHtml,
} from '../lib/timeline-system.js';

const ROOT = PLUGIN_ROOT;
let pass = 0;
let fail = 0;
const fails = [];

function ok(name, cond, extra = '') {
    if (cond) { pass++; return; }
    fail++;
    fails.push(`${name}${extra ? ` → ${extra}` : ''}`);
}
function eq(name, actual, expected) {
    ok(name, Object.is(actual, expected) || JSON.stringify(actual) === JSON.stringify(expected),
        `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}
function read(file) {
    return fs.readFileSync(path.join(ROOT, file), 'utf8');
}
const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------------------------------------------------------------- A 视图模式
eq('A1 默认列表', niNormalizeTimelineView(''), 'list');
eq('A2 timeline', niNormalizeTimelineView('timeline'), 'timeline');
eq('A3 未知值回落列表', niNormalizeTimelineView('whatever'), 'list');
eq('A4 null 回落列表', niNormalizeTimelineView(null), 'list');
eq('A5 泳道顺序', NI_TIMELINE_LANE_ORDER.join(','), 'main,sub,pivot');

// ---------------------------------------------------------------- B 文本裁剪
eq('B1 短标题原样', niTimelineClip('断桥之战'), '断桥之战');
ok('B2 长标题截断并加省略号', niTimelineClip('一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十', 10).endsWith('…'));
ok('B3 长标题长度受限', niTimelineClip('a'.repeat(80), 12).length <= 12);
eq('B4 空白折叠', niTimelineClip('  断桥   之战  '), '断桥 之战');
eq('B5 无标题占位', niTimelineNodeLabel({}), '（未命名节点）');
eq('B6 用 title 优先', niTimelineNodeLabel({ title: '剑心共鸣', name: '别的' }), '剑心共鸣');
eq('B7 name 兜底', niTimelineNodeLabel({ name: '旧友' }), '旧友');

// ---------------------------------------------------------------- C 模型
const sampleNodes = {
    1: { main: [{ title: '入门考核', _type: 'main', _nodeId: 'm1' }], sub: [], pivot: [] },
    2: {
        main: [{ title: '藏剑冢守夜', _type: 'main', _nodeId: 'm2' }, { title: '残缺剑谱', _type: 'main', _nodeId: 'm3' }],
        sub: [{ title: '守冢老人的身份', _type: 'sub', _nodeId: 's1' }],
        pivot: [{ title: '剑灵初现', _type: 'pivot', _nodeId: 'p1' }],
    },
};

const model = niBuildTimelineModel({
    stageCount: 2,
    stageTitles: { 1: '山门试炼', 2: '剑冢夜话' },
    stageOn: { 1: true, 2: false },
    stageVec: { 1: true },
    nodesByStage: sampleNodes,
    nodeCharsByStage: { 1: 150, 2: 420 },
    currentStageIdx: 2,
    isStageBlocked: idx => idx === 1,
    isNodeBlocked: node => node?._nodeId === 's1',
});

eq('C1 列数', model.columns.length, 2);
eq('C2 节点总数', model.totalNodes, 5);
eq('C3 屏蔽节点数', model.blockedNodes, 1);
eq('C4 首列标题', model.columns[0].title, '山门试炼');
eq('C5 首列被屏蔽', model.columns[0].blocked, true);
eq('C6 首列已向量', model.columns[0].vec, true);
eq('C7 次列未开启', model.columns[1].on, false);
eq('C8 次列是当前', model.columns[1].current, true);
eq('C9 首列非当前', model.columns[0].current, false);
eq('C10 次列节点数', model.columns[1].nodeCount, 4);
eq('C11 次列屏蔽数', model.columns[1].blockedInStage, 1);
eq('C12 token 估算(420/1.5)', model.columns[1].tokens, 280);
eq('C13 主线两条', model.columns[1].lanes[0].nodes.length, 2);
eq('C14 支线一条', model.columns[1].lanes[1].nodes.length, 1);
eq('C15 转折一条', model.columns[1].lanes[2].nodes.length, 1);
eq('C16 支线节点标记屏蔽', model.columns[1].lanes[1].nodes[0].blocked, true);
eq('C17 主线节点未屏蔽', model.columns[1].lanes[0].nodes[0].blocked, false);
eq('C18 节点 id 带出来', model.columns[1].lanes[0].nodes[0].id, 'm2');
eq('C19 空模型 empty', niBuildTimelineModel({ stageCount: 0 }).empty, true);
eq('C20 空模型无列', niBuildTimelineModel({}).columns.length, 0);
eq('C21 缺 nodesByStage 不炸', niBuildTimelineModel({ stageCount: 2 }).totalNodes, 0);
eq('C22 压缩模式按压缩字数', niBuildTimelineModel({ stageCount: 1, rawMode: 'compressed', compressedCharsByStage: { 1: 300 } }).columns[0].tokens, 200);
eq('C23 当前阶段非法值不标记', niBuildTimelineModel({ stageCount: 1, currentStageIdx: -3 }).columns[0].current, false);

// ---------------------------------------------------------------- D HTML
const html = niTimelineToHtml(model, { esc });
ok('D1 含时间线图例', html.includes('剧情时间线'));
ok('D2 图例统计阶段与节点', html.includes('2 阶段 · 5 节点'));
ok('D3 图例统计屏蔽数', html.includes('屏蔽 1'));
ok('D4 当前列有「现在」', html.includes('ni-tl-now">现在'));
ok('D5 屏蔽列有 is-blocked', html.includes('ni-tl-col is-current is-blocked') || (html.includes('is-blocked') && html.includes('data-tl-stage="1"')));
ok('D6 未开启列有 is-off', html.includes('is-off'));
ok('D7 阶段头可点击定位', html.includes('class="ni-tl-head" data-tl-stage="1"'));
ok('D8 节点带 data-tl-stage', html.includes('data-tl-stage="2" data-tl-node="m2"'));
ok('D9 屏蔽节点有 is-blocked', html.includes('ni-tl-node is-blocked'));
ok('D10 三个泳道标签', html.includes('>主线<') && html.includes('>支线<') && html.includes('>转折<'));
ok('D11 空模型给空态', niTimelineToHtml(niBuildTimelineModel({}), { esc }).includes('ni-tl-empty'));
ok('D12 转义尖括号', niTimelineToHtml(niBuildTimelineModel({
    stageCount: 1,
    stageTitles: { 1: '<img src=x>' },
    nodesByStage: { 1: { main: [{ title: '<b>注入</b>', _nodeId: 'x' }], sub: [], pivot: [] } },
}), { esc }).includes('&lt;b&gt;注入&lt;/b&gt;'));
ok('D13 无 esc 时也输出字符串', typeof niTimelineToHtml(model) === 'string');
ok('D14 token 文案', html.includes('~280 token'));

// ---------------------------------------------------------------- E 接线
const template = read('template.html');
const index = read('index.js');
const css = read('style.css');

ok('E1 模板有视图切换', template.includes('id="ni-stage-view-toggle"'));
ok('E2 模板有两个切换按钮', template.includes('data-stage-view="list"') && template.includes('data-stage-view="timeline"'));
ok('E3 模板有时间线容器', template.includes('id="ni-timeline"'));
ok('E4 时间线容器默认隐藏', /id="ni-timeline"[^>]*hidden/.test(template));
ok('E5 index 引入时间线模块', index.includes("from './lib/timeline-system.js'"));
ok('E6 index 有模型收集函数', index.includes('function niCollectTimelineModel('));
ok('E7 模型用屏蔽上下文', index.includes('niBuildBlockedRecallContext(cfg)'));
ok('E8 模型用进度锚点', index.includes('currentStageIdx: niResolveProgressAnchorStageIdx(cfg) || 0'));
ok('E9 有渲染函数', index.includes('function niRenderTimeline('));
ok('E10 有视图切换函数', index.includes('function niApplyStageView('));
ok('E11 切换时记住偏好', index.includes('NI_STAGE_VIEW_KEY'));
ok('E12 时间线隐藏分页', index.includes("pager.style.display = isTimeline ? 'none' : ''"));
ok('E13 有定位回列表函数', index.includes('function niJumpFromTimeline(') && index.includes('window.niJumpToStage?.(idx)'));
ok('E14 绑定视图切换事件', index.includes("$app.on('click', '[data-stage-view]'"));
ok('E15 绑定时间线点击', index.includes("$app.on('click', '[data-tl-stage]'"));
ok('E16 刷新策略时重绘时间线', index.includes("if (_niStageView === 'timeline')"));
ok('E17 启动时恢复偏好', index.includes('niLoadStageViewPreference(); niApplyStageView'));
ok('E18 时间线渲染失败不影响注入', index.includes('时间线渲染失败'));

ok('F1 有分段控件样式', css.includes('.ni-seg-btn.on'));
ok('F2 有轨道与列样式', css.includes('.ni-tl-track') && css.includes('.ni-tl-col'));
ok('F3 当前列高亮样式', css.includes('.ni-tl-col.is-current'));
ok('F4 屏蔽列斜纹样式', css.includes('.ni-tl-col.is-blocked'));
ok('F5 节点卡片样式', css.includes('.ni-tl-node'));
ok('F6 三种泳道配色', css.includes('.ni-tl-lane[data-lane="main"]') && css.includes('.ni-tl-lane[data-lane="sub"]') && css.includes('.ni-tl-lane[data-lane="pivot"]'));
ok('F7 空态样式', css.includes('.ni-tl-empty'));

console.log(`\n时间线测试：${pass} 通过 / ${fail} 失败`);
if (fail) {
    console.log('失败项：');
    for (const item of fails) console.log('  ✗ ' + item);
    process.exit(1);
}
console.log('全部通过 ✓');
