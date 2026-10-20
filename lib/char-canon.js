/**
 * 角色「原著设定」：退场阶段、按阶段变化的关系、知情边界、出场索引。
 *
 * 这一层只做纯计算，不碰 DOM、不碰 state、不发请求，
 * 好处是「按第几阶段算」这种最容易写错的东西可以直接单测。
 */

/** 退场方式（只用于展示，不影响判断） */
export const NI_CHAR_EXIT_MODES = ['死亡', '离场', '失踪'];

/**
 * 规范化退场阶段：只接受 >=1 的整数，其余（含 ''、null、0、负数、NaN）一律 None。
 * @returns {number|null}
 */
export function niNormalizeExitStage(value) {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n) || n < 1) return null;
    return n;
}

/** 规范化退场方式 */
export function niNormalizeExitMode(value) {
    const s = String(value ?? '').trim();
    return NI_CHAR_EXIT_MODES.includes(s) ? s : '';
}

/**
 * 取出一个角色的「原著设定」摘要。
 * @param {{ exitStage?: any, exitMode?: any }} char
 * @returns {{ exitStage: number|null, exitMode: string, hasExit: boolean }}
 */
export function niResolveCharCanon(char = {}) {
    const exitStage = niNormalizeExitStage(char?.exitStage);
    const exitMode = niNormalizeExitMode(char?.exitMode);
    return { exitStage, exitMode, hasExit: exitStage != null };
}

/**
 * 到了退场阶段就算「已退场」。
 * stageIdx 不可用时（NaN/未传）一律当作「还没退场」，宁可按活着处理。
 * @param {object} char
 * @param {number} stageIdx 当前阶段（1 起）
 */
export function niIsCharExited(char, stageIdx) {
    const { exitStage } = niResolveCharCanon(char);
    if (exitStage == null) return false;
    const now = parseInt(stageIdx, 10);
    if (!Number.isFinite(now) || now < 1) return false;
    return now >= exitStage;
}

/** 「第 7 阶段·死亡」，没有退场就返回空串 */
export function niFormatCharExitLabel(char = {}) {
    const { exitStage, exitMode } = niResolveCharCanon(char);
    if (exitStage == null) return '';
    return `第 ${exitStage} 阶段${exitMode ? `·${exitMode}` : ''}`;
}

/** 角色卡上的一行提示 */
export function niFormatCharExitHint(char = {}) {
    const { exitStage, exitMode } = niResolveCharCanon(char);
    if (exitStage == null) return '';
    return `第 ${exitStage} 阶段起${exitMode || '退场'}，不再注入人设`;
}

/* ------------------------------------------------------------------ */
/* 关系（按阶段）                                                       */
/* ------------------------------------------------------------------ */

/**
 * 规范化结构化关系行。
 * @param {Array<{target?: any, type?: any, fromStage?: any, toStage?: any}>} rows
 * @returns {Array<{target: string, type: string, fromStage: number|null, toStage: number|null}>}
 */
export function niNormalizeRelationRows(rows) {
    if (!Array.isArray(rows)) return [];
    const out = [];
    for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const target = String(row.target ?? '').trim();
        const type = String(row.type ?? '').trim();
        if (!target && !type) continue;
        const fromStage = niNormalizeExitStage(row.fromStage);
        const toRaw = parseInt(row.toStage, 10);
        const toStage = Number.isFinite(toRaw) && toRaw >= 1 ? toRaw : null;
        out.push({ target, type, fromStage, toStage });
    }
    return out;
}

/**
 * 只保留「当前阶段仍然成立」的关系。
 * 没写阶段的行视为全程成立；fromStage > toStage 视为写反了，自动交换。
 */
export function niFilterRelationsByStage(rows, stageIdx) {
    const list = niNormalizeRelationRows(rows);
    const now = parseInt(stageIdx, 10);
    if (!Number.isFinite(now) || now < 1) return list.slice();
    return list.filter(row => {
        let from = row.fromStage;
        let to = row.toStage;
        if (from != null && to != null && from > to) { const t = from; from = to; to = t; }
        if (from != null && now < from) return false;
        if (to != null && now > to) return false;
        return true;
    });
}

/** `苏晚：同门师姐（第 1–4 阶段）；玄阳子：师父` 拼成一段；没有可用关系返回 '' */
export function niFormatRelationsForStage(rows, stageIdx) {
    const list = niFilterRelationsByStage(rows, stageIdx);
    if (!list.length) return '';
    return list.map(row => {
        const who = row.target || '某人';
        const what = row.type || '—';
        const span = (row.fromStage != null || row.toStage != null)
            ? `（第 ${row.fromStage ?? 1}–${row.toStage ?? '…'} 阶段）`
            : '';
        return `${who}：${what}${span}`;
    }).join('；');
}

