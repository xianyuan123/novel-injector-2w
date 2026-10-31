/**
 * 穿书状态栏 · 皮肤系统
 * ────────────────────────────────────────────────
 * 一套皮肤 = 一张底图 + 一组 CSS 变量。状态栏骨架（HTML/事件/轮播逻辑）完全不变，
 * 皮肤只通过 CSS 变量和 `--ni-tb-art` 影响外观，所以：
 *   - 加皮肤 = 往列表里加一条数据，不写选择器、不加 !important
 *   - 上传一张背景图 = 自动取色 → 生成变量草稿 → 微调 → 保存成一套皮肤
 *   - 关掉皮肤 = 用内置的 'plain'，回到原来的紧凑横条
 */

/** 皮肤可调的变量名（顺序即设置页的排列顺序） */
export const NI_TB_VAR_KEYS = [
    'art',        // 底图（data:image/... 或 none）
    'accent',     // 主色：主按钮、勾选圆点、高亮
    'text',       // 正文色
    'title',      // 标题色
    'barBg',      // 顶栏底
    'cardBg',     // 卡片底
    'cardLine',   // 卡片描边
    'panelBg',    // 面板底（无底图时的整体背景）
    'veil',       // 底图之上的薄纱（0~1，越大字越清楚）
    'radius',     // 圆角（px）
    'cardH',      // 轮播区高度（px）
    'cardPad',    // 卡片内边距（px）
    'font'        // 字号缩放（0.9~1.15）
];

/** 内置皮肤：不占存储、随时可切回 */
export const NI_TB_BUILTIN_SKINS = [
    {
        id: 'plain',
        name: '原版',
        desc: '插件自带的紧凑横条，跟着 SillyTavern 主题走',
        builtin: true,
        vars: {}
    },
    {
        id: 'glass',
        name: '清透玻璃',
        desc: '半透明玻璃感，浅色主题下最稳',
        builtin: true,
        vars: {
            panelBg: 'rgba(255,255,255,.72)',
            barBg: 'rgba(255,255,255,.66)',
            cardBg: 'rgba(255,255,255,.82)',
            cardLine: 'rgba(150,140,190,.28)',
            accent: '#8f63c9',
            title: '#4b3f63',
            text: '#5a5168',
            veil: 0.18,
            radius: 18,
            cardH: 204,
            cardPad: 14,
            font: 1
        }
    },
    {
        id: 'paper',
        name: '宣纸',
        desc: '米白纸面 + 细线，配水墨底图最合适',
        builtin: true,
        vars: {
            panelBg: 'rgba(250,246,239,.86)',
            barBg: 'rgba(250,246,239,.80)',
            cardBg: 'rgba(252,249,243,.88)',
            cardLine: 'rgba(176,150,110,.30)',
            accent: '#a8845a',
            title: '#4a3f33',
            text: '#5b5045',
            veil: 0.10,
            radius: 14,
            cardH: 200,
            cardPad: 15,
            font: 1
        }
    }
];

/** 空变量 → 全默认值 */
export function niTbDefaultVars() {
    return {
        art: '',
        accent: '',
        text: '',
        title: '',
        barBg: '',
        cardBg: '',
        cardLine: '',
        panelBg: '',
        veil: 0,
        radius: 0,
        cardH: 0,
        cardPad: 0,
        font: 1
    };
}

function niTbNum(v, min, max, def) {
    const n = Number(v);
    if (!Number.isFinite(n)) return def;
    return Math.min(max, Math.max(min, n));
}

