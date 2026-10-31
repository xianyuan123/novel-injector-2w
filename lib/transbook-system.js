import { niDefineStoryBar } from './transbook-bar.js';
import { NI_TB_SKIN_DEFAULT, niTbNormalizeSkin } from './transbook-skin.js';

// 穿书模式状态、节点边界与阶段锁定。

export const NI_TRANSBOOK_TYPE_LABELS = Object.freeze({
    main: '主线',
    sub: '支线',
    pivot: '关键转折',
});

export function niNormalizeTransbookFrontierStage(value) {
    return Math.max(1, parseInt(value, 10) || 1);
}

export function niAdvanceTransbookFrontier(frontierStageIdx, stageIdx) {
    const current = niNormalizeTransbookFrontierStage(frontierStageIdx);
    const next = parseInt(stageIdx, 10);
    if (!Number.isFinite(next) || next <= 0) return current;
    return Math.max(current, next);
}

export function niNormalizeTransbookSavedState(saved) {
    return {
        nodeDone: saved?.nodeDone ? { ...saved.nodeDone } : {},
        curIdx: saved?.curIdx ?? 0,
        curNodeId: saved?.curNodeId || '',
        frontierStageIdx: niNormalizeTransbookFrontierStage(saved?.frontierStageIdx),
        paused: !!saved?.paused,
    };
}

export function niResolveTransbookNodeStageIdx(plot, resolveStageIdx = null) {
    const normalize = value => {
        const stageIdx = parseInt(value, 10);
        return Number.isFinite(stageIdx) && stageIdx > 0 ? stageIdx : null;
    };
    const direct = normalize(plot?.stageIdx) ?? normalize(plot?._plotRef?.stageIdx);
    if (direct != null) return direct;
    if (typeof resolveStageIdx !== 'function') return 0;
    return normalize(resolveStageIdx(plot)) ?? 0;
}

export function niNormalizeTransbookNode(plot, nodeDone = {}, {
    typeLabels = NI_TRANSBOOK_TYPE_LABELS,
    resolveNodeId = (_plot, type, sourceIndex) => `${type}_${sourceIndex}`,
    resolveStageIdx = null,
} = {}) {
    const type = plot?._type || plot?.type || 'main';
    const sourceIndex = plot?._sourceIdx ?? plot?._originalIdx ?? 0;
    const legacyId = `${type}_${sourceIndex}`;
    const id = resolveNodeId(plot?._plotRef || plot, type, plot?._sourceIdx ?? 0);
    const done = nodeDone?.[id] !== undefined ? !!nodeDone[id] : !!nodeDone?.[legacyId];
    return {
        id,
        legacyId,
        type,
        typeLabel: typeLabels[type] || type,
        title: plot?.title || '（未命名）',
        body: plot?.body || '',
        time: plot?.time || '',
        location: plot?.location || '',
        sub_notes: plot?.sub_notes || [],
        branch_links: plot?.branch_links || [],
        stageIdx: niResolveTransbookNodeStageIdx(plot, resolveStageIdx),
        done,
        locked: false,
        _origIdx: sourceIndex,
        _chunkIdx: plot?._chunkIdx ?? 0,
        _chunkOrder: plot?._chunkOrder ?? 0,
        _manualOrder: plot?._manualOrder,
    };
}

export function niGetTransbookStageCompletion(nodes) {
    const stageHasUndone = {};
    for (const node of Array.isArray(nodes) ? nodes : []) {
        if (!node?.done) stageHasUndone[node?.stageIdx] = true;
    }
    return stageHasUndone;
}

export function niIsTransbookStageLocked(stageIdx, stageHasUndone, frontierStageIdx) {
    if (!Number.isFinite(Number(stageIdx))) return false;
    const frontier = niNormalizeTransbookFrontierStage(frontierStageIdx);
    if (stageIdx <= frontier) return false;
    for (let index = frontier; index < stageIdx; index++) {
        if (stageHasUndone?.[index]) return true;
    }
    return false;
}

export function niApplyTransbookStageLocks(nodes, frontierStageIdx) {
    const list = (Array.isArray(nodes) ? nodes : []).map(node => ({ ...node, locked: false }));
    const stageHasUndone = niGetTransbookStageCompletion(list);
    for (const node of list) {
        node.locked = niIsTransbookStageLocked(node.stageIdx, stageHasUndone, frontierStageIdx);
    }
    return list;
}

export function niBuildTransbookNodes(plots, nodeDone = {}, {
    typeLabels = NI_TRANSBOOK_TYPE_LABELS,
    resolveNodeId,
    resolveStageIdx = null,
    comparePlotOrder = () => 0,
    frontierStageIdx = 1,
} = {}) {
    const nodes = (Array.isArray(plots) ? plots : [])
        .map(plot => niNormalizeTransbookNode(plot, nodeDone, { typeLabels, resolveNodeId, resolveStageIdx }))
        .sort((a, b) => a.stageIdx !== b.stageIdx ? a.stageIdx - b.stageIdx : comparePlotOrder(a, b));
    return niApplyTransbookStageLocks(nodes, frontierStageIdx);
}

export function niBuildTransbookStages(nodes, stageCount, stageStates = {}, stageTitles = {}) {
    const nodesByStage = new Map();
    for (const node of Array.isArray(nodes) ? nodes : []) {
        const stageIdx = parseInt(node?.stageIdx, 10);
        if (!Number.isFinite(stageIdx) || stageIdx <= 0) continue;
        if (!nodesByStage.has(stageIdx)) nodesByStage.set(stageIdx, []);
        nodesByStage.get(stageIdx).push(node);
    }

    const stages = [];
    const count = Math.max(0, parseInt(stageCount, 10) || 0);
    for (let stageIdx = 1; stageIdx <= count; stageIdx++) {
        if (stageStates?.[stageIdx] === false) continue;
        stages.push({
            stageIdx,
            title: stageTitles?.[stageIdx] || `第 ${stageIdx} 阶段`,
            nodes: nodesByStage.get(stageIdx) || [],
        });
    }
    return stages;
}

export const NI_TRANSBOOK_STAGE_PAGE_SIZE = 20;
export const NI_TRANSBOOK_PAGE_SIZE_MAX = 200;

export function niResolveTransbookStagePagination(stages, {
    page = 1,
    pageSize = NI_TRANSBOOK_STAGE_PAGE_SIZE,
    activeStageIdx = null,
    alignActive = false,
} = {}) {
    const list = Array.isArray(stages) ? stages : [];
    const normalizedPageSize = Math.max(1, Math.min(NI_TRANSBOOK_PAGE_SIZE_MAX, parseInt(pageSize, 10) || NI_TRANSBOOK_STAGE_PAGE_SIZE));
    const pageCount = Math.max(1, Math.ceil(list.length / normalizedPageSize));
    let nextPage = Math.max(1, parseInt(page, 10) || 1);
    if (alignActive && activeStageIdx != null) {
        const activeIndex = list.findIndex(stage => Number(stage?.stageIdx) === Number(activeStageIdx));
        if (activeIndex >= 0) nextPage = Math.floor(activeIndex / normalizedPageSize) + 1;
    }
    nextPage = Math.min(nextPage, pageCount);
    const startIndex = (nextPage - 1) * normalizedPageSize;
    const endIndex = Math.min(list.length, startIndex + normalizedPageSize);
    return {
        page: nextPage,
        pageCount,
        pageSize: normalizedPageSize,
        total: list.length,
        startIndex,
        endIndex,
        items: list.slice(startIndex, endIndex),
    };
}

export function niReconcileTransbookCurrentNode(nodes, {
    curIdx = 0,
    curNodeId = '',
    frontierStageIdx = 1,
} = {}) {
    const list = Array.isArray(nodes) ? nodes : [];
    if (!list.length) {
        return { curIdx: 0, curNodeId: '', frontierStageIdx: niNormalizeTransbookFrontierStage(frontierStageIdx) };
    }

    let index = -1;
    if (curNodeId) {
        index = list.findIndex(node => node.id === curNodeId || node.legacyId === curNodeId);
    }
    if (index < 0 && Number.isFinite(Number(curIdx))) {
        index = Math.max(0, Math.min(list.length - 1, Number(curIdx)));
    }
    const nextIndex = index >= 0 ? index : 0;
    return {
        curIdx: nextIndex,
        curNodeId: list[nextIndex]?.id || '',
        frontierStageIdx: niAdvanceTransbookFrontier(frontierStageIdx, list[nextIndex]?.stageIdx),
    };
}

export function niSetTransbookCurrentIndex(nodes, index, frontierStageIdx = 1) {
    const list = Array.isArray(nodes) ? nodes : [];
    if (!list.length) {
        return { curIdx: 0, curNodeId: '', frontierStageIdx: niNormalizeTransbookFrontierStage(frontierStageIdx) };
    }
    const nextIndex = Math.max(0, Math.min(list.length - 1, Number(index) || 0));
    return {
        curIdx: nextIndex,
        curNodeId: list[nextIndex]?.id || '',
        frontierStageIdx: niAdvanceTransbookFrontier(frontierStageIdx, list[nextIndex]?.stageIdx),
    };
}

export function niGetTransbookPriorStageNodeIndexes(nodes, index) {
    const list = Array.isArray(nodes) ? nodes : [];
    if (!list.length) return [];
    const nextIndex = Math.max(0, Math.min(list.length - 1, Number(index) || 0));
    const stageIdx = list[nextIndex]?.stageIdx;
    const indexes = [];
    for (let i = 0; i < nextIndex; i++) {
        if (list[i]?.stageIdx === stageIdx && !list[i]?.done) indexes.push(i);
    }
    return indexes;
}

export function niGetTransbookStageView(nodes, currentIndex) {
    const list = Array.isArray(nodes) ? nodes : [];
    const currentNode = list[currentIndex] || list[0];
    if (!currentNode) return { nodes: [], curIdx: 0, stageIdx: null };
    const stageNodes = list
        .map((node, index) => ({ ...node, _globalIdx: index }))
        .filter(node => node.stageIdx === currentNode.stageIdx);
    const localIndex = Math.max(0, stageNodes.findIndex(node => node.id === currentNode.id));
    return { nodes: stageNodes, curIdx: localIndex, stageIdx: currentNode.stageIdx };
}

export function niGetTransbookProgress(nodes, currentNodeId = '') {
    const list = Array.isArray(nodes) ? nodes : [];
    const activeNode = list.find(node => node.id === currentNodeId || node.legacyId === currentNodeId) || null;
    const doneNodes = list.filter(node => node.done);
    const todoNodes = list.filter(node => !node.done && node.id !== activeNode?.id);
    return {
        total: list.length,
        done: doneNodes.length,
        undone: list.length - doneNodes.length,
        allDone: list.length > 0 && doneNodes.length === list.length,
        activeNode,
        doneNodes,
        todoNodes,
    };
}

export function niFindNextTransbookNode(nodes, currentNode, { sameStage = true } = {}) {
    const list = Array.isArray(nodes) ? nodes : [];
    const currentIndex = list.findIndex(node => node.id === currentNode?.id);
    return list.find((node, index) =>
        index > currentIndex &&
        (!sameStage || node.stageIdx === currentNode?.stageIdx) &&
        !node.done
    ) || null;
}

export function niFindFirstActionableTransbookNode(nodes) {
    return (Array.isArray(nodes) ? nodes : []).find(node => !node.done && !node.locked) || null;
}

/**
 * 解析真正参与后台注入的节点。
 * tbCurIdx / tbCurNodeId 只作为「当前阶段」的锚点，节点位置由归档进度推导：
 * 取锚点所在阶段里第一个未归档、未锁定的节点。整个阶段都已归档时停在该阶段
 * 最后一个节点（即刚演完的那段），不自动跨阶段——跨阶段仍由用户在阶段面板显式切换。
 */
export function niResolveTransbookInjectionNode(nodes, {
    curIdx = 0,
    curNodeId = '',
} = {}) {
    const list = Array.isArray(nodes) ? nodes : [];
    if (!list.length) return null;

    let anchorIdx = -1;
    if (curNodeId) {
        anchorIdx = list.findIndex(node => node.id === curNodeId || node.legacyId === curNodeId);
    }
    if (anchorIdx < 0 && Number.isFinite(Number(curIdx))) {
        anchorIdx = Math.max(0, Math.min(list.length - 1, Number(curIdx)));
    }
    if (anchorIdx < 0) anchorIdx = 0;

    const stageIdx = list[anchorIdx]?.stageIdx;
    const stageNodes = list.filter(node => node?.stageIdx === stageIdx);
    const pending = stageNodes.find(node => !node.done && !node.locked);
    return pending || stageNodes[stageNodes.length - 1] || list[anchorIdx] || null;
}