/* ------------------------------------------------------------------ */
/* 知情边界                                                             */
/* ------------------------------------------------------------------ */

/**
 * 规范化「该角色知道的事」。
 * @param {Array<{fact?: any, fromStage?: any}>} rows
 */
export function niNormalizeKnowledgeRows(rows) {
    if (!Array.isArray(rows)) return [];
    const out = [];
    for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const fact = String(row.fact ?? '').trim();
        if (!fact) continue;
        out.push({ fact, fromStage: niNormalizeExitStage(row.fromStage) });
    }
    return out;
}

/** 当前阶段该角色已经知道的事 */
export function niFilterKnowledgeByStage(rows, stageIdx) {
    const list = niNormalizeKnowledgeRows(rows);
    const now = parseInt(stageIdx, 10);
    if (!Number.isFinite(now) || now < 1) {
        return list.filter(row => row.fromStage == null);
    }
    return list.filter(row => row.fromStage == null || now >= row.fromStage);
}

/** `知道：苏晚中毒（第 5 阶段起）；掌门已死` */
export function niFormatKnowledgeForStage(rows, stageIdx) {
    const list = niFilterKnowledgeByStage(rows, stageIdx);
    if (!list.length) return '';
    return list.map(row => (row.fromStage != null ? `${row.fact}（第 ${row.fromStage} 阶段起）` : row.fact)).join('；');
}

/* ------------------------------------------------------------------ */
/* 出场索引（只读）                                                     */
/* ------------------------------------------------------------------ */

/** 名字在正文里出现几次（大小写无关，按出现次数计） */
export function niCountNameHits(text, name) {
    const hay = String(text ?? '');
    const needle = String(name ?? '').trim();
    if (!hay || !needle) return 0;
    const lowerHay = hay.toLowerCase();
    const lowerNeedle = needle.toLowerCase();
    let count = 0;
    let from = 0;
    while (true) {
        const at = lowerHay.indexOf(lowerNeedle, from);
        if (at < 0) break;
        count++;
        from = at + lowerNeedle.length;
        if (count > 999) break;
    }
    return count;
}

/** 取命中位置前后一小段，用「…」包住 */
export function niExtractHitSnippet(text, name, { pad = 18 } = {}) {
    const hay = String(text ?? '');
    const needle = String(name ?? '').trim();
    if (!hay || !needle) return '';
    const at = hay.toLowerCase().indexOf(needle.toLowerCase());
    if (at < 0) return '';
    const start = Math.max(0, at - pad);
    const end = Math.min(hay.length, at + needle.length + pad);
    const body = hay.slice(start, end).replace(/\s+/g, ' ').trim();
    return `${start > 0 ? '…' : ''}${body}${end < hay.length ? '…' : ''}`;
}

/**
 * 取出角色可用的别名文本（去空、去重、去掉与本名相同的）。
 * @param {object} char
 * @returns {string[]}
 */
export function niCollectCharAliasTexts(char) {
    const name = String(char?.name || '').trim();
    const list = Array.isArray(char?.aliases) ? char.aliases : [];
    const out = [];
    for (const item of list) {
        const text = String(item?.text ?? item?.name ?? item ?? '').trim();
        if (!text) continue;
        if (name && text === name) continue;
        if (out.includes(text)) continue;
        out.push(text);
    }
    return out;
}

/** 本名 + 全部别名 + 全部身份名，给「出场索引」「在场判定」用 */
export function niCollectCharNames(char) {
    const name = String(char?.name || '').trim();
    const out = name ? [name] : [];
    for (const text of niCollectCharAliasTexts(char)) {
        if (!out.includes(text)) out.push(text);
    }
    for (const label of niCollectCharIdentityLabels(char)) {
        if (!out.includes(label)) out.push(label);
    }
    return out;
}

/** 「老祖、血刀老祖」，没有别名返回空串 */
export function niFormatAliasHint(aliases) {
    const list = Array.isArray(aliases) ? aliases : [];
    const texts = [];
    for (const item of list) {
        const text = String(item?.text ?? item?.name ?? item ?? '').trim();
        if (text && !texts.includes(text)) texts.push(text);
    }
    return texts.join('、');
}

/**
 * 把用户输入的「老祖、血刀老祖」拆成去重数组。
 * 支持顿号/逗号/分号/斜杠/空白分隔。
 */
export function niNormalizeAliasInput(value) {
    return String(value ?? '')
        .split(/[、,，;；/|｜\s]+/)
        .map((v) => v.trim())
        .filter(Boolean)
        .filter((v, i, arr) => arr.indexOf(v) === i);
}

