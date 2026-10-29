// novel-injector: floor mutation -> deviation analysis cleanup regression test.
// The real lib/world-system.js is copied to a temp dir, minimally patched to expose
// the internal entry points, then driven through regenerate / edit / delete flows.
// 注意：本文件含中文，禁止用 PowerShell Get-Content/Set-Content 往返读写（会按 GBK 解码损坏）。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PLUGIN_ROOT } from './_paths.mjs';
import { pathToFileURL } from 'node:url';

const SRC = PLUGIN_ROOT;
const TMP = path.join(os.tmpdir(), 'ni_devroll_' + Date.now());
(function cp(a, b) {
    fs.mkdirSync(b, { recursive: true });
    for (const e of fs.readdirSync(a, { withFileTypes: true })) {
        if (e.name === '.git') continue;
        e.isDirectory() ? cp(path.join(a, e.name), path.join(b, e.name))
                        : fs.copyFileSync(path.join(a, e.name), path.join(b, e.name));
    }
})(SRC, TMP);

const WS = path.join(TMP, 'lib/world-system.js');
let src = fs.readFileSync(WS, 'utf8');
const NEEDLE = '        niBindDeviationAutoUpdateEvents,\n';
const EXPOSE = '        niCaptureDevChatSnapshot,\n        niHandleDevChatMutation,\n        niDevResetSnapshot: () => { _niDevChatSnapshot = null; _niDevDirtyFloors.clear(); },\n';
if (!src.includes(NEEDLE)) { console.log('FATAL: cannot find insertion point in world-system.js'); process.exit(2); }
src = src.replace(NEEDLE, EXPOSE + NEEDLE);
fs.writeFileSync(WS, src);

const ws = await import(pathToFileURL(WS).href);
const sd = await import(pathToFileURL(path.join(TMP, 'lib/story-data.js')).href);
// 先单独确认清理原语本身没问题：只把第 3 层（0 基 2）标成失效，只该掉那一条。
{
    const fm = new Map(); for (let i = 0; i < 8; i++) fm.set(i, i);
    const f = (id, floor) => ({ id: 'fact:' + id, text: 'T' + id, status: 'active', sourceFloor: floor, createdFloor: floor, updatedFloor: null, confirmedFloor: floor });
    const out = sd.niPruneDeviationState({ facts: [f(1, 1), f(2, 2), f(3, 7), f(4, 6)], factHistory: [], changedFacts: '', currentConstraint: 'c', preservedFacts: 'p', coveredFloor: 7, lastRange: { startFloor: 0, endFloor: 7 } }, { floorMap: fm, invalidFloors: [2], firstChangedFloor: 2 });
    const left = out.state.facts.map(x => x.id).sort().join(',');
    if (left === 'fact:1,fact:3,fact:4') console.log('  OK   清理原语坐标系正确（只掉 fact:2）');
    else { console.log('  BUG  清理原语坐标系异常，剩余 ' + left); }
}

let bad = 0;
const ok = m => console.log('  OK   ' + m);
const B = m => { bad++; console.log('  BUG  ' + m); };

// ---------------- fixture ----------------
const chat = [];
function msg(i) {
    return { mes: 'AI 正文第' + i + '层', is_user: false, is_system: false, swipes: ['a', 'b'], swipe_id: 0, name: 'Char' };
}
for (let i = 1; i <= 8; i++) chat.push(msg(i));

const S = {};
const extension_settings = { novel_injector: { devAutoUpdateEnabled: true, devAutoUpdateEvery: 8 } };
const EXT_NAME = 'novel_injector';
const DEFAULT_SETTINGS = { devAutoUpdateEnabled: true, devAutoUpdateEvery: 8, devRecentLimit: 12, recallTopK: 30, recallThresh: 0.5 };

