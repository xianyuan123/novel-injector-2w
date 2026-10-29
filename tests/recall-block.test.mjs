/**
 * 召回屏蔽（一键屏蔽 / 一键解除屏蔽 / 多选节点）—— 回归测试
 *
 * 场景：玩第八阶段时，屏蔽第八阶段之前某个阶段的某个节点或整个阶段，
 * 期望：被屏蔽的节点/阶段不再被向量召回，也不再进阶段直注；
 *       同一源分段里还有未屏蔽节点时，这一块要保留（不能误伤）。
 *
 * 跑法： node tests/recall-block.test.mjs
 */
import assert from 'node:assert/strict';
// selectRecallTexts 是模块内部闭包函数（没有 export），所以按真实调用链测：
// 用导出的 createVectorRecallService 组装出召回服务，喂假向量行，看屏蔽是否生效。
import { readFileSync } from 'node:fs';
import { PLUGIN_ROOT, readPlugin } from './_paths.mjs';
import {
    createVectorRecallService,
    isVectorRowCompatible,
    niResolveVectorRecallStageScopes,
} from '../lib/vector-system.js';
import {
    niBuildBlockedRecallContext,
    niExcludeBlockedStageIndices,
    niMergeStageNodes,
    niNormalizeRecallBlockFlags,
    niPlotNodeId,
} from '../lib/story-data.js';
import {
    niResolveFullStageInjectionPlan,
    niResolveStageInjectionPlan,
} from '../lib/injection-system.js';

// selectRecallTexts 是模块内部闭包函数（没有 export）。复制一份打补丁的临时副本再 import
// 会失败——这个函数是闭包内的，不能 export。改为按真实调用链测：用导出的
// createVectorRecallService 组装召回服务，喂假向量行，看屏蔽是否生效。

let bugCount = 0;
const failures = [];
async function check(label, fn) {
    try {
        await fn();
        console.log(`  ok   ${label}`);
    } catch (e) {
        bugCount++;
        failures.push(label);
        console.log(`  BUG  ${label}`);
        console.log(`       ${e.message.split('\n').slice(0, 4).join('\n       ')}`);
    }
}
const checkSync = (label, fn) => check(label, () => fn());
function group(title) {
    console.log(`\n== ${title} ==`);
}

// ---------------------------------------------------------------- 场景构造
// 阶段 1~8 全部开启、全部已向量；玩到第 8 阶段。
// 节点归属：chunk 0 -> 阶段1 两个节点（A1/A2）；chunk 1 -> 阶段1 一个节点（B1）；
//          chunk 2 -> 阶段2 一个节点（C1）……每个 sourceChunkIdx 对应一个向量块。
function makePlot(type, order, chunkIdx, title) {
    return {
        _type: type,
        type,
        _chunkIdx: chunkIdx,
        chunk_index: chunkIdx,
        _chunkOrder: order,
        title,
        body: `${title} 的正文`,
        stageIdx: chunkIdx + 1,
    };
}
function makeStageNodes() {
    return {
        1: { main: [makePlot('main', 0, 0, '节点A1'), makePlot('main', 1, 0, '节点A2')], sub: [], pivot: [] },
        2: { main: [makePlot('main', 0, 1, '节点B1')], sub: [], pivot: [] },
        3: { main: [makePlot('main', 0, 2, '节点C1')], sub: [], pivot: [] },
        4: { main: [makePlot('main', 0, 3, '节点D1')], sub: [], pivot: [] },
        5: { main: [makePlot('main', 0, 4, '节点E1')], sub: [], pivot: [] },
        6: { main: [makePlot('main', 0, 5, '节点F1')], sub: [], pivot: [] },
        7: { main: [makePlot('main', 0, 6, '节点G1')], sub: [], pivot: [] },
        8: { main: [makePlot('main', 0, 7, '节点H1')], sub: [], pivot: [] },
    };
}
const STAGE_NODES = makeStageNodes();
const allEntries = Object.values(STAGE_NODES)
    .flatMap(nodes => niMergeStageNodes(nodes));

