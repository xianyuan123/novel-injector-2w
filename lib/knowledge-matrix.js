/**
 * 角色 × 阶段 知情矩阵
 * --------------------
 * 「谁在第几阶段知道什么」一直是小说类插件最容易翻车的地方：AI 会在第 3 阶段
 * 就把第 9 阶段才揭晓的身份说出来。这里把每个角色的身份层与已知事实按阶段摊开，
 * 只列「发生变化」的阶段，方便一眼看出哪一步会提前泄底。
 */

import {
    niNormalizeIdentityRows,
    niResolveIdentityState,
    niFilterKnowledgeByStage,
    niNormalizeKnowledgeRows,
} from './char-canon.js';

function niMatrixName(char) {
    return String(char?.name || '').trim();
}

function niIdentityLabel(row) {
    return String(row?.label || '').trim();
}

/**
 * @param {object} state 插件状态
 * @param {{ currentStage?: number }} [opts]
 * @returns {{ chars: Array, totalStages: number }}
 */
export function niBuildKnowledgeMatrix(state = {}, { currentStage = 0 } = {}) {
    const s = state || {};
    const totalStages = Math.max(0, parseInt(s.stageMapN, 10) || 0);
    const chars = Array.isArray(s.characters) ? s.characters : [];
    const now = parseInt(currentStage, 10) || 0;

    const snapshots = [];
    for (const char of chars) {
        const name = niMatrixName(char);
        if (!name) continue;
        const identityRows = niNormalizeIdentityRows(char?.identities);
        const knowledgeRows = niNormalizeKnowledgeRows(char?.knowledge);
        if (!identityRows.length && !knowledgeRows.length) continue;

        const points = [];
        let prevKey = null;
        const lastStage = Math.max(1, totalStages);
        for (let stage = 1; stage <= lastStage; stage++) {
            const identityState = niResolveIdentityState(identityRows, stage);
            const visible = identityState.active
                .filter(row => !row.secret || (row.revealAt != null && stage >= row.revealAt))
                .map(niIdentityLabel)
                .filter(Boolean);
            const hidden = identityState.active
                .filter(row => row.secret && !(row.revealAt != null && stage >= row.revealAt))
                .map(niIdentityLabel)
                .filter(Boolean);
            const facts = niFilterKnowledgeByStage(knowledgeRows, stage)
                .filter(row => row.fromStage == null || stage >= row.fromStage)
                .map(row => String(row.fact || '').trim())
                .filter(Boolean);
            const key = `${visible.join('|')}#${hidden.join('|')}#${facts.join('|')}`;
            if (key === prevKey) continue;
            prevKey = key;
            points.push({ stage, visible, hidden, facts });
        }
        snapshots.push({
            name,
            category: String(char?.category || char?.type || '').trim(),
            enabled: char?.enabled !== false,
            points,
            current: now > 0 ? (points.filter(point => point.stage <= now).pop() || null) : null,
        });
    }
    snapshots.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
    return { chars: snapshots, totalStages };
}

function niMatrixEsc(text) {
    return String(text == null ? '' : text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * 渲染成 HTML。每个角色一张卡；只列「身份或已知事实发生变化的阶段」。
 * @param {{chars: Array, totalStages: number}} matrix
 */
export function niRenderKnowledgeMatrix(matrix) {
    const chars = Array.isArray(matrix?.chars) ? matrix.chars : [];
    if (!chars.length) {
        return '<div class="ni-km-empty"><i class="ti ti-info-circle"></i>还没有角色填过身份或「知道的事」。在角色卡里填上「身份层」与「知道什么」后，这里就会长出矩阵。</div>';
    }
    return chars.map(char => {
        const points = (char.points || []).map(point => {
            const chips = [];
            if (point.visible.length) chips.push(`<span class="ni-km-chip">${niMatrixEsc(point.visible.join(' / '))}</span>`);
            if (point.hidden.length) {
                chips.push(`<span class="ni-km-chip secret" title="这一阶段还不能点破">秘密：${niMatrixEsc(point.hidden.join(' / '))}</span>`);
            }
            const facts = point.facts.length
                ? `<div class="ni-km-facts">知道：${niMatrixEsc(point.facts.join('；'))}</div>`
                : '';
            const isCurrent = char.current && char.current.stage === point.stage;
            return `<li class="${isCurrent ? 'current' : ''}">
              <span class="ni-km-stage">第 ${point.stage} 阶段${isCurrent ? ' · 当前' : ''}</span>
              <div class="ni-km-body">${chips.join('') || '<span class="ni-km-none">—</span>'}${facts}</div>
            </li>`;
        }).join('');
        return `<div class="ni-km-char${char.enabled ? '' : ' off'}">
          <div class="ni-km-char-head"><i class="ti ti-user"></i><span class="ni-km-name">${niMatrixEsc(char.name)}</span>
            ${char.category ? `<span class="ni-km-cat">${niMatrixEsc(char.category)}</span>` : ''}
            ${char.enabled ? '' : '<span class="ni-km-off">已关闭注入</span>'}
          </div>
          <ul class="ni-km-points">${points || '<li><span class="ni-km-none">没有阶段变化</span></li>'}</ul>
        </div>`;
    }).join('');
}
