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
    niTbSkinFromPalette
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
ok(idx.includes("'#ni-tb-skin-upload'"), 'D4 上传按钮有事件');
ok(idx.includes('niTbFileToArt') && idx.includes('niTbPaletteFromPixels'), 'D5 上传后压缩 + 取色');
ok(tpl.includes('id="ni-tb-skin-card"') && tpl.includes('id="ni-tb-skin-art"'), 'D6 设置页有这张卡和隐藏 input');
ok(tpl.includes('id="ni-tb-skin-veil"') && tpl.includes('id="ni-tb-skin-cardh"'), 'D7 有雾化与卡片高滑条');
ok(idx.includes('niTbSyncSkinUI'), 'D8 打开设置会同步皮肤 UI');
ok(idx.includes("'#ni-tb-skin-clear'"), 'D9 有清除按钮');
const pkg = JSON.parse(read('../_zip_files.json'));
ok(pkg.includes('lib/transbook-skin.js'), 'D10 打包清单已登记');

console.log(`\n通过 ${pass} 条`);
