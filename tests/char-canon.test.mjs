/**
 * 角色原著设定（C 退场 / D 按阶段关系 / E 知情边界 / F 出场索引）测试
 * 纯函数用真 import 跑；接线用源码断言。
 */
import fs from 'node:fs';
import { PLUGIN_ROOT, readPlugin } from './_paths.mjs';
import {
    NI_CHAR_EXIT_MODES,
    niNormalizeExitStage,
    niNormalizeExitMode,
    niResolveCharCanon,
    niIsCharExited,
    niFormatCharExitLabel,
    niFormatCharExitHint,
    niNormalizeRelationRows,
    niFilterRelationsByStage,
    niFormatRelationsForStage,
    niNormalizeKnowledgeRows,
    niFilterKnowledgeByStage,
    niFormatKnowledgeForStage,
    niCountNameHits,
    niExtractHitSnippet,
    niFindCharAppearances,
    niSummarizeAppearances,
    niFormatAppearanceSummary,
    niCollectCharAliasTexts,
    niCollectCharNames,
    niFormatAliasHint,
    niNormalizeAliasInput,
    niMergeAliasList,
    niNormalizeIdentityRows,
    niFilterIdentitiesByStage,
    niResolveIdentityState,
    niFormatIdentitiesForStage,
    niFormatIdentitySummary,
    niCollectCharIdentityLabels,
} from '../lib/char-canon.js';
import { niCharMatchesQuery } from '../lib/char-filter.js';

