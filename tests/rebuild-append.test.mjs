// Novel Injector — 「换模型一键重建索引」与「追加章节」的回归测试
// 覆盖：重建按钮的出现条件与实现、静默清除向量的返回语义、
//       追加章节不破坏已有分段/清洗结果、模板与接线。
import assert from 'node:assert/strict';
import { readPlugin, pluginUrl } from './_paths.mjs';

const idx = readPlugin('index.js');
const tmpl = readPlugin('template.html');
const css = readPlugin('style.css');
const cleaning = readPlugin('lib/cleaning-system.js');
const storage = readPlugin('lib/storage-system.js');

let pass = 0, fail = 0;
const problems = [];
function check(name, fn) {
    try { fn(); pass++; console.log(`  ok   ${name}`); }
    catch (e) { fail++; problems.push(`- ${name}: ${e.message}`); console.log(`  FAIL ${name} :: ${e.message}`); }
}
function slice(src, start, end) {
    const a = src.indexOf(start);
    if (a < 0) throw new Error(`找不到起点 ${start}`);
    const b = end ? src.indexOf(end, a) : -1;
    return src.slice(a, b < 0 ? undefined : b);
}

await import(pluginUrl('lib/cleaning-system.js'));

console.log('A. 换模型一键重建索引');
check('A1 清除向量支持静默模式，并返回「清干净了没」', () => {
    assert.ok(storage.includes('async function niClearVecCache({ quiet = false } = {})'));
    const fn = slice(storage, 'async function niClearVecCache(', 'async function niClearAllData');
    assert.ok(fn.includes('return false'), '失败路径没有返回 false');
    assert.ok(/return true;/.test(fn), '成功路径没有返回 true');
    assert.ok(fn.includes("if (!quiet && !confirm("), '静默模式仍然会弹确认框');
});

check('A2 重建按钮只在「来源不一致 + 确实有向量 + 不在跑」时出现', () => {
    const fn = slice(idx, 'function niRenderVectorCompatibilityHint(', 'let niInvalidateVectorRecallCache');
    assert.ok(fn.includes("q('#ni-btn-vec-rebuild')"));
    assert.ok(/presentation\.level === 'warning'/.test(fn), '没看提示级别');
    assert.ok(fn.includes('hasStored'), '没看是否真的有已存向量');
    assert.ok(fn.includes('!S._vecRunning'), '向量化中也会露出重建按钮');
});