/**
 * 合并别名列表：保留原有条目的 kind / note / _chunkIdx，只增删文本。
 * @param {Array} prevAliases 原有 c.aliases
 * @param {string[]} texts niNormalizeAliasInput 的结果
 * @param {string} charName 本名（用于补 character_name）
 */
export function niMergeAliasList(prevAliases, texts, charName = '') {
    const prev = Array.isArray(prevAliases) ? prevAliases : [];
    const want = Array.isArray(texts) ? texts : [];
    const name = String(charName || '').trim();
    const out = [];
    for (const text of want) {
        if (!text || (name && text === name)) continue;
        const hit = prev.find((item) => String(item?.text ?? item?.name ?? '').trim() === text);
        if (hit) {
            out.push({ ...hit, text });
        } else {
            out.push({ text, kind: 'manual', character_name: name, note: '' });
        }
    }
    return out;
}

/**
 * 多个称呼一起数命中：长词优先，命中过的片段打码，
 * 这样「血刀老祖」不会被「老祖」重复计一遍。
 * @returns {{ hits: number, perTerm: Record<string, number> }}
 */
export function niCountTermHits(text, terms = []) {
    const source = String(text || '').toLowerCase();
    const list = (Array.isArray(terms) ? terms : [])
        .map((v) => String(v ?? '').trim())
        .filter(Boolean)
        .filter((v, i, arr) => arr.indexOf(v) === i)
        .sort((a, b) => b.length - a.length);
    const perTerm = {};
    let hits = 0;
    if (!source || !list.length) return { hits, perTerm };
    let hay = source;
    for (const term of list) {
        const needle = term.toLowerCase();
        if (!needle) continue;
        let count = 0;
        let from = 0;
        for (;;) {
            const at = hay.indexOf(needle, from);
            if (at < 0) break;
            count++;
            hay = hay.slice(0, at) + '\u0000'.repeat(needle.length) + hay.slice(at + needle.length);
            from = at + needle.length;
        }
        if (count) {
            perTerm[term] = count;
            hits += count;
        }
    }
    return { hits, perTerm };
}

/**
 * 找出一个角色出现在哪些节点。
 * @param {{ name?: string, nodes?: Array<{id?: string, title?: string, stageIdx?: number, text?: string}> }} opts
 * @returns {Array<{ stageIdx: number, nodeId: string, nodeTitle: string, hits: number, snippet: string }>}
 */
export function niFindCharAppearances({ name = '', names = [], nodes = [] } = {}) {
    const list = Array.isArray(nodes) ? nodes : [];
    const terms = (Array.isArray(names) && names.length ? names : [name])
        .map((v) => String(v ?? '').trim())
        .filter(Boolean)
        .filter((v, i, arr) => arr.indexOf(v) === i);
    const out = [];
    if (!terms.length) return out;
    for (const node of list) {
        if (!node) continue;
        const { hits, perTerm } = niCountTermHits(node.text, terms);
        if (hits <= 0) continue;
        let bestTerm = '';
        let bestHits = 0;
        Object.entries(perTerm).forEach(([term, count]) => {
            if (count > bestHits) { bestHits = count; bestTerm = term; }
        });
        const matched = Object.keys(perTerm);
        out.push({
            stageIdx: Number.isFinite(parseInt(node.stageIdx, 10)) ? parseInt(node.stageIdx, 10) : 0,
            nodeId: String(node.id ?? ''),
            nodeTitle: String(node.title ?? ''),
            hits,
            matched,
            snippet: niExtractHitSnippet(node.text, bestTerm || terms[0]),
        });
    }
    return out;
}

/** 汇总成卡片上那行小字要用的数据 */
export function niSummarizeAppearances(appearances = []) {
    const list = Array.isArray(appearances) ? appearances : [];
    const stageSet = new Set();
    let hits = 0;
    for (const item of list) {
        hits += Number(item?.hits) || 0;
        if (item?.stageIdx) stageSet.add(item.stageIdx);
    }
    const stages = [...stageSet].sort((a, b) => a - b);
    return {
        nodeCount: list.length,
        hitCount: hits,
        stageCount: stages.length,
        stages,
        firstStage: stages.length ? stages[0] : null,
        lastStage: stages.length ? stages[stages.length - 1] : null,
    };
}

/** 「共 12 处 · 第 1–7 阶段 · 9 个节点」 */
export function niFormatAppearanceSummary(summary) {
    const s = summary || {};
    if (!s.nodeCount) return '正文里没找到这个名字';
    const span = s.stageCount > 1 ? `第 ${s.firstStage}–${s.lastStage} 阶段` : `第 ${s.firstStage} 阶段`;
    return `共 ${s.hitCount} 处 · ${span} · ${s.nodeCount} 个节点`;
}