/** 把任意来源（旧存档、导入的 json、UI 里改了一半的对象）规整成合法皮肤 */
export function niTbNormalizeVars(raw) {
    const d = niTbDefaultVars();
    const src = raw && typeof raw === 'object' ? raw : {};
    const out = { ...d };
    if (typeof src.art === 'string' && /^data:image\//.test(src.art)) out.art = src.art;
    for (const k of ['accent', 'text', 'title', 'barBg', 'cardBg', 'cardLine', 'panelBg']) {
        if (typeof src[k] === 'string' && src[k].trim()) out[k] = src[k].trim();
    }
    out.veil = niTbNum(src.veil, 0, 0.85, d.veil);
    out.radius = niTbNum(src.radius, 0, 28, d.radius);
    out.cardH = niTbNum(src.cardH, 150, 320, d.cardH);
    out.cardPad = niTbNum(src.cardPad, 8, 26, d.cardPad);
    out.font = niTbNum(src.font, 0.85, 1.2, 1);
    return out;
}

/** 皮肤 → 挂在 DOM 上的 CSS 变量（不含 art，art 单独处理） */
export function niTbStyleVars(vars) {
    const v = niTbNormalizeVars(vars);
    const out = {};
    if (v.accent) out['--ni-tb-accent'] = v.accent;
    if (v.text) out['--ni-tb-text'] = v.text;
    if (v.title) out['--ni-tb-title'] = v.title;
    if (v.barBg) out['--ni-tb-bar-bg'] = v.barBg;
    if (v.cardBg) out['--ni-tb-card-bg'] = v.cardBg;
    if (v.cardLine) out['--ni-tb-card-line'] = v.cardLine;
    if (v.panelBg) out['--ni-tb-panel-bg'] = v.panelBg;
    if (v.veil > 0) out['--ni-tb-veil'] = String(v.veil);
    if (v.radius > 0) out['--ni-tb-radius'] = `${Math.round(v.radius)}px`;
    if (v.cardH > 0) out['--ni-tb-card-h'] = `${Math.round(v.cardH)}px`;
    if (v.cardPad > 0) out['--ni-tb-card-pad'] = `${Math.round(v.cardPad)}px`;
    if (v.font && v.font !== 1) out['--ni-tb-font'] = String(v.font);
    return out;
}

// ── 取色 ─────────────────────────────────────────────────────

function niTbHex(n) {
    return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
}

export function niTbRgbToHex(r, g, b) {
    return `#${niTbHex(r)}${niTbHex(g)}${niTbHex(b)}`;
}

/** 相对亮度（WCAG），0=黑 1=白 */
export function niTbLuminance(r, g, b) {
    const f = (c) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/**
 * 从像素样本里提炼一套配色。
 * @param {Array<{r:number,g:number,b:number,a?:number}>} pixels
 */
export function niTbPaletteFromPixels(pixels) {
    const list = (Array.isArray(pixels) ? pixels : []).filter(p => p && (p.a === undefined || p.a > 8));
    if (!list.length) {
        return { lum: 0.86, primary: '#8f63c9', secondary: '#c8b4e6', dark: false, text: '#4b3f63', onPrimary: '#ffffff' };
    }
    let sr = 0, sg = 0, sb = 0, sumL = 0;
    let best = { s: -1, r: 143, g: 99, b: 201 };
    for (const p of list) {
        sr += p.r; sg += p.g; sb += p.b;
        sumL += niTbLuminance(p.r, p.g, p.b);
        const mx = Math.max(p.r, p.g, p.b);
        const mn = Math.min(p.r, p.g, p.b);
        if (mx === 0) continue;
        const sat = (mx - mn) / mx;
        const light = (mx + mn) / 510;
        // 偏好「有颜色、且不太黑也不太白」的像素作为主色
        const score = sat * (1 - Math.abs(light - 0.55) * 1.2);
        if (score > best.s) best = { s: score, r: p.r, g: p.g, b: p.b };
    }
    const n = list.length;
    const lum = sumL / n;
    const dark = lum < 0.42;
    const primary = niTbRgbToHex(best.r, best.g, best.b);
    const secondary = niTbRgbToHex(
        Math.min(255, best.r + (255 - best.r) * 0.55),
        Math.min(255, best.g + (255 - best.g) * 0.55),
        Math.min(255, best.b + (255 - best.b) * 0.55)
    );
    const text = dark ? '#f2eef8' : '#3f3644';
    const onPrimary = niTbLuminance(best.r, best.g, best.b) > 0.55 ? '#3b2f4a' : '#ffffff';
    return { lum, primary, secondary, dark, text, onPrimary };
}

/** 取色结果 → 一套皮肤变量（供上传后自动填充，用户还能再改） */
export function niTbVarsFromPalette(p) {
    const dark = !!p.dark;
    return niTbNormalizeVars({
        accent: p.primary,
        title: dark ? '#fdfbff' : '#39303f',
        text: p.text,
        barBg: dark ? 'rgba(28,24,38,.62)' : 'rgba(255,255,255,.74)',
        cardBg: dark ? 'rgba(30,26,40,.58)' : 'rgba(255,255,255,.84)',
        cardLine: dark ? 'rgba(255,255,255,.22)' : 'rgba(120,105,150,.24)',
        panelBg: dark ? 'rgba(22,18,30,.55)' : 'rgba(255,255,255,.70)',
        veil: dark ? 0.34 : 0.16,
        radius: 16,
        cardH: 204,
        cardPad: 14,
        font: 1
    });
}

/** 读取图片 → 缩略图取样（浏览器环境；测试里不调用） */
export function niTbSampleImage(dataUrl, size = 32) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            try {
                const c = document.createElement('canvas');
                c.width = size; c.height = size;
                const ctx = c.getContext('2d', { willReadFrequently: true });
                ctx.drawImage(img, 0, 0, size, size);
                const d = ctx.getImageData(0, 0, size, size).data;
                const px = [];
                for (let i = 0; i < d.length; i += 4) px.push({ r: d[i], g: d[i + 1], b: d[i + 2], a: d[i + 3] });
                resolve(niTbPaletteFromPixels(px));
            } catch {
                resolve(niTbPaletteFromPixels([]));
            }
        };
        img.onerror = () => resolve(niTbPaletteFromPixels([]));
        img.src = dataUrl;
    });
}