const nodeIdOf = title => {
    const plot = allEntries.find(entry => entry.title === title);
    assert.ok(plot, `找不到节点 ${title}`);
    return niPlotNodeId(plot);
};
const CHUNK_OF = {};
allEntries.forEach(entry => { CHUNK_OF[entry.title] = Number(entry._chunkIdx); });

const enabledStages = [1, 2, 3, 4, 5, 6, 7, 8];
const stageVecDone = Object.fromEntries(enabledStages.map(i => [i, true]));

function resolvePlan(settings) {
    const { rawStages } = niResolveStageInjectionPlan({ enabledStages, stageVecDone, settings });
    const vectorRecallScope = niResolveVectorRecallStageScopes({
        enabledStages,
        stageVecDone,
        currentStageIdx: 8,
    });
    return niResolveFullStageInjectionPlan({
        plan: { enabledStages, directStageInjectionStages: rawStages },
        vectorRecallScope,
        enabled: settings.curStageFullInject === true,
        currentStageIdx: 8,
        settings,
        explicitPlotEntries: allEntries,
    });
}

// ---------------------------------------------------------------- A. 上下文
group('A. niBuildBlockedRecallContext 判定');
check('空设置 -> 未激活，且不误判任何节点', () => {
    const ctx = niBuildBlockedRecallContext({});
    assert.equal(ctx.active, false);
    assert.equal(ctx.isNodeBlocked(allEntries[0]), false);
    assert.equal(ctx.isStageBlocked(3), false);
});
check('兼容 Set / 数组 / 对象三种写法', () => {
    assert.deepEqual(niNormalizeRecallBlockFlags(new Set(['a', 'b'])), { a: true, b: true });
    assert.deepEqual(niNormalizeRecallBlockFlags(['a', '']), { a: true });
    assert.deepEqual(niNormalizeRecallBlockFlags({ a: true, b: false }), { a: true });
    assert.deepEqual(niNormalizeRecallBlockFlags(null), {});
});
check('按 _nodeId 命中屏蔽节点', () => {
    const ctx = niBuildBlockedRecallContext({ blockedRecallNodes: { [nodeIdOf('节点B1')]: true } });
    assert.equal(ctx.isNodeBlocked(allEntries.find(e => e.title === '节点B1')), true);
    assert.equal(ctx.isNodeBlocked(allEntries.find(e => e.title === '节点A1')), false);
});
check('按阶段号命中整段屏蔽（非法阶段号不生效）', () => {
    const ctx = niBuildBlockedRecallContext({ blockedRecallStages: { 3: true, 0: true, abc: true } });
    assert.equal(ctx.isStageBlocked(3), true);
    assert.equal(ctx.isStageBlocked(4), false);
    assert.equal(ctx.isStageBlocked(0), false);
    assert.equal(ctx.stageIdxSet.size, 1);
});
check('niExcludeBlockedStageIndices 只摘掉被屏蔽的阶段', () => {
    const ctx = niBuildBlockedRecallContext({ blockedRecallStages: { 3: true } });
    assert.deepEqual(niExcludeBlockedStageIndices([1, 2, 3, 4], ctx), [1, 2, 4]);
    assert.deepEqual(niExcludeBlockedStageIndices(['2', 3, 'x', 0], ctx), [2]);
});

