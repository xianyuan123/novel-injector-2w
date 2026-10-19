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
 * 找出一个角色出现在哪些节点。
 * @param {{ name?: string, nodes?: Array<{id?: string, title?: string, stageIdx?: number, text?: string}> }} opts
 * @returns {Array<{ stageIdx: number, nodeId: string, nodeTitle: string, hits: number, snippet: string }>}
 */
export function niFindCharAppearances({ name = '', nodes = [] } = {}) {
    const list = Array.isArray(nodes) ? nodes : [];
    const out = [];
    for (const node of list) {
        if (!node) continue;
        const hits = niCountNameHits(node.text, name);
        if (hits <= 0) continue;
        out.push({
            stageIdx: Number.isFinite(parseInt(node.stageIdx, 10)) ? parseInt(node.stageIdx, 10) : 0,
            nodeId: String(node.id ?? ''),
            nodeTitle: String(node.title ?? ''),
            hits,
            snippet: niExtractHitSnippet(node.text, name),
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
