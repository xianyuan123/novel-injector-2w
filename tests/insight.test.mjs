/**
 * 新增的四样东西：注入溯源 / 数据体检 / 知情矩阵 / 预算沙盘。
 * 数据体检与知情矩阵是纯函数，直接 import 进来喂假数据；
 * 溯源与沙盘贴着 DOM 与注入管线，用源码断言 + 关键结构检查。
 */
import assert from 'node:assert/strict';
import { readPlugin, pluginUrl } from './_paths.mjs';

const idx = readPlugin('index.js');
const vectorSrc = readPlugin('lib/vector-system.js');
const template = readPlugin('template.html');
const style = readPlugin('style.css');

const { niCollectHealthChecks, niRenderHealthReport } = await import(pluginUrl('lib/health-system.js'));
const { niBuildKnowledgeMatrix, niRenderKnowledgeMatrix } = await import(pluginUrl('lib/knowledge-matrix.js'));

let pass = 0;
const failures = [];
function check(name, fn) {
    try {
        fn();
        pass += 1;
        console.log(`  ok   ${name}`);
    } catch (error) {
        failures.push({ name, error });
        console.log(`  FAIL ${name}\n       ${error?.message || error}`);
    }
}
const group = title => console.log(title);

// ───────────────────────── 数据体检 ─────────────────────────
group('A. 数据体检');

function makeState(extra = {}) {
    return {
        stageMapN: 3,
        plots: {
            main: [
                { id: 'm1', title: '开场', stageIdx: 1, body: '老王出场，苏晚在旁。' },
                { id: 'm2', title: '转折', stageIdx: 2, body: '苏晚离开。' },
                { id: 'm3', title: '尾声', stageIdx: 3, body: '老王又冒了出来。' },
                { id: 'm4', title: '找不到家的节点', stageIdx: 9, body: '这一段挂在不存在的阶段上。' },
            ],
            sub: [],
            pivot: [],
        },
        characters: [
            { name: '苏晚' },
            { name: '苏晚' },
            { name: '编出来的人' },
            { name: '老王', exitStage: 1 },
        ],
        chunkStatus: ['done', 'pending', 'failed'],
        stageVecDone: { 1: true },
        rawText: '老王出场，苏晚在旁。苏晚离开。',
        chunks: [{ text: '老王出场，苏晚在旁。' }],
        ...extra,
    };
}

check('A1 重名角色会被挑出来，并给出「怎么修」', () => {
    const result = niCollectHealthChecks(makeState());
    const group_ = result.groups.find(item => item.id === 'dup-char');
    assert.ok(group_, '没查出重名');
    assert.ok(group_.items.length >= 1);
    assert.ok(group_.items[0].fix, '没有修复建议');
    assert.equal(group_.level, 'warn');
});

check('A2 阶段号超出总阶段数的节点算孤儿', () => {
    const result = niCollectHealthChecks(makeState());
    const orphan = result.groups.find(item => item.id === 'orphan-node');
    assert.ok(orphan, '没查出孤儿节点');
    assert.ok(orphan.items.some(item => String(item.detail).includes('第 9 阶段')));
});

check('A3 有节点没向量的阶段会被列出（第 2、3 阶段）', () => {
    const result = niCollectHealthChecks(makeState());
    const missing = result.groups.find(item => item.id === 'missing-vec');
    assert.ok(missing, '没查出缺向量阶段');
    assert.equal(missing.items.length, 2);
    assert.equal(missing.level, 'info');
});

check('A4 没清完的段（pending / failed）都会列出来', () => {
    const result = niCollectHealthChecks(makeState());
    const pending = result.groups.find(item => item.id === 'clean-pending');
    assert.ok(pending);
    assert.equal(pending.items.length, 2, 'pending 与 failed 应该各占一条');
});

check('A5 正文里一次都没出现的角色算「幻影角色」', () => {
    const result = niCollectHealthChecks(makeState());
    const ghost = result.groups.find(item => item.id === 'ghost-char');
    assert.ok(ghost, '没查出幻影角色');
    assert.ok(ghost.items.some(item => item.label === '编出来的人'));
    assert.ok(!ghost.items.some(item => item.label === '苏晚'), '正文里有的角色不该被误报');
});

check('A6 已退场却在后面又出现的角色算「诈尸」', () => {
    const result = niCollectHealthChecks(makeState());
    const zombie = result.groups.find(item => item.id === 'zombie-char');
    assert.ok(zombie, '没查出诈尸');
    assert.ok(zombie.items.some(item => String(item.label).includes('老王')));
});