// ---------------------------------------------------------------- B. 块归属
group('B. 节点 -> 源分段 的整块屏蔽判定');
check('只屏蔽 chunk 里的一个节点时，该块保留（不误伤同块其他节点）', () => {
    const ctx = niBuildBlockedRecallContext({ blockedRecallNodes: { [nodeIdOf('节点A1')]: true } });
    const blocked = ctx.collectFullyBlockedChunkIdxs(allEntries);
    assert.equal(blocked.has(CHUNK_OF['节点A1']), false, 'A1 与 A2 同块，不该整块屏蔽');
});
check('屏蔽 chunk 里的全部节点时，该块被屏蔽', () => {
    const ctx = niBuildBlockedRecallContext({
        blockedRecallNodes: { [nodeIdOf('节点A1')]: true, [nodeIdOf('节点A2')]: true },
    });
    const blocked = ctx.collectFullyBlockedChunkIdxs(allEntries);
    assert.equal(blocked.has(CHUNK_OF['节点A1']), true);
    assert.deepEqual([...blocked], [CHUNK_OF['节点A1']]);
});
check('独占一个 chunk 的节点被屏蔽时，该块整体屏蔽', () => {
    const ctx = niBuildBlockedRecallContext({ blockedRecallNodes: { [nodeIdOf('节点B1')]: true } });
    const blocked = ctx.collectFullyBlockedChunkIdxs(allEntries);
    assert.deepEqual([...blocked], [CHUNK_OF['节点B1']]);
});
check('整段屏蔽时该阶段占用的块全部屏蔽', () => {
    const ctx = niBuildBlockedRecallContext({ blockedRecallStages: { 1: true, 3: true } });
    const blocked = [...ctx.collectFullyBlockedChunkIdxs(allEntries)].sort((a, b) => a - b);
    assert.deepEqual(blocked, [CHUNK_OF['节点A1'], CHUNK_OF['节点C1']]);
});
check('没有屏蔽项时不做任何块过滤', () => {
    const ctx = niBuildBlockedRecallContext({});
    assert.equal(ctx.collectFullyBlockedChunkIdxs(allEntries).size, 0);
});

// ---------------------------------------------------------------- C. 注入方案
group('C. 注入方案：屏蔽后的召回池与直注');
check('屏蔽整个阶段后，该阶段从前情池移除（当前池本来就只放当前阶段）', () => {
    const result = resolvePlan({ blockedRecallStages: { 3: true } });
    assert.equal(result.vectorRecallScope.historicalStages.includes(3), false);
    assert.equal(result.vectorRecallScope.historicalStages.includes(2), true);
    assert.equal(result.vectorRecallScope.historicalStages.includes(4), true);
});
check('屏蔽的正是当前阶段时，当前池也会摘掉它', () => {
    const result = resolvePlan({ blockedRecallStages: { 8: true } });
    assert.equal(result.vectorRecallScope.currentStages.includes(8), false);
});
check('屏蔽节点 -> blockedChunkIdxs 带上对应源分段', () => {
    const result = resolvePlan({ blockedRecallNodes: { [nodeIdOf('节点B1')]: true } });
    assert.deepEqual(result.blockedChunkIdxs, [CHUNK_OF['节点B1']]);
    assert.equal(result.blockedRecallContext.active, true);
});
check('未屏蔽时 blockedChunkIdxs 为空，召回池与改动前一致', () => {
    const result = resolvePlan({});
    assert.deepEqual(result.blockedChunkIdxs, []);
    assert.deepEqual(result.vectorRecallScope.currentStages, [8]);
    assert.deepEqual(result.vectorRecallScope.historicalStages, [1, 2, 3, 4, 5, 6, 7]);
});
check('全量直注开关不受影响：直注阶段仍是 8', () => {
    const result = resolvePlan({ curStageFullInject: true, blockedRecallStages: { 3: true } });
    assert.deepEqual(result.directStageInjectionStages, [8]);
    assert.equal(result.fullInjectApplied, true);
    assert.equal(result.vectorRecallScope.historicalStages.includes(3), false);
});

// ---------------------------------------------------------------- D. 召回选择
group('D. 向量召回：被屏蔽的块不再被选中');
// 造一份「每个 chunk 一个向量块」的假向量表；查询向量与 chunk0 最相似，
// 若不屏蔽，topK=8 会把所有块都召回。
const rows = Object.entries(CHUNK_OF)
    // 每个标题只留一份，A1/A2 同块时取第一个
    .filter(([title], index, list) => list.findIndex(([, chunk]) => chunk === CHUNK_OF[title]) === index)
    .map(([title, chunkIdx]) => ({
        text: `【${title}】正文`,
        stageIdx: chunkIdx + 1,
        chunkIdx,
        sourceChunkIdx: chunkIdx,
        vector: [1, chunkIdx * 0.05, 0],
        dimension: 3,
    }));
