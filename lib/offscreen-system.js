// 后台推演（其他视角）— 纯函数层 + 外接 OpenAI 兼容接口
// 思路：主视角之外的人/势力在幕后也在动。节点推进（有「动向」）时推演一轮，
// 把「与此同时，别处发生了什么」压成几行注入，让 AI 的世界不是静止的。
// 本文件只负责：拼提示词、解析回复、合并动向、拼注入文本、发外接请求。
// 什么时候推、推哪些阶段、结果存哪儿，都由 index.js / 聊天状态决定。

export const NI_OFFSCREEN_MODES = ['off', 'node', 'always'];
export const NI_OFFSCREEN_MAX_THREADS = 24;

export function niNormalizeOffscreenMode(value) {
    const mode = String(value ?? '').trim();
    return NI_OFFSCREEN_MODES.includes(mode) ? mode : 'node';
}

export const NI_DEFAULT_OFFSCREEN_PROMPT = `[后台动向推演]
你在推演小说世界里「主视角看不到的地方」正在发生什么。

主视角：{POV}
当前阶段：{STAGE_TITLE}
刚推进到的节点：{NODE_TITLE}

节点原文：
{NODE_BODY}

最近对话（按时间先后，最后一条最新）：
{RECENT_CHAT}

已经记录在案的动向：
{EXISTING}

要求：
1. 只写主视角看不到的人或势力——当前在场的人物不要写。
2. 每条只写「谁 + 做了什么 / 发生了什么」，一句话，40 字以内，写成已经发生的事实，不要建议、不要猜测。
3. 如果这一轮没有任何值得记录的变化，就返回空数组。
4. 只输出一行 JSON，不要解释、不要 Markdown 代码块：
{"threads":[{"subject":"师父","summary":"已察觉到山门有异动，连夜下山追查"}]}`;

/** 把模板里的 {KEY} 全部替换成对应值；未知占位符原样保留，空模板回退默认。 */
export function niFillOffscreenTemplate(template, vars = {}) {
    const raw = String(template ?? '').trim();
    const tpl = raw || NI_DEFAULT_OFFSCREEN_PROMPT;
    return tpl.replace(/\{([A-Z_]+)\}/g, (whole, key) => {
        const value = vars[key];
        return value === undefined || value === null ? whole : String(value);
    });
}

/** 尾部截断：保留最新部分。 */
export function niTailClip(text, maxChars) {
    const s = String(text ?? '');
    const limit = Number(maxChars);
    if (!Number.isFinite(limit) || limit <= 0 || s.length <= limit) return s;
    return `…（前面省略 ${s.length - limit} 字）\n${s.slice(s.length - limit)}`;
}

export function niBuildOffscreenMessages({
    pov = '',
    stageTitle = '',
    nodeTitle = '',
    nodeText = '',
    recentChat = '',
    existingThreads = [],
    prompt = NI_DEFAULT_OFFSCREEN_PROMPT,
    maxNodeChars = 2000,
    maxRecentChars = 2500,
} = {}) {
    const existing = (Array.isArray(existingThreads) ? existingThreads : [])
        .slice(0, 12)
        .map(t => `· ${String(t?.subject || '').trim()}：${String(t?.summary || '').trim()}`)
        .filter(line => line.length > 4)
        .join('\n');
    const content = niFillOffscreenTemplate(prompt, {
        POV: pov || '当前主视角角色',
        STAGE_TITLE: stageTitle || '（未命名阶段）',
        NODE_TITLE: nodeTitle || '（未命名节点）',
        NODE_BODY: niTailClip(nodeText || '（节点没有正文，按标题与对话推演）', maxNodeChars),
        RECENT_CHAT: niTailClip(recentChat || '（没有可用的对话记录）', maxRecentChars),
        EXISTING: existing || '（暂无）',
    });
    return [
        { role: 'system', content: '你是小说世界的后台推演器，只输出一行 JSON，不输出任何其他内容。' },
        { role: 'user', content },
    ];
}

