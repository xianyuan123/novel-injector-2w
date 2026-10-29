// Novel Injector — 本轮「健壮性 / 体验 / 性能」改动的回归测试
// 覆盖：上下文注入的作用域 bug、上传前的确认、可停止的长时间任务、
//       导出反馈、两处搜索、以及几条「每条消息都会跑」的高频路径优化。
import assert from 'node:assert/strict';
import { readPlugin, pluginUrl } from './_paths.mjs';
import { cosineSim, createEmbeddingClient } from '../lib/vector-system.js';

const idx = readPlugin('index.js');
const tmpl = readPlugin('template.html');
const cleaning = readPlugin('lib/cleaning-system.js');
const vec = readPlugin('lib/vector-system.js');
const storage = readPlugin('lib/storage-system.js');
const story = readPlugin('lib/story-data.js');
const world = readPlugin('lib/world-system.js');
const transbook = readPlugin('lib/transbook-system.js');

let pass = 0, fail = 0;
const problems = [];
function check(name, fn) {
    try {
        const result = fn();
        if (result && typeof result.then === 'function') throw new Error('异步检查请用 checkAsync');
        pass++; console.log(`  ok   ${name}`);
    } catch (e) { fail++; problems.push(`- ${name}: ${e.message}`); console.log(`  FAIL ${name} :: ${e.message}`); }
}
async function checkAsync(name, fn) {
    try { await fn(); pass++; console.log(`  ok   ${name}`); }
    catch (e) { fail++; problems.push(`- ${name}: ${e.message}`); console.log(`  FAIL ${name} :: ${e.message}`); }
}
function slice(src, start, end) {
    const a = src.indexOf(start);
    if (a < 0) throw new Error(`找不到起点 ${start}`);
    const b = end ? src.indexOf(end, a) : -1;
    return src.slice(a, b < 0 ? undefined : b);
}

// 动态 import 的模块路径要么被用过，要么至少能被解析（避免拼错路径的假绿）。
await import(pluginUrl('lib/vector-system.js'));

