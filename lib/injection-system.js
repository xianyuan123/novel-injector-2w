export const NI_RAW_INJECTION_MAX_TOKENS_DEFAULT = 32000;
export const NI_RAW_INJECTION_CHARS_PER_TOKEN = 1.5;

// 合并阶段节点（main/sub/pivot -> 顺序数组）。story-data.js 不反向依赖本模块，
// 顶层 import 不会形成循环。
import {
    niBuildBlockedRecallContext,
    niBuildStageBlockedNodeFilter,
    niExcludeBlockedStageIndices,
    niIsPlotBlockedByRecallFilter,
    niMergeStageNodes,
    niPlotNodeId,
} from './story-data.js';

export function niNormalizeRawInjectionMaxTokens(value, fallback = NI_RAW_INJECTION_MAX_TOKENS_DEFAULT) {
    const fallbackValue = Math.max(256, Math.min(200000, parseInt(fallback, 10) || NI_RAW_INJECTION_MAX_TOKENS_DEFAULT));
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallbackValue;
    return Math.max(256, Math.min(200000, parsed));
}

// ---- 向量块注入：单轮 Token 上限与向量块切分大小 ----
// 向量块的注入体积此前由「每个块固定字数 × 召回段数」决定，而块切分固定 500 字、
// 召回片段数被模板输入框卡在 20，单轮实际只有两千 Token 上下。这里给它一条与
// 未向量阶段同构的 Token 预算通道：按长度累加召回片段，装不下就不再继续取分。
export const NI_VEC_INJECTION_MAX_TOKENS_DEFAULT = 20000;
export const NI_VEC_INJECTION_MAX_TOKENS_LIMIT = 200000;
export const NI_VEC_INJECTION_CHARS_PER_TOKEN = 1.5;
export const NI_VEC_CHUNK_CHARS_DEFAULT = 1000;
export const NI_VEC_CHUNK_CHARS_MIN = 200;
export const NI_VEC_CHUNK_CHARS_MAX = 4000;

export function niNormalizeVectorInjectionMaxTokens(value, fallback = NI_VEC_INJECTION_MAX_TOKENS_DEFAULT) {
    const fallbackValue = Math.max(
        256,
        Math.min(NI_VEC_INJECTION_MAX_TOKENS_LIMIT, parseInt(fallback, 10) || NI_VEC_INJECTION_MAX_TOKENS_DEFAULT),
    );
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallbackValue;
    return Math.max(256, Math.min(NI_VEC_INJECTION_MAX_TOKENS_LIMIT, parsed));
}

export function niNormalizeVectorChunkChars(value, fallback = NI_VEC_CHUNK_CHARS_DEFAULT) {
    const fallbackValue = Math.max(
        NI_VEC_CHUNK_CHARS_MIN,
        Math.min(NI_VEC_CHUNK_CHARS_MAX, parseInt(fallback, 10) || NI_VEC_CHUNK_CHARS_DEFAULT),
    );
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallbackValue;
    return Math.max(NI_VEC_CHUNK_CHARS_MIN, Math.min(NI_VEC_CHUNK_CHARS_MAX, parsed));
}

export function niVectorInjectionCharBudget(maxTokens, charsPerToken = NI_VEC_INJECTION_CHARS_PER_TOKEN) {
    const normalizedCharsPerToken = Number(charsPerToken) > 0
        ? Number(charsPerToken)
        : NI_VEC_INJECTION_CHARS_PER_TOKEN;
    return Math.max(256, Math.floor(niNormalizeVectorInjectionMaxTokens(maxTokens) * normalizedCharsPerToken));
}

export function niPrioritizeStageIndices(stageIndices = [], currentStageIdx = null) {
    const stages = [...new Set((Array.isArray(stageIndices) ? stageIndices : [])
        .map(stageIdx => Number(stageIdx))
        .filter(stageIdx => Number.isFinite(stageIdx) && stageIdx > 0))];
    if (!stages.length) return [];
    const explicitCurrent = Number(currentStageIdx);
    const anchor = Number.isFinite(explicitCurrent) && explicitCurrent > 0
        ? explicitCurrent
        : Math.max(...stages);
    return stages.sort((a, b) => {
        const distanceDiff = Math.abs(anchor - a) - Math.abs(anchor - b);
        return distanceDiff || b - a;
    });
}

