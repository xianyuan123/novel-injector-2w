/**
 * 穿书状态栏：皮肤（底图 + 配色 + 尺寸）
 *
 * 只做三件事：
 *  1. 把用户上传的图压成 webp data URI
 *  2. 从图里取几个颜色，自动配出「能看清字」的一套
 *  3. 把 skin 规整成安全的值（NaN / 越界 / 非 data: 的图都挡掉）
 */

export const NI_TB_SKIN_DEFAULT = Object.freeze({
    art: '',
    veil: 0,
    accent: '',
    title: '',
    text: '',
    barBg: '',
    cardBg: '',
    cardLine: '',
    radius: 16,
    cardH: 196,
    cardPad: 14,
    forcePad: 0
});

const clamp = (v, lo, hi, dflt) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return dflt;
    return Math.min(hi, Math.max(lo, n));
};

/** 只接受 data:image 的字符串，别的一律清空（防止 http 图或注入） */
export function niTbCleanArt(art) {
    const s = String(art || '');
    return /^data:image\/(webp|png|jpe?g);base64,[A-Za-z0-9+/=]+$/.test(s) ? s : '';
}

/** 把随手传进来的 skin 规整成合法值；缺省项回落到默认 */
export function niTbNormalizeSkin(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const hex = (v) => (/^#[0-9a-fA-F]{6}$/.test(String(v || '')) ? String(v) : '');
    const padSrc = src.pad;
    let pad = null;
    if (padSrc && typeof padSrc === 'object') {
        const cp = (v) => Math.max(0, Math.min(30, Math.round((Number(v) || 0) * 10) / 10));
        pad = { t: cp(padSrc.t), r: cp(padSrc.r), b: cp(padSrc.b), l: cp(padSrc.l) };
    }
    return {
        art: niTbCleanArt(src.art),
        veil: clamp(src.veil, 0, 0.85, 0),
        accent: hex(src.accent),
        title: hex(src.title),
        text: hex(src.text),
        barBg: hex(src.barBg),
        cardBg: hex(src.cardBg),
        cardLine: hex(src.cardLine),
        radius: clamp(src.radius, 0, 28, NI_TB_SKIN_DEFAULT.radius),
        cardH: clamp(src.cardH, 150, 340, NI_TB_SKIN_DEFAULT.cardH),
        cardPad: clamp(src.cardPad, 8, 26, NI_TB_SKIN_DEFAULT.cardPad),
        forcePad: clamp(src.forcePad, 0, 14, 0),
        pad
    };
}

/* ── 取色 ───────────────────────────────────────────── */

export function niTbRgbToHex(r, g, b) {
    const h = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return '#' + h(r) + h(g) + h(b);
}

/** WCAG 相对亮度，用来判断底图是深是浅 */
export function niTbLuminance(r, g, b) {
    const f = (v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** #rrggbb → [r,g,b] */
export function niTbHexToRgb(hex) {
    const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || ''));
    if (!m) return [0, 0, 0];
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 两色的对比度（WCAG，1~21） */
export function niTbContrast(hexA, hexB) {
    const la = niTbLuminance(...niTbHexToRgb(hexA));
    const lb = niTbLuminance(...niTbHexToRgb(hexB));
    const hi = Math.max(la, lb), lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
}

/** 主色在给定底色上至少要能看清：不够就压暗（浅底）或提亮（深底） */
export function niTbEnsureContrast(hex, bg, minRatio = 3) {
    let rgb = niTbHexToRgb(hex);
    const goDark = niTbLuminance(...niTbHexToRgb(bg || '#ffffff')) > 0.5;
    for (let i = 0; i < 24; i++) {
        const cur = niTbRgbToHex(...rgb);
        if (niTbContrast(cur, bg) >= minRatio) return cur;
        rgb = goDark
            ? rgb.map(v => v * 0.9)
            : rgb.map(v => Math.min(255, v * 1.08 + 6));
    }
    return niTbRgbToHex(...rgb);
}

/**
 * 从像素取样里算出一套颜色。
 * @param {Array<[number,number,number]>} pixels 0~255 的 RGB
 */
export function niTbPaletteFromPixels(pixels) {
    const list = Array.isArray(pixels) ? pixels.filter(p => Array.isArray(p) && p.length >= 3) : [];
    if (!list.length) return null;

    let sr = 0, sg = 0, sb = 0, lum = 0;
    list.forEach(([r, g, b]) => { sr += r; sg += g; sb += b; lum += niTbLuminance(r, g, b); });
    const n = list.length;
    const avg = [sr / n, sg / n, sb / n];
    const dark = (lum / n) < 0.42;

    // 主色：饱和度够、亮度居中偏彩的那部分，取加权平均；没有就用平均色
    let cr = 0, cg = 0, cb = 0, weight = 0;
    list.forEach(([r, g, b]) => {
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        const sat = mx === 0 ? 0 : (mx - mn) / mx;
        const light = (mx + mn) / 510;
        const w = sat * (1 - Math.abs(light - 0.55) * 1.2);
        if (w <= 0.04) return;
        cr += r * w; cg += g * w; cb += b * w; weight += w;
    });
    const accent = weight > 0
        ? [cr / weight, cg / weight, cb / weight]
        : [avg[0] * 0.9, avg[1] * 0.85, avg[2] * 0.95];

    const canvas = dark
        ? { barBg: '#242030', cardBg: '#2c2739', cardLine: '#3d3650', title: '#f2eef8', text: '#cfc7dd', veil: 0.34 }
        : { barBg: '#ffffff', cardBg: '#ffffff', cardLine: '#e9e4f0', title: '#2a2436', text: '#5f576e', veil: 0.18 };
    // 主色太浅的话压暗一点，保证「进行中」「自动」这类小字在白卡上看得清
    const accentHex = niTbEnsureContrast(niTbRgbToHex(accent[0], accent[1], accent[2]), canvas.cardBg, 3.2);

    return {
        dark,
        avgHex: niTbRgbToHex(avg[0], avg[1], avg[2]),
        accent: accentHex,
        canvas
    };
}

/**
 * 从整张图里认出「画好的面板」大概在哪：
 * 面板区的特点是「亮 + 不怎么花」，所以先按行/列统计达标像素占比，
 * 取最长的连续区间当作面板的上下左右边，输出百分比留边（都以宽度为基准）。
 */
export function niTbDetectPanelBox(pixels, w, h, opts = {}) {
    const width = Math.max(1, w | 0), height = Math.max(1, h | 0);
    const list = Array.isArray(pixels) ? pixels : [];
    if (list.length < width * height) return null;
    const minLum = opts.minLum != null ? opts.minLum : 0.6;
    const maxSat = opts.maxSat != null ? opts.maxSat : 0.5;
    const rowNeed = opts.rowNeed != null ? opts.rowNeed : 0.32;

    const isPanel = (r, g, b) => {
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        const sat = mx === 0 ? 0 : (mx - mn) / mx;
        return niTbLuminance(r, g, b) >= minLum && sat <= maxSat;
    };
    const at = (x, y) => list[y * width + x] || [0, 0, 0];
    const hit = (x, y) => { const p = at(x, y); return isPanel(p[0], p[1], p[2]); };

    const longestRun = (scores, need) => {
        let best = null, start = -1;
        for (let i = 0; i <= scores.length; i++) {
            const ok = i < scores.length && scores[i] >= need;
            if (ok && start < 0) start = i;
            if (!ok && start >= 0) {
                if (!best || i - start > best[1] - best[0]) best = [start, i - 1];
                start = -1;
            }
        }
        return best;
    };

    // 第一遍：整行里有多少比例是「面板色」→ 得到上下边界
    const rowScore = [];
    for (let y = 0; y < height; y++) {
        let c = 0;
        for (let x = 0; x < width; x++) if (hit(x, y)) c++;
        rowScore.push(c);
    }
    const rows = longestRun(rowScore, width * rowNeed);
    if (!rows) return null;
    const [top, bottom] = rows;
    const bandH = bottom - top + 1;
    if (bandH < height * 0.3) return null;

    // 第二遍：只在这条带里统计每一列 → 得到左右边界
    const colScore = [];
    for (let x = 0; x < width; x++) {
        let c = 0;
        for (let y = top; y <= bottom; y++) if (hit(x, y)) c++;
        colScore.push(c);
    }
    const cols = longestRun(colScore, bandH * 0.6);
    if (!cols) return null;
    const [left, right] = cols;
    if ((right - left + 1) < width * 0.4) return null;
    // 整张图都是面板色，说明没有画外框，不用留边
    if ((bottom - top + 1) >= height * 0.95 && (right - left + 1) >= width * 0.95) return null;

    // 上下留边按原图高宽比换算成「宽度百分比」，这样 CSS 的 padding 百分比才对得上
    const yScale = Number(opts.aspect) > 0 ? Number(opts.aspect) : (height / width);
    const pct = (v, base) => Math.max(0, Math.min(30, Math.round((v / base) * 1000) / 10));
    const pctY = (rows) => Math.max(0, Math.min(30, Math.round((rows / height) * yScale * 1000) / 10));
    return {
        t: pctY(top),
        r: pct(width - 1 - right, width),
        b: pctY(height - 1 - bottom),
        l: pct(left, width)
    };
}


/** 把底色按雾化比例与白色混合，得到实际看到的底色 */
export function niTbMixWithWhite(hex, alpha) {
    const a = Math.max(0, Math.min(1, Number(alpha) || 0));
    const [r, g, b] = niTbHexToRgb(hex);
    return niTbRgbToHex(r + (255 - r) * a, g + (255 - g) * a, b + (255 - b) * a);
}

/** 取色结果 → 一份完整 skin（art 由调用方带进来） */
export function niTbSkinFromPalette(palette, art = '') {
    const base = niTbNormalizeSkin({ ...NI_TB_SKIN_DEFAULT, art });
    if (!palette) return base;
    const c = palette.canvas;
    return niTbNormalizeSkin({
        ...base,
        accent: palette.accent,
        title: niTbEnsureContrast(c.title, niTbMixWithWhite(c.cardBg, c.veil), 7),
        text: niTbEnsureContrast(c.text, niTbMixWithWhite(c.cardBg, c.veil), 4.5),
        barBg: c.barBg,
        cardBg: c.cardBg,
        cardLine: c.cardLine,
        veil: c.veil
    });
}

/* ── 浏览器侧：压图 + 取样 ─────────────────────────── */

/** 把 File 压成 webp data URI（限制最长边，避免几 MB 的 base64 塞进设置） */
export function niTbFileToArt(file, { max = 1400, quality = 0.84 } = {}) {
    return new Promise((resolve, reject) => {
        if (!file) { reject(new Error('没有文件')); return; }
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            try {
                const scale = Math.min(1, max / Math.max(img.width, img.height));
                const w = Math.max(1, Math.round(img.width * scale));
                const h = Math.max(1, Math.round(img.height * scale));
                const cv = document.createElement('canvas');
                cv.width = w; cv.height = h;
                cv.getContext('2d').drawImage(img, 0, 0, w, h);
                let out = '';
                try { out = cv.toDataURL('image/webp', quality); } catch { out = ''; }
                if (!/^data:image\/webp/.test(out)) out = cv.toDataURL('image/jpeg', 0.86);
                resolve(out);
            } catch (e) { reject(e); }
            finally { URL.revokeObjectURL(url); }
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读不出来')); };
        img.src = url;
    });
}

/** 从图里取 32×32 的像素，喂给 niTbPaletteFromPixels */
export function niTbSampleImage(dataUrl, size = 32) {
    return niTbSampleImageInfo(dataUrl, size).then(r => r.pixels);
}

/** 同上，但同时带回原图尺寸与像素网格（识别面板区要用） */
export function niTbSampleImageInfo(dataUrl, size = 32) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            try {
                const cv = document.createElement('canvas');
                cv.width = size; cv.height = size;
                const ctx = cv.getContext('2d');
                ctx.drawImage(img, 0, 0, size, size);
                const data = ctx.getImageData(0, 0, size, size).data;
                const grid = [];
                for (let i = 0; i < data.length; i += 4) {
                    const alpha = data[i + 3];
                    const px = alpha < 40 ? [255, 255, 255] : [data[i], data[i + 1], data[i + 2]];
                    grid.push(px);
                }
                resolve({
                    pixels: grid,
                    w: size,
                    h: size,
                    width: img.naturalWidth || size,
                    height: img.naturalHeight || size,
                    aspect: (img.naturalHeight || size) / (img.naturalWidth || size)
                });
            } catch (e) { reject(e); }
        };
        img.onerror = () => reject(new Error('图片读不出来'));
        img.src = dataUrl;
    });
}