console.log('A. 上下文注入（每轮都跑的那条链）');
check('A1 人设注入传的是 stageInjectionPlan，不是不存在的 plan', () => {
    assert.ok(idx.includes('niBuildCharInjectionText(stageInjectionPlan)'));
    assert.ok(!idx.includes('niBuildCharInjectionText(plan)'));
});
check('A2 prompt-ready 的 Promise 有 catch，异常会进运行记录而不是静默', () => {
    const block = slice(idx, 'eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY', '// ── onPromptReady 补丁');
    assert.ok(/\.catch\(/.test(block), '没包 catch');
    assert.ok(block.includes('niLogIssue'), '失败没记进运行记录');
});
check('A3 onPromptReady 只建一次剧情索引，然后往下传', () => {
    // 只切 onPromptReady 这一个函数体：从函数声明到下一个顶格 `}` 为止。
    // （以前切到「补丁」注释，文件里往后新增的顶层函数会被误算进来。）
    const startAt = idx.indexOf('async function onPromptReady');
    assert.ok(startAt >= 0, '找不到 onPromptReady');
    const endAt = idx.indexOf('\n}\n', startAt);
    assert.ok(endAt > startAt, '定位不到函数结尾');
    const fn = idx.slice(startAt, endAt + 3);
    assert.ok(fn.includes('const allPlotNodes = getAllPlotsInStoryOrder(S);'));
    assert.ok(fn.indexOf('const allPlotNodes') < fn.indexOf('niResolveStageInjectionExecutionPlan'),
        '索引在计划之后才算，等于没省');
    assert.ok(fn.includes('niResolveStageInjectionExecutionPlan(cfg, { allNodes: allPlotNodes })'));
    assert.ok(fn.includes('{ allNodes: allPlotNodes }'), '召回没复用节点');
    assert.ok(fn.includes('getStageRuntimeIndex()'), '阶段索引没懒加载复用');
    assert.equal((fn.match(/getAllPlotsInStoryOrder\(S\)/g) || []).length, 1, '节点被重建多次');
    assert.equal((fn.match(/niBuildStageRuntimeIndex\(S\)/g) || []).length, 1, '运行时索引被建了多次');
});
check('A4 三个构造函数都支持外部传入，不传时行为不变', () => {
    assert.ok(/function niResolveStageInjectionExecutionPlan\(cfg = [^,]+, \{ allNodes = null \} = \{\}\)/.test(idx));
    assert.ok(idx.includes('function niBuildVectorRecallInputs(plan, chat = [], { allNodes = null } = {})'));
    assert.ok(idx.includes('{ runtimeIndex: precomputedIndex = null } = {}'));
    assert.ok(idx.includes('precomputedIndex || niBuildStageRuntimeIndex(S)'));
    assert.ok(transbook.includes('function niGetTbNodes(sourceNodes = null)'));
});
check('A5 /script.js 只解析一次，热路径不再逐条 import', () => {
    assert.ok(idx.includes('function niLoadScriptModule()'));
    assert.ok(idx.includes("_niScriptModulePromise = import('/script.js')"));
    assert.ok(!idx.includes("await import('/script.js')"), '还有裸的动态 import');
});

console.log('B. 会丢数据 / 会以为卡死的操作');
check('B1 上传新文件前有确认，且取消时清空 file input', () => {
    const block = slice(cleaning, 'const hasExistingWork', 'niResetNovelWorkspace();');
    assert.ok(block.includes('confirm('), '没有确认弹窗');
    assert.ok(block.includes('无法撤销'), '没说明后果');
    assert.ok(block.includes('inputEl.value'), '取消后没清空 input');
    assert.ok(cleaning.includes('function niApplyFile(f, inputEl = null)'));
    assert.ok(cleaning.includes('niApplyFile(f, inp)'));
});
check('B2 向量化可以中途停下，且不会把半截阶段标成已向量', () => {
    assert.ok(vec.includes('function niRequestVecStop()'));
    assert.ok(vec.includes('niRequestVecStop,'), '没导出给 index.js');
    assert.ok(vec.includes('if (_vecStopRequested) break;'));
    assert.ok(vec.includes("q('#ni-btn-vec-stop')"), '停止按钮没接');
    const at = vec.indexOf('if (_vecStopRequested) {');
    assert.ok(at > 0, '没有停止后的收尾分支');
    const stopBlock = vec.slice(at, at + 1600);
    assert.ok(stopBlock.includes('delete S.stageVecDone[Number(si)]'), '停下却保留了「已向量」标记');
    assert.ok(tmpl.includes('id="ni-btn-vec-stop"'));
    assert.ok(idx.includes("$app.on('click', '#ni-btn-vec-stop'"));
});
check('B3 阶段概括可以取消（再点一次即停）', () => {
    assert.ok(story.includes('_genStagesAbortController'));
    assert.ok(story.includes('_genStagesAbortController.abort()'), '没有真正 abort');
    assert.ok(story.includes('{ signal: controller.signal }'), '请求没带 signal');
    assert.ok(story.includes('已取消'));
    assert.ok(!/if \(_genStagesRunning\) return;/.test(story), '还留着「运行中直接 return」的老行为');
});
check('B4 导出 ZIP 有禁用、进度、结果提示', () => {
    assert.ok(storage.includes('_niExportRunning'), '没有防连点');
    assert.ok(storage.includes('niExportDataInner(setStatus'));
    assert.ok(storage.includes('正在打包'), '没有进行中提示');
    assert.ok(storage.includes('已导出'), '成功没提示');
    assert.ok(storage.includes('导出失败'), '失败没提示');
});

console.log('C. 两处搜索');
check('C1 阶段列表可搜索（命中集合 → 分页 → 渲染真实阶段号）', () => {
    assert.ok(story.includes('function niGetStageMatchIds()'));
    assert.ok(story.includes('function niSetStageQuery(text)'));
    assert.ok(story.includes('niResolveStagePagination({ total: stageIds.length'));
    assert.ok(story.includes('const i = stageIds[pos - 1];'), '没把命中集合映射回阶段号');
    assert.ok(story.includes('niSetStageQuery,'), '没导出');
    assert.ok(tmpl.includes('id="ni-stage-search"'));
    assert.ok(idx.includes("$app.on('input', '#ni-stage-search'"));
});
check('C2 小说库快照可搜索（命中/总数标签、搜索时不强行对齐当前小说）', () => {
    assert.ok(storage.includes('_novelLibraryQuery'));
    assert.ok(storage.includes('function niSetNovelLibraryQuery(text)'));
    assert.ok(storage.includes('命中 '), '没有命中计数');
    assert.ok(storage.includes('alignCurrent: needle ? false : shouldAlignCurrent'));
    assert.ok(storage.includes('niSetNovelLibraryQuery,'), '没导出');
    assert.ok(tmpl.includes('id="ni-lib-search"'));
    assert.ok(idx.includes("$app.on('input', '#ni-lib-search'"));
});

console.log('D. 高频路径的性能改动（行为必须完全不变）');
check('D1 cosineSim 与定义一致（200 组随机对照，含零向量与长度不等）', () => {
    const ref = (a, b) => {
        let d = 0, na = 0, nb = 0;
        for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
        const den = Math.sqrt(na) * Math.sqrt(nb);
        return den === 0 ? 0 : d / den;
    };
    for (let t = 0; t < 200; t++) {
        const n = 1 + (t % 13);
        const a = Array.from({ length: n }, () => Math.random() * 2 - 1);
        const b = Array.from({ length: n }, () => Math.random() * 2 - 1);
        assert.ok(Math.abs(cosineSim(a, b) - ref(a, b)) < 1e-12, '与定义不一致');
    }
    assert.equal(cosineSim([1], [1, 2]), 0);
    assert.equal(cosineSim([0, 0], [1, 1]), 0);
    assert.equal(cosineSim([1, 2, 3], [1, 2, 3]), 1);
});
check('D2 cosineSim 缓存了模长（同一对象重复算不重算）', () => {
    assert.ok(vec.includes('_niVecNormCache'));
    assert.ok(vec.includes('function niVecNorm(v)'));
});
await checkAsync('D3 同一段文本不会重复请求 embedding', async () => {
    let calls = 0;
    const client = createEmbeddingClient({
        getSettings: () => ({ vecUrl: 'http://x/v1', vecKey: 'k', vecModel: 'm', apiTimeoutMin: 1 }),
        acquireRateSlot: async () => {},
        runWithSemaphore: (_sem, fn) => fn(),
        semaphore: {},
        defaultSettings: { apiTimeoutMin: 1 },
        fetch: async (_url, opts) => {
            calls++;
            const body = JSON.parse(opts.body);
            return { ok: true, json: async () => ({ data: body.input.map(t => ({ embedding: [t.length, 1] })) }) };
        },
    });
    const first = await client.niRequestEmbeddings(['甲', '乙乙']);
    const second = await client.niRequestEmbeddings(['甲', '乙乙']);
    assert.equal(calls, 1, '重复的文本又请求了一次');
    const mixed = await client.niRequestEmbeddings(['甲', '丙丙丙']);
    assert.equal(calls, 2, '部分未命中时应该只发增量');
    assert.deepEqual(second, first);
    assert.deepEqual(mixed[0], first[0]);
    assert.deepEqual(mixed[1], [3, 1]);
});
check('D4 角色合并用精确同名 Map，模糊匹配仍回落到原判定', () => {
    assert.ok(story.includes('const exactNameIndex = new Map();'));
    assert.ok(story.includes('exactNameIndex.get(nameKey)'));
    assert.ok(story.includes('state.characters.find(item => isSameCharacter(item, character))'), '模糊命中兜底被删了');
});
check('D5 世界书楼层映射按消息条数复用', () => {
    assert.ok(world.includes('_niDevFloorMap'));
    assert.ok(world.includes('_niDevFloorMapLen'));
    assert.ok(world.includes('messages.length !== _niDevFloorMapLen'));
});
check('D6 穿书故事条先按末条消息定位，不再逐条全量扫 .mes', () => {
    assert.ok(transbook.includes("querySelectorAll(':scope > .mes[id]')"));
    assert.ok(/if \(!lastAiMes\)[\s\S]{0,400}document\.querySelectorAll\('\.mes'\)/.test(transbook), '没有保底回落');
});
check('D7 压缩正文懒加载做了单飞，且失败不缓存', () => {
    assert.ok(storage.includes('_niChunksLoading'));
    assert.ok(storage.includes('if (_niChunksLoading) return _niChunksLoading;'));
    assert.ok(storage.includes('_niChunksLoading = null;'), 'finally 没清掉在飞标记');
});
check('D8 本轮没有引入新的重复实现（关键函数各一处）', () => {
    assert.equal((story.match(/export function mergeCharacters/g) || []).length, 1);
    assert.equal((idx.match(/function mergePlots/g) || []).length, 1);
    assert.equal((vec.match(/export function cosineSim/g) || []).length, 1);
});

console.log('E. 接线完整性');
check('E1 新增的搜索控件复用了角色搜索的样式，没有另起一套', () => {
    assert.ok(tmpl.includes('ni-char-search-row') && tmpl.includes('ni-char-search'));
    assert.ok(readPlugin('style.css').includes('.ni-char-search'));
});
check('E2 新增按钮都带 title（鼠标悬停能看懂）', () => {
    const at = tmpl.indexOf('id="ni-btn-vec-stop"');
    assert.ok(at > 0, '缺少 ni-btn-vec-stop');
    const tag = tmpl.slice(tmpl.lastIndexOf('<button', at), tmpl.indexOf('>', at) + 1);
    assert.ok(tag.includes('title='), 'ni-btn-vec-stop 没有 title');
});
check('E3 停止/取消类按钮的图标语义一致（ti-player-stop）', () => {
    assert.ok(tmpl.includes('ti-player-stop'));
    assert.ok(story.includes('ti-player-stop'));
});

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
if (fail) {
    console.log('\n失败项：');
    problems.forEach(p => console.log(p));
    process.exit(1);
}