export function niBuildBoundedStageInjection({
    stageIndices = [],
    currentStageIdx = null,
    maxTokens = NI_RAW_INJECTION_MAX_TOKENS_DEFAULT,
    charsPerToken = NI_RAW_INJECTION_CHARS_PER_TOKEN,
    getDetailText = () => '',
    getSummaryText = () => '',
} = {}) {
    const normalizedCharsPerToken = Number(charsPerToken) > 0 ? Number(charsPerToken) : NI_RAW_INJECTION_CHARS_PER_TOKEN;
    const tokenBudget = niNormalizeRawInjectionMaxTokens(maxTokens);
    const charBudget = Math.max(1, Math.floor(tokenBudget * normalizedCharsPerToken));
    const priorityStages = niPrioritizeStageIndices(stageIndices, currentStageIdx);
    const anchor = Number.isFinite(Number(currentStageIdx)) && Number(currentStageIdx) > 0
        ? Number(currentStageIdx)
        : (priorityStages[0] ?? null);
    const selected = [];
    const omittedStages = [];
    const emptyStages = [];
    let usedChars = 0;
    let truncated = false;

    const append = (stageIdx, kind, rawText, allowTruncate = false) => {
        const text = String(rawText || '').trim();
        if (!text) return false;
        const separatorChars = selected.length ? 2 : 0;
        const available = charBudget - usedChars - separatorChars;
        if (available <= 0) return false;
        if (text.length <= available) {
            selected.push({ stageIdx, kind, text });
            usedChars += separatorChars + text.length;
            return true;
        }
        if (!allowTruncate) return false;
        const marker = '\n……（已达到未向量阶段单轮注入上限）';
        if (available <= marker.length + 20) return false;
        selected.push({
            stageIdx,
            kind: `${kind}-truncated`,
            text: `${text.slice(0, available - marker.length)}${marker}`,
        });
        usedChars += separatorChars + available;
        truncated = true;
        return true;
    };

    priorityStages.forEach(stageIdx => {
        if (usedChars >= charBudget) {
            omittedStages.push(stageIdx);
            return;
        }
        const detailText = String(getDetailText(stageIdx) || '').trim();
        const isPrimary = stageIdx === anchor || selected.length === 0;
        if (detailText && append(stageIdx, 'detail', detailText, isPrimary)) return;
        const summaryText = String(getSummaryText(stageIdx) || '').trim();
        if (summaryText && append(stageIdx, 'summary', summaryText, false)) return;
        if (!detailText && !summaryText) emptyStages.push(stageIdx);
        else omittedStages.push(stageIdx);
    });

    const chronological = selected.slice().sort((a, b) => a.stageIdx - b.stageIdx);
    const text = chronological.map(item => item.text).join('\n\n');
    return {
        text,
        selected: chronological,
        detailStages: chronological.filter(item => item.kind.startsWith('detail')).map(item => item.stageIdx),
        summaryStages: chronological.filter(item => item.kind === 'summary').map(item => item.stageIdx),
        omittedStages,
        emptyStages,
        truncated,
        maxTokens: tokenBudget,
        estimatedTokens: text ? Math.ceil(text.length / normalizedCharsPerToken) : 0,
        usedChars: text.length,
        charBudget,
    };
}

export function niBuildStageInjectionPayload({
    stageIndices = [],
    currentStageIdx = null,
    maxTokens = NI_RAW_INJECTION_MAX_TOKENS_DEFAULT,
    charsPerToken = NI_RAW_INJECTION_CHARS_PER_TOKEN,
    rawMode = 'nodes',
    contentTokenReserve = 32,
    fullInject = false,
    getDetailText = () => '',
    getSummaryText = () => '',
} = {}) {
    const mode = rawMode === 'compressed' ? 'compressed' : 'nodes';
    const normalizedMaxTokens = niNormalizeRawInjectionMaxTokens(maxTokens);
    // 整段直注：当前阶段要「全注入」，用户给的单轮上限只属于「未向量阶段」，
    // 不拿来裁剪它，改用一个足够宽的上限兜住极端情况（超长阶段仍会截断）。
    const effectiveMaxTokens = fullInject === true
        ? Math.max(normalizedMaxTokens, NI_FULL_STAGE_INJECTION_MAX_TOKENS)
        : normalizedMaxTokens;
    const reserve = Math.max(0, parseInt(contentTokenReserve, 10) || 0);
    const normalizedCharsPerToken = Number(charsPerToken) > 0
        ? Number(charsPerToken)
        : NI_RAW_INJECTION_CHARS_PER_TOKEN;
    const result = niBuildBoundedStageInjection({
        stageIndices,
        currentStageIdx,
        maxTokens: Math.max(256, effectiveMaxTokens - reserve),
        charsPerToken: normalizedCharsPerToken,
        getDetailText,
        getSummaryText,
    });
    const tag = mode === 'compressed' ? '小说压缩原文' : '小说剧情节点';
    const content = result.text ? `[${tag}]\n${result.text}\n[/${tag}]` : '';

    return {
        ...result,
        rawMode: mode,
        tag,
        content,
        fullInject: fullInject === true,
        configuredMaxTokens: normalizedMaxTokens,
        maxTokens: effectiveMaxTokens,
        estimatedTokens: content ? Math.ceil(content.length / normalizedCharsPerToken) : 0,
    };
}

