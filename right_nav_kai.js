(function () {
    'use strict';

    let debounceTimer;
    const DEBUG = true; // デバッグモード

    // 対応する画像拡張子のリスト
    const ALLOWED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp'];

    // デバッグログ出力関数
    function debugLog(...args) {
        if (DEBUG) {
            console.log('[RightNavKai DEBUG]', ...args);
        }
    }

    // 画像の存在確認関数
    function checkImageExists(imageUrl) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve(true);
            img.onerror = () => resolve(false);
            img.src = imageUrl;
        });
    }

    // 拡張子自動検出関数
    async function detectImageExtension(imagePath) {
        if (!imagePath) return null;
        
        // 既に拡張子がある場合はそのまま返す
        if (imagePath.match(/\.(png|jpg|jpeg|webp|gif|avif|bmp)$/i)) {
            debugLog(`既に拡張子あり: ${imagePath}`);
            return imagePath;
        }
        
        debugLog(`拡張子自動検出を開始: ${imagePath}`);
        
        // 各拡張子を試して存在確認
        for (const ext of ALLOWED_EXTENSIONS) {
            const imagePathWithExt = `${imagePath}.${ext}`;
            const exists = await checkImageExists(imagePathWithExt);
            if (exists) {
                debugLog(`✅ 拡張子自動検出成功: ${imagePathWithExt}`);
                return imagePathWithExt;
            }
        }
        
        debugLog(`❌ 拡張子自動検出失敗: ${imagePath}`);
        return null;
    }

    // キャラクター名抽出関数
    function extractCharacterName(title) {
        debugLog('Extracting name from title:', title);
        const match = title.match(/\[Character\]\s*(.+?)\s*File:/);
        const name = match ? match[1].trim() : null;
        debugLog('Extracted character name:', name);
        return name;
    }

    // ランダム選択関数
    function getRandomImageSource(imageSource) {
        if (Array.isArray(imageSource)) {
            // 配列の場合、ランダムに1つ選択
            if (imageSource.length === 0) {
                debugLog("画像配列が空です");
                return null;
            }
            const randomIndex = Math.floor(Math.random() * imageSource.length);
            const selectedImage = imageSource[randomIndex];
            debugLog(`🎲 ランダム選択: ${selectedImage} (${randomIndex + 1}/${imageSource.length})`);
            return selectedImage;
        } else {
            // 文字列の場合、そのまま返す
            return imageSource;
        }
    }

    // JSON取得関数（キャッシュ機能強化版）
    async function fetchCharacterImage(characterName, imgElement) {
        if (!characterName) {
            debugLog('Character name is missing');
            return;
        }

        try {
            const url = `addchara/${characterName}/${characterName}_ext.json`;
            debugLog(`Fetching JSON from: ${url}`);

            const response = await fetch(url);
            if (!response.ok) {
                debugLog(`Fetch failed: ${response.status} ${response.statusText}`);
                return;
            }

            const jsonData = await response.json();
            debugLog(`JSON response for ${characterName}:`, jsonData);

            function findThumbnailUrl(obj) {
                if (typeof obj !== 'object' || obj === null) return null;
                
                if (obj.image_display_extension?.thumbnail) {
                    return obj.image_display_extension.thumbnail;
                }
                
                for (const key in obj) {
                    if (typeof obj[key] === 'object') {
                        const result = findThumbnailUrl(obj[key]);
                        if (result) return result;
                    }
                }
                return null;
            }

            let imageUrl = findThumbnailUrl(jsonData);

            if (!imageUrl) {
                debugLog(`Image URL not found in JSON for ${characterName}`);
                return;
            }

            debugLog(`Found image URL for ${characterName}:`, imageUrl);

            // サムネイルが配列の場合、ランダムに1つ選択
            imageUrl = getRandomImageSource(imageUrl);

            // 拡張子自動検出を実行
            const detectedImageUrl = await detectImageExtension(imageUrl);
            if (detectedImageUrl) {
                imageUrl = detectedImageUrl;
                debugLog(`Using detected image URL: ${imageUrl}`);
            } else {
                debugLog(`Using original image URL: ${imageUrl}`);
            }

            imgElement.src = imageUrl;
            
            // 画像読み込みエラーハンドリング
            imgElement.onerror = async function() {
                debugLog(`画像読み込みエラー: ${imageUrl}`);
                
                // 拡張子自動検出を再試行
                if (imageUrl && !imageUrl.match(/\.(png|jpg|jpeg|webp|gif|avif|bmp)$/i)) {
                    debugLog(`🔄 拡張子自動検出を再試行: ${imageUrl}`);
                    const retryUrl = await detectImageExtension(imageUrl);
                    if (retryUrl) {
                        debugLog(`✅ 再試行成功: ${retryUrl}`);
                        imgElement.src = retryUrl;
                    } else {
                        debugLog(`❌ 再試行失敗、デフォルト画像を使用`);
                        // デフォルト画像にフォールバック
                        imgElement.src = 'addchara/default.png';
                    }
                } else {
                    // 既に拡張子がある場合はデフォルト画像にフォールバック
                    imgElement.src = 'addchara/default.png';
                }
            };

        } catch (error) {
            console.error(`Right Nav Kai: Failed to load image for ${characterName}`, error);
            debugLog(`Error details: ${error.message}`);
        }
    }

    // 画像更新関数
    function updateCharacterImages() {
        debugLog('Updating character images...');
        const characterBlocks = document.querySelectorAll('#right-nav-panel .character_select');
        debugLog(`Found ${characterBlocks.length} character blocks`);

        characterBlocks.forEach((block, index) => {
            const avatarElement = block.querySelector('.avatar');
            if (!avatarElement) return;

            const title = avatarElement.getAttribute('title');
            if (!title) return;

            const characterName = extractCharacterName(title);
            if (!characterName) return;

            const imgElement = avatarElement.querySelector('img');
            if (!imgElement) return;

            debugLog(`Processing character #${index}: ${characterName}`);
            fetchCharacterImage(characterName, imgElement);
        });
    }

    // Observer設定関数
    function setupObserverForNavPanel(panel) {
        debugLog('Setting up observer for nav panel');

        const observer = new MutationObserver((mutations) => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                if (panel.classList.contains('openDrawer')) {
                    debugLog('Panel is open, triggering image update.');
                    updateCharacterImages();
                }
            }, 100);
        });

        observer.observe(panel, {
            attributes: true,
            attributeFilter: ['style', 'class'],
            childList: true,
            subtree: true
        });

        const charList = document.getElementById('rm_print_characters_block');
        if (charList) {
            debugLog('Setting up observer for character list');
            const listObserver = new MutationObserver(() => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    if (panel.classList.contains('openDrawer')) {
                        debugLog('Character list updated, triggering image update.');
                        updateCharacterImages();
                    }
                }, 100);
            });
            listObserver.observe(charList, {
                childList: true,
                subtree: true
            });
        }

        if (panel.classList.contains('openDrawer')) {
            setTimeout(updateCharacterImages, 200);
        }
    }

    // 初期化関数
    function initialize() {
        debugLog('Initializing Right Nav Kai extension');
        
        const navPanel = document.getElementById('right-nav-panel');
        if (navPanel) {
            setupObserverForNavPanel(navPanel);
        } else {
            const bodyObserver = new MutationObserver((mutations, observer) => {
                const foundPanel = document.getElementById('right-nav-panel');
                if (foundPanel) {
                    debugLog('Nav panel found via observer');
                    setupObserverForNavPanel(foundPanel);
                    observer.disconnect();
                }
            });
            bodyObserver.observe(document.body, {
                childList: true,
                subtree: true
            });
        }
    }

    debugLog('Right Nav Kai extension loaded');

    // DOMの準備ができてから初期化を実行
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        initialize();
    } else {
        document.addEventListener('DOMContentLoaded', initialize);
    }
})();
