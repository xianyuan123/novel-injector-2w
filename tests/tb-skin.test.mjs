// 状态栏皮肤：取色 / 规整 / 接线
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
    NI_TB_SKIN_DEFAULT,
    niTbCleanArt,
    niTbNormalizeSkin,
    niTbRgbToHex,
    niTbLuminance,
    niTbPaletteFromPixels,
    niTbSkinFromPalette,
    niTbContrast,
    niTbEnsureContrast,
    niTbDetectPanelBox,
    niTbMixWithWhite
} from '../lib/transbook-skin.js';

const PLUGIN_ROOT = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const read = (rel) => readFileSync(path.join(PLUGIN_ROOT, rel), 'utf8');

let pass = 0;
const ok = (c, n) => { assert.ok(c, n); pass++; console.log('  OK  ' + n); };
const eq = (a, b, n) => { assert.deepEqual(a, b, n); pass++; console.log('  OK  ' + n); };

console.log('[A] 取色');
const white = niTbPaletteFromPixels([[255, 255, 255], [250, 248, 252]]);
ok(white.dark === false, 'A1 亮图判为浅色');
const dark = niTbPaletteFromPixels([[20, 18, 30], [30, 24, 40]]);
ok(dark.dark === true, 'A2 暗图判为深色');
ok(/^#[0-9a-f]{6}$/.test(dark.accent), 'A3 主色是合法 hex');
const pink = niTbPaletteFromPixels([[240, 150, 190], [230, 140, 180]]);
ok(parseInt(pink.accent.slice(1, 3), 16) > 150, 'A4 粉图取到的主色偏红');
ok(niTbPaletteFromPixels([]) === null, 'A5 没像素时返回 null');
ok(niTbLuminance(255, 255, 255) > 0.9 && niTbLuminance(0, 0, 0) < 0.01, 'A6 亮度函数符合 WCAG');
eq(niTbRgbToHex(255, 0, 128), '#ff0080', 'A7 rgb → hex');
console.log('[B] 规整');
const norm = niTbNormalizeSkin({ radius: 999, cardH: -5, veil: 9, art: 'http://evil/x.png' });
ok(norm.radius === 28 && norm.cardH === 150 && norm.veil === 0.85, 'B1 越界值被夹住');
eq(norm.art, '', 'B2 非 data: 的图被清空');
ok(niTbCleanArt('data:image/webp;base64,AAAA') !== '', 'B3 合法 data 图保留');
eq(niTbNormalizeSkin({}).radius, NI_TB_SKIN_DEFAULT.radius, 'B4 缺省回落到默认');
eq(niTbNormalizeSkin({ accent: 'red' }).accent, '', 'B5 非 hex 的颜色被丢掉');
ok(niTbNormalizeSkin(null).cardH === NI_TB_SKIN_DEFAULT.cardH, 'B6 null 也能处理');
console.log('[C] 取色 → skin');
const sk = niTbSkinFromPalette(pink, 'data:image/webp;base64,AAAA');
ok(sk.art.startsWith('data:image/webp'), 'C1 art 带进来了');
ok(sk.accent === pink.accent, 'C2 主色用取到的主色');
ok(sk.veil > 0 && sk.veil <= 0.85, 'C3 雾化在合理范围');
ok(niTbSkinFromPalette(null, 'data:image/webp;base64,AA').accent === '', 'C4 没有调色板时不乱猜颜色');
console.log('[D] 接线');
const tb = read('lib/transbook-system.js');
const idx = read('index.js');
const tpl = read('template.html');
ok(tb.includes("from './transbook-skin.js'"), 'D1 系统里引入了皮肤模块');
ok(tb.includes('function niTbSetSkin'), 'D2 有 niTbSetSkin');
ok(tb.includes('skin: niTbSkinFor(cfg)'), 'D3 state 里带上 skin');
ok(!idx.includes("'#ni-tb-skin-upload'"), 'D4 不再有上传入口');
ok(tpl.includes('id="ni-tb-skin-card"') && !tpl.includes('id="ni-tb-skin-art"'), 'D6 有外观卡、没有图片输入框');
ok(!idx.includes("'#ni-tb-skin-clear'"), 'D9 不再有清除按钮');
const pkg = JSON.parse(read('../_zip_files.json'));
ok(pkg.includes('lib/transbook-skin.js'), 'D10 打包清单已登记');

console.log('[E] 对比度兜底');
ok(niTbContrast('#000000', '#ffffff') > 20, 'E1 黑白对比度接近 21');
const paleAccent = niTbEnsureContrast('#efc8f4', '#ffffff', 3.2);
ok(niTbContrast(paleAccent, '#ffffff') >= 3.2, 'E2 浅粉被压暗到看得清');
ok(paleAccent !== '#efc8f4', 'E3 确实改动过颜色');
const deepAccent = niTbEnsureContrast('#202030', '#242030', 3);
ok(niTbContrast(deepAccent, '#242030') >= 3, 'E4 深底上会提亮主色');
ok(niTbEnsureContrast('#8f63c9', '#ffffff', 3.2) === '#8f63c9', 'E5 本来就够的不乱动');

console.log('[F] 面板区识别');
const grid = (w, h, fn) => {
    const out = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.push(fn(x, y));
    return out;
};
// 40×40 的图，中间 20×16 是浅色面板，四周是深色装饰
const plate = grid(40, 40, (x, y) => (
    x >= 10 && x < 30 && y >= 12 && y < 28 ? [246, 243, 250] : [70, 50, 90]
));
const box = niTbDetectPanelBox(plate, 40, 40, { aspect: 1 });
ok(box && box.l >= 20 && box.l <= 30, `F1 左边留边 ≈25%（实测 ${box && box.l}）`);
ok(box && box.r >= 20 && box.r <= 30, `F2 右边留边 ≈25%（实测 ${box && box.r}）`);
ok(box && box.t >= 25 && box.t <= 35, `F3 上边留边 ≈30%（实测 ${box && box.t}）`);
ok(box && box.b >= 25 && box.b <= 35, `F4 下边留边 ≈30%（实测 ${box && box.b}）`);
ok(niTbDetectPanelBox(grid(20, 20, () => [10, 10, 10]), 20, 20) === null, 'F5 全深色图认不出面板就返回 null');
ok(niTbDetectPanelBox(grid(20, 20, () => [250, 250, 250]), 20, 20) === null, 'F6 全浅色图也不乱给留边');
const wide = grid(60, 30, (x, y) => (x >= 6 && x < 54 && y >= 4 && y < 26 ? [250, 250, 252] : [40, 40, 40]));
const wbox = niTbDetectPanelBox(wide, 60, 30, { aspect: 0.5 });
ok(wbox && wbox.t >= 4 && wbox.t <= 12, `F7 按高宽比换算上下留边（实测 ${wbox && wbox.t}）`);
const skinWithPad = niTbNormalizeSkin({ pad: { t: 12.34, r: 9, b: 99, l: -5 } });
ok(skinWithPad.pad && skinWithPad.pad.b <= 30 && skinWithPad.pad.l === 0 && skinWithPad.pad.t === 12.3,
   'F8 pad 会被规整并夹在 0~30');

const forceSkin = niTbNormalizeSkin({ forcePad: 99 });
ok(forceSkin.forcePad === 14, 'F9 forcePad 超过 14 被夹住');
ok(niTbNormalizeSkin({}).forcePad === 0, 'F10 不给就是 0（自动）');
ok(!/ni-tb-skin-forcepad/.test(tpl), 'F11 不再有「强制留边」滑条');
ok(forceSkin.forcePad > 0 && /forcePad/.test(read('lib/transbook-bar.js')), 'F12 组件会用 forcePad');
ok(!/#ni-tb-skin-forcepad/.test(idx), 'F13 相关事件已删除');



console.log('[G] 上传图后文字必须看得见');
ok(niTbMixWithWhite('#000000', 0) === '#000000', 'G1 雾化 0 时底色不变');
ok(niTbMixWithWhite('#000000', 1) === '#ffffff', 'G2 雾化 1 时底色变纯白');
const darkPack = niTbSkinFromPalette({
    dark: true,
    avgHex: '#202030',
    accent: '#8f63c9',
    canvas: { barBg: '#242030', cardBg: '#2c2739', cardLine: '#3d3650', title: '#f2eef8', text: '#cfc7dd', veil: 0.75 }
}, 'data:image/webp;base64,AA');
ok(niTbContrast(darkPack.title, niTbMixWithWhite(darkPack.cardBg, darkPack.veil)) >= 7, 'G3 深色图 + 高雾化后标题仍看得清');
ok(niTbContrast(darkPack.text, niTbMixWithWhite(darkPack.cardBg, darkPack.veil)) >= 4.5, 'G4 正文字色同样达标');
const lightPack = niTbSkinFromPalette({
    dark: false,
    avgHex: '#f4f0f7',
    accent: '#9d839f',
    canvas: { barBg: '#ffffff', cardBg: '#ffffff', cardLine: '#e9e4f0', title: '#2a2436', text: '#5f576e', veil: 0.18 }
}, 'data:image/webp;base64,AA');
ok(niTbContrast(lightPack.title, '#ffffff') >= 7, 'G5 浅色图标题够黑');
const barSrc = read('lib/transbook-bar.js');
ok(/removeProperty\(k\)/.test(barSrc), 'G6 变量为空时会删掉旧的（关键：否则取消后还是旧颜色）');
ok(/removeProperty\('--tb-art'\)/.test(barSrc), 'G7 没有底图时会清掉背景变量');

console.log(`\n通过 ${pass} 条`);