export function createTransbookController(deps = {}) {
    const S = deps.state || {};
    const DEFAULT_SETTINGS = deps.defaultSettings || {};
    const extension_settings = deps.extensionSettings || {};
    const EXT_NAME = deps.extensionName || '';
    const document = deps.document || globalThis.document;
    const window = deps.globalWindow || globalThis.window || {};
    const console = deps.logger || globalThis.console || { log() {}, warn() {}, error() {} };
    const $ = deps.dollar ?? globalThis.$;
    const getContext = deps.getContext || (() => null);
    const getAllPlotsInStoryOrder = deps.getAllPlotsInStoryOrder || (() => []);
    const niEnsurePlotNodeId = deps.ensurePlotNodeId || ((_plot, type, sourceIdx) => String(type) + '_' + sourceIdx);
    const niResolveStageIdx = deps.resolveStageIdx;
    const niComparePlotOrder = deps.comparePlotOrder || (() => 0);
    const saveSettingsDebounced = deps.saveSettingsDebounced || (() => {});
    const callCleanApi = deps.callCleanApi;
    const niApplyStatusbarTheme = deps.applyStatusbarTheme || (() => {});
    const niApplyUserSubstitution = deps.applyUserSubstitution || (value => String(value ?? ''));
    const niGetUserSubConfig = deps.getUserSubConfig || (() => ({}));
    const niIsUserSubReplaceSelectedChar = deps.isUserSubReplaceSelectedChar || (() => false);
    const niIsUserSubSelectedChar = deps.isUserSubSelectedChar || (() => false);
    const niIsUserSubPlayMode = deps.isUserSubPlayMode || (() => false);
    const niGetCharAiShowEnabled = deps.getCharAiShowEnabled || (() => false);
    const niGetCharAiProfile = deps.getCharAiProfile || (() => null);
    const niTogglePanel = deps.togglePanel || (() => {});
    const niPopSetVisible = deps.popSetVisible;
    const niPopSyncVisibility = deps.popSyncVisibility;
    const niSetTransBookMode = deps.setTransBookMode || (() => {});
    const niSyncTransBookToggleUI = deps.syncTransBookToggleUI || (() => {});
    const niNormalizePageSize = deps.normalizePageSize || ((value, fallback = NI_TRANSBOOK_STAGE_PAGE_SIZE) => {
        const parsed = parseInt(value, 10);
        return Math.max(1, Math.min(200, Number.isFinite(parsed) ? parsed : fallback));
    });
    const niBuildListPaginationHtml = deps.buildListPaginationHtml || (({ pagination = {}, idPrefix = 'ni-tb-page', wrapperClass = '', sizeInputClass = '', pageInputClass = '', pageButtonClass = '' } = {}) => {
        const total = Math.max(0, parseInt(pagination.total, 10) || 0);
        const page = Math.max(1, parseInt(pagination.page, 10) || 1);
        const pageSize = niNormalizePageSize(pagination.pageSize, NI_TRANSBOOK_STAGE_PAGE_SIZE);
        const pageCount = Math.max(1, parseInt(pagination.pageCount, 10) || 1);
        if (total <= 5 && pageCount <= 1) return '';
        return `<div class="ni-list-pagination ${wrapperClass}">
          <label class="ni-pagination-size">每 <input type="number" id="${idPrefix}-size" class="${sizeInputClass}" value="${pageSize}" min="1" max="200" step="1"> 一页</label>
          <div class="ni-pagination-current">
            <label>目前第 <input type="number" id="${idPrefix}-current" class="${pageInputClass}" value="${page}" min="1" max="${pageCount}" step="1" title="共 ${pageCount} 页"> 页</label>
            <button type="button" id="${idPrefix}-prev" class="ni-page-btn ni-page-prev ${pageButtonClass}" data-page="${page - 1}"${page <= 1 ? ' disabled' : ''}>←</button>
            <button type="button" id="${idPrefix}-next" class="ni-page-btn ni-page-next ${pageButtonClass}" data-page="${page + 1}"${page >= pageCount ? ' disabled' : ''}>→</button>
          </div>
        </div>`;
    });
    const setTimeout = deps.setTimeout || globalThis.setTimeout;
    const requestAnimationFrame = deps.requestAnimationFrame || globalThis.requestAnimationFrame || (callback => callback());
    const Event = deps.Event || globalThis.Event;
    const TB_DEFAULT_ADVANCE_PROMPT = deps.defaultAdvancePrompt || '';
    const TB_DEFAULT_ADVANCE_JUDGE_PROMPT = deps.defaultAdvanceJudgePrompt || '';
    const TB_DEFAULT_INFER_PROMPT = deps.defaultInferPrompt || '';
    const TB_DEFAULT_OPENING_PROMPT = deps.defaultOpeningPrompt || '';
    const TB_DEFAULT_ONGOING_PROMPT = deps.defaultOngoingPrompt || '';
    const TB_DEFAULT_IMMERSION_PROMPT = deps.defaultImmersionPrompt || '';
    const TB_LEGACY_ADVANCE_PROMPT = deps.legacyAdvancePrompt || '';
    const TB_LEGACY_OPENING_PROMPT = deps.legacyOpeningPrompt || '';
    const TB_LEGACY_ONGOING_PROMPT = deps.legacyOngoingPrompt || '';

    S.tbNodeDone   = {};   // {[nodeId]: boolean}  — 节点完成状态（从 chat[0] 读写）
    S.tbPaused     = false; // 暂停剧情节点/压缩原文直注及开场/推进/持续提示词（保存到当前聊天首条消息 ni_tb.paused）
    S.tbCurIdx     = 0;    // 已确认的剧情节点下标：持久化，并用于后台注入/API
    S.tbCurNodeId  = '';   // 已确认节点稳定 id，避免刷新后因列表重排导致索引漂移
    S.tbViewIdx    = null; // RP 中预览的节点下标：只控制界面、不参与注入；随聊天文件持久化，刷新后恢复
    S.tbViewNodeId = '';   // 预览节点稳定 id（保存到当前聊天首条消息 ni_tb.viewNodeId）
    S.tbViewPinned = false; // 从存档恢复 view 后置真：在真正的新消息到来前，阻止自动回正到当前节点
    S.tbFrontierStageIdx = 1; // 用户已经手动推进到的最远阶段，用于跳过旧阶段剩余节点的锁定
    S.tbInferring  = false; // 推演中
    S.tbAdvancing  = false; // 推进中（防止自动/手动同时推进）
    S.tbAutoAdvanceJudging = false; // 自动推进正在等模型判定（只影响状态栏徽标）
    // 后台推演（其他视角）：动向往这里累积，随聊天保存（chat[0].ni_tb.offscreen）。
    S.tbOffscreen = { threads: [], lastRunNodeId: '', lastRunAt: 0 };
    S.tbSectionOpen = { done: false, active: true, todo: false };
    const TB_NODE_BATCH_SIZE = 40;
    let _tbStagePage = 1;
    let _tbNodePanelStageIdx = null;
    const _tbNodePanelLimits = { done: TB_NODE_BATCH_SIZE, todo: TB_NODE_BATCH_SIZE };

    function niTbGetStagePageSize() {
        const cfg = extension_settings[EXT_NAME] || {};
        return niNormalizePageSize(cfg.transBookStagePageSize, DEFAULT_SETTINGS.transBookStagePageSize || NI_TRANSBOOK_STAGE_PAGE_SIZE);
    }

    function niTbSetStagePageSize(value) {
        const cfg = extension_settings[EXT_NAME] || (extension_settings[EXT_NAME] = {});
        cfg.transBookStagePageSize = niNormalizePageSize(value, cfg.transBookStagePageSize || DEFAULT_SETTINGS.transBookStagePageSize || NI_TRANSBOOK_STAGE_PAGE_SIZE);
        _tbStagePage = 1;
        saveSettingsDebounced();
        niTbRebuildStageList(niCreateTbSnapshot());
        return cfg.transBookStagePageSize;
    }
    
    function niTbSyncPauseUI() {
        const paused = !!S.tbPaused;
    
        const barBtn  = niTbById('ni-tb-btn-pause');
        const barIcon = niTbById('ni-tb-pause-icon');
        const barText = niTbById('ni-tb-pause-text');
        barBtn?.classList.toggle('paused', paused);
        if (barIcon) barIcon.className = paused ? 'ti ti-player-play' : 'ti ti-player-pause';
        if (barText) barText.textContent = paused ? '继续' : '暂停';
    
        const popBtn = document.getElementById('ni-pop-btn-pause');
        const popTxt = document.getElementById('ni-pop-pause-txt');
        popBtn?.classList.toggle('paused', paused);
        if (popTxt) popTxt.textContent = paused ? '恢复' : '暂停';
    }
    window.niTbSyncPauseUI = niTbSyncPauseUI;
    
    function niTbSetPaused(paused) {
        S.tbPaused = !!paused;
        niTbSyncPauseUI();
        niTbSaveState().catch(e => console.warn('[NI-TB] 保存暂停状态失败:', e));
    }
    window.niTbSetPaused = niTbSetPaused;
    
    function niTbTogglePaused() {
        niTbSetPaused(!S.tbPaused);
    }
    window.niTbTogglePaused = niTbTogglePaused;
    
    // ── 数据字段追加到 DEFAULT_SETTINGS ─────────────────────────
    
    DEFAULT_SETTINGS.transBookMode    = false;
    DEFAULT_SETTINGS.tbAdvancePrompt  = TB_DEFAULT_ADVANCE_PROMPT;
    DEFAULT_SETTINGS.tbInferPrompt    = TB_DEFAULT_INFER_PROMPT;
    DEFAULT_SETTINGS.tbOpeningPrompt  = TB_DEFAULT_OPENING_PROMPT;
    DEFAULT_SETTINGS.tbOngoingPrompt  = TB_DEFAULT_ONGOING_PROMPT;
    DEFAULT_SETTINGS.tbLightRecallMode = false;
    // 自动推进：由模型判断当前节点是否演完，演完就前进（取代原先的手动「推进」按钮）。
    DEFAULT_SETTINGS.tbAutoAdvance          = true;
    DEFAULT_SETTINGS.tbAutoAdvanceCrossStage = true;
    DEFAULT_SETTINGS.tbAutoAdvanceModel     = 'current';
    DEFAULT_SETTINGS.tbAutoAdvanceEvery     = 1;
    DEFAULT_SETTINGS.tbAutoAdvanceThreshold = 0.7;
    DEFAULT_SETTINGS.tbAutoAdvancePrompt    = TB_DEFAULT_ADVANCE_JUDGE_PROMPT;
    // 后台推演（其他视角）：主视角之外的人/势力在幕后也在动。
    // mode: off 只手动 / node 节点一动才推演 / always 每回合都推演。
    DEFAULT_SETTINGS.tbOffscreenEnabled   = false;
    DEFAULT_SETTINGS.tbOffscreenMode      = 'node';
    DEFAULT_SETTINGS.tbOffscreenModel     = 'current'; // current = 当前对话模型，plugin = 插件里配置的 API
    DEFAULT_SETTINGS.tbOffscreenStages    = 0;      // 额外覆盖几个「未来剧情预告」阶段，0 = 只当前阶段
    DEFAULT_SETTINGS.tbOffscreenMaxChars  = 800;    // 注入上限（字）
    DEFAULT_SETTINGS.tbOffscreenPov       = '';     // 主视角角色名，空 = 用当前角色卡
    DEFAULT_SETTINGS.tbOffscreenApiUrl    = '';     // 外接 OpenAI 兼容接口，空 = 用当前对话模型
    DEFAULT_SETTINGS.tbOffscreenApiKey    = '';
    DEFAULT_SETTINGS.tbOffscreenApiModel  = '';
    DEFAULT_SETTINGS.tbOffscreenApiTimeout = 60;    // 秒
    DEFAULT_SETTINGS.tbImmersionMode  = false;
    DEFAULT_SETTINGS.tbImmersionPrompt = TB_DEFAULT_IMMERSION_PROMPT;
    
    function niUpgradeLegacyTbDefaultPrompts(cfg = extension_settings[EXT_NAME] || {}) {
        if (!cfg || typeof cfg !== 'object') return false;
        let changed = false;
        const norm = value => String(value ?? '').replace(/\r\n/g, '\n');
        const isOlderAdvanceDefault = value => {
            const text = norm(value);
            return text.startsWith('[穿书模式·当前叙事阶段]')
                && text.includes('▌叙事目标（持续追踪）')
                && text.includes('目标：{B_BODY}')
                && text.includes('完成信号：[由用户手动确认，AI不得自行宣布完成]')
                && text.includes('每次回复前，隐式评估：目标达成了吗？还缺什么？')
                && text.includes('不是必须重演的脚本场景')
                && text.trim().endsWith('[/穿书模式·当前叙事阶段]')
                && !text.includes('剧情节点不是任务目标');
        };
        const isOlderOngoingDefault = value => {
            const text = norm(value);
            return text === norm(`[穿书模式·进行中]
    当前阶段「{B_TITLE}」持续中，核心走向：{B_BODY}
    跟随用户行动自然推进，用户无操作时仅推进当下场景，不强行跳转节点。
    阶段完成由用户确认。
    [/穿书模式·进行中]`);
        };
        const upgrade = (key, legacyValue, nextValue) => {
            if (norm(cfg[key]) !== norm(legacyValue)) return;
            cfg[key] = nextValue;
            changed = true;
        };
        upgrade('tbAdvancePrompt', TB_LEGACY_ADVANCE_PROMPT, TB_DEFAULT_ADVANCE_PROMPT);
        upgrade('tbOpeningPrompt', TB_LEGACY_OPENING_PROMPT, TB_DEFAULT_OPENING_PROMPT);
        upgrade('tbOngoingPrompt', TB_LEGACY_ONGOING_PROMPT, TB_DEFAULT_ONGOING_PROMPT);
        if (isOlderAdvanceDefault(cfg.tbAdvancePrompt)) {
            cfg.tbAdvancePrompt = TB_DEFAULT_ADVANCE_PROMPT;
            changed = true;
        }
        if (isOlderAdvanceDefault(cfg.tbOpeningPrompt)) {
            cfg.tbOpeningPrompt = TB_DEFAULT_OPENING_PROMPT;
            changed = true;
        }
        if (isOlderOngoingDefault(cfg.tbOngoingPrompt)) {
            cfg.tbOngoingPrompt = TB_DEFAULT_ONGOING_PROMPT;
            changed = true;
        }
        return changed;
    }
    
    function niTbGetImmersionAppend(cfg) {
        if (!cfg?.tbImmersionMode) return '';
        const prompt = (cfg.tbImmersionPrompt || TB_DEFAULT_IMMERSION_PROMPT).trim();
        return prompt ? `\n${prompt}` : '';
    }
    
    function niTbFrontierStage() {
        return niNormalizeTransbookFrontierStage(S.tbFrontierStageIdx);
    }
    
    function niTbAdvanceFrontier(stageIdx) {
        S.tbFrontierStageIdx = niAdvanceTransbookFrontier(S.tbFrontierStageIdx, stageIdx);
        return S.tbFrontierStageIdx;
    }
    
    // ── 数据桥接 ─────────────────────────────────────────────────
    
    /**
     * 返回已启用阶段的节点，合并 main+sub+pivot，按 stageIdx 升序，同阶段内按故事/人工顺序。
     * 每个节点：{ id, type, typeLabel, title, body, time, location, stageIdx, done, locked }
     */
    function niGetTbNodes(sourceNodes = null) {
        const enabledPlots = (sourceNodes || getAllPlotsInStoryOrder(S))
            .map(plot => {
                const stageIdx = niResolveTransbookNodeStageIdx(plot, niResolveStageIdx);
                if (stageIdx <= 0 || S.stageStates?.[stageIdx] === false) return null;
                return stageIdx === plot?.stageIdx ? plot : { ...plot, stageIdx };
            })
            .filter(Boolean);
        return niBuildTransbookNodes(enabledPlots, S.tbNodeDone, {
            resolveNodeId: (plot, type, sourceIdx) => niEnsurePlotNodeId(plot, type, sourceIdx),
            resolveStageIdx: niResolveStageIdx,
            comparePlotOrder: niComparePlotOrder,
            frontierStageIdx: niTbFrontierStage(),
        });
    }
    
    /**
     * 返回已启用阶段列表 [{stageIdx, title, nodes[]}]
     */
    function niGetTbStages(nodes = null) {
        const list = Array.isArray(nodes) ? nodes : niGetTbNodes();
        return niBuildTransbookStages(list, S.stageMapN, S.stageStates, S.stageTitles);
    }

    function niCreateTbSnapshot(nodes = null) {
        const list = Array.isArray(nodes) ? nodes : niGetTbNodes();
        const stages = niGetTbStages(list);
        const firstNodeIndexByStage = {};
        let doneCount = 0;
        list.forEach((node, index) => {
            const stageIdx = Number(node?.stageIdx);
            if (Number.isFinite(stageIdx) && firstNodeIndexByStage[stageIdx] === undefined) {
                firstNodeIndexByStage[stageIdx] = index;
            }
            if (node?.done) doneCount++;
        });
        return {
            nodes: list,
            stages,
            firstNodeIndexByStage,
            doneCount,
        };
    }
    
    function niTbReconcileCurrentNode(nodes = niGetTbNodes()) {
        const reconciled = niReconcileTransbookCurrentNode(nodes, {
            curIdx: S.tbCurIdx,
            curNodeId: S.tbCurNodeId,
            frontierStageIdx: S.tbFrontierStageIdx,
        });
        S.tbCurIdx = reconciled.curIdx;
        S.tbCurNodeId = reconciled.curNodeId;
        S.tbFrontierStageIdx = reconciled.frontierStageIdx;
        niTbReconcileViewNode(nodes);
    }

    /**
     * 后台注入/API 使用的节点。UI 侧的预览下标（tbViewIdx）一律不参与，
     * 阶段锚点内的实际位置由归档进度推导，勾选归档后自动前移。
     */
    function niTbGetInjectionNode(nodes = niGetTbNodes()) {
        const list = Array.isArray(nodes) ? nodes : [];
        if (!list.length) return null;
        niTbReconcileCurrentNode(list);
        return niResolveTransbookInjectionNode(list, {
            curIdx: S.tbCurIdx,
            curNodeId: S.tbCurNodeId,
        });
    }
    window.niTbGetInjectionNode = niTbGetInjectionNode;

    function niTbReconcileViewNode(nodes = niGetTbNodes()) {
        const list = Array.isArray(nodes) ? nodes : [];
        // 空列表时保持现值不清空：节点数据未就绪的窗口期里清空
        // 会毁掉刚从存档恢复、尚未消费的 viewIdx/viewNodeId
        if (!list.length) return;
        let viewIdx = list.findIndex(node =>
            node?.id === S.tbViewNodeId || node?.legacyId === S.tbViewNodeId
        );
        if (viewIdx < 0 && S.tbViewIdx !== null && S.tbViewIdx !== '' && Number.isFinite(Number(S.tbViewIdx))) {
            viewIdx = Math.max(0, Math.min(list.length - 1, Number(S.tbViewIdx)));
        }
        if (viewIdx < 0) viewIdx = Math.max(0, Math.min(list.length - 1, Number(S.tbCurIdx) || 0));
        S.tbViewIdx = viewIdx;
        S.tbViewNodeId = list[viewIdx]?.id || '';
    }
    
    function niTbSetCurrentIdx(idx, nodes = niGetTbNodes(), { persist = false, archivePrior = false } = {}) {
        if (archivePrior) {
            niGetTransbookPriorStageNodeIndexes(nodes, idx).forEach(priorIdx => {
                const node = nodes[priorIdx];
                if (!node) return;
                S.tbNodeDone[node.id] = true;
                if (node.legacyId && node.legacyId !== node.id) delete S.tbNodeDone[node.legacyId];
                node.done = true;
            });
        }
        const next = niSetTransbookCurrentIndex(nodes, idx, S.tbFrontierStageIdx);
        S.tbCurIdx = next.curIdx;
        S.tbCurNodeId = next.curNodeId;
        S.tbFrontierStageIdx = next.frontierStageIdx;
        S.tbViewIdx = next.curIdx;
        S.tbViewNodeId = next.curNodeId;
        S.tbViewPinned = false;
        if (persist) niTbSaveState(nodes).catch(e => console.warn('[NI-TB] 保存当前节点失败:', e));
        return S.tbCurIdx;
    }
    window.niTbSetCurrentIdx = niTbSetCurrentIdx;

    function niTbSetViewIdx(idx, nodes = niGetTbNodes(), { render = false, persist = false } = {}) {
        const list = Array.isArray(nodes) ? nodes : [];
        if (!list.length) return 0;
        const nextIdx = Math.max(0, Math.min(list.length - 1, Number(idx) || 0));
        S.tbViewIdx = nextIdx;
        S.tbViewNodeId = list[nextIdx]?.id || '';
        if (persist) niTbSaveState(list).catch(e => console.warn('[NI-TB] 保存预览节点失败:', e));
        if (render) {
            const snapshot = niCreateTbSnapshot(list);
            niTbBuildTrack(list);
            niTbSyncMeta(list);
            niTbRefreshNodePanel(list);
            niTbRebuildStageList(snapshot, { alignActive: true });
        }
        return S.tbViewIdx;
    }
    window.niTbSetViewIdx = niTbSetViewIdx;

    function niTbResetViewToCurrent(nodes = niGetTbNodes()) {
        const list = Array.isArray(nodes) ? nodes : [];
        if (!list.length) return S.tbViewIdx;
        niTbReconcileCurrentNode(list);
        // 刷新/切聊天恢复的 view 处于钉住状态：新消息到来（解钉）前不自动回正
        if (S.tbViewPinned) return S.tbViewIdx;
        const curNode = list[S.tbCurIdx];
        if (!curNode || curNode.done) return S.tbViewIdx;
        S.tbViewIdx = S.tbCurIdx;
        S.tbViewNodeId = S.tbCurNodeId || curNode.id || '';
        return S.tbViewIdx;
    }
    window.niTbResetViewToCurrent = niTbResetViewToCurrent;

    function niTbUnpinView() {
        S.tbViewPinned = false;
    }
    window.niTbUnpinView = niTbUnpinView;
    
    function niTbStageView(nodes, curIdx) {
        return niGetTransbookStageView(nodes, curIdx);
    }
    window.niTbStageView = niTbStageView;
    
    // ── 持久化 ────────────────────────────────────────────────────
    
    async function niTbSaveState(nodes = null) {
        try {
            const ctx = getContext();
            if (!ctx?.chat?.[0]) return;
            const list = Array.isArray(nodes) ? nodes : niGetTbNodes();
            if (list.length) niTbReconcileCurrentNode(list);
            ctx.chat[0].ni_tb = ctx.chat[0].ni_tb || {};
            ctx.chat[0].ni_tb.nodeDone = { ...S.tbNodeDone };
            ctx.chat[0].ni_tb.curIdx   = S.tbCurIdx;
            ctx.chat[0].ni_tb.curNodeId = S.tbCurNodeId || list[S.tbCurIdx]?.id || '';
            ctx.chat[0].ni_tb.viewIdx   = S.tbViewIdx ?? S.tbCurIdx;
            ctx.chat[0].ni_tb.viewNodeId = S.tbViewNodeId || list[S.tbViewIdx]?.id || ctx.chat[0].ni_tb.curNodeId;
            ctx.chat[0].ni_tb.frontierStageIdx = niTbFrontierStage();
            ctx.chat[0].ni_tb.paused   = !!S.tbPaused;
            ctx.chat[0].ni_tb.offscreen = {
                threads: Array.isArray(S.tbOffscreen?.threads) ? S.tbOffscreen.threads.slice(0, 24) : [],
                lastRunNodeId: String(S.tbOffscreen?.lastRunNodeId || ''),
                lastRunAt: Number(S.tbOffscreen?.lastRunAt) || 0,
            };
            await ctx.saveChat();
        } catch (e) {
            console.warn('[NI-TB] saveState 失败:', e);
        }
    }
    
    function niTbLoadState() {
        try {
            const ctx = getContext();
            const saved = ctx?.chat?.[0]?.ni_tb;
            S.tbNodeDone = saved?.nodeDone ? { ...saved.nodeDone } : {};
            S.tbCurIdx   = saved?.curIdx   ?? 0;
            S.tbCurNodeId = saved?.curNodeId || '';
            S.tbFrontierStageIdx = Math.max(1, parseInt(saved?.frontierStageIdx, 10) || 1);
            S.tbPaused   = !!saved?.paused;
            S.tbOffscreen = {
                threads: Array.isArray(saved?.offscreen?.threads) ? saved.offscreen.threads.slice(0, 24) : [],
                lastRunNodeId: String(saved?.offscreen?.lastRunNodeId || ''),
                lastRunAt: Number(saved?.offscreen?.lastRunAt) || 0,
            };
            // 恢复退出前预览的节点（含已归档节点），并钉住防止加载期的自动回正
            if (saved?.viewNodeId || Number.isFinite(Number(saved?.viewIdx))) {
                S.tbViewIdx = Number.isFinite(Number(saved?.viewIdx)) ? Number(saved.viewIdx) : S.tbCurIdx;
                S.tbViewNodeId = saved?.viewNodeId || '';
                S.tbViewPinned = true;
            } else {
                S.tbViewIdx = S.tbCurIdx;
                S.tbViewNodeId = S.tbCurNodeId;
                S.tbViewPinned = false;
            }
        } catch (e) {
            S.tbNodeDone = {};
            S.tbCurIdx   = 0;
            S.tbCurNodeId = '';
            S.tbFrontierStageIdx = 1;
            S.tbPaused   = false;
            S.tbViewIdx = S.tbCurIdx;
            S.tbViewNodeId = S.tbCurNodeId;
            S.tbViewPinned = false;
            S.tbOffscreen = { threads: [], lastRunNodeId: '', lastRunAt: 0 };
        }
    }
    
    // ── 状态栏 HTML 构建 ──────────────────────────────────────────
    

    // ── 新版状态栏（Web Component）────────────────────────────
    let _niTbShadow = null;   // 当前 <ni-storybar> 的 shadowRoot
    let _niTbOpen = false;    // 展开状态由我们统一持有（组件只管画）

    /** 所有 ni-tb-* 元素先在 shadow 里找，找不到再退回 document（兼容旧路径） */
    function niTbById(id) {
        try {
            const el = _niTbShadow?.getElementById?.(id);
            if (el) return el;
        } catch { /* 忽略 */ }
        return document.getElementById(id);
    }

    function niTbNodeTypeKind(node) {
        const t = String(node?.type || '');
        if (t.includes('支')) return 'sub';
        if (t.includes('转') || t.includes('折')) return 'turn';
        return 'main';
    }

    /** 面板部分（阶段 / 节点 / 推演 / 后台动向）沿用旧 HTML，塞进 shadow */
    function niTbPanelsHtml(cfg) {
        return `
        <div class="ni-tb-drop-panel" id="ni-tb-stage-panel">
          <span class="ni-tb-sp-label">已开启阶段</span>
          <div class="ni-tb-sp-list" id="ni-tb-stage-list"></div>
        </div>
        <div class="ni-tb-drop-panel" id="ni-tb-node-panel"></div>
        <div class="ni-tb-infer-block" id="ni-tb-infer-block" hidden>
          <div class="ni-tb-infer-toggle expanded" id="ni-tb-infer-toggle">
            <span class="ni-tb-infer-toggle-label">以下为下一步行动选项，点击填入输入框</span>
            <i class="ti ti-chevron-up ni-tb-infer-toggle-icon expanded" id="ni-tb-infer-toggle-icon"></i>
          </div>
          <div class="ni-tb-infer-list vis" id="ni-tb-infer-list"></div>
        </div>
        <div class="ni-tb-off-block" id="ni-tb-off-block">
          <div class="ni-tb-off-head" id="ni-tb-off-toggle">
            <span class="ni-tb-off-title">
              <i class="ti ti-world"></i>
              后台动向<span class="ni-tb-off-count" id="ni-tb-off-count"></span>
            </span>
            <span class="ni-tb-off-ops">
              <span class="ni-tb-off-run" id="ni-tb-off-run" title="立刻推演一轮其他视角的动向">推演</span>
              <i class="ti ti-chevron-down ni-tb-off-chevron" id="ni-tb-off-chevron"></i>
            </span>
          </div>
          <div class="ni-tb-off-body" id="ni-tb-off-body"></div>
        </div>`;
    }

    /** cfg.tbSkin → 组件认的 skin 对象（没设的项交给主题兜底） */
    function niTbSkinFor(cfg = null) {
        const conf = cfg || extension_settings[EXT_NAME] || {};
        // 上传背景功能已移除：旧设置里若还留着底图，这里直接丢掉，避免用户没法清掉
        const raw = { ...NI_TB_SKIN_DEFAULT, ...(conf.tbSkin || {}), art: '', pad: null, forcePad: 0 };
        const skin = niTbNormalizeSkin(raw);
        return {
            art: '',
            veil: skin.veil,
            accent: skin.accent || '',
            title: skin.title || '',
            text: skin.text || '',
            barBg: skin.barBg || '',
            cardBg: skin.cardBg || '',
            cardLine: skin.cardLine || '',
            radius: skin.radius,
            cardH: skin.cardH,
            cardPad: skin.cardPad
        };
    }

    /** 设置页调用：改一部分皮肤，存起来，立刻重画 */
    function niTbSetSkin(patch = {}, { persist = true } = {}) {
        const cfg = extension_settings[EXT_NAME];
        if (!cfg) return false;
        cfg.tbSkin = niTbNormalizeSkin({ ...NI_TB_SKIN_DEFAULT, ...(cfg.tbSkin || {}), ...(patch || {}) });
        try { niTbPaintStoryBar(niCreateTbSnapshot()); } catch (e) { console.warn('[NI] 皮肤应用失败:', e); }
        if (persist) { try { niSaveSettings?.(); } catch { /* 忽略 */ } }
        return true;
    }

    /** snapshot → 组件 state */
    function niTbBarState(snapshot = null, { open = _niTbOpen } = {}) {
        const cfg = extension_settings[EXT_NAME] || {};
        const runtime = snapshot?.nodes ? snapshot : niCreateTbSnapshot();
        const { nodes, doneCount } = runtime;
        if (!nodes.length) return null;
        niTbReconcileCurrentNode(nodes);
        const curNode = nodes[S.tbCurIdx] || nodes[0];
        const viewNode = nodes[S.tbViewIdx] || curNode;
        const stageView = niTbStageView(nodes, S.tbViewIdx);
        const cur = Math.max(0, nodes.indexOf(viewNode));
        let offCount = 0;
        try { offCount = (niTbGetOffscreenState()?.threads || []).length; } catch { /* 忽略 */ }
        return {
            open: !!open,
            status: doneCount === nodes.length ? '全部完成' : '进行中',
            title: viewNode?.title || '（未命名）',
            meta: `节点 ${stageView.curIdx + 1} / ${stageView.nodes.length}`,
            auto: !!cfg.tbAutoAdvance,
            paused: !!S.tbPaused,
            offCount,
            cur,
            nodes: nodes.map((n, i) => ({
                num: String(i + 1),
                meta: n?.time ? String(n.time) : (n?.stageIdx ? `第 ${n.stageIdx} 阶段` : ''),
                type: n?.type || '主线',
                typeKind: niTbNodeTypeKind(n),
                title: n?.title || '（未命名）',
                desc: n?.summary || n?.desc || '',
                extras: Array.isArray(n?.events) ? n.events.slice(0, 4) : [],
                done: !!n?.done
            })),
            skin: niTbSkinFor(cfg),
            extraHtml: niTbPanelsHtml(cfg)
        };
    }

    /** 把插件自己的样式带进 shadow（只做一次；大于 120KB 的走 <link>，避免反复解析） */
    function niTbInjectShadowCss() {
        if (!_niTbShadow) return;
        if (_niTbShadow.getElementById?.('ni-tb-shadow-css')) return;
        if (_niTbShadow.querySelector?.('#ni-tb-shadow-css')) return;
        const src = document.getElementById('ni-tb-injected-css');
        if (!src) return;
        const css = src.textContent || '';
        const coarse = (typeof matchMedia === 'function') && matchMedia('(pointer: coarse)').matches;
        if (coarse || css.length > 120000) {
            const link = document.createElement('link');
            link.id = 'ni-tb-shadow-css';
            link.rel = 'stylesheet';
            const href = (document.querySelector('link[href*="novel-injector/style.css"]') || {}).href;
            if (href) { link.href = href; _niTbShadow.appendChild(link); return; }
        }
        const st = document.createElement('style');
        st.id = 'ni-tb-shadow-css';
        st.textContent = css;
        _niTbShadow.appendChild(st);
    }

    /** 把 state 推给组件并重建面板 */
    function niTbPaintStoryBar(snapshot = null) {
        // 防重入：面板刷新会触发别的同步，互相调用会死循环（表现就是打开即卡死）
        if (niTbPaintStoryBar._busy) return false;
        // 断路器：手机上若被高频同步拖着跑，1 秒超过 12 次就停下来，别把页面拖死
        const now = Date.now();
        const win = niTbPaintStoryBar._win || (niTbPaintStoryBar._win = { t: now, n: 0 });
        if (now - win.t > 1000) { win.t = now; win.n = 0; }
        if (++win.n > 12) return false;
        niTbPaintStoryBar._busy = true;
        try {
            return niTbPaintStoryBarInner(snapshot);
        } finally {
            niTbPaintStoryBar._busy = false;
        }
    }

    function niTbPaintStoryBarInner(snapshot = null) {
        const el = document.getElementById('ni-storybar');
        if (!el || el.tagName !== 'NI-STORYBAR') return false;
        niDefineStoryBar();
        _niTbShadow = el.shadowRoot || null;
        const state = niTbBarState(snapshot);
        if (!state) return false;
        // 先把主题色铺上，皮肤里有值的话组件随后会覆盖（内联样式后写的手上风）
        try {
            const cs = getComputedStyle(document.body);
            const pick = (name, fallback) => (cs.getPropertyValue(name) || '').trim() || fallback;
            el.style.setProperty('--tb-accent', pick('--ni-primary', '#c05a62'));
            el.style.setProperty('--tb-text', pick('--color-text-secondary', '#6a6a7a'));
            el.style.setProperty('--tb-title', pick('--color-text-primary', '#1a1a1a'));
            el.style.setProperty('--tb-bar-bg', pick('--color-background-primary', '#ffffff'));
            el.style.setProperty('--tb-card-bg', pick('--color-background-primary', '#ffffff'));
            el.style.setProperty('--tb-card-line', pick('--color-border-tertiary', '#e8e8ec'));
        } catch (e) { console.warn('[NI] 状态栏样式同步失败:', e); }
        // 状态没变就别重绘整个 shadow（innerHTML 重建很贵，手机上尤其致命）
        const sig = [
            state.open, state.cur, state.nodes.length, state.offCount,
            state.paused ? 1 : 0, state.skin?.accent || '', state.skin?.art?.length || 0,
            state.skin?.cardH || 0, state.nodes[0]?.title || ''
        ].join('|');
        const same = sig && sig === niTbPaintStoryBarInner._sig;
        if (same) {
            try {
                niTbInjectShadowCss();
                if (state.open) {
                    niTbRebuildStageList(snapshot || niCreateTbSnapshot(), { alignActive: true });
                }
            } catch { /* 忽略 */ }
            return true;
        }
        niTbPaintStoryBarInner._sig = sig;
        el.state = state;
        // 组件 render() 会重写 shadowRoot.innerHTML，所以画完补一次样式；
        // 但样式表很大（上百 KB），只在缺失时补，绝不再复制文本
        try {
            niTbInjectShadowCss();
        } catch (e) { console.warn('[NI] 状态栏样式同步失败:', e); }
        try {
            niTbRebuildStageList(snapshot || niCreateTbSnapshot(), { alignActive: true });
            if (state.open) {
                niTbRefreshNodePanel(snapshot || niCreateTbSnapshot());
                niTbRenderOffscreenBar();
                niTbSyncAutoAdvanceUI?.();
            }
        } catch (e) { console.warn('[NI] 状态栏面板刷新失败:', e); }
        return true;
    }

    /** 组件交互 → 旧功能 */
    function niTbOnBarAct(e) {
        const { act, payload } = e.detail || {};
        const fake = { stopPropagation() {}, preventDefault() {} };
        switch (act) {
            case 'toggle': {
                _niTbOpen = !_niTbOpen;
                const snap = niCreateTbSnapshot();
                niTbPaintStoryBar(snap);
                if (!_niTbOpen) niTbCollapseStoryBar({ clearLazy: true });
                break;
            }
            case 'stage': {
                const visible = niTbToggleDropPanel('ni-tb-stage-panel', 'ni-tb-node-panel');
                if (visible) niTbRebuildStageList(niCreateTbSnapshot(), { alignActive: true });
                break;
            }
            case 'node': {
                const visible = niTbToggleDropPanel('ni-tb-node-panel', 'ni-tb-stage-panel');
                if (visible) niTbRefreshNodePanel(niCreateTbSnapshot());
                break;
            }
            case 'auto':   window.niTbForceJudge?.(); break;
            case 'infer':  niTbGenerateInfer(); break;
            case 'pause':  niTbTogglePaused?.(fake); break;
            case 'pick':   niTbCardClick(fake, Number(payload)); break;
            case 'next':   niTbCardClick(fake, (S.tbViewIdx || 0) + 1); break;
            case 'prev':   niTbCardClick(fake, (S.tbViewIdx || 0) - 1); break;
            case 'off': {
                const body = niTbById('ni-tb-off-body');
                const open = body?.classList.toggle('vis');
                niTbById('ni-tb-off-chevron')?.classList.toggle('open', open);
                if (open) niTbRenderOffscreenBar();
                break;
            }
            default: break;
        }
    }

    function niTbBindBarAct() {
        const el = document.getElementById('ni-storybar');
        if (!el || el.dataset.niActBound === '1') return;
        el.dataset.niActBound = '1';
        el.addEventListener('ni-tb-act', niTbOnBarAct);
    }

    function niGetTbStoryBarHtml(snapshot = null) {
        const cfg = extension_settings[EXT_NAME] || {};
        if (cfg.tbBarLegacy) return niGetTbStoryBarHtmlLegacy(snapshot);
        const runtime = snapshot?.nodes ? snapshot : niCreateTbSnapshot();
        if (!runtime?.nodes?.length) return '';
        const follow = cfg.themeStatusbarFollow ? ' ni-tb-theme-follow' : '';
        const v2 = (snapshot === null) ? '' : '';
        return `<ni-storybar id="ni-storybar" class="ni-tb-host${follow}"></ni-storybar>${v2}`;
    }

    function niGetTbStoryBarHtmlLegacy(snapshot = null) {
        const cfg = extension_settings[EXT_NAME] || {};
        const runtime = snapshot?.nodes ? snapshot : niCreateTbSnapshot();
        const { nodes, doneCount } = runtime;
        if (!nodes.length) return '';
    
        // 用稳定节点 id 恢复当前节点，再钳制 curIdx
        niTbReconcileCurrentNode(nodes);
        const curNode = nodes[S.tbCurIdx] || nodes[0];
        const viewNode = nodes[S.tbViewIdx] || curNode;
        const stageView = niTbStageView(nodes, S.tbViewIdx);
        const statusLabel = doneCount === nodes.length ? '全部完成' : '进行中';
        const themeFollowClass = cfg.themeStatusbarFollow ? ' ni-tb-theme-follow' : '';
    
        return `<div class="ni-tb-shell${themeFollowClass}" id="ni-storybar">
      <div class="ni-tb-bar" id="ni-tb-bar">
        <div class="ni-tb-pin"></div>
        <div class="ni-tb-status">${statusLabel}</div>
        <div class="ni-tb-curtitle" id="ni-tb-curtitle">${niEsc(viewNode.title)}</div>
        <div class="ni-tb-meta" id="ni-tb-meta">节点 ${stageView.curIdx + 1} / ${stageView.nodes.length}</div>
        <i class="ti ti-chevron-down ni-tb-chevron" id="ni-tb-chevron"></i>
      </div>
      <div class="ni-tb-body" id="ni-tb-body-wrap">
        <div class="ni-tb-selrow">
          <div class="ni-tb-sel-btn ni-tb-icon-only" id="ni-tb-stage-btn" title="切换阶段">
            <i class="ti ti-layout-list"></i>
          </div>
          <div class="ni-tb-sel-sep">/</div>
          <div class="ni-tb-sel-btn ni-tb-icon-only" id="ni-tb-node-btn" title="切换节点">
            <i class="ti ti-flag-2"></i>
          </div>
          <div class="ni-tb-sel-spacer"></div>
          <div class="ni-tb-btn-juadvise${cfg.tbAutoAdvance ? ' active' : ''}" id="ni-tb-btn-auto-adv" title="自动推进：模型判断当前节点演完后自动前进（点一下立即判定一次）">
            <i class="ti ti-wand" id="ni-tb-auto-adv-icon"></i>
            <span id="ni-tb-auto-adv-label">自动</span>
          </div>
          <div class="ni-tb-btn-free" id="ni-tb-btn-free">
            <i class="ti ti-chart-line" id="ni-tb-free-icon"></i>
            <span id="ni-tb-free-label">推演</span>
          </div>
          <div class="ni-tb-btn-pause${S.tbPaused ? ' paused' : ''}" id="ni-tb-btn-pause">
            <i class="${S.tbPaused ? 'ti ti-player-play' : 'ti ti-player-pause'}" id="ni-tb-pause-icon"></i>
            <span id="ni-tb-pause-text">${S.tbPaused ? '继续' : '暂停'}</span>
          </div>
        </div>
    
        <!-- 阶段下拉 -->
        <div class="ni-tb-drop-panel" id="ni-tb-stage-panel">
          <span class="ni-tb-sp-label">已开启阶段</span>
          <div class="ni-tb-sp-list" id="ni-tb-stage-list"></div>
        </div>
    
        <!-- 节点下拉 -->
        <div class="ni-tb-drop-panel" id="ni-tb-node-panel"></div>
    
        <!-- 轮播 -->
        <div class="ni-tb-carousel-wrap" id="ni-tb-wrap">
          <div class="ni-tb-track" id="ni-tb-track"></div>
        </div>
    
        <!-- 推演结果 -->
        <div class="ni-tb-infer-block" id="ni-tb-infer-block">
          <div class="ni-tb-infer-toggle expanded" id="ni-tb-infer-toggle">
            <span class="ni-tb-infer-toggle-label">以下为下一步行动选项，点击填入输入框</span>
            <i class="ti ti-chevron-up ni-tb-infer-toggle-icon expanded" id="ni-tb-infer-toggle-icon"></i>
          </div>
          <div class="ni-tb-infer-list vis" id="ni-tb-infer-list"></div>
        </div>

        <!-- 后台动向（其他视角） -->
        <div class="ni-tb-off-block" id="ni-tb-off-block">
          <div class="ni-tb-off-head" id="ni-tb-off-toggle">
            <span class="ni-tb-off-title">
              <i class="ti ti-world"></i>
              后台动向<span class="ni-tb-off-count" id="ni-tb-off-count"></span>
            </span>
            <span class="ni-tb-off-ops">
              <span class="ni-tb-off-run" id="ni-tb-off-run" title="立刻推演一轮其他视角的动向">推演</span>
              <i class="ti ti-chevron-down ni-tb-off-chevron" id="ni-tb-off-chevron"></i>
            </span>
          </div>
          <div class="ni-tb-off-body" id="ni-tb-off-body">
            <div class="ni-tb-off-list" id="ni-tb-off-list"></div>
          </div>
        </div>
      </div>
    </div>`;
    }
    
    function niEsc(s) {
        return String(s || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
    
    function niTbBuildStageListHtml(stages, activeStageIdx, pagination = null) {
        const rows = (Array.isArray(stages) ? stages : []).map(s =>
            `<div class="ni-tb-sp-row${s.stageIdx === activeStageIdx ? ' active-stage' : ''}" data-si="${s.stageIdx}">
               <div class="ni-tb-sp-dot"></div>
               <span class="ni-tb-sp-name">${niEsc(s.title)}</span>
             </div>`
        ).join('');
        if (!pagination) return rows;
        const pager = niBuildListPaginationHtml({
            pagination,
            idPrefix: 'ni-tb-stage-page',
            wrapperClass: 'ni-tb-sp-page',
            sizeInputClass: 'ni-tb-sp-page-size',
            pageInputClass: 'ni-tb-sp-page-current',
            pageButtonClass: 'ni-tb-sp-page-btn',
            sizeAriaLabel: '每页穿书阶段数',
            pageAriaLabel: '当前穿书阶段页码',
        });
        return pager + rows;
    }
    
    // 节点面板「进行中」的全局下标：以推导出的注入节点为准，取不到时退回阶段锚点。
    function niTbResolveActivePanelIdx(nodes) {
        const list = Array.isArray(nodes) ? nodes : [];
        const injectionNode = niTbGetInjectionNode(list);
        if (!injectionNode) return S.tbCurIdx;
        const idx = list.findIndex(node => node === injectionNode
            || (injectionNode.id && node?.id === injectionNode.id));
        return idx >= 0 ? idx : S.tbCurIdx;
    }

    function niTbBuildNodePanelHtml(nodes, curIdx, limits = _tbNodePanelLimits) {
        const activeNode  = nodes.find(n => n._globalIdx === curIdx) || nodes[curIdx];
        const activeId    = activeNode?.id;
        // 整个阶段都归档后注入节点停在末节点，此时它自身是 done 的：从已归档列表里排除，
        // 否则同一个节点会同时出现在「已归档」和「进行中」两个区块。
        const doneNodes   = nodes.filter(n => n.done && n.id !== activeId);
        const todoNodes   = nodes.filter(n => !n.done && n.id !== activeId);
        const sOp = S.tbSectionOpen;
        const visibleDone = sOp.done ? doneNodes.slice(0, Math.max(1, limits?.done || TB_NODE_BATCH_SIZE)) : [];
        const visibleTodo = sOp.todo ? todoNodes.slice(0, Math.max(1, limits?.todo || TB_NODE_BATCH_SIZE)) : [];
    
        const mkRow = (n, i, cls, dotCls) =>
            `<div class="ni-tb-np-row ${cls}" data-ni="${n._globalIdx ?? i}">
               <div class="ni-tb-np-dot ${dotCls}"></div>
               <span class="ni-tb-np-title">${niEsc(n.title)}</span>
               <span class="ni-tb-np-type ${n.type}">${niEsc(n.typeLabel)}</span>
             </div>`;
    
        return `
          <div class="ni-tb-section-hd" data-sec="done">
            <i class="ti ti-chevron-right ni-tb-section-icon${sOp.done ? ' open' : ''}" id="ni-tb-sec-icon-done"></i>
            <span class="ni-tb-section-label">已归档</span>
            <span class="ni-tb-section-count done-count" id="ni-tb-sec-count-done">${doneNodes.length}</span>
          </div>
          <div class="ni-tb-np-list${sOp.done ? ' vis' : ''}" id="ni-tb-sec-list-done">
            ${visibleDone.map((n, i) => mkRow(n, i, 'done-row', 'done')).join('')}
            ${visibleDone.length < doneNodes.length ? `<button class="ni-tb-np-more" data-sec="done">继续显示（${doneNodes.length - visibleDone.length}）</button>` : ''}
          </div>
          <div class="ni-tb-section-hd" data-sec="active" style="background:var(--ni-warning-alpha-03, rgba(208,100,110,.03))">
            <i class="ti ti-chevron-right ni-tb-section-icon open" id="ni-tb-sec-icon-active"></i>
            <span class="ni-tb-section-label" style="color:var(--color-text-primary);font-weight:500">进行中</span>
            <span class="ni-tb-section-count done-count">当前</span>
          </div>
          <div class="ni-tb-np-list vis" id="ni-tb-sec-list-active">
            ${activeNode ? mkRow(activeNode, activeNode._globalIdx ?? curIdx, 'active', 'active-dot') : ''}
          </div>
          <div class="ni-tb-section-hd" data-sec="todo">
            <i class="ti ti-chevron-right ni-tb-section-icon${sOp.todo ? ' open' : ''}" id="ni-tb-sec-icon-todo"></i>
            <span class="ni-tb-section-label" style="opacity:.5">待解锁 / 未完成</span>
            <span class="ni-tb-section-count" id="ni-tb-sec-count-todo">${todoNodes.length}</span>
          </div>
          <div class="ni-tb-np-list${sOp.todo ? ' vis' : ''}" id="ni-tb-sec-list-todo">
            ${visibleTodo.map((n, i) => mkRow(n, i, n.locked ? '' : '', n.locked ? 'todo' : 'todo')).join('')}
            ${visibleTodo.length < todoNodes.length ? `<button class="ni-tb-np-more" data-sec="todo">继续显示（${todoNodes.length - visibleTodo.length}）</button>` : ''}
          </div>`;
    }
    
    // ── 轮播渲染 ─────────────────────────────────────────────────
    
    const TB_AW = 214, TB_SW = 150, TB_GAP = 10;
    
    function niTbGetSlots(nodes, cur) {
        const s = [];
        if (cur > 0) s.push({ idx: cur - 1, role: 'prev' });
        s.push({ idx: cur, role: 'active' });
        if (cur < nodes.length - 1) s.push({ idx: cur + 1, role: 'next' });
        return s;
    }
    
    function niTbCalcPos(slots, W) {
        const ws  = slots.map(s => s.role === 'active' ? TB_AW : TB_SW);
        const ai  = slots.findIndex(s => s.role === 'active');
        const pos = [];
        pos[ai] = W / 2 - TB_AW / 2;
        let rx = pos[ai];
        for (let i = ai - 1; i >= 0; i--) { rx -= TB_GAP + ws[i]; pos[i] = rx; }
        let lx = pos[ai] + TB_AW;
        for (let i = ai + 1; i < slots.length; i++) { pos[i] = lx + TB_GAP; lx = pos[i] + ws[i]; }
        return pos;
    }
    
    function niTbCardHTML(node, idx, displayIdx = idx) {
        const typeCls = node.type;
        const descText = node.locked ? '（待解锁）' : (node.body || '（暂无描述）');
        const metaParts = [node.time, node.location]
            .map(v => String(v || '').trim())
            .filter(Boolean);
        const metaHtml = metaParts.length
            ? `<span class="ni-tb-sc-num-meta">${niEsc(metaParts.join(' · '))}</span>`
            : '';
    
        // 事件列表
        const subNotes = (!node.locked && Array.isArray(node.sub_notes) && node.sub_notes.length)
            ? node.sub_notes : [];
        // 伏笔列表
        const foreshadows = (!node.locked && Array.isArray(node.branch_links))
            ? node.branch_links
                .filter(l => l.startsWith('【伏笔】'))
                .map(l => l.replace('【伏笔】', '').trim())
            : [];
    
        const subHtml = subNotes.length
            ? `<div class="ni-tb-sc-extras">${subNotes.map(s =>
                `<span class="ni-tb-sc-event"><i class="ti ti-circle-dot"></i>${niEsc(s)}</span>`
              ).join('')}</div>`
            : '';
        const foreHtml = foreshadows.length
            ? `<div class="ni-tb-sc-extras">${foreshadows.map(f =>
                `<span class="ni-tb-sc-fore"><i class="ti ti-bookmark"></i>${niEsc(f)}</span>`
              ).join('')}</div>`
            : '';
    
        return `<div class="ni-tb-sc-num">节点 ${displayIdx + 1}${metaHtml}</div>
    <span class="ni-tb-sc-type ${typeCls}">${niEsc(node.typeLabel)}</span>
    <div class="ni-tb-sc-check${node.done ? ' checked' : ''}" id="ni-tb-chk${idx}"><i class="ti ti-check"></i></div>
    <div class="ni-tb-sc-title">${niEsc(node.title)}</div>
    <div class="ni-tb-sc-desc">${niEsc(descText)}</div>
    ${subHtml}${foreHtml}
    <div class="ni-tb-scard-overlay" id="ni-tb-overlay${idx}">
      <div class="ni-tb-done-badge">已归档</div>
      <div class="ni-tb-unarchive-hint">点击取消归档</div>
    </div>`;
    }
    
    function niTbBuildTrack(nodes = null) {
        const track = niTbById('ni-tb-track');
        if (!track) return;
        track.innerHTML = '';
        const wrap = niTbById('ni-tb-wrap');
        const W    = wrap ? wrap.offsetWidth : 600;
        const list = Array.isArray(nodes) ? nodes : niGetTbNodes();
        if (!list.length) return;
        niTbReconcileViewNode(list);
        const view  = niTbStageView(list, S.tbViewIdx);
        if (!view.nodes.length) return;
        const slots = niTbGetSlots(view.nodes, view.curIdx);
        const pos   = niTbCalcPos(slots, W);
    
        slots.forEach((s, i) => {
            const n  = view.nodes[s.idx];
            const gi = n._globalIdx ?? s.idx;
            const el = document.createElement('div');
            el.id        = `ni-tb-card${gi}`;
            el.className = `ni-tb-scard ${s.role === 'active' ? 'active' : s.role === 'prev' ? 'side-prev' : 'side-next'}${n.done ? ' done' : ''}`;
            el.style.left  = pos[i] + 'px';
            el.style.width = (s.role === 'active' ? TB_AW : TB_SW) + 'px';
            el.innerHTML   = niTbCardHTML(n, gi, s.idx);
            el.onclick     = (e) => niTbCardClick(e, gi);
            track.appendChild(el);
        });
        niRefreshStorybarTheme();
    }
    
    function niTbAnimateTo(newCur, nodes) {
        const wrap  = niTbById('ni-tb-wrap');
        const track = niTbById('ni-tb-track');
        if (!wrap || !track) return;
        const W = wrap.offsetWidth || 600;
    
        const view = niTbStageView(nodes, newCur);
        if (!view.nodes.length) return;
        const needed  = new Set();
        const localNeeded = new Set();
        if (view.curIdx > 0) localNeeded.add(view.curIdx - 1);
        localNeeded.add(view.curIdx);
        if (view.curIdx < view.nodes.length - 1) localNeeded.add(view.curIdx + 1);
        localNeeded.forEach(li => needed.add(view.nodes[li]._globalIdx ?? li));
    
        const existing  = new Set([...track.querySelectorAll('.ni-tb-scard')].map(el => +el.id.replace('ni-tb-card', '')));
        const newSlots  = niTbGetSlots(view.nodes, view.curIdx);
        const newPos    = niTbCalcPos(newSlots, W);
    
        // 移除不再需要的卡片
        existing.forEach(idx => {
            if (!needed.has(idx)) {
                const el = document.getElementById(`ni-tb-card${idx}`);
                if (!el) return;
                el.style.opacity = '0'; el.style.transform = 'scale(.92)';
                setTimeout(() => el.remove(), 400);
            }
        });
    
        // 新增卡片
        newSlots.forEach((s, i) => {
            const n  = view.nodes[s.idx];
            const gi = n._globalIdx ?? s.idx;
            if (!existing.has(gi)) {
                const el = document.createElement('div');
                el.id        = `ni-tb-card${gi}`;
                el.className = `ni-tb-scard ${s.role === 'active' ? 'active' : s.role === 'prev' ? 'side-prev' : 'side-next'}${n.done ? ' done' : ''}`;
                el.style.transition = 'none';
                el.style.left    = (newPos[i] + (gi < newCur ? -70 : 70)) + 'px';
                el.style.width   = (s.role === 'active' ? TB_AW : TB_SW) + 'px';
                el.style.opacity = '0'; el.style.transform = 'scale(.94)';
                el.innerHTML     = niTbCardHTML(n, gi, s.idx);
                el.onclick       = (e) => niTbCardClick(e, gi);
                track.appendChild(el);
                requestAnimationFrame(() => requestAnimationFrame(() => {
                    el.style.transition = '';
                    el.style.left = newPos[i] + 'px';
                    el.style.opacity = ''; el.style.transform = '';
                }));
            }
        });
    
        // 更新已有卡片位置/角色
        newSlots.forEach((s, i) => {
            const n  = view.nodes[s.idx];
            const gi = n._globalIdx ?? s.idx;
            if (existing.has(gi)) {
                const el = document.getElementById(`ni-tb-card${gi}`);
                if (!el) return;
                el.className   = `ni-tb-scard ${s.role === 'active' ? 'active' : s.role === 'prev' ? 'side-prev' : 'side-next'}${n.done ? ' done' : ''}`;
                el.style.left  = newPos[i] + 'px';
                el.style.width = (s.role === 'active' ? TB_AW : TB_SW) + 'px';
                el.style.opacity = ''; el.style.transform = '';
            }
        });
        niRefreshStorybarTheme();
    }
    
    function niTbCardClick(e, idx, nodes = null) {
        // 卡片可能在归档状态变化后继续存活，闭包携带的节点数组会过期；点击时统一取最新数据
        const list = Array.isArray(nodes) ? nodes : niGetTbNodes();
        if (idx !== S.tbViewIdx) {
            niTbSetViewIdx(idx, list, { persist: true });
            niTbAnimateTo(idx, list);
            niTbSyncMeta(list);
            niTbRefreshNodePanel(list);
            return;
        }
        // active 卡：判断点击区域
        const overlay = document.getElementById(`ni-tb-overlay${idx}`);
        const chk     = document.getElementById(`ni-tb-chk${idx}`);
        if (overlay && overlay.contains(e.target)) {
            niTbUnarchive(idx, list);
        } else if (chk && chk.contains(e.target)) {
            niTbToggleCheck(idx, list);
        }
    }
    
    // ── 节点操作 ─────────────────────────────────────────────────
    
    function niTbSyncMeta(nodes) {
        niTbReconcileViewNode(nodes);
        const n = nodes[S.tbViewIdx];
        if (!n) return;
        const view   = niTbStageView(nodes, S.tbViewIdx);
        const el = (id) => document.getElementById(id);
        if (el('ni-tb-curtitle')) el('ni-tb-curtitle').textContent = n.title;
        if (el('ni-tb-meta'))     el('ni-tb-meta').textContent     = `节点 ${view.curIdx + 1} / ${view.nodes.length}`;
        niRefreshStorybarTheme();
    }
    
    function niTbRefreshNodePanel(nodes) {
        const panel = niTbById('ni-tb-node-panel');
        if (!panel) return;
        // 「进行中」必须指向真正参与注入的节点：tbCurIdx 只是阶段锚点，勾选归档时它不动，
        // 注入节点却会前移到阶段内第一个未归档未锁定的节点，两者会分叉。
        const activeIdx = niTbResolveActivePanelIdx(nodes);
        const view = niTbStageView(nodes, activeIdx);
        if (_tbNodePanelStageIdx !== view.stageIdx) {
            _tbNodePanelStageIdx = view.stageIdx;
            _tbNodePanelLimits.done = TB_NODE_BATCH_SIZE;
            _tbNodePanelLimits.todo = TB_NODE_BATCH_SIZE;
        }
        panel.innerHTML = niTbBuildNodePanelHtml(view.nodes, activeIdx, _tbNodePanelLimits);
        niTbBindNodePanelEvents();
        niRefreshStorybarTheme();
    }
    
    // 把节点标记为已完成，并按需准备「推进到下一个节点」的提示词。
    // 手动推进按钮与卡片勾选共用这一段，保证两处行为完全一致。
    // 返回 { node, nextNode, stageFinished }：stageFinished 为 true 表示本阶段
    // 已经没有未完成节点（节点菜单里勾选时显示阶段完成标记；自动推进则在这里停住）。
    function niTbPrepareNodeDone(node, nodes, { writePrompt = true } = {}) {
        if (!node) return null;
        const newDone = !node.done;
        S.tbNodeDone[node.id] = newDone;
        node.done = newDone;
        if (node.legacyId && node.legacyId !== node.id) delete S.tbNodeDone[node.legacyId];
        if (!newDone) {
            for (const key of _tbAdvanceSent) {
                if (key.startsWith(`${node.id}->`)) _tbAdvanceSent.delete(key);
            }
            return { node, nextNode: null, stageFinished: false };
        }
        const list = Array.isArray(nodes) ? nodes : [];
        const nodeIndex = list.findIndex(x => x.id === node.id);
        const nextNode = list.find((n, i) => i > nodeIndex && n.stageIdx === node.stageIdx && !n.done);
        if (writePrompt) {
            if (nextNode) niTbWriteAdvancePrompt(node, nextNode);
            else niTbShowStageDone(node.stageIdx, niGetTbStages(list));
        }
        return { node, nextNode: nextNode || null, stageFinished: !nextNode };
    }

    async function niTbToggleCheck(idx, nodes = null) {
        const list = Array.isArray(nodes) ? nodes : niGetTbNodes();
        const node  = list[idx];
        if (!node) return;
        if (node.locked) return; // 锁定节点不可操作

        niTbPrepareNodeDone(node, list);
    
        // 更新 DOM 立即反馈
        document.getElementById(`ni-tb-chk${idx}`)?.classList.toggle('checked', node.done);
        document.getElementById(`ni-tb-card${idx}`)?.classList.toggle('done', node.done);
        const updatedSnapshot = niCreateTbSnapshot();
        niTbRefreshNodePanel(updatedSnapshot.nodes);
        niTbSyncStoryBar(updatedSnapshot);
    
        await niTbSaveState(updatedSnapshot.nodes);
    }
    
    // ── 一键推进：完成当前节点 -> 本阶段下一个节点 ────────────────
    // 到本阶段最后一个节点就停住（跨阶段由用户自己点，见「切换阶段」菜单）。

    function niTbIsLastNodeOfStage(node, nodes) {
        if (!node) return false;
        const list = Array.isArray(nodes) ? nodes : [];
        const stageIdx = node.stageIdx;
        const sameStage = list.filter(n => n.stageIdx === stageIdx);
        if (!sameStage.length) return true;
        for (let i = 0; i < sameStage.length; i++) {
            if (sameStage[i].id === node.id) return i === sameStage.length - 1;
        }
        return false;
    }

    // 下一个节点描述：本阶段无后续节点时用下一个已开启阶段的首节点提示用户自己去切。
    function niTbDescribeNextNode(node, nodes, stages = null) {
        const list = Array.isArray(nodes) ? nodes : [];
        const nodeIndex = list.findIndex(x => x.id === node?.id);
        const nextInStage = list.find((n, i) =>
            i > nodeIndex &&
            n.stageIdx === node?.stageIdx && !n.done && !n.locked
        );
        if (nextInStage) return { text: nextInStage.title || '（未命名节点）', sameStage: true };
        const stageList = Array.isArray(stages) ? stages : niGetTbStages(list);
        const stageIdx = Number(node?.stageIdx) || 0;
        for (const stage of stageList) {
            if (Number(stage.stageIdx) <= stageIdx) continue;
            // 未解锁阶段没有可推进节点，不能当成「已完成」，否则会误报可以跨界。
            if (niIsTransbookStageLocked(stage.stageIdx, niGetTransbookStageCompletion(list), niTbFrontierStage())) continue;
            const first = (stage.nodes || []).find(n => !n.done && !n.locked);
            if (first) return { text: first.title || '（未命名节点）', sameStage: false, stageTitle: stage.title || `第 ${stage.stageIdx} 阶段` };
        }
        return { text: '', sameStage: false };
    }

    // 只负责「完成当前节点」；按钮仍可由用户在设置里关掉。
    async function niTbAdvanceOneNode() {
        if (S.tbAdvancing) return null;
        const cfg = extension_settings[EXT_NAME] || {};
        if (!cfg.transBookMode) {
            toastr?.info?.('请先打开穿书模式');
            return null;
        }
        if (S.tbPaused) {
            // 暂停的本意就是「先别往前走」——自动判定命中后也不该偷偷推进。
            toastr?.info?.('已暂停穿书推进，点状态栏「继续」后再推进');
            return null;
        }
        const nodes = niGetTbNodes();
        if (!nodes.length) {
            toastr?.warning?.('当前没有可推进的剧情节点');
            return null;
        }
        niTbReconcileCurrentNode(nodes);
        const curNode = niTbGetInjectionNode(nodes);
        if (!curNode) {
            toastr?.warning?.('当前没有可推进的剧情节点');
            return null;
        }
        S.tbAdvancing = true;
        try {
            const curStageIdx = Number(curNode.stageIdx) || 0;
            const stageList = niGetTbStages(nodes);
            const curStageTitle = stageList.find(s => Number(s.stageIdx) === curStageIdx)?.title || `第 ${curStageIdx} 阶段`;
            const done = niTbPrepareNodeDone(curNode, nodes, { writePrompt: true });
            const snapshot = niCreateTbSnapshot();
            const fresh = snapshot.nodes;
            // 已经走到本阶段最后一个节点：只标记完成，不跨阶段（跨阶段交回用户）。
            const stageEnded = niTbIsLastNodeOfStage(curNode, fresh) || done?.stageFinished;
            if (stageEnded) {
                niTbRefreshNodePanel(fresh);
                niTbSyncStoryBar(snapshot);
                await niTbSaveState(fresh);
                niTbShowStageDone(curStageIdx, snapshot.stages);
                // 自动推进开启时，本阶段节点走完就自动进入下一阶段（原来要用户自己点「切换阶段」）。
                if (cfg.tbAutoAdvance !== false && cfg.tbAutoAdvanceCrossStage !== false) {
                    const crossed = await niTbAutoEnterNextStage(curNode, fresh);
                    if (crossed) {
                        toastr?.success?.(
                            `「${curStageTitle}」已走完，自动进入「${crossed.title}」：${crossed.nodeTitle}`,
                            '穿书推进'
                        );
                        return { advanced: true, stageEnded: true, crossed: true, node: curNode, stageIdx: crossed.stageIdx };
                    }
                }
                const lookahead = niTbDescribeNextNode(curNode, fresh, snapshot.stages);
                toastr?.info?.(
                    lookahead.text
                        ? `「${curNode.title}」已完成；「${curStageTitle}」已走完，下一阶段首节点是「${lookahead.text}」，需要你点「切换阶段」过去。`
                        : `「${curNode.title}」已完成；「${curStageTitle}」已走完，后面没有更多已开启阶段的节点了。`
                );
                return { advanced: false, stageEnded: true, node: curNode };
            }
            const nextNode = done?.nextNode || niTbDescribeNextNode(curNode, fresh, snapshot.stages);
            // 前进到本阶段第一个未完成且未锁定的节点（不跨阶段）。
            const nextIdx = fresh.findIndex(n =>
                n.stageIdx === curNode.stageIdx && !n.done && !n.locked
            );
            if (nextIdx < 0) {
                niTbRefreshNodePanel(fresh);
                niTbSyncStoryBar(snapshot);
                await niTbSaveState(fresh);
                return { advanced: false, stageEnded: true, node: curNode };
            }
            niTbSetCurrentIdx(nextIdx, fresh, { persist: false });
            niTbAnimateTo(nextIdx, fresh);
            niTbSyncMeta(fresh);
            niTbRefreshNodePanel(fresh);
            const after = niCreateTbSnapshot();
            niTbSyncStoryBar(after);
            await niTbSaveState(after.nodes);
            const nextTitle = fresh[nextIdx]?.title || nextNode?.text || '（未命名节点）';
            toastr?.success?.(
                `${curStageTitle}：已完成「${curNode.title}」，已推进到「${nextTitle}」`,
                '穿书推进'
            );
            return { advanced: true, stageEnded: false, node: curNode, nextIdx };
        } catch (e) {
            console.error('[NI-TB] 自动推进失败:', e);
            toastr?.error?.(`推进失败：${e.message}`);
            return null;
        } finally {
            S.tbAdvancing = false;
            niTbSyncAutoAdvanceUI();
        }
    }
    window.niTbAdvanceOneNode = niTbAdvanceOneNode;

    // 自动跨阶段：当前阶段走完后，进入下一个「还有未完成节点」的阶段的首个节点。
    // 手动路径不会调用它，只有自动推进且开了「自动进入下一阶段」时才走。
    async function niTbAutoEnterNextStage(curNode, nodes = null) {
        const list = Array.isArray(nodes) ? nodes : niGetTbNodes();
        const curStageIdx = Number(curNode?.stageIdx) || 0;
        const stages = niGetTbStages(list);
        const next = stages.find(s => Number(s.stageIdx) > curStageIdx
            && (s.nodes || []).some(n => !n.done && !n.locked));
        if (!next) return null;
        const first = (next.nodes || []).find(n => !n.done && !n.locked);
        const firstIdx = list.findIndex(n => n.id === first?.id);
        if (!first || firstIdx < 0) return null;
        // 跨阶段要把 frontier 一起推进，否则下一阶段还停留在「未解锁」。
        S.tbFrontierStageIdx = niAdvanceTransbookFrontier(S.tbFrontierStageIdx, Number(next.stageIdx));
        niTbSetCurrentIdx(firstIdx, list, { persist: true, archivePrior: true });
        niTbBuildTrack(list);
        niTbSyncMeta(list);
        niTbRefreshNodePanel(list);
        niTbSyncStoryBar(niCreateTbSnapshot());
        await niTbSaveState(list);
        // 进入新阶段后同样注入一次「推进提示词」，让模型知道换了场景。
        niTbWriteAdvancePrompt(curNode, first);
        return {
            stageIdx: Number(next.stageIdx),
            title: next.title || `第 ${next.stageIdx} 阶段`,
            nodeTitle: first.title || '（未命名节点）',
        };
    }
    window.niTbAutoEnterNextStage = niTbAutoEnterNextStage;

    // 供「自动推进」判定器取当前上下文：当前节点、阶段信息、是否暂停/正在推进。
    function niTbGetAutoAdvanceContext() {
        const cfg = extension_settings[EXT_NAME] || {};
        const list = niGetTbNodes();
        const snapshot = niCreateTbSnapshot(list);
        // 之前直接取 list[S.tbCurIdx]：节点归档/重排后这个下标会失真，判定就落在一个
        // 已经 done 的旧节点上，于是永远判不出「演完了」，表现就是「自动推进不生效」。
        // 这里统一走注入节点（内部会先 reconcile 再解析），和真正注入用的是同一个节点。
        const curNode = niTbGetInjectionNode(list);
        const stages = snapshot.stages || [];
        const curStageIdx = Number(curNode?.stageIdx) || 0;
        const findStage = idx => stages.find(s => Number(s.stageIdx) === Number(idx)) || null;
        const curStage = findStage(curStageIdx);
        const nextStage = stages.find(s => Number(s.stageIdx) > curStageIdx) || null;
        const stageNodes = curStage?.nodes || [];
        return {
            enabled: cfg.tbAutoAdvance !== false,
            paused: S.tbPaused === true,
            judging: S.tbAutoAdvanceJudging === true,
            advancing: S.tbAdvancing === true,
            nodes: list,
            nodeCount: list.length,
            curNode,
            curStageIdx,
            stageTitle: curStage?.title || `第 ${curStageIdx} 阶段`,
            stageNodeDoneCount: stageNodes.filter(n => n.done).length,
            stageNodeTotal: stageNodes.length,
            nextStageTitle: nextStage?.title || '',
        };
    }
    window.niTbGetAutoAdvanceContext = niTbGetAutoAdvanceContext;

    // 判定请求进行中时把状态栏徽标切成「判定中」，失败也不影响推进逻辑。
    function niTbSetAutoAdvanceJudging(on) {
        S.tbAutoAdvanceJudging = on === true;
        niTbSyncAutoAdvanceUI();
    }
    window.niTbSetAutoAdvanceJudging = niTbSetAutoAdvanceJudging;

    // ── 后台推演（其他视角）──────────────────────────────────────
    // 状态读写都走这里，index.js 不直接碰 S。
    function niTbGetOffscreenState() {
        const st = S.tbOffscreen || {};
        return {
            threads: Array.isArray(st.threads) ? st.threads : [],
            lastRunNodeId: String(st.lastRunNodeId || ''),
            lastRunAt: Number(st.lastRunAt) || 0,
        };
    }
    window.niTbGetOffscreenState = niTbGetOffscreenState;

    function niTbSetOffscreenState(patch = {}) {
        S.tbOffscreen = {
            threads: Array.isArray(patch.threads) ? patch.threads.slice(0, 24) : (S.tbOffscreen?.threads || []),
            lastRunNodeId: patch.lastRunNodeId !== undefined ? String(patch.lastRunNodeId) : String(S.tbOffscreen?.lastRunNodeId || ''),
            lastRunAt: patch.lastRunAt !== undefined ? (Number(patch.lastRunAt) || 0) : (Number(S.tbOffscreen?.lastRunAt) || 0),
        };
        niTbSaveState();
        niTbRenderOffscreenBar();
        // 通知 index.js 把弹窗里的列表也刷新一遍（两处共用同一份数据）
        try { document.dispatchEvent(new CustomEvent('ni:offscreen-changed')); } catch (e) { /* 忽略 */ }
        return niTbGetOffscreenState();
    }
    window.niTbSetOffscreenState = niTbSetOffscreenState;

    /** 后台推演用的上下文：当前节点、当前阶段、以及「未来剧情预告」覆盖的后续阶段节点标题。 */
    function niTbGetOffscreenContext() {
        const cfg = extension_settings[EXT_NAME] || {};
        const list = niGetTbNodes();
        const snapshot = niCreateTbSnapshot(list);
        // 之前直接取 list[S.tbCurIdx]：节点归档/重排后这个下标会失真，判定就落在一个
        // 已经 done 的旧节点上，于是永远判不出「演完了」，表现就是「自动推进不生效」。
        // 这里统一走注入节点（内部会先 reconcile 再解析），和真正注入用的是同一个节点。
        const curNode = niTbGetInjectionNode(list);
        const curStageIdx = Number(curNode?.stageIdx) || 0;
        const stages = snapshot.stages || [];
        const extra = Math.max(0, Math.min(10, parseInt(cfg.tbOffscreenStages, 10) || 0));
        const laterStages = extra > 0
            ? stages.filter(s => Number(s.stageIdx) > curStageIdx).slice(0, extra)
            : [];
        return {
            curNode,
            curNodeId: String(curNode?.id || S.tbCurNodeId || ''),
            curStageIdx,
            stageTitle: stages.find(s => Number(s.stageIdx) === curStageIdx)?.title || `第 ${curStageIdx} 阶段`,
            laterStages: laterStages.map(s => ({
                stageIdx: Number(s.stageIdx) || 0,
                title: s.title || '',
                nodes: (s.nodes || []).filter(n => !n.done).slice(0, 6).map(n => n.title),
            })),
            paused: S.tbPaused === true,
            advancing: S.tbAdvancing === true,
        };
    }
    window.niTbGetOffscreenContext = niTbGetOffscreenContext;

    /** 把后台动向渲染到状态栏里（和弹窗共用同一份 S.tbOffscreen 数据）。 */
    function niTbRenderOffscreenBar() {
        const listEl = niTbById('ni-tb-off-list');
        if (!listEl) return;
        const cfg = extension_settings[EXT_NAME] || {};
        const st = niTbGetOffscreenState();
        const enabled = cfg.tbOffscreenEnabled === true;
        const threads = st.threads || [];
        const countEl = niTbById('ni-tb-off-count');
        if (countEl) countEl.textContent = enabled ? ` ${threads.length} 条` : '';
        niTbById('ni-tb-off-block')?.classList.toggle('ni-tb-off-disabled', !enabled);

        if (!enabled) {
            listEl.innerHTML = '<div class="ni-tb-off-empty">未开启。点右上「推演」可直接跑一次，或到注入策略里开启后台动向。</div>';
            return;
        }
        if (!threads.length) {
            listEl.innerHTML = `<div class="ni-tb-off-empty">${st.lastRunAt ? '上一次没推演出新动向。' : '还没有其他视角的动向。'}点右上「推演」试一次。</div>`;
            return;
        }
        listEl.innerHTML = threads.map((t, i) => `
          <div class="ni-tb-off-item">
            <div class="ni-tb-off-item-head">
              <span class="ni-tb-off-sub">${niEsc(t.subject || '其他视角')}</span>
              ${t.stageIdx ? `<span class="ni-tb-off-stage">第 ${Number(t.stageIdx)} 阶段</span>` : ''}
              <span class="ni-tb-off-del" data-ni-off-idx="${i}" title="删除这条">×</span>
            </div>
            <div class="ni-tb-off-sum">${niEsc(t.summary || '')}</div>
          </div>`).join('');
    }
    window.niTbRenderOffscreenBar = niTbRenderOffscreenBar;
    
    async function niTbUnarchive(idx, nodes = null) {
        const list = Array.isArray(nodes) ? nodes : niGetTbNodes();
        const node  = list[idx];
        if (!node) return;
        S.tbNodeDone[node.id] = false;
        node.done = false;
        if (node.legacyId && node.legacyId !== node.id) delete S.tbNodeDone[node.legacyId];
        // 取消归档：清除以该节点为起点的已发送记录，下次完成时重新发首次提示词
        for (const key of _tbAdvanceSent) {
            if (key.startsWith(`${node.id}->`)) _tbAdvanceSent.delete(key);
        }
        document.getElementById(`ni-tb-chk${idx}`)?.classList.remove('checked');
        document.getElementById(`ni-tb-card${idx}`)?.classList.remove('done');
        const updatedSnapshot = niCreateTbSnapshot();
        niTbRefreshNodePanel(updatedSnapshot.nodes);
        niTbSyncStoryBar(updatedSnapshot);
        await niTbSaveState(updatedSnapshot.nodes);
    }
    
    function niTbShowStageDone(stageIdx, stages = null) {
        const track = niTbById('ni-tb-track');
        // 状态栏可能已经收起/被移除：此处只做「有就显示」的提示，不能因为缺 DOM 抛错，
        // 否则会把调用方（勾选归档、一键推进）一起带进 catch。
        if (!track || !track.parentElement?.insertAdjacentElement) return;
        const list     = Array.isArray(stages) ? stages : niGetTbStages();
        const st       = list.find(s => s.stageIdx === stageIdx);
        const existing = niTbById('ni-tb-stage-done-badge');
        if (existing) existing.remove();
        const badge = document.createElement('div');
        badge.id        = 'ni-tb-stage-done-badge';
        badge.className = 'ni-tb-stage-done-badge';
        badge.innerHTML = `<i class="ti ti-circle-check" style="color:var(--ni-warning, #c05a62)"></i> 「${niEsc(st ? st.title : `第 ${stageIdx} 阶段`)}」本阶段已全部完成`;
        track.parentElement.insertAdjacentElement('afterend', badge);
    }
    
    // ── AI 推进提示词注入 ────────────────────────────────────────
    
    // 待注入的推进提示词
    let _tbPendingAdvancePrompt = '';
    // 已发送过首次激活提示词的节点对 key 集合
    const _tbAdvanceSent = new Set();
    
    function niTbWriteAdvancePrompt(nodeA, nodeB) {
        const sentKey = `${nodeA.id}->${nodeB.id}`;
        if (_tbAdvanceSent.has(sentKey)) {
            console.log('[NI-TB] 推进提示词已发送过，跳过重复注入');
            return;
        }
        _tbAdvanceSent.add(sentKey);
        const cfg = extension_settings[EXT_NAME];
        const tpl = (cfg.tbAdvancePrompt || TB_DEFAULT_ADVANCE_PROMPT).trim();
        _tbPendingAdvancePrompt = tpl
            .replace(/{A_TITLE}/g,    nodeA.title)
            .replace(/{B_TITLE}/g,    nodeB.title)
            .replace(/{B_BODY}/g,     nodeB.body      || '（暂无描述）')
            .replace(/{B_TIME}/g,     nodeB.time      || '不限')
            .replace(/{B_LOCATION}/g, nodeB.location  || '不限');
        console.log('[NI-TB] 推进提示词已就绪，等待下次发送生效');
    }
    
    // 开场提示词：故事最开始时注入
    function niTbWriteOpeningPrompt() {
        if (_tbAdvanceSent.has('__opening__')) return;
        _tbAdvanceSent.add('__opening__');
        const cfg = extension_settings[EXT_NAME];
        const nodes = niGetTbNodes();
        const firstNode = nodes.find(n => !n.done && !n.locked);
        if (!firstNode) return;
        const tpl = (cfg.tbOpeningPrompt || TB_DEFAULT_OPENING_PROMPT).trim();
        _tbPendingAdvancePrompt = tpl
            .replace(/{B_TITLE}/g,    firstNode.title)
            .replace(/{B_BODY}/g,     firstNode.body      || '（暂无描述）')
            .replace(/{B_TIME}/g,     firstNode.time      || '不限')
            .replace(/{B_LOCATION}/g, firstNode.location  || '不限');
        console.log('[NI-TB] 开场提示词已就绪，等待下次发送生效');
    }
    
    // ── 自由推演 ─────────────────────────────────────────────────
    
    async function niTbGenerateInfer() {
        if (S.tbInferring) return;
        S.tbInferring = true;
    
        const btn       = niTbById('ni-tb-btn-free');
        const icon      = niTbById('ni-tb-free-icon');
        const label     = niTbById('ni-tb-free-label');
        const inferBlock = niTbById('ni-tb-infer-block');
        const inferList  = niTbById('ni-tb-infer-list');
    
        if (btn)  { btn.classList.add('loading'); btn.classList.remove('has-result'); }
        if (icon) icon.className = 'ti ti-loader ni-tb-spin';
        if (label) label.textContent = '推演中';
        if (inferBlock) inferBlock.classList.remove('vis');
        if (inferList)  { inferList.classList.remove('vis'); inferList.innerHTML = ''; }
    
        try {
            const cfg   = extension_settings[EXT_NAME];
            const nodes = niGetTbNodes();
            const ctx   = getContext();

            // 当前节点
            const curNode = niTbGetInjectionNode(nodes) || nodes[0] || { title: '（未知）', body: '' };
    
            // 角色人设
            const userSubCfg = niGetUserSubConfig();
            const charLines = (S.characters || [])
                .map((c, idx) => ({ c, idx }))
                .filter(({ c, idx }) => c.enabled !== false && c.name && !niIsUserSubReplaceSelectedChar(idx, userSubCfg))
                .slice(0, 8)
                .map(({ c, idx }) => {
                    const isUserSubPlayChar = niIsUserSubSelectedChar(idx, userSubCfg) && niIsUserSubPlayMode(userSubCfg);
                    const parts = [isUserSubPlayChar
                        ? `【<user>（原著角色：${c.name}；${c.role || '其他'}）】`
                        : `【${c.name}（${c.role || '其他'}）】`];
                    const p = niGetCharAiShowEnabled(idx) ? niGetCharAiProfile(idx) : null;
                    if (p && typeof p === 'object') {
                        if (p.identity)    parts.push(`身份：${p.identity}`);
                        if (p.personality) parts.push(`性格：${p.personality}`);
                        if (p.relations)   parts.push(`关系：${p.relations}`);
                    } else {
                        if (c.identity)    parts.push(`身份：${c.identity}`);
                        if (c.personality) parts.push(`性格：${c.personality}`);
                        if (c.relations)   parts.push(`关系：${c.relations}`);
                    }
                    return parts.join('\n');
                });
            const charProfiles = charLines.length
                ? charLines.join('\n\n')
                : '（暂无角色人设数据，请在角色页配置）';
    
            // 最近对话
            const recentMsgs = (ctx?.chat || [])
                .filter(m => m.mes && m.mes.trim())
                .slice(-8)
                .map(m => `${m.is_user ? '[用户]' : '[AI]'} ${m.mes.trim()}`)
                .join('\n');
            const recentChat = recentMsgs || '（暂无对话记录）';
    
            const tpl = (cfg.tbInferPrompt || TB_DEFAULT_INFER_PROMPT).trim();
            const prompt = tpl
                .replace('{CUR_NODE_TITLE}', curNode.title)
                .replace('{CUR_NODE_BODY}',  curNode.body || '（暂无描述）')
                .replace('{CHAR_PROFILES}',  charProfiles)
                .replace('{RECENT_CHAT}',    recentChat)
                .replace('{MSG_COUNT}',      String(recentMsgs.split('\n').length))
                + niTbGetImmersionAppend(cfg);

            if (inferBlock) {
                inferBlock.dataset.sourceNodeId = curNode.id || '';
                inferBlock.dataset.sourceNodeTitle = curNode.title || '';
            }
    
            const raw = await callCleanApi([{ role: 'user', content: niApplyUserSubstitution(prompt) }]);
    
            // 解析 JSON，兼容带 ```json 包裹的情况
            let data;
            try {
                const cleaned = raw.replace(/```json|```/gi, '').trim();
                data = JSON.parse(cleaned);
            } catch (pe) {
                throw new Error('推演结果解析失败：' + pe.message);
            }
    
            if (!Array.isArray(data)) throw new Error('返回格式不是数组');
            data = data.map(item => ({
                ...item,
                title: niApplyUserSubstitution(item.title || ''),
                desc: niApplyUserSubstitution(item.desc || item.description || ''),
                description: niApplyUserSubstitution(item.description || item.desc || ''),
            }));
    
            // 保存结果供弹窗读取
            S.tbLastInfer = data;
    
            if (inferList) {
                inferList.innerHTML = '';
                data.forEach((d, i) => {
                    const item = document.createElement('div');
                    item.className = 'ni-tb-infer-item ni-tb-fade-in';
                    item.dataset.desc = d.desc || d.description || '';
                    item.innerHTML = `
                      <div class="ni-tb-infer-num">${i + 1}</div>
                      <div class="ni-tb-infer-content">
                        <span class="ni-tb-infer-tag ni-tb-tag-${niEsc(d.tag || 'canon')}">${niEsc(d.tagLabel || d.tag)}</span>
                        <div class="ni-tb-infer-title">${niEsc(d.title)}</div>
                        <div class="ni-tb-infer-desc">${niEsc(d.desc)}</div>
                      </div>`;
                    inferList.appendChild(item);
                });
                inferList.classList.add('vis');
            }
    
            if (inferBlock) inferBlock.classList.add('vis');
            if (btn)  { btn.classList.remove('loading'); btn.classList.add('has-result'); }
            if (icon) icon.className = 'ti ti-refresh';
            if (label) label.textContent = '推演';
    
        } catch (err) {
            console.error('[NI-TB] 推演失败:', err);
            if (inferList) {
                inferList.innerHTML = `<div style="padding:14px 16px;font-size:12px;color:var(--color-text-tertiary)">推演失败：${niEsc(err.message)}</div>`;
                inferList.classList.add('vis');
            }
            if (inferBlock) inferBlock.classList.add('vis');
            if (btn)  btn.classList.remove('loading');
            if (icon) icon.className = 'ti ti-chart-line';
            if (label) label.textContent = '推演';
        } finally {
            S.tbInferring = false;
        }
    }
    
    // ── 状态栏挂载 / 卸载 ────────────────────────────────────────
    
    // ── 将状态栏 CSS 注入到 document.head──────────
    function niTbInjectCSS() {
        if (niTbById('ni-tb-injected-css')) return;
        const style = document.createElement('style');
        style.id = 'ni-tb-injected-css';
        style.textContent = `.ni-tb-shell{background:var(--color-background-secondary,#f7f7f8);border-radius:16px;overflow:hidden;border:0.5px solid var(--color-border-tertiary,#e8e8ec);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif;user-select:none;margin:8px 0}
    .ni-tb-bar{display:flex;align-items:center;gap:6px;padding:9px 14px;cursor:pointer;background:var(--color-background-primary,#fff);border-bottom:0.5px solid transparent;transition:border-color .25s}
    .ni-tb-bar.open{border-bottom-color:var(--color-border-tertiary,#e8e8ec)}
    .ni-tb-pin{width:6px;height:6px;border-radius:50%;background:#e8848a;flex-shrink:0}
    .ni-tb-status{font-size:10px;font-weight:500;padding:1px 6px;border-radius:20px;background:var(--ni-warning-soft, #fde8ea);color:var(--ni-warning, #c05a62);flex-shrink:0;white-space:nowrap}
    .ni-tb-curtitle{font-size:13px;font-weight:500;color:var(--color-text-primary,#1a1a1a);flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .ni-tb-meta{font-size:10px;color:var(--color-text-tertiary,#9a9aaa);white-space:nowrap;flex-shrink:0}
    .ni-tb-chevron{font-size:14px;color:var(--color-text-tertiary,#9a9aaa);transition:transform .35s cubic-bezier(.34,1.56,.64,1);margin-left:2px;flex-shrink:0}
    .ni-tb-chevron.open{transform:rotate(180deg)}
    .ni-tb-body{max-height:0;overflow:hidden;transition:max-height .52s cubic-bezier(.4,0,.2,1)}
    .ni-tb-body.open{max-height:1400px}
    .ni-tb-selrow{display:flex;align-items:center;gap:8px;padding:0 16px;height:35px;box-sizing:border-box;background:var(--color-background-primary,#fff);flex-wrap:nowrap}
    .ni-tb-sel-btn{display:flex;align-items:center;gap:5px;padding:5px 11px;border-radius:20px;border:0.5px solid var(--color-border-secondary,#d8d8de);background:var(--color-background-secondary,#f7f7f8);font-size:11px;color:var(--color-text-secondary,#5a5a6a);cursor:pointer;transition:background .15s;white-space:nowrap;flex-shrink:0}
    .ni-tb-sel-btn:hover{background:var(--color-background-tertiary,#eeeeef)}
    .ni-tb-sel-sep{font-size:14px;color:var(--color-border-secondary,#d8d8de);flex-shrink:0}
    .ni-tb-sel-spacer{flex:1}
    .ni-tb-btn-free{display:flex;align-items:center;gap:4px;padding:5px 11px;border-radius:20px;border:0.5px solid var(--color-border-secondary,#d8d8de);background:var(--color-background-secondary,#f7f7f8);font-size:11px;color:var(--color-text-secondary,#5a5a6a);cursor:pointer;transition:all .2s;white-space:nowrap;flex-shrink:0}
    .ni-tb-btn-free:hover:not(.loading){background:var(--color-background-tertiary,#eeeeef)}
    .ni-tb-btn-free.loading{opacity:.6;pointer-events:none}
    .ni-tb-btn-free.has-result{border-color:var(--ni-warning-alpha-30, rgba(208,100,110,.3));background:var(--ni-warning-alpha-06, rgba(208,100,110,.06));color:var(--ni-warning, #c05a62)}
    .ni-tb-btn-free.has-result:hover{background:var(--ni-warning-alpha-12, rgba(208,100,110,.12))}
    .ni-tb-btn-pause{display:flex;align-items:center;gap:4px;padding:5px 11px;border-radius:20px;border:0.5px solid var(--ni-warning-alpha-25, rgba(208,100,110,.25));background:var(--ni-warning-alpha-06, rgba(208,100,110,.06));font-size:11px;color:var(--ni-warning, #c05a62);cursor:pointer;transition:background .15s;white-space:nowrap;flex-shrink:0}
    .ni-tb-btn-pause:hover{background:var(--ni-warning-alpha-12, rgba(208,100,110,.12))}
    .ni-tb-btn-pause.paused{background:var(--ni-warning-alpha-14, rgba(208,100,110,.14));border-color:var(--ni-warning-alpha-40, rgba(208,100,110,.4))}
    .ni-tb-drop-panel{display:none;background:var(--color-background-primary,#fff);border-top:0.5px solid var(--color-border-tertiary,#e8e8ec)}
    .ni-tb-drop-panel.vis{display:block}
    .ni-tb-sp-label{font-size:10px;color:var(--color-text-tertiary,#9a9aaa);letter-spacing:.06em;padding:8px 16px 4px;display:block}
    .ni-tb-sp-list{display:flex;flex-direction:column;padding-bottom:6px;max-height:141px;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--color-border-secondary,#d8d8de) var(--color-background-primary,#fff);box-sizing:border-box}
    .ni-tb-sp-list::-webkit-scrollbar{width:6px}
    .ni-tb-sp-list::-webkit-scrollbar-track{background:var(--color-background-primary,#fff);border-left:0.5px solid var(--color-border-tertiary,#e8e8ec)}
    .ni-tb-sp-list::-webkit-scrollbar-thumb{background:var(--color-border-secondary,#d8d8de);border-radius:6px;border:1px solid var(--color-background-primary,#fff)}
    .ni-tb-sp-list::-webkit-scrollbar-thumb:hover{background:var(--color-text-tertiary,#9a9aaa)}
    .ni-tb-sp-row{display:flex;align-items:center;gap:8px;padding:7px 16px;cursor:pointer;transition:background .15s}
    .ni-tb-sp-row:hover{background:var(--color-background-secondary,#f7f7f8)}
    .ni-tb-sp-row.active-stage .ni-tb-sp-name{color:var(--ni-warning, #c05a62);font-weight:500}
    .ni-tb-sp-row.active-stage .ni-tb-sp-dot{background:#e8848a}
    .ni-tb-sp-page.ni-list-pagination{position:sticky;top:0;z-index:2}
    .ni-tb-sp-dot{width:5px;height:5px;border-radius:50%;background:var(--color-border-secondary,#d8d8de);flex-shrink:0}
    .ni-tb-sp-name{font-size:12px;color:var(--color-text-secondary,#5a5a6a)}
    #ni-tb-node-panel{max-height:244px;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--color-border-secondary,#d8d8de) var(--color-background-primary,#fff)}
    #ni-tb-node-panel::-webkit-scrollbar{width:6px}
    #ni-tb-node-panel::-webkit-scrollbar-track{background:var(--color-background-primary,#fff);border-left:0.5px solid var(--color-border-tertiary,#e8e8ec)}
    #ni-tb-node-panel::-webkit-scrollbar-thumb{background:var(--color-border-secondary,#d8d8de);border-radius:6px;border:1px solid var(--color-background-primary,#fff)}
    #ni-tb-node-panel::-webkit-scrollbar-thumb:hover{background:var(--color-text-tertiary,#9a9aaa)}
    .ni-tb-section-hd{display:flex;align-items:center;gap:7px;padding:8px 16px;cursor:pointer;transition:background .15s;border-bottom:0.5px solid var(--color-border-tertiary,#e8e8ec)}
    .ni-tb-section-hd:hover{background:var(--color-background-secondary,#f7f7f8)}
    .ni-tb-section-icon{font-size:12px;color:var(--color-text-tertiary,#9a9aaa);transition:transform .2s;flex-shrink:0}
    .ni-tb-section-icon.open{transform:rotate(90deg)}
    .ni-tb-section-label{font-size:11px;font-weight:500;color:var(--color-text-secondary,#5a5a6a);flex:1}
    .ni-tb-section-count{font-size:10px;color:var(--color-text-tertiary,#9a9aaa);background:var(--color-background-secondary,#f7f7f8);padding:1px 7px;border-radius:20px;border:0.5px solid var(--color-border-tertiary,#e8e8ec)}
    .ni-tb-section-count.done-count{background:var(--ni-warning-soft, #fde8ea);color:var(--ni-warning, #c05a62);border-color:var(--ni-warning-alpha-20, rgba(208,100,110,.2))}
    .ni-tb-np-list{display:none;flex-direction:column;padding:4px 0}
    .ni-tb-np-list.vis{display:flex}
    .ni-tb-np-row{display:flex;align-items:center;gap:10px;padding:7px 16px 7px 32px;cursor:pointer;transition:background .15s}
    .ni-tb-np-row:hover{background:var(--color-background-secondary,#f7f7f8)}
    .ni-tb-np-row.active{background:var(--ni-warning-soft-2, #fff5f6)}
    .ni-tb-np-dot{width:5px;height:5px;border-radius:50%;flex-shrink:0}
    .ni-tb-np-dot.done{background:#e8848a}
    .ni-tb-np-dot.active-dot{background:#e8848a;box-shadow:0 0 0 3px rgba(232,132,138,.2)}
    .ni-tb-np-dot.todo{background:var(--color-border-secondary,#d8d8de)}
    .ni-tb-np-title{font-size:11px;color:var(--color-text-secondary,#5a5a6a);flex:1}
    .ni-tb-np-row.active .ni-tb-np-title{color:var(--color-text-primary,#1a1a1a);font-weight:500}
    .ni-tb-np-row.done-row .ni-tb-np-title{text-decoration:line-through;opacity:.45}
    .ni-tb-np-more{border:0;padding:8px 16px;background:transparent;color:var(--ni-warning,#c05a62);font-size:10px;cursor:pointer;text-align:center}
    .ni-tb-np-type{font-size:9px;padding:1px 5px;border-radius:8px;flex-shrink:0}
    .ni-tb-np-type.main{background:var(--ni-primary-soft, #F5E6EC);color:var(--ni-primary-soft-text, #8B3A50)}
    .ni-tb-np-type.sub{background:var(--ni-success-soft, #E1F5EE);color:var(--ni-success-text, #0F6E56)}
    .ni-tb-np-type.pivot{background:var(--ni-pivot-soft, #FCF7FB);color:var(--ni-pivot-text, #7C5071)}
    .ni-tb-carousel-wrap{padding:14px 0;background:var(--color-background-primary,#fff);border-top:0.5px solid var(--color-border-tertiary,#e8e8ec);position:relative;overflow:hidden;height:200px;transform:translateZ(0)}
    .ni-tb-track{position:absolute;top:0;left:0;height:100%;width:100%}
    .ni-tb-scard{position:absolute;top:14px;height:160px;border-radius:12px;border:0.5px solid var(--color-border-tertiary,#e8e8ec);background:var(--color-background-primary,#fff);padding:13px 14px;overflow:hidden;cursor:pointer;backface-visibility:hidden;transition:left .4s cubic-bezier(.4,0,.2,1),width .4s cubic-bezier(.4,0,.2,1),opacity .4s ease,box-shadow .3s,border-color .3s,background .3s}
    .ni-tb-scard.active{border-color:var(--ni-warning-alpha-35, rgba(208,100,110,.35));background:var(--ni-warning-soft-2, #fff9f9);box-shadow:0 6px 24px var(--ni-warning-alpha-14, rgba(208,100,110,.14));z-index:2;cursor:default;padding-top:3px;padding-bottom:3px;height:auto;min-height:166px}
    .ni-tb-scard.side-prev,.ni-tb-scard.side-next{opacity:.52;background:var(--color-background-secondary,#f7f7f8);z-index:1}
    .ni-tb-scard.far{opacity:.15;background:var(--color-background-secondary,#f7f7f8);z-index:0;pointer-events:none}
    .ni-tb-scard-overlay{display:none;position:absolute;inset:0;border-radius:12px;cursor:pointer;background:rgba(248,235,237,.72);flex-direction:column;align-items:center;justify-content:center;gap:4px;transition:background .2s}
    .ni-tb-scard.done .ni-tb-scard-overlay{display:flex}
    .ni-tb-scard-overlay:hover{background:rgba(242,218,220,.9)}
    .ni-tb-done-badge{font-size:10px;font-weight:500;color:var(--ni-warning, #c05a62);background:var(--ni-warning-soft, #fde8ea);padding:3px 10px;border-radius:20px;border:0.5px solid var(--ni-warning-alpha-30, rgba(208,100,110,.3));pointer-events:none;transition:opacity .2s}
    .ni-tb-unarchive-hint{font-size:9px;color:rgba(192,90,98,.65);opacity:0;transition:opacity .2s;pointer-events:none}
    .ni-tb-scard-overlay:hover .ni-tb-done-badge{opacity:.5}
    .ni-tb-scard-overlay:hover .ni-tb-unarchive-hint{opacity:1}
    .ni-tb-scard:not(.active) .ni-tb-sc-check{pointer-events:none;opacity:0}
    .ni-tb-scard:not(.active) .ni-tb-scard-overlay:hover{background:rgba(248,235,237,.72)}
    .ni-tb-sc-num{font-size:10px;color:var(--color-text-tertiary,#9a9aaa);margin-bottom:3px;display:flex;align-items:center;gap:4px;min-width:0;padding-right:28px;white-space:nowrap}
    .ni-tb-sc-num-meta{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--color-text-secondary,#5a5a6a)}
    .ni-tb-sc-type{display:inline-block;font-size:9px;font-weight:500;padding:1px 6px;border-radius:10px;margin-bottom:8px}
    .ni-tb-sc-type.main{background:var(--ni-primary-soft, #F5E6EC);color:var(--ni-primary-soft-text, #8B3A50)}
    .ni-tb-sc-type.sub{background:var(--ni-success-soft, #E1F5EE);color:var(--ni-success-text, #0F6E56)}
    .ni-tb-sc-type.pivot{background:var(--ni-pivot-soft, #FCF7FB);color:var(--ni-pivot-text, #7C5071)}
    .ni-tb-sc-title{font-size:12px;font-weight:500;color:var(--color-text-primary,#1a1a1a);line-height:1.4;margin-bottom:5px}
    .ni-tb-sc-desc{font-size:10px;color:var(--color-text-secondary,#5a5a6a);line-height:1.4;overflow:hidden}.ni-tb-sc-extras{display:flex;flex-direction:column;gap:1px;margin-top:3px;overflow:hidden}.ni-tb-sc-event,.ni-tb-sc-fore{display:flex;align-items:center;gap:2px;font-size:10px;line-height:1.35;color:var(--color-text-tertiary,#9a9aaa);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ni-tb-sc-event i{font-size:9px;color:var(--ni-warning-alpha-50, rgba(208,100,110,.5));flex-shrink:0}.ni-tb-sc-fore i{font-size:9px;color:rgba(120,100,200,.5);flex-shrink:0}
    .ni-tb-sc-check{position:absolute;top:10px;right:10px;width:15px;height:15px;border-radius:50%;border:0.5px solid rgba(160,68,94,.3);background:var(--color-background-secondary,#f7f7f8);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .2s;z-index:3}
    .ni-tb-sc-check.checked{background:var(--ni-warning-soft, #fde8ea);border-color:var(--ni-warning-alpha-50, rgba(208,100,110,.5))}
    .ni-tb-sc-check i{font-size:9px;color:transparent;transition:color .2s}
    .ni-tb-sc-check.checked i{color:var(--ni-primary, #A0445E)!important;text-shadow:none!important}
    .ni-tb-stage-done-badge{display:flex;align-items:center;justify-content:center;gap:5px;padding:10px 16px;font-size:11px;color:var(--ni-warning, #c05a62);background:var(--ni-warning-soft-2, #fff5f6);border-top:0.5px solid var(--ni-warning-alpha-15, rgba(208,100,110,.15))}
    .ni-tb-infer-block{display:none;flex-direction:column;background:var(--color-background-primary,#fff);border-top:0.5px solid var(--color-border-tertiary,#e8e8ec)}
    .ni-tb-infer-block.vis{display:flex}
    .ni-tb-infer-toggle{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;cursor:pointer;transition:background .15s;border-bottom:0.5px solid transparent}
    .ni-tb-infer-toggle.expanded{border-bottom-color:var(--color-border-tertiary,#e8e8ec)}
    .ni-tb-infer-toggle:hover{background:var(--color-background-secondary,#f7f7f8)}
    .ni-tb-infer-toggle-label{font-size:11px;color:var(--color-text-tertiary,#9a9aaa)}
    .ni-tb-infer-toggle-icon{font-size:14px;color:var(--color-text-tertiary,#9a9aaa);opacity:.5;transition:transform .25s cubic-bezier(.34,1.56,.64,1)}
    .ni-tb-infer-toggle-icon.expanded{transform:rotate(180deg)}
    .ni-tb-infer-list{display:none;flex-direction:column}
    .ni-tb-infer-list.vis{display:flex}
    /* 后台动向（其他视角） */
    .ni-tb-off-block{display:flex;flex-direction:column;background:var(--color-background-primary,#fff);border-top:0.5px solid var(--color-border-tertiary,#e8e8ec)}
    .ni-tb-off-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:9px 16px;cursor:pointer;transition:background .15s}
    .ni-tb-off-head:hover{background:var(--color-background-secondary,#f7f7f8)}
    .ni-tb-off-head.expanded{border-bottom:0.5px solid var(--color-border-tertiary,#e8e8ec)}
    .ni-tb-off-title{display:flex;align-items:center;gap:5px;font-size:11px;color:var(--color-text-tertiary,#9a9aaa);min-width:0}
    .ni-tb-off-title i{font-size:12px;opacity:.7}
    .ni-tb-off-ops{display:flex;align-items:center;gap:8px;flex-shrink:0}
    .ni-tb-off-run{font-size:10px;padding:2px 9px;border-radius:20px;border:0.5px solid var(--color-border-secondary,#d8d8de);color:var(--color-text-secondary,#5a5a6a);background:var(--color-background-primary,#fff);transition:background .15s,border-color .15s}
    .ni-tb-off-run:hover{background:var(--color-background-tertiary,#eeeeef);border-color:rgba(160,68,94,.3)}
    .ni-tb-off-chevron{font-size:14px;color:var(--color-text-tertiary,#9a9aaa);opacity:.5;transition:transform .25s cubic-bezier(.34,1.56,.64,1)}
    .ni-tb-off-chevron.open{transform:rotate(180deg)}
    .ni-tb-off-body{display:none;flex-direction:column;max-height:200px;overflow-y:auto;overscroll-behavior:contain}
    .ni-tb-off-body.vis{display:flex}
    .ni-tb-off-empty{padding:11px 16px;font-size:10px;line-height:1.5;color:var(--color-text-tertiary,#9a9aaa)}
    .ni-tb-off-item{padding:9px 16px 10px;border-bottom:0.5px solid var(--color-border-tertiary,#e8e8ec)}
    .ni-tb-off-item:last-child{border-bottom:none}
    .ni-tb-off-item-head{display:flex;align-items:center;gap:6px;margin-bottom:2px}
    .ni-tb-off-sub{font-size:11px;font-weight:500;color:var(--color-text-primary,#1a1a1a);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .ni-tb-off-stage{font-size:9px;padding:1px 6px;border-radius:10px;background:#F5E6EC;color:#8B3A50;flex-shrink:0}
    .ni-tb-off-del{margin-left:auto;font-size:14px;line-height:1;padding:0 2px;cursor:pointer;color:var(--color-text-tertiary,#9a9aaa);opacity:.55}
    .ni-tb-off-del:hover{opacity:1;color:#c05a62}
    .ni-tb-off-sum{font-size:10px;line-height:1.5;color:var(--color-text-secondary,#5a5a6a)}
    .ni-tb-infer-item{display:flex;align-items:flex-start;gap:12px;padding:13px 16px;border-bottom:0.5px solid var(--color-border-tertiary,#e8e8ec);transition:background .15s;cursor:pointer}
    .ni-tb-infer-item:last-child{border-bottom:none}
    .ni-tb-infer-item:hover{background:var(--color-background-secondary,#f7f7f8)}
    .ni-tb-infer-num{flex-shrink:0;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;background:var(--color-background-secondary,#f7f7f8);border:0.5px solid var(--color-border-secondary,#d8d8de);color:var(--color-text-tertiary,#9a9aaa);margin-top:1px}
    .ni-tb-infer-content{flex:1;min-width:0}
    .ni-tb-infer-tag{display:inline-block;font-size:9px;font-weight:500;padding:1px 7px;border-radius:10px;margin-bottom:5px}
    .ni-tb-tag-canon{background:#eef5ff;color:#185fa5}
    .ni-tb-tag-diverge{background:#fff8e6;color:#854f0b}
    .ni-tb-tag-break{background:var(--ni-warning-soft, #fde8ea);color:var(--ni-warning, #c05a62)}
    .ni-tb-infer-title{font-size:12px;font-weight:500;color:var(--color-text-primary,#1a1a1a);margin-bottom:4px;line-height:1.4}
    .ni-tb-infer-desc{font-size:11px;color:var(--color-text-secondary,#5a5a6a);line-height:1.6}
    .ni-tb-icon-only{padding:5px 10px !important;min-width:32px;justify-content:center}
    .ni-tb-btn-juadvise{display:flex;align-items:center;gap:4px;padding:5px 10px;border-radius:20px;border:0.5px dashed var(--color-border-secondary,#d8d8de);background:transparent;font-size:10px;color:var(--color-text-tertiary,#9a9aaa);white-space:nowrap;flex-shrink:0}
    .ni-tb-btn-juadvise.active{color:var(--ni-primary, #A0445E);border-color:var(--ni-primary, #A0445E);border-style:solid;background:var(--ni-primary-soft, #F5E6EC);opacity:.9;cursor:default}
    @keyframes ni-tb-spin{to{transform:rotate(360deg)}}
    .ni-tb-spin{animation:ni-tb-spin .8s linear infinite}
    @keyframes ni-tb-fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
    .ni-tb-fade-in{animation:ni-tb-fadeUp .32s ease both}
    .ni-tb-fade-in:nth-child(1){animation-delay:.04s}
    .ni-tb-fade-in:nth-child(2){animation-delay:.14s}
    .ni-tb-fade-in:nth-child(3){animation-delay:.24s}`;
        document.head.appendChild(style);
    }
    
    function niTbClearLazyPanels() {
        const stageList = niTbById('ni-tb-stage-list');
        const nodePanel = niTbById('ni-tb-node-panel');
        const track = niTbById('ni-tb-track');
        if (stageList) stageList.innerHTML = '';
        if (nodePanel) nodePanel.innerHTML = '';
        if (track) track.innerHTML = '';
        _tbNodePanelStageIdx = null;
        _tbNodePanelLimits.done = TB_NODE_BATCH_SIZE;
        _tbNodePanelLimits.todo = TB_NODE_BATCH_SIZE;
    }

    function niTbCollapseStoryBar({ clearLazy = false } = {}) {
        if (document.getElementById('ni-storybar')?.tagName === 'NI-STORYBAR') _niTbOpen = false;
        niTbById('ni-tb-body-wrap')?.classList.remove('open');
        niTbById('ni-tb-bar')?.classList.remove('open');
        niTbById('ni-tb-chevron')?.classList.remove('open');
        niTbById('ni-tb-stage-panel')?.classList.remove('vis');
        niTbById('ni-tb-node-panel')?.classList.remove('vis');
        if (clearLazy) niTbClearLazyPanels();
    }

    function niTbSyncStoryBar(snapshot) {
        const nodes = snapshot?.nodes || [];
        if (!nodes.length) return;
        if (document.getElementById('ni-storybar')?.tagName === 'NI-STORYBAR') {
            niTbPaintStoryBar(snapshot);
            return;
        }
        niTbReconcileCurrentNode(nodes);
        const curNode = nodes[S.tbCurIdx] || nodes[0];
        const viewNode = nodes[S.tbViewIdx] || curNode;
        const stageView = niTbStageView(nodes, S.tbViewIdx);
        const status = niTbById('ni-tb-status-el');
        if (status) status.textContent = snapshot.doneCount === nodes.length ? '全部完成' : '进行中';
        const title = niTbById('ni-tb-curtitle');
        const meta = niTbById('ni-tb-meta');
        if (title) title.textContent = viewNode?.title || '（未命名）';
        if (meta) meta.textContent = `节点 ${stageView.curIdx + 1} / ${stageView.nodes.length}`;
    }

    function niTbRenderStoryBar({ resetView = false } = {}) {
        niTbInjectCSS(); // 确保样式已注入到 document.head
        const cfg = extension_settings[EXT_NAME];
        if (!cfg?.transBookMode) return;
        if (!S.stageMapN || S.stageMapN <= 0) return;
        // 如果状态栏显示未开启，移除旧实例并退出
        if (!cfg?.tbDisplayStatusbar) {
            document.getElementById('ni-storybar')?.remove();
            return;
        }

        const snapshot = niCreateTbSnapshot();
        if (!snapshot.nodes.length) {
            document.getElementById('ni-storybar')?.remove();
            return;
        }
        if (resetView) niTbResetViewToCurrent(snapshot.nodes);
    
        // 找最后一条 AI 消息的.mes_text
        // 长对话里 querySelectorAll('.mes') 会把整段历史 DOM 全扫一遍；这里从最后一条
        // 消息的 mesid 往前找，通常第一条就命中，避免每条消息都全量遍历。
        const niFindLastAiMes = () => {
            const chatEl = document.getElementById('chat');
            if (!chatEl) return null;
            const mesEls = chatEl.querySelectorAll(':scope > .mes[id]');
            for (let i = mesEls.length - 1; i >= 0; i--) {
                const m = mesEls[i];
                if (m.getAttribute('is_user') === 'false' || m.classList.contains('assistant')) return m;
            }
            return null;
        };
        let lastAiMes = niFindLastAiMes();
        if (!lastAiMes) {
            const allMes = document.querySelectorAll('.mes');
            for (let i = allMes.length - 1; i >= 0; i--) {
                const m = allMes[i];
                if (m.getAttribute('is_user') === 'false' || m.classList.contains('assistant')) {
                    lastAiMes = m; break;
                }
            }
        }
        const mesText = lastAiMes?.querySelector('.mes_text') || null;
        const chat = document.getElementById('chat');
        let storybar = document.getElementById('ni-storybar');
        if (!storybar) {
            const html = niGetTbStoryBarHtml(snapshot);
            if (mesText) mesText.insertAdjacentHTML('afterend', html);
            else if (chat) chat.insertAdjacentHTML('beforeend', html);
            storybar = document.getElementById('ni-storybar');
        } else if (mesText?.insertAdjacentElement) {
            mesText.insertAdjacentElement('afterend', storybar);
        } else if (chat && storybar.parentElement !== chat) {
            chat.appendChild(storybar);
        }
        if (!storybar) return;

        // 以前这里无条件 niTbCollapseStoryBar({ clearLazy: true })：每条消息渲染后
        // （index.js 的 MESSAGE_RENDERED 钩子）用户刚展开的状态栏就会被收起，
        // 分页/节点列表/懒加载内容一起被清空。现在沿用用户当前的开合状态，
        // 只有收起时才清理懒加载，展开时则就地刷新卡片。
        const isV2Bar = storybar.tagName === 'NI-STORYBAR';
        const barBody = isV2Bar ? null : niTbById('ni-tb-body-wrap');
        const keepOpen = isV2Bar ? _niTbOpen : (barBody?.classList.contains('open') === true);
        if (!keepOpen) {
            niTbCollapseStoryBar({ clearLazy: true });
        }
        niTbSyncStoryBar(snapshot);
        niTbRenderOffscreenBar();
        if (keepOpen && !isV2Bar) {
            // 保持展开时也要就地刷新：轮次卡片重画，阶段列表按用户当前翻到的页重建
            // （不 alignActive，否则每来一条消息就把用户翻的页拽回当前阶段）。
            try {
                niTbBuildTrack(snapshot.nodes);
                niTbRebuildStageList(snapshot, { alignActive: false });
            } catch (e) {
                console.warn('[NI] 状态栏刷新失败:', e);
            }
        }
        if (storybar.tagName === 'NI-STORYBAR') {
            niTbPaintStoryBar(snapshot);
            niTbBindBarAct();
        } else if (storybar.dataset.niTbBound !== '1') {
            niTbBindEvents();
            storybar.dataset.niTbBound = '1';
        }
        niRefreshStorybarTheme();
        niTbSyncPauseUI();
        niTbSyncAutoAdvanceUI();
    }
    
    function niRefreshStorybarTheme(themeDraft = null) {
        const cfg = extension_settings[EXT_NAME] || {};
        niApplyStatusbarTheme(themeDraft ? { ...cfg, ...themeDraft } : cfg);
    }
    
    // ── 事件绑定 ─────────────────────────────────────────────────

    function niTbBindEvents() {
        niTbBindBarEvents();
        niTbBindNodePanelEvents();
    }

    function niTbBindBarEvents() {
        const on = (id, ev, fn) => document.getElementById(id)?.addEventListener(ev, fn);

        // 顶栏展开/收起
        on('ni-tb-bar', 'click', () => {
            const bar  = niTbById('ni-tb-bar');
            const body = niTbById('ni-tb-body-wrap');
            const chev = niTbById('ni-tb-chevron');
            const isOpen = body?.classList.toggle('open');
            bar?.classList.toggle('open', isOpen);
            chev?.classList.toggle('open', isOpen);
            if (isOpen) {
                const renderOpenTrack = () => {
                    if (niTbById('ni-tb-body-wrap') !== body || !body?.classList.contains('open')) return;
                    niTbBuildTrack(niCreateTbSnapshot().nodes);
                };
                // 首次展开立即填充卡片，避免只能靠重选阶段触发渲染；动画展开后再校正一次位置。
                renderOpenTrack();
                setTimeout(renderOpenTrack, 60);
                // Edge/Chromium 在毛玻璃(backdrop-filter)祖先内偶发不绘制 absolute 子树；
                // 展开动画结束后轻推合成层强制重绘一次
                setTimeout(() => {
                    const wrapEl = niTbById('ni-tb-wrap');
                    if (!wrapEl) return;
                    wrapEl.style.transform = 'translateZ(0) scale(1)';
                    requestAnimationFrame(() => { wrapEl.style.transform = ''; });
                }, 700);
            } else {
                niTbCollapseStoryBar({ clearLazy: true });
            }
        });
    
        // 阶段按钮
        on('ni-tb-stage-btn', 'click', (e) => {
            e.stopPropagation();
            const visible = niTbToggleDropPanel('ni-tb-stage-panel', 'ni-tb-node-panel');
            if (visible) {
                const snapshot = niCreateTbSnapshot();
                niTbRebuildStageList(snapshot, { alignActive: true });
            }
        });
    
        // 节点按钮
        on('ni-tb-node-btn', 'click', (e) => {
            e.stopPropagation();
            const visible = niTbToggleDropPanel('ni-tb-node-panel', 'ni-tb-stage-panel');
            if (visible) {
                const snapshot = niCreateTbSnapshot();
                niTbRefreshNodePanel(snapshot.nodes);
            }
        });
    
        // 推演按钮
        on('ni-tb-btn-free', 'click', (e) => {
            e.stopPropagation();
            niTbGenerateInfer();
        });

        // 暂停/恢复按钮
        on('ni-tb-btn-pause', 'click', (e) => {
            e.stopPropagation();
            niTbTogglePaused();
        });

        // 自动推进徽标：点一下立刻判定一次，并把判定依据说出来（排查「不生效」用）
        on('ni-tb-btn-auto-adv', 'click', (e) => {
            e.stopPropagation();
            window.niTbForceJudge?.();
        });
    
        // 推演折叠
        on('ni-tb-infer-toggle', 'click', () => {
            const list    = niTbById('ni-tb-infer-list');
            const toggle  = niTbById('ni-tb-infer-toggle');
            const togIcon = niTbById('ni-tb-infer-toggle-icon');
            const expanded = list?.classList.toggle('vis');
            toggle?.classList.toggle('expanded', expanded);
            togIcon?.classList.toggle('expanded', expanded);
        });

        // 后台动向：展开/收起
        on('ni-tb-off-toggle', 'click', (e) => {
            if (e?.target?.closest?.('#ni-tb-off-run')) return;
            const body = niTbById('ni-tb-off-body');
            const open = body?.classList.toggle('vis');
            niTbById('ni-tb-off-toggle')?.classList.toggle('expanded', open);
            niTbById('ni-tb-off-chevron')?.classList.toggle('open', open);
            if (open) niTbRenderOffscreenBar();
        });

        // 后台动向：手动推演一轮
        on('ni-tb-off-run', 'click', async (e) => {
            e.stopPropagation();
            const btn = e.currentTarget;
            if (btn?.dataset.niBusy === '1') return;
            if (btn) { btn.dataset.niBusy = '1'; btn.textContent = '推演中…'; }
            try {
                await window.niRunOffscreenSimulation?.({ reason: 'manual', silent: false });
            } catch (err) {
                console.warn('[NI] 后台动向推演失败:', err);
            } finally {
                if (btn) { delete btn.dataset.niBusy; btn.textContent = '推演'; }
                niTbRenderOffscreenBar();
            }
        });

        // 后台动向：删除单条
        niTbById('ni-tb-off-list')?.addEventListener('click', (e) => {
            const del = e.target.closest('[data-ni-off-idx]');
            if (!del) return;
            e.stopPropagation();
            const idx = parseInt(del.dataset.niOffIdx, 10);
            const st = niTbGetOffscreenState();
            if (!Number.isFinite(idx) || idx < 0 || idx >= st.threads.length) return;
            const threads = st.threads.slice();
            threads.splice(idx, 1);
            niTbSetOffscreenState({ threads });
        });
    
        // 推演选项：点击整条填入输入框
        niTbById('ni-tb-infer-list')?.addEventListener('click', (e) => {
            const item = e.target.closest('.ni-tb-infer-item');
            if (!item) return;
            const desc = niApplyUserSubstitution(item.dataset.desc || '');
            const ta   = document.getElementById('send_textarea') || document.querySelector('#send_textarea');
            if (ta) {
                ta.value = desc;
                ta.dispatchEvent(new Event('input', { bubbles: true }));
                ta.focus();
            }
        });
    
        // 阶段列表点击
        niTbById('ni-tb-stage-panel')?.addEventListener('click', (e) => {
            const pageBtn = e.target.closest('.ni-tb-sp-page-btn');
            if (pageBtn && !pageBtn.disabled) {
                const nextPage = parseInt(pageBtn.dataset.page, 10);
                if (Number.isFinite(nextPage)) _tbStagePage = nextPage;
                niTbRebuildStageList(niCreateTbSnapshot());
                return;
            }
            const row = e.target.closest('.ni-tb-sp-row');
            if (!row) return;
            const si    = parseInt(row.dataset.si);
            const snapshot = niCreateTbSnapshot();
            const { nodes } = snapshot;
            const firstIdx = snapshot.firstNodeIndexByStage[si];
            if (firstIdx >= 0) {
                niTbSetCurrentIdx(firstIdx, nodes, { persist: true, archivePrior: true });
                // 跨阶段立即重建，避免旧动画的延迟移除误删新阶段卡片。
                niTbBuildTrack(nodes);
                niTbSyncMeta(nodes);
                niTbRefreshNodePanel(nodes);
            }
            niTbRebuildStageList(snapshot, { alignActive: true });
            niTbById('ni-tb-stage-panel')?.classList.remove('vis');
        });
        niTbById('ni-tb-stage-panel')?.addEventListener('change', (e) => {
            const target = e.target;
            if (target?.classList?.contains('ni-tb-sp-page-size')) {
                niTbSetStagePageSize(target.value);
            } else if (target?.classList?.contains('ni-tb-sp-page-current')) {
                const snapshot = niCreateTbSnapshot();
                _tbStagePage = niResolveTransbookStagePagination(snapshot.stages, {
                    page: target.value,
                    pageSize: niTbGetStagePageSize(),
                }).page;
                niTbRebuildStageList(snapshot);
            }
        });
        niTbById('ni-tb-stage-panel')?.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            const target = e.target;
            if (!target?.classList?.contains('ni-tb-sp-page-size') && !target?.classList?.contains('ni-tb-sp-page-current')) return;
            e.preventDefault();
            if (target.classList.contains('ni-tb-sp-page-size')) niTbSetStagePageSize(target.value);
            else {
                const snapshot = niCreateTbSnapshot();
                _tbStagePage = niResolveTransbookStagePagination(snapshot.stages, {
                    page: target.value,
                    pageSize: niTbGetStagePageSize(),
                }).page;
                niTbRebuildStageList(snapshot);
            }
        });
    }
    
    function niTbBindNodePanelEvents() {
        const panel = niTbById('ni-tb-node-panel');
        if (!panel || panel.dataset.niTbBound === '1') return;
        panel.dataset.niTbBound = '1';
        panel.addEventListener('click', (e) => {
            const snapshot = niCreateTbSnapshot();
            const more = e.target.closest('.ni-tb-np-more');
            if (more) {
                const sec = more.dataset.sec;
                if (sec === 'done' || sec === 'todo') {
                    _tbNodePanelLimits[sec] += TB_NODE_BATCH_SIZE;
                    niTbRefreshNodePanel(snapshot.nodes);
                }
                return;
            }

            const hd = e.target.closest('.ni-tb-section-hd');
            if (hd) {
                const sec = hd.dataset.sec;
                S.tbSectionOpen[sec] = !S.tbSectionOpen[sec];
                niTbRefreshNodePanel(snapshot.nodes);
                return;
            }

            const row = e.target.closest('.ni-tb-np-row');
            if (!row) return;
            const ni = parseInt(row.dataset.ni);
            if (isNaN(ni) || ni < 0 || ni >= snapshot.nodes.length) return;
            niTbSetCurrentIdx(ni, snapshot.nodes, { persist: true, archivePrior: true });
            niTbAnimateTo(ni, snapshot.nodes);
            niTbSyncMeta(snapshot.nodes);
            niTbRefreshNodePanel(snapshot.nodes);
            niTbById('ni-tb-node-panel')?.classList.remove('vis');
        });
    }
    
    function niTbToggleDropPanel(showId, hideId) {
        const show = document.getElementById(showId);
        const hide = document.getElementById(hideId);
        hide?.classList.remove('vis');
        return !!show?.classList.toggle('vis');
    }
    
    function niTbRebuildStageList(snapshot = null, { alignActive = false } = {}) {
        const runtime = snapshot?.nodes ? snapshot : niCreateTbSnapshot();
        const { nodes, stages } = runtime;
        const curNode = nodes[S.tbCurIdx];
        const list   = niTbById('ni-tb-stage-list');
        if (!list) return;
        const pagination = niResolveTransbookStagePagination(stages, {
            page: _tbStagePage,
            pageSize: niTbGetStagePageSize(),
            activeStageIdx: curNode?.stageIdx,
            alignActive,
        });
        _tbStagePage = pagination.page;
        list.innerHTML = niTbBuildStageListHtml(pagination.items, curNode?.stageIdx, pagination);
        niRefreshStorybarTheme();
    }
    
    // ── Settings 页 UI 绑定 ───────────────────────────────────────
    
    // 防止多次打开设置页时重复绑定事件监听器
    let _niTbUIBound = false;
    
    function niTbInitSettingsUI() {
        const cfg = extension_settings[EXT_NAME];
        if (niUpgradeLegacyTbDefaultPrompts(cfg)) saveSettingsDebounced();
    
        // 穿书模式 UI 绑定
        if (!_niTbUIBound) {
            // 设置面板按钮 & 提示词面板按钮
            const $appTb = typeof $ !== 'undefined' ? $(document.getElementById('ni-app') || document) : null;
            if ($appTb) {
                $appTb.on('click', '#ni-tb-cfg-btn', () => niTogglePanel('ni-tb-cfg-panel', 'ni-tb-cfg-btn'));
                $appTb.on('click', '#ni-tb-prompt-btn', () => niTogglePanel('ni-tb-pb', 'ni-tb-prompt-btn'));
            } else {
                document.addEventListener('click', e => {
                    if (e.target.closest('#ni-tb-cfg-btn'))    niTogglePanel('ni-tb-cfg-panel', 'ni-tb-cfg-btn');
                    if (e.target.closest('#ni-tb-prompt-btn')) niTogglePanel('ni-tb-pb', 'ni-tb-prompt-btn');
                });
            }
    
            // 设置项：状态栏
            niTbById('ni-tb-display-statusbar')?.addEventListener('change', function () {
                extension_settings[EXT_NAME].tbDisplayStatusbar = this.checked;
                if (this.checked) {
                    // 关闭弹窗选项
                    extension_settings[EXT_NAME].tbDisplayPopup = false;
                    const popupChk = niTbById('ni-tb-display-popup');
                    if (popupChk) popupChk.checked = false;
                    if (typeof niPopSetVisible === 'function') niPopSetVisible(false);
                }
                // 根据新设置重新渲染状态栏
                if (this.checked) {
                    niTbRenderStoryBar();
                } else {
                    document.getElementById('ni-storybar')?.remove();
                }
                saveSettingsDebounced();
            });
    
            // 设置项：弹窗
            niTbById('ni-tb-display-popup')?.addEventListener('change', function () {
                extension_settings[EXT_NAME].tbDisplayPopup = this.checked;
                if (this.checked) {
                    // 关闭状态栏选项，并移除状态栏
                    extension_settings[EXT_NAME].tbDisplayStatusbar = false;
                    const statusbarChk = niTbById('ni-tb-display-statusbar');
                    if (statusbarChk) statusbarChk.checked = false;
                    document.getElementById('ni-storybar')?.remove();
                }
                if (typeof niPopSyncVisibility === 'function') niPopSyncVisibility();
                saveSettingsDebounced();
            });
    
            // 设置项：自动推进（模型判定节点是否演完）
            const autoAdvChk = niTbById('ni-tb-auto-advance');
            if (autoAdvChk) {
                autoAdvChk.addEventListener('change', function () {
                    extension_settings[EXT_NAME].tbAutoAdvance = !!this.checked;
                    niTbSyncAutoAdvanceUI();
                    saveSettingsDebounced();
                });
            }
            const autoCrossChk = niTbById('ni-tb-auto-cross-stage');
            if (autoCrossChk) {
                autoCrossChk.addEventListener('change', function () {
                    extension_settings[EXT_NAME].tbAutoAdvanceCrossStage = !!this.checked;
                    saveSettingsDebounced();
                });
            }
            const autoModelSel = niTbById('ni-tb-auto-advance-model');
            if (autoModelSel) {
                autoModelSel.addEventListener('change', function () {
                    extension_settings[EXT_NAME].tbAutoAdvanceModel = this.value === 'plugin' ? 'plugin' : 'current';
                    saveSettingsDebounced();
                });
            }
            const autoEveryEl = niTbById('ni-tb-auto-advance-every');
            if (autoEveryEl) {
                autoEveryEl.addEventListener('change', function () {
                    const n = parseInt(this.value, 10);
                    const v = Number.isFinite(n) ? Math.min(10, Math.max(1, n)) : 1;
                    this.value = String(v);
                    extension_settings[EXT_NAME].tbAutoAdvanceEvery = v;
                    saveSettingsDebounced();
                });
            }
            const autoThrEl = niTbById('ni-tb-auto-advance-threshold');
            if (autoThrEl) {
                autoThrEl.addEventListener('change', function () {
                    const n = parseFloat(this.value);
                    const v = Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.7;
                    this.value = v.toFixed(2);
                    extension_settings[EXT_NAME].tbAutoAdvanceThreshold = v;
                    saveSettingsDebounced();
                });
            }
            const judgeEl = niTbById('ni-tb-advance-judge-prompt');
            if (judgeEl) {
                judgeEl.addEventListener('input', function () {
                    extension_settings[EXT_NAME].tbAutoAdvancePrompt = this.value;
                    saveSettingsDebounced();
                });
            }
            niTbById('ni-tb-advance-judge-reset')?.addEventListener('click', () => {
                const el = niTbById('ni-tb-advance-judge-prompt');
                const def = TB_DEFAULT_ADVANCE_JUDGE_PROMPT;
                if (el) el.value = def;
                extension_settings[EXT_NAME].tbAutoAdvancePrompt = def;
                saveSettingsDebounced();
            });

            // 穿书开关：监听 checkbox change 事件
            const tbChk = niTbById('ni-tb-chk');
            if (tbChk) {
                tbChk.addEventListener('change', function () {
                    extension_settings[EXT_NAME].tbRestoreAfterPluginEnable = false;
                    niSetTransBookMode(this.checked);
                    saveSettingsDebounced();
                });
            }
    
            // 推进提示词
            const advEl = niTbById('ni-tb-advance-prompt');
            if (advEl) {
                advEl.addEventListener('input', function () {
                    extension_settings[EXT_NAME].tbAdvancePrompt = this.value;
                    saveSettingsDebounced();
                });
            }
            niTbById('ni-tb-advance-reset')?.addEventListener('click', () => {
                const _advEl = niTbById('ni-tb-advance-prompt');
                if (_advEl) _advEl.value = TB_DEFAULT_ADVANCE_PROMPT;
                extension_settings[EXT_NAME].tbAdvancePrompt = TB_DEFAULT_ADVANCE_PROMPT;
                saveSettingsDebounced();
            });

            // 持续提示词
            const ongoingEl = niTbById('ni-tb-ongoing-prompt');
            if (ongoingEl) {
                ongoingEl.addEventListener('input', function () {
                    extension_settings[EXT_NAME].tbOngoingPrompt = this.value;
                    saveSettingsDebounced();
                });
            }
            niTbById('ni-tb-ongoing-reset')?.addEventListener('click', () => {
                const _ongoingEl = niTbById('ni-tb-ongoing-prompt');
                if (_ongoingEl) _ongoingEl.value = TB_DEFAULT_ONGOING_PROMPT;
                extension_settings[EXT_NAME].tbOngoingPrompt = TB_DEFAULT_ONGOING_PROMPT;
                saveSettingsDebounced();
            });
    
            // 推演提示词
            const inferEl = niTbById('ni-tb-infer-prompt');
            if (inferEl) {
                inferEl.addEventListener('input', function () {
                    extension_settings[EXT_NAME].tbInferPrompt = this.value;
                    saveSettingsDebounced();
                });
            }
            niTbById('ni-tb-infer-reset')?.addEventListener('click', () => {
                const _inferEl = niTbById('ni-tb-infer-prompt');
                if (_inferEl) _inferEl.value = TB_DEFAULT_INFER_PROMPT;
                extension_settings[EXT_NAME].tbInferPrompt = TB_DEFAULT_INFER_PROMPT;
                saveSettingsDebounced();
            });
    
            // 沉浸提示词
            const immersionEl = niTbById('ni-tb-immersion-prompt');
            if (immersionEl) {
                immersionEl.addEventListener('input', function () {
                    extension_settings[EXT_NAME].tbImmersionPrompt = this.value;
                    saveSettingsDebounced();
                });
            }
            niTbById('ni-tb-immersion-reset')?.addEventListener('click', () => {
                const _immersionEl = niTbById('ni-tb-immersion-prompt');
                if (_immersionEl) _immersionEl.value = TB_DEFAULT_IMMERSION_PROMPT;
                extension_settings[EXT_NAME].tbImmersionPrompt = TB_DEFAULT_IMMERSION_PROMPT;
                saveSettingsDebounced();
            });
    
            niTbById('ni-tb-light-recall-mode')?.addEventListener('change', function () {
                extension_settings[EXT_NAME].tbLightRecallMode = this.checked;
                saveSettingsDebounced();
            });
    
            niTbById('ni-tb-immersion-mode')?.addEventListener('change', function () {
                extension_settings[EXT_NAME].tbImmersionMode = this.checked;
                saveSettingsDebounced();
            });
    
            _niTbUIBound = true;
        } // end if
    
        // ── 每次打开设置页都需要同步的 UI 值 ──────────────────────
        const chk = niTbById('ni-tb-chk');
        if (chk) niSyncTransBookToggleUI();
        const advElSync = niTbById('ni-tb-advance-prompt');
        if (advElSync) advElSync.value = cfg?.tbAdvancePrompt || TB_DEFAULT_ADVANCE_PROMPT;
        const judgeElSync = niTbById('ni-tb-advance-judge-prompt');
        if (judgeElSync) judgeElSync.value = cfg?.tbAutoAdvancePrompt || TB_DEFAULT_ADVANCE_JUDGE_PROMPT;
        const inferElSync = niTbById('ni-tb-infer-prompt');
        if (inferElSync) inferElSync.value = cfg?.tbInferPrompt || TB_DEFAULT_INFER_PROMPT;
        const ongoingElSync = niTbById('ni-tb-ongoing-prompt');
        if (ongoingElSync) ongoingElSync.value = cfg?.tbOngoingPrompt || TB_DEFAULT_ONGOING_PROMPT;
        const lightRecallModeChk = niTbById('ni-tb-light-recall-mode');
        if (lightRecallModeChk) lightRecallModeChk.checked = !!cfg?.tbLightRecallMode;
        const immersionElSync = niTbById('ni-tb-immersion-prompt');
        if (immersionElSync) immersionElSync.value = cfg?.tbImmersionPrompt || TB_DEFAULT_IMMERSION_PROMPT;
        const statusbarChk = niTbById('ni-tb-display-statusbar');
        if (statusbarChk) statusbarChk.checked = !!cfg?.tbDisplayStatusbar;
        const popupChk = niTbById('ni-tb-display-popup');
        if (popupChk) popupChk.checked = !!cfg?.tbDisplayPopup;
        const immersionModeChk = niTbById('ni-tb-immersion-mode');
        if (immersionModeChk) immersionModeChk.checked = !!cfg?.tbImmersionMode;
        const autoAdvChkSync = niTbById('ni-tb-auto-advance');
        if (autoAdvChkSync) autoAdvChkSync.checked = cfg?.tbAutoAdvance !== false;
        const autoCrossChkSync = niTbById('ni-tb-auto-cross-stage');
        if (autoCrossChkSync) autoCrossChkSync.checked = cfg?.tbAutoAdvanceCrossStage !== false;
        const autoModelSelSync = niTbById('ni-tb-auto-advance-model');
        if (autoModelSelSync) autoModelSelSync.value = cfg?.tbAutoAdvanceModel === 'plugin' ? 'plugin' : 'current';
        const autoEverySync = niTbById('ni-tb-auto-advance-every');
        if (autoEverySync) autoEverySync.value = String(cfg?.tbAutoAdvanceEvery ?? 1);
        const autoThrSync = niTbById('ni-tb-auto-advance-threshold');
        if (autoThrSync) autoThrSync.value = Number(cfg?.tbAutoAdvanceThreshold ?? 0.7).toFixed(2);
        niTbSyncAutoAdvanceUI();
    }

    // 状态栏「自动」徽标：只反映开关，以及此刻是否正在判定。
    function niTbSyncAutoAdvanceUI() {
        const cfg = extension_settings[EXT_NAME] || {};
        const chip = niTbById('ni-tb-btn-auto-adv');
        if (!chip) return;
        chip.classList.toggle('active', cfg.tbAutoAdvance !== false);
        const label = niTbById('ni-tb-auto-adv-label');
        if (label) label.textContent = S.tbAutoAdvanceJudging ? '判定中' : '自动';
        const icon = niTbById('ni-tb-auto-adv-icon');
        if (icon) icon.className = S.tbAutoAdvanceJudging ? 'ti ti-loader ni-tb-spin' : 'ti ti-wand';
    }

    function niTbPeekPendingAdvancePrompt() {
        return _tbPendingAdvancePrompt;
    }

    function niTbConsumePendingAdvancePrompt() {
        const prompt = _tbPendingAdvancePrompt;
        _tbPendingAdvancePrompt = '';
        return prompt;
    }

    function niTbResetPromptRuntimeState() {
        _tbPendingAdvancePrompt = '';
        _tbAdvanceSent.clear();
        S.tbSectionOpen = { done: false, active: true, todo: false };
        _tbStagePage = 1;
        _tbNodePanelStageIdx = null;
        _tbNodePanelLimits.done = TB_NODE_BATCH_SIZE;
        _tbNodePanelLimits.todo = TB_NODE_BATCH_SIZE;
    }

    Object.assign(window, {
        _niS: S,
        niGetTbNodes,
        niGetTbStages,
        niCreateTbSnapshot,
        niTbSetCurrentIdx,
        niTbSetViewIdx,
        niTbResetViewToCurrent,
        niTbStageView,
        niTbToggleCheck,
        niTbAdvanceOneNode,
        niTbGenerateInfer,
        niTbGetInjectionNode,
    });

    return {
        niTbSyncPauseUI,
        niTbSetPaused,
        niTbTogglePaused,
        niUpgradeLegacyTbDefaultPrompts,
        niTbGetImmersionAppend,
        niTbFrontierStage,
        niTbAdvanceFrontier,
        niGetTbNodes,
        niGetTbStages,
        niCreateTbSnapshot,
        niTbReconcileCurrentNode,
        niTbGetInjectionNode,
        niTbSetCurrentIdx,
        niTbSetViewIdx,
        niTbResetViewToCurrent,
        niTbUnpinView,
        niTbStageView,
        niTbSaveState,
        niTbLoadState,
        niGetTbStoryBarHtml,
        niTbPaintStoryBar,
        niTbSetSkin,
        niTbSkinFor,
        niEsc,
        niTbBuildStageListHtml,
        niTbBuildNodePanelHtml,
        niTbGetSlots,
        niTbCalcPos,
        niTbCardHTML,
        niTbBuildTrack,
        niTbAnimateTo,
        niTbCardClick,
        niTbSyncMeta,
        niTbRefreshNodePanel,
        niTbToggleCheck,
        niTbUnarchive,
        niTbAdvanceOneNode,
        niTbAutoEnterNextStage,
        niTbGetAutoAdvanceContext,
        niTbSetAutoAdvanceJudging,
        niTbGetOffscreenState,
        niTbSetOffscreenState,
        niTbGetOffscreenContext,
        niTbRenderOffscreenBar,
        niTbShowStageDone,
        niTbWriteAdvancePrompt,
        niTbWriteOpeningPrompt,
        niTbGenerateInfer,
        niTbInjectCSS,
        niTbRenderStoryBar,
        niRefreshStorybarTheme,
        niTbBindEvents,
        niTbBindBarEvents,
        niTbBindNodePanelEvents,
        niTbToggleDropPanel,
        niTbRebuildStageList,
        niTbInitSettingsUI,
        niTbPeekPendingAdvancePrompt,
        niTbConsumePendingAdvancePrompt,
        niTbResetPromptRuntimeState,
    };
}