const queryVector = [1, 0, 0];

// 组装真实召回服务：dbLoadByNovel 返回假向量行，其余依赖给最小实现。
const recallService = createVectorRecallService({
    getSettings: () => ({}),
    getState: () => ({
        novelKey: 'test-novel',
        stageStates: Object.fromEntries(enabledStages.map(i => [i, true])),
        // getEnabledStages 要求 stageVecDone 为真，缺了阶段会被全部过滤掉
        stageVecDone: Object.fromEntries(enabledStages.map(i => [i, true])),
    }),
    defaultSettings: {
        recallThresh: 0,
        recallTopK: 8,
        vecHistoryTopK: 8,
        vecKeepTopN: 0,
        vecInjMaxTokens: 200000,
    },
    dbLoadByNovel: async () => rows,
    cosineSim: (a, b) => {
        const dot = a.reduce((sum, value, i) => sum + value * (b[i] || 0), 0);
        const normA = Math.sqrt(a.reduce((sum, value) => sum + value * value, 0));
        const normB = Math.sqrt(b.reduce((sum, value) => sum + value * value, 0));
        return normA && normB ? dot / (normA * normB) : 0;
    },
    isVectorRowCompatible,
    embeddingClient: {
        // 引子必须变成真向量：返回 [] 会被判空，整轮召回直接空字符串
        niRequestEmbeddings: async inputs => inputs.map(() => [1, 0, 0]),
        embedText: async () => [1, 0, 0],
    },
    logger: { warn: () => {}, info: () => {}, log: () => {} },
});

// 注意：recallRelevantWeighted 返回的是拼好的文本字符串，不是对象。
async function recallText(opts) {
    return String(await recallService.recallRelevantWeighted(
        [{ text: '查询', weight: 1 }],
        enabledStages,
        {
            historicalStages: [],
            topK: 8,
            historyTopK: 8,
            keepTopN: 0,
            thresh: 0,
            maxTokens: 200000,
            historyMaxChars: 100000,
            ...opts,
        },
    ) || '');
}
const recalledTitles = text => Object.keys(CHUNK_OF).filter(title => text.includes(title));

check('不屏蔽时 8 个块全部可召回（对照）', async () => {
    const text = await recallText({});
    assert.deepEqual(recalledTitles(text).sort(), ['节点A1', '节点B1', '节点C1', '节点D1', '节点E1', '节点F1', '节点G1', '节点H1']);
});
check('屏蔽节点 -> 该节点正文不再出现在召回结果里', async () => {
    const text = await recallText({ excludeChunkIdxs: [CHUNK_OF['节点B1']] });
    assert.equal(text.includes('节点B1'), false);
    assert.equal(text.includes('节点A1'), true);
});
check('屏蔽阶段 -> 该阶段的块不进候选池，也不占 topK 名额', async () => {
    const text = await recallText({ excludeStageIdxs: [3] });
    assert.equal(text.includes('节点C1'), false);
    assert.equal(text.includes('节点B1'), true);
});
check('节点屏蔽与阶段屏蔽可叠加', async () => {
    const text = await recallText({
        excludeChunkIdxs: [CHUNK_OF['节点B1'], CHUNK_OF['节点G1']],
        excludeStageIdxs: [3],
    });
    assert.equal(text.includes('节点B1'), false);
    assert.equal(text.includes('节点C1'), false);
    assert.equal(text.includes('节点G1'), false);
    assert.equal(text.includes('节点D1'), true);
});
check('只屏蔽同块中的一个节点时，该块仍能召回（不误伤）', async () => {
    const ctx = niBuildBlockedRecallContext({ blockedRecallNodes: { [nodeIdOf('节点A1')]: true } });
    const blocked = [...ctx.collectFullyBlockedChunkIdxs(allEntries)];
    assert.deepEqual(blocked, [], '同块还有没被屏蔽的节点，不该屏蔽整块');
    const text = await recallText({ excludeChunkIdxs: blocked });
    assert.equal(text.includes('节点A1'), true);
});
check('没有 sourceChunkIdx 的老向量行按 chunkIdx 兜底屏蔽', async () => {
    const legacyService = createVectorRecallService({
        getSettings: () => ({}),
        getState: () => ({
            novelKey: 'legacy',
            stageStates: { 4: true },
            stageVecDone: { 4: true },
        }),
        defaultSettings: { recallThresh: 0, recallTopK: 4, vecHistoryTopK: 4, vecKeepTopN: 0, vecInjMaxTokens: 200000 },
        dbLoadByNovel: async () => [{
            text: '老数据块正文',
            stageIdx: 4,
            chunkIdx: 3,
            vector: [1, 0, 0],
        }],
        cosineSim: () => 1,
        isVectorRowCompatible,
        embeddingClient: {
            niRequestEmbeddings: async inputs => inputs.map(() => [1, 0, 0]),
            embedText: async () => [1, 0, 0],
        },
        logger: { warn: () => {}, info: () => {}, log: () => {} },
    });
    const normal = await legacyService.recallRelevantWeighted(
        [{ text: '查询', weight: 1 }],
        [4],
        { topK: 4, historyTopK: 4, thresh: 0, maxTokens: 200000 },
    );
    assert.ok(String(normal || '').includes('老数据块正文'), '不屏蔽时应能召回');
    const blocked = await legacyService.recallRelevantWeighted(
        [{ text: '查询', weight: 1 }],
        [4],
        { topK: 4, historyTopK: 4, thresh: 0, maxTokens: 200000, excludeChunkIdxs: [3] },
    );
    assert.equal(String(blocked || ''), '');
});