check('A7 干净的数据返回空 groups，渲染成「没查出问题」', () => {
    const clean = { stageMapN: 0, plots: { main: [], sub: [], pivot: [] }, characters: [], chunkStatus: [], rawText: '' };
    const result = niCollectHealthChecks(clean);
    assert.equal(result.groups.length, 0);
    assert.equal(result.summary.total, 0);
    assert.ok(niRenderHealthReport(result).includes('没查出问题'));
});

check('A8 warn 组排在 info 组前面，summary 数字对得上', () => {
    const result = niCollectHealthChecks(makeState());
    const levels = result.groups.map(item => item.level);
    const firstInfo = levels.indexOf('info');
    if (firstInfo >= 0) {
        assert.ok(!levels.slice(firstInfo).includes('warn'), 'warn 组被排到 info 后面了');
    }
    const warnCount = result.groups.filter(item => item.level === 'warn').length;
    const itemTotal = result.groups.reduce((sum, group) => sum + group.items.length, 0);
    assert.equal(result.summary.warn, warnCount);
    assert.equal(result.summary.total, itemTotal);
});

// ───────────────────────── 知情矩阵 ─────────────────────────
group('B. 角色 × 阶段知情矩阵');

function makeMatrixState(extra = {}) {
    return {
        stageMapN: 6,
        characters: [
            {
                name: '苏晚',
                category: '主角',
                identities: [
                    { label: '药庐学徒' },
                    { label: '剑主', fromStage: 3 },
                ],
                knowledge: [
                    { fact: '师父已死', fromStage: 5 },
                ],
            },
            {
                name: '黑影',
                identities: [{ label: '蒙面人', secret: true, revealAt: 4 }],
                knowledge: [],
            },
            { name: '空角色' },
        ],
        ...extra,
    };
}

check('B1 只记「发生变化」的阶段，不是每个阶段都铺一遍', () => {
    const matrix = niBuildKnowledgeMatrix(makeMatrixState());
    const su = matrix.chars.find(char => char.name === '苏晚');
    assert.deepEqual(su.points.map(point => point.stage), [1, 3, 5]);
});

check('B2 身份层按 fromStage 生效，已知事实按阶段累积', () => {
    const matrix = niBuildKnowledgeMatrix(makeMatrixState());
    const su = matrix.chars.find(char => char.name === '苏晚');
    const at3 = su.points.find(point => point.stage === 3);
    assert.deepEqual(at3.visible, ['药庐学徒', '剑主']);
    const at5 = su.points.find(point => point.stage === 5);
    assert.deepEqual(at5.facts, ['师父已死']);
});

check('B3 秘密身份在揭晓前进 hidden，揭晓后进 visible', () => {
    const matrix = niBuildKnowledgeMatrix(makeMatrixState());
    const hei = matrix.chars.find(char => char.name === '黑影');
    assert.deepEqual(hei.points.map(point => point.stage), [1, 4]);
    assert.deepEqual(hei.points[0].hidden, ['蒙面人']);
    assert.deepEqual(hei.points[0].visible, []);
    assert.deepEqual(hei.points[1].visible, ['蒙面人']);
    assert.deepEqual(hei.points[1].hidden, []);
});

check('B4 currentStage 会标出「当前」那一步', () => {
    const matrix = niBuildKnowledgeMatrix(makeMatrixState(), { currentStage: 4 });
    const su = matrix.chars.find(char => char.name === '苏晚');
    assert.equal(su.current.stage, 3);
    const html = niRenderKnowledgeMatrix(matrix);
    assert.ok(html.includes('第 3 阶段 · 当前'));
});

check('B5 没填身份/事实的角色不进矩阵；渲染里秘密有单独标记', () => {
    const matrix = niBuildKnowledgeMatrix(makeMatrixState());
    assert.ok(!matrix.chars.some(char => char.name === '空角色'));
    const html = niRenderKnowledgeMatrix(matrix);
    assert.ok(html.includes('秘密：蒙面人'));
    assert.ok(html.includes('ni-km-chip secret'));
});

check('B6 一个都没有时给出去哪儿填的提示', () => {
    const html = niRenderKnowledgeMatrix(niBuildKnowledgeMatrix({ stageMapN: 3, characters: [] }));
    assert.ok(html.includes('ni-km-empty'));
    assert.ok(html.includes('身份层'));
});

// ───────────────────────── 注入溯源 ─────────────────────────
group('C. 注入溯源');

