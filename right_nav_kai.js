(function () {
    const MODULE_NAME = 'right_nav_kai';
    const LOG_PREFIX = '[RightNavKai DEBUG]';

    // --- 拡張子自動検出＆動画対応ロジック ---
    const ALLOWED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp', 'mp4', 'webm'];

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

    async function detectMediaExtension(basePath) {
        if (!basePath || typeof basePath !== 'string' || !basePath.trim()) return null;
        const cleanPath = basePath.trim();
        
        if (cleanPath.match(/\.(png|jpg|jpeg|webp|gif|avif|bmp|mp4|webm)$/i)) {
            return cleanPath;
        }

        for (const ext of ALLOWED_EXTENSIONS) {
            const pathWithExt = `${cleanPath}.${ext}`;
            const exists = await checkMediaExists(pathWithExt);
            if (exists) {
                return pathWithExt;
            }
        }
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
            video.defaultMuted = true;
            video.playsInline = true;
            video.classList.add('right-nav-char-image');
            
            // 縦横比を維持してはみ出さないようにcontainを指定
            video.style.width = '100%';
            video.style.height = '100%';
            video.style.objectFit = 'contain';
            video.style.backgroundColor = 'rgba(0, 0, 0, 0.4)'; // 余白部分の背景色
            video.style.display = 'block';

            video.play().catch(err => {
                console.warn(`${LOG_PREFIX} 動画の自動再生がブロックされました:`, err);
            });

            video.onerror = async () => {
                console.warn(`${LOG_PREFIX} 動画読み込みエラー。拡張子再検出を実行: ${src}`);
                const detected = await detectMediaExtension(src);
                if (detected && detected !== src) {
                    video.src = detected;
                    video.play().catch(() => {});
                }
            };
            return video;
        } else {
            const img = document.createElement('img');
            img.src = src;
            img.alt = altText;
            img.classList.add('right-nav-char-image');
            
            // 縦横比を維持してはみ出さないようにcontainを指定
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'contain';
            img.style.backgroundColor = 'rgba(0, 0, 0, 0.4)'; // 余白部分の背景色
            img.style.display = 'block';

            img.onerror = async () => {
                console.warn(`${LOG_PREFIX} 画像読み込みエラー。拡張子再検出を実行: ${src}`);
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
            // json読み込み失敗時は無視
        }

        const context = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
        if (context && context.characters) {
            const charObj = context.characters.find(c => c.name === charName);
            if (charObj && charObj.avatar) {
                return `characters/${charObj.avatar}`;
            }
        }

        const defaultPath = await detectMediaExtension(`addchara/${charName}/default`) 
                          || await detectMediaExtension('addchara/default');
        return defaultPath;
    }

    // --- 右ナビパネル内のキャラクター画像更新 ---
    async function updateCharacterImages() {
        const panel = document.querySelector('#right-nav-panel, .right-nav-panel, #rm_bar, #character_list');
        if (!panel) return;

        const charBlocks = document.querySelectorAll('.right-nav-char-block, .character-block, .character_select');
        if (charBlocks.length === 0) {
            console.log(`${LOG_PREFIX} Updating character images... Found 0 character blocks (パネル未描画のためスキップ)`);
            return;
        }

        console.log(`${LOG_PREFIX} Updating character images... Found ${charBlocks.length} character blocks`);

        for (let i = 0; i < charBlocks.length; i++) {
            const block = charBlocks[i];
            
            let charName = block.dataset.name || block.getAttribute('data-name') || block.getAttribute('chid');
            if (!charName) {
                const nameEl = block.querySelector('.character-name, .char-name, .ch_name');
                if (nameEl) charName = nameEl.textContent.trim();
            }

            if (!charName) continue;

            console.log(`${LOG_PREFIX} Processing character #${i}: ${charName}`);

            const mediaSrc = await getCharacterImageSrc(charName);
            if (!mediaSrc) continue;

            let imgContainer = block.querySelector('.right-nav-img-container, .avatar');
            if (!imgContainer) {
                imgContainer = document.createElement('div');
                imgContainer.className = 'right-nav-img-container';
                imgContainer.style.width = '100%';
                imgContainer.style.height = '100%';
                imgContainer.style.overflow = 'hidden';
                block.insertBefore(imgContainer, block.firstChild);
            } else {
                imgContainer.style.width = '100%';
                imgContainer.style.height = '100%';
                imgContainer.style.overflow = 'hidden';
            }

            const currentMedia = imgContainer.querySelector('.right-nav-char-image');
            if (!currentMedia || currentMedia.getAttribute('data-src') !== mediaSrc) {
                imgContainer.innerHTML = '';
                const newMedia = createMediaElement(mediaSrc, charName);
                newMedia.setAttribute('data-src', mediaSrc);
                imgContainer.appendChild(newMedia);
            }
        }
    }

    function debounce(func, wait) {
        let timeout;
        return function (...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func(...args), wait);
        };
    }

    const debouncedUpdate = debounce(updateCharacterImages, 300);

    function setupMutationObserver() {
        const targetNode = document.body;
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.addedNodes.length > 0) {
                    debouncedUpdate();
                    break;
                }
            }
        });

        observer.observe(targetNode, { childList: true, subtree: true });
        console.log(`${LOG_PREFIX} パネル描画の監視を開始しました。`);
    }

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
