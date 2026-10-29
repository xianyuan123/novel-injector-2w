// novel-injector 向量注入预算：端到端回归测试
// 直接 import 真实的 lib/vector-system.js + lib/injection-system.js（先复制到临时目录，不碰源码）
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PLUGIN_ROOT } from './_paths.mjs';
import { pathToFileURL } from 'node:url';

const SRC = PLUGIN_ROOT;
const TMP = path.join(os.tmpdir(), 'ni_test_' + Date.now());
(function cp(a, b) {
    fs.mkdirSync(b, { recursive: true });
    for (const e of fs.readdirSync(a, { withFileTypes: true })) {
        if (e.name === '.git') continue;
        e.isDirectory() ? cp(path.join(a, e.name), path.join(b, e.name))
                        : fs.copyFileSync(path.join(a, e.name), path.join(b, e.name));
    }
})(SRC, TMP);

const vs = await import(pathToFileURL(path.join(TMP, 'lib/vector-system.js')).href);
const IS = await import(pathToFileURL(path.join(TMP, 'lib/injection-system.js')).href);

let bad = 0;
const ok = m => console.log('  OK   ' + m);
const B = m => { bad++; console.log('  BUG  ' + m); };

const MARK_CUR = '【当前阶段原著片段】';
const MARK_HIS = '【原著前情片段】';

// 构造假向量行：正文块每块 ~len 字（CJK 按 1 个 UTF-16 码元计，与 .length 一致）
// 向量第一维固定为正，保证与查询 [1,0,0,0] 的相似度恒大于 0，从而绕开阈值过滤、
// 让「预算」成为唯一生效的约束（阈值过滤另有测试覆盖）。
const mk = (stage, ci, len) => {
    const v = [0.9, Math.sin(stage * 0.9 + ci * 1.1) * 0.4, Math.cos(ci * 2.1) * 0.3, Math.sin(stage * 2.3) * 0.2];
    const n = Math.hypot(...v);
    const head = `【S${stage}C${ci}】`;
    return {
        stageIdx: stage, chunkIdx: ci, sourceChunkIdx: (stage - 1) * 500 + ci,
        text: head + '字'.repeat(Math.max(0, len - head.length)),
        vector: v.map(x => x / n),
    };
};
const rows = [];
for (let i = 0; i < 30; i++) rows.push(mk(9, i, 1000));
for (let i = 0; i < 10; i++) rows.push(mk(3, i, 1000));
let lastCompared = null;

function svc({ tokens, topK = 30, historyTopK = 2, keepTopN = 0, thresh = 0, query = [1, 0, 0, 0], data = rows }) {
    lastCompared = null;
    const settings = { recallThresh: thresh, recallTopK: topK, vecHistoryTopK: historyTopK, vecKeepTopN: keepTopN, vecInjMaxTokens: tokens, vecChunkChars: 1000 };
    return vs.createVectorRecallService({
        getSettings: () => settings,
        getState: () => ({ novelKey: 'n1' }),
        defaultSettings: { recallThresh: 0.5, recallTopK: 12, historyTopK: 2, vecInjMaxTokens: 20000, vecChunkChars: 1000 },
        dbLoadByNovel: async () => data,
        cosineSim: vs.cosineSim,
        isVectorRowCompatible: vs.isVectorRowCompatible,
        embeddingClient: { niRequestEmbeddings: async l => l.map(() => query), embedText: async () => query },
        onVectorQueryCompared: (rows, dim) => { lastCompared = { rows: rows.length, dim }; },
        logger: { warn: () => {}, info: () => {}, error: () => {} },
    });
}
// 注入文本最终形态：current + ('\n\n' 分隔) + historical，所以上限 = 预算 + 2
function measure(out) {
    const ci = out.indexOf(MARK_CUR), hi = out.indexOf(MARK_HIS);
    const cur = ci >= 0 ? out.slice(ci + MARK_CUR.length + 1, hi >= 0 ? hi - 2 : undefined) : '';
    const his = hi >= 0 ? out.slice(hi + MARK_HIS.length + 1) : '';
    return { curLen: cur.length, hisLen: his.length, total: out.length };
}

console.log('[T1] 预算上限被严格遵守（连同前情池、含分隔符）');
for (const tokens of [256, 2000, 5000, 10000, 20000, 200000]) {
    const budget = IS.niVectorInjectionCharBudget(tokens);
    const out = await svc({ tokens }).recallRelevantWeighted([{ text: 'q', weight: 1 }], [9], { historicalStages: [3], splitSections: true });
    const m = measure(out);
    console.log(`     ${String(tokens).padStart(6)} token -> 预算 ${budget} 字 | 当前 ${m.curLen} + 前情 ${m.hisLen} = ${m.total}`);
    if (m.total <= budget + 2) ok(`合计 ${m.total} <= ${budget}+2`);
    else B(`合计 ${m.total} 超出预算 ${budget}（超 ${m.total - budget - 2}）`);
    if (m.curLen <= budget) ok('当前池不超预算'); else B(`当前池 ${m.curLen} 超预算 ${budget}`);
}

