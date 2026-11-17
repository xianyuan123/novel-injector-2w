import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN = join(HERE, '..');
const read = (p) => readFileSync(join(PLUGIN, p), 'utf8');

const { niSplitStageSizes } = await import(pathToFileURL(join(PLUGIN, 'lib', 'story-data.js')).href);

let pass = 0, fail = 0;
function check(name, fn) {
    try { fn(); pass++; console.log('  OK  ' + name); }
    catch (e) { fail++; console.log('  FAIL ' + name + '\n        ' + e.message); }
}

console.log('[A] 按「阶段数 × 每阶段节点数」切分');
check('A1 12 个节点、4 阶段、每段 3 → 3/3/3/3', () => {
    assert.deepEqual(niSplitStageSizes(12, 4, 3), [3, 3, 3, 3]);
});
check('A2 10 个节点、4 阶段、每段 3 → 前 3 段各 3，最后 1 个收尾', () => {
    assert.deepEqual(niSplitStageSizes(10, 4, 3), [3, 3, 3, 1]);
});
check('A3 每段给 0（均分）：10 个节点、4 阶段 → 3/3/2/2', () => {
    assert.deepEqual(niSplitStageSizes(10, 4, 0), [3, 3, 2, 2]);
});
check('A4 只填每段数量：10 个节点、每段 4 → 3 段（4/4/2）', () => {
    assert.deepEqual(niSplitStageSizes(10, 0, 4), [4, 4, 2]);
});
check('A5 阶段数比节点还多时按节点数封顶', () => {
    assert.deepEqual(niSplitStageSizes(3, 10, 5), [1, 1, 1]);
});
check('A6 每段数量远大于总量：按阶段数均分', () => {
    assert.deepEqual(niSplitStageSizes(5, 3, 99), [2, 2, 1]);
});
check('A7 总数为 0 → 空数组', () => {
    assert.deepEqual(niSplitStageSizes(0, 4, 3), []);
});
check('A8 非法入参不炸', () => {
    assert.deepEqual(niSplitStageSizes(-5, 0, 0), []);
    assert.deepEqual(niSplitStageSizes(6, NaN, NaN), [6]);
});
check('A9 切出来的段数不超过阶段数', () => {
    for (let t = 1; t <= 30; t++) {
        for (const n of [1, 2, 5, 9]) {
            const sizes = niSplitStageSizes(t, n, 4);
            assert.ok(sizes.length <= Math.min(n, t), `${t}/${n} → ${sizes.length}`);
            assert.equal(sizes.reduce((a, b) => a + b, 0), t, `${t}/${n} 总和`);
        }
    }
});

console.log('[B] 面板与接线');
check('B1 模板里有「自动分段」这一行和两个输入框', () => {
    const tpl = read('template.html');
    assert.ok(tpl.includes('id="ni-sp-size-row"'));
    assert.ok(tpl.includes('id="ni-sp-stage-count"'));
    assert.ok(tpl.includes('id="ni-sp-stage-size"'));
    assert.ok(tpl.includes('id="ni-sp-size-btn"'));
    assert.ok(tpl.includes('自动分段'));
});
check('B2 两个输入框有范围限制', () => {
    const tpl = read('template.html');
    assert.ok(/id="ni-sp-stage-count"[^>]*min="1"[^>]*max="200"/.test(tpl));
    assert.ok(/id="ni-sp-stage-size"[^>]*min="1"[^>]*max="500"/.test(tpl));
});
check('B3 story-data 里有 niAutoStageBySize 并导出', () => {
    const src = read('lib/story-data.js');
    assert.ok(src.includes('async function niAutoStageBySize'));
    assert.ok(src.includes('export function niSplitStageSizes'));
    assert.ok(src.includes('window.niAutoStageBySize = niAutoStageBySize;'));
    assert.ok(src.includes('niAutoStageBySize,'));
});
check('B4 自动分段不管转折：取的是排好序的全部节点', () => {
    const src = read('lib/story-data.js');
    const seg = src.slice(src.indexOf('async function niAutoStageBySize'));
    assert.ok(seg.slice(0, 2000).includes('niOrderedPlotEntries'));
    assert.ok(!seg.slice(0, 2000).includes('isPivot'), '不该用转折点切段');
});
check('B5 同一分段不会被切进两个阶段（避免 stageMap 覆盖）', () => {
    const src = read('lib/story-data.js');
    const seg = src.slice(src.indexOf('async function niAutoStageBySize'));
    assert.ok(seg.slice(0, 2500).includes('usedCi.has(ci)'));
});
check('B6 index.js 绑了按钮与回车', () => {
    const src = read('index.js');
    assert.ok(src.includes("$app.on('click', '#ni-sp-size-btn', () => niAutoStageBySize());"));
    assert.ok(src.includes("'#ni-sp-stage-count, #ni-sp-stage-size'"));
    assert.ok(src.includes('niAutoStageBySize,'));
});
check('B7 样式表有分段设置行', () => {
    const css = read('style.css');
    assert.ok(css.includes('.ni-sp-size-row {'));
    assert.ok(css.includes('.ni-sp-size-btn {'));
});

console.log(`\n通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
