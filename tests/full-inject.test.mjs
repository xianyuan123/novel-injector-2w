/**
 * 当前阶段全量直注 —— 回归测试
 *
 * 场景：第 1~8 阶段全部开启且全部已向量化，玩到第 8 阶段。
 * 期望：开着开关时，第 8 阶段整段直注（不裁剪、不召回），第 1~7 阶段仍然向量召回；
 *       关掉开关时，行为与改动前完全一致（第 8 阶段走召回，直注为空）。
 *
 * 跑法： node tests/full-inject.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    niBuildStageInjectionPayload,
    niBuildTransbookStageDetailText,
    niBuildTransbookWholeStageDetailText,
    niIsFullStageInjectionEnabled,
    niNormalizeRawInjectionMaxTokens,
    NI_FULL_STAGE_INJECTION_MAX_TOKENS,
    niResolveFullStageInjectionPlan,
    niResolveStageInjectionPlan,
} from '../lib/injection-system.js';
import {
    niBuildStageNodeVectorQuery as buildNodeQuery,
    niBuildWeightedVectorQueries,
    niResolveVectorRecallStageScopes,
} from '../lib/vector-system.js';
import { niBuildBlockedRecallContext } from '../lib/story-data.js';

let bugCount = 0;
const failures = [];
function check(label, fn) {
    try {
        fn();
        console.log(`  ok   ${label}`);
    } catch (e) {
        bugCount++;
        failures.push(label);
        console.log(`  BUG  ${label}`);
        console.log(`       ${e.message.split('\n').slice(0, 4).join('\n       ')}`);
    }
}
function group(title) {
    console.log(`\n== ${title} ==`);
}

// ---------------------------------------------------------------- 场景构造
const STAGE_COUNT = 8;
const CURRENT_STAGE = 8;
const enabledStages = [];
for (let i = 1; i <= STAGE_COUNT; i++) enabledStages.push(i);
const stageVecDone = {};
for (let i = 1; i <= STAGE_COUNT; i++) stageVecDone[i] = true;

function basePlan() {
    const { rawStages } = niResolveStageInjectionPlan({
        enabledStages,
        stageVecDone,
        settings: { vecInjDisabled: false },
    });
    return { enabledStages, rawStages, directStageInjectionStages: rawStages };
}
function baseScope() {
    return niResolveVectorRecallStageScopes({
        enabledStages,
        stageVecDone,
        currentStageIdx: CURRENT_STAGE,
    });
}

group('A. 关闭开关时行为不变（回归保护）');
check('方案原样返回，直注阶段仍为空', () => {
    const plan = basePlan();
    const scope = baseScope();
    const out = niResolveFullStageInjectionPlan({
        plan,
        vectorRecallScope: scope,
        enabled: false,
        currentStageIdx: CURRENT_STAGE,
    });
    assert.deepEqual(out.directStageInjectionStages, []);
    assert.equal(out.fullInjectApplied, false);
    assert.equal(out.fullInjectStageIdx, null);
    assert.deepEqual(out.vectorRecallScope.currentStages, [8]);
    assert.ok(!out.vectorRecallScope.historicalStages.includes(8));
});
check('开关读取只认 === true', () => {
    assert.equal(niIsFullStageInjectionEnabled({ curStageFullInject: true }), true);
    assert.equal(niIsFullStageInjectionEnabled({ curStageFullInject: 'true' }), false);
    assert.equal(niIsFullStageInjectionEnabled({}), false);
    assert.equal(niIsFullStageInjectionEnabled(undefined), false);
});

group('B. 开启开关 + 当前阶段第 8 阶段（核心场景）');
check('第 8 阶段进入直注，第 1~7 阶段留在召回池', () => {
    const plan = basePlan();
    const scope = baseScope();
    const out = niResolveFullStageInjectionPlan({
        plan,
        vectorRecallScope: scope,
        enabled: true,
        currentStageIdx: CURRENT_STAGE,
    });
    assert.deepEqual(out.directStageInjectionStages, [8], '应只直注第 8 阶段');
    assert.equal(out.fullInjectApplied, true);
    assert.equal(out.fullInjectStageIdx, 8);
    assert.deepEqual(out.vectorRecallScope.currentStages, [], '第 8 阶段不再走召回');
    assert.deepEqual(out.vectorRecallScope.historicalStages, [1, 2, 3, 4, 5, 6, 7], '前情池补齐 1~7');
});
check('当前阶段不再出现在召回范围里（不会重复注入）', () => {
    const out = niResolveFullStageInjectionPlan({
        plan: basePlan(),
        vectorRecallScope: baseScope(),
        enabled: true,
        currentStageIdx: CURRENT_STAGE,
    });
    const recallStages = [
        ...out.vectorRecallScope.currentStages,
        ...out.vectorRecallScope.historicalStages,
    ];
    assert.ok(!recallStages.includes(8), '第 8 阶段不得同时被召回');
    assert.deepEqual(out.vectorRecallScope.futureStages, [], '第 8 阶段之后没有阶段');
});
check('召回池按序号升序，不因补齐打乱', () => {
    const out = niResolveFullStageInjectionPlan({
        plan: basePlan(),
        vectorRecallScope: baseScope(),
        enabled: true,
        currentStageIdx: CURRENT_STAGE,
    });
    const list = out.vectorRecallScope.historicalStages;
    assert.deepEqual(list, [...list].sort((a, b) => a - b));
});
check('直注阶段列表也升序且不重复', () => {
    const out = niResolveFullStageInjectionPlan({
        plan: { ...basePlan(), directStageInjectionStages: [1, 5] },
        vectorRecallScope: baseScope(),
        enabled: true,
        currentStageIdx: CURRENT_STAGE,
    });
    assert.deepEqual(out.directStageInjectionStages, [1, 5, 8]);
});

group('C. 边界：开关开着但当前阶段没开启');
check('未开启的阶段不进直注，也不从召回池里挪走', () => {
    const scope = baseScope();
    const out = niResolveFullStageInjectionPlan({
        plan: { enabledStages: [1, 2, 3], directStageInjectionStages: [] },
        vectorRecallScope: scope,
        enabled: true,
        currentStageIdx: CURRENT_STAGE,
    });
    assert.equal(out.fullInjectApplied, false);
    assert.equal(out.fullInjectIdle, true, '要能提示「开关没生效」');
    assert.deepEqual(out.directStageInjectionStages, []);
    assert.deepEqual(out.vectorRecallScope.currentStages, scope.currentStages, '召回池原样返回');
});
check('currentStageIdx 缺失时退回方案边界阶段', () => {
    const scope = baseScope();
    const out = niResolveFullStageInjectionPlan({
        plan: { enabledStages, directStageInjectionStages: [], vectorRecallScope: scope },
        vectorRecallScope: scope,
        enabled: true,
        currentStageIdx: null,
    });
    assert.equal(out.fullInjectStageIdx, 8, '没有显式传入时用边界阶段');
    assert.equal(out.fullInjectApplied, true);
});
check('currentStageIdx 为 0 / NaN / 负数时明确不生效', () => {
    [0, NaN, -3].forEach(value => {
        const out = niResolveFullStageInjectionPlan({
            plan: { enabledStages, directStageInjectionStages: [] },
            vectorRecallScope: baseScope(),
            enabled: true,
            currentStageIdx: value,
        });
        assert.equal(out.fullInjectApplied, false, `currentStageIdx=${String(value)} 不该生效`);
        assert.equal(out.fullInjectIdle, true, '应能提示开关没生效');
    });
});
check('普通模式（无显式当前阶段）用最高开启阶段', () => {
    const scope = niResolveVectorRecallStageScopes({
        enabledStages,
        stageVecDone,
        currentStageIdx: null,
    });
    // 无显式当前节点时，普通模式把「最高开启阶段向前的连续开启区间」当当前窗口，
    // 本例 1~8 全开 → 整段都是当前窗口、前情池为空，这是改动前就有的语义。
    assert.equal(scope.boundaryStageIdx, 8);
    assert.equal(scope.currentWindowStart, 1);
    const out = niResolveFullStageInjectionPlan({
        plan: { enabledStages, directStageInjectionStages: [] },
        vectorRecallScope: scope,
        enabled: true,
        currentStageIdx: scope.boundaryStageIdx,
    });
    assert.equal(out.fullInjectStageIdx, 8, '无显式当前阶段时按最高开启阶段直注');
    assert.deepEqual(out.vectorRecallScope.currentStages, [1, 2, 3, 4, 5, 6, 7], '同窗口的 1~7 继续召回');
    assert.deepEqual(out.vectorRecallScope.historicalStages, [], '窗口外侧没有别的阶段');
    const recallStages = [
        ...out.vectorRecallScope.currentStages,
        ...out.vectorRecallScope.historicalStages,
    ];
    assert.ok(!recallStages.includes(8), '第 8 阶段不得留在召回池');
});

group('D. 注入内容：直注不裁剪、更早阶段仍召回');
const longDetail = '· 节点：' + '这是一段很长的剧情节点正文。'.repeat(400); // ~5200 字
const shortDetail = '【第 8 阶段剧情节点】\n· 节点A：正文A\n· 节点B：正文B';
check('整段直注用宽预算，不再吃「单轮最多 Token」的裁剪', () => {
    const cfgMax = 32000; // 默认值
    const payload = niBuildStageInjectionPayload({
        stageIndices: [8],
        currentStageIdx: 8,
        maxTokens: cfgMax,
        rawMode: 'nodes',
        fullInject: true,
        getDetailText: () => longDetail,
        getSummaryText: () => '',
    });
    assert.equal(payload.fullInject, true);
    assert.ok(payload.maxTokens >= NI_FULL_STAGE_INJECTION_MAX_TOKENS, '预算应放到宽上限');
    assert.equal(payload.configuredMaxTokens, cfgMax, '原始配置值要留着展示');
    assert.equal(payload.truncated, false, '5200 字不该被截断');
    assert.ok(payload.content.includes('正文'), '内容应在');
    assert.ok(!payload.content.includes('已达到'), '不该出现截断标记');
    assert.deepEqual(payload.detailStages, [8]);
});
check('没开开关时同样的内容会被 32000 Token 上限挡住（对照）', () => {
    const payload = niBuildStageInjectionPayload({
        stageIndices: [8],
        currentStageIdx: 8,
        maxTokens: 256, // 故意压到极小，模拟用户把上限调低
        rawMode: 'nodes',
        fullInject: false,
        getDetailText: () => longDetail,
        getSummaryText: () => '',
    });
    assert.equal(payload.fullInject, false);
    assert.equal(payload.truncated, true, '小预算下应被截断');
    assert.ok(payload.content.includes('已达到'), '应出现截断标记');
});
check('极长阶段在宽预算下仍会截断（兜底不失控）', () => {
    const huge = '· 节点：' + '这'.repeat(400000);
    const payload = niBuildStageInjectionPayload({
        stageIndices: [8],
        currentStageIdx: 8,
        maxTokens: 32000,
        rawMode: 'nodes',
        fullInject: true,
        getDetailText: () => huge,
        getSummaryText: () => '',
    });
    assert.equal(payload.truncated, true);
    assert.ok(payload.usedChars <= payload.charBudget, '不得超出字符预算');
    assert.ok(payload.usedChars > 200000, '宽预算应比原来宽松得多');
});
check('直注按阶段顺序拼接，当前阶段排在最前', () => {
    const payload = niBuildStageInjectionPayload({
        stageIndices: [1, 8],
        currentStageIdx: 8,
        maxTokens: 32000,
        rawMode: 'nodes',
        fullInject: true,
        getDetailText: si => `【第 ${si} 阶段剧情节点】\n· 节点${si}：正文${si}`,
        getSummaryText: () => '',
    });
    const first = payload.content.indexOf('第 1 阶段');
    const second = payload.content.indexOf('第 8 阶段');
    assert.ok(first >= 0 && second >= 0, '两个阶段都应在');
    assert.ok(first < second, '输出按阶段序号排序');
    assert.equal(payload.selected[0].stageIdx, 1, 'chronological 排序');
    assert.deepEqual(payload.detailStages, [1, 8]);
});
check('压缩原文模式下同样整段直注', () => {
    const payload = niBuildStageInjectionPayload({
        stageIndices: [8],
        currentStageIdx: 8,
        maxTokens: 32000,
        rawMode: 'compressed',
        fullInject: true,
        getDetailText: () => shortDetail,
        getSummaryText: () => '【第 8 阶段概括】\n概括文本',
    });
    assert.equal(payload.rawMode, 'compressed');
    assert.equal(payload.tag, '小说压缩原文');
    assert.ok(payload.content.startsWith('[小说压缩原文]'));
    assert.ok(payload.content.includes(shortDetail), '压缩原文应整段进入');
});

group('E. 召回查询仍覆盖当前阶段节点（直注不影响查询引子）');
check('规范化后的 scope 窗口仍包含第 8 阶段，查询引子不缩水', () => {
    const scope = baseScope();
    const out = niResolveFullStageInjectionPlan({
        plan: basePlan(),
        vectorRecallScope: scope,
        enabled: true,
        currentStageIdx: CURRENT_STAGE,
    });
    assert.equal(out.vectorRecallScope.currentWindowStart, 8);
    assert.equal(out.vectorRecallScope.boundaryStageIdx, 8);
    const nodes = [
        { title: '节点甲', body: '正文甲', stageIdx: 8 },
        { title: '节点乙', body: '正文乙', stageIdx: 8 },
    ];
    const query = buildNodeQuery(nodes, { maxNodes: 8, maxTextLength: 2600 });
    assert.ok(String(query).includes('节点甲'), '查询引子应包含当前阶段节点');
});
check('加权查询仍按最近消息构造', () => {
    const weighted = niBuildWeightedVectorQueries(['最新消息'], { nodeContext: '第8阶段·节点甲' });
    assert.ok(weighted.length >= 1);
    // 最新一条消息带数值权重，nodeContext 作为额外的高权重查询项单独加入。
    const texts = weighted.map(item => String(item.text));
    assert.ok(texts.includes('最新消息'), '最近消息应在查询里');
    assert.ok(texts.some(text => text.includes('节点甲')), 'nodeContext 应在查询里');
    const nodeItem = weighted.find(item => String(item.text).includes('节点甲'));
    assert.ok(Number(nodeItem.weight) >= 1, 'nodeContext 权重应不低于普通查询');
});

group('F. 上限常量');
check('宽预算是合法值且不小于默认单轮上限', () => {
    const wide = niNormalizeRawInjectionMaxTokens(NI_FULL_STAGE_INJECTION_MAX_TOKENS);
    assert.equal(wide, NI_FULL_STAGE_INJECTION_MAX_TOKENS);
    assert.equal(wide, 200000);
    assert.ok(wide > 32000);
});

// ---------------------------------------------------------------------------
// G/H 组对应 2026-10-17 用户反馈的两个问题：
//   「不是注入一个节点而是整个阶段」+「跟穿书模式冲突，注入一次你这个又注入一次」
// ---------------------------------------------------------------------------
const runtimeIndex = {
    nodesByStage: {
        8: {
            main: [
                { title: '节点一', body: '正文一' },
                { title: '节点二', body: '正文二' },
                { title: '节点三', body: '正文三' },
            ],
            sub: [{ title: '支线甲', body: '支线正文' }],
            pivot: [],
        },
    },
    chunkIdxsByStage: { 8: new Set([3, 1, 2]) },
};
const chunkTexts = { 1: '第一段原文', 2: '第二段原文', 3: '第三段原文' };
const getChunk = ci => chunkTexts[ci] || '';
const curTbNode = { stageIdx: 8, title: '节点一', body: '正文一', _chunkIdx: 2 };

group('G. 穿书模式 + 全量直注：发整个阶段，不再被收紧成当前节点');
check('nodes 模式列出该阶段全部节点（含当前节点之后的）', () => {
    const text = niBuildTransbookWholeStageDetailText(8, {
        rawMode: 'nodes',
        getCompressedChunkText: getChunk,
        runtimeIndex,
    });
    ['节点一', '节点二', '节点三', '支线甲'].forEach(title => {
        assert.ok(text.includes(title), `${title} 应在整阶段文本里`);
    });
    assert.ok(text.includes('【第 8 阶段剧情节点】'), '应带阶段标签');
    assert.ok(!text.includes('当前节点'), '不该是「当前节点」标签');
});
check('对照：旧的收紧版只发当前节点一个', () => {
    const text = niBuildTransbookStageDetailText(8, curTbNode, {
        rawMode: 'nodes',
        getCompressedChunkText: getChunk,
    });
    assert.ok(text.includes('节点一'), '当前节点应在');
    assert.ok(!text.includes('节点二'), '后续节点不该出现');
    assert.ok(text.includes('当前节点'), '应带「当前节点」标签');
});
check('compressed 模式取该阶段全部清洗分段且按顺序', () => {
    const text = niBuildTransbookWholeStageDetailText(8, {
        rawMode: 'compressed',
        getCompressedChunkText: getChunk,
        runtimeIndex,
    });
    assert.ok(text.includes('第一段原文') && text.includes('第二段原文') && text.includes('第三段原文'));
    assert.ok(text.indexOf('第一段原文') < text.indexOf('第二段原文'), '按分段序号排序');
    assert.ok(text.indexOf('第二段原文') < text.indexOf('第三段原文'), '按分段序号排序');
    assert.ok(text.includes('【第 8 阶段压缩原文】'));
});
check('阶段数据缺失时返回空串，交给上层退回单节点逻辑', () => {
    assert.equal(niBuildTransbookWholeStageDetailText(99, {
        rawMode: 'nodes',
        getCompressedChunkText: getChunk,
        runtimeIndex,
    }), '');
    assert.equal(niBuildTransbookWholeStageDetailText(0, {
        rawMode: 'nodes',
        getCompressedChunkText: getChunk,
        runtimeIndex,
    }), '');
    assert.equal(niBuildTransbookWholeStageDetailText(8, {
        rawMode: 'nodes',
        getCompressedChunkText: getChunk,
        runtimeIndex: { nodesByStage: { 8: { main: [], sub: [], pivot: [] } } },
    }), '');
});
check('不传 runtimeIndex 也不抛错', () => {
    assert.equal(niBuildTransbookWholeStageDetailText(8, { rawMode: 'nodes' }), '');
});

group('H. 穿书模式「当前节点」持续提示词不会重复注入（接线核对）');
const indexSource = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
check('index.js 里有判定函数且带三个必要条件', () => {
    assert.ok(/function niTbFullStageInjectionCoversCurrentNode\(\)/.test(indexSource), '缺判定函数');
    assert.ok(/niTbFullStageInjectionCoversCurrentNode\(\)[\s\S]{0,400}?transBookMode/.test(indexSource),
        '判定应受穿书模式约束');
    assert.ok(/niTbFullStageInjectionCoversCurrentNode\(\)[\s\S]{0,900}?fullStageInjectionWholeStageSent === true/.test(indexSource),
        '判定应要求「整阶段确实发出去了」');
});
check('持续提示词注入前会先判重并 return', () => {
    const anchor = indexSource.indexOf('niTbFullStageInjectionCoversCurrentNode())');
    const ongoing = indexSource.indexOf('_tb_ongoing`, ongoingContent');
    assert.ok(anchor > 0, '判定调用点不见了');
    assert.ok(ongoing > anchor, '判定必须在持续提示词注入之前');
    const between = indexSource.slice(anchor, anchor + 220);
    assert.ok(/return;/.test(between), '判定后应直接 return，跳过持续提示词');
});
check('直注取文优先走整阶段，再退回单节点', () => {
    const body = indexSource.slice(indexSource.indexOf('function niBuildStageInjectionPayloadForPlan'));
    const whole = body.indexOf('niBuildTransbookWholeStageDetailText');
    const single = body.indexOf('niBuildTransbookStageDetailText');
    assert.ok(whole > 0 && single > 0, '两个取文函数都应被调用');
    assert.ok(whole < single, '应先尝试整阶段，缺失才退回单节点');
    assert.ok(/fullStageInjectionWholeStageSent = true/.test(body), '成功发整阶段时要打标记');
    assert.ok(/plan\.fullStageInjectionWholeStageSent = false/.test(body), '每轮先复位标记');
});
check('没有向量数据时按钮隐藏、开启时提示穿书模式接管', () => {
    const ui = indexSource.slice(indexSource.indexOf('function niUpdateStageFullInjectUI'));
    assert.ok(/hasAnyVector \? '' : 'none'/.test(ui.slice(0, 1500)), '按钮可见性应按 hasAnyVector');
    assert.ok(/tbSuffix/.test(ui), '提示文案应区分穿书模式');
});

// ---------------------------------------------------------------------------
// I 组：召回屏蔽同样管住「阶段直注」——否则屏蔽了节点，整段直注还是会把它发出去
// ---------------------------------------------------------------------------
const blockedRuntimeIndex = {
    nodesByStage: {
        8: {
            main: [
                { _nodeId: 'main:0:1:aaaa', title: '节点一', body: '正文一' },
                { _nodeId: 'main:0:2:bbbb', title: '节点二', body: '正文二' },
                { _nodeId: 'main:0:3:cccc', title: '节点三', body: '正文三' },
            ],
            sub: [{ _nodeId: 'sub:0:0:dddd', title: '支线甲', body: '支线正文' }],
            pivot: [],
        },
    },
    chunkIdxsByStage: { 8: new Set([1, 2, 3]) },
};
const chunkTexts8 = { 1: '第一段原文', 2: '第二段原文', 3: '第三段原文' };
const getChunk8 = ci => chunkTexts8[ci] || '';

group('I. 阶段直注也要跳过被屏蔽的节点');
check('屏蔽单个节点：整阶段文本里不再有它，其余照发', () => {
    const blocked = niBuildBlockedRecallContext({
        blockedRecallNodes: { 'main:0:2:bbbb': true },
    });
    const text = niBuildTransbookWholeStageDetailText(8, {
        rawMode: 'nodes',
        getCompressedChunkText: getChunk8,
        runtimeIndex: blockedRuntimeIndex,
        blockedContext: blocked,
    });
    assert.ok(text.includes('节点一') && text.includes('节点三'), '未屏蔽节点应保留');
    assert.equal(text.includes('节点二'), false, '被屏蔽的节点不该出现在直注正文里');
    assert.ok(text.includes('支线甲'), '同阶段其他节点不受影响');
});
check('屏蔽整个阶段：该阶段直注文本为空', () => {
    const blocked = niBuildBlockedRecallContext({ blockedRecallStages: { 8: true } });
    const text = niBuildTransbookWholeStageDetailText(8, {
        rawMode: 'nodes',
        getCompressedChunkText: getChunk8,
        runtimeIndex: blockedRuntimeIndex,
        blockedContext: blocked,
    });
    assert.equal(text, '', '整段屏蔽时不该再发这个阶段的节点');
});
check('未屏蔽时输出与改动前一致（对照）', () => {
    const text = niBuildTransbookWholeStageDetailText(8, {
        rawMode: 'nodes',
        getCompressedChunkText: getChunk8,
        runtimeIndex: blockedRuntimeIndex,
    });
    ['节点一', '节点二', '节点三', '支线甲'].forEach(title => {
        assert.ok(text.includes(title), `${title} 应保留`);
    });
});
check('compressed 模式：整块被屏蔽的源分段不发', () => {
    const blocked = niBuildBlockedRecallContext({ blockedRecallNodes: { 'main:0:2:bbbb': true } });
    const text = niBuildTransbookWholeStageDetailText(8, {
        rawMode: 'compressed',
        getCompressedChunkText: getChunk8,
        runtimeIndex: blockedRuntimeIndex,
        blockedContext: blocked,
        blockedChunkIdxs: [2],
    });
    assert.ok(text.includes('第一段原文') && text.includes('第三段原文'), '其余分段照发');
    assert.equal(text.includes('第二段原文'), false, '被屏蔽的源分段不该发');
});
check('当前节点被屏蔽时，退回单节点取文不再输出它', () => {
    const blocked = niBuildBlockedRecallContext({ blockedRecallNodes: { 'main:0:1:aaaa': true } });
    const text = niBuildTransbookStageDetailText(8, { _nodeId: 'main:0:1:aaaa', stageIdx: 8, title: '节点一', body: '正文一' }, {
        rawMode: 'nodes',
        getCompressedChunkText: getChunk8,
        blockedContext: blocked,
    });
    assert.equal(text, null, '被屏蔽的当前节点不应被当成阶段取文来源');
});
check('index.js 的直注取文接上了屏蔽过滤', () => {
    const body = indexSource.slice(indexSource.indexOf('function niBuildStageInjectionPayloadForPlan'));
    assert.ok(/niBuildStageBlockedNodeFilter\(blockedRecallContext, si\)/.test(body), '节点列表要按屏蔽过滤');
    assert.ok(/niBuildStageBlockedNodeFilter/.test(indexSource.slice(0, indexSource.indexOf('function niBuildStageInjectionPayloadForPlan'))),
        '该函数必须从 story-data.js 引入');
    assert.ok(/blockedChunkIdxs/.test(body), '压缩原文模式要按被屏蔽的源分段过滤');
    assert.ok(/blockedRecallContext: fullStagePlan\.blockedRecallContext/.test(
        indexSource.slice(indexSource.indexOf('function niResolveStageInjectionExecutionPlan')),
    ), '方案里要带出屏蔽上下文');
});

console.log(`\n===== 结果：${bugCount === 0 ? '0 BUG' : bugCount + ' BUG'} =====`);
if (bugCount) {
    console.log('失败项：');
    failures.forEach(label => console.log(` - ${label}`));
    process.exit(1);
}
