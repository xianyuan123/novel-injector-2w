// 自动推进 — 推进动作、跨阶段、边界与接线测试
// 用真实 lib/transbook-system.js（复制到临时目录，不动源码）。
// 跑法：node tests/advance.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { PLUGIN_ROOT } from './_paths.mjs';

const SRC = PLUGIN_ROOT;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ni_adv_'));
const libDir = path.join(tmp, 'lib');
fs.mkdirSync(libDir, { recursive: true });
for (const name of fs.readdirSync(path.join(SRC, 'lib'))) {
    if (name.endsWith('.js')) fs.copyFileSync(path.join(SRC, 'lib', name), path.join(libDir, name));
}
const { createTransbookController } = await import(pathToFileURL(path.join(libDir, 'transbook-system.js')).href);

let bugs = 0;
const check = (label, cond, extra = '') => {
    if (cond) { console.log(`  ok   ${label}`); }
    else { bugs++; console.log(`  BUG  ${label} ${extra}`); }
};

// ── minimal DOM stub ────────────────────────────────────────────────
function makeEl() {
    const el = {
        id: '', className: '', textContent: '', innerHTML: '', value: '',
        dataset: {}, style: {}, children: [],
        classList: {
            _s: new Set(),
            add(...c) { c.forEach(x => this._s.add(x)); },
            remove(...c) { c.forEach(x => this._s.delete(x)); },
            toggle(c, force) {
                const want = force === undefined ? !this._s.has(c) : !!force;
                if (want) this._s.add(c); else this._s.delete(c);
                return want;
            },
            contains(c) { return this._s.has(c); },
        },
        addEventListener() {}, removeEventListener() {},
        appendChild(c) { this.children.push(c); return c; },
        insertAdjacentHTML() {}, insertAdjacentElement(_p, c) { return c; },
        querySelector() { return null; }, querySelectorAll() { return []; },
        closest() { return null; }, remove() {}, setAttribute() {}, getAttribute() { return null; },
        getBoundingClientRect() { return { width: 0, height: 0, top: 0, left: 0 }; },
    };
    return el;
}
const elCache = new Map();
globalThis.document = {
    head: makeEl(), body: makeEl(),
    getElementById(id) { if (!elCache.has(id)) { const e = makeEl(); e.id = id; elCache.set(id, e); } return elCache.get(id); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { return makeEl(); },
    addEventListener() {}, removeEventListener() {},
};
globalThis.window = globalThis.window || {};
globalThis.toastr = { info() {}, success() {}, error() {}, warning() {} };
globalThis.requestAnimationFrame = cb => cb();

// ── fake node list: 6 nodes, stage1 = 序幕/初见/拜师 ; stage2 = 下山/遇袭/结盟 ──
const mkPlot = (i, stageIdx, title) => ({
    id: `p${i}`, title, body: `body ${title}`, stageIdx,
    _type: 'main', _sourceIdx: i, _chunkIdx: 0, _chunkOrder: 0,
});
const plots = [
    mkPlot(1, 1, '序幕'), mkPlot(2, 1, '初见'), mkPlot(3, 1, '拜师'),
    mkPlot(4, 2, '下山'), mkPlot(5, 2, '遇袭'), mkPlot(6, 2, '结盟'),
];

function makeController(state, done = {}, extraCfg = {}) {
    const S = Object.assign({
        stageMapN: 2, stageStates: {}, stageTitles: { 1: '第一卷', 2: '第二卷' },
        characters: [], _vecRunning: false,
    }, state);
    const chat = [{}];
    const ext = { novelInjector: { transBookMode: true, tbDisplayStatusbar: true, ...extraCfg } };
    const ctl = createTransbookController({
        state: S,
        defaultSettings: {},
        extensionSettings: ext,
        extensionName: 'novelInjector',
        document: globalThis.document,
        globalWindow: globalThis.window,
        logger: { log() {}, warn() {}, error() {} },
        getContext: () => ({ chat, saveChat: async () => {} }),
        getAllPlotsInStoryOrder: () => plots,
        ensurePlotNodeId: plot => plot.id,
        resolveStageIdx: plot => plot.stageIdx,
        comparePlotOrder: (a, b) => (a._sourceIdx ?? 0) - (b._sourceIdx ?? 0),
        saveSettingsDebounced: () => {},
        defaultAdvancePrompt: 'A={A_TITLE} B={B_TITLE}',
    });
    chat[0].ni_tb = { nodeDone: { ...done } };
    ctl.niTbLoadState();
    return { ctl, S, chat };
}

const CROSS_OFF = { tbAutoAdvance: true, tbAutoAdvanceCrossStage: false };
const CROSS_ON = { tbAutoAdvance: true, tbAutoAdvanceCrossStage: true };

// ── T1: 阶段内逐节点推进 ────────────────────────────────────────────
console.log('T1 阶段内逐节点推进');
{
    const { ctl, S } = makeController({}, {}, CROSS_OFF);
    let nodes = ctl.niGetTbNodes();
    check('初始 6 个节点', nodes.length === 6, `got ${nodes.length}`);
    check('初始当前节点 = 序幕', nodes[S.tbCurIdx]?.title === '序幕', nodes[S.tbCurIdx]?.title);

    const r1 = await ctl.niTbAdvanceOneNode();
    nodes = ctl.niGetTbNodes();
    check('第 1 次推进后当前节点 = 初见', nodes[S.tbCurIdx]?.title === '初见', nodes[S.tbCurIdx]?.title);
    check('第 1 次推进 advanced=true', r1?.advanced === true, JSON.stringify(r1));
    check('序幕 已标记完成', nodes.find(n => n.title === '序幕')?.done === true);

    await ctl.niTbAdvanceOneNode();
    nodes = ctl.niGetTbNodes();
    check('第 2 次推进后当前节点 = 拜师', nodes[S.tbCurIdx]?.title === '拜师', nodes[S.tbCurIdx]?.title);
    check('初见 已标记完成', nodes.find(n => n.title === '初见')?.done === true);
    check('仍然在第 1 阶段', nodes[S.tbCurIdx]?.stageIdx === 1, String(nodes[S.tbCurIdx]?.stageIdx));
}

// ── T2a: 关掉跨阶段 → 阶段末尾停住 ─────────────────────────────────
console.log('T2a 跨阶段关闭时停在阶段末尾');
{
    const { ctl, S } = makeController({}, {}, CROSS_OFF);
    await ctl.niTbAdvanceOneNode();
    await ctl.niTbAdvanceOneNode();
    const r3 = await ctl.niTbAdvanceOneNode(); // 拜师 = 本阶段最后一个
    const nodes = ctl.niGetTbNodes();
    check('stageEnded=true', r3?.stageEnded === true, JSON.stringify(r3));
    check('advanced=false', r3?.advanced === false, JSON.stringify(r3));
    check('没有 crossed 标记', r3?.crossed !== true, JSON.stringify(r3));
    check('拜师 已标记完成', nodes.find(n => n.title === '拜师')?.done === true);
    check('当前节点仍停在第 1 阶段', nodes[S.tbCurIdx]?.stageIdx === 1, String(nodes[S.tbCurIdx]?.stageIdx));
    check('第 2 阶段节点未被自动完成', nodes.filter(n => n.stageIdx === 2).every(n => !n.done));
}

// ── T2b: 打开跨阶段 → 自动进入下一阶段首节点 ───────────────────────
console.log('T2b 跨阶段开启时自动进入下一阶段');
{
    const { ctl, S } = makeController({}, {}, CROSS_ON);
    await ctl.niTbAdvanceOneNode();
    await ctl.niTbAdvanceOneNode();
    const r3 = await ctl.niTbAdvanceOneNode();
    const nodes = ctl.niGetTbNodes();
    check('crossed=true', r3?.crossed === true, JSON.stringify(r3));
    check('advanced=true', r3?.advanced === true, JSON.stringify(r3));
    check('当前节点 = 下山', nodes[S.tbCurIdx]?.title === '下山', nodes[S.tbCurIdx]?.title);
    check('当前阶段 = 2', nodes[S.tbCurIdx]?.stageIdx === 2, String(nodes[S.tbCurIdx]?.stageIdx));
    check('第 2 阶段已解锁', nodes.filter(n => n.stageIdx === 2).every(n => n.locked === false));
    check('第 2 阶段节点未被误标完成', nodes.filter(n => n.stageIdx === 2).every(n => !n.done));
    check('跨阶段也准备了推进提示词', String(ctl.niTbPeekPendingAdvancePrompt() || '').includes('下山'));
}

// ── T3: 跳过已完成节点 ──────────────────────────────────────────────
console.log('T3 跳过已完成节点');
{
    const { ctl, S } = makeController({}, { p1: true, p2: true }, CROSS_OFF);
    const r = await ctl.niTbAdvanceOneNode(); // 当前=拜师(唯一未完成)
    const nodes = ctl.niGetTbNodes();
    check('拜师 变为完成', nodes.find(n => n.title === '拜师')?.done === true);
    check('阶段末尾停住', r?.stageEnded === true, JSON.stringify(r));
    check('没有跑到第 2 阶段', nodes[S.tbCurIdx]?.stageIdx === 1, String(nodes[S.tbCurIdx]?.stageIdx));
}

// ── T4: 未来阶段默认锁定，跨阶段时才解锁 ────────────────────────────
console.log('T4 未解锁阶段');
{
    const { ctl } = makeController({}, { p1: true }, CROSS_OFF);
    await ctl.niTbAdvanceOneNode();
    const mid = ctl.niGetTbNodes();
    check('阶段1 未走完时，阶段2 仍锁定', mid.filter(n => n.stageIdx === 2).every(n => n.locked === true));
    const r = await ctl.niTbAdvanceOneNode();
    const nodes = ctl.niGetTbNodes();
    check('关跨阶段：停在第 1 阶段', nodes.filter(n => n.stageIdx === 1).every(n => n.done) && nodes[0].stageIdx === 1);
    check('关跨阶段：结果 stageEnded', r?.stageEnded === true, JSON.stringify(r));
}

// ── T5: 边界与开关 ──────────────────────────────────────────────────
console.log('T5 边界与开关');
{
    const { ctl } = makeController({}, {}, CROSS_ON);
    await ctl.niTbAdvanceOneNode();
    check('连续调用不抛异常', true);

    const emptyCtl = createTransbookController({
        state: { stageMapN: 2, stageStates: {}, tbNodeDone: {} },
        defaultSettings: {}, extensionSettings: { novelInjector: { transBookMode: true } },
        extensionName: 'novelInjector', document: globalThis.document,
        globalWindow: globalThis.window, logger: { log() {}, warn() {}, error() {} },
        getContext: () => ({ chat: [{}], saveChat: async () => {} }),
        getAllPlotsInStoryOrder: () => [],
        ensurePlotNodeId: p => p.id, resolveStageIdx: p => p.stageIdx,
        saveSettingsDebounced: () => {},
    });
    const rEmpty = await emptyCtl.niTbAdvanceOneNode();
    check('空数据返回 null 不抛', rEmpty === null, JSON.stringify(rEmpty));

    const offCtl = createTransbookController({
        state: { stageMapN: 2, stageStates: {}, tbNodeDone: {} },
        defaultSettings: {}, extensionSettings: { novelInjector: { transBookMode: false } },
        extensionName: 'novelInjector', document: globalThis.document,
        globalWindow: globalThis.window, logger: { log() {}, warn() {}, error() {} },
        getContext: () => ({ chat: [{}], saveChat: async () => {} }),
        getAllPlotsInStoryOrder: () => plots,
        ensurePlotNodeId: p => p.id, resolveStageIdx: p => p.stageIdx,
        saveSettingsDebounced: () => {},
    });
    const rOff = await offCtl.niTbAdvanceOneNode();
    check('穿书模式关闭时返回 null', rOff === null, JSON.stringify(rOff));

    // 暂停要挡住推进：状态只能在控制器里设，构造时的 state 会被初始化重置。
    const pausedCtl = makeController({}, {}, CROSS_ON).ctl;
    pausedCtl.niTbSetPaused(true);
    const rPaused = await pausedCtl.niTbAdvanceOneNode();
    check('暂停时不推进', rPaused === null, JSON.stringify(rPaused));
    check('暂停时不标记节点完成', pausedCtl.niGetTbNodes().every(n => !n.done));
}

// ── T6: 推进提示词准备 ──────────────────────────────────────────────
console.log('T6 推进提示词准备');
{
    const { ctl } = makeController({}, {}, CROSS_OFF);
    await ctl.niTbAdvanceOneNode();
    const pending = ctl.niTbPeekPendingAdvancePrompt();
    check('提示词已准备', typeof pending === 'string' && pending.includes('初见'), JSON.stringify(pending));
    ctl.niTbConsumePendingAdvancePrompt();
    await ctl.niTbAdvanceOneNode();
    const p2 = ctl.niTbPeekPendingAdvancePrompt();
    check('下一对节点提示词不同', String(p2).includes('拜师'), JSON.stringify(p2));
}

// ── T7: 自动推进上下文接口 ──────────────────────────────────────────
console.log('T7 自动推进上下文');
{
    const { ctl, S } = makeController({}, {}, CROSS_ON);
    const ctx = ctl.niTbGetAutoAdvanceContext();
    check('上下文存在', !!ctx, JSON.stringify(ctx));
    check('enabled 跟随开关', ctx?.enabled === true, JSON.stringify(ctx?.enabled));
    check('带当前节点', !!ctx?.curNode?.title, JSON.stringify(ctx?.curNode?.title));
    check('带阶段标题', ctx?.stageTitle === '第一卷', String(ctx?.stageTitle));
    check('judging=false', ctx?.judging === false, String(ctx?.judging));
    check('advancing=false', ctx?.advancing === false, String(ctx?.advancing));

    ctl.niTbSetAutoAdvanceJudging(true);
    check('设置判定中', S.tbAutoAdvanceJudging === true && ctl.niTbGetAutoAdvanceContext()?.judging === true);
    ctl.niTbSetAutoAdvanceJudging(false);
    check('清掉判定中', S.tbAutoAdvanceJudging === false);

    const offCtl = makeController({}, {}, { tbAutoAdvance: false }).ctl;
    check('关闭时不启用', offCtl.niTbGetAutoAdvanceContext()?.enabled === false);
    const paused = makeController({}, {}, CROSS_ON).ctl;
    paused.niTbSetPaused(true);
    check('暂停时标记 paused', paused.niTbGetAutoAdvanceContext()?.paused === true);
    check('暂停时 enabled 仍为真（由 paused 单独表达）', paused.niTbGetAutoAdvanceContext()?.enabled === true);
}

// ── T8: 导出与界面接线 ──────────────────────────────────────────────
console.log('T8 导出与界面接线');
{
    const tb = fs.readFileSync(path.join(SRC, 'lib', 'transbook-system.js'), 'utf8');
    const tpl = fs.readFileSync(path.join(SRC, 'template.html'), 'utf8');
    check('导出 niTbAdvanceOneNode', /niTbAdvanceOneNode,/.test(tb));
    check('导出 niTbGetAutoAdvanceContext', /niTbGetAutoAdvanceContext,/.test(tb));
    check('导出 niTbSetAutoAdvanceJudging', /niTbSetAutoAdvanceJudging,/.test(tb));
    check('状态栏无手动推进按钮', !tb.includes('id="ni-tb-btn-advance"'));
    check('状态栏有自动徽标', tb.includes('id="ni-tb-btn-auto-adv"'));
    check('旧的 tbQuickAdvance 已彻底移除', !tb.includes('tbQuickAdvance'));
    check('模板无手动推进开关', !tpl.includes('id="ni-tb-quick-advance"'));
    check('模板有自动推进开关', tpl.includes('id="ni-tb-auto-advance"'));
    check('模板有跨阶段开关', tpl.includes('id="ni-tb-auto-cross-stage"'));
    check('默认开启自动推进', /DEFAULT_SETTINGS\.tbAutoAdvance\s*=\s*true/.test(tb));
    check('默认开启跨阶段', /DEFAULT_SETTINGS\.tbAutoAdvanceCrossStage\s*=\s*true/.test(tb));
    check('默认阈值 0.7', /DEFAULT_SETTINGS\.tbAutoAdvanceThreshold\s*=\s*0\.7/.test(tb));
}

console.log(bugs === 0 ? '\n结果：0 个 BUG' : `\n结果：${bugs} 个 BUG`);
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(bugs === 0 ? 0 : 1);