/* ------------------------------------------------------------------ */
/* 多身份：同一个人在不同阶段以不同身份出现                              */
/* ------------------------------------------------------------------ */

/**
 * 归一化「多身份」行。
 * 每行 = { label, fromStage, toStage, secret, revealAt }
 * - label 为空的行直接丢弃
 * - fromStage 空 = 从开头；toStage 空 = 一直到结尾
 * - secret = 这层身份本身是秘密，revealAt 之前不点破它和本名的关系
 * @param {Array} rows
 */
export function niNormalizeIdentityRows(rows) {
    if (!Array.isArray(rows)) return [];
    const out = [];
    for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const label = String(row.label ?? row.name ?? '').trim();
        if (!label) continue;
        const fromStage = niNormalizeExitStage(row.fromStage);
        const toRaw = parseInt(row.toStage, 10);
        const toStage = Number.isFinite(toRaw) && toRaw >= 1 ? toRaw : null;
        const revealRaw = parseInt(row.revealAt, 10);
        const revealAt = Number.isFinite(revealRaw) && revealRaw >= 1 ? revealRaw : null;
        out.push({
            label,
            fromStage,
            toStage,
            secret: row.secret === true || row.secret === 'true' || row.secret === 1 || row.secret === '1',
            revealAt,
        });
    }
    return out;
}

/** 只保留「当前阶段仍然成立」的身份；区间写反了自动交换 */
export function niFilterIdentitiesByStage(rows, stageIdx) {
    const list = niNormalizeIdentityRows(rows);
    const now = parseInt(stageIdx, 10);
    if (!Number.isFinite(now) || now < 1) return list.slice();
    return list.filter((row) => {
        let from = row.fromStage;
        let to = row.toStage;
        if (from != null && to != null && from > to) { const t = from; from = to; to = t; }
        if (from != null && now < from) return false;
        if (to != null && now > to) return false;
        return true;
    });
}

/**
 * 当前阶段的身份状态。
 * plain = 可以直说的身份；concealed = 还不能点破的秘密身份；
 * revealed = 已经揭晓、可以明说「就是本人」的秘密身份。
 */
export function niResolveIdentityState(rows, stageIdx) {
    const now = parseInt(stageIdx, 10);
    const active = niFilterIdentitiesByStage(rows, stageIdx);
    const plain = [];
    const concealed = [];
    const revealed = [];
    for (const row of active) {
        if (!row.secret) { plain.push(row); continue; }
        if (row.revealAt != null && Number.isFinite(now) && now >= row.revealAt) revealed.push(row);
        else concealed.push(row);
    }
    return { active, plain, concealed, revealed };
}

/**
 * 注入用的身份文字（可能多行）。
 * 秘密身份在揭晓前只发「另一形态：黑影（来历不明）」，
 * 绝不写「= 夏弥」，否则等于剧透。
 */
export function niFormatIdentitiesForStage(rows, stageIdx, charName = '') {
    const state = niResolveIdentityState(rows, stageIdx);
    const lines = [];
    if (state.plain.length) {
        const labels = state.plain.map((row) => row.label).join('、');
        lines.push(`身份：${labels}`);
    }
    for (const row of state.concealed) {
        lines.push(`另一形态：${row.label}（来历不明，真实身份尚未揭晓）`);
    }
    const base = String(charName || '').trim();
    for (const row of state.revealed) {
        const when = row.revealAt != null ? `第 ${row.revealAt} 阶段起揭晓` : '已揭晓';
        lines.push(base
            ? `身份关系：${row.label} 与 ${base} 是同一人（${when}）`
            : `身份关系：${row.label} 就是本人（${when}）`);
    }
    return lines.join('\n');
}

/** 卡片上那行小字：「夏弥（第 1–5 阶段）· 黑影（第 2–8 阶段，第 6 阶段揭晓）」 */
export function niFormatIdentitySummary(rows) {
    const list = niNormalizeIdentityRows(rows);
    if (!list.length) return '';
    return list.map((row) => {
        const span = (row.fromStage != null || row.toStage != null)
            ? `（第 ${row.fromStage ?? 1}–${row.toStage ?? '…'} 阶段${row.secret && row.revealAt != null ? `，第 ${row.revealAt} 阶段揭晓` : ''}）`
            : (row.secret ? '（秘密身份）' : '');
        return `${row.label}${span}`;
    }).join(' · ');
}

/** 全部身份名（给出场索引/在场判定） */
export function niCollectCharIdentityLabels(char) {
    const list = niNormalizeIdentityRows(char?.identities);
    const out = [];
    for (const row of list) {
        if (!out.includes(row.label)) out.push(row.label);
    }
    return out;
}