// ---------------------------------------------------------------- E. 接线核对
group('E. 源码接线核对');
const indexSrc = readPlugin('index.js');
const storySrc = readPlugin('lib/story-data.js');
const worldSrc = readPlugin('lib/world-system.js');
check('DEFAULT_SETTINGS 里有 blockedRecallNodes / blockedRecallStages', () => {
    assert.ok(/blockedRecallNodes:\s*\{\}/.test(indexSrc));
    assert.ok(/blockedRecallStages:\s*\{\}/.test(indexSrc));
});
check('注入方案把屏蔽后的 chunk 传给向量召回', () => {
    assert.ok(indexSrc.includes('excludeChunkIdxs: blockedRecallChunkIdxs'));
    assert.ok(indexSrc.includes('explicitPlotEntries: allNodes || getAllPlotsInStoryOrder(S)'));
});
check('阶段卡渲染带三个屏蔽按钮与多选', () => {
    ['stage-block', 'toggle-multi', 'apply-checked', 'unblock-all'].forEach(action => {
        assert.ok(storySrc.includes(`data-block-action="${action}"`), `缺少按钮 ${action}`);
    });
});
check('屏蔽操作会保存设置（否则刷新即丢）', () => {
    const fn = storySrc.slice(storySrc.indexOf('function niApplyBlockAction'));
    assert.ok(fn.slice(0, 2000).includes('niSaveSettings()'));
});
check('阶段直注（世界系统预览）也跳过被屏蔽的节点', () => {
    assert.ok(worldSrc.includes('niBuildBlockedRecallContext(extension_settings[EXT_NAME] || {})'));
    assert.ok(worldSrc.includes('blocked.isNodeBlocked(plot) && !blocked.isStageBlocked(si)') ||
        worldSrc.includes('!blocked.isNodeBlocked(plot) && !blocked.isStageBlocked(si)'));
});
check('style.css 有屏蔽样式', () => {
    const css = readPlugin('style.css');
    ['ni-stage-block-row', 'ni-node-blocked-tag', 'ni-pin-block-chk'].forEach(cls => {
        assert.ok(css.includes(`.${cls}`), `缺少样式 .${cls}`);
    });
});

console.log(`\n${bugCount === 0 ? 'PASS' : 'FAIL'}  断言失败 ${bugCount} 处`);
if (failures.length) console.log(`失败项：\n- ${failures.join('\n- ')}`);
process.exitCode = bugCount === 0 ? 0 : 1;