const floorEl = {
    style: {}, textContent: '', checked: false, value: '',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, appendChild() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    dataset: {}, setAttribute() {}, remove() {},
};
const fakeEl = new Proxy(floorEl, {
    get(t, k) {
        if (k in t) return t[k];
        if (k === 'children') return [];
        return () => null;
    },
});
const q = () => null;
const document = {
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    createElement: () => fakeEl, addEventListener() {}, head: { appendChild() {} }, body: { appendChild() {} },
};

const ctx = { chat, chatId: 'chat-1', saveChat: async () => {} };
const getContext = () => ctx;

const noop = () => {};
const identity = (v) => v;

const ctl = ws.createGenerationController({
    S,
    extension_settings,
    EXT_NAME,
    DEFAULT_SETTINGS,
    q,
    getContext,
    document,
    toastr: { info: noop, success: noop, warning: noop, error: noop },
    saveSettingsDebounced: noop,
    niNormalizeDeviationSections: identity,
    niBuildDeviationGuideFromSections: () => '',
    niParseDeviationGuideSections: () => ({}),
    niBuildDeviationFactsText: () => '',
    niBuildDeviationFactsContext: () => '',
    niNormalizeDevRange: identity,
    niDevRangeLabel: () => '',
    niDevRangeProgressLabel: () => '',
    niBuildDeviationSectionsFromAnalysis: identity,
    niMergeDeviationSections: identity,
    niReconcileDeviationFacts: () => ({ changes: [] }),
    niBuildDevChatEntriesText: () => '',
    niDevIsCountableMessage: () => true,
    niDevMessageFloor: () => 0,
    niDevMessageMesId: () => 0,
    niDevMessageRole: () => 'assistant',
    niDevMessageText: (m) => String(m?.mes || ''),
    niMergeDevMessagesByFloor: (a) => a,
    niBoundIntValue: (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d),
    getNodesForStage: () => [],
    niMergeStageNodes: (a) => a,
    recallRelevant: async () => [],
    niResolveVectorRecallStageScopes: () => [],
    niGetTbNodes: () => [],
    niTbGetInjectionNode: () => null,
    callCleanApi: async () => ({ ok: true }),
    niSaveSettings: noop,
    niServerSaveHeavy: async () => true,
    eventSource: { on: noop, emit: noop, emitAndWait: async () => {} },
    event_types: {},
    DEV_PROMPT: '', STYLE_PROMPT: '',
    NI_DEV_CURRENT_TEXT_LIMIT: 1, NI_DEV_RECALL_TEXT_LIMIT: 1,
});

function fact(id, floor, text) {
    return { id: 'fact:' + id, text: text || ('事实' + id), status: 'active', sourceFloor: floor, createdFloor: floor, updatedFloor: null, confirmedFloor: floor };
}
function seed(facts, coveredFloor, lastRange) {
    S.devFacts = facts;
    S.devFactHistory = [];
    S.devChangedFacts = 'changed';
    S.deviationGuide = 'guide';
    S.devCoveredFloor = coveredFloor;
    S.devLastRange = lastRange || null;
    chat[0].ni_dev = {
        schemaVersion: 1,
        sourceFloorVersion: 2,
        facts,
        factHistory: [],
        changedFacts: 'changed',
        currentConstraint: 'constraint',
        preservedFacts: 'preserved',
        deviationGuide: 'guide',
        coveredFloor,
        lastRange: lastRange || null,
    };
}
function report() {
    const saved = chat[0].ni_dev;
    const list = saved?.facts || S.devFacts || [];
    const factFloors = {};
    list.forEach(f => { factFloors[f.id] = f.sourceFloor; });
    return {
        ids: list.map(f => f.id),
        covered: saved?.coveredFloor ?? S.devCoveredFloor,
        constraint: saved?.currentConstraint ?? '',
        factFloors,
    };
}
function rebuild(n) {
    chat.length = 0;
    for (let i = 0; i < n; i++) {
        chat.push({ mes: '第 ' + i + ' 层正文', is_user: false, is_system: false, swipes: ['a'], swipe_id: 0, name: 'Char' });
    }
}
// 每个用例必须从「干净的快照」开始。否则上一个用例留下的快照里存的是旧数组，
// 新用例把整段消息换成新对象后，对象身份对齐会失败，floorMap 就会缺项，
// 于是出现「明明只是中间删一楼，却把前面幸存的楼层也判成失效」的假 BUG。
function fresh(n) {
    ctl.niDevResetSnapshot();
    rebuild(n);
    ctl.niCaptureDevChatSnapshot();
}

