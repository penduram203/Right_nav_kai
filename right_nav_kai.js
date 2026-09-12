(function () {
    const MODULE_NAME = 'right_nav_kai';
    const LOG_PREFIX = '[RightNavKai DEBUG]';

    // 許容する拡張子リスト（画像・動画）
    const ALLOWED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp', 'mp4', 'webm'];

    // --- メディア検出結果のキャッシュ (404リクエストの連発を阻止) ---
    // key: basePath または url, value: 発見された有効なURL (存在しない場合は null)
    const mediaCache = new Map();

    function isVideoUrl(url) {
        if (!url || typeof url !== 'string') return false;
        return !!url.match(/\.(mp4|webm)$/i);
    }

    function checkMediaExists(mediaUrl) {
        return new Promise((resolve) => {
            if (!mediaUrl || typeof mediaUrl !== 'string' || !mediaUrl.trim()) return resolve(false);
            if (isVideoUrl(mediaUrl)) {
                const video = document.createElement('video');
                video.onloadedmetadata = () => resolve(true);
                video.onerror = () => resolve(false);
                video.src = mediaUrl;
            } else {
                const img = new Image();
                img.onload = () => resolve(true);
                img.onerror = () => resolve(false);
                img.src = mediaUrl;
            }
        });
    }

    // --- 拡張子自動検出 (キャッシュ対応) ---
    async function detectMediaExtension(basePath) {
        if (!basePath || typeof basePath !== 'string' || !basePath.trim()) return null;
        const cleanPath = basePath.trim();

        // 1. すでに検出結果（成功 or 404失敗）がキャッシュされていれば通信せずに即返す
        if (mediaCache.has(cleanPath)) {
            return mediaCache.get(cleanPath);
        }

        // 2. 既に拡張子が含まれている場合
        if (cleanPath.match(/\.(png|jpg|jpeg|webp|gif|avif|bmp|mp4|webm)$/i)) {
            const exists = await checkMediaExists(cleanPath);
            const result = exists ? cleanPath : null;
            mediaCache.set(cleanPath, result);
            return result;
        }

        // 3. 拡張子を順番に試行
        for (const ext of ALLOWED_EXTENSIONS) {
            const pathWithExt = `${cleanPath}.${ext}`;
            const exists = await checkMediaExists(pathWithExt);
            if (exists) {
                console.log(`${LOG_PREFIX} ✅ 拡張子自動検出（キャッシュ保存）: ${pathWithExt}`);
                mediaCache.set(cleanPath, pathWithExt);
                return pathWithExt;
            }
        }

        // 存在しなかった場合も null を記憶（次回からの 404 リクエストを完全にカット）
        mediaCache.set(cleanPath, null);
        return null;
    }

    // --- メディアDOM要素（img または video）の作成 ---
    function createMediaElement(src, altText = '') {
        if (isVideoUrl(src)) {
            const video = document.createElement('video');
            video.src = src;
            video.autoplay = true;
            video.loop = true;
            video.muted = true;
            video.playsInline = true;
            video.classList.add('right-nav-char-image');
            video.onerror = async () => {
                mediaCache.delete(src); // エラー時はキャッシュを破棄して再確認
                const detected = await detectMediaExtension(src);
                if (detected && detected !== src) {
                    video.src = detected;
                }
            };
            return video;
        } else {
            const img = document.createElement('img');
            img.src = src;
            img.alt = altText;
            img.classList.add('right-nav-char-image');
            img.onerror = async () => {
                mediaCache.delete(src); // エラー時はキャッシュを破棄して再確認
                const detected = await detectMediaExtension(src);
                if (detected && detected !== src) {
                    img.src = detected;
                }
            };
            return img;
        }
    }

    // --- キャラクター画像（サムネイル）パスの取得 ---
    async function getCharacterImageSrc(charName) {
        if (!charName) return null;

        // 1. _ext.json からのサムネイル/デフォルト画像検索
        try {
            const extPath = `addchara/${charName}/${charName}_ext.json`;
            const resp = await fetch(extPath);
            if (resp.ok) {
                const data = await resp.json();
                let candidate = null;

                if (data.image_display_extension) {
                    candidate = data.image_display_extension.thumbnail || data.image_display_extension.default;
                } else if (data.thumbnail || data.default) {
                    candidate = data.thumbnail || data.default;
                }

                if (candidate) {
                    const src = Array.isArray(candidate) ? candidate[0] : candidate;
                    const detected = await detectMediaExtension(src);
                    if (detected) {
                        console.log(`${LOG_PREFIX} _ext.json のサムネイルを使用: ${charName} -> ${detected}`);
                        return detected;
                    }
                }
            }
        } catch (e) {
            // json読み込み失敗時は無視して標準ルートへ
        }

        // 2. SillyTavern 内のアバター画像を取得
        const context = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
        if (context && context.characters) {
            const charObj = context.characters.find(c => c.name === charName);
            if (charObj && charObj.avatar) {
                return `characters/${charObj.avatar}`;
            }
        }

        // 3. デフォルト fallback パス
        const defaultPath = await detectMediaExtension(`addchara/${charName}/default`) 
                          || await detectMediaExtension('addchara/default');
        return defaultPath;
    }

    // --- 右ナビパネル内のキャラクター画像更新 ---
    async function updateCharacterImages() {
        const panel = document.querySelector('#right-nav-panel, .right-nav-panel');
        if (!panel) return;

        const charBlocks = panel.querySelectorAll('.right-nav-char-block, .character-block');
        if (charBlocks.length === 0) {
            return;
        }

        console.log(`${LOG_PREFIX} Updating character images... Found ${charBlocks.length} character blocks`);

        for (let i = 0; i < charBlocks.length; i++) {
            const block = charBlocks[i];
            
            // キャラクター名の取得
            let charName = block.dataset.name || block.getAttribute('data-name');
            if (!charName) {
                const nameEl = block.querySelector('.character-name, .char-name');
                if (nameEl) charName = nameEl.textContent.trim();
            }

            if (!charName) continue;

            const mediaSrc = await getCharacterImageSrc(charName);
            if (!mediaSrc) continue;

            // 既存の画像/動画コンテナを取得または作成
            let imgContainer = block.querySelector('.right-nav-img-container');
            if (!imgContainer) {
                imgContainer = document.createElement('div');
                imgContainer.className = 'right-nav-img-container';
                block.insertBefore(imgContainer, block.firstChild);
            }

            // 既存メディアと異なる場合のみ置き換え
            const currentMedia = imgContainer.querySelector('.right-nav-char-image');
            if (!currentMedia || currentMedia.getAttribute('data-src') !== mediaSrc) {
                imgContainer.innerHTML = '';
                const newMedia = createMediaElement(mediaSrc, charName);
                newMedia.setAttribute('data-src', mediaSrc);
                imgContainer.appendChild(newMedia);
            }
        }
    }

    // デバウンス処理
    function debounce(func, wait) {
        let timeout;
        return function (...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func(...args), wait);
        };
    }

    const debouncedUpdate = debounce(updateCharacterImages, 300);

    // --- DOM監視 (パネルの描画変化に追従) ---
    function setupMutationObserver() {
        const targetNode = document.body;
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.addedNodes.length > 0) {
                    const hasPanel = Array.from(mutation.addedNodes).some(node => 
                        node.nodeType === 1 && (node.id === 'right-nav-panel' || node.classList.contains('right-nav-panel') || node.querySelector('#right-nav-panel'))
                    );
                    if (hasPanel) {
                        debouncedUpdate();
                        break;
                    }
                }
            }
        });

        observer.observe(targetNode, { childList: true, subtree: true });
        console.log(`${LOG_PREFIX} #right-nav-panel の監視を開始しました。`);
    }

    // --- EventSource 安全監視 ---
    function setupEventSourceListeners() {
        if (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) {
            const context = SillyTavern.getContext();
            if (context && context.eventSource && context.eventTypes) {
                const { eventSource, eventTypes } = context;

                const safeOn = (eventType, handler) => {
                    if (eventType && typeof eventSource.on === 'function') {
                        eventSource.on(eventType, handler);
                    }
                };

                safeOn(eventTypes.CHAT_CHANGED, debouncedUpdate);
                safeOn(eventTypes.CHARACTER_SELECTED, debouncedUpdate);
                safeOn(eventTypes.CHARACTER_PAGE_LOADED, debouncedUpdate);

                console.log(`${LOG_PREFIX} Event listeners registered successfully`);
            }
        }
    }

    // --- 初期化 ---
    function init() {
        console.log(`${LOG_PREFIX} Right Nav Kai extension loaded`);
        console.log(`${LOG_PREFIX} Initializing Right Nav Kai extension`);
        
        setupEventSourceListeners();
        setupMutationObserver();
        debouncedUpdate();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
