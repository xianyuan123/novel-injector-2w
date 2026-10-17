// 自动推进判定 — 纯函数层
// 目标：让模型判断「当前剧情节点是否已经演完」，而不是靠用户点按钮。
// 本文件只做三件事，方便单测、也避免网络/状态逻辑和判定混在一起：
//   1) 把阶段标题、节点原文、最近对话拼成判定提示词
//   2) 从模型回复里稳健地抠出 JSON（模型经常带 ```json 包裹或前后废话）
//   3) 按置信度阈值决定「要不要推进」
// 真正的请求与推进动作在 index.js（请求）/ transbook-system.js（推进）里。

export const NI_DEFAULT_ADVANCE_JUDGE_PROMPT = `[剧情推进判定]
你在判断「当前剧情节点是否已经演完」。只看证据，不要客套，只回 JSON。

当前阶段：{STAGE_TITLE}
当前节点：{NODE_TITLE}

节点原文（这是还没演完的部分）：
{NODE_BODY}

最近对话（按时间先后，最后一条最新）：
{RECENT_CHAT}

判定要求：
1. 只有当最近对话里已经出现了节点原文所描述的事件、冲突或结果（不必逐字复述，演到了就算）时，才判为演完。
2. 用户明确要求「继续 / 下一个 / 跳过」时，视为演完。
3. 只是开场、铺垫、还在推进中，一律判为没演完。
4. 拿不准就判 false —— 宁可晚一轮推进，也不要提前跳节点。
5. 只输出一行 JSON，不要解释、不要 Markdown 代码块：
{"completed":true,"confidence":0.85,"reason":"30字以内的依据"}`;

/** 把模板里的 {KEY} 全部替换成对应值，未知占位符原样保留。 */
export function niFillAdvanceJudgeTemplate(template, vars = {}) {
    // 用户可能把输入框清空：空模板回退到默认，否则判定请求会退化成「没有指令」。
    const raw = String(template ?? '').trim();
    const tpl = raw || NI_DEFAULT_ADVANCE_JUDGE_PROMPT;
    return tpl.replace(/\{([A-Z_]+)\}/g, (whole, key) => {
        const value = vars[key];
        return value === undefined || value === null ? whole : String(value);
    });
}

/** 从末尾截断，保留最新部分（对话越靠后越重要）。 */
export function niTailTruncate(text, maxChars) {
    const s = String(text ?? '');
    const limit = Number(maxChars);
    if (!Number.isFinite(limit) || limit <= 0 || s.length <= limit) return s;
    const cut = s.slice(s.length - limit);
    return `…（前面省略 ${s.length - limit} 字）\n${cut}`;
}

/**
 * 拼判定请求。
 * @returns {{role:string, content:string}[]}
 */
export function niBuildAdvanceJudgeMessages({
    stageTitle = '',
    nodeTitle = '',
    nodeText = '',
    recentChat = '',
    prompt = NI_DEFAULT_ADVANCE_JUDGE_PROMPT,
    maxNodeChars = 3000,
    maxRecentChars = 4000,
} = {}) {
    const body = niTailTruncate(nodeText || '（节点没有正文，按标题与对话判断）', maxNodeChars);
    const recent = niTailTruncate(recentChat || '（没有可用的对话记录）', maxRecentChars);
    const content = niFillAdvanceJudgeTemplate(prompt, {
        STAGE_TITLE: stageTitle || '（未命名阶段）',
        NODE_TITLE: nodeTitle || '（未命名节点）',
        NODE_BODY: body,
        RECENT_CHAT: recent,
    });
    return [
        { role: 'system', content: '你是剧情进度判定器，只输出一行 JSON，不输出任何其他内容。' },
        { role: 'user', content },
    ];
}

/**
 * 解析模型回复。
 * @returns {{ok:boolean, completed:boolean, confidence:number, reason:string, raw:string}}
 */
export function niParseAdvanceJudgeReply(raw) {
    const text = String(raw ?? '').trim();
    const fail = (reason = '') => ({ ok: false, completed: false, confidence: 0, reason, raw: text });
    if (!text) return fail('空回复');
    const body = text.replace(/```[a-zA-Z]*\s*/g, '').replace(/```/g, '');
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start < 0 || end <= start) return fail('回复里没有 JSON');
    let obj = null;
    try {
        obj = JSON.parse(body.slice(start, end + 1));
    } catch {
        return fail('JSON 解析失败');
    }
    if (!obj || typeof obj !== 'object') return fail('JSON 不是对象');
    const rawFlag = obj.completed ?? obj.done ?? obj.finished;
    const completed = rawFlag === true || rawFlag === 1
        || (typeof rawFlag === 'string' && ['true', 'yes', '1', 'done'].includes(rawFlag.trim().toLowerCase()));
    const rawConf = Number(obj.confidence ?? obj.score);
    const confidence = Number.isFinite(rawConf) ? Math.min(1, Math.max(0, rawConf)) : (completed ? 1 : 0);
    const reason = String(obj.reason ?? obj.why ?? '').trim().slice(0, 60);
    return { ok: true, completed, confidence, reason, raw: text };
}

/** 只有「判定成功 + 判定完成 + 置信度达阈值」三者都成立才推进。 */
export function niDecideAutoAdvance(verdict, threshold = 0.7) {
    if (!verdict || verdict.ok === false || !verdict.completed) return false;
    const t = Number(threshold);
    const limit = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0.7;
    const conf = Number.isFinite(verdict.confidence) ? verdict.confidence : 1;
    return conf >= limit;
}