check('A3 点重建 = 确认 → 静默清向量 → 立刻用当前设置重跑', () => {
    const block = slice(idx, "$app.on('click', '#ni-btn-vec-rebuild'", '// ── 阶段注入');
    assert.ok(/confirm\(/.test(block), '没有确认就清库');
    assert.ok(block.includes('niClearVecCache({ quiet: true })'), '没走静默清除');
    assert.ok(block.indexOf('niClearVecCache') < block.indexOf('await niStartVec()'), '清完没接着重建');
    assert.ok(block.includes('niRenderVectorCompatibilityHint()'), '清完没刷新提示行');
});

check('A4 模板里有按钮、样式里有个头', () => {
    assert.ok(tmpl.includes('id="ni-btn-vec-rebuild"'), '模板缺少重建按钮');
    const at = tmpl.indexOf('id="ni-btn-vec-rebuild"');
    const tag = tmpl.slice(tmpl.lastIndexOf('<button', at), tmpl.indexOf('>', at) + 1);
    assert.ok(tag.includes('title='), '按钮没有 title 说明');
    assert.ok(tag.includes('style="display:none"'), '默认应隐藏，等提示变黄才出现');
    assert.ok(css.includes('.ni-vec-rebuild-btn'));
});

console.log('B. 追加章节');
check('B1 追加只往尾部加分段，已有状态原样保留', () => {
    const fn = slice(cleaning, 'function niAppendFile(', 'function getCfgKb(');
    assert.ok(fn.includes('...(S.chunks || []), ...addedChunks'), '没有追加式拼接分段');
    assert.ok(!fn.includes('niResetNovelWorkspace()'), '追加章节把工作区清空了');
    assert.ok(!fn.includes('S.chunkStatus = addedChunks'), '状态数组被整体覆盖');
    assert.ok(fn.includes('...(S.chunkStatus || [])'), '旧分段状态应该保留');
    assert.ok(fn.includes('...(S.chunkResults || [])'), '旧清洗结果应该保留');
});

check('B2 原文用空行拼接，文件大小累加，首次指纹不动', () => {
    const fn = slice(cleaning, 'function niAppendFile(', 'function getCfgKb(');
    assert.ok(fn.includes("S.rawText = `${String(S.rawText || '').replace(/\\s+$/, '')}\\n\\n${text}`"));
    assert.ok(fn.includes('S.rawFileSize = Number(S.rawFileSize || 0) + Number(f.size || 0);'));
    assert.ok(!fn.includes('S.fileFingerprint ='), '不该改写首次上传的指纹');
    assert.ok(fn.includes('S.appendFingerprints'), '没记录追加过的指纹');
});

check('B3 同一份文件不会被追加两次', () => {
    const fn = slice(cleaning, 'function niAppendFile(', 'function getCfgKb(');
    assert.ok(fn.includes('const known = new Set('), '没有汇总已追加过的指纹');
    assert.ok(/known\.has\(fingerprint\)/.test(fn), '没有判重');
    assert.ok(fn.includes('已经追加过了'));
});

check('B4 没有小说时追加只提示，不做事', () => {
    const fn = slice(cleaning, 'function niAppendFile(', 'function getCfgKb(');
    assert.ok(fn.includes('if (!S.novelKey || !(S.chunks || []).length)'), '缺少前置判断');
});

check('B5 追加完刷新分段列表与按钮状态', () => {
    const fn = slice(cleaning, 'function niAppendFile(', 'function getCfgKb(');
    ['renderChunkList()', 'niSyncCleanButtonState()', 'niSaveSettings()'].forEach(call => {
        assert.ok(fn.includes(call), `追加后没有调用 ${call}`);
    });
    assert.ok(fn.includes("q('#ni-st-chunks')"), '总分段数没更新');
});

console.log('C. 接线完整性');
check('C1 追加章节的入口与导出都在', () => {
    assert.ok(tmpl.includes('id="ni-btn-append"'), '模板缺少追加按钮');
    assert.ok(tmpl.includes('id="ni-fi-append"'), '模板缺少追加用的文件选择框');
    assert.ok(cleaning.includes('niOnAppendFile,'), 'cleaning-system 没导出 niOnAppendFile');
    assert.ok(idx.includes('niOnAppendFile,'), 'index.js 没引入 niOnAppendFile');
    assert.ok(idx.includes("$app.on('click', '#ni-btn-append'"), '点击没接上');
    assert.ok(idx.includes("$app.on('change', '#ni-fi-append'"), '选文件没接上');
});

check('C2 追加记录会跟着设置与快照一起持久化', () => {
    assert.ok(idx.includes('cfg._appendFingerprints = S.appendFingerprints || [];'));
    assert.ok(idx.includes('S.appendFingerprints = saved._appendFingerprints.slice();'));
    assert.ok(storage.includes('_appendFingerprints: niCloneSnapshotValue(S.appendFingerprints, []),'));
    assert.ok(storage.includes('S.appendFingerprints = d._appendFingerprints.slice();'));
});

check('C3 两个新按钮都有文字标签，不靠图标猜', () => {
    const buttonHtml = (id) => {
        const at = tmpl.indexOf(`id="${id}"`);
        assert.ok(at > 0, `模板缺少 ${id}`);
        return tmpl.slice(tmpl.lastIndexOf('<button', at), tmpl.indexOf('</button>', at) + 9);
    };
    assert.ok(buttonHtml('ni-btn-append').includes('追加章节'), '追加按钮没有文字');
    assert.ok(buttonHtml('ni-btn-vec-rebuild').includes('重建索引'), '重建按钮没有文字');
});

console.log(`\n通过 ${pass} 项，失败 ${fail} 项`);
if (fail) {
    console.log('\n失败项：');
    problems.forEach(p => console.log(p));
    process.exit(1);
}