console.log('\n[T2] 注入量随预算单调不减，且 20000 档显著大于默认老行为');
const curve = [];
for (const t of [2000, 5000, 10000, 20000]) {
    const out = await svc({ tokens: t }).recallRelevantWeighted([{ text: 'q', weight: 1 }], [9], { historicalStages: [3], splitSections: true });
    curve.push([t, out.length]);
}
console.log('     ' + curve.map(([t, l]) => `${t}token→${l}字`).join('  '));
let mono = true;
for (let i = 1; i < curve.length; i++) if (curve[i][1] < curve[i - 1][1]) mono = false;
mono ? ok('单调不减') : B('预算变大反而注入变少：' + JSON.stringify(curve));
curve[3][1] > curve[0][1] ? ok(`20000 档 ${curve[3][1]} 字 > 2000 档 ${curve[0][1]} 字`) : B('调大预算没有带来更多召回');

console.log('\n[T3] 前情池能独立工作（当前池为空时）');
{
    // 只给前情阶段(3)数据，当前阶段(9)无数据
    const onlyHist = rows.filter(r => r.stageIdx === 3);
    const out = await svc({ tokens: 10000, data: onlyHist }).recallRelevantWeighted([{ text: 'q', weight: 1 }], [9], { historicalStages: [3], splitSections: true });
    const m = measure(out);
    console.log(`     当前 ${m.curLen} 字 / 前情 ${m.hisLen} 字`);
    m.hisLen > 0 ? ok('当前池为空时前情池正常注入') : B('当前池为空，前情池却没内容');
    m.total <= 15002 ? ok('合计不超预算') : B(`合计 ${m.total} 超预算`);
}

console.log('\n[T4] 两级预算：当前池优先，前情吃剩余（不会互相翻倍）');
{
    const out = await svc({ tokens: 10000 }).recallRelevantWeighted([{ text: 'q', weight: 1 }], [9], { historicalStages: [3], splitSections: true });
    const m = measure(out);
    m.curLen > m.hisLen
        ? ok(`当前池(${m.curLen}) 优先于前情池(${m.hisLen})，符合“当前优先”设计`)
        : B(`当前池(${m.curLen}) 没有优先于前情池(${m.hisLen})`);
    m.total <= 15002 ? ok(`合计 ${m.total} 未突破单轮上限`) : B(`合计 ${m.total} 突破单轮上限`);
}

console.log('\n[T5] 召回段数(topK)与预算谁先到谁生效');
for (const topK of [1, 3, 24]) {
    const out = await svc({ tokens: 200000, topK }).recallRelevantWeighted([{ text: 'q', weight: 1 }], [9], { historicalStages: [3], splitSections: true });
    // 只数当前池的块（历史池另有 historyTopK=2 个名额，不占 topK 配额）
    const curSection = out.split(MARK_HIS)[0];
    const curBlocks = (curSection.match(/【S9C/g) || []).length;
    const hisBlocks = (out.split(MARK_HIS)[1] || '').match(/【S3C/g)?.length || 0;
    console.log(`     topK=${topK} -> 当前池 ${curBlocks} 块 + 前情池 ${hisBlocks} 块（候选库 ${lastCompared?.rows} 行）`);
    curBlocks === Math.min(topK, 30)
        ? ok(`当前池 ${curBlocks} 块 = min(topK=${topK}, 可用 30 块)`)
        : B(`当前池 ${curBlocks} 块，期望 ${Math.min(topK, 30)} 块`);
    hisBlocks <= 2 ? ok(`前情池 ${hisBlocks} 块，未超 historyTopK=2`) : B(`前情池 ${hisBlocks} 块，超过 historyTopK=2`);
}
console.log('\n[T5b] 新默认值下预算能否真正用满（20000 token）');
{
    const out = await svc({ tokens: 20000, topK: 30 }).recallRelevantWeighted([{ text: 'q', weight: 1 }], [9], { historicalStages: [3], splitSections: true });
    const m = measure(out);
    const ratio = m.total / 30000;
    console.log(`     注入 ${m.total} 字 / 预算 30000 字（用掉 ${(ratio * 100).toFixed(1)}%）`);
    ratio >= 0.9 ? ok(`预算利用率 ${(ratio * 100).toFixed(1)}% >= 90%，“20000 token 能真正用满”`) : B(`预算只用到 ${(ratio * 100).toFixed(1)}%，默认召回段数仍不够`);
}

