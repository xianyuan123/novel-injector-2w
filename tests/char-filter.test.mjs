import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN_ROOT } from './_paths.mjs';
import {
    NI_CHAR_ROLE_TABS,
    NI_CHAR_TAB_ALL,
    NI_CHAR_SORT_MODES,
    niNormalizeCharQuery,
    niNormalizeCharSortMode,
    niBuildCharHaystack,
    niCharMatchesQuery,
    niCountCharRoles,
    niCharProfileLength,
    niSortCharEntries,
    niHighlightCharText,
} from '../lib/char-filter.js';

let pass = 0;
let fail = 0;
function ok(name, cond, extra = '') {
    if (cond) { pass++; console.log('  ✅ ' + name); }
    else { fail++; console.log('  ❌ ' + name + (extra ? ' → ' + extra : '')); }
}

const read = (rel) => fs.readFileSync(path.join(PLUGIN_ROOT, rel), 'utf8');
const storySrc = read('lib/story-data.js');
const indexSrc = read('index.js');
const tplSrc = read('template.html');
const cssSrc = read('style.css');

const CHARS = [
    { name: '林清玄', role: '主角', gender: '男', identity: '青云宗弟子', personality: '沉稳', relations: '师父：玄阳子', enabled: true },
    { name: '苏晚', role: '配角', gender: '女', identity: '药堂执事', personality: '冷静', relations: '林清玄：同门', enabled: true },
    { name: '血刀老祖', role: '反派', gender: '男', identity: '血刀堂主', personality: '狠辣', enabled: false },
    { name: '无名过客', role: '其他' },
];

console.log('== A 组：搜索词规范化 ==');
ok('A1 去首尾空白并转小写', niNormalizeCharQuery('  林清玄 ') === '林清玄');
ok('A2 英文转小写', niNormalizeCharQuery('LinQingXuan') === 'linqingxuan');
ok('A3 null 变空串', niNormalizeCharQuery(null) === '');
ok('A4 undefined 变空串', niNormalizeCharQuery(undefined) === '');

console.log('== B 组：可搜索字段 ==');
const hay = niBuildCharHaystack(CHARS[0]);
ok('B1 名字进 haystack', hay.includes('林清玄'));
ok('B2 身份进 haystack', hay.includes('青云宗弟子'));
ok('B3 关系进 haystack', hay.includes('玄阳子'));
ok('B4 分类进 haystack', hay.includes('主角'));
ok('B5 空对象返回空串', niBuildCharHaystack({}) === '');
ok('B6 null 返回空串', niBuildCharHaystack(null) === '');

console.log('== C 组：匹配规则 ==');
ok('C1 空搜索命中', niCharMatchesQuery(CHARS[0], '') === true);
ok('C2 名字命中', niCharMatchesQuery(CHARS[0], '林清玄') === true);
ok('C3 身份命中', niCharMatchesQuery(CHARS[0], '青云宗') === true);
ok('C4 关系命中', niCharMatchesQuery(CHARS[0], '玄阳子') === true);
ok('C5 不相关不命中', niCharMatchesQuery(CHARS[0], '血刀') === false);
ok('C6 多词 AND 全中才命中', niCharMatchesQuery(CHARS[0], '青云宗 沉稳') === true);
ok('C7 多词 AND 缺一不命中', niCharMatchesQuery(CHARS[0], '青云宗 狠辣') === false);
ok('C8 大小写不敏感', niCharMatchesQuery({ name: 'Alice' }, 'alice') === true);
ok('C9 无字段角色搜不到内容', niCharMatchesQuery(CHARS[3], '青云宗') === false);
ok('C10 空角色对象不崩', niCharMatchesQuery(null, 'x') === false);

console.log('== D 组：分类计数 ==');
const counts = niCountCharRoles(CHARS);
ok('D1 全部 = 4', counts[NI_CHAR_TAB_ALL] === 4);
ok('D2 主角 = 1', counts['主角'] === 1);
ok('D3 配角 = 1', counts['配角'] === 1);
ok('D4 反派 = 1', counts['反派'] === 1);
ok('D5 其他 = 1', counts['其他'] === 1);
ok('D6 三个分类常量齐全', NI_CHAR_ROLE_TABS.length === 4);
ok('D7 非法输入返回全 0', niCountCharRoles(null)[NI_CHAR_TAB_ALL] === 0);
ok('D8 未知分类额外计数', niCountCharRoles([{ role: '龙套' }])['龙套'] === 1);

console.log('== E 组：人设长度 ==');
ok('E1 只统计四字段', niCharProfileLength({ identity: 'aa', appearance: 'bbb', personality: 'c', relations: 'dddd', name: '不计入' }) === 10);
ok('E2 空角色为 0', niCharProfileLength(null) === 0);
ok('E3 只有名字不计入', niCharProfileLength({ name: '很长很长的名字' }) === 0);

console.log('== F 组：排序 ==');
const entries = CHARS.map((c, i) => ({ c, i }));
const stageMap = { 0: 2, 1: 1, 2: null, 3: null };
const getStage = ({ i }) => stageMap[i];
const isEnabled = ({ c }) => c.enabled !== false;