export function niIsVectorInjectionDisabledByUser(settings = {}) {
    return settings?.vecInjDisabled === true && settings?.vecInjDisabledByUser === true;
}

export function niNormalizeVectorInjectionPreference(settings = {}) {
    const disabled = niIsVectorInjectionDisabledByUser(settings);
    const changed = settings.vecInjDisabled !== disabled
        || settings.vecInjDisabledByUser !== disabled;
    settings.vecInjDisabled = disabled;
    settings.vecInjDisabledByUser = disabled;
    return changed;
}

export function niSetVectorInjectionDisabledByUser(settings = {}, disabled = false) {
    const value = disabled === true;
    settings.vecInjDisabled = value;
    settings.vecInjDisabledByUser = value;
    return value;
}

export function niResolveStageInjectionPlan({
    enabledStages = [],
    stageVecDone = {},
    settings = {},
} = {}) {
    const stages = [...new Set((Array.isArray(enabledStages) ? enabledStages : [])
        .map(stageIdx => Number(stageIdx))
        .filter(stageIdx => Number.isFinite(stageIdx) && stageIdx > 0))];
    const vectorInjectionDisabled = niIsVectorInjectionDisabledByUser(settings);
    const stageHasVector = stageIdx => !!stageVecDone?.[stageIdx];
    const vectorStages = vectorInjectionDisabled
        ? []
        : stages.filter(stageHasVector);
    const rawStages = vectorInjectionDisabled
        ? stages.slice()
        : stages.filter(stageIdx => !stageHasVector(stageIdx));

    return {
        vectorInjectionDisabled,
        vectorStages,
        rawStages,
    };
}

export function niResolveDirectStageInjectionStages({
    rawStages = [],
    transBookMode = false,
    currentStageIdx = null,
    paused = false,
} = {}) {
    const stages = [...new Set((Array.isArray(rawStages) ? rawStages : [])
        .map(stageIdx => Number(stageIdx))
        .filter(stageIdx => Number.isFinite(stageIdx) && stageIdx > 0))];
    if (!transBookMode) return stages;
    if (paused) return [];

    const current = Number(currentStageIdx);
    if (!Number.isFinite(current) || current <= 0) return [];
    return stages.includes(current) ? [current] : [];
}

/**
 * 穿书模式下阶段直注的取文范围：只发「当前正在进行的节点」，而不是整个当前阶段。
 * 阶段里排在当前节点之后的节点还没演到，整阶段发出去等于提前向模型剧透。
 *
 * nodes 模式取该节点本身；compressed 模式取它所在的那一段清洗原文
 * （节点的 _chunkIdx 指向原始分段的全局索引，由 niNormalizeTransbookNode 写入）。
 * 返回 null 表示无法收紧，由调用方退回整阶段逻辑——不能让注入直接变空。
 *
 * 注意：开启「当前阶段全量直注」时**不要**走这个函数，要改走下面的
 * niBuildTransbookWholeStageDetailText()，否则整阶段直注会被收紧成当前节点一个。
 */
export function niBuildTransbookStageDetailText(stageIdx, curTbNode, {
    rawMode = 'nodes',
    getCompressedChunkText = () => '',
    blockedContext = null,
} = {}) {
    if (!curTbNode) return null;
    const nodeStageIdx = Number(curTbNode.stageIdx);
    // 锚点节点不属于本阶段时不替换取文，否则会把别的阶段内容挂到这个阶段名下。
    if (Number.isFinite(nodeStageIdx) && nodeStageIdx > 0 && nodeStageIdx !== Number(stageIdx)) return null;
    // 当前节点被用户屏蔽时不发它，交回上层按普通阶段内容取文。
    if (niIsPlotBlockedByRecallFilter(curTbNode, blockedContext, stageIdx)) return null;

    if (rawMode === 'compressed') {
        const chunkIdx = Number(curTbNode._chunkIdx);
        if (!Number.isFinite(chunkIdx) || chunkIdx < 0) return null;
        const text = String(getCompressedChunkText(chunkIdx) || '').trim();
        return text ? `【第 ${stageIdx} 阶段当前节点原文】\n${text}` : null;
    }

    const title = String(curTbNode.title || '').trim() || '未命名节点';
    const body = String(curTbNode.body || curTbNode.content || '').trim();
    return `【第 ${stageIdx} 阶段当前节点】\n· ${title}：${body}`;
}