console.log('\n[T6] 预算非法/极端值不崩溃且不超上限');
for (const [t, label] of [[NaN, 'NaN'], [undefined, 'undefined'], [0, '0'], [-100, '负数'], ['abc', '非数字'], [1e9, '超大']]) {
    try {
        const out = await svc({ tokens: t }).recallRelevantWeighted([{ text: 'q', weight: 1 }], [9], { historicalStages: [3], splitSections: true });
        const budget = IS.niVectorInjectionCharBudget(t);
        out.length <= budget + 2 ? ok(`${label} -> ${out.length} 字 <= ${budget}（回退默认）`) : B(`${label} -> ${out.length} 字 超 ${budget}`);
    } catch (e) { B(`${label} 抛异常：${e.message}`); }
}

console.log('\n[T7] 边界：空数据 / 无查询 / 无阶段');
{
    const cases = [
        ['空向量库', () => svc({ tokens: 20000, data: [] }).recallRelevantWeighted([{ text: 'q', weight: 1 }], [9], { historicalStages: [3] })],
        ['空查询', () => svc({ tokens: 20000 }).recallRelevantWeighted([], [9], { historicalStages: [3] })],
        ['零权重查询', () => svc({ tokens: 20000 }).recallRelevantWeighted([{ text: 'q', weight: 0 }], [9], { historicalStages: [3] })],
        ['空阶段列表', () => svc({ tokens: 20000 }).recallRelevantWeighted([{ text: 'q', weight: 1 }], [], { historicalStages: [] })],
    ];
    for (const [label, fn] of cases) {
        try { const r = await fn(); r === '' ? ok(`${label} -> 安全返回空串`) : B(`${label} -> 返回了 ${r.length} 字（期望空串）`); }
        catch (e) { B(`${label} 抛异常：${e.message}`); }
    }
}

console.log('\n[T8] anchor 裁剪（穿书模式）后预算仍成立');
for (const anchor of [0, 5, 20, 999]) {
    const out = await svc({ tokens: 10000 }).recallRelevantWeighted([{ text: 'q', weight: 1 }], [9], { historicalStages: [3], splitSections: true, lightRecallContext: { anchorChunkIdx: anchor } });
    const m = measure(out);
    m.total <= 15002 ? ok(`anchor=${anchor} -> ${m.total} 字 <= 15002`) : B(`anchor=${anchor} -> ${m.total} 字 超预算`);
}

console.log('\n[T9] 切块大小设置真的改变索引粒度');
for (const chunkChars of [500, 1000, 1500, 4000]) {
    const state = { chunkStatus: ['done'], chunks: ['甲'.repeat(6000)], chunkResults: [], chunkStageMap: { 0: [1] }, novelKey: 'k' };
    try {
        const buckets = vs.buildVectorStageBuckets(state, new Set([1]), { charLimit: chunkChars });
        const n = buckets[1]?.length || 0;
        const expect = Math.ceil(6000 / chunkChars);
        n >= expect - 1 && n <= expect + 1 ? ok(`chunkChars=${chunkChars} -> ${n} 块（期望约 ${expect}）`) : B(`chunkChars=${chunkChars} -> ${n} 块，期望约 ${expect}`);
    } catch (e) { B(`chunkChars=${chunkChars} 抛异常：${e.message}`); }
}

console.log('\n[T10] 接口完整性：导出函数与真实模块一致');
{
    const need = ['splitText', 'cosineSim', 'buildVectorStageBuckets', 'mapVectorTextSubChunks', 'createVectorRecallService', 'isVectorRowCompatible', 'niSelectSemanticRecallCandidates'];
    const missing = need.filter(n => typeof vs[n] !== 'function');
    missing.length === 0 ? ok(`vector-system.js 的 ${need.length} 个关键导出全部存在`) : B('缺少导出：' + missing.join(', '));
    const needIS = ['niNormalizeVectorInjectionMaxTokens', 'niNormalizeVectorChunkChars', 'niVectorInjectionCharBudget'];
    const missIS = needIS.filter(n => typeof IS[n] !== 'function');
    missIS.length === 0 ? ok('injection-system.js 的三个新函数全部存在') : B('缺少导出：' + missIS.join(', '));
    // 预算默认值必须等于设置页默认值
    const defTokRaw = (fs.readFileSync(path.join(TMP, 'index.js'), 'utf8').match(/vecInjMaxTokens:\s*([A-Z_]+|\d+)/) || [])[1] || '';
    const defTok = /^\d+$/.test(defTokRaw)
        ? Number(defTokRaw)
        : Number((fs.readFileSync(path.join(TMP, 'lib/injection-system.js'), 'utf8').match(new RegExp(defTokRaw + '\\s*=\\s*(\\d+)')) || [])[1]);
    defTok === 20000 ? ok(`默认 vecInjMaxTokens 解析为 ${defTok}（源：${defTokRaw}）`) : B(`默认 vecInjMaxTokens 异常：${defTok}（源：${defTokRaw}）`);
    const defTopK = Number((fs.readFileSync(path.join(TMP, 'index.js'), 'utf8').match(/recallTopK:\s*(\d+)/) || [])[1]);
    const tplTopK = Number((fs.readFileSync(path.join(TMP, 'template.html'), 'utf8').match(/id="ni-recall-topk"[^>]*value="(\d+)"/) || [])[1]);
    defTopK === tplTopK ? ok(`召回段数默认值一致：index.js=${defTopK}，template.html=${tplTopK}`) : B(`召回段数默认值不一致：index.js=${defTopK}，template.html=${tplTopK}`);
    const tpl = fs.readFileSync(path.join(TMP, 'template.html'), 'utf8');
    const tv = Number((tpl.match(/id="ni-vec-inj-max-tokens"[^>]*value="(\d+)"/) || [])[1]);
    tv === 20000 ? ok('template.html 输入框默认值 = 20000') : B(`template.html 默认值 = ${tv}`);
    const cv = Number((tpl.match(/id="ni-vec-chunk-chars"[^>]*value="(\d+)"/) || [])[1]);
    cv === 1000 ? ok('template.html 切块默认值 = 1000') : B(`template.html 切块默认值 = ${cv}`);
}

