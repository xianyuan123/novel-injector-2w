/**
 * 未来剧情预告 —— 回归测试
 *
 * 场景：开着向量化玩到第 8 阶段。当前阶段只发已演到的内容（不剧透），但把第 9、10
 * 阶段的前几个节点提前注入，让 AI 知道后面会发生什么、提前埋伏笔。
 *
 * 跑法：node tests/future-plot.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PLUGIN_ROOT, readPlugin } from './_paths.mjs';
import {
    NI_FUTURE_PLOT_NODES_DEFAULT,
    NI_FUTURE_PLOT_STAGE_DEFAULT,
    NI_FUTURE_PLOT_STAGE_LIMIT,
    NI_FUTURE_PLOT_TAG,
    niBuildFuturePlotPreview,
    niIsFuturePlotInjectionEnabled,
    niNormalizeFuturePlotNodesPerStage,
    niNormalizeFuturePlotStageCount,
    niResolveFuturePlotStageIndices,
} from '../lib/injection-system.js';
import { niBuildBlockedRecallContext, niMergeStageNodes } from '../lib/story-data.js';

let bugCount = 0;
const failures = [];
function check(label, fn) {
    try {
        fn();
        console.log(`  PASS ${label}`);
    } catch (e) {
        bugCount += 1;
        failures.push({ label, error: e });
        console.log(`  FAIL ${label} —— ${e.message}`);
    }
}

const makePlot = (id, title, body) => ({ _nodeId: id, title, body, type: 'main' });

const NODES = {
    9: {
        main: [makePlot('n9a', '节点9A', '正文9A'), makePlot('n9b', '节点9B', '正文9B')],
        sub: [makePlot('n9c', '节点9C', '正文9C')],
        pivot: [],
    },
    10: { main: [makePlot('n10a', '节点10A', '正文10A')], sub: [], pivot: [] },
    11: { main: [], sub: [], pivot: [] },
};

// ---- A 组：开关与数值规范化 ------------------------------------------------
console.log('\n[A] 开关与数值规范化');
check('A1 默认关闭', () => {
    assert.equal(niIsFuturePlotInjectionEnabled({}), false);
    assert.equal(niIsFuturePlotInjectionEnabled({ futurePlotPreview: false }), false);
});
check('A2 只有严格 true 才算开启', () => {
    assert.equal(niIsFuturePlotInjectionEnabled({ futurePlotPreview: true }), true);
    assert.equal(niIsFuturePlotInjectionEnabled({ futurePlotPreview: 'true' }), false);
    assert.equal(niIsFuturePlotInjectionEnabled({ futurePlotPreview: 1 }), false);
});
check('A3 阶段数规范化：缺省/越界/非法', () => {
    assert.equal(niNormalizeFuturePlotStageCount(undefined), NI_FUTURE_PLOT_STAGE_DEFAULT);
    assert.equal(niNormalizeFuturePlotStageCount('3'), 3);
    assert.equal(niNormalizeFuturePlotStageCount(0), 0);
    assert.equal(niNormalizeFuturePlotStageCount(-5), 0);
    assert.equal(niNormalizeFuturePlotStageCount(999), NI_FUTURE_PLOT_STAGE_LIMIT);
    assert.equal(niNormalizeFuturePlotStageCount('abc', 2), 2);
});
check('A4 节点数规范化：0 表示全部节点', () => {
    assert.equal(niNormalizeFuturePlotNodesPerStage(undefined), NI_FUTURE_PLOT_NODES_DEFAULT);
    assert.equal(niNormalizeFuturePlotNodesPerStage(0), 0);
    assert.equal(niNormalizeFuturePlotNodesPerStage('5'), 5);
    assert.equal(niNormalizeFuturePlotNodesPerStage(999), 20);
});

// ---- B 组：挑阶段 ----------------------------------------------------------
console.log('\n[B] 往后挑哪几个阶段');
const stagesOf = (opts) => niResolveFuturePlotStageIndices(opts);

check('B1 往后看 1 个阶段', () => {
    assert.deepEqual(stagesOf({ stageCount: 12, currentStageIdx: 8, stageLimit: 1 }), [9]);
});
check('B2 往后看 3 个阶段', () => {
    assert.deepEqual(stagesOf({ stageCount: 12, currentStageIdx: 8, stageLimit: 3 }), [9, 10, 11]);
});
check('B3 不超过阶段总数', () => {
    assert.deepEqual(stagesOf({ stageCount: 12, currentStageIdx: 11, stageLimit: 5 }), [12]);
});
check('B4 已经是最后一个阶段 → 空', () => {
    assert.deepEqual(stagesOf({ stageCount: 12, currentStageIdx: 12, stageLimit: 3 }), []);
});
check('B5 当前阶段未知 / 非法 → 空', () => {
    assert.deepEqual(stagesOf({ stageCount: 12, currentStageIdx: null, stageLimit: 3 }), []);
    assert.deepEqual(stagesOf({ stageCount: 12, currentStageIdx: 0, stageLimit: 3 }), []);
    assert.deepEqual(stagesOf({ stageCount: 12, currentStageIdx: 'x', stageLimit: 3 }), []);
    assert.deepEqual(stagesOf({ stageCount: 12, currentStageIdx: 8, stageLimit: 0 }), []);
});
check('B6 跳过被关闭的阶段', () => {
    assert.deepEqual(
        stagesOf({ stageCount: 12, currentStageIdx: 8, stageLimit: 3, enabledStages: [8, 9, 11, 12] }),
        [9, 11, 12],
    );
});
check('B7 跳过被整段屏蔽的阶段', () => {
    assert.deepEqual(
        stagesOf({ stageCount: 12, currentStageIdx: 8, stageLimit: 2, blockedStageIdxs: [9] }),
        [10, 11],
    );
});
check('B8 字符串形式的当前阶段也能用', () => {
    assert.deepEqual(stagesOf({ stageCount: 12, currentStageIdx: '8', stageLimit: 1 }), [9]);
});

// ---- C 组：节点模式正文 ----------------------------------------------------
console.log('\n[C] 节点模式：每阶段取前 N 个节点');
check('C1 两个阶段各取前 2 个节点', () => {
    const preview = niBuildFuturePlotPreview({
        stageIndices: [9, 10],
        nodesByStage: NODES,
        nodesPerStage: 2,
        maxTokens: 32000,
    });
    assert.equal(preview.sections.length, 2);
    assert.equal(preview.nodeCount, 3); // 9 阶段 2 个 + 10 阶段 1 个
    assert.ok(preview.content.includes(`[${NI_FUTURE_PLOT_TAG}]`));
    assert.ok(preview.content.includes('尚未演到'));
    assert.ok(preview.content.includes('节点10A'));
    // 顺序以 niMergeStageNodes 为准（与整阶段直注完全同一套排序），
    // 所以这里只断言「排在第 3 位及之后的节点没进来」，不硬编码具体是哪一个。
    const dropped = niMergeStageNodes(NODES[9]).slice(2).map(plot => plot.title);
    assert.ok(dropped.length > 0);
    dropped.forEach(title => assert.ok(
        !preview.content.includes(`${title}：`),
        `排在第 3 位的节点「${title}」不该出现`,
    ));
});
check('C2 节点数填 0 → 该阶段全部节点', () => {
    const preview = niBuildFuturePlotPreview({
        stageIndices: [9],
        nodesByStage: NODES,
        nodesPerStage: 0,
        maxTokens: 32000,
    });
    assert.equal(preview.nodeCount, 3);
    assert.ok(preview.content.includes('节点9C'));
});
check('C3 被屏蔽的节点不出现在预告里', () => {
    const blocked = niBuildBlockedRecallContext({ blockedRecallNodes: { n9a: true } });
    const preview = niBuildFuturePlotPreview({
        stageIndices: [9],
        nodesByStage: NODES,
        nodesPerStage: 0,
        blockedContext: blocked,
        maxTokens: 32000,
    });
    assert.ok(!preview.content.includes('正文9A'), '被屏蔽节点必须被剔除');
    assert.ok(preview.content.includes('正文9B'));
});
check('C4 被整段屏蔽的阶段不出现在预告里', () => {
    const blocked = niBuildBlockedRecallContext({ blockedRecallStages: { 10: true } });
    const preview = niBuildFuturePlotPreview({
        stageIndices: [9, 10],
        nodesByStage: NODES,
        nodesPerStage: 2,
        blockedContext: blocked,
        maxTokens: 32000,
    });
    assert.deepEqual(preview.stageIndices, [9]);
    assert.ok(!preview.content.includes('节点10A'));
});
check('C5 空阶段列表 → 空内容', () => {
    const preview = niBuildFuturePlotPreview({ stageIndices: [], nodesByStage: NODES, maxTokens: 32000 });
    assert.equal(preview.content, '');
    assert.equal(preview.nodeCount, 0);
});
check('C6 超预算时在节点边界处截断，不切半句', () => {
    const longBody = '这是一段很长的节点正文。'.repeat(60); // 约 720 字
    const preview = niBuildFuturePlotPreview({
        stageIndices: [9],
        nodesByStage: {
            9: {
                main: [
                    makePlot('long1', '长节点一', longBody),
                    makePlot('long2', '长节点二', longBody),
                ],
                sub: [],
                pivot: [],
            },
        },
        nodesPerStage: 0,
        maxTokens: 700,
        bodyCharLimit: 2000,
    });
    assert.equal(preview.truncated, true);
    assert.equal(preview.nodeCount, 1, '第二个节点装不下就整条丢弃');
    assert.ok(preview.content.includes('长节点一'));
    assert.ok(!preview.content.includes('长节点二'));
});

// ---- D 组：压缩原文模式 ----------------------------------------------------
console.log('\n[D] 压缩原文模式');
const chunkTexts = {
    3: `分段三：${'甲乙丙丁'.repeat(30)}`,
    4: `分段四：${'戊己庚辛'.repeat(30)}`,
};
const compressedPreview = (opts = {}) => niBuildFuturePlotPreview({
    stageIndices: [9],
    chunkIdxsByStage: { 9: new Set([3, 4]) },
    rawMode: 'compressed',
    getCompressedChunkText: chunkIdx => chunkTexts[chunkIdx] || '',
    maxTokens: 32000,
    ...opts,
});

check('D1 取该阶段涉及的全部清洗分段', () => {
    const preview = compressedPreview();
    assert.equal(preview.rawMode, 'compressed');
    assert.ok(preview.content.includes('分段三'));
    assert.ok(preview.content.includes('分段四'));
});
check('D2 被整块屏蔽的分段不出现', () => {
    const preview = compressedPreview({ blockedChunkIdxs: [3] });
    assert.ok(!preview.content.includes('分段三'));
    assert.ok(preview.content.includes('分段四'));
});
check('D3 没有分段数据 → 空内容', () => {
    const preview = niBuildFuturePlotPreview({
        stageIndices: [9],
        chunkIdxsByStage: {},
        rawMode: 'compressed',
        maxTokens: 32000,
    });
    assert.equal(preview.content, '');
});

// ---- E 组：接线核对 --------------------------------------------------------
console.log('\n[E] index.js / template.html 接线');
const indexSrc = readPlugin('index.js');
const templateSrc = readPlugin('template.html');

check('E1 默认设置里有关闭态的三项', () => {
    assert.ok(indexSrc.includes('futurePlotPreview: false'));
    assert.ok(indexSrc.includes('futurePlotStages: NI_FUTURE_PLOT_STAGE_DEFAULT'));
    assert.ok(indexSrc.includes('futurePlotNodes: NI_FUTURE_PLOT_NODES_DEFAULT'));
});
check('E2 注入点在阶段直注之后、角色人设之前', () => {
    const injectIdx = indexSrc.indexOf('${EXT_NAME}_future_plot');
    const stageIdx = indexSrc.indexOf('niUpdateStageInjectionBudgetNote(result, { visible: true })');
    const charaIdx = indexSrc.indexOf('// ③ 角色人设注入');
    assert.ok(injectIdx > 0, '没有未来剧情注入调用');
    assert.ok(stageIdx > 0 && injectIdx > stageIdx);
    assert.ok(charaIdx > 0 && injectIdx < charaIdx);
});
check('E3 开关与两个数字输入的处理器都在', () => {
    assert.ok(indexSrc.includes("'#ni-stage-future-inject'"));
    assert.ok(indexSrc.includes("'#ni-future-stages, #ni-future-nodes'"));
});
check('E4 设置面板有开关和两个输入框', () => {
    assert.ok(templateSrc.includes('id="ni-stage-future-inject"'));
    assert.ok(templateSrc.includes('id="ni-future-stages"'));
    assert.ok(templateSrc.includes('id="ni-future-nodes"'));
});
check('E5 说明文案会跟着状态变', () => {
    assert.ok(indexSrc.includes('niUpdateFuturePlotUI'));
    assert.ok(indexSrc.includes('ni-stage-future-note'));
});
check('E6 打开阶段页会按当前阶段重算按钮与说明', () => {
    const switchIdx = indexSrc.indexOf('function niSwitchPage(');
    assert.ok(switchIdx > 0, '找不到 niSwitchPage');
    const body = indexSrc.slice(switchIdx, switchIdx + 800);
    assert.ok(/name === 'stage'[\s\S]{0,200}niUpdateVecOffBtn\(\)/.test(body), '阶段页打开时没有刷新');
});

// ---- F 组：当前阶段也纳入预告 ----------------------------------------------
// 没开「当前阶段全量直注」时，当前阶段只发已经演到的节点，剩下的节点 AI 看不到，
// 最容易写偏。所以预告支持把当前阶段也带上，从「正在演的那个节点」之后开始。
console.log('\n[F] 当前阶段剩下的剧情也算进预告');
check('F1 勾选后当前阶段排在最前面，后面阶段照旧', () => {
    assert.deepEqual(
        stagesOf({ stageCount: 12, currentStageIdx: 8, stageLimit: 1, includeCurrentStage: true }),
        [8, 9],
    );
});
check('F2 「往后几个阶段」只数后面的阶段，不占当前阶段名额', () => {
    assert.deepEqual(
        stagesOf({ stageCount: 12, currentStageIdx: 8, stageLimit: 3, includeCurrentStage: true }),
        [8, 9, 10, 11],
    );
});
check('F3 往后填 0 + 勾当前阶段 = 只预告当前阶段剩下的剧情', () => {
    assert.deepEqual(
        stagesOf({ stageCount: 12, currentStageIdx: 8, stageLimit: 0, includeCurrentStage: true }),
        [8],
    );
    // 不勾当前阶段 + 往后 0 = 关闭，什么都不发
    assert.deepEqual(stagesOf({ stageCount: 12, currentStageIdx: 8, stageLimit: 0 }), []);
});
check('F4 已经是最后一个阶段时，当前阶段仍然能预告', () => {
    assert.deepEqual(
        stagesOf({ stageCount: 12, currentStageIdx: 12, stageLimit: 3, includeCurrentStage: true }),
        [12],
    );
});
check('F5 当前阶段被关闭 / 被整段屏蔽时不纳入', () => {
    assert.deepEqual(
        stagesOf({ stageCount: 12, currentStageIdx: 8, stageLimit: 1, includeCurrentStage: true, enabledStages: [9] }),
        [9],
    );
    assert.deepEqual(
        stagesOf({ stageCount: 12, currentStageIdx: 8, stageLimit: 1, includeCurrentStage: true, blockedStageIdxs: [8] }),
        [9],
    );
});
check('F6 当前阶段从「正在演的节点」之后开始取，不重复发已演过的', () => {
    const preview = niBuildFuturePlotPreview({
        stageIndices: [9],
        nodesByStage: NODES,
        nodesPerStage: 0,
        maxTokens: 32000,
        currentStageIdx: 9,
        startAfterNodeId: 'n9a',
    });
    assert.ok(preview.content.includes('接下来会发生的剧情'), '当前阶段要用单独的标题');
    assert.ok(!preview.content.includes('节点9A'), '已演过的节点不能重复发');
    const rest = niMergeStageNodes(NODES[9]).slice(1).map(plot => plot.title);
    assert.equal(preview.nodeCount, rest.length);
    rest.forEach(title => assert.ok(preview.content.includes(title)));
});
check('F7 不知道演到哪个节点时，从当前阶段第一个节点开始（且全部发）', () => {
    const preview = niBuildFuturePlotPreview({
        stageIndices: [9],
        nodesByStage: NODES,
        nodesPerStage: 1,
        maxTokens: 32000,
        currentStageIdx: 9,
    });
    const all = niMergeStageNodes(NODES[9]);
    const first = all[0].title;
    // 「每阶段几个节点」只约束往后的阶段，当前阶段剩下的节点要全部发出去。
    assert.equal(preview.nodeCount, all.length);
    assert.ok(preview.content.includes(first));
});
check('F8 锚点节点找不到时跳过当前阶段，不把已演过的节点当预告重发', () => {
    const preview = niBuildFuturePlotPreview({
        stageIndices: [9],
        nodesByStage: NODES,
        nodesPerStage: 1,
        maxTokens: 32000,
        currentStageIdx: 9,
        startAfterNodeId: '不存在的节点',
    });
    // 旧行为是「找不到就退回首节点」，等于把已经演过的剧情当未来剧情再发一遍。
    assert.equal(preview.nodeCount, 0);
    assert.equal(preview.content, '');
    assert.equal(preview.anchorMissing, true);
});
check('F8b 锚点失效只影响当前阶段，后面的阶段照发', () => {
    const preview = niBuildFuturePlotPreview({
        stageIndices: [9, 10],
        nodesByStage: NODES,
        nodesPerStage: 0,
        maxTokens: 32000,
        currentStageIdx: 9,
        startAfterNodeId: '不存在的节点',
    });
    assert.ok(!preview.content.includes('节点9A'), '当前阶段整段跳过');
    assert.ok(preview.content.includes('节点10A'), '后续阶段不受影响');
    assert.deepEqual(preview.stageIndices, [10]);
    assert.equal(preview.anchorMissing, true);
});
check('F9 「每阶段几个节点」不再截断当前阶段', () => {
    const preview = niBuildFuturePlotPreview({
        stageIndices: [9],
        nodesByStage: NODES,
        nodesPerStage: 1,
        maxTokens: 32000,
        currentStageIdx: 9,
        startAfterNodeId: 'n9a',
    });
    // 以前这里会被 nodesPerStage 截成 1 个，等于本阶段剩下的还没发完就轮到下一阶段。
    assert.equal(preview.nodeCount, niMergeStageNodes(NODES[9]).length - 1);
});
check('F10 后面阶段不受「当前阶段」逻辑影响', () => {
    const preview = niBuildFuturePlotPreview({
        stageIndices: [9, 10],
        nodesByStage: NODES,
        nodesPerStage: 0,
        maxTokens: 32000,
        currentStageIdx: 9,
        startAfterNodeId: 'n9a',
    });
    assert.ok(preview.content.includes('节点10A'));
    assert.ok(preview.content.includes('【第 10 阶段】'), '后面阶段用普通标题');
});
check('F11 接线：默认开启、勾选框、从当前节点之后取', () => {
    assert.ok(indexSrc.includes('futurePlotIncludeCurrent: true'), '默认应该是开启的');
    assert.ok(indexSrc.includes('niIsFuturePlotIncludeCurrent'));
    assert.ok(indexSrc.includes("'#ni-future-include-cur'"), '缺少勾选框的事件绑定');
    // 穿书模式按当前节点之后取；普通模式按「进度锚点」里指定的节点之后取，没设锚点才从头取
    assert.ok(indexSrc.includes('? niPlotNodeId(plan.curTbNode)'));
    assert.ok(indexSrc.includes('niGetProgressAnchorNodeId(cfg)'), '普通模式没接进度锚点');
    assert.ok(templateSrc.includes('id="ni-future-include-cur"'));
    assert.ok(templateSrc.includes('当前阶段也算'));
    // 当前阶段已经整段发过时不能再塞进预告（全量直注 / 未向量阶段整阶段注入）
    assert.ok(indexSrc.includes('niIsCurrentStageAlreadyFullyInjected'));
    assert.ok(indexSrc.includes('&& !niIsCurrentStageAlreadyFullyInjected(plan, cfg)'));
});

// ---- G 组：当前阶段优先（「每阶段 N 个」只管后面的阶段）---------------------
// 用户场景：当前阶段还剩 8 个节点、每阶段设 4 —— 以前当前阶段也被截成 4 个，剩下的
// 4 个没发出去就直接轮到下一阶段，本阶段后半段模型反而看不到。现在当前阶段剩下的
// 节点全部下发，只有总 Token 预算能拦住它。
console.log('\n[G] 当前阶段优先：每阶段 N 个只约束后面的阶段');
const wideStage = (stageIdx, count, bodyLen = 8) => ({
    main: Array.from({ length: count }, (_, i) => makePlot(
        `w${stageIdx}-${i + 1}`,
        `节点${stageIdx}-${i + 1}`,
        // 默认短正文；G2 用长正文把预算顶过 256 Token 的下限，才能测「装不下」。
        `正文${stageIdx}-${i + 1}`.padEnd(bodyLen, '。'),
    )),
    sub: [],
    pivot: [],
});
const WIDE = { 12: wideStage(12, 8), 13: wideStage(13, 6) };
const WIDE_LONG = { 12: wideStage(12, 8, 130), 13: wideStage(13, 6, 130) };

check('G1 当前阶段 8 个节点、每阶段设 4 → 当前阶段 8 个全发，后面阶段仍取 4 个', () => {
    const preview = niBuildFuturePlotPreview({
        stageIndices: [12, 13],
        nodesByStage: WIDE,
        nodesPerStage: 4,
        maxTokens: 32000,
        currentStageIdx: 12,
    });
    assert.equal(preview.sections[0].lines.length, 8, '当前阶段不能被「每阶段 4 个」截断');
    assert.equal(preview.sections[1].lines.length, 4, '后面的阶段照旧取前 N 个');
    assert.equal(preview.nodeCount, 12);
    assert.equal(preview.nodesPerStage, 4);
    assert.equal(preview.currentStageNodesPerStage, 0);
    assert.equal(preview.truncated, false);
});

check('G2 预算不够时先保住当前阶段，后面的阶段整段不发', () => {
    const base = {
        nodesByStage: WIDE_LONG,
        nodesPerStage: 4,
        currentStageIdx: 12,
        startAfterNodeId: 'w12-1',
    };
    const currentOnly = niBuildFuturePlotPreview({ ...base, stageIndices: [12], maxTokens: 32000 });
    const tokens = Math.ceil((currentOnly.text.length + 12) / 1.5);
    const preview = niBuildFuturePlotPreview({ ...base, stageIndices: [12, 13], maxTokens: tokens });
    assert.equal(preview.sections.length, 1);
    assert.deepEqual(preview.stageIndices, [12]);
    assert.equal(preview.truncated, true);
    assert.equal(preview.sections[0].lines.length, 7, '当前阶段剩下的 7 个节点先发完');
});

check('G3 仍可显式限制当前阶段（currentStageNodesPerStage）', () => {
    const preview = niBuildFuturePlotPreview({
        stageIndices: [12],
        nodesByStage: WIDE,
        nodesPerStage: 4,
        currentStageNodesPerStage: 2,
        maxTokens: 32000,
        currentStageIdx: 12,
        startAfterNodeId: 'w12-1',
    });
    assert.equal(preview.sections[0].lines.length, 2);
    assert.equal(preview.currentStageNodesPerStage, 2);
});

check('G4 接线：payload 传 0、面板文案说明只约束后面阶段', () => {
    assert.ok(indexSrc.includes('currentStageNodesPerStage: 0'), 'payload 没把当前阶段设成全部');
    assert.ok(indexSrc.includes('阶段剩下的全部节点（优先）'), '说明文案没写当前阶段优先');
    assert.ok(templateSrc.includes('往后每阶段'), '输入框标签没说明只约束后面的阶段');
});

// ---- 汇总 ------------------------------------------------------------------
console.log('\n========================================');
if (bugCount) {
    console.log(`发现 ${bugCount} 处问题：`);
    failures.forEach(({ label, error }) => {
        console.log(`\n✗ ${label}`);
        console.log(error.stack);
    });
    process.exitCode = 1;
} else {
    console.log('全部通过：未来剧情预告 0 BUG');
}
