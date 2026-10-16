export const NI_RAW_INJECTION_MAX_TOKENS_DEFAULT = 32000;
export const NI_RAW_INJECTION_CHARS_PER_TOKEN = 1.5;

// 合并阶段节点（main/sub/pivot -> 顺序数组）。story-data.js 不反向依赖本模块，
// 顶层 import 不会形成循环。
import { niMergeStageNodes } from './story-data.js';

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
} = {}) {
    if (!curTbNode) return null;
    const nodeStageIdx = Number(curTbNode.stageIdx);
    // 锚点节点不属于本阶段时不替换取文，否则会把别的阶段内容挂到这个阶段名下。
    if (Number.isFinite(nodeStageIdx) && nodeStageIdx > 0 && nodeStageIdx !== Number(stageIdx)) return null;

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
} = {}) {
    const idx = Number(stageIdx);
    if (!Number.isFinite(idx) || idx <= 0) return '';

    if (rawMode === 'compressed') {
        const chunkIdxSet = runtimeIndex?.chunkIdxsByStage?.[idx] || new Set();
        const texts = [...chunkIdxSet]
            .map(Number)
            .filter(chunkIdx => Number.isFinite(chunkIdx) && chunkIdx >= 0)
            .sort((a, b) => a - b)
            .map(getCompressedChunkText)
            .map(text => String(text || '').trim())
            .filter(Boolean);
        return texts.length ? `【第 ${idx} 阶段压缩原文】\n${texts.join('\n')}` : '';
    }

    const stageNodes = runtimeIndex?.nodesByStage?.[idx];
    if (!stageNodes) return '';
    const allNodes = niMergeStageNodes(stageNodes);
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
} = {}) {
    const scope = vectorRecallScope || {};
    const historical = [...new Set((Array.isArray(scope.historicalStages) ? scope.historicalStages : [])
        .map(stageIdx => Number(stageIdx))
        .filter(stageIdx => Number.isFinite(stageIdx) && stageIdx > 0))];
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

    if (canFullInject) {
        // 当前阶段整体直注，不再进召回池。
        const recallStages = (Array.isArray(scope.currentStages) ? scope.currentStages : [])
            .map(stageIdx => Number(stageIdx))
            .filter(stageIdx => Number.isFinite(stageIdx) && stageIdx > 0 && stageIdx !== fullInjectStageIdx);
        // 直注阶段必须从召回池彻底移除：scope.historicalStages 在「当前窗口跨多个
        // 阶段」的普通模式下会包含它（例如只开 1~8 且无显式当前节点时整窗口是 1~8），
        // 不排掉就会和整段直注重复注入同一段剧情。前情池本身不做重排，保持原顺序。
        const recallHistorical = historical
            .filter(stageIdx => stageIdx !== fullInjectStageIdx)
            .sort((a, b) => a - b);
        effectiveScope = {
            ...scope,
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
