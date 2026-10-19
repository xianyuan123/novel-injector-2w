/**
 * 角色列表的筛选/排序/统计纯函数。
 *
 * 这里只做「给定数据 → 给定结果」的计算，不碰 DOM、不碰 extension_settings，
 * 方便单测，也避免把过滤逻辑散落在 story-data 的渲染函数里。
 */

export const NI_CHAR_ROLE_TABS = ['主角', '配角', '反派', '其他'];
export const NI_CHAR_TAB_ALL = '全部';
export const NI_CHAR_SORT_MODES = ['stage', 'name', 'length'];
export const NI_CHAR_SORT_LABELS = {
    stage: '按登场阶段',
    name: '按名字',
    length: '按人设长度',
};

/** 搜索词规范化：去首尾空白、转小写 */
export function niNormalizeCharQuery(raw) {
    return String(raw ?? '').trim().toLowerCase();
}

/** 排序模式规范化，非法值回落到 stage */
export function niNormalizeCharSortMode(mode) {
    const m = String(mode ?? '').trim();
    return NI_CHAR_SORT_MODES.includes(m) ? m : 'stage';
}

/**
 * 把一个角色摊平成可搜索的字符串。
 * 名字、分类、性别、身份、外貌、性格、关系都要能搜到，
 * 这样「搜女主」「搜剑修」「搜某人的师兄」都能命中。
 */
export function niBuildCharHaystack(char) {
    if (!char || typeof char !== 'object') return '';
    const parts = [
        char.name,
        char.role,
        char.gender,
        char.identity,
        char.appearance,
        char.personality,
        char.relations,
    ];
    return parts
        .map((v) => String(v ?? '').trim())
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
}

/**
 * 是否命中搜索词。空格分词，全部命中才算命中（AND 语义）。
 * 空搜索词视为全部命中。
 */
export function niCharMatchesQuery(char, query) {
    const q = niNormalizeCharQuery(query);
    if (!q) return true;
    const haystack = niBuildCharHaystack(char);
    if (!haystack) return false;
    const tokens = q.split(/\s+/).filter(Boolean);
    if (!tokens.length) return true;
    return tokens.every((token) => haystack.includes(token));
}

/** 按分类统计人数，附带「全部」 */
export function niCountCharRoles(characters = []) {
    const counts = { [NI_CHAR_TAB_ALL]: 0 };
    NI_CHAR_ROLE_TABS.forEach((role) => { counts[role] = 0; });
    (Array.isArray(characters) ? characters : []).forEach((char) => {
        if (!char || typeof char !== 'object') return;
        counts[NI_CHAR_TAB_ALL] += 1;
        const role = String(char.role || '其他').trim() || '其他';
        if (counts[role] === undefined) counts[role] = 0;
        counts[role] += 1;
    });
    return counts;
}

/** 人设总字数（身份/外貌/性格/关系），用于「按人设长度」排序 */
export function niCharProfileLength(char) {
    if (!char || typeof char !== 'object') return 0;
    return ['identity', 'appearance', 'personality', 'relations']
        .map((k) => String(char[k] ?? '').trim().length)
        .reduce((a, b) => a + b, 0);
}

/**
 * 排序角色条目（entries 形如 [{ c, i }]）。
 * - stage：未启用的沉底，其次按首次登场阶段，没有阶段的排最后，再按原始下标
 * - name：按名字本地化比较；名字相同的按原始下标
 * - length：人设字数多的在前
 * getStage(entry) / isEnabled(entry) 由调用方注入，避免这里依赖运行时状态。
 */
export function niSortCharEntries(entries = [], options = {}) {
    const list = Array.isArray(entries) ? entries.slice() : [];
    const mode = niNormalizeCharSortMode(options.mode);
    const getStage = typeof options.getStage === 'function' ? options.getStage : () => null;
    const isEnabled = typeof options.isEnabled === 'function' ? options.isEnabled : () => true;

    const stageOf = (entry) => {
        const raw = getStage(entry);
        const n = parseInt(raw, 10);
        return Number.isFinite(n) && n > 0 ? n : Number.MAX_SAFE_INTEGER;
    };
    const indexOf = (entry) => {
        const n = parseInt(entry?.i, 10);
        return Number.isFinite(n) ? n : 0;
    };
    const nameOf = (entry) => String(entry?.c?.name ?? '').trim();

    list.sort((a, b) => {
        if (mode === 'name') {
            const byName = nameOf(a).localeCompare(nameOf(b), 'zh-Hans-CN');
            return byName !== 0 ? byName : indexOf(a) - indexOf(b);
        }
        if (mode === 'length') {
            const byLen = niCharProfileLength(b?.c) - niCharProfileLength(a?.c);
            return byLen !== 0 ? byLen : nameOf(a).localeCompare(nameOf(b), 'zh-Hans-CN');
        }
        const aOff = isEnabled(a) ? 0 : 1;
        const bOff = isEnabled(b) ? 0 : 1;
        if (aOff !== bOff) return aOff - bOff;
        const aStage = stageOf(a);
        const bStage = stageOf(b);
        if (aStage !== bStage) return aStage - bStage;
        return indexOf(a) - indexOf(b);
    });
    return list;
}

/** 高亮搜索命中片段（返回安全转义后的 HTML） */
export function niHighlightCharText(text, query, escFn) {
    const raw = String(text ?? '');
    const esc = typeof escFn === 'function' ? escFn : (s) => String(s);
    const q = niNormalizeCharQuery(query);
    if (!q || !raw) return esc(raw);
    const tokens = [...new Set(q.split(/\s+/).filter(Boolean))].sort((a, b) => b.length - a.length);
    if (!tokens.length) return esc(raw);
    const pattern = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    let re;
    try {
        re = new RegExp(pattern, 'gi');
    } catch {
        return esc(raw);
    }
    let out = '';
    let last = 0;
    let m;
    while ((m = re.exec(raw)) !== null) {
        if (m.index < last) break;
        out += esc(raw.slice(last, m.index));
        out += `<mark class="ni-hl">${esc(m[0])}</mark>`;
        last = m.index + m[0].length;
        if (m[0].length === 0) re.lastIndex += 1;
    }
    out += esc(raw.slice(last));
    return out;
}