/**
 * 穿书模式 + 整阶段全量直注时，把整个阶段的剧情都发出去（不只是当前节点）。
 *
 * 与上面那个「只发当前节点」的版本互斥：用户明确要求本阶段严格按剧情走时，
 * 连还没演到的节点也一起给模型看——这正是全量直注与普通穿书推进的区别。
 * nodes 模式列出该阶段全部节点；compressed 模式取该阶段涉及的全部清洗分段。
 *
 * 合并阶段节点用 story-data.js 的 niMergeStageNodes()（本模块顶层 import，
 * 已确认 story-data.js 不反向依赖本模块，不存在循环依赖）。
 */
export function niBuildTransbookWholeStageDetailText(stageIdx, {
    rawMode = 'nodes',
    getCompressedChunkText = () => '',
    runtimeIndex = null,
    blockedContext = null,
    blockedChunkIdxs = null,
} = {}) {
    const idx = Number(stageIdx);
    if (!Number.isFinite(idx) || idx <= 0) return '';
    const blocked = blockedContext?.active ? blockedContext : null;
    const blockedChunks = new Set(
        (Array.isArray(blockedChunkIdxs) ? blockedChunkIdxs : [])
            .map(chunkIdx => Number(chunkIdx))
            .filter(chunkIdx => Number.isFinite(chunkIdx) && chunkIdx >= 0),
    );

    if (rawMode === 'compressed') {
        const chunkIdxSet = runtimeIndex?.chunkIdxsByStage?.[idx] || new Set();
        const texts = [...chunkIdxSet]
            .map(Number)
            .filter(chunkIdx => Number.isFinite(chunkIdx) && chunkIdx >= 0)
            // 整块被屏蔽（块里节点全被勾掉，或该阶段被整段屏蔽）时不发这段原文。
            .filter(chunkIdx => !blockedChunks.has(chunkIdx))
            .sort((a, b) => a - b)
            .map(getCompressedChunkText)
            .map(text => String(text || '').trim())
            .filter(Boolean);
        return texts.length ? `【第 ${idx} 阶段压缩原文】\n${texts.join('\n')}` : '';
    }

    const stageNodes = runtimeIndex?.nodesByStage?.[idx];
    if (!stageNodes) return '';
    // 屏蔽的节点单独剔除（阶段被整段屏蔽时全部剔除），其余仍照常整段直注。
    const allNodes = niMergeStageNodes(stageNodes, {
        filter: niBuildStageBlockedNodeFilter(blocked, idx),
    });
    if (!allNodes.length) return '';
    return `【第 ${idx} 阶段剧情节点】\n${allNodes
        .map(plot => `· ${plot.title || '未命名节点'}：${plot.body || plot.content || ''}`)
        .join('\n')}`;
}

export const NI_FULL_STAGE_INJECTION_MAX_TOKENS = NI_VEC_INJECTION_MAX_TOKENS_LIMIT;

export function niIsFullStageInjectionEnabled(settings = {}) {
    return settings?.curStageFullInject === true;
}

/**
 * 把「当前阶段是否整段直注」编译进阶段注入方案。
 *
 * 开着向量化玩到第 8 阶段时，第 8 阶段自己就是正在演的那一段，靠语义召回反而
 * 常常漏掉还没被聊到的节点；而第 1～7 阶段是已经演过的前情，用召回足够且省
 * 上下文。所以这里做两件事：
 *
 * 1. 把当前阶段从「向量召回」挪进「整段直注」——它不再走召回，改为把该阶段
 *    剧情节点（或压缩原文）整段发出去。
 * 2. 重新划分召回池：当前阶段原本在前情池之外，要补进去，否则关掉当前阶段的
 *    召回后前情池会凭空少一个阶段。
 *
 * 只有在当前阶段确实开启时才生效；未开启不做任何改动，配置里也不会多留一个
 * 不存在的阶段。currentStageIdx 缺省时退回方案自身的边界阶段。
 */