/** 从回复里抠出 JSON：兼容 ```json 围栏、前后废话、对象包 threads、裸数组。 */
export function niParseOffscreenReply(raw) {
    const text = String(raw ?? '').trim();
    const fail = reason => ({ ok: false, threads: [], reason, raw: text });
    if (!text) return fail('空回复');
    const body = text.replace(/```[a-zA-Z]*\s*/g, '').replace(/```/g, '');

    const tryParse = slice => {
        try { return JSON.parse(slice); } catch { return null; }
    };

    const pickList = data => Array.isArray(data) ? data
        : Array.isArray(data?.threads) ? data.threads
            : Array.isArray(data?.items) ? data.items
                : null;

    let data = null;
    let list = null;
    const objStart = body.indexOf('{');
    const objEnd = body.lastIndexOf('}');
    if (objStart >= 0 && objEnd > objStart) {
        data = tryParse(body.slice(objStart, objEnd + 1));
        list = pickList(data);
    }
    // 裸数组会被上面的「首个 { 到末个 }」切坏（数组里每个元素都被剥掉外层），
    // 所以对象里找不到 threads 时再单独按数组切一次。
    if (!list) {
        const arrStart = body.indexOf('[');
        const arrEnd = body.lastIndexOf(']');
        if (arrStart >= 0 && arrEnd > arrStart) {
            const arrData = tryParse(body.slice(arrStart, arrEnd + 1));
            const arrList = pickList(arrData);
            if (arrList) { data = arrData; list = arrList; }
        }
    }
    if (data === null) return fail('回复里没有可解析的 JSON');
    if (!list) return fail('JSON 里没有 threads 数组');

    const threads = [];
    for (const item of list) {
        const subject = String(item?.subject ?? item?.who ?? item?.name ?? '').trim().slice(0, 24);
        const summary = String(item?.summary ?? item?.text ?? item?.event ?? '').trim().slice(0, 60);
        if (!subject || !summary) continue;
        threads.push({ subject, summary });
        if (threads.length >= NI_OFFSCREEN_MAX_THREADS) break;
    }
    return { ok: true, threads, reason: '', raw: text };
}

/** 合并进已有动向：同一个主体覆盖旧记录，超出上限丢最旧的。 */
export function niMergeOffscreenThreads(prev = [], incoming = [], {
    stageIdx = 0,
    nodeId = '',
    now = Date.now(),
    maxThreads = NI_OFFSCREEN_MAX_THREADS,
} = {}) {
    const key = s => String(s ?? '').trim().toLowerCase();
    const map = new Map();
    for (const t of Array.isArray(prev) ? prev : []) {
        const k = key(t?.subject);
        if (!k) continue;
        map.set(k, { ...t });
    }
    for (const t of Array.isArray(incoming) ? incoming : []) {
        const k = key(t?.subject);
        if (!k) continue;
        const old = map.get(k);
        map.set(k, {
            subject: String(t.subject).trim().slice(0, 24),
            summary: String(t.summary).trim().slice(0, 60),
            stageIdx: Number.isFinite(Number(stageIdx)) ? Number(stageIdx) : 0,
            nodeId: String(nodeId || ''),
            at: Number(now) || Date.now(),
            // 保留第一次记录的时间，用来区分「老动向」与「刚发生的」
            since: old?.since || Number(now) || Date.now(),
        });
    }
    return [...map.values()]
        .sort((a, b) => (Number(b.at) || 0) - (Number(a.at) || 0))
        .slice(0, Math.max(1, Number(maxThreads) || NI_OFFSCREEN_MAX_THREADS));
}

/** 拼注入文本：一行一条，超字数按尾部截断并注明条数。 */
export function niFormatOffscreenInjection(threads = [], {
    maxChars = 800,
    header = '后台动向（主视角看不到的地方，仅作背景参考，不要直接讲出来）',
} = {}) {
    const list = (Array.isArray(threads) ? threads : []).filter(t => t && t.subject && t.summary);
    if (!list.length) return '';
    const lines = list.map(t => {
        const stage = Number(t.stageIdx) > 0 ? `第 ${Number(t.stageIdx)} 阶段｜` : '';
        return `· ${stage}${String(t.subject).trim()}：${String(t.summary).trim()}`;
    });
    const limit = Number(maxChars);
    let body = lines.join('\n');
    let dropped = 0;
    if (Number.isFinite(limit) && limit > 0 && body.length > limit) {
        const kept = [];
        let used = 0;
        for (const line of lines) {
            if (used + line.length + 1 > limit) { dropped++; continue; }
            kept.push(line);
            used += line.length + 1;
        }
        body = kept.length ? kept.join('\n') : lines[0].slice(0, limit);
        if (dropped > 0) body += `\n…（另有 ${dropped} 条动向因字数上限未注入）`;
    }
    return `[${header}]\n${body}\n[/后台动向]`;
}

