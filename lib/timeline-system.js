// 剧情时间线（阶段 × 主/支/转折线）—— 纯布局与 HTML 生成，便于单测。
// 只做「读」：不修改剧情数据、不发请求；点击只负责跳回列表定位。

export const NI_TIMELINE_LANE_ORDER = ['main', 'sub', 'pivot'];

export const NI_TIMELINE_LANE_LABELS = {
    main: '主线',
    sub: '支线',
    pivot: '转折',
};

const NI_TIMELINE_LANE_ICONS = {
    main: 'ti-route',
    sub: 'ti-git-branch',
    pivot: 'ti-bolt',
};

const NI_TIMELINE_TITLE_MAX = 34;
const NI_TIMELINE_STAGE_TITLE_MAX = 18;

export function niNormalizeTimelineView(value) {
    return value === 'timeline' ? 'timeline' : 'list';
}

export function niTimelineClip(text, max = NI_TIMELINE_TITLE_MAX) {
    const raw = String(text ?? '').replace(/\s+/g, ' ').trim();
    const limit = Number.isFinite(Number(max)) && Number(max) > 0 ? Math.trunc(Number(max)) : NI_TIMELINE_TITLE_MAX;
    if (raw.length <= limit) return raw;
    return `${raw.slice(0, Math.max(1, limit - 1))}…`;
}

export function niTimelineNodeLabel(node) {
    const title = niTimelineClip(node?.title || node?.name || '', NI_TIMELINE_TITLE_MAX);
    return title || '（未命名节点）';
}

function niTimelineEstimateTokens(chars) {
    const value = Number(chars);
    if (!Number.isFinite(value) || value <= 0) return 0;
    return Math.round(value / 1.5);
}

/**
 * 把阶段与节点整理成「列 × 泳道」的模型。
 * @param {object} input
 * @param {number} input.stageCount 阶段总数
 * @param {object} [input.stageTitles] 阶段号 → 标题
 * @param {object} [input.stageSummaries] 阶段号 → 概括
 * @param {object} [input.stageOn] 阶段号 → 是否开启
 * @param {object} [input.stageVec] 阶段号 → 是否已向量化
 * @param {object} [input.nodesByStage] 阶段号 → { main: [], sub: [], pivot: [] }
 * @param {object} [input.nodeCharsByStage] 阶段号 → 节点正文字符数
 * @param {object} [input.compressedCharsByStage] 阶段号 → 压缩原文字符数
 * @param {string} [input.rawMode] 'nodes' | 'compressed'
 * @param {number} [input.currentStageIdx] 当前进度所在阶段
 * @param {(stageIdx:number)=>boolean} [input.isStageBlocked]
 * @param {(node:object)=>boolean} [input.isNodeBlocked]
 */
export function niBuildTimelineModel(input = {}) {
    const stageCount = Math.max(0, Math.trunc(Number(input.stageCount) || 0));
    const rawMode = input.rawMode === 'compressed' ? 'compressed' : 'nodes';
    const currentStageIdx = Number.isFinite(Number(input.currentStageIdx)) && Number(input.currentStageIdx) > 0
        ? Math.trunc(Number(input.currentStageIdx))
        : 0;
    const isStageBlocked = typeof input.isStageBlocked === 'function' ? input.isStageBlocked : () => false;
    const isNodeBlocked = typeof input.isNodeBlocked === 'function' ? input.isNodeBlocked : () => false;

    const columns = [];
    let totalNodes = 0;
    let blockedNodes = 0;

    for (let stageIdx = 1; stageIdx <= stageCount; stageIdx++) {
        const group = input.nodesByStage?.[stageIdx] || {};
        const lanes = {};
        let nodeCount = 0;
        let blockedInStage = 0;

        for (const lane of NI_TIMELINE_LANE_ORDER) {
            const list = Array.isArray(group[lane]) ? group[lane] : [];
            const chips = [];
            for (const node of list) {
                const blocked = !!isNodeBlocked(node);
                if (blocked) blockedInStage++;
                nodeCount++;
                chips.push({
                    id: String(node?._nodeId || node?.node_id || node?.nodeId || node?.id || ''),
                    title: niTimelineNodeLabel(node),
                    blocked,
                });
            }
            lanes[lane] = { key: lane, label: NI_TIMELINE_LANE_LABELS[lane], nodes: chips };
        }

        totalNodes += nodeCount;
        blockedNodes += blockedInStage;

        const charset = rawMode === 'compressed'
            ? Number(input.compressedCharsByStage?.[stageIdx]) || 0
            : Number(input.nodeCharsByStage?.[stageIdx]) || 0;
        const title = String(input.stageTitles?.[stageIdx] || '').trim();

        columns.push({
            stageIdx,
            title: niTimelineClip(title || `阶段 ${stageIdx}`, NI_TIMELINE_STAGE_TITLE_MAX),
            fullTitle: title,
            summary: String(input.stageSummaries?.[stageIdx] || '').trim(),
            on: input.stageOn?.[stageIdx] !== false,
            vec: !!input.stageVec?.[stageIdx],
            blocked: !!isStageBlocked(stageIdx),
            current: currentStageIdx === stageIdx,
            nodeCount,
            blockedInStage,
            chars: charset,
            tokens: niTimelineEstimateTokens(charset),
            lanes: NI_TIMELINE_LANE_ORDER.map(key => lanes[key]),
            maxLaneCount: Math.max(0, ...NI_TIMELINE_LANE_ORDER.map(key => lanes[key].nodes.length)),
        });
    }

    return {
        columns,
        stageCount,
        totalNodes,
        blockedNodes,
        currentStageIdx,
        rawMode,
        empty: stageCount <= 0,
        laneOrder: [...NI_TIMELINE_LANE_ORDER],
    };
}