export function niResolveFullStageInjectionPlan({
    plan = {},
    vectorRecallScope = {},
    enabled = false,
    currentStageIdx = null,
    settings = {},
    blockedRecallContext = null,
    explicitPlotEntries = null,
} = {}) {
    const scope = vectorRecallScope || {};
    // 「召回屏蔽」在这里统一落地：被屏蔽的阶段与整段被屏蔽的源块都不再参与召回。
    // 屏蔽状态只是设置里的普通对象，每次解析时重新读取即可，不会过期。
    const blocked = blockedRecallContext || niBuildBlockedRecallContext(settings || {});
    const historical = niExcludeBlockedStageIndices((Array.isArray(scope.historicalStages) ? scope.historicalStages : [])
        .map(stageIdx => Number(stageIdx))
        .filter(stageIdx => Number.isFinite(stageIdx) && stageIdx > 0), blocked);
    const fullInjectEnabled = enabled === true;
    // 没显式传当前阶段（null/undefined）时退回方案自己的边界阶段，与 scope 的判定
    // 保持一致；传了但非法（0 / NaN / 负数 / 空串）则视为明确无效，不生效。
    const targetMissing = currentStageIdx == null || currentStageIdx === '';
    const fallbackTarget = Number(scope.boundaryStageIdx);
    const rawTarget = Number(currentStageIdx);
    const resolvedTarget = targetMissing
        ? (Number.isFinite(fallbackTarget) && fallbackTarget > 0 ? fallbackTarget : null)
        : (Number.isFinite(rawTarget) && rawTarget > 0 ? rawTarget : null);
    const fullInjectStageIdx = resolvedTarget;
    const enabledSet = new Set((Array.isArray(plan.enabledStages) ? plan.enabledStages : [])
        .map(stageIdx => Number(stageIdx))
        .filter(stageIdx => Number.isFinite(stageIdx) && stageIdx > 0));
    const canFullInject = fullInjectEnabled
        && fullInjectStageIdx != null
        && enabledSet.has(fullInjectStageIdx);

    let effectiveScope = scope;
    let directStages = [...new Set((Array.isArray(plan.directStageInjectionStages) ? plan.directStageInjectionStages : [])
        .map(stageIdx => Number(stageIdx))
        .filter(stageIdx => Number.isFinite(stageIdx) && stageIdx > 0))].sort((a, b) => a - b);

    if (blocked.active) {
        // 屏蔽要生效在两条路径上，不只是整段直注开启时：把被屏蔽的阶段从当前池里摘掉。
        effectiveScope = {
            ...effectiveScope,
            currentStages: niExcludeBlockedStageIndices(effectiveScope.currentStages, blocked),
            historicalStages: niExcludeBlockedStageIndices(effectiveScope.historicalStages, blocked),
        };
    }

    if (canFullInject) {
        // 当前阶段整体直注，不再进召回池。
        const recallStages = niExcludeBlockedStageIndices(
            (Array.isArray(effectiveScope.currentStages) ? effectiveScope.currentStages : [])
                .map(stageIdx => Number(stageIdx))
                .filter(stageIdx => Number.isFinite(stageIdx) && stageIdx > 0 && stageIdx !== fullInjectStageIdx),
            blocked,
        );
        // 直注阶段必须从召回池彻底移除：scope.historicalStages 在「当前窗口跨多个
        // 阶段」的普通模式下会包含它（例如只开 1~8 且无显式当前节点时整窗口是 1~8），
        // 不排掉就会和整段直注重复注入同一段剧情。前情池本身不做重排，保持原顺序。
        const recallHistorical = (Array.isArray(effectiveScope.historicalStages)
            ? effectiveScope.historicalStages
            : [])
            .filter(stageIdx => stageIdx !== fullInjectStageIdx)
            .sort((a, b) => a - b);
        effectiveScope = {
            ...effectiveScope,
            currentStages: recallStages,
            historicalStages: recallHistorical,
            fullInjectStageIdx,
        };
        if (!directStages.includes(fullInjectStageIdx)) directStages.push(fullInjectStageIdx);
        directStages.sort((a, b) => a - b);
    }

    return {
        plan,
        vectorRecallScope: effectiveScope,
        directStageInjectionStages: directStages,
        fullInjectEnabled,
        fullInjectStageIdx: canFullInject ? fullInjectStageIdx : null,
        fullInjectApplied: canFullInject,
        // 有勾选但当前阶段没开启时，界面要能提醒「开关没生效」。
        fullInjectIdle: fullInjectEnabled && !canFullInject,
        // 召回屏蔽的判定上下文与「整块被屏蔽的源 chunk」，调用方拿去做块级过滤。
        blockedRecallContext: blocked,
        blockedStageIdxs: [...blocked.stageIdxSet].sort((a, b) => a - b),
        // 没有勾选任何「节点」时不可能存在整块被屏蔽的源分段，直接跳过全量剧情遍历
        // （这个函数每次刷新预览都会被调用，剧情节点很多时这趟遍历并不便宜）。
        blockedChunkIdxs: blocked.nodeIdSet.size
            ? [
                ...blocked.collectFullyBlockedChunkIdxs(
                    Array.isArray(explicitPlotEntries) ? explicitPlotEntries : [],
                ),
            ].sort((a, b) => a - b)
            : [],
    };
}

export function niResolvePausedTransbookPromptSlots({
    paused = false,
    immersionContent = '',
} = {}) {
    if (!paused) return null;
    return {
        advanceContent: '',
        ongoingContent: String(immersionContent ?? '').trim(),
    };
}