// ---------------- T1: regenerate floor 8 (regenerate = in-place rewrite) ----------------
console.log('T1 重新生成第 8 楼（原地改写正文）');
seed([fact(1, 2, 'A'), fact(2, 5, 'B'), fact(3, 7, 'C')], 7, { startFloor: 0, endFloor: 7 });
ctl.niCaptureDevChatSnapshot();
chat[7].mes = 'AI 重写后的第8层';          // SillyTavern regenerate rewrites chat[7].mes in place
chat[7].swipes = ['a', 'b', 'c'];
const r1 = await ctl.niHandleDevChatMutation({ swipedFloor: 7 });
const p1 = report();
if (r1 === true) ok('regenerate 被识别为楼层变更'); else B('regenerate 没有被识别（返回 ' + r1 + '）');
if (!p1.ids.includes('fact:3')) ok('第 8 楼（0 基下标 7）对应的偏差已删除，剩余 ' + JSON.stringify(p1.ids));
else B('第 8 楼对应的偏差仍然存在: ' + JSON.stringify(p1.ids));
if (p1.ids.includes('fact:1') && p1.ids.includes('fact:2')) ok('低楼层偏差未被误删');
else B('低楼层偏差被误删: ' + JSON.stringify(p1.ids));
if (!p1.constraint) ok('偏差约束摘要已清空');
else B('偏差约束摘要没有清空: ' + p1.constraint);

// ---------------- T2: regenerate without swipedFloor argument ----------------
console.log('T2 只靠内容签名发现原地改写（不传 swipedFloor）');
seed([fact(1, 2, 'A'), fact(2, 5, 'B'), fact(3, 7, 'C')], 7, { startFloor: 0, endFloor: 7 });
ctl.niCaptureDevChatSnapshot();
chat[7].mes = '又一次重写的第8层';
const r2 = await ctl.niHandleDevChatMutation();
const p2 = report();
if (r2 === true) ok('纯内容变化也能触发清理'); else B('纯内容变化没有被识别（返回 ' + r2 + '）');
if (!p2.ids.includes('fact:3')) ok('第 8 楼偏差已删除，剩余 ' + JSON.stringify(p2.ids));
else B('第 8 楼偏差仍存在: ' + JSON.stringify(p2.ids));

// ---------------- T3: edit a middle floor (floor 5, 0-based 4) ----------------
console.log('T3 编辑第 5 楼正文');
seed([fact(1, 2, 'A'), fact(2, 4, 'B'), fact(3, 7, 'C')], 7, { startFloor: 0, endFloor: 7 });
ctl.niCaptureDevChatSnapshot();
chat[4].mes = '手改的第5层';
const r3 = await ctl.niHandleDevChatMutation({ swipedFloor: 4 });
const p3 = report();
if (r3 === true) ok('编辑被识别为楼层变更'); else B('编辑没有被识别（返回 ' + r3 + '）');
if (!p3.ids.includes('fact:2')) ok('第 5 楼偏差已删除，剩余 ' + JSON.stringify(p3.ids));
else B('第 5 楼偏差仍存在: ' + JSON.stringify(p3.ids));