// [T11] 用户报的现象：阈值卡得严时只能进来 3-4 块；「保底召回片段数」必须能补到指定段数。
console.log('\n[T11] 阈值是及格线不是名额：保底召回片段数必须补足段数');
{
    const bank = [];
    for (let i = 0; i < 4; i++) {
        const row = mk(9, i, 1000);
        row.vector = [1, 0, 0, 0];
        bank.push(row);
    }
    for (let i = 4; i < 40; i++) {
        const row = mk(9, i, 1000);
        row.vector = [0.76, 0.5621, 0.11242, 0.05621];
        bank.push(row);
    }
    const nrm = [1, 0, 0, 0];
    const budget = IS.niVectorInjectionCharBudget(20000);

    for (const [thresh, expectFew] of [[0.8, 4], [0.7, 29]]) {
        // 故意不往 opts 里传 keepTopN：设置页的值必须自己走到选择器，
        // 否则用户把「保底召回片段数」设成 40 仍然只拿到 3~4 块。
        const count = async keep => {
            const out = await svc({ tokens: 20000, topK: 40, keepTopN: keep, thresh, query: nrm, data: bank })
                .recallRelevantWeighted([{ text: 'q', weight: 1 }], [9], { historicalStages: [], splitSections: true });
            return { n: (out.match(/【S9C/g) || []).length, len: out.length };
        };
        const few = await count(0);
        few.n === expectFew
            ? ok(`阈值 ${thresh}：不开保底只进来 ${few.n} 块（== 及格的 ${expectFew} 块）`)
            : B(`阈值 ${thresh}：不开保底进来 ${few.n} 块，期望 ${expectFew} 块`);
        for (const keep of [30, 40]) {
            const got = await count(keep);
            got.n >= 29 && got.len <= budget
                ? ok(`阈值 ${thresh}：保底 ${keep} -> 补到 ${got.n} 块（${got.len} 字，预算 ${budget}）`)
                : B(`阈值 ${thresh} 保底 ${keep}：只拿到 ${got.n} 块 / ${got.len} 字（预算 ${budget}）`);
        }
    }

    const small = await svc({ tokens: 7000, topK: 40, keepTopN: 40, query: nrm, data: bank })
        .recallRelevantWeighted([{ text: 'q', weight: 1 }], [9], { historicalStages: [], splitSections: true });
    const nSmall = (small.match(/【S9C/g) || []).length;
    (nSmall < 40 && small.length <= IS.niVectorInjectionCharBudget(7000))
        ? ok(`预算才是天花板：保底 40 但预算 7000 Token -> 实际 ${nSmall} 块 / ${small.length} 字`)
        : B(`预算 7000 时拿到 ${nSmall} 块 / ${small.length} 字，未按预算裁剪`);
}

console.log('\n[T9] 前情片段数设 0 -> 不注入前情（0 是有效值，不能被 || 当成「没填」）');
{
    const out = await svc({ tokens: 20000, topK: 12, historyTopK: 0 })
        .recallRelevantWeighted([{ text: 'q', weight: 1 }], [9], { historicalStages: [3], splitSections: true });
    const hisBlocks = (out.split(MARK_HIS)[1] || '').match(/【S3C/g)?.length || 0;
    hisBlocks === 0
        ? ok('historyTopK=0 -> 前情池 0 块')
        : B(`historyTopK=0 仍注入了 ${hisBlocks} 块前情，设置被忽略`);
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\n========== 共 ${bad} 个 BUG ==========`);
process.exitCode = bad ? 1 : 0;
