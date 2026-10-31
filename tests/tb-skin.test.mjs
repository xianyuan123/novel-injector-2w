// 状态栏皮肤系统：取色、变量规整、皮肤列表与接线
import fs from 'node:fs';
import path from 'node:path';
import { readPlugin, pluginUrl } from './_paths.mjs';

let pass = 0, fail = 0;
function ok(cond, name) {
    if (cond) { pass++; console.log('  OK  ' + name); }
    else { fail++; console.log('  FAIL ' + name); }
}

const mod = await import(pluginUrl('lib/transbook-skin.js'));
const {
    niTbPaletteFromPixels, niTbLuminance, niTbRgbToHex,
    niTbNormalizeVars, niTbStyleVars, niTbVarsFromPalette,
    niTbFindSkin, niTbAllSkins, niTbUniqueSkinName,
    NI_TB_BUILTIN_SKINS
} = mod;

// ── A 取色 ───────────────────────────────────────────────
console.log('[A] 取色与明暗');
ok(niTbRgbToHex(255, 0, 16) === '#ff0010', 'A1 rgb→hex 补零正确');
ok(niTbLuminance(255, 255, 255) > 0.99 && niTbLuminance(0, 0, 0) < 0.01, 'A2 相对亮度 黑≈0 白≈1');
{
    const light = niTbPaletteFromPixels(Array.from({ length: 40 }, () => ({ r: 250, g: 248, b: 246 })));
    ok(light.dark === false && light.text.startsWith('#'), 'A3 浅色图 → 深色文字');
    const dark = niTbPaletteFromPixels(Array.from({ length: 40 }, () => ({ r: 24, g: 20, b: 30 })));
    ok(dark.dark === true && /^#[0-9a-f]{6}$/.test(dark.text), 'A4 深色图 → 浅色文字');
    const mixed = niTbPaletteFromPixels([
        ...Array.from({ length: 60 }, () => ({ r: 246, g: 244, b: 240 })),
        ...Array.from({ length: 6 }, () => ({ r: 150, g: 90, b: 210 }))
    ]);
    ok(mixed.primary === '#965ad2', 'A5 主色取饱和度最高的那一簇');
    ok(mixed.onPrimary === '#ffffff', 'A6 主色偏深 → 主色上的字用白色');
    ok(niTbPaletteFromPixels([]).dark === false, 'A7 没有像素时给安全默认值');
}

// ── B 变量规整 ───────────────────────────────────────────
console.log('[B] 变量规整');
{
    const v = niTbNormalizeVars({
        art: 'data:image/webp;base64,AAA', accent: ' #123456 ',
        veil: 9, radius: -5, cardH: 9999, cardPad: 1, font: 3, junk: 'x'
    });
    ok(v.accent === '#123456', 'B1 颜色会 trim');
    ok(v.veil === 0.85 && v.radius === 0 && v.cardH === 320 && v.cardPad === 8 && v.font === 1.2, 'B2 数值全部夹在合法区间');
    ok(v.art.startsWith('data:image/webp'), 'B3 合法底图保留');
    ok(niTbNormalizeVars({ art: 'http://evil/x.png' }).art === '', 'B4 非 data:image 的底图丢弃（不允许外部请求）');
    ok(niTbNormalizeVars(null).radius === 0, 'B5 空值给默认');
}

// ── C 变量转 CSS ─────────────────────────────────────────
console.log('[C] 变量 → CSS');
{
    const vars = niTbStyleVars({ accent: '#8f63c9', veil: 0.2, radius: 16, cardH: 204 });
    ok(vars['--ni-tb-accent'] === '#8f63c9', 'C1 主色变量');
    ok(vars['--ni-tb-veil'] === '0.2', 'C2 薄纱变量');
    ok(vars['--ni-tb-radius'] === '16px' && vars['--ni-tb-card-h'] === '204px', 'C3 尺寸自动补 px');
    const none = niTbStyleVars({});
    ok(!('--ni-tb-veil' in none) && !('--ni-tb-accent' in none), 'C4 没设的变量不输出（免得盖掉主题）');
}

// ── D 皮肤列表 ───────────────────────────────────────────
console.log('[D] 皮肤列表');
{
    const all = niTbAllSkins([{ id: 'u1', name: '我的', vars: { accent: '#ff0000' } }]);
    ok(all.length === NI_TB_BUILTIN_SKINS.length + 1, 'D1 内置 + 自建合并');
    ok(all[0].id === 'plain' && all[0].builtin === true, 'D2 第一个是原版，标记 builtin');
    ok(all[all.length - 1].builtin === false, 'D3 自建的不算 builtin');
    ok(niTbFindSkin([], 'nope').id === 'plain', 'D4 找不到就回原版');
    ok(niTbFindSkin([{ id: 'u1', name: '我的', vars: {} }], 'u1').name === '我的', 'D5 自建皮肤优先命中');
    ok(niTbUniqueSkinName([{ name: '樱花' }], '樱花') === '樱花 2', 'D6 重名自动加序号');
    const p = niTbVarsFromPalette({ dark: true, primary: '#334455', text: '#eee' });
    ok(p.veil > 0.2 && p.radius > 0, 'D7 深色图生成的草稿带更厚薄纱');
}

// ── E 接线 ───────────────────────────────────────────────
console.log('[E] 接线');
{
    const index = readPlugin('index.js');
    const tpl = readPlugin('template.html');
    const tb = readPlugin('lib/transbook-system.js');
    ok(index.includes("tbSkinId: 'plain'") && index.includes('tbSkins: []') && index.includes('tbSkinVars: {}'), 'E1 设置里有皮肤三项');
    ok(index.includes("$app.on('change', '#ni-tb-skin-file'") && index.includes('niTbFileToArt(file'), 'E2 上传背景走压缩 + 取色');
    ok(index.includes("$app.on('click', '#ni-tb-skin-list .ni-tb-skin-item'"), 'E3 点列表能切皮肤');
    ok(index.includes("'#ni-tb-var-veil'") && index.includes("'#ni-tb-var-cardh'"), 'E4 滑条已接线');
    ok(tpl.includes('id="ni-tb-skin-list"') && tpl.includes('id="ni-tb-skin-upload"'), 'E5 设置页有列表与上传按钮');
    ok(tpl.includes('id="ni-tb-var-accent"') && tpl.includes('id="ni-tb-var-text"'), 'E6 设置页有颜色选择器');
    ok(tb.includes('--ni-tb-art-layer') && tb.includes("' ni-tb-skin'"), 'E7 状态栏按皮肤变量渲染');
    ok(tb.includes('function niRestyleStorybar'), 'E8 换皮肤会重建状态栏 DOM');
}

console.log(`\n通过 ${pass} / ${pass + fail}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