/** 文件 → 压缩后的 dataURL（长边 ≤ max，webp，失败回落 jpeg） */
export function niTbFileToArt(file, { max = 1400, quality = 0.84 } = {}) {
    return new Promise((resolve, reject) => {
        if (!file) { reject(new Error('没有文件')); return; }
        const fr = new FileReader();
        fr.onerror = () => reject(new Error('读取文件失败'));
        fr.onload = () => {
            const src = String(fr.result || '');
            const img = new Image();
            img.onerror = () => reject(new Error('这个文件不是图片'));
            img.onload = () => {
                try {
                    const scale = Math.min(1, max / Math.max(img.width || 1, img.height || 1));
                    const w = Math.max(1, Math.round((img.width || 1) * scale));
                    const h = Math.max(1, Math.round((img.height || 1) * scale));
                    const c = document.createElement('canvas');
                    c.width = w; c.height = h;
                    const ctx = c.getContext('2d');
                    ctx.drawImage(img, 0, 0, w, h);
                    let out = '';
                    try { out = c.toDataURL('image/webp', quality); } catch { out = ''; }
                    if (!out || !/^data:image\/webp/.test(out)) out = c.toDataURL('image/jpeg', quality);
                    resolve({ dataUrl: out, width: w, height: h });
                } catch (e) {
                    reject(e);
                }
            };
            img.src = src;
        };
        fr.readAsDataURL(file);
    });
}

/** 找皮肤：先看用户列表，再看内置 */
export function niTbFindSkin(skins, id) {
    const list = Array.isArray(skins) ? skins : [];
    const hit = list.find(s => s && s.id === id);
    if (hit) return hit;
    const builtin = NI_TB_BUILTIN_SKINS.find(s => s.id === id);
    return builtin || NI_TB_BUILTIN_SKINS[0];
}

export function niTbAllSkins(userSkins) {
    const list = (Array.isArray(userSkins) ? userSkins : [])
        .filter(s => s && typeof s.id === 'string' && s.id)
        .map(s => ({ ...s, vars: niTbNormalizeVars(s.vars), builtin: false }));
    return [...NI_TB_BUILTIN_SKINS, ...list];
}

/** 给皮肤起个不重复的名字 */
export function niTbUniqueSkinName(skins, base = '我的皮肤') {
    const used = new Set((Array.isArray(skins) ? skins : []).map(s => String(s?.name || '')));
    if (!used.has(base)) return base;
    for (let i = 2; i < 999; i++) {
        const n = `${base} ${i}`;
        if (!used.has(n)) return n;
    }
    return `${base} ${Date.now()}`;
}