let pass = 0;
const fails = [];
function ok(name, cond, extra = '') {
    if (cond) { pass++; return; }
    fails.push(`${name}${extra ? ` — ${extra}` : ''}`);
}
function eq(name, actual, expected) {
    ok(name, JSON.stringify(actual) === JSON.stringify(expected), `期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
}

/* ---------------- A. 退场阶段 ---------------- */
eq('A1 退场阶段接受 7', niNormalizeExitStage(7), 7);
eq('A2 退场阶段接受字符串 "3"', niNormalizeExitStage('3'), 3);
eq('A3 空串 → null', niNormalizeExitStage(''), null);
eq('A4 0 视为未设置', niNormalizeExitStage(0), null);
eq('A5 负数 → null', niNormalizeExitStage(-2), null);
eq('A6 NaN → null', niNormalizeExitStage('abc'), null);
eq('A7 退场方式只认三种', NI_CHAR_EXIT_MODES, ['死亡', '离场', '失踪']);
eq('A8 退场方式未知值 → 空', niNormalizeExitMode('飞升'), '');
eq('A9 退场方式死亡', niNormalizeExitMode('死亡'), '死亡');
eq('A10 解析角色退场', niResolveCharCanon({ exitStage: 5, exitMode: '死亡' }), { exitStage: 5, exitMode: '死亡', hasExit: true });
eq('A11 没有退场', niResolveCharCanon({ name: '张三' }), { exitStage: null, exitMode: '', hasExit: false });
ok('A12 第 5 阶段退场，第 4 阶段还活着', niIsCharExited({ exitStage: 5 }, 4) === false);
ok('A13 第 5 阶段起算退场', niIsCharExited({ exitStage: 5 }, 5) === true);
ok('A14 第 8 阶段更退场', niIsCharExited({ exitStage: 5 }, 8) === true);
ok('A15 没有阶段信息时按活着算', niIsCharExited({ exitStage: 5 }, NaN) === false);
ok('A16 没有退场阶段永远活着', niIsCharExited({ exitStage: null }, 99) === false);
eq('A17 退场标签', niFormatCharExitLabel({ exitStage: 7, exitMode: '死亡' }), '第 7 阶段·死亡');
eq('A18 退场提示', niFormatCharExitHint({ exitStage: 7, exitMode: '失踪' }), '第 7 阶段起失踪，不再注入人设');
eq('A19 没退场就是空串', niFormatCharExitLabel({}), '');

/* ---------------- B. 按阶段关系 ---------------- */
const REL = [
    { target: '苏晚', type: '同门师姐', fromStage: 1, toStage: 4 },
    { target: '苏晚', type: '反目成仇', fromStage: 5 },
    { target: '玄阳子', type: '师父' },
    { target: '', type: '' },
];
eq('B1 规范化丢掉空行', niNormalizeRelationRows(REL).length, 3);
eq('B2 非数组 → 空', niNormalizeRelationRows(null), []);
eq('B3 第 2 阶段只看得到师姐', niFilterRelationsByStage(REL, 2).map(r => r.type), ['同门师姐', '师父']);
eq('B4 第 5 阶段关系已切换', niFilterRelationsByStage(REL, 5).map(r => r.type), ['反目成仇', '师父']);
eq('B5 到阶段之后不再成立', niFilterRelationsByStage([{ target: 'A', type: 'X', fromStage: 1, toStage: 2 }], 3).length, 0);
ok('B6 阶段未知时全给（不误删）', niFilterRelationsByStage(REL, NaN).length === 3);
ok('B7 from>to 自动交换，仍生效', niFilterRelationsByStage([{ target: 'A', type: 'X', fromStage: 6, toStage: 4 }], 5).length === 1);
eq('B8 格式化带阶段区间', niFormatRelationsForStage([{ target: '苏晚', type: '同门师姐', fromStage: 1, toStage: 4 }], 2), '苏晚：同门师姐（第 1–4 阶段）');
eq('B9 不带阶段就不加括号', niFormatRelationsForStage([{ target: '玄阳子', type: '师父' }], 2), '玄阳子：师父');
eq('B10 没命中就是空串', niFormatRelationsForStage([{ target: 'A', type: 'X', fromStage: 9 }], 1), '');
eq('B11 多条用分号连', niFormatRelationsForStage([{ target: 'A', type: 'X' }, { target: 'B', type: 'Y' }], 1), 'A：X；B：Y');

/* ---------------- C. 知情边界 ---------------- */
const KN = [{ fact: '苏晚中毒', fromStage: 5 }, { fact: '掌门已死' }];
eq('C1 规范化丢掉空事实', niNormalizeKnowledgeRows([{ fact: '' }, { fact: '有意义' }]).length, 1);
eq('C2 第 4 阶段只知道无门槛的', niFilterKnowledgeByStage(KN, 4).map(k => k.fact), ['掌门已死']);
eq('C3 第 5 阶段两条都知道', niFilterKnowledgeByStage(KN, 5).map(k => k.fact), ['苏晚中毒', '掌门已死']);
eq('C4 格式化带"起"字样', niFormatKnowledgeForStage(KN, 5), '苏晚中毒（第 5 阶段起）；掌门已死');
eq('C5 一条都不该知道 → 空串', niFormatKnowledgeForStage([{ fact: 'X', fromStage: 9 }], 1), '');
eq('C6 阶段未知只留无门槛', niFilterKnowledgeByStage(KN, NaN).map(k => k.fact), ['掌门已死']);

/* ---------------- D. 出场索引 ---------------- */
eq('D1 出现 3 次', niCountNameHits('苏晚笑了。苏晚说。苏晚走了。', '苏晚'), 3);
eq('D2 大小写无关', niCountNameHits('Su Wan 与 su wan', 'su wan'), 2);
eq('D3 没出现 → 0', niCountNameHits('林清玄路过', '苏晚'), 0);
eq('D4 空名字 → 0', niCountNameHits('任意正文', ''), 0);
ok('D5 摘录包含名字', niExtractHitSnippet('前面一大段铺垫文字，苏晚忽然抬头看向远处', '苏晚').includes('苏晚'));
ok('D6 摘录过长会加省略号', niExtractHitSnippet('前'.repeat(60) + '苏晚' + '后'.repeat(60), '苏晚', { pad: 10 }).startsWith('…'));
const NODES = [
    { id: 'n1', title: '入门考核', stageIdx: 1, text: '苏晚与林清玄一同拜入山门。' },
    { id: 'n2', title: '剑冢夜话', stageIdx: 2, text: '林清玄独自练剑。' },
    { id: 'n3', title: '血刀来袭', stageIdx: 3, text: '苏晚挡在师父身前，苏晚倒下了。' },
];
const AP = niFindCharAppearances({ name: '苏晚', nodes: NODES });
eq('D7 命中 2 个节点', AP.length, 2);
eq('D8 命中节点的阶段', AP.map(a => a.stageIdx), [1, 3]);
eq('D9 第三节点命中 2 处', AP.find(a => a.nodeId === 'n3')?.hits, 2);
ok('D10 空名字不命中', niFindCharAppearances({ name: '', nodes: NODES }).length === 0);
eq('D11 汇总节点数/处数', niSummarizeAppearances(AP), { nodeCount: 2, hitCount: 3, stageCount: 2, stages: [1, 3], firstStage: 1, lastStage: 3 });
eq('D12 只有一个阶段时区间写法', niFormatAppearanceSummary({ nodeCount: 2, hitCount: 5, stageCount: 1, stages: [2], firstStage: 2, lastStage: 2 }), '共 5 处 · 第 2 阶段 · 2 个节点');
eq('D13 没命中时的文案', niFormatAppearanceSummary({ nodeCount: 0 }), '正文里没找到这个名字');

/* ---------------- F. 别名 / 称呼表 ---------------- */
const ALIAS_CHAR = {
    name: '血刀老祖',
    aliases: [
        { text: '老祖', kind: 'alias', character_name: '血刀老祖', note: '门下称呼' },
        { text: '血刀老祖', kind: 'alias' },
        { text: '', kind: 'alias' },
        { text: '老祖', kind: 'alias' },
    ],
};
eq('F1 别名去重、去掉本名、去空', niCollectCharAliasTexts(ALIAS_CHAR), ['老祖']);
eq('F2 本名 + 别名', niCollectCharNames(ALIAS_CHAR), ['血刀老祖', '老祖']);
eq('F3 没有别名时只有本名', niCollectCharNames({ name: '苏晚' }), ['苏晚']);
eq('F4 别名文本拼接', niFormatAliasHint([{ text: '老祖' }, { text: '老魔' }]), '老祖、老魔');
eq('F5 没别名 → 空串', niFormatAliasHint(null), '');
eq('F6 各种分隔符都能拆', niNormalizeAliasInput('老祖、老魔，血刀; 魔头/老怪'), ['老祖', '老魔', '血刀', '魔头', '老怪']);
eq('F7 拆分后去重', niNormalizeAliasInput('老祖、老祖'), ['老祖']);
eq('F8 空输入 → 空数组', niNormalizeAliasInput(''), []);
const MERGED = niMergeAliasList(ALIAS_CHAR.aliases, ['老祖', '老魔', '血刀老祖'], '血刀老祖');
eq('F9 合并保留原有 note/kind', MERGED.find(a => a.text === '老祖')?.note, '门下称呼');
eq('F10 新别名补 kind=manual 并带 character_name',
    [MERGED.find(a => a.text === '老魔')?.kind, MERGED.find(a => a.text === '老魔')?.character_name], ['manual', '血刀老祖']);
ok('F11 合并时剔除与本名相同的别名', !MERGED.some(a => a.text === '血刀老祖'));
eq('F12 合并顺序按用户输入', MERGED.map(a => a.text), ['老祖', '老魔']);

const ALIAS_NODES = [
    { id: 'a1', title: '血刀堂', stageIdx: 5, text: '老祖端坐堂上，血刀出鞘。' },
    { id: 'a2', title: '山门', stageIdx: 1, text: '苏晚与林清玄拜入山门。' },
    { id: 'a3', title: '夜谈', stageIdx: 6, text: '血刀老祖沉默不语。' },
];
const AP2 = niFindCharAppearances({ names: niCollectCharNames(ALIAS_CHAR), nodes: ALIAS_NODES });
eq('F13 别名也能命中（本名没出现）', AP2.map(a => a.nodeId), ['a1', 'a3']);
eq('F14 记录命中的是哪个称呼', AP2[0]?.matched, ['老祖']);
eq('F15 本名与别名同时命中也算总数', niFindCharAppearances({ names: ['血刀老祖', '老祖'], nodes: [{ id: 'x', stageIdx: 1, text: '血刀老祖，老祖在此' }] })[0]?.hits, 2);
ok('F16 摘录取命中最多的那个称呼', niFindCharAppearances({ names: ['血刀老祖', '老祖'], nodes: [{ id: 'x', stageIdx: 1, text: '老祖老祖老祖然后才提到血刀老祖' }] })[0]?.snippet.includes('老祖'));
ok('F17 搜索能搜到别名', niCharMatchesQuery(ALIAS_CHAR, '老祖'));
ok('F18 搜索仍能搜本名', niCharMatchesQuery(ALIAS_CHAR, '血刀'));

/* ---------------- G. 多身份（夏弥 / 黑影 这种） ---------------- */
const IDs = [
    { label: '夏弥', fromStage: 1, toStage: 5 },
    { label: '黑影', fromStage: 2, toStage: 8, secret: true, revealAt: 6 },
];
eq('G1 归一化保留秘密标记与揭晓阶段', niNormalizeIdentityRows(IDs)[1], { label: '黑影', fromStage: 2, toStage: 8, secret: true, revealAt: 6 });
eq('G2 没有身份名的行被丢掉', niNormalizeIdentityRows([{ label: '  ' }, { fromStage: 3 }, null]).length, 0);
eq('G3 阶段留空 = 从开头/到结尾', niNormalizeIdentityRows([{ label: '甲' }])[0], { label: '甲', fromStage: null, toStage: null, secret: false, revealAt: null });
eq('G4 揭晓阶段写 0 视为没填', niNormalizeIdentityRows([{ label: '甲', revealAt: 0 }])[0].revealAt, null);
eq('G5 当前阶段取生效身份', niFilterIdentitiesByStage(IDs, 3).map(r => r.label), ['夏弥', '黑影']);
eq('G6 区间写反自动交换', niFilterIdentitiesByStage([{ label: '甲', fromStage: 6, toStage: 3 }], 4).length, 1);
eq('G7 结束阶段之后不再生效', niFilterIdentitiesByStage(IDs, 9).map(r => r.label), []);
const ST3 = niResolveIdentityState(IDs, 3);
eq('G8 揭晓前：公开身份 + 秘密身份分开', [ST3.plain.map(r => r.label), ST3.concealed.map(r => r.label), ST3.revealed.length], [['夏弥'], ['黑影'], 0]);
const ST6 = niResolveIdentityState(IDs, 6);
eq('G9 揭晓后：秘密身份转成已揭晓', ST6.revealed.map(r => r.label), ['黑影']);
eq('G10 秘密身份没填揭晓阶段 → 永远不点破', niResolveIdentityState([{ label: '黑影', secret: true }], 99).concealed.map(r => r.label), ['黑影']);

const T3 = niFormatIdentitiesForStage(IDs, 3, '夏弥');
ok('G11 揭晓前只写「另一形态」', T3.includes('另一形态：黑影'));
ok('G12 揭晓前绝不点破是同一人', !T3.includes('同一人') && !T3.includes('就是本人'));
ok('G13 公开身份照常写', T3.includes('身份：夏弥'));
const T6 = niFormatIdentitiesForStage(IDs, 6, '夏弥');
ok('G14 揭晓后明说同一人', T6.includes('黑影 与 夏弥 是同一人') && T6.includes('第 6 阶段起揭晓'));
ok('G15 只有秘密身份时也不会带出本名', !niFormatIdentitiesForStage([{ label: '黑影', secret: true }], 2, '夏弥').includes('夏弥'));
eq('G16 没有身份行 → 空串', niFormatIdentitiesForStage([], 3, '夏弥'), '');
eq('G17 非秘密身份直接说明', niFormatIdentitiesForStage([{ label: '小号' }], 3, '夏弥'), '身份：小号');
eq('G18 卡片摘要格式', niFormatIdentitySummary(IDs), '夏弥（第 1–5 阶段） · 黑影（第 2–8 阶段，第 6 阶段揭晓）');
eq('G19 摘要把无阶段的行写成「秘密身份」', niFormatIdentitySummary([{ label: '黑影', secret: true }]), '黑影（秘密身份）');
eq('G20 名字集合含身份名', niCollectCharNames({ name: '夏弥', identities: IDs }), ['夏弥', '黑影']);
eq('G21 身份名去重', niCollectCharIdentityLabels({ identities: [{ label: '黑影' }, { label: '黑影' }, { label: '' }] }), ['黑影']);

/* ---------------- E. 接线 ---------------- */
const story = readPlugin('lib/story-data.js');
const index = readPlugin('index.js');
const tpl = readPlugin('template.html');
const css = readPlugin('style.css');

ok('E1 story-data 导入 char-canon', story.includes("from './char-canon.js'"));
ok('E2 编辑表单有退场阶段下拉', story.includes('id="ni-cta-exitstage-${i}"'));
ok('E3 编辑表单有退场方式', story.includes('id="ni-cta-exitmode-${i}"'));
ok('E4 有按阶段关系编辑器', story.includes('id="ni-cr2-list-${i}"'));
ok('E5 有知情编辑器', story.includes('id="ni-ck-list-${i}"'));
ok('E6 加一条/删一条事件委托', story.includes("'[id^=\"ni-cr2-add-\"]'") && story.includes("[data-cr2-del], [data-ck-del], [data-ci-del]"));
ok('E7 保存写 exitStage/exitMode', story.includes('S.characters[i].exitStage') && story.includes('S.characters[i].exitMode'));
ok('E8 保存写 relations2/knowledge', story.includes('S.characters[i].relations2') && story.includes('S.characters[i].knowledge'));
ok('E9 卡片有退场徽标', story.includes('ni-char-exit-badge'));
ok('E10 卡片有出场索引按钮', story.includes('ni-char-app-btn') && story.includes('id="ni-capp-${i}"'));
ok('E11 打开编辑会回填退场下拉', story.includes('niPopulateCharExitStageSelect(i, c)'));
ok('E12 打开编辑会重建两个编辑器', story.includes('relList.innerHTML') && story.includes('kList.innerHTML'));

ok('E13 index 导入 char-canon', index.includes("from './lib/char-canon.js'"));
ok('E14 有 canon 阶段解析函数', index.includes('function niResolveCharCanonStage('));
ok('E15 人设拼装按退场跳过', index.includes('if (niIsCharExited(c, canonStageIdx)) return;'));
ok('E16 有结构化关系就不再用自由文本', index.includes('hasStructuredRelations') && index.includes('freeRelations'));
ok('E17 注入按阶段关系', index.includes('niFormatRelationsForStage(c.relations2, canonStageIdx)'));
ok('E18 注入按阶段知情', index.includes('niFormatKnowledgeForStage(c.knowledge, canonStageIdx)'));
ok('E19 预览与注入共用（都传 plan）', index.includes('niBuildCharInjectionText(precomputedPlan)') && index.includes('niBuildCharInjectionText(stageInjectionPlan)'));
ok('E20 有出场索引弹窗函数', index.includes('function niOpenCharAppearances(') && index.includes('function niCloseCharAppearances('));
ok('E21 出场索引收集阶段节点', index.includes('function niCollectCharAppearanceNodes(') && index.includes('niMergeStageNodes(getNodesForStage(stageIdx))'));
ok('E22 出场索引绑定了按钮/关闭/背景/跳阶段', index.includes("'.ni-char-app-btn'") && index.includes("'#ni-char-app-close'") && index.includes("ev?.target?.id === 'ni-char-app-modal'") && index.includes("'[data-app-stage]'"));

ok('E23 模板有出场索引弹窗', tpl.includes('id="ni-char-app-modal"') && tpl.includes('id="ni-char-app-list"') && tpl.includes('id="ni-char-app-sum"'));
ok('E24 样式齐备', ['.ni-char-exit-badge', '.ni-char-app-btn', '.ni-canon-row', '.ni-canon-add', '.ni-char-app-card', '.ni-char-app-item'].every(sel => css.includes(sel)));

ok('F19 人设注入带别名行', index.includes('别名：${aliasText}（正文或对话里可能这样称呼）'));
ok('F20 人设注入取别名文本', index.includes('const aliasText = niFormatAliasHint(c.aliases);'));
ok('F21 出场索引传全部名字', index.includes('niFindCharAppearances({ names: niCollectCharNames(c), nodes })'));
ok('F22 卡片显示别名行', story.includes('ni-char-alias-row') && story.includes("niFormatAliasHint(c.aliases)"));
ok('F23 编辑区有别名输入框', story.includes('id="ni-cta-aliases-${i}"'));
ok('F24 保存时合并别名（保留原有 kind/note）', story.includes('niMergeAliasList(') && story.includes('niNormalizeAliasInput(q(`#ni-cta-aliases-${i}`)?.value)'));
ok('F25 搜索 haystack 含别名', readPlugin('lib/char-filter.js').includes('...aliasTexts'));
ok('F26 别名样式齐备', css.includes('.ni-char-alias-row'));

ok('G22 注入按阶段拼身份', index.includes('niFormatIdentitiesForStage(c.identities, canonStageIdx, c.name)'));
ok('G23 身份行紧跟在别名之后', index.indexOf('niFormatIdentitiesForStage(c.identities') > index.indexOf('niFormatAliasHint(c.aliases)'));
ok('G24 编辑区有身份列表与添加按钮', story.includes('id="ni-ci-list-${i}"') && story.includes('id="ni-ci-add-${i}"'));
ok('G25 保存写入 identities', story.includes('S.characters[i].identities = niCollectIdentityRows(i);'));
ok('G26 卡片显示身份行', story.includes('ni-char-id-row') && story.includes('niFormatIdentitySummary(c.identities)'));
ok('G27 在场判定认身份名', story.includes('niNormalizeIdentityRows(c?.identities).forEach(row => addTerm(row.label'));
ok('G28 身份行可加可删', story.includes("t.closest('[id^=\"ni-ci-add-\"]')") && story.includes('[data-ci-del]'));
ok('G29 样式齐备', css.includes('.ni-char-id-row') && css.includes('.ni-ci-secret') && css.includes('.ni-canon-row-id'));

if (fails.length) {
    console.log(`FAIL ${fails.length} / PASS ${pass}`);
    for (const f of fails) console.log('  ✗ ' + f);
    process.exit(1);
}
console.log(`PASS ${pass} 项全绿`);