// ---------------- T4: delete the whole tail from floor 6 on ----------------
console.log('T4 删除第 6 楼及之后的楼层');
fresh(8);
seed([fact(1, 2, 'A'), fact(2, 5, 'B'), fact(3, 7, 'C')], 7, { startFloor: 0, endFloor: 7 });
chat.splice(4);                              // keep floors 0..3
const r4 = await ctl.niHandleDevChatMutation();
const p4 = report();
if (r4 === true) ok('删除被识别为楼层变更'); else B('删除没有被识别（返回 ' + r4 + '）');
if (p4.ids.length === 1 && p4.ids[0] === 'fact:1') ok('只有第 2 楼的偏差保留，其余已清: ' + JSON.stringify(p4.ids));
else B('删除后剩余偏差不符合预期: ' + JSON.stringify(p4.ids));
if (p4.covered <= 3) ok('coveredFloor 收敛到剩余楼层范围内 (' + p4.covered + ')');
else B('coveredFloor 没有收敛: ' + p4.covered);

// ---------------- T5: no real change -> must NOT wipe anything ----------------
console.log('T5 没有任何变更时不得误清理');
fresh(8);
seed([fact(1, 2, 'A'), fact(2, 5, 'B')], 7, { startFloor: 0, endFloor: 7 });
const r5 = await ctl.niHandleDevChatMutation();
const p5 = report();
if (r5 === false) ok('无变更时返回 false'); else B('无变更时返回了 ' + r5);
if (p5.ids.length === 2 && p5.constraint === 'constraint') ok('偏差与约束都原样保留');
else B('无变更却改动了偏差: ' + JSON.stringify(p5));

// ---------------- T6: only the changed floor is cleaned ----------------
console.log('T6 只改第 3 楼时，只有第 3 楼（0 基 2）被清理');
fresh(8);
seed([fact(1, 1, 'A'), fact(2, 2, 'B'), fact(3, 7, 'C'), fact(4, 6, 'D')], 7, { startFloor: 0, endFloor: 7 });
chat[2].mes = '改过的第3层';
chat[2].swipes = ['改过的第3层', 'b'];
const r6 = await ctl.niHandleDevChatMutation({ swipedFloor: 2 });
const p6 = report();
const survived6 = p6.ids.slice().sort().join(',');
if (r6 === true && survived6 === 'fact:1,fact:3,fact:4') ok('只清理了第 3 楼的偏差，其余保留: ' + survived6);
else B('清理范围不对: r=' + r6 + ' ids=' + survived6);
if (p6.constraint === '') ok('约束摘要被清空（被改写的楼层落在已分析范围内）');
else B('约束摘要没有清空: ' + p6.constraint);

// ---------------- T7: delete a floor from the MIDDLE (indices after it shift) ----------------
console.log('T7 删除中间某一楼（后面的楼层下标整体前移）');
fresh(8);
seed([...Array(8)].map((_, i) => fact(i + 1, i, 'F' + i)), 7, { startFloor: 0, endFloor: 7 });
chat.splice(4, 1);                            // 删掉第 4 层，第 5~7 层前移到 4~6
const r7 = await ctl.niHandleDevChatMutation();
const p7 = report();
const survived7 = p7.ids.slice().sort().join(',');
if (r7 === true) ok('删除中间楼层被识别'); else B('删除中间楼层没被识别（返回 ' + r7 + '）');
// fact(i+1) 锚在旧下标 i：删掉旧下标 4 就是删掉 fact:5，其余楼层整体前移一位。
if (survived7 === 'fact:1,fact:2,fact:3,fact:4,fact:6,fact:7,fact:8') ok('被删那层（fact:5@4）的偏差消失，其余全部跟随前移: ' + survived7);
else B('中间删除后的偏差归属不对: ' + survived7 + '（期望 fact:1,fact:2,fact:3,fact:4,fact:6,fact:7,fact:8）');
if (p7.factFloors['fact:6'] === 4 && p7.factFloors['fact:8'] === 6) ok('前移楼层的 sourceFloor 已重映射（fact:6: 5 → 4，fact:8: 7 → 6）');
else B('前移楼层的 sourceFloor 没有重映射: ' + JSON.stringify(p7.factFloors));

