import { extension_settings, saveSettingsToServer } from '../../../extensions.js';

(function () {
    'use strict';

    let debounceTimer;
    const DEBUG = true; // デバッグモード
    const MODULE_NAME = 'right_nav_kai';

    // デフォルト設定の定義
    const defaultSettings = {
        enabled: true,
        // 今後追加される拡張設定があればここに記述
    };

    // 対応する画像拡張子のリスト
    const ALLOWED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp'];

    // デバッグログ出力関数
    function debugLog(...args) {
        if (DEBUG) {
            console.log('[RightNavKai DEBUG]', ...args);
        }
    }

    // 設定の読み込みと初期化（localStorageからの移行処理含む）
    function loadSettings() {
        extension_settings[MODULE_NAME] = extension_settings[MODULE_NAME] || {};

        // 既存の localStorage データが存在する場合は移行
        const localData = localStorage.getItem('right_nav_kai_settings');
        if (localData) {
            try {
                const parsed = JSON.parse(localData);
                Object.assign(extension_settings[MODULE_NAME], parsed);
                localStorage.removeItem('right_nav_kai_settings');
                saveSettingsToServer();
                debugLog('Migrated settings from localStorage to extensionSettings (server)');
            } catch (e) {
                console.error('Failed to parse localStorage settings:', e);
            }
        }

        // デフォルト値の適用
        for (const key in defaultSettings) {
            if (extension_settings[MODULE_NAME][key] === undefined) {
                extension_settings[MODULE_NAME][key] = defaultSettings[key];
            }
        }
    }

    // 設定の保存関数
    function saveSettings() {
        saveSettingsToServer();
        debugLog('Settings saved to server');
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

    // タイトル属性等からキャラクター名を抽出するヘルパー関数
    function extractCharacterName(title) {
        if (!title) return null;
        return title.trim();
    }

    // キャラクター画像の取得および差し替え関数
    async function fetchCharacterImage(characterName, imgElement) {
        try {
            for (const ext of ALLOWED_EXTENSIONS) {
                const testUrl = `characters/${characterName}.${ext}`;
                const exists = await checkImageExists(testUrl);
                if (exists) {
                    imgElement.src = testUrl;
                    return;
                }
            }
            // 該当画像が見つからない場合はデフォルト画像にフォールバック
            imgElement.src = 'addchara/default.png';
        } catch (error) {
            console.error(`Right Nav Kai: Failed to load image for ${characterName}`, error);
            debugLog(`Error details: ${error.message}`);
        }
    }

    // 画像更新処理
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

    // ナビパネルの Observer 設定関数
    function setupObserverForNavPanel(navPanel) {
        const observer = new MutationObserver((mutations) => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                updateCharacterImages();
            }, 100);
        });

        observer.observe(navPanel, {
            childList: true,
            subtree: true
        });

        // 初回実行
        updateCharacterImages();
    }

    // 初期化関数
    function initialize() {
        debugLog('Initializing Right Nav Kai extension');
        loadSettings();

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
            bodyObserver.observe(document.body, { childList: true, subtree: true });
        }
    }

    debugLog('Right Nav Kai extension loaded');

    // DOM構築完了後に初期化を実行
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }
})();
