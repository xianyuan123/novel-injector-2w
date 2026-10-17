export function niNovelNameFromFileName(fileName = '') {
    return String(fileName || '')
        .trim()
        .replace(/\.[^.]+$/u, '')
        .trim() || '未命名小说';
}

export function niFindCurrentNovelIndex(library = [], novelKey = '') {
    if (!novelKey) return -1;
    return (Array.isArray(library) ? library : []).findIndex(snap => snap?.data?._novelKey === novelKey);
}

export function createAutosaveController({
    state,
    getSettings,
    saveSettingsDebounced,
    saveNovelSnapshot,
    updateNovelSnapshot,
    renderNovelLibrary = () => {},
    delay = 1200,
    // 最长等待：连续编辑时定时器会被反复重置，光有防抖会导致永远不落盘
    maxDelay = 10000,
    setTimer = (callback, ms) => setTimeout(callback, ms),
    clearTimer = timerId => clearTimeout(timerId),
    logger = console,
} = {}) {
    let timer = null;
    let saving = false;
    let rerunRequested = false;
    let rerunNovelKey = '';
    let firstDirtyAt = 0;

    function isEnabled() {
        return getSettings()?.autoSaveEnabled === true;
    }

    function setSourceFileName(fileName = '') {
        const cfg = getSettings();
        if (!cfg) return;
        cfg._autoSaveSourceName = niNovelNameFromFileName(fileName);
        saveSettingsDebounced();
    }

    async function saveNow() {
        if (timer) {
            clearTimer(timer);
            timer = null;
        }
        firstDirtyAt = 0;
        if (!isEnabled()) {
            rerunRequested = false;
            return false;
        }
        if (saving) {
            rerunRequested = true;
            rerunNovelKey = String(state?.novelKey || '');
            return false;
        }

        const cfg = getSettings() || {};
        const idx = niFindCurrentNovelIndex(cfg.novelLibrary, state?.novelKey);
        if (idx < 0 && !state?.fileLoaded) return false;

        saving = true;
        try {
            let saved;
            if (idx >= 0) {
                saved = await updateNovelSnapshot(idx, {
                    confirmUpdate: false,
                    notify: false,
                    throwOnError: true,
                    scheduleAutosave: false,
                });
            } else {
                saved = await saveNovelSnapshot(cfg._autoSaveSourceName || '未命名小说', {
                    notifyErrors: false,
                    throwOnError: true,
                    scheduleAutosave: false,
                });
            }
            if (saved === false) return false;
            renderNovelLibrary();
            return true;
        } catch (e) {
            logger.warn('[NI] 自动保存失败:', e);
            return false;
        } finally {
            saving = false;
            if (rerunRequested) {
                const expectedNovelKey = rerunNovelKey;
                rerunRequested = false;
                rerunNovelKey = '';
                if (isEnabled() && String(state?.novelKey || '') === expectedNovelKey) void saveNow();
            }
        }
    }

    function schedule({ immediate = false } = {}) {
        if (!isEnabled()) return;
        if (saving) {
            rerunRequested = true;
            rerunNovelKey = String(state?.novelKey || '');
            return;
        }
        const now = Date.now();
        if (!firstDirtyAt) firstDirtyAt = now;
        const waited = now - firstDirtyAt;
        // 防抖饥饿保护：连续输入会让下面的定时器被无限重置，攒到一个上限就直接落盘。
        if (immediate || waited >= maxDelay) {
            firstDirtyAt = 0;
            if (timer) {
                clearTimer(timer);
                timer = null;
            }
            void saveNow();
            return;
        }
        if (timer) clearTimer(timer);
        const scheduledNovelKey = String(state?.novelKey || '');
        const waitMs = Math.max(1, Math.min(delay, maxDelay - waited));
        timer = setTimer(() => {
            timer = null;
            firstDirtyAt = 0;
            if (String(state?.novelKey || '') !== scheduledNovelKey) return;
            void saveNow();
        }, waitMs);
    }

    function setEnabled(enabled) {
        const cfg = getSettings();
        if (!cfg) return;
        cfg.autoSaveEnabled = !!enabled;
        saveSettingsDebounced();
        if (enabled) schedule({ immediate: true });
        else {
            rerunRequested = false;
            rerunNovelKey = '';
            if (timer) {
                clearTimer(timer);
                timer = null;
            }
        }
    }

    return { isEnabled, setEnabled, setSourceFileName, schedule, saveNow };
}
