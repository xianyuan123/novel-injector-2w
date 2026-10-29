/**
 * 数据体检
 * --------
 * 清洗/生成/向量化一路跑下来，数据里总会留下一些「不影响跑，但会让效果变差」的脏东西：
 * 重名角色、挂在不存在阶段的孤儿节点、有节点却没向量的阶段、没清完的段、
 * 正文里一次都没出现的「幻影角色」、已经退场却在后面又冒出来的「诈尸」。
 *
 * 这里把它们一次性列出来，只读、不改数据；每条都给一句「怎么修」。
 * 全部基于本地缓存的数据与已加载的正文，不消耗 API。
 */

import {
    getAllPlotsInStoryOrder,
    niBuildStageRuntimeIndex,
    niPlotNodeId,
    isSameCharacter,
} from './story-data.js';
import { niResolveCharCanon } from './char-canon.js';

const NI_HEALTH_LEVEL_ORDER = { warn: 0, info: 1 };

function niHealthEsc(text) {
    return String(text == null ? '' : text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function niHealthCharName(char) {
    return String(char?.name || char?.aliases?.[0] || '').trim();
}

function niHealthCharAliases(char) {
    const list = Array.isArray(char?.aliases) ? char.aliases : [];
    return list.map(alias => String(alias || '').trim()).filter(Boolean);
}

/** 把「还没有正文」的情况和「正文里确实没有」区分开 */
function niHasTextBody(state) {
    if (String(state?.rawText || '').trim()) return true;
    const chunks = Array.isArray(state?.chunks) ? state.chunks : [];
    return chunks.some(chunk => String(chunk?.text || '').trim());
}

function niNodeText(node) {
    return `${node?.title || ''} ${node?.body || ''}`;
}

function niStageOfPlot(plot) {
    const raw = plot?.stageIdx ?? plot?.stage_idx ?? plot?.stageIndex;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? Math.trunc(value) : null;
}

/**
 * @param {object} state 插件状态（S）
 * @returns {{ groups: Array, summary: {warn:number, info:number, ok:number} }}
 */
export function niCollectHealthChecks(state = {}) {
    const s = state || {};
    const totalStages = Math.max(0, parseInt(s.stageMapN, 10) || 0);
    const nodes = getAllPlotsInStoryOrder(s);
    const runtime = niBuildStageRuntimeIndex(s);
    const chars = Array.isArray(s.characters) ? s.characters : [];
    const groups = [];

    const add = (id, title, level, hint, items) => {
        if (!Array.isArray(items) || !items.length) return;
        groups.push({ id, title, level, hint, items });
    };

    // ① 重名 / 近名角色：同名、或一个名字包含另一个（≥2 字）
    const dupItems = [];
    const seenPairs = new Set();
    for (let i = 0; i < chars.length; i++) {
        for (let j = i + 1; j < chars.length; j++) {
            const a = chars[i];
            const b = chars[j];
            if (!isSameCharacter(a, b)) continue;
            const key = [niHealthCharName(a), niHealthCharName(b)].sort().join('|');
            if (seenPairs.has(key)) continue;
            seenPairs.add(key);
            dupItems.push({
                label: `${niHealthCharName(a)} / ${niHealthCharName(b)}`,
                detail: '两个人设各自独立，注入时会重复占位，AI 可能当成两个人',
                fix: '去角色页把重复的删掉或合并',
            });
        }
    }
    add('dup-char', '重名角色', 'warn', '同名或名字互相包含的角色，会被当成两个不同的人', dupItems);

    // ② 孤儿节点：阶段号缺失或超出总阶段数
    const orphanItems = [];
    for (const node of nodes) {
        const stage = niStageOfPlot(node);
        if (stage == null) {
            orphanItems.push({
                label: String(node?.title || niPlotNodeId(node) || '（未命名节点）'),
                detail: '没有阶段号，永远不会被阶段直注或未来预告取到',
                fix: '重新划分阶段，或手动给这个节点指定阶段',
            });
            continue;
        }
        if (totalStages && stage > totalStages) {
            orphanItems.push({
                label: `${node?.title || niPlotNodeId(node)}`,
                detail: `挂在第 ${stage} 阶段，但当前只有 ${totalStages} 个阶段`,
                fix: '重新划分阶段（阶段数变少后旧节点会留在原阶段号上）',
            });
        }
    }
    add('orphan-node', '孤儿剧情节点', 'warn', '挂在不存在的阶段上的节点，注不进去也看不见', orphanItems);

    // ③ 有节点但没向量的阶段
    const missingVec = [];
    for (let stageIdx = 1; stageIdx <= totalStages; stageIdx++) {
        const bucket = runtime?.nodesByStage?.[stageIdx];
        const count = bucket ? (bucket.main?.length || 0) + (bucket.sub?.length || 0) + (bucket.pivot?.length || 0) : 0;
        if (!count) continue;
        if (s?.stageVecDone?.[stageIdx]) continue;
        missingVec.push({
            label: `第 ${stageIdx} 阶段（${count} 个节点）`,
            detail: '这个阶段还没向量化，语义召回取不到它',
            fix: '处理页点「补全缺失」或「开始向量化」',
        });
    }
    add('missing-vec', '缺向量的阶段', 'info', '有剧情节点却没向量，召回会漏掉这些内容', missingVec);

    // ④ 没清完的分段
    const pending = [];
    const statusList = Array.isArray(s.chunkStatus) ? s.chunkStatus : [];
    statusList.forEach((status, idx) => {
        if (!status || status === 'pending') {
            pending.push({
                label: `第 ${idx + 1} 段`,
                detail: '还没清洗，这段剧情不会进入原文库',
                fix: '点「开始清洗」或对该段单独重试',
            });
        } else if (status === 'error' || status === 'failed') {
            pending.push({
                label: `第 ${idx + 1} 段`,
                detail: `上次清洗失败（${status}）`,
                fix: '对该段重试，或降低每段字数',
            });
        }
    });
    add('clean-pending', '没清完的分段', 'warn', '这些段没有清洗结果，剧情与角色都会缺一块', pending);

    // ⑤ 正文里零命中的角色（AI 编出来的「幻影角色」）
    const ghost = [];
    if (niHasTextBody(s) && chars.length) {
        const body = String(s.rawText || '')
            + (Array.isArray(s.chunks) ? s.chunks.map(chunk => String(chunk?.text || '')).join('\n') : '');
        for (const char of chars) {
            const name = niHealthCharName(char);
            if (!name) continue;
            const names = [name, ...niHealthCharAliases(char)].filter(Boolean);
            if (names.some(term => body.includes(term))) continue;
            ghost.push({
                label: name,
                detail: '正文里一次都没出现，是清洗时被编出来的角色',
                fix: '确认后在角色页删掉，或把它当成原创角色保留',
            });
        }
    }
    add('ghost-char', '正文零命中的角色', 'warn', '这些名字在原文里找不到，多半是模型编的', ghost);

    // ⑥ 已退场却还在后面出场的「诈尸」
    const zombie = [];
    for (const char of chars) {
        const canon = niResolveCharCanon(char);
        if (!canon?.hasExit) continue;
        const exitStage = canon.exitStage;
        const name = niHealthCharName(char);
        if (!name) continue;
        const names = [name, ...niHealthCharAliases(char)].filter(Boolean);
        for (const node of nodes) {
            const stage = niStageOfPlot(node);
            if (stage == null || stage <= exitStage) continue;
            const text = niNodeText(node);
            if (!names.some(term => text.includes(term))) continue;
            zombie.push({
                label: `${name}（第 ${exitStage} 阶段退场）`,
                detail: `第 ${stage} 阶段的节点「${node?.title || niPlotNodeId(node) || '（未命名）'}」里又出现了`,
                fix: '要么改退场阶段，要么把这个节点里的人改掉',
            });
            break;
        }
    }
    add('zombie-char', '退场后又出现的角色', 'warn', '已经标记退场的角色还在后面出场，AI 会把它写活', zombie);

    // ⑦ 还没划分阶段
    if (totalStages === 0 && nodes.length) {
        add('no-stage', '还没有划分阶段', 'warn', '没有阶段就没有阶段直注与未来预告', [{
            label: `已有 ${nodes.length} 个剧情节点`,
            detail: '这些节点现在只能靠向量召回被看到',
            fix: '剧情页点「划分阶段」',
        }]);
    }

    groups.sort((a, b) => (NI_HEALTH_LEVEL_ORDER[a.level] ?? 9) - (NI_HEALTH_LEVEL_ORDER[b.level] ?? 9));
    const summary = {
        warn: groups.filter(group => group.level === 'warn').length,
        info: groups.filter(group => group.level === 'info').length,
        total: groups.reduce((sum, group) => sum + group.items.length, 0),
    };
    return { groups, summary, checkedAt: new Date().toISOString() };
}

/** 把体检结果渲染成 HTML（不依赖 index.js 里的工具函数，方便单测） */
export function niRenderHealthReport(result) {
    const groups = Array.isArray(result?.groups) ? result.groups : [];
    if (!groups.length) {
        return '<div class="ni-health-ok"><i class="ti ti-circle-check"></i>没查出问题，数据是干净的。</div>';
    }
    const blocks = groups.map(group => {
        const items = (group.items || []).map(item => `<li>
          <div class="ni-health-item-head"><span class="ni-health-item-label">${niHealthEsc(item.label)}</span>
            <span class="ni-health-item-detail">${niHealthEsc(item.detail)}</span></div>
          ${item.fix ? `<div class="ni-health-item-fix"><i class="ti ti-tool"></i>${niHealthEsc(item.fix)}</div>` : ''}
        </li>`).join('');
        return `<div class="ni-health-group ${group.level === 'warn' ? 'warn' : 'info'}">
          <div class="ni-health-group-head">
            <i class="ti ${group.level === 'warn' ? 'ti-alert-triangle' : 'ti-info-circle'}"></i>
            <span class="ni-health-group-title">${niHealthEsc(group.title)}</span>
            <span class="ni-health-group-count">${(group.items || []).length}</span>
          </div>
          ${group.hint ? `<div class="ni-health-group-hint">${niHealthEsc(group.hint)}</div>` : ''}
          <ul class="ni-health-list">${items}</ul>
        </div>`;
    }).join('');
    const sum = result.summary || {};
    return `<div class="ni-health-sum">共 ${Number(sum.total) || 0} 项待处理（${Number(sum.warn) || 0} 类会影响效果）</div>${blocks}`;
}