check('C1 召回结果里带 trace：每块的分、关键词、是否被预算丢掉', () => {
    assert.ok(vectorSrc.includes('trace'), '没有 trace');
    const from = vectorSrc.indexOf('const traceRow =');
    assert.ok(from > 0, '找不到 traceRow');
    const block = vectorSrc.slice(from, from + 1200);
    assert.ok(/chunkIdx/.test(block) && /stageIdx/.test(block));
    assert.ok(/score/.test(block));
    assert.ok(/hits/.test(block));
    assert.ok(/kept/.test(block), '没有标记「留下还是被丢」');
});

check('C2 trace 通过 onTrace 回调交出去，正常注入路径不受影响', () => {
    assert.ok(vectorSrc.includes('opts.onTrace'));
    assert.ok(/try\s*\{[^}]*onTrace/.test(vectorSrc), 'onTrace 回调没有 try 保护');
});

check('C3 预览弹窗把溯源渲染在召回列表下面', () => {
    assert.ok(template.includes('id="ni-inj-trace"'));
    assert.ok(idx.includes('niRenderRecallTrace'));
    assert.ok(idx.includes("q('#ni-inj-trace')") || idx.includes("'#ni-inj-trace'"));
    assert.ok(style.includes('.ni-trace-list'));
    assert.ok(style.includes('.ni-trace-drop'));
});

// ───────────────────────── 预算沙盘 ─────────────────────────
group('D. 预算沙盘');

check('D1 滑条与结果区都在注入策略面板里', () => {
    assert.ok(template.includes('id="ni-budget-range"'));
    assert.ok(template.includes('id="ni-budget-out"'));
    const injStart = template.indexOf('id="ni-stage-inj-body"');
    const budgetAt = template.indexOf('id="ni-budget-range"');
    assert.ok(injStart > 0 && budgetAt > injStart, '滑条不在折叠区里');
});

check('D2 沙盘用「假设的预算」重算计划，不动真实设置', () => {
    assert.ok(idx.includes('niRenderBudgetSandbox'));
    assert.ok(/plotInjMaxTokens: t/.test(idx), '没有用试算值覆盖预算');
    assert.ok(/Object\.assign\(\{\}, cfg, \{ plotInjMaxTokens: t \}\)/.test(idx), '直接改了真实配置');
});

check('D3 结果里会指出「先掉哪个阶段」，没有掉就明说都能装下', () => {
    assert.ok(idx.includes('先掉的阶段'));
    assert.ok(idx.includes('这个预算下都能装下'));
    assert.ok(style.includes('.ni-budget-drop'));
});

check('D4 拖动有防抖，不是每像素都重算一次', () => {
    assert.ok(/setTimeout\(\(\)\s*=>\s*\{[\s\S]{0,120}niRenderBudgetSandbox/.test(idx));
    assert.ok(idx.includes('clearTimeout(_niBudgetTimer)'));
});

// ───────────────────────── 接线 ─────────────────────────
group('E. 接线完整性');

check('E1 四个入口都在模板里：体检按钮、矩阵按钮与弹窗、溯源容器、沙盘滑条', () => {
    assert.ok(template.includes('id="ni-btn-health"'));
    assert.ok(template.includes('id="ni-btn-knowledge"'));
    assert.ok(template.includes('id="ni-knowledge-modal"'));
    assert.ok(template.includes('id="ni-health-report"'));
});

check('E2 每个入口都有事件绑定，不是只有壳', () => {
    assert.ok(idx.includes("$app.on('click', '#ni-btn-health'"));
    assert.ok(idx.includes("$app.on('click', '#ni-btn-knowledge'"));
    assert.ok(idx.includes("$app.on('click', '#ni-knowledge-close'"));
    assert.ok(idx.includes("$app.on('input', '#ni-budget-range'"));
});

check('E3 新弹窗具备 dialog 语义且能关掉', () => {
    const at = template.indexOf('id="ni-knowledge-modal"');
    const block = template.slice(at, at + 700);
    assert.ok(block.includes('role="dialog"'));
    assert.ok(block.includes('aria-modal="true"'));
    assert.ok(block.includes('aria-labelledby="ni-knowledge-title"'));
    assert.ok(block.includes('id="ni-knowledge-close"'));
});

check('E4 新模块都被 import 了（不是死文件）', () => {
    assert.ok(idx.includes("from './lib/health-system.js'"));
    assert.ok(idx.includes("from './lib/knowledge-matrix.js'"));
});

console.log('');
if (failures.length) {
    console.log(`通过 ${pass} 项，失败 ${failures.length} 项`);
    process.exitCode = 1;
} else {
    console.log(`通过 ${pass} 项 ✅`);
}