// ============================================================
// 未来剧情预告：把「后面若干阶段」的剧情提前注入，帮模型把握走向
// ============================================================
// 需求来源：玩到第 8 阶段的第 2 个节点时，第 8 阶段的第 3 个节点不该发——那会剧透
// 当前阶段、让 AI 提前把剧情跳过去。但「后面几个阶段大概会发生什么」反而有用：
// 模型能提前埋伏笔、把关键事件自然带出来，而不是等演到了才临时硬转。
//
// 所以这里单独开一条通道：从「当前阶段之后」按顺序挑几个阶段，每个阶段取前 N 个
// 节点（按剧情顺序），带一句「尚未演到、只作走向参考」的声明注入。它与阶段直注
// 互不影响：当前阶段仍然只发已演到的内容，未来阶段只发被挑中的这一小截。
// 屏蔽规则照旧生效——被屏蔽的节点、被整段屏蔽的阶段都不会出现在预告里。
//
// 「当前阶段优先」：「每阶段 N 个节点」只约束往后的阶段，当前阶段剩下的节点默认
// 全部下发（受总 Token 预算约束）。否则本阶段还剩 8 个节点、N 设成 4 时，只发 4 个
// 就跳到下一阶段，模型反而看不到本阶段的后半段。
export const NI_FUTURE_PLOT_TAG = '小说未来剧情预告';
export const NI_FUTURE_PLOT_STAGE_LIMIT = 20;
export const NI_FUTURE_PLOT_NODES_LIMIT = 20;
export const NI_FUTURE_PLOT_STAGE_DEFAULT = 1;
export const NI_FUTURE_PLOT_NODES_DEFAULT = 2;
export const NI_FUTURE_PLOT_BODY_CHAR_LIMIT = 600;
export const NI_FUTURE_PLOT_NOTICE = [
    '※ 以下内容尚未演到，只用来把握整体走向、提前埋设伏笔，让关键事件自然发生。',
    '※ 不要跳过当前剧情直接写这些内容，也不要让角色说出此刻还不该知道的细节。',
].join('\n');

export function niNormalizeFuturePlotStageCount(value, fallback = NI_FUTURE_PLOT_STAGE_DEFAULT) {
    const fallbackParsed = parseInt(fallback, 10);
    const fallbackValue = Number.isFinite(fallbackParsed)
        ? Math.max(0, Math.min(NI_FUTURE_PLOT_STAGE_LIMIT, fallbackParsed))
        : NI_FUTURE_PLOT_STAGE_DEFAULT;
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallbackValue;
    return Math.max(0, Math.min(NI_FUTURE_PLOT_STAGE_LIMIT, parsed));
}

// 0 有专门含义：把该阶段「全部节点」都放进预告，而不是一个都不取。
export function niNormalizeFuturePlotNodesPerStage(value, fallback = NI_FUTURE_PLOT_NODES_DEFAULT) {
    const fallbackParsed = parseInt(fallback, 10);
    const fallbackValue = Number.isFinite(fallbackParsed)
        ? Math.max(0, Math.min(NI_FUTURE_PLOT_NODES_LIMIT, fallbackParsed))
        : NI_FUTURE_PLOT_NODES_DEFAULT;
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallbackValue;
    return Math.max(0, Math.min(NI_FUTURE_PLOT_NODES_LIMIT, parsed));
}

export function niIsFuturePlotInjectionEnabled(settings = {}) {
    return settings?.futurePlotPreview === true;
}

/**
 * 挑出「要提前注入」的阶段：当前阶段（可选）+ 当前阶段之后的若干个阶段。
 *
 * 只看当前阶段和它后面的阶段：前面演过的阶段已经在对话里了，往前看没有意义。
 * 被关闭的阶段、被整段屏蔽的阶段都跳过——否则会出现「明明关了这个阶段，预告
 * 里却还在发它」的矛盾。
 *
 * includeCurrentStage 为真时把**当前阶段本身**排在最前面：这是在补「没开全量
 * 直注」时的缺口——那时当前阶段只发已经演到的节点，剩下的节点模型看不到，容易
 * 把本阶段的剧情写偏。此时 stageLimit 只数「后面还有几个阶段」，不占用当前阶段
 * 的名额；stageLimit 为 0 且 includeCurrentStage 为真时，就是「只预告当前阶段
 * 剩下的剧情」。
 */