/** 这一轮该不该推演。 */
export function niShouldRunOffscreen({
    enabled = false,
    mode = 'node',
    curNodeId = '',
    lastRunNodeId = '',
} = {}) {
    const normalized = niNormalizeOffscreenMode(mode);
    if (!enabled) return { run: false, reason: 'disabled' };
    if (normalized === 'off') return { run: false, reason: 'mode-off' };
    if (normalized === 'always') return { run: true, reason: 'always' };
    // node 模式：只在节点真的换了一个的时候推演
    const cur = String(curNodeId ?? '').trim();
    if (!cur) return { run: false, reason: 'no-node' };
    if (cur === String(lastRunNodeId ?? '').trim()) return { run: false, reason: 'same-node' };
    return { run: true, reason: 'node-moved' };
}

/** 把用户填的地址补成 chat/completions 端点。 */
export function niNormalizeChatEndpoint(url) {
    const raw = String(url ?? '').trim();
    if (!raw) return '';
    let u = raw.replace(/\/+$/, '');
    if (/\/chat\/completions$/i.test(u)) return u;
    if (/\/v1$/i.test(u)) return `${u}/chat/completions`;
    if (/\/v1\/models$/i.test(u)) return u.replace(/\/models$/i, '/chat/completions');
    return `${u}/v1/chat/completions`;
}

/** 兼容几种常见的 OpenAI 风格返回结构。 */
export function niExtractAssistantText(payload) {
    if (!payload || typeof payload !== 'object') return '';
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    for (const choice of choices) {
        const content = choice?.message?.content ?? choice?.text ?? choice?.delta?.content;
        if (typeof content === 'string' && content.trim()) return content;
        if (Array.isArray(content)) {
            const joined = content.map(part => (typeof part === 'string' ? part : part?.text || '')).join('').trim();
            if (joined) return joined;
        }
    }
    const direct = payload.content ?? payload.output_text ?? payload.text;
    if (typeof direct === 'string' && direct.trim()) return direct;
    if (Array.isArray(payload.content)) {
        const joined = payload.content.map(part => (typeof part === 'string' ? part : part?.text || '')).join('').trim();
        if (joined) return joined;
    }
    return '';
}

/**
 * 调外接 OpenAI 兼容接口。失败一律抛 Error（由调用方决定是否提示用户）。
 * @returns {Promise<{text:string, usage:object|null, raw:any}>}
 */
export async function niCallExternalChat({
    url = '',
    apiKey = '',
    model = '',
    messages = [],
    timeoutMs = 60000,
    temperature = 0.3,
    maxTokens = 600,
} = {}) {
    const endpoint = niNormalizeChatEndpoint(url);
    if (!endpoint) throw new Error('没有配置推演接口地址');
    if (!Array.isArray(messages) || !messages.length) throw new Error('推演请求没有消息');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(5000, Number(timeoutMs) || 60000));
    try {
        const body = {
            model: String(model || '').trim() || 'gpt-4o-mini',
            messages,
            temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : 0.3,
            max_tokens: Math.max(64, Number(maxTokens) || 600),
            stream: false,
        };
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(apiKey ? { Authorization: `Bearer ${String(apiKey).trim()}` } : {}),
            },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        const text = await res.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = null; }
        if (!res.ok) {
            const detail = data?.error?.message || text.slice(0, 200) || `HTTP ${res.status}`;
            throw new Error(`推演接口返回 ${res.status}：${detail}`);
        }
        const reply = niExtractAssistantText(data);
        if (!reply) throw new Error('推演接口没有返回可读内容');
        return { text: reply, usage: data?.usage || null, raw: data };
    } catch (e) {
        if (e?.name === 'AbortError') throw new Error('推演接口超时');
        throw e;
    } finally {
        clearTimeout(timer);
    }
}