const byStage = niSortCharEntries(entries, { mode: 'stage', getStage, isEnabled });
ok('F1 启用优先，未启用沉底', byStage[byStage.length - 1].c.name === '血刀老祖');
ok('F2 启用内按登场阶段升序', byStage[0].c.name === '苏晚' && byStage[1].c.name === '林清玄');
ok('F3 没有阶段的排在有阶段之后', byStage.findIndex((e) => e.c.name === '无名过客') > 1);

const byName = niSortCharEntries(entries, { mode: 'name' });
ok('F4 按名字排序不丢条目', byName.length === 4);
ok('F5 按名字排序结果稳定（连续两次一致）', JSON.stringify(niSortCharEntries(entries, { mode: 'name' })) === JSON.stringify(byName));

const byLen = niSortCharEntries(entries, { mode: 'length' });
ok('F6 人设最长的排第一', byLen[0].c.name === '林清玄');
ok('F7 没填人设的排最后', byLen[byLen.length - 1].c.name === '无名过客');
ok('F8 非法模式回落 stage', JSON.stringify(niSortCharEntries(entries, { mode: 'xxx', getStage, isEnabled })) === JSON.stringify(byStage));
ok('F9 空数组不崩', niSortCharEntries(null).length === 0);
ok('F10 不改动原数组', entries[0].c.name === '林清玄' && entries.length === 4);
ok('F11 排序模式常量齐全', NI_CHAR_SORT_MODES.join(',') === 'stage,name,length');

console.log('== G 组：搜索高亮 ==');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
ok('G1 无搜索词原样返回', niHighlightCharText('林清玄', '', esc) === '林清玄');
ok('G2 命中包 mark', niHighlightCharText('林清玄', '清玄', esc) === '林<mark class="ni-hl">清玄</mark>');
ok('G3 多词都能命中', niHighlightCharText('林清玄 青云宗', '清玄 青云', esc).includes('<mark class="ni-hl">清玄</mark>'));
ok('G4 转义生效', niHighlightCharText('<b>', '', esc) === '&lt;b&gt;');
ok('G5 无命中不改写', niHighlightCharText('苏晚', '林', esc) === '苏晚');
ok('G6 特殊字符不抛错', (() => { try { niHighlightCharText('a(b', '(', esc); return true; } catch { return false; } })());
ok('G7 空文本返回空串', niHighlightCharText('', '林', esc) === '');

console.log('== H 组：story-data 接线 ==');
ok('H1 引入 char-filter', /from '\.\/char-filter\.js'/.test(storySrc));
ok('H2 有搜索状态 _charQuery', storySrc.includes('let _charQuery'));
ok('H3 有排序状态 _charSort', storySrc.includes('let _charSort'));
ok('H4 取数走过滤+排序', storySrc.includes('niCharMatchesQuery(c, _charQuery)') && storySrc.includes('niSortCharEntries(entries'));
ok('H5 支持「全部」分类', storySrc.includes("_charTab === '全部'"));
ok('H6 定义 niSetCharQuery', /function niSetCharQuery\(/.test(storySrc));
ok('H7 定义 niSetCharSort', /function niSetCharSort\(/.test(storySrc));
ok('H8 定义批量作用于筛选结果', /function niApplyCharsEnabledToFiltered\(/.test(storySrc));
ok('H9 定义 tab 计数同步', /function niSyncCharTabCounts\(/.test(storySrc));
ok('H10 渲染时同步计数', storySrc.includes('niSyncCharTabCounts();'));
ok('H11 空态区分搜索无结果', storySrc.includes('没有匹配'));
ok('H12 暴露到 window', storySrc.includes('window.niSetCharQuery') && storySrc.includes('window.niApplyCharsEnabledToFiltered'));

console.log('== I 组：index.js 接线 ==');
ok('I1 绑定搜索 input', indexSrc.includes("$app.on('input', '#ni-char-search'"));
ok('I2 有防抖', indexSrc.includes('_niCharSearchTimer'));
ok('I3 Esc 清空搜索', /keydown', '#ni-char-search'/.test(indexSrc) && indexSrc.includes('Escape'));
ok('I4 绑定清空按钮', indexSrc.includes("'#ni-char-search-clear'"));
ok('I5 绑定排序下拉', indexSrc.includes("$app.on('change', '#ni-char-sort'"));
ok('I6 批量开关走筛选结果', indexSrc.includes('niApplyCharsEnabledToFiltered'));
ok('I7 不再按分类遍历全开', !indexSrc.includes("if ((c.role || '其他') === charTab) { c.enabled = true"));

console.log('== J 组：模板与样式 ==');
ok('J1 模板有搜索框', tplSrc.includes('id="ni-char-search"'));
ok('J2 模板有清空按钮', tplSrc.includes('id="ni-char-search-clear"'));
ok('J3 模板有排序下拉与三个选项', tplSrc.includes('id="ni-char-sort"') && tplSrc.includes('value="length"'));
ok('J4 模板有「全部」tab', tplSrc.includes('data-role="全部"'));
ok('J5 五个 tab 都带人数徽标', (tplSrc.match(/class="ni-tab-count"/g) || []).length === 5);
ok('J6 样式有搜索行', cssSrc.includes('.ni-char-search-row'));
ok('J7 样式有搜索输入框', cssSrc.includes('.ni-char-search input'));
ok('J8 样式有排序下拉', cssSrc.includes('.ni-char-sort'));
ok('J9 样式有人数徽标', cssSrc.includes('.ni-tab-count'));
ok('J10 样式有高亮', cssSrc.includes('mark.ni-hl'));

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