export function niResolveFuturePlotStageIndices({
    stageCount = 0,
    currentStageIdx = null,
    stageLimit = NI_FUTURE_PLOT_STAGE_DEFAULT,
    enabledStages = null,
    blockedStageIdxs = [],
    includeCurrentStage = false,
} = {}) {
    const total = Math.max(0, parseInt(stageCount, 10) || 0);
    const anchor = Number(currentStageIdx);
    const anchorOk = Number.isFinite(anchor) && total > 0
        && Math.trunc(anchor) > 0 && Math.trunc(anchor) <= total;
    const enabledSet = Array.isArray(enabledStages)
        ? new Set(enabledStages.map(stageIdx => Number(stageIdx)).filter(stageIdx => Number.isFinite(stageIdx)))
        : null;
    const blockedSet = new Set((Array.isArray(blockedStageIdxs) ? blockedStageIdxs : [])
        .map(stageIdx => Number(stageIdx))
        .filter(stageIdx => Number.isFinite(stageIdx) && stageIdx > 0));
    const result = [];
    if (!anchorOk) return result;
    const anchorIdx = Math.trunc(anchor);
    const anchorUsable = (!enabledSet || enabledSet.has(anchorIdx)) && !blockedSet.has(anchorIdx);

    if (includeCurrentStage && anchorUsable) result.push(anchorIdx);

    const limit = niNormalizeFuturePlotStageCount(stageLimit, NI_FUTURE_PLOT_STAGE_DEFAULT);
    let futureCount = 0;
    for (let stageIdx = anchorIdx + 1; stageIdx <= total && futureCount < limit; stageIdx++) {
        if (enabledSet && !enabledSet.has(stageIdx)) continue;
        if (blockedSet.has(stageIdx)) continue;
        result.push(stageIdx);
        futureCount += 1;
    }
    return result;
}

/**
 * 组装「未来剧情预告」的正文。
 *
 * nodes 模式：往后每个阶段按剧情顺序取前 N 个节点（N=0 表示该阶段全部节点）；
 * 当前阶段优先，本阶段剩下的节点默认全部下发（currentStageNodesPerStage=0），
 * 「每阶段 N 个」不约束它。
 * compressed 模式：取该阶段涉及的清洗分段原文（每段截到 compressedChunkCharLimit）。
 *
 * currentStageIdx / startAfterNodeId 用来支持「当前阶段也预告」：当预告里包含当前
 * 阶段时，从**正在进行的那个节点之后**开始取，已经演过的节点不再重复发；不知道
 * 当前位置（普通模式没有逐节点进度）时就从该阶段第一个节点开始。
 *
 * 总长度受 maxTokens 约束（与「未向量阶段注入」共用同一个上限），装不下就在节点
 * 边界处停住并标记 truncated——不会把半句话切给模型。
 */