export function niTimelineToHtml(model, options = {}) {
    const esc = typeof options.esc === 'function' ? options.esc : (value => String(value ?? ''));
    const columns = Array.isArray(model?.columns) ? model.columns : [];

    if (!columns.length) {
        return '<div class="ni-tl-empty"><i class="ti ti-route"></i>还没有阶段。先回到处理页完成清洗与阶段划分。</div>';
    }

    const parts = [];
    parts.push('<div class="ni-tl-legend">');
    parts.push('<span class="ni-tl-legend-title">剧情时间线</span>');
    for (const lane of NI_TIMELINE_LANE_ORDER) {
        parts.push(
            `<span class="ni-tl-legend-item" data-lane="${lane}">` +
            `<i class="ti ${NI_TIMELINE_LANE_ICONS[lane]}"></i>${NI_TIMELINE_LANE_LABELS[lane]}</span>`,
        );
    }
    parts.push('<span class="ni-tl-legend-item ni-tl-legend-now"><i class="ti ti-map-pin"></i>当前进度</span>');
    parts.push('<span class="ni-tl-legend-item ni-tl-legend-blocked"><i class="ti ti-eye-off"></i>已屏蔽</span>');
    parts.push(
        `<span class="ni-tl-legend-stat">${columns.length} 阶段 · ${model.totalNodes} 节点` +
        (model.blockedNodes ? ` · 屏蔽 ${model.blockedNodes}` : '') +
        '</span>',
    );
    parts.push('</div>');

    parts.push('<div class="ni-tl-scroll"><div class="ni-tl-track">');
    for (const column of columns) {
        const cls = ['ni-tl-col'];
        if (column.current) cls.push('is-current');
        if (!column.on) cls.push('is-off');
        if (column.blocked) cls.push('is-blocked');
        const headTitle = column.fullTitle || `阶段 ${column.stageIdx}`;
        parts.push(
            `<div class="${cls.join(' ')}" data-tl-stage="${column.stageIdx}">` +
            `<button type="button" class="ni-tl-head" data-tl-stage="${column.stageIdx}" title="回到列表定位「第 ${column.stageIdx} 阶段」">` +
            `<span class="ni-tl-num">第 ${column.stageIdx} 阶段</span>` +
            (column.current ? '<span class="ni-tl-now">现在</span>' : '') +
            (column.vec
                ? '<span class="ni-tl-badge ni-tl-badge-vec">已向量</span>'
                : '<span class="ni-tl-badge">未向量</span>') +
            (column.blocked ? '<span class="ni-tl-badge ni-tl-badge-block">已屏蔽</span>' : '') +
            `<span class="ni-tl-title">${esc(column.title)}</span>` +
            `<span class="ni-tl-meta">${column.nodeCount} 节点` +
            (column.chars ? ` · ${column.chars.toLocaleString()} 字 · ~${column.tokens.toLocaleString()} token` : '') +
            '</span></button>',
        );
        parts.push('<div class="ni-tl-lanes">');
        for (const lane of column.lanes) {
            if (!lane.nodes.length) continue;
            parts.push(
                `<div class="ni-tl-lane" data-lane="${lane.key}">` +
                `<span class="ni-tl-lane-lbl">${lane.label}</span>` +
                '<span class="ni-tl-lane-nodes">',
            );
            for (const node of lane.nodes) {
                parts.push(
                    `<button type="button" class="ni-tl-node${node.blocked ? ' is-blocked' : ''}" ` +
                    `data-tl-stage="${column.stageIdx}" data-tl-node="${esc(node.id)}" ` +
                    `title="${esc(node.title)}${node.blocked ? '（已屏蔽）' : ''}">` +
                    `<span class="ni-tl-node-txt">${esc(node.title)}</span></button>`,
                );
            }
            parts.push('</span></div>');
        }
        if (!column.nodeCount) {
            parts.push('<div class="ni-tl-lane ni-tl-lane-empty"><span class="ni-tl-empty-txt">暂无节点</span></div>');
        }
        parts.push('</div></div>');
    }
    parts.push('</div></div>');
    return parts.join('');
}
