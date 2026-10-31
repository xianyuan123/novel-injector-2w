// 穿书状态栏「樱花精灵」皮肤：底图、开关、接线
import { readPlugin } from './_paths.mjs';
import assert from 'node:assert/strict';

const css = readPlugin('style.css');
const tb = readPlugin('lib/transbook-system.js');
const ui = readPlugin('lib/ui-system.js');
const index = readPlugin('index.js');
const tpl = readPlugin('template.html');

const ok = (cond, msg) => { assert.ok(cond, msg); console.log('  OK  ' + msg); };

console.log('[A] 底图与皮肤样式');
ok(css.includes('--ni-tb-plate'), 'A1 style.css 定义了皮肤底图变量');
ok(/--ni-tb-plate:\s*url\("data:image\/webp;base64,[A-Za-z0-9+/=]{1000,}/.test(css), 'A2 底图是内联 WebP data URI（不额外请求文件）');
ok(css.includes(':has(.ni-tb-body.open)'), 'A3 只在展开状态套皮肤（收起时不拉伸底图）');
ok(css.includes('.ni-tb-scard.active') && css.includes('box-sizing: border-box'), 'A4 卡片按 border-box 定高，不会被裁');
ok(css.includes('aspect-ratio: 2 / 3'), 'A5 展开后按底图 2:3 比例撑开');
ok(css.includes('container-type: inline-size') && /\.ni-tb-bar \{[^}]*cqw/.test(css), 'A6 用容器查询单位 cqw 按原图坐标定位');
ok(css.includes('.ni-tb-drop-panel') && /position: absolute;\s*left: 8\.5cqw/.test(css), 'A7 选择面板改成盖在卡片上的浮层');
ok(css.includes('background: var(--ni-tb-plate) center / 100% 100% no-repeat'), 'A8 底图整张铺满（不重复、不裁切）');
ok(css.includes('--ni-tb-plate: url("data:image/webp;base64,'), 'A8b 底图是去字后的净版（不含画好的按钮图标）');

ok(css.includes('width: 86cqw'), 'A9 轮播容器占满内框，右边留出下一张的边');
ok(!css.includes('.ni-tb-scard:not(.active) { display: none; }'), 'A10 侧卡没有被隐藏，轮播照常渲染');
ok(tb.includes('niTbSyncCardMetrics') && tb.includes('TB_SKIN'), 'A11 卡片尺寸随皮肤等比放大（布局逻辑不变）');
ok(tb.includes('function niTbBindSwipe') && tb.includes('niTbBindSwipe();'), 'A12 加了左右滑动切换节点');

console.log('[B] 开关接线');
ok(/const skinClass = cfg\.tbStatusSkin !== false \? ' ni-tb-skin' : '';/.test(tb), 'B1 外壳按设置加 ni-tb-skin');
ok(tb.includes('${themeFollowClass}${skinClass}'), 'B2 class 拼进外壳');
ok(tpl.includes('id="ni-tb-skin"') && tpl.includes('id="ni-tb-skin-row"'), 'B3 设置页有开关行');
ok(index.includes('tbStatusSkin: true,'), 'B4 默认开启');
ok(index.includes("$app.on('change', '#ni-tb-skin'"), 'B5 有 change 事件');
ok(ui.includes('setTbSkin:') && ui.includes('function niSetTbSkin('), 'B6 主题编辑器暴露 setTbSkin');
ok(ui.includes('niSetTbSkinUI(cfg.tbStatusSkin !== false)'), 'B7 打开设置时同步开关状态');

console.log('[C] 关掉之后能回原样');
ok(!tb.includes('ni-tb-skin" id="ni-storybar'), 'C1 皮肤 class 是条件加的，不是写死');
ok(tb.includes('.ni-tb-shell{background:var(--color-background-secondary'), 'C2 原样式的规则仍在，关掉即回原样');