// ---------------- T8: delete TWO floors in a row from the middle ----------------
console.log('T8 连续删除中间两楼');
fresh(8);
seed([...Array(8)].map((_, i) => fact(i + 1, i, 'F' + i)), 7, { startFloor: 0, endFloor: 7 });
chat.splice(2, 2);                            // 删掉第 2、3 层，第 4~7 层前移到 2~5
const r8 = await ctl.niHandleDevChatMutation();
const p8 = report();
const survived8 = p8.ids.slice().sort().join(',');
if (survived8 === 'fact:1,fact:2,fact:5,fact:6,fact:7,fact:8') ok('两楼连删后映射正确: ' + survived8);
else B('两楼连删后偏差归属不对: ' + survived8 + '（期望 fact:1,fact:2,fact:5,fact:6,fact:7,fact:8）');
if (p8.factFloors['fact:5'] === 2 && p8.factFloors['fact:8'] === 5) ok('整体前移 2 层的重映射正确（fact:5 → 2，fact:8 → 5）');
else B('整体前移的重映射不对: ' + JSON.stringify(p8.factFloors));

// ---------------- T9: event wiring ----------------
console.log('T9 事件绑定');
{
    const registered = [];
    const types = {
        MESSAGE_RENDERED: 'message_rendered',
        CHARACTER_MESSAGE_RENDERED: 'character_message_rendered',
        USER_MESSAGE_RENDERED: 'user_message_rendered',
        MESSAGE_DELETED: 'message_deleted',
        MESSAGE_SWIPED: 'message_swiped',
        MESSAGE_UPDATED: 'message_updated',
        MESSAGE_EDITED: 'message_edited',
        MESSAGE_SWIPE_DELETED: 'message_swipe_deleted',
        CHAT_CHANGED: 'chat_changed',
    };
    const ctl2 = ws.createGenerationController({
        S: { devFacts: [] }, extension_settings, EXT_NAME, DEFAULT_SETTINGS, q, getContext, document,
        toastr: { info: noop, success: noop, warning: noop, error: noop }, saveSettingsDebounced: noop,
        niNormalizeDeviationSections: identity, niBuildDeviationGuideFromSections: () => '', niParseDeviationGuideSections: () => ({}),
        niBuildDeviationFactsText: () => '', niBuildDeviationFactsContext: () => '', niNormalizeDevRange: identity,
        niDevRangeLabel: () => '', niDevRangeProgressLabel: () => '', niBuildDeviationSectionsFromAnalysis: identity,
        niMergeDeviationSections: identity, niReconcileDeviationFacts: () => ({ changes: [] }), niBuildDevChatEntriesText: () => '',
        niDevIsCountableMessage: () => true, niDevMessageFloor: () => 0, niDevMessageMesId: () => 0, niDevMessageRole: () => 'assistant',
        niDevMessageText: () => '', niMergeDevMessagesByFloor: (a) => a, niBoundIntValue: (v, d) => d, getNodesForStage: () => [],
        niMergeStageNodes: (a) => a, recallRelevant: async () => [], niResolveVectorRecallStageScopes: () => [], niGetTbNodes: () => [],
        niTbGetInjectionNode: () => null, callCleanApi: async () => ({}), niSaveSettings: noop, niServerSaveHeavy: async () => true,
        eventSource: { on: (ev) => registered.push(ev), emit: noop, emitAndWait: async () => {} },
        event_types: types, DEV_PROMPT: '', STYLE_PROMPT: '', NI_DEV_CURRENT_TEXT_LIMIT: 1, NI_DEV_RECALL_TEXT_LIMIT: 1,
    });
    ctl2.niBindDeviationAutoUpdateEvents();
    for (const ev of ['message_swiped', 'message_updated', 'message_edited', 'message_swipe_deleted']) {
        if (registered.includes(ev)) ok('已监听 ' + ev);
        else B('漏掉了事件监听: ' + ev);
    }
}

console.log('\n结果：' + bad + ' 个 BUG');
process.exit(bad ? 1 : 0);