export function niBuildFuturePlotPreview({
    stageIndices = [],
    nodesByStage = {},
    chunkIdxsByStage = null,
    nodesPerStage = NI_FUTURE_PLOT_NODES_DEFAULT,
    // 当前阶段优先：0（默认）= 本阶段剩下的节点全部进预告，不受 nodesPerStage 限制。
    currentStageNodesPerStage = 0,
    rawMode = 'nodes',
    maxTokens = NI_RAW_INJECTION_MAX_TOKENS_DEFAULT,
    charsPerToken = NI_RAW_INJECTION_CHARS_PER_TOKEN,
    blockedContext = null,
    blockedChunkIdxs = null,
    getCompressedChunkText = () => '',
    bodyCharLimit = NI_FUTURE_PLOT_BODY_CHAR_LIMIT,
    compressedChunkCharLimit = 1500,
    currentStageIdx = null,
    startAfterNodeId = null,
} = {}) {
    const mode = rawMode === 'compressed' ? 'compressed' : 'nodes';
    const normalizedCharsPerToken = Number(charsPerToken) > 0
        ? Number(charsPerToken)
        : NI_RAW_INJECTION_CHARS_PER_TOKEN;
    const tokenBudget = niNormalizeRawInjectionMaxTokens(maxTokens);
    const charBudget = Math.max(1, Math.floor(tokenBudget * normalizedCharsPerToken));
    const nodeLimit = niNormalizeFuturePlotNodesPerStage(nodesPerStage, NI_FUTURE_PLOT_NODES_DEFAULT);
    // 当前阶段单独一份上限，默认 0 = 不截断（把本阶段剩下的节点全部发给模型）。
    const currentNodeLimit = niNormalizeFuturePlotNodesPerStage(currentStageNodesPerStage, 0);
    const bodyLimit = Math.max(80, parseInt(bodyCharLimit, 10) || NI_FUTURE_PLOT_BODY_CHAR_LIMIT);
    const chunkLimit = Math.max(80, parseInt(compressedChunkCharLimit, 10) || 1500);
    const blocked = blockedContext?.active ? blockedContext : null;
    const blockedChunks = new Set((Array.isArray(blockedChunkIdxs) ? blockedChunkIdxs : [])
        .map(chunkIdx => Number(chunkIdx))
        .filter(chunkIdx => Number.isFinite(chunkIdx) && chunkIdx >= 0));
    const stages = [...new Set((Array.isArray(stageIndices) ? stageIndices : [])
        .map(stageIdx => Number(stageIdx))
        .filter(stageIdx => Number.isFinite(stageIdx) && stageIdx > 0))]
        .sort((a, b) => a - b);
    const currentIdx = Number(currentStageIdx);
    const currentStageNormalized = Number.isFinite(currentIdx) && currentIdx > 0 ? Math.trunc(currentIdx) : null;
    const afterId = startAfterNodeId == null ? '' : String(startAfterNodeId);

    const sections = [];
    let totalChars = 0;
    let nodeCount = 0;
    let truncated = false;
    // 当前阶段的锚点节点找不到时置真（本次当前阶段被整段跳过），供 UI 提示用。
    let anchorMissing = false;

    for (const stageIdx of stages) {
        const isCurrentStage = currentStageNormalized != null && stageIdx === currentStageNormalized;
        const header = isCurrentStage
            ? `【第 ${stageIdx} 阶段·接下来会发生的剧情】`
            : `【第 ${stageIdx} 阶段】`;
        const lines = [];
        let blockChars = header.length;

        // 逐行追加：装不下就整行放弃并标记截断，不会把一句话切开。
        const push = line => {
            const addition = 1 + line.length;
            const separator = sections.length ? 2 : 0;
            if (totalChars + separator + blockChars + addition > charBudget) {
                truncated = true;
                return false;
            }
            lines.push(line);
            blockChars += addition;
            return true;
        };

        if (mode === 'compressed') {
            const chunkIdxSet = chunkIdxsByStage?.[stageIdx] || new Set();
            const texts = [...chunkIdxSet]
                .map(Number)
                .filter(chunkIdx => Number.isFinite(chunkIdx) && chunkIdx >= 0 && !blockedChunks.has(chunkIdx))
                .sort((a, b) => a - b)
                .map(getCompressedChunkText)
                .map(text => String(text || '').trim())
                .filter(Boolean);
            for (const text of texts) {
                if (!push(text.length > chunkLimit ? `${text.slice(0, chunkLimit)}…` : text)) break;
            }
        } else {
            let nodes = niMergeStageNodes(nodesByStage?.[stageIdx], {
                // 被屏蔽的节点、被整段屏蔽的阶段在这里统一剔除，不参与预告。
                filter: niBuildStageBlockedNodeFilter(blocked, stageIdx),
            });
            // 当前阶段：跳过「已经演到」的那个节点及其之前的节点，只发接下来的。
            if (isCurrentStage && afterId) {
                const at = nodes.findIndex(plot => String(niPlotNodeId(plot)) === afterId);
                if (at < 0) {
                    // 锚点节点已经不在这一阶段里（删楼、重新清洗换了 id、或手动锚点指向
                    // 别的阶段）：无从判断哪些节点已经演过，宁可整段不发，也不能把已经
                    // 发生的剧情当成预告再注入一次。
                    anchorMissing = true;
                    continue;
                }
                nodes = nodes.slice(at + 1);
            }
            // 当前阶段优先：本阶段剩下的节点默认全部下发，不套「每阶段 N 个」的截断；
            // 后面的阶段仍然各取前 N 个。总长度依旧受 charBudget 约束。
            const limit = isCurrentStage ? currentNodeLimit : nodeLimit;
            const picked = limit === 0 ? nodes : nodes.slice(0, limit);
            for (const plot of picked) {
                const title = String(plot?.title || '未命名节点').trim();
                let body = String(plot?.body || plot?.content || '').trim();
                if (body.length > bodyLimit) body = `${body.slice(0, bodyLimit)}…`;
                if (!push(`· ${title}：${body}`)) break;
                nodeCount += 1;
            }
        }

        if (!lines.length) {
            if (truncated) break;
            continue;
        }
        sections.push({ stageIdx, header, lines });
        totalChars += (sections.length > 1 ? 2 : 0) + blockChars;
        if (truncated) break;
    }

    const text = sections
        .map(section => [section.header, ...section.lines].join('\n'))
        .join('\n\n');
    const content = text
        ? `[${NI_FUTURE_PLOT_TAG}]\n${NI_FUTURE_PLOT_NOTICE}\n${text}\n[/${NI_FUTURE_PLOT_TAG}]`
        : '';
    return {
        rawMode: mode,
        tag: NI_FUTURE_PLOT_TAG,
        sections,
        stageIndices: sections.map(section => section.stageIdx),
        nodeCount,
        text,
        content,
        truncated,
        anchorMissing,
        nodesPerStage: nodeLimit,
        currentStageNodesPerStage: currentNodeLimit,
        maxTokens: tokenBudget,
        charBudget,
        estimatedTokens: content ? Math.ceil(content.length / normalizedCharsPerToken) : 0,
    };
}
