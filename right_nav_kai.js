// 修正版:
// 1) SillyTavern.getContext() 経由でのcontext利用（前回修正分、維持）
// 2) addchara/{charName}/{charName}_ext.json の image_display_extension.thumbnail(無ければdefault)
//    を参照してキャラ一覧のアバターに反映する処理（前回修正分、維持）
// 3) 今回の修正: updateCharacterImages() が拡張機能起動直後の1回しか呼ばれておらず、
//    その時点では #right-nav-panel 内にキャラクターブロックがまだ描画されていないため
//    "Found 0 character blocks" のまま何も更新されていなかったバグを修正。
//    CHARACTER_MESSAGE_RENDERED 等の「メッセージ表示イベント」だけに頼るのではなく、
//    #right-nav-panel 自体を MutationObserver で監視し、一覧の中身が実際に
//    描画・変化したタイミングで確実に再実行するようにした。
(function () {
    'use strict';

    const DEBUG = true; // デバッグモード
    const MODULE_NAME = 'right_nav_kai';

    // デフォルト設定の定義
    const defaultSettings = {
        enabled: true,
        // 今後追加される拡張設定があればここに記述
    };

    // 対応する画像拡張子のリスト
    const ALLOWED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp', 'mp4'];

    // _ext.json の解決結果をキャッシュ（同じキャラクターに何度もfetchしないため）
    // 値: 解決できたURL文字列、または見つからなかったことを示す null
    const extThumbnailCache = new Map();

    let panelObserver = null;

    // デバッグログ出力関数
    function debugLog(...args) {
        if (DEBUG) {
            console.log('[RightNavKai DEBUG]', ...args);
        }
    }

    // デバウンス処理（MutationObserverの連続発火をまとめるため）
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func(...args), wait);
        };
    }

    // SillyTavern context を取得するヘルパー（未取得ならnull）
    function getSTContext() {
        if (window.SillyTavern && typeof window.SillyTavern.getContext === 'function') {
            return window.SillyTavern.getContext();
        }
        return null;
    }

    // 設定の読み込みと初期化（localStorageからの移行処理含む）
    function loadSettings() {
        const context = getSTContext();
        if (!context || !context.extensionSettings) {
            console.warn('[RightNavKai] SillyTavern context が取得できませんでした。設定の読み込みをスキップします。');
            return;
        }

        context.extensionSettings[MODULE_NAME] = context.extensionSettings[MODULE_NAME] || {};

        // 既存の localStorage データが存在する場合は移行
        const localData = localStorage.getItem('right_nav_kai_settings');
        if (localData) {
            try {
                const parsed = JSON.parse(localData);
                Object.assign(context.extensionSettings[MODULE_NAME], parsed);
                localStorage.removeItem('right_nav_kai_settings');
                if (typeof context.saveSettingsDebounced === 'function') {
                    context.saveSettingsDebounced();
                }
                debugLog('Migrated settings from localStorage to extensionSettings (server)');
            } catch (e) {
                console.error('Failed to parse localStorage settings:', e);
            }
        }

        // デフォルト値の適用
        for (const key in defaultSettings) {
            if (context.extensionSettings[MODULE_NAME][key] === undefined) {
                context.extensionSettings[MODULE_NAME][key] = defaultSettings[key];
            }
        }
    }

    // 設定の保存関数
    function saveSettings() {
        const context = getSTContext();
        if (context && typeof context.saveSettingsDebounced === 'function') {
            context.saveSettingsDebounced();
            debugLog('Settings saved to server');
        } else {
            console.warn('[RightNavKai] saveSettingsDebounced が利用できないため設定を保存できませんでした。');
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

    // すでに拡張子が付いているパスならそのまま、無ければ候補拡張子を順に試して実在するURLを返す
    async function resolveImagePath(basePath) {
        if (!basePath) return null;
        if (basePath.match(/\.(png|jpg|jpeg|webp|gif|avif|bmp|mp4)$/i)) {
            const exists = await checkImageExists(basePath);
            return exists ? basePath : null;
        }
        for (const ext of ALLOWED_EXTENSIONS) {
            const testUrl = `${basePath}.${ext}`;
            const exists = await checkImageExists(testUrl);
            if (exists) {
                return testUrl;
            }
        }
        return null;
    }

    // JSON内を再帰探索して image_display_extension を見つける（image-display.js / stj_editor.js と同じロジック）
    function findImageMapInData(data) {
        if (data === null || typeof data !== 'object') return null;
        if (data.hasOwnProperty('image_display_extension')) {
            const potentialMap = data.image_display_extension;
            if (typeof potentialMap === 'object' && potentialMap !== null) {
                return potentialMap;
            }
        }
        for (const key in data) {
            if (data.hasOwnProperty(key)) {
                const result = findImageMapInData(data[key]);
                if (result !== null) return result;
            }
        }
        return null;
    }

    // addchara/{charName}/{charName}_ext.json を確認し、
    // image_display_extension.thumbnail（無ければ default）に対応する画像URLを解決する
    async function resolveThumbnailFromExtJson(characterName) {
        if (extThumbnailCache.has(characterName)) {
            return extThumbnailCache.get(characterName);
        }

        let resolvedUrl = null;
        try {
            const jsonPath = `addchara/${characterName}/${characterName}_ext.json`;
            const response = await fetch(jsonPath);
            if (response.ok) {
                const data = await response.json();
                const imageMap = findImageMapInData(data);
                if (imageMap) {
                    const candidate = imageMap.thumbnail !== undefined ? imageMap.thumbnail : imageMap.default;
                    if (candidate) {
                        const firstPath = Array.isArray(candidate) ? candidate[0] : candidate;
                        resolvedUrl = await resolveImagePath(firstPath);
                    }
                }
            }
        } catch (e) {
            debugLog(`_ext.json の解決に失敗しました (${characterName}):`, e.message);
        }

        extThumbnailCache.set(characterName, resolvedUrl);
        return resolvedUrl;
    }

    // タイトル属性等からキャラクター名を抽出するヘルパー関数
    // title は "[Character] 咲葉学園\nFile: 咲葉学園.png" のような複数行の文字列であり、
    // 単純な trim() では改行が失われて "[Character] 咲葉学園File: 咲葉学園.png" という
    // 誤った文字列になってしまうため、1行目から "[Character] " プレフィックスを除いた
    // 実際のキャラクター名だけを取り出す。
    function extractCharacterName(title) {
        if (!title) return null;
        const firstLine = title.split('\n')[0].trim();
        const match = firstLine.match(/^\[Character\]\s*(.+)$/);
        return (match ? match[1] : firstLine).trim();
    }

    // キャラクター画像の取得および差し替え関数
    async function fetchCharacterImage(characterName, imgElement) {
        try {
            // すでに _ext.json 由来の画像が適用済みなら再取得しない（Observerによる多重発火対策）
            if (imgElement.dataset.rightNavKaiResolved === characterName) {
                return;
            }

            // 1) STJ Character Exporter が出力した _ext.json の thumbnail（無ければdefault）を優先
            const extThumbUrl = await resolveThumbnailFromExtJson(characterName);
            if (extThumbUrl) {
                debugLog(`_ext.json のサムネイルを使用: ${characterName} -> ${extThumbUrl}`);
                imgElement.src = extThumbUrl;
                imgElement.dataset.rightNavKaiResolved = characterName;
                return;
            }

            // 2) 見つからない場合は従来通り characters/{name}.{ext} を試す
            for (const ext of ALLOWED_EXTENSIONS) {
                const testUrl = `characters/${characterName}.${ext}`;
                const exists = await checkImageExists(testUrl);
                if (exists) {
                    imgElement.src = testUrl;
                    imgElement.dataset.rightNavKaiResolved = characterName;
                    return;
                }
            }
            // 該当画像が見つからない場合はデフォルト画像にフォールバック
            imgElement.src = 'addchara/default.png';
            imgElement.dataset.rightNavKaiResolved = characterName;
        } catch (error) {
            console.error(`Right Nav Kai: Failed to load image for ${characterName}`, error);
            debugLog(`Error details: ${error.message}`);
        }
    }

    // 画像更新処理
    function updateCharacterImages() {
        const characterBlocks = document.querySelectorAll('#right-nav-panel .character_select');
        if (characterBlocks.length === 0) {
            debugLog('Updating character images... Found 0 character blocks (パネル未描画のためスキップ)');
            return;
        }
        debugLog(`Updating character images... Found ${characterBlocks.length} character blocks`);

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

    // #right-nav-panel を監視し、キャラクター一覧が実際に描画/変化したタイミングで
    // updateCharacterImages を確実に呼び直す
    function setupPanelObserver() {
        const panel = document.getElementById('right-nav-panel');
        if (!panel) {
            // パネル自体がまだDOMに存在しない場合は少し待って再試行
            setTimeout(setupPanelObserver, 1000);
            return;
        }

        if (panelObserver) {
            panelObserver.disconnect();
        }

        const debouncedUpdate = debounce(updateCharacterImages, 200);

        panelObserver = new MutationObserver((mutations) => {
            // アバター画像の src 書き換え自体は無視し、子要素の追加/削除のみ検知する
            const hasRelevantChange = mutations.some(m => m.type === 'childList' && (m.addedNodes.length > 0 || m.removedNodes.length > 0));
            if (hasRelevantChange) {
                debouncedUpdate();
            }
        });
        panelObserver.observe(panel, { childList: true, subtree: true });
        debugLog('#right-nav-panel の監視を開始しました。');

        // 監視開始時点ですでに一覧が存在している場合に備えて一度実行
        updateCharacterImages();
    }

    // イベント駆動によるリスナーのセットアップ（Observerの補助として引き続き利用）
    function setupEventListeners() {
        try {
            const context = getSTContext();
            if (!context) {
                console.warn('[RightNavKai] SillyTavern context が取得できないため、イベントリスナーを登録できません。');
                return;
            }
            const eventSource = context.eventSource;
            const eventTypes = context.eventTypes;

            if (eventSource && eventTypes) {
                eventSource.on(eventTypes.CHARACTER_MESSAGE_RENDERED, updateCharacterImages);
                eventSource.on(eventTypes.USER_MESSAGE_RENDERED, updateCharacterImages);
                eventSource.on(eventTypes.CHAT_CHANGED, updateCharacterImages);

                if (eventTypes.MESSAGE_UPDATED) {
                    eventSource.on(eventTypes.MESSAGE_UPDATED, updateCharacterImages);
                }
                if (eventTypes.CHARACTER_PAGE_LOADED) {
                    eventSource.on(eventTypes.CHARACTER_PAGE_LOADED, updateCharacterImages);
                }
                if (eventTypes.APP_READY) {
                    eventSource.on(eventTypes.APP_READY, updateCharacterImages);
                }

                debugLog('Event listeners registered successfully');
            } else {
                console.warn('[RightNavKai] eventSource or eventTypes not found in context.');
            }
        } catch (error) {
            console.error('[RightNavKai] Failed to setup event listeners:', error);
        }
    }

    // 初期化関数
    function initialize() {
        debugLog('Initializing Right Nav Kai extension');

        const context = getSTContext();
        if (!context) {
            // SillyTavern本体の初期化がまだ済んでいない可能性があるため少し待って再試行
            debugLog('SillyTavern context not ready yet, retrying in 500ms...');
            setTimeout(initialize, 500);
            return;
        }

        loadSettings();
        setupEventListeners();
        setupPanelObserver();
    }

    debugLog('Right Nav Kai extension loaded');

    // DOM構築完了後に初期化を実行
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }
})();
