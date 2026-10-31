// 状态栏组件（lib/transbook-bar.js）的纯函数与结构测试。
// 组件本身跑在浏览器里（Shadow DOM），这里只测「不碰 DOM 也能验证」的部分：
// 槽位表、state → HTML、变量映射、事件契约文案、接线。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const PLUGIN_ROOT = path.dirname(fileURLToPath(import.meta.url)) + '/..';
const readPlugin = (rel) => readFileSync(path.join(PLUGIN_ROOT, rel), 'utf8');
import {
    NI_TB_LAYOUT,
    niStoryBarHTML,
    niDefineStoryBar,
    NiStoryBar
} from '../lib/transbook-bar.js';

let pass = 0;
function ok(cond, name) {
    assert.ok(cond, name);
    pass++;
    console.log('  OK  ' + name);
}
function eq(a, b, name) {
    assert.deepEqual(a, b, name);
    pass++;
    console.log('  OK  ' + name);
}

const state = {
    open: true,
    status: '进行中',
    title: '君鹭远加入诡舍',
    meta: '节点 1 / 5',
    auto: true,
    paused: false,
    offCount: 3,
    cur: 1,
    skin: { accent: '#8f63c9', cardH: 210, radius: 16, veil: 0.3, art: 'data:image/webp;base64,AAAA' },
    nodes: [
        { num: '1', meta: '某日 · 诡舍', type: '主线', typeKind: 'main', title: '开场', desc: '第一段', extras: ['带着相册'], done: true },
        { num: '2', meta: '次日', type: '支线', typeKind: 'sub', title: '白潇潇的手腕', desc: '手腕僵住', extras: [], done: false },
        { num: '3', meta: '第三日', type: '转折', typeKind: 'turn', title: '门开了', desc: '门开', extras: [], done: false }
    ]
};

console.log('[A] 槽位表');
ok(Object.keys(NI_TB_LAYOUT).sort().join(',') === 'actions,bar,card,footer,next', 'A1 五个槽位齐全');
ok(NI_TB_LAYOUT.bar.h <= 12 && NI_TB_LAYOUT.footer.y > 80, 'A2 顶栏在上、底栏在下（百分比布局）');
ok(NI_TB_LAYOUT.card.w > NI_TB_LAYOUT.next.w, 'A3 主卡比侧卡宽（右侧露下一张）');

console.log('[B] state → HTML');
const html = niStoryBarHTML(state);
ok(html.includes('class="shell"'), 'B1 有外壳');
ok(html.includes('body open'), 'B2 open=true 时展开');
ok(!niStoryBarHTML({ ...state, open: false }).includes('body open'), 'B3 收起时不加 open');
ok((html.match(/class="card /g) || []).length === 3, 'B4 三张卡（上一张 / 当前 / 下一张）');
ok(html.includes('class="card active'), 'B5 当前卡带 active');
ok(html.includes('side next'), 'B6 下一张带 side next');
ok(html.includes('class="check on"'), 'B7 已演过的卡是实心圆点');
ok((html.match(/data-act="/g) || []).length >= 6, 'B8 五个按钮 + 底栏都走 data-act');
ok(html.includes('后台动向 3 条'), 'B9 后台动向条数');
ok(html.includes('✦ 自动'), 'B10 自动按钮文案');
console.log('[C] 转义与边界');
ok(niStoryBarHTML({ nodes: [{ title: '<img onerror=1>', desc: 'a & b' }] }).includes('&lt;img'), 'C1 标题被转义');
ok(niStoryBarHTML({ nodes: [{ desc: 'a & b' }] }).includes('a &amp; b'), 'C2 正文被转义');
ok(niStoryBarHTML({ nodes: [] }).includes('还没有剧情节点'), 'C3 无节点时有空态');
ok(niStoryBarHTML({ nodes: state.nodes, cur: 99 }).includes('card active'), 'C4 cur 越界被夹回最后一张');
ok(!niStoryBarHTML({ nodes: [{ title: 'x' }] }).includes('class="extras"'), 'C5 没有 extras 时不渲染该块');

console.log('[D] 组件与导出');
ok(typeof NiStoryBar === 'function', 'D1 导出 NiStoryBar 类');
ok(typeof niDefineStoryBar === 'function', 'D2 导出 niDefineStoryBar');
eq(niDefineStoryBar(), null, 'D3 Node 环境下（无 customElements）安全返回 null');
const src = readPlugin('lib/transbook-bar.js');
ok(src.includes("attachShadow({ mode: 'open' })"), 'D4 用 Shadow DOM 隔离');
ok(src.includes("new CustomEvent('ni-tb-act'"), 'D5 交互统一派发 ni-tb-act 事件');
ok(!/import\s/.test(src), 'D6 组件不 import 任何插件模块（完全独立）');
ok(src.includes('touch-action: pan-y'), 'D7 卡片纵向可滚、横向留给切卡');
ok(src.includes('--tb-art'), 'D8 底图走 CSS 变量');
console.log('[E] 接线');
const tb = readPlugin('lib/transbook-system.js');
ok(tb.includes("from './transbook-bar.js'"), 'E1 组件已被系统引入');
ok(tb.includes('niTbPaintStoryBar'), 'E2 有把 state 推给组件的绘制函数');
ok(!tb.includes("return `<ni-storybar id=\"ni-storybar\""), 'E3 不再渲染组件宿主（统一旧版）');
ok(tb.includes("addEventListener('ni-tb-act'"), 'E4 已监听组件的 ni-tb-act 事件');
ok(tb.includes('return niGetTbStoryBarHtmlLegacy(snapshot);'), 'E5 直接返回旧版渲染');
ok(tb.includes('function niTbById'), 'E6 元素查找会先 shadow 后 document');
ok(tb.includes('_niTbShadow.appendChild(st)'), 'E7 插件样式复制进 shadow，面板不脱样式');
const pkgFiles = JSON.parse(readPlugin('../_zip_files.json'));
ok(pkgFiles.includes('lib/transbook-bar.js'), 'E8 打包清单里已登记');


console.log('[F] 打开不卡死（防重入 + 样式只注入一次）');
ok(/niTbPaintStoryBar\._busy/.test(tb), 'F1 重绘有防重入锁');
ok(/niTbInjectShadowCss/.test(tb), 'F2 样式走独立的注入函数');
ok(/css\.length > 120000/.test(tb), 'F3 超大样式改用 <link>，不再每帧复制文本');

console.log(`\n通过 ${pass} 条`);
