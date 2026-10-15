window.allRaceMeetings = {};
        window.activeRaceKey = "";
        window.currentComputedResult = null;
        window.computedPredictionsCache = {};
        window.dogStats = [];
        window.savedPredictions = [];

        window.customPresets = {
            sprint: { windiv: 0.3, besttime: 0.4, avgtime: 0.4, best1sec: 0.8, avg1sec: 0.7, earlypos: 0.6, closinggain: 0.1, boxbias: 0.7 },
            distance: { windiv: 0.4, besttime: 0.6, avgtime: 0.8, best1sec: 0.2, avg1sec: 0.3, earlypos: 0.2, closinggain: 0.8, boxbias: 0.3 }
        };
        
        window.expandedRibbonGroups = new Set();

        window.liveFileHandle = null;
        window.cachedFileHandleReference = null;
        window.sessionImportCount = 0;

        let db = null;
        try {
            db = new Dexie('gBetDatabase');
            db.version(1).stores({
                sessions: 'key'
            });
        } catch (err) {
            console.warn("Dexie init warning:", err);
        }

        window.memoryFallbackStore = {};
        window.isIndexedDBAvailable = true;
        
        function toggleTheme() {
            const htmlRoot = document.getElementById('html-root');
            const themeIcon = document.getElementById('theme-icon');
            if (htmlRoot.classList.contains('dark')) {
                htmlRoot.classList.remove('dark');
                themeIcon.innerText = '🌙';
                localStorage.setItem('gbet_theme', 'light');
            } else {
                htmlRoot.classList.add('dark');
                themeIcon.innerText = '☀️';
                localStorage.setItem('gbet_theme', 'dark');
            }
        }

        function setLiveStatusSymbol(status) {
            const sym = document.getElementById('live-status-symbol');
            const headerSym = document.getElementById('header-live-status-symbol');
            if (!sym && !headerSym) return;

            [sym, headerSym].forEach(s => {
                if (!s) return;
                s.classList.remove('bg-red-500', 'bg-yellow-500', 'bg-green-500', 'animate-pulse');
                if (status === 'connected') {
                    s.classList.add('bg-green-500');
                    s.title = "Connected & Live-Syncing";
                } else if (status === 'prompt') {
                    s.classList.add('bg-yellow-500', 'animate-pulse');
                    s.title = "Permission Re-authorization Required";
                } else {
                    s.classList.add('bg-red-500');
                    s.title = "Disconnected (Saving to Browser Storage)";
                }
            });
        }

        window.addEventListener('DOMContentLoaded', async () => {
            // Inside window.addEventListener('DOMContentLoaded', async () => { ... })
				try {
					if (window.db && window.firebaseTools) {
						const { doc, getDoc } = window.firebaseTools; // Make sure getDoc is imported in index.html module script too!
						// Alternatively, use collection/getDocs if reading documents via query
					}
				} catch (err) {
					console.warn("Firebase load fallback:", err);
				}

                let storedMeetings = null;
                let storedActiveKey = null;
                let storedStats = null;
                let storedCache = null;
                let storedSavedPredictions = null;
                let storedCustomPresets = null;
                let storedHandle = null;

                try {
                    if (db) {
                        const getVal = async (k) => {
                            let row = await db.sessions.get(k);
                            return row ? row.value : null;
                        };
                        storedMeetings = await getVal('gbet_session_meetings');
                        storedActiveKey = await getVal('gbet_session_active_key');
                        storedStats = await getVal('gbet_session_stats');
                        storedCache = await getVal('gbet_computed_cache');
                        storedSavedPredictions = await getVal('gbet_session_saved_predictions');
                        storedCustomPresets = await getVal('gbet_session_custom_presets');
                        storedHandle = await getVal('gbet_live_file_handle');
                    }
                } catch (err) {
                    console.warn("IndexedDB load fallback:", err);
                    window.isIndexedDBAvailable = false;
                }

                if (storedMeetings) window.allRaceMeetings = storedMeetings;
                if (storedStats) window.dogStats = storedStats;
                if (storedCache) window.computedPredictionsCache = storedCache;
                if (storedSavedPredictions) window.savedPredictions = storedSavedPredictions;
                if (storedCustomPresets) window.customPresets = storedCustomPresets;

                populatePresetSettingsUI();

                if (storedHandle) {
                    window.cachedFileHandleReference = storedHandle;
                    try {
                        const permStatus = await storedHandle.queryPermission({ mode: 'readwrite' });
                        if (permStatus === 'granted') {
                            window.liveFileHandle = storedHandle;
                            let fileData = await storedHandle.getFile();
                            let textContent = await fileData.text();
                            let parsed = JSON.parse(textContent);

                            if (parsed.meetings) window.allRaceMeetings = parsed.meetings;
                            if (parsed.stats) window.dogStats = parsed.stats;
                            if (parsed.cache) window.computedPredictionsCache = parsed.cache;
                            if (parsed.savedPredictions) window.savedPredictions = parsed.savedPredictions;
                            if (parsed.customPresets) window.customPresets = parsed.customPresets;
                            if (parsed.activeKey && window.allRaceMeetings[parsed.activeKey]) {
                                window.activeRaceKey = parsed.activeKey;
                            }
                            populatePresetSettingsUI();

                            document.getElementById('live-file-status').innerText = `Auto-Connected & Live-Syncing: ${fileData.name}`;
                            document.getElementById('header-live-file-status').innerText = `Live: ${fileData.name}`;
                            setLiveStatusSymbol('connected');
                        } else if (permStatus === 'prompt') {
                            document.getElementById('live-file-status').innerText = "Saved master file found. Click Reconnect to resume live-syncing.";
                            document.getElementById('header-live-file-status').innerText = "Reconnect Required";
                            setLiveStatusSymbol('prompt');
                            showReconnectButtonUI();
                        }
                    } catch (err) {
                        console.warn("Auto-reconnect permission check error:", err);
                        setLiveStatusSymbol('disconnected');
                    }
                } else {
                    setLiveStatusSymbol('disconnected');
                }
                
                await sortAndPersistMeetingsObject();

                if (storedActiveKey && window.allRaceMeetings[storedActiveKey]) {
                    window.activeRaceKey = storedActiveKey;
                } else {
                    let keys = getSortedRaceKeys();
                    if (keys.length > 0) window.activeRaceKey = keys[0];
                }

                if (Object.keys(window.allRaceMeetings).length > 0) {
                    updateAllUIComponents();
                    if (window.dogStats.length > 0) {
                        renderStatsTable();
                        document.getElementById('csvFileLabel').innerText = `${window.dogStats.length} stats records loaded`;
                    }
                    document.getElementById('txtFileLabel').innerText = `${Object.keys(window.allRaceMeetings).length} file(s) loaded`;
                    
                    if (window.dogStats.length > 0 && window.activeRaceKey) {
                        refreshPredictions(false);
                    }
                }

                runDiagnosticsInspector();
                refreshStorageEstimate();
            } catch (err) {
                console.error("Critical boot error caught:", err);
            }
        });

        function populatePresetSettingsUI() {
            ['windiv', 'besttime', 'avgtime', 'best1sec', 'avg1sec', 'earlypos', 'closinggain', 'boxbias'].forEach(k => {
                let sEl = document.getElementById(`preset-sprint-${k}`);
                let dEl = document.getElementById(`preset-dist-${k}`);
                if (sEl && window.customPresets.sprint[k] !== undefined) sEl.value = window.customPresets.sprint[k];
                if (dEl && window.customPresets.distance[k] !== undefined) dEl.value = window.customPresets.distance[k];
            });
        }

        async function savePresetCustomizations() {
            ['windiv', 'besttime', 'avgtime', 'best1sec', 'avg1sec', 'earlypos', 'closinggain', 'boxbias'].forEach(k => {
                let sVal = parseFloat(document.getElementById(`preset-sprint-${k}`).value);
                let dVal = parseFloat(document.getElementById(`preset-dist-${k}`).value);
                if (!isNaN(sVal)) window.customPresets.sprint[k] = sVal;
                if (!isNaN(dVal)) window.customPresets.distance[k] = dVal;
            });

            await sortAndPersistMeetingsObject();
            showNotification("Preset configurations successfully saved!", "success");
        }

        async function resetPresetCustomizationsToDefault() {
            window.customPresets = {
                sprint: { windiv: 0.3, besttime: 0.4, avgtime: 0.4, best1sec: 0.8, avg1sec: 0.7, earlypos: 0.6, closinggain: 0.1, boxbias: 0.7 },
                distance: { windiv: 0.4, besttime: 0.6, avgtime: 0.8, best1sec: 0.2, avg1sec: 0.3, earlypos: 0.2, closinggain: 0.8, boxbias: 0.3 }
            };
            populatePresetSettingsUI();
            await sortAndPersistMeetingsObject();
            showNotification("Presets reset to recommended defaults successfully!", "success");
        }

        function runDiagnosticsInspector() {
            let ua = navigator.userAgent;
            let browserName = "Chromium Browser";
            if (ua.includes("Chrome") && !ua.includes("Edg")) browserName = "Google Chrome";
            else if (ua.includes("Edg")) browserName = "Microsoft Edge";
            else if (ua.includes("Firefox")) browserName = "Mozilla Firefox";
            
            let hasFileSystemAPI = 'showOpenFilePicker' in window ? "Supported (File System Access API)" : "Limited / Fallback Mode";
            document.getElementById('diag-browser').innerText = `${browserName} (${hasFileSystemAPI})`;

            let storageModeText = window.liveFileHandle ? "Live File Syncing (Disk)" : (window.isIndexedDBAvailable ? "IndexedDB Browser Storage" : "Memory Fallback");
            document.getElementById('diag-storage').innerText = storageModeText;

            let lastAudit = localStorage.getItem('gbet_last_audit_log') || "No backup exported yet";
            document.getElementById('diag-audit').innerText = lastAudit;
        }

        async function refreshStorageEstimate() {
            if (navigator.storage && navigator.storage.estimate) {
                try {
                    let estimate = await navigator.storage.estimate();
                    let usageMB = (estimate.usage / (1024 * 1024)).toFixed(2);
                    let quotaMB = (estimate.quota / (1024 * 1024)).toFixed(0);
                    let percent = quotaMB > 0 ? ((estimate.usage / estimate.quota) * 100).toFixed(1) : 0;

                    document.getElementById('storage-usage-badge').innerText = `${usageMB} MB / ${quotaMB} MB (${percent}%)`;
                    document.getElementById('storage-details-text').innerText = `Using ${usageMB} MB of estimated ${quotaMB} MB quota in browser IndexedDB.`;
                    document.getElementById('storage-progress-bar').style.width = `${Math.min(percent, 100)}%`;
                } catch (err) {
                    console.warn("Storage estimate failed:", err);
                }
            }
        }

        async function purgeOldMeetings() {
            let keys = Object.keys(window.allRaceMeetings);
            if (keys.length === 0) {
                showNotification("No meetings loaded to purge.");
                return;
            }

            let thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            let purgedCount = 0;
            keys.forEach(k => {
                let m = window.allRaceMeetings[k];
                if (m.raceDate) {
                    let meetingDate = new Date(m.raceDate);
                    if (!isNaN(meetingDate) && meetingDate < thirtyDaysAgo) {
                        delete window.allRaceMeetings[k];
                        purgedCount++;
                    }
                }
            });

            if (purgedCount > 0) {
                await sortAndPersistMeetingsObject();
                updateAllUIComponents();
                showNotification(`Successfully purged ${purgedCount} meeting(s) older than 30 days.`, "success");
            } else {
                showNotification("No meetings older than 30 days were found.");
            }
            refreshStorageEstimate();
        }

        function resetDefaultWeights() {
            document.getElementById('w-windiv').value = 0.4;
            document.getElementById('w-besttime').value = 0.5;
            document.getElementById('w-avgtime').value = 0.6;
            document.getElementById('w-best1sec').value = 0.5;
            document.getElementById('w-avg1sec').value = 0.5;
            document.getElementById('w-earlypos').value = 0.4;
            document.getElementById('w-closinggain').value = 0.4;
            document.getElementById('w-boxbias').value = 0.5;

            ['windiv', 'besttime', 'avgtime', 'best1sec', 'avg1sec', 'earlypos', 'closinggain', 'boxbias'].forEach(k => {
                document.getElementById(`val-w-${k}`).innerText = document.getElementById(`w-${k}`).value;
            });
            if (window.currentComputedResult) {
                refreshPredictions();
            }
            showNotification("Model weights successfully reset to Balanced baseline defaults.", "success");
        }

        function applyPreset(presetType) {
            let weights = {};
            if (presetType === 'sprint') {
                weights = window.customPresets.sprint;
                showNotification("Applied Sprint Preset: Loaded from customized settings.", "success");
            } else if (presetType === 'distance') {
                weights = window.customPresets.distance;
                showNotification("Applied Distance Preset: Loaded from customized settings.", "success");
            }

            for (let k in weights) {
                let el = document.getElementById(`w-${k}`);
                let valEl = document.getElementById(`val-w-${k}`);
                if (el && valEl) {
                    el.value = weights[k];
                    valEl.innerText = weights[k];
                }
            }

            if (window.currentComputedResult) {
                refreshPredictions();
            }
        }

        async function clearPredictionCache() {
            if (confirm("Are you sure you want to force-clear the computed analysis cache?")) {
                window.computedPredictionsCache = {};
                await sortAndPersistMeetingsObject();
                showNotification("Computed analysis cache cleared successfully.", "success");
                refreshStorageEstimate();
            }
        }

        function checkBackupReminderThreshold() {
            window.sessionImportCount++;
            if (window.sessionImportCount >= 10) {
                document.getElementById('backup-reminder-banner').classList.remove('hidden');
                document.getElementById('backup-reminder-banner').classList.add('flex');
            }
        }

        function hideBackupReminder() {
            document.getElementById('backup-reminder-banner').classList.remove('flex');
            document.getElementById('backup-reminder-banner').classList.add('hidden');
            window.sessionImportCount = 0;
        }

        function showReconnectButtonUI() {
            const container = document.getElementById('live-file-action-container');
            const headerReconnectBtn = document.getElementById('header-reconnect-btn');
            
            if (headerReconnectBtn) {
                headerReconnectBtn.classList.remove('hidden');
            }

            if (container && !document.getElementById('reconnect-file-btn')) {
                container.innerHTML = `
                    <button id="reconnect-file-btn" onclick="reconnectStoredLiveFile()" class="bg-amber-600 hover:bg-amber-700 text-white font-bold py-2 px-4 rounded shadow transition-colors text-xs whitespace-nowrap">
                        🔓 Reconnect Saved Master File
                    </button>
                    <button onclick="connectLiveDatabaseFile()" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded shadow transition-colors text-xs whitespace-nowrap">
                        🔗 Choose Different File
                    </button>
                `;
            }
        }

        async function reconnectStoredLiveFile() {
            if (!window.cachedFileHandleReference) {
                connectLiveDatabaseFile();
                return;
            }

            try {
                const permStatus = await window.cachedFileHandleReference.requestPermission({ mode: 'readwrite' });
                if (permStatus === 'granted') {
                    window.liveFileHandle = window.cachedFileHandleReference;
                    let fileData = await window.liveFileHandle.getFile();
                    let textContent = await fileData.text();
                    let parsed = JSON.parse(textContent);

                    if (parsed.meetings) window.allRaceMeetings = parsed.meetings;
                    if (parsed.stats) window.dogStats = parsed.stats;
                    if (parsed.cache) window.computedPredictionsCache = parsed.cache;
                    if (parsed.savedPredictions) window.savedPredictions = parsed.savedPredictions;
                    if (parsed.customPresets) window.customPresets = parsed.customPresets;
                    if (parsed.activeKey && window.allRaceMeetings[parsed.activeKey]) {
                        window.activeRaceKey = parsed.activeKey;
                    } else {
                        let keys = getSortedRaceKeys();
                        if (keys.length > 0) window.activeRaceKey = keys[0];
                    }
                    populatePresetSettingsUI();

                    await sortAndPersistMeetingsObject();
                    updateAllUIComponents();
                    if (window.dogStats.length > 0) renderStatsTable();

                    document.getElementById('live-file-status').innerText = `Connected & Live-Syncing: ${fileData.name}`;
                    document.getElementById('header-live-file-status').innerText = `Live: ${fileData.name}`;
                    setLiveStatusSymbol('connected');
                    
                    const headerReconnectBtn = document.getElementById('header-reconnect-btn');
                    if (headerReconnectBtn) headerReconnectBtn.classList.add('hidden');

                    document.getElementById('live-file-action-container').innerHTML = `
                        <button onclick="connectLiveDatabaseFile()" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded shadow transition-colors text-xs whitespace-nowrap">
                            🔗 Change Live File
                        </button>
                    `;
                    showNotification(`Successfully reconnected to ${fileData.name}!`, "success");
                } else {
                    setLiveStatusSymbol('prompt');
                    showNotification("Permission to access the saved file was denied.");
                }
            } catch (err) {
                console.error("Manual file reconnection error:", err);
                setLiveStatusSymbol('disconnected');
                showNotification("Failed to reconnect file handle. Please select the file again.");
            }
        }

        async function connectLiveDatabaseFile() {
            if (!('showOpenFilePicker' in window)) {
                showNotification("Live File System Access API is not supported in this browser. Please use manual snapshots.");
                return;
            }

            try {
                const [handle] = await window.showOpenFilePicker({
                    types: [{
                        description: 'gBet Database JSON',
                        accept: { 'application/json': ['.json'] }
                    }],
                    multiple: false
                });
                
                window.liveFileHandle = handle;
                window.cachedFileHandleReference = handle;

                if (db && window.isIndexedDBAvailable) {
                    await db.sessions.put({ key: 'gbet_live_file_handle', value: handle });
                }

                let fileData = await handle.getFile();
                let textContent = await fileData.text();
                let parsed = JSON.parse(textContent);

                if (parsed.meetings) window.allRaceMeetings = parsed.meetings;
                if (parsed.stats) window.dogStats = parsed.stats;
                if (parsed.cache) window.computedPredictionsCache = parsed.cache;
                if (parsed.savedPredictions) window.savedPredictions = parsed.savedPredictions;
                if (parsed.customPresets) window.customPresets = parsed.customPresets;
                if (parsed.activeKey && window.allRaceMeetings[parsed.activeKey]) {
                    window.activeRaceKey = parsed.activeKey;
                } else {
                    let keys = getSortedRaceKeys();
                    if (keys.length > 0) window.activeRaceKey = keys[0];
                }
                populatePresetSettingsUI();

                await sortAndPersistMeetingsObject();
                updateAllUIComponents();
                if (window.dogStats.length > 0) renderStatsTable();

                document.getElementById('live-file-status').innerText = `Connected & Live-Syncing: ${fileData.name}`;
                document.getElementById('header-live-file-status').innerText = `Live: ${fileData.name}`;
                setLiveStatusSymbol('connected');
                
                const headerReconnectBtn = document.getElementById('header-reconnect-btn');
                if (headerReconnectBtn) headerReconnectBtn.classList.add('hidden');

                document.getElementById('live-file-action-container').innerHTML = `
                    <button onclick="connectLiveDatabaseFile()" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded shadow transition-colors text-xs whitespace-nowrap">
                        🔗 Change Live File
                    </button>
                `;
                showNotification(`Successfully connected to live master file: ${fileData.name}`, "success");
            } catch (err) {
                if (err.name === 'AbortError') return;
                console.error("Live file connection failed:", err);
                showNotification("Failed to connect to local database file.");
            }
        }

        async function writeToLiveFileIfConnected() {
            if (!window.liveFileHandle) return;
            try {
                const snapshotPayload = {
                    meetings: window.allRaceMeetings,
                    activeKey: window.activeRaceKey,
                    stats: window.dogStats,
                    cache: window.computedPredictionsCache,
                    savedPredictions: window.savedPredictions,
                    customPresets: window.customPresets,
                    exportDate: new Date().toISOString()
                };
                const writable = await window.liveFileHandle.createWritable();
                await writable.write(JSON.stringify(snapshotPayload, null, 2));
                await writable.close();
                setLiveStatusSymbol('connected');
            } catch (err) {
                console.error("Live file write error:", err);
                document.getElementById('live-file-status').innerText = "Live sync paused (permission expired, click Reconnect).";
                document.getElementById('header-live-file-status').innerText = "Sync Paused";
                setLiveStatusSymbol('prompt');
                showReconnectButtonUI();
            }
        }

        async function exportDatabaseSnapshot() {
            const snapshotPayload = {
                meetings: window.allRaceMeetings,
                activeKey: window.activeRaceKey,
                stats: window.dogStats,
                cache: window.computedPredictionsCache,
                savedPredictions: window.savedPredictions,
                customPresets: window.customPresets,
                exportDate: new Date().toISOString()
            };

            const jsonString = JSON.stringify(snapshotPayload, null, 2);
            const defaultFilename = `gBet_Database_Snapshot_${new Date().toISOString().slice(0,10)}.json`;
            const fileSizeKB = (new Blob([jsonString]).size / 1024).toFixed(1) + " KB";
            let auditText = `${new Date().toLocaleString()} (${fileSizeKB})`;
            localStorage.setItem('gbet_last_audit_log', auditText);
            document.getElementById('diag-audit').innerText = auditText;

            try {
                if ('showSaveFilePicker' in window) {
                    const handle = await window.showSaveFilePicker({
                        suggestedName: defaultFilename,
                        types: [{
                            description: 'JSON Snapshot File',
                            accept: { 'application/json': ['.json'] }
                        }]
                    });
                    const writableStream = await handle.createWritable();
                    await writableStream.write(jsonString);
                    await writableStream.close();
                    showNotification("Manual database snapshot successfully saved!", "success");
                    hideBackupReminder();
                    return;
                }
            } catch (err) {
                if (err.name === 'AbortError') return;
            }

            let dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(jsonString);
            let downloadAnchor = document.createElement('a');
            downloadAnchor.setAttribute("href", dataStr);
            downloadAnchor.setAttribute("download", defaultFilename);
            document.body.appendChild(downloadAnchor);
            downloadAnchor.click();
            downloadAnchor.remove();
            showNotification("Manual snapshot successfully exported!", "success");
            hideBackupReminder();
        }

        async function importDatabaseSnapshot(event) {
            const file = event.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = async function(e) {
                try {
                    let data = JSON.parse(e.target.result);
                    if (data.meetings) window.allRaceMeetings = data.meetings;
                    if (data.stats) window.dogStats = data.stats;
                    if (data.cache) window.computedPredictionsCache = data.cache;
                    if (data.savedPredictions) window.savedPredictions = data.savedPredictions;
                    if (data.customPresets) window.customPresets = data.customPresets;
                    if (data.activeKey && window.allRaceMeetings[data.activeKey]) {
                        window.activeRaceKey = data.activeKey;
                    } else {
                        let keys = getSortedRaceKeys();
                        if (keys.length > 0) window.activeRaceKey = keys[0];
                    }
                    populatePresetSettingsUI();

                    await sortAndPersistMeetingsObject();
                    updateAllUIComponents();
                    if (window.dogStats.length > 0) {
                        renderStatsTable();
                        document.getElementById('csvFileLabel').innerText = `${window.dogStats.length} stats records loaded`;
                    }
                    if (Object.keys(window.allRaceMeetings).length > 0) {
                        document.getElementById('txtFileLabel').innerText = `${Object.keys(window.allRaceMeetings).length} file(s) loaded`;
                        if (window.dogStats.length > 0 && window.activeRaceKey) {
                            refreshPredictions(false);
                        }
                    }

                    event.target.value = "";
                    showNotification("Snapshot successfully restored into IndexedDB!", "success");
                    refreshStorageEstimate();
                } catch (err) {
                    console.error("Snapshot import failed:", err);
                    showNotification("Failed to parse database snapshot file.");
                }
            };
            reader.readAsText(file);
        }

        async function sortAndPersistMeetingsObject() {
    let sortedKeys = getSortedRaceKeys();
    let sortedMeetings = {};
    sortedKeys.forEach(k => {
        sortedMeetings[k] = window.allRaceMeetings[k];
    });
    window.allRaceMeetings = sortedMeetings;

    const snapshotPayload = {
        meetings: window.allRaceMeetings,
        activeKey: window.activeRaceKey,
        stats: window.dogStats,
        cache: window.computedPredictionsCache,
        savedPredictions: window.savedPredictions,
        customPresets: window.customPresets,
        exportDate: new Date().toISOString()
    };

    // --- SYNC TO FIREBASE FIRESTORE ---
    try {
        if (window.db && window.firebaseTools) {
            const { doc, setDoc } = window.firebaseTools;
            await setDoc(doc(window.db, "gbets", "masterState"), snapshotPayload);
            setLiveStatusSymbol('connected');
        }
    } catch (err) {
        console.warn("Firebase sync warning:", err);
        setLiveStatusSymbol('disconnected');
    }

    // Keep Dexie/IndexedDB local backup active as fallback
    try {
        if (db && window.isIndexedDBAvailable) {
            await db.transaction('rw', db.sessions, async () => {
                await db.sessions.put({ key: 'gbet_session_meetings', value: window.allRaceMeetings });
                await db.sessions.put({ key: 'gbet_session_active_key', value: window.activeRaceKey });
                await db.sessions.put({ key: 'gbet_session_stats', value: window.dogStats });
                await db.sessions.put({ key: 'gbet_computed_cache', value: window.computedPredictionsCache });
                await db.sessions.put({ key: 'gbet_session_saved_predictions', value: window.savedPredictions });
                await db.sessions.put({ key: 'gbet_session_custom_presets', value: window.customPresets });
            });
        }
    } catch (err) {
        console.warn("Storage persistence fallback error:", err);
    }

    await writeToLiveFileIfConnected();
    refreshStorageEstimate();
}
        }

        function updateAllUIComponents() {
            updateRaceSelector();
            renderBatchSummaryDashboard();
        }

        function openTab(evt, tabName) {
            const contents = document.querySelectorAll('.tab-content');
            contents.forEach(c => c.classList.remove('active'));
            
            const btns = document.querySelectorAll('.tab-btn');
            btns.forEach(b => {
                b.classList.remove('text-slate-900', 'dark:text-white', 'border-slate-900', 'dark:border-white', 'font-bold');
                b.classList.add('text-slate-500', 'dark:text-slate-400', 'border-transparent', 'font-medium');
            });

            document.getElementById(tabName).classList.add('active');
            evt.currentTarget.classList.remove('text-slate-500', 'dark:text-slate-400', 'border-transparent', 'font-medium');
            evt.currentTarget.classList.add('text-slate-900', 'dark:text-white', 'border-slate-900', 'dark:border-white', 'font-bold');
            
            if (tabName === 'saved-tab') {
                populateSavedFilterDropdowns();
                renderSavedPredictions();
            } else if (tabName === 'batch-summary-tab') {
                renderBatchSummaryDashboard();
            } else if (tabName === 'settings-tab') {
                refreshStorageEstimate();
            }
        }

        function showNotification(message, type = "error") {
            const notif = document.getElementById('notification');
            const text = document.getElementById('notification-text');
            text.innerText = message;
            
            if (type === "success") {
                notif.classList.remove('bg-red-500');
                notif.classList.add('bg-green-600');
            } else {
                notif.classList.remove('bg-green-600');
                notif.classList.add('bg-red-500');
            }

            notif.classList.add('show');
            setTimeout(closeNotification, 4000);
        }

        function closeNotification() {
            document.getElementById('notification').classList.remove('show');
        }

        function toggleWeightsDrawer() {
            let drawer = document.getElementById('weights-drawer');
            drawer.classList.toggle('hidden');
        }

        function toggleManualEntryDrawer() {
            let drawer = document.getElementById('manual-entry-drawer');
            drawer.classList.toggle('hidden');
        }

        function updateWeightVal(key) {
            let val = document.getElementById(`w-${key}`).value;
            document.getElementById(`val-w-${key}`).innerText = val;
            if (window.currentComputedResult) {
                refreshPredictions(false);
            }
        }

        function extractSex(text) {
            if (!text) return "Unknown";
            let upper = text.toUpperCase();
            if (/\bB\b/.test(upper) || upper.includes('BITCH')) return "Bitch";
            if (/\bD\b/.test(upper) || upper.includes('DOG')) return "Dog";
            return "Unknown";
        }

        function parsePir(pirStr) {
            if (!pirStr || pirStr.trim() === "" || pirStr === "-") return { early: null, finish: null, gain: 0 };
            let clean = pirStr.replace(/\D/g, '');
            if (clean.length >= 2) {
                let early = parseInt(clean.charAt(0));
                let finish = parseInt(clean.charAt(clean.length - 1));
                if (!isNaN(early) && !isNaN(finish)) {
                    let gain = early - finish;
                    return { early: early, finish: finish, gain: gain };
                }
            }
            return { early: null, finish: null, gain: 0 };
        }

        function generateSparkline(arr) {
            if (!arr || arr.length === 0) return '<span class="text-slate-400 font-mono text-xs italic">No form data</span>';
            return '<div class="flex gap-1">' + arr.map(p => {
                if (p === 1) return `<span class="flex items-center justify-center w-5 h-5 bg-green-500 text-white rounded-sm text-xs font-bold shadow-sm">${p}</span>`;
                if (p === 2 || p === 3) return `<span class="flex items-center justify-center w-5 h-5 bg-yellow-400 text-yellow-900 rounded-sm text-xs font-bold shadow-sm">${p}</span>`;
                if (p >= 4) return `<span class="flex items-center justify-center w-5 h-5 bg-red-500 text-white rounded-sm text-xs font-bold shadow-sm">${p}</span>`;
                return `<span class="flex items-center justify-center w-5 h-5 bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400 rounded-sm text-xs font-bold shadow-sm">-</span>`;
            }).join('') + '</div>';
        }

        function getRunningStyleBadge(early, gain) {
            if (isNaN(early) || isNaN(gain)) return '<span class="bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs px-2 py-1 rounded shadow-sm font-semibold">🐾 Unmapped</span>';
            if (gain >= 2.0) return '<span class="bg-purple-200 dark:bg-purple-900/60 text-purple-900 dark:text-purple-200 border border-purple-300 dark:border-purple-700 text-xs px-2 py-1 rounded shadow-sm font-semibold">🌪 Strong Finisher</span>';
            if (early <= 3.5) return '<span class="bg-sky-200 dark:bg-sky-900/60 text-sky-900 dark:text-sky-200 border border-sky-300 dark:border-sky-700 text-xs px-2 py-1 rounded shadow-sm font-semibold">🚀 Front Runner</span>';
            return '<span class="bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 text-xs px-2 py-1 rounded shadow-sm font-semibold">🚂 Mid-Pack Mover</span>';
        }

        function getSortedRaceKeys() {
            let keys = Object.keys(window.allRaceMeetings);
            return keys.sort((a, b) => {
                let raceA = window.allRaceMeetings[a];
                let raceB = window.allRaceMeetings[b];
                
                let trackA = (raceA.trackName || a).toUpperCase();
                let trackB = (raceB.trackName || b).toUpperCase();
                
                if (trackA !== trackB) {
                    return trackA.localeCompare(trackB);
                }

                let dateA = (raceA.raceDate || "").toUpperCase();
                let dateB = (raceB.raceDate || "").toUpperCase();
                if (dateA !== dateB) {
                    return dateA.localeCompare(dateB);
                }
                
                let numA = parseInt(raceA.raceNumber) || 0;
                let numB = parseInt(raceB.raceNumber) || 0;
                return numA - numB;
            });
        }

        document.getElementById('txtFileInput').addEventListener('change', async function(e) {
            const files = e.target.files;
            if (!files || files.length === 0) return;
            
            let loadedCount = 0;
            for (let file of files) {
                const reader = new FileReader();
                reader.onload = async function(e) {
                    const text = e.target.result;
                    const lines = text.split('\n').map(l => l.trim());
                    parseTxtData(lines, file.name);
                    loadedCount++;
                    if (loadedCount === files.length) {
                        document.getElementById('txtFileLabel').innerText = `${Object.keys(window.allRaceMeetings).length} file(s) loaded`;
                        await sortAndPersistMeetingsObject();
                        updateAllUIComponents();
                        checkAutoFillPostRaceResults();
                        checkBackupReminderThreshold();
                        
                        if (window.dogStats.length > 0 && window.activeRaceKey) {
                            refreshPredictions(false);
                        }
                        showNotification(`Successfully imported ${files.length} race detail file(s).`, "success");
                    }
                };
                reader.readAsText(file);
            }
        });

        function openTabtouchExportUrl() {
            let date = document.getElementById('tt-date').value.trim();
            let fixture = document.getElementById('tt-fixture').value.trim().toUpperCase();
            let race = document.getElementById('tt-race').value.trim();

            if (!date || !fixture || !race) {
                showNotification("Please fill in Date (DDMMYYYY), Fixture ID, and Race Number.");
                return;
            }

            let url = `https://www.tabtouch.com.au/UISecure/ExportUI/RaceDetailsExport.aspx?exportType=4&fixtureDate=${date}&fixtureId=${fixture}&contestNumber=${race}`;
            window.open(url, '_blank');
            showNotification("Opened TABtouch export page. Press Ctrl+A -> Ctrl+C, then click Auto-Import from Clipboard.", "success");
        }

        async function importFromClipboard() {
            try {
                let clipboardText = await navigator.clipboard.readText();
                if (!clipboardText || (!clipboardText.includes('Fixture') && !clipboardText.includes('Starters'))) {
                    showNotification("Clipboard does not contain valid TABtouch export text. Please copy the page first.");
                    return;
                }

                let lines = clipboardText.split('\n').map(l => l.trim());
                let raceNum = document.getElementById('tt-race').value.trim() || "1";
                let filename = `TABtouch_Export_R${raceNum}.txt`;

                parseTxtData(lines, filename);
                await sortAndPersistMeetingsObject();
                updateAllUIComponents();
                checkAutoFillPostRaceResults();
                checkBackupReminderThreshold();

                if (window.dogStats.length > 0 && window.activeRaceKey) {
                    refreshPredictions(false);
                }

                document.getElementById('txtFileLabel').innerText = `${Object.keys(window.allRaceMeetings).length} file(s) loaded`;
                showNotification("Successfully auto-imported race details from clipboard!", "success");
            } catch (err) {
                console.error("Clipboard read failed:", err);
                showNotification("Permission denied or clipboard empty. Please allow clipboard access when prompted.");
            }
        }

        function parseTxtData(lines, filename) {
            let inFixture = false;
            let inContest = false;
            let inStarters = false;

            let starters = [];
            let raceNumber = "";
            let raceDistance = "";
            let trackName = "";
            let raceDate = "";
            
            let actualWinner = null;
            let actualPlace1 = null;
            let actualPlace2 = null;
            let actualPlace3 = null;

            let startersColMap = {};

            for (let i = 0; i < lines.length; i++) {
                let currentLine = lines[i];

                if (currentLine === 'Fixture') {
                    inFixture = true;
                    inContest = false;
                    inStarters = false;
                    continue;
                } else if (currentLine === 'Contest') {
                    inFixture = false;
                    inContest = true;
                    inStarters = false;
                    i++; 
                    continue;
                } else if (currentLine.startsWith('Starters') || currentLine.startsWith('Results') || currentLine.startsWith('Result')) {
                    inFixture = false;
                    inContest = false;
                    inStarters = true;
                    i++;
                    if (i < lines.length) {
                        let headers = lines[i].split(',').map(h => h.replace(/"/g, '').trim().toLowerCase());
                        startersColMap = {};
                        headers.forEach((h, idx) => {
                            startersColMap[h] = idx;
                        });
                    }
                    continue;
                } else if (currentLine === '' || currentLine.startsWith('Pools')) {
                    inFixture = false;
                    inContest = false;
                    inStarters = false;
                }

                if (inFixture && currentLine.length > 0 && !currentLine.startsWith('date')) {
                    const parts = currentLine.split(',').map(p => p.replace(/"/g, '').trim());
                    if (parts.length >= 3) {
                        raceDate = parts[0];
                        trackName = parts[2];
                    }
                }

                if (inContest && currentLine.length > 0) {
                    const parts = currentLine.split(',').map(p => p.replace(/"/g, '').trim());
                    raceNumber = parts[0];
                    for (let p of parts) {
                        let trimmed = p;
                        if (/^\d+m$/i.test(trimmed) || (/^\d+$/.test(trimmed) && parseInt(trimmed) > 100 && parseInt(trimmed) < 2000)) {
                            raceDistance = trimmed.endsWith('m') ? trimmed : trimmed + 'm';
                            break;
                        }
                    }
                }

                if (inStarters && currentLine.length > 3) {
                    const parts = currentLine.split(',').map(p => p.replace(/"/g, '').trim());
                    
                    let getCol = (colName, fallbackIdx) => {
                        let idx = startersColMap[colName] !== undefined ? startersColMap[colName] : fallbackIdx;
                        return parts[idx] !== undefined ? parts[idx] : "";
                    };

                    let rawDogName = getCol('startername', 3) || getCol('dog name', 3);
                    if (!rawDogName || rawDogName === "") continue;

                    let officialBox = getCol('number', 0) || getCol('box', 0) || "1";
                    let effectiveBox = officialBox;
                    
                    let overrideMatch = rawDogName.match(/starts\s+from\s+box\s+(\d+)/i);
                    if (overrideMatch) {
                        effectiveBox = overrideMatch[1];
                    }

                    let cleanDogName = rawDogName.replace(/\s*\(.*?\)\s*/g, '').trim();

                    let sex = extractSex(cleanDogName);
                    let winDiv = parseFloat(getCol('windiv', 1)) || 0;
                    let placeDiv = parseFloat(getCol('placediv', 2)) || 0;
                    let trainer = getCol('statername2', 4) || getCol('trainer', 4) || "";
                    let isScratched = getCol('scratched', 7).toLowerCase() === 'true';
                    let placingVal = parseInt(getCol('placing', 9)) || 0;

                    starters.push({
                        box: effectiveBox,
                        officialBox: officialBox,
                        starterName: cleanDogName,
                        originalRawName: rawDogName,
                        sex: sex,
                        trainer: trainer,
                        winDiv: winDiv,
                        placeDiv: placeDiv,
                        scratched: isScratched,
                        placing: placingVal
                    });

                    if (placingVal === 1) {
                        actualWinner = cleanDogName;
                        actualPlace1 = cleanDogName;
                    } else if (placingVal === 2) {
                        actualPlace2 = cleanDogName;
                    } else if (placingVal === 3) {
                        actualPlace3 = cleanDogName;
                    }
                }
            }

            if (!raceDistance) {
                for (let line of lines) {
                    const match = line.match(/\b(\d{3,4}m)\b/i);
                    if (match) {
                        raceDistance = match[1];
                        break;
                    }
                }
            }

            let key = trackName && raceNumber ? `${trackName} - Race ${raceNumber} (${raceDate})` : filename;
            window.allRaceMeetings[key] = {
                trackName: trackName || "UNKNOWN",
                raceNumber: raceNumber || "1",
                raceDistance: raceDistance || "",
                raceDate: raceDate || "",
                starters: starters,
                actualWinner: actualWinner,
                actualPlace1: actualPlace1,
                actualPlace2: actualPlace2,
                actualPlace3: actualPlace3
            };

            if (!window.activeRaceKey) {
                window.activeRaceKey = key;
            }
        }

        async function checkAutoFillPostRaceResults() {
            let updated = false;

            window.savedPredictions.forEach(savedItem => {
                let matchKey = Object.keys(window.allRaceMeetings).find(k => {
                    let m = window.allRaceMeetings[k];
                    let trackMatch = k.toUpperCase().includes(m.trackName.toUpperCase()) && savedItem.trackName.toUpperCase().includes(m.trackName.toUpperCase());
                    
                    let savedRaceNum = String(savedItem.raceNumber || "").trim();
                    let meetingRaceNum = String(m.raceNumber || "").trim();
                    let raceNumMatch = (savedRaceNum && savedRaceNum !== "N/A" && savedRaceNum === meetingRaceNum) ||
                                       new RegExp(`\\bRACE\\s*${meetingRaceNum}\\b`, 'i').test(savedItem.trackName);

                    let dateMatch = !m.raceDate || !savedItem.raceDate || savedItem.raceDate === m.raceDate || savedItem.timestamp.includes(m.raceDate) || k.includes(m.raceDate);
                    return trackMatch && raceNumMatch && dateMatch && m.actualWinner;
                });

                if (matchKey) {
                    let meeting = window.allRaceMeetings[matchKey];
                    if (meeting.actualWinner && meeting.actualWinner !== "") {
                        savedItem.actualWinner = meeting.actualWinner;
                        savedItem.actualPlace1 = meeting.actualPlace1;
                        savedItem.actualPlace2 = meeting.actualPlace2;
                        savedItem.actualPlace3 = meeting.actualPlace3;
                        
                        let scoredDogsList = savedItem.scoredDogs || [];
                        let topPick = scoredDogsList.length > 0 ? scoredDogsList[0] : null;
                        let activeCompetitorsCount = scoredDogsList.length;
                        
                        if (topPick) {
                            let topPickName = topPick.name || "";
                            if (meeting.actualWinner.toUpperCase() === topPickName.toUpperCase()) {
                                savedItem.actualWinPayout = topPick.winDiv > 0 ? topPick.winDiv : 2.0;
                                savedItem.actualPlacePayout = topPick.placeDiv > 0 ? topPick.placeDiv : 1.2;
                            } else {
                                let podium = [meeting.actualPlace1, meeting.actualPlace2, meeting.actualPlace3].map(n => (n || "").toUpperCase());
                                let eligiblePlaceHit = false;
                                
                                if (activeCompetitorsCount >= 8) {
                                    eligiblePlaceHit = podium.slice(0, 3).includes(topPickName.toUpperCase());
                                } else if (activeCompetitorsCount >= 5) {
                                    eligiblePlaceHit = podium.slice(0, 2).includes(topPickName.toUpperCase());
                                } else {
                                    eligiblePlaceHit = podium.slice(0, 1).includes(topPickName.toUpperCase());
                                }

                                if (eligiblePlaceHit) {
                                    savedItem.actualWinPayout = 0;
                                    savedItem.actualPlacePayout = topPick.placeDiv > 0 ? topPick.placeDiv : 1.2;
                                } else {
                                    savedItem.actualWinPayout = 0;
                                    savedItem.actualPlacePayout = 0;
                                }
                            }
                        }
                        updated = true;
                    }
                }
            });

            if (updated) {
                await sortAndPersistMeetingsObject();
                renderSavedPredictions();
                updateAllUIComponents();
            }
        }

        async function syncResultsWithSavedHistory() {
            await checkAutoFillPostRaceResults();
            updateAllUIComponents();
            showNotification("Saved history synchronized with race results.", "success");
        }

        function getRacePillStatus(key) {
            let raceObj = window.allRaceMeetings[key];
            if (!raceObj) return 'neutral';
            
            let isSettled = window.savedPredictions.some(item => {
                let trackMatch = (item.trackName || "").toUpperCase().includes(raceObj.trackName.toUpperCase()) || raceObj.trackName.toUpperCase().includes((item.trackName || "").toUpperCase());
                let raceNumMatch = String(item.raceNumber || "") === String(raceObj.raceNumber || "") || new RegExp(`\\bRACE\\s*${raceObj.raceNumber}\\b`, 'i').test(item.trackName || "");
                
                let dateMatch = (!item.raceDate || !raceObj.raceDate) ? true : item.raceDate === raceObj.raceDate;

                let hasWinner = item.actualWinner && item.actualWinner.trim() !== "";
                
                return trackMatch && raceNumMatch && dateMatch && hasWinner;
            });

            if (isSettled) return 'settled';
            if (window.computedPredictionsCache[key]) return 'computed';
            return 'neutral';
        }

        function updateRaceSelector() {
            const selector = document.getElementById('raceSelector');
            selector.innerHTML = '';
            let sortedKeys = getSortedRaceKeys();
            
            const verticalRibbon = document.getElementById('vertical-race-ribbon');
            const pillsStrip = document.getElementById('vertical-pills-strip');
            const ribbonCount = document.getElementById('ribbon-count');

            if (sortedKeys.length > 0) {
                document.getElementById('race-selector-container').classList.remove('hidden');
                document.getElementById('race-selector-container').classList.add('flex');
                
                verticalRibbon.classList.remove('hidden');
                verticalRibbon.classList.add('flex');
                pillsStrip.innerHTML = '';
                ribbonCount.innerText = sortedKeys.length;

                let groupedMeetings = {};
                sortedKeys.forEach(k => {
                    let raceObj = window.allRaceMeetings[k];
                    let track = (raceObj.trackName || "UNKNOWN").toUpperCase();
                    let date = raceObj.raceDate || "No Date";
                    if (/^\d{8}$/.test(date)) {
                        date = `${date.slice(0,2)}/${date.slice(2,4)}/${date.slice(4,8)}`;
                    }
                    let groupKey = `${track} | ${date}`;
                    if (!groupedMeetings[groupKey]) {
                        groupedMeetings[groupKey] = {
                            trackName: raceObj.trackName || "UNKNOWN",
                            raceDate: date,
                            keys: []
                        };
                    }
                    groupedMeetings[groupKey].keys.push(k);
                });

                Object.keys(groupedMeetings).forEach((groupKey, groupIdx) => {
                    let group = groupedMeetings[groupKey];
                    let safeGroupId = 'ribbon-group-' + groupIdx;
                    
                    let hasActive = group.keys.includes(window.activeRaceKey);
                    if (hasActive) {
                        window.expandedRibbonGroups.add(safeGroupId);
                    }
                    let isExpanded = window.expandedRibbonGroups.has(safeGroupId);

                    let groupContainer = document.createElement('div');
                    groupContainer.className = "flex flex-col mb-1.5";
                    
                    let headerBtn = document.createElement('button');
                    headerBtn.className = "flex justify-between items-center w-full text-left px-2 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wider transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 border border-transparent hover:border-slate-200 dark:hover:border-slate-700 focus:outline-none";
                    
                    let chevronClass = isExpanded ? "rotate-180" : "";
                    headerBtn.innerHTML = `
                        <span class="truncate">${group.trackName} <span class="font-normal text-slate-400 mx-0.5">•</span> <span class="text-[10px]">${group.raceDate}</span></span>
                        <svg id="${safeGroupId}-icon" class="w-3.5 h-3.5 text-slate-400 transition-transform duration-200 flex-shrink-0 ${chevronClass}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7"></path></svg>
                    `;
                    
                    let contentDiv = document.createElement('div');
                    contentDiv.id = safeGroupId;
                    contentDiv.className = `pl-1.5 ml-1.5 border-l-2 border-slate-200 dark:border-slate-700 mt-1.5 gap-1 flex-col ${isExpanded ? 'flex' : 'hidden'}`;

                    headerBtn.onclick = function() {
                        let currentlyExpanded = window.expandedRibbonGroups.has(safeGroupId);
                        if (currentlyExpanded) {
                            window.expandedRibbonGroups.delete(safeGroupId);
                            contentDiv.classList.remove('flex');
                            contentDiv.classList.add('hidden');
                            document.getElementById(`${safeGroupId}-icon`).classList.remove('rotate-180');
                        } else {
                            window.expandedRibbonGroups.add(safeGroupId);
                            contentDiv.classList.remove('hidden');
                            contentDiv.classList.add('flex');
                            document.getElementById(`${safeGroupId}-icon`).classList.add('rotate-180');
                        }
                    };

                    groupContainer.appendChild(headerBtn);

                    group.keys.forEach(k => {
                        let raceObj = window.allRaceMeetings[k];
                        let opt = document.createElement('option');
                        opt.value = k;
                        opt.innerText = k + (raceObj.raceDistance ? ` [${raceObj.raceDistance}]` : '');
                        if (k === window.activeRaceKey) opt.selected = true;
                        selector.appendChild(opt);

                        let isCurrent = (k === window.activeRaceKey);
                        let statusType = getRacePillStatus(k);

                        let statusIndicator = '<span class="text-slate-400 dark:text-slate-500 font-normal">⚪</span>';
                        if (statusType === 'settled') {
                            statusIndicator = '<span class="text-blue-600 dark:text-blue-400 font-bold">🎯</span>';
                        } else if (statusType === 'computed') {
                            statusIndicator = '<span class="text-green-500 dark:text-green-400 font-bold">🟢</span>';
                        }
                        
                        let pillBtn = document.createElement('button');
                        pillBtn.className = `w-full text-left px-2 py-1.5 rounded text-[11px] font-bold transition-colors flex items-center justify-between border ${
                            isCurrent 
                            ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 border-slate-900 dark:border-white shadow-sm' 
                            : 'bg-slate-50 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700'
                        }`;
                        pillBtn.innerHTML = `<span class="truncate pr-1">Race ${raceObj.raceNumber || '?'} ${raceObj.raceDistance ? '[' + raceObj.raceDistance + ']' : ''}</span> <span class="flex-shrink-0">${statusIndicator}</span>`;
                        pillBtn.title = k;
                        pillBtn.onclick = function() {
                            switchActiveRace(k);
                        };
                        contentDiv.appendChild(pillBtn);
                    });

                    groupContainer.appendChild(contentDiv);
                    pillsStrip.appendChild(groupContainer);
                });

                renderActiveRace();
            } else {
                document.getElementById('race-selector-container').classList.add('hidden');
                verticalRibbon.classList.add('hidden');
                verticalRibbon.classList.remove('flex');
                pillsStrip.innerHTML = `<span class="text-xs text-slate-400 italic text-center py-4">No meetings imported</span>`;
                ribbonCount.innerText = '0';
            }
        }

        async function switchActiveRace(key) {
            window.activeRaceKey = key;
            await sortAndPersistMeetingsObject();
            updateAllUIComponents();
            
            if (window.dogStats && window.dogStats.length > 0) {
                refreshPredictions(false);
            }
        }

        async function renameActiveRace() {
            if (!window.activeRaceKey || !window.allRaceMeetings[window.activeRaceKey]) {
                showNotification("No active race selected to rename.");
                return;
            }

            let currentKey = window.activeRaceKey;
            let newTitle = prompt("Enter custom title for this race entry:", currentKey);
            
            if (newTitle && newTitle.trim() !== "" && newTitle !== currentKey) {
                newTitle = newTitle.trim();
                if (window.allRaceMeetings[newTitle]) {
                    showNotification("An entry with this name already exists.");
                    return;
                }

                window.allRaceMeetings[newTitle] = window.allRaceMeetings[currentKey];
                delete window.allRaceMeetings[currentKey];
                if (window.computedPredictionsCache[currentKey]) {
                    window.computedPredictionsCache[newTitle] = window.computedPredictionsCache[currentKey];
                    delete window.computedPredictionsCache[currentKey];
                }
                window.activeRaceKey = newTitle;

                let parts = newTitle.split('-');
                if (parts.length > 0) {
                    window.allRaceMeetings[newTitle].trackName = parts[0].trim();
                }
                let raceNumMatch = newTitle.match(/RACE\s*(\d+)/i);
                if (raceNumMatch) {
                    window.allRaceMeetings[newTitle].raceNumber = raceNumMatch[1];
                }

                await sortAndPersistMeetingsObject();
                updateAllUIComponents();
                if (window.dogStats.length > 0) {
                    refreshPredictions(false);
                }
                showNotification("Race title updated successfully.", "success");
            }
        }

        function renderActiveRace() {
            let race = window.allRaceMeetings[window.activeRaceKey];
            if (!race) return;

            let formattedTitle = `${window.activeRaceKey}${race.raceDistance && !window.activeRaceKey.includes(race.raceDistance) ? ' (' + race.raceDistance + ')' : ''}`;
            document.getElementById('race-title').innerText = formattedTitle;
            
            let statsDogNames = new Set(window.dogStats.map(s => s.name.toUpperCase().trim()));

            const tbody = document.getElementById('starters-tbody');
            tbody.innerHTML = '';
            race.starters.forEach(s => {
                const tr = document.createElement('tr');
                const isVacant = s.starterName.includes('VACANT');
                const statusBadge = s.scratched ? '<span class="bg-pink-100 text-pink-800 border border-pink-300 text-xs px-2 py-1 rounded font-bold shadow-sm">Scratched</span>' : '<span class="bg-green-100 text-green-800 border border-green-300 text-xs px-2 py-1 rounded font-bold shadow-sm">Active</span>';
                
                let placingBadge = '-';
                if (s.placing === 1) placingBadge = '<span class="bg-green-100 text-green-800 font-bold px-2 py-0.5 rounded">1st</span>';
                else if (s.placing === 2) placingBadge = '<span class="bg-yellow-100 text-yellow-800 font-bold px-2 py-0.5 rounded">2nd</span>';
                else if (s.placing === 3) placingBadge = '<span class="bg-orange-100 text-orange-800 font-bold px-2 py-0.5 rounded">3rd</span>';
                else if (s.placing > 3) placingBadge = `<span class="text-slate-500">${s.placing}th</span>`;

                if (isVacant || s.scratched) {
                    tr.classList.add('bg-slate-50', 'dark:bg-slate-800/50', 'text-slate-400');
                }

                let statsIconHtml = '';
                if (!isVacant) {
                    let hasStats = statsDogNames.has(s.starterName.toUpperCase().trim());
                    if (hasStats) {
                        statsIconHtml = `<span class="inline-flex items-center gap-1 ml-2 px-2 py-0.5 rounded text-[10px] font-bold bg-green-100 dark:bg-green-950/60 text-green-700 dark:text-green-300 border border-green-300 dark:border-green-800">🟢 Stats Found</span>`;
                    } else {
                        statsIconHtml = `<span class="inline-flex items-center gap-1 ml-2 px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-800">🔴 Missing Stats</span>`;
                    }
                }
                
                tr.innerHTML = `
                    <td class="p-3 font-mono">${s.officialBox || s.box}</td>
                    <td class="p-3 font-bold flex items-center justify-between"><span>${s.starterName}</span> ${statsIconHtml}</td>
                    <td class="p-3">${s.trainer || '-'}</td>
                    <td class="p-3 font-mono">$${s.winDiv !== 0 ? s.winDiv : '-'}</td>
                    <td class="p-3 font-mono">$${s.placeDiv !== 0 ? s.placeDiv : '-'}</td>
                    <td class="p-3 font-mono">${placingBadge}</td>
                    <td class="p-3">${isVacant ? '-' : statusBadge}</td>
                `;
                tbody.appendChild(tr);
            });
        }

        function renderBatchSummaryDashboard() {
            const gridContainer = document.getElementById('batch-cards-grid');
            let sortedKeys = getSortedRaceKeys();

            if (sortedKeys.length === 0) {
                gridContainer.innerHTML = `<div class="col-span-full p-8 text-center text-slate-400 italic">No race meetings imported yet. Please upload TXT meeting files.</div>`;
                return;
            }

            gridContainer.innerHTML = '';
            sortedKeys.forEach(key => {
                let race = window.allRaceMeetings[key];
                let topPick = "Pending Stats";
                let confidence = "-";
                let confBadgeClass = "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300";

                if (window.dogStats && window.dogStats.length > 0) {
                    let computed = computeRacePredictionData(race);
                    if (computed && computed.scoredDogs.length > 0) {
                        topPick = computed.scoredDogs[0].name;
                        confidence = computed.confidenceText;
                        confBadgeClass = computed.confidenceBadgeClass;
                    }
                }

                const card = document.createElement('div');
                card.className = "bg-slate-50 dark:bg-slate-800 p-4 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm hover:border-slate-400 cursor-pointer transition-colors flex flex-col justify-between";
                card.onclick = function() {
                    switchActiveRace(key);
                    document.querySelectorAll("button.tab-btn")[3].click();
                };
                card.innerHTML = `
                    <div>
                        <div class="flex justify-between items-center mb-1.5">
                            <span class="text-xs font-bold text-slate-500 dark:text-slate-400 truncate">${key}</span>
                            <span class="text-[10px] font-mono bg-slate-200 dark:bg-slate-700 px-1 rounded">${race.raceDistance || 'N/A'}</span>
                        </div>
                        <div class="text-sm font-black text-slate-900 dark:text-white truncate mb-2">🥇 ${topPick}</div>
                    </div>
                    <div class="flex justify-between items-center pt-2 border-t border-slate-200 dark:border-slate-700">
                        <span class="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">Confidence</span>
                        <span class="text-[10px] px-2 py-0.5 rounded font-bold ${confBadgeClass}">${confidence}</span>
                    </div>
                `;
                gridContainer.appendChild(card);
            });
        }

        async function clearActiveMeetingsData() {
            if (Object.keys(window.allRaceMeetings).length === 0) {
                showNotification("No imported race meetings to clear.");
                return;
            }
            if (confirm("Are you sure you want to clear all imported race meetings?")) {
                window.allRaceMeetings = {};
                window.activeRaceKey = "";
                window.currentComputedResult = null;
                window.computedPredictionsCache = {};
                await sortAndPersistMeetingsObject();
                
                document.getElementById('txtFileLabel').innerText = "Drag files or click";
                document.getElementById('race-selector-container').classList.add('hidden');
                
                const verticalRibbon = document.getElementById('vertical-race-ribbon');
                const pillsStrip = document.getElementById('vertical-pills-strip');
                const ribbonCount = document.getElementById('ribbon-count');
                
                verticalRibbon.classList.add('hidden');
                verticalRibbon.classList.remove('flex');
                pillsStrip.innerHTML = `<span class="text-xs text-slate-400 italic text-center py-4">No meetings imported</span>`;
                ribbonCount.innerText = '0';

                document.getElementById('race-title').innerText = "Race Details (Pending Import)";
                document.getElementById('starters-tbody').innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-400 font-medium">No race data loaded. Please import TXT meeting files.</td></tr>`;
                renderBatchSummaryDashboard();
                showNotification("All imported race meetings cleared.", "success");
                refreshStorageEstimate();
            }
        }

        async function clearDogStatsData() {
            if (!window.dogStats || window.dogStats.length === 0) {
                showNotification("No dog statistics loaded to clear.");
                return;
            }
            if (confirm("Are you sure you want to clear all accumulated dog statistics history?")) {
                window.dogStats = [];
                await sortAndPersistMeetingsObject();

                document.getElementById('csvFileLabel').innerText = "Drag files or click";
                renderStatsTable();
                renderActiveRace();
                renderBatchSummaryDashboard();
                showNotification("All dog statistics history cleared.", "success");
                refreshStorageEstimate();
            }
        }

        document.getElementById('csvFileInput').addEventListener('change', async function(e) {
            const files = e.target.files;
            if (!files || files.length === 0) return;

            let processedFiles = 0;
            let totalSkipped = 0;
            let totalAdded = 0;

            let existingRecords = new Set();
            if (window.dogStats) {
                window.dogStats.forEach(d => {
                    existingRecords.add(`${d.name}_${d.date}_${d.track}`);
                });
            }

            for (let file of files) {
                let inferredDogName = file.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ").toUpperCase();
                
                const reader = new FileReader();
                reader.onload = async function(e) {
                    let result = parseHeaderCsvContent(e.target.result, inferredDogName, existingRecords);
                    totalAdded += result.added;
                    totalSkipped += result.skipped;
                    
                    if (result.newRecords && result.newRecords.length > 0) {
                        result.newRecords.forEach(d => window.dogStats.push(d));
                    }

                    processedFiles++;
                    if (processedFiles === files.length) {
                        document.getElementById('csvFileLabel').innerText = `${window.dogStats.length} stats records loaded`;
                        await sortAndPersistMeetingsObject();
                        renderStatsTable();
                        renderActiveRace();
                        renderBatchSummaryDashboard();
                        
                        if (window.activeRaceKey) {
                            refreshPredictions(false);
                        }
                        
                        if (totalSkipped > 0) {
                            let msgType = totalAdded > 0 ? "success" : "error";
                            showNotification(`Processed ${files.length} file(s). Added ${totalAdded} new records. Skipped ${totalSkipped} duplicates.`, msgType);
                        } else {
                            showNotification(`Successfully imported ${files.length} CSV file(s). Added ${totalAdded} new records!`, "success");
                        }

                        document.getElementById('csvFileInput').value = "";
                    }
                };
                reader.readAsText(file);
            }
        });

        function parseHeaderCsvContent(csvText, fallbackDogName, existingRecordsSet) {
            const rawLines = csvText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            let newRecords = [];
            let added = 0;
            let skipped = 0;

            if (rawLines.length < 2) return { newRecords, added, skipped };

            let colMap = {};
            let currentDogName = fallbackDogName;
            let currentDogSex = "Unknown";

            for (let i = 0; i < rawLines.length; i++) {
                let line = rawLines[i];
                let upperLine = line.toUpperCase();

                if (upperLine.startsWith('RACE') || upperLine.startsWith('DOG NAME')) {
                    if (upperLine.startsWith('DOG NAME')) {
                        let headers = line.split(',').map(h => h.replace(/"/g, '').trim().toUpperCase());
                        colMap = {};
                        headers.forEach((h, idx) => {
                            colMap[h] = idx;
                        });
                    }
                    continue;
                }

                let parts = [];
                let inQuotes = false;
                let currentVal = "";
                for (let char of line) {
                    if (char === '"') {
                        inQuotes = !inQuotes;
                    } else if (char === ',' && !inQuotes) {
                        parts.push(currentVal.trim().replace(/^"|"$/g, ''));
                        currentVal = "";
                    } else {
                        currentVal += char;
                    }
                }
                parts.push(currentVal.trim().replace(/^"|"$/g, ''));

                if (parts.length < 5) continue;

                let getIdx = (name, fallback) => colMap[name] !== undefined ? colMap[name] : fallback;
                let nameIdx = getIdx('DOG NAME', 0);
                let dateIdx = getIdx('DATE', 6);
                let sexIdx = getIdx('SEX', 1);
                let plcIdx = getIdx('PLC', 2);
                let boxIdx = getIdx('BOX', 3);
                let distIdx = getIdx('DIST', 5);
                let trackIdx = getIdx('TRACK', 7);
                let timeIdx = getIdx('TIME', 9);
                let splitIdx = getIdx('1 SEC', 12);
                let pirIdx = getIdx('PIR', 15);

                let nameField = parts[nameIdx] !== undefined ? parts[nameIdx] : "";
                if (nameField !== "" && nameField.toUpperCase() !== "NAN" && nameField !== "UNDEFINED") {
                    let cleanedName = nameField.replace(/^\d+\.\s*/, '').trim();
                    if (cleanedName.length > 1) {
                        currentDogName = cleanedName.toUpperCase();
                    }
                    let sexField = sexIdx !== -1 && parts[sexIdx] ? parts[sexIdx] : "";
                    let combinedHeader = `${currentDogName} ${sexField}`;
                    currentDogSex = extractSex(combinedHeader);
                }

                let raceDate = dateIdx !== -1 && parts[dateIdx] ? parts[dateIdx] : "-";
                let plc = plcIdx !== -1 && parts[plcIdx] ? parts[plcIdx] : "-";
                let box = boxIdx !== -1 && parts[boxIdx] ? parts[boxIdx] : "-";
                let dist = distIdx !== -1 && parts[distIdx] ? parts[distIdx] : "";
                let track = trackIdx !== -1 && parts[trackIdx] ? parts[trackIdx] : "";
                let time = timeIdx !== -1 && parts[timeIdx] ? parts[timeIdx] : "-";
                let split1 = splitIdx !== -1 && parts[splitIdx] ? parts[splitIdx] : "-";
                let pir = pirIdx !== -1 && parts[pirIdx] ? parts[pirIdx] : "-";

                if (plc !== "-" || time !== "-") {
                    let trackUpper = track.toUpperCase();
                    let recordKey = `${currentDogName}_${raceDate}_${trackUpper}`;

                    if (existingRecordsSet && existingRecordsSet.has(recordKey)) {
                        skipped++;
                    } else {
                        newRecords.push({
                            name: currentDogName,
                            date: raceDate,
                            sex: currentDogSex,
                            plc: plc,
                            box: String(box).trim(),
                            dist: dist,
                            track: trackUpper,
                            pir: pir,
                            split1: split1,
                            time: time
                        });
                        added++;
                        
                        if (existingRecordsSet) {
                            existingRecordsSet.add(recordKey);
                        }
                    }
                }
            }
            return { newRecords, added, skipped };
        }

        async function submitManualStatRow() {
            let name = document.getElementById('m-name').value.trim().toUpperCase();
            let date = document.getElementById('m-date').value.trim();
            let sex = document.getElementById('m-sex').value;
            let plc = document.getElementById('m-plc').value.trim();
            let box = document.getElementById('m-box').value.trim();
            let dist = document.getElementById('m-dist').value.trim();
            let track = document.getElementById('m-track').value.trim().toUpperCase();
            let pir = document.getElementById('m-pir').value.trim();
            let split1 = document.getElementById('m-split1').value.trim();
            let time = document.getElementById('m-time').value.trim();

            if (!name) {
                showNotification("Dog name is required for manual entry.");
                return;
            }

            window.dogStats.unshift({
                name: name,
                date: date || "-",
                sex: sex || "Unknown",
                plc: plc || "-",
                box: String(box || "-").trim(),
                dist: dist || "",
                track: track || "",
                pir: pir || "-",
                split1: split1 || "-",
                time: time || "-"
            });

            await sortAndPersistMeetingsObject();
            renderStatsTable();
            renderActiveRace();
            renderBatchSummaryDashboard();
            toggleManualEntryDrawer();

            if (window.activeRaceKey) {
                refreshPredictions(false);
            }

            document.getElementById('m-name').value = "";
            document.getElementById('m-date').value = "";
            document.getElementById('m-sex').value = "";
            document.getElementById('m-plc').value = "";
            document.getElementById('m-box').value = "";
            document.getElementById('m-dist').value = "";
            document.getElementById('m-track').value = "";
            document.getElementById('m-pir').value = "";
            document.getElementById('m-split1').value = "";
            document.getElementById('m-time').value = "";

            showNotification("Manual run/trial successfully added to dog history!", "success");
        }

        function renderStatsTable() {
            const tbody = document.getElementById('stats-tbody');
            tbody.innerHTML = '';
            
            if (!window.dogStats || window.dogStats.length === 0) {
                tbody.innerHTML = `<tr><td colspan="11" class="p-4 text-center text-slate-400 font-medium">No stats loaded. Please import CSV files or add manual records.</td></tr>`;
                return;
            }

            window.dogStats.forEach((d, index) => {
                const tr = document.createElement('tr');
                tr.id = `stat-row-${index}`;
                const sexBadge = d.sex === 'Dog' ? '<span class="text-blue-600 dark:text-blue-400 text-xs font-bold">🐶 Dog</span>' : (d.sex === 'Bitch' ? '<span class="text-pink-600 dark:text-pink-400 text-xs font-bold">🐾 Bitch</span>' : '-');
                
                tr.innerHTML = `
                    <td class="p-3 font-bold text-slate-800 dark:text-slate-200">${d.name}</td>
                    <td class="p-3 font-mono text-xs">${d.date || '-'}</td>
                    <td class="p-3">${sexBadge}</td>
                    <td class="p-3 font-mono">${d.plc}</td>
                    <td class="p-3 font-mono">${d.box}</td>
                    <td class="p-3">${d.dist}m</td>
                    <td class="p-3">${d.track}</td>
                    <td class="p-3 font-mono text-xs text-slate-500">${d.pir || '-'}</td>
                    <td class="p-3 font-mono">${d.split1 || '-'}</td>
                    <td class="p-3 font-mono">${d.time}</td>
                    <td class="p-3 text-right space-x-2">
                        <button onclick="editStatRow(${index})" class="bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 text-xs font-bold py-1 px-2.5 rounded shadow transition-colors">Edit</button>
                        <button onclick="deleteStatRow(${index})" class="bg-red-600 hover:bg-red-700 text-white text-xs font-bold py-1 px-2.5 rounded shadow transition-colors">Delete</button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }

        function editStatRow(index) {
            let d = window.dogStats[index];
            const tr = document.getElementById(`stat-row-${index}`);
            if (!tr) return;

            tr.innerHTML = `
                <td class="p-2"><input type="text" id="edit-name-${index}" value="${d.name}" class="w-full text-xs px-2 py-1 border rounded bg-white dark:bg-slate-900 font-bold"/></td>
                <td class="p-2"><input type="text" id="edit-date-${index}" value="${d.date || ''}" placeholder="YYYY-MM-DD" class="w-full text-xs px-2 py-1 border rounded bg-white dark:bg-slate-900 font-mono"/></td>
                <td class="p-2">
                    <select id="edit-sex-${index}" class="text-xs px-2 py-1 border rounded bg-white dark:bg-slate-900">
                        <option value="" ${!d.sex || d.sex === 'Unknown' ? 'selected' : ''}>-- Select --</option>
                        <option value="Dog" ${d.sex === 'Dog' ? 'selected' : ''}>Dog</option>
                        <option value="Bitch" ${d.sex === 'Bitch' ? 'selected' : ''}>Bitch</option>
                    </select>
                </td>
                <td class="p-2"><input type="text" id="edit-plc-${index}" value="${d.plc}" class="w-16 text-xs px-2 py-1 border rounded bg-white dark:bg-slate-900 font-mono"/></td>
                <td class="p-2"><input type="text" id="edit-box-${index}" value="${d.box}" class="w-14 text-xs px-2 py-1 border rounded bg-white dark:bg-slate-900 font-mono"/></td>
                <td class="p-2"><input type="text" id="edit-dist-${index}" value="${d.dist}" class="w-16 text-xs px-2 py-1 border rounded bg-white dark:bg-slate-900 font-mono"/></td>
                <td class="p-2"><input type="text" id="edit-track-${index}" value="${d.track}" class="w-16 text-xs px-2 py-1 border rounded bg-white dark:bg-slate-900"/></td>
                <td class="p-2"><input type="text" id="edit-pir-${index}" value="${d.pir || ''}" class="w-20 text-xs px-2 py-1 border rounded bg-white dark:bg-slate-900 font-mono"/></td>
                <td class="p-2"><input type="text" id="edit-split1-${index}" value="${d.split1 || ''}" class="w-16 text-xs px-2 py-1 border rounded bg-white dark:bg-slate-900 font-mono"/></td>
                <td class="p-2"><input type="text" id="edit-time-${index}" value="${d.time}" class="w-16 text-xs px-2 py-1 border rounded bg-white dark:bg-slate-900 font-mono"/></td>
                <td class="p-2 text-right space-x-1">
                    <button onclick="saveStatRow(${index})" class="bg-green-600 hover:bg-green-700 text-white text-xs font-bold py-1 px-2.5 rounded shadow transition-colors">Save</button>
                    <button onclick="renderStatsTable()" class="bg-slate-400 hover:bg-slate-500 text-white text-xs font-bold py-1 px-2.5 rounded shadow transition-colors">Cancel</button>
                </td>
            `;
        }

        async function saveStatRow(index) {
            let name = document.getElementById(`edit-name-${index}`).value.trim().toUpperCase();
            let date = document.getElementById(`edit-date-${index}`).value.trim();
            let sex = document.getElementById(`edit-sex-${index}`).value;
            let plc = document.getElementById(`edit-plc-${index}`).value.trim();
            let box = document.getElementById(`edit-box-${index}`).value.trim();
            let dist = document.getElementById(`edit-dist-${index}`).value.trim();
            let track = document.getElementById(`edit-track-${index}`).value.trim().toUpperCase();
            let pir = document.getElementById(`edit-pir-${index}`).value.trim();
            let split1 = document.getElementById(`edit-split1-${index}`).value.trim();
            let time = document.getElementById(`edit-time-${index}`).value.trim();

            if (!name) {
                showNotification("Dog name cannot be empty.");
                return;
            }

            window.dogStats[index] = {
                name: name,
                date: date,
                sex: sex || "Unknown",
                plc: plc,
                box: String(box).trim(),
                dist: dist,
                track: track,
                pir: pir,
                split1: split1,
                time: time
            };

            await sortAndPersistMeetingsObject();
            renderStatsTable();
            renderActiveRace();
            renderBatchSummaryDashboard();
            if (window.activeRaceKey) {
                refreshPredictions(false);
            }
            showNotification("Dog statistics record updated successfully!", "success");
        }

        async function deleteStatRow(index) {
            if (confirm("Are you sure you want to delete this specific dog performance record?")) {
                window.dogStats.splice(index, 1);
                await sortAndPersistMeetingsObject();
                renderStatsTable();
                renderActiveRace();
                renderBatchSummaryDashboard();
                if (window.activeRaceKey) {
                    refreshPredictions(false);
                }
                showNotification("Dog statistics record deleted.", "success");
            }
        }

        function filterStatsTable() {
            let input = document.getElementById('statsSearchInput');
            let filter = input.value.toUpperCase();
            let tbody = document.getElementById('stats-tbody');
            let rows = tbody.getElementsByTagName('tr');

            for (let i = 0; i < rows.length; i++) {
                let nameCell = rows[i].getElementsByTagName('td')[0];
                if (nameCell) {
                    let txtValue = nameCell.textContent || nameCell.innerText;
                    if (txtValue.toUpperCase().indexOf(filter) > -1) {
                        rows[i].style.display = "";
                    } else {
                        rows[i].style.display = "none";
                    }
                }
            }
        }

        function computeRacePredictionData(activeRace) {
            let targetDist = activeRace.raceDistance ? activeRace.raceDistance.replace('m', '').trim() : "";
            let targetDistNum = parseFloat(targetDist) || 0;
            let targetTrack = activeRace.trackName ? activeRace.trackName.toUpperCase().trim() : "";

            let allTrackDistTimes = [];
            window.dogStats.forEach(stat => {
                let statDist = stat.dist ? stat.dist.trim() : "";
                let statDistNum = parseFloat(statDist) || 0;
                let statTrack = stat.track ? stat.track.toUpperCase().trim() : "";
                let time = parseFloat(stat.time);
                if (!isNaN(time) && targetDistNum > 0 && statDistNum === targetDistNum && (!targetTrack || statTrack.includes(targetTrack) || targetTrack.includes(statTrack))) {
                    allTrackDistTimes.push(time);
                }
            });
            allTrackDistTimes.sort((a, b) => a - b);
            let trackMedianStandard = allTrackDistTimes.length > 0 ? allTrackDistTimes[Math.floor(allTrackDistTimes.length / 2)] : 30.0;

            let dogAverages = {};
            let rawDogRecords = {};
            window.dogStats.forEach(stat => {
                let name = stat.name;
                if (!rawDogRecords[name]) rawDogRecords[name] = [];
                rawDogRecords[name].push(stat);
            });

            for (let name in rawDogRecords) {
                let records = rawDogRecords[name];
                records.sort((a, b) => {
                    let dateA = a.date && a.date !== "-" ? new Date(a.date) : new Date(0);
                    let dateB = b.date && b.date !== "-" ? new Date(b.date) : new Date(0);
                    return dateB - dateA;
                });

                let dogValidTimes = [];
                records.forEach(st => {
                    let t = parseFloat(st.time);
                    let stDist = st.dist ? parseFloat(st.dist) || 0 : 0;
                    if (!isNaN(t) && stDist > 0 && targetDistNum > 0) {
                        dogValidTimes.push((t / stDist) * targetDistNum);
                    }
                });
                dogValidTimes.sort((a, b) => a - b);

                let evaluatedBestTime = 999;
                if (dogValidTimes.length >= 3) {
                    let filteredOutlierTimes = dogValidTimes.slice(1);
                    evaluatedBestTime = Math.min(...filteredOutlierTimes);
                } else if (dogValidTimes.length > 0) {
                    evaluatedBestTime = dogValidTimes[0];
                }

                dogAverages[name] = {
                    sex: "Unknown",
                    totalPlc: 0, count: 0, bestTime: evaluatedBestTime, best1Sec: 999,
                    earlySum: 0, earlyCount: 0, gainSum: 0, gainCount: 0,
                    distTotalPlc: 0, distCount: 0, 
                    trackDistBestTime: 999, normBestTime: evaluatedBestTime, 
                    trackDistBest1Sec: 999, normBest1Sec: 999,
                    distTimeSum: 0, distTimeCount: 0, 
                    distSplitSum: 0, distSplitCount: 0,
                    distEarlySum: 0, distEarlyCount: 0, distGainSum: 0, distGainCount: 0,
                    allTimeTimeSum: 0, allTimeTimeCount: 0,
                    allTimeSplitSum: 0, allTimeSplitCount: 0,
                    boxStats: {},
                    formArray: [],
                    lastRunDate: null,
                    weightedTimeSum: 0,
                    weightedTimeWeightTotal: 0,
                    weightedSplitSum: 0,
                    weightedSplitWeightTotal: 0
                };

                records.forEach((stat, idx) => {
                    if (dogAverages[name].sex === "Unknown" && stat.sex !== "Unknown") {
                        dogAverages[name].sex = stat.sex;
                    }

                    let parsedDate = stat.date && stat.date !== "-" ? new Date(stat.date) : null;
                    if (parsedDate && !isNaN(parsedDate)) {
                        if (!dogAverages[name].lastRunDate || parsedDate > dogAverages[name].lastRunDate) {
                            dogAverages[name].lastRunDate = parsedDate;
                        }
                    }

                    let plc = parseFloat(stat.plc);
                    let time = parseFloat(stat.time);
                    let split1 = parseFloat(stat.split1);
                    let statDist = stat.dist ? stat.dist.trim() : "";
                    let statDistNum = parseFloat(statDist) || 0;
                    let statTrack = stat.track ? stat.track.toUpperCase().trim() : "";
                    let statBox = String(stat.box || "").trim();
                    let pirParsed = parsePir(stat.pir);

                    if (statBox && statBox !== "-" && statBox !== "") {
                        if (!dogAverages[name].boxStats[statBox]) {
                            dogAverages[name].boxStats[statBox] = { starts: 0, wins: 0, places: 0 };
                        }
                        dogAverages[name].boxStats[statBox].starts += 1;
                        if (!isNaN(plc)) {
                            if (plc === 1) dogAverages[name].boxStats[statBox].wins += 1;
                            if (plc >= 1 && plc <= 3) dogAverages[name].boxStats[statBox].places += 1;
                        }
                    }

                    if (!isNaN(plc)) {
                        dogAverages[name].totalPlc += plc;
                        dogAverages[name].count += 1;
                        if (dogAverages[name].formArray.length < 5) {
                            dogAverages[name].formArray.push(plc);
                        }
                        if (targetDist && statDist === targetDist) {
                            dogAverages[name].distTotalPlc += plc;
                            dogAverages[name].distCount += 1;
                        }
                    }
                    if (!isNaN(split1) && split1 < dogAverages[name].best1Sec) {
                        dogAverages[name].best1Sec = split1;
                    }
                    if (pirParsed.early !== null) {
                        dogAverages[name].earlySum += pirParsed.early;
                        dogAverages[name].earlyCount += 1;
                        dogAverages[name].gainSum += pirParsed.gain;
                        dogAverages[name].gainCount += 1;
                    }

                    let isTrackDistMatch = targetDistNum > 0 && statDistNum === targetDistNum && (!targetTrack || statTrack.includes(targetTrack) || targetTrack.includes(statTrack));
                    if (isTrackDistMatch) {
                        if (!isNaN(time)) {
                            if (time < dogAverages[name].trackDistBestTime) dogAverages[name].trackDistBestTime = time;
                            dogAverages[name].distTimeSum += time;
                            dogAverages[name].distTimeCount += 1;
                        }
                        if (!isNaN(split1)) {
                            if (split1 < dogAverages[name].trackDistBest1Sec) dogAverages[name].trackDistBest1Sec = split1;
                            dogAverages[name].distSplitSum += split1;
                            dogAverages[name].distSplitCount += 1;
                        }
                        if (pirParsed.early !== null) {
                            dogAverages[name].distEarlySum += pirParsed.early;
                            dogAverages[name].distEarlyCount += 1;
                            dogAverages[name].distGainSum += pirParsed.gain;
                            dogAverages[name].distGainCount += 1;
                        }
                    }

                    let runDate = (stat.date && stat.date !== "-") ? new Date(stat.date) : null;
                    let today = new Date(); 
                    let daysAgo = 30;
                    if (runDate && !isNaN(runDate)) {
                        daysAgo = Math.max(0, Math.floor((today - runDate) / (1000 * 60 * 60 * 24)));
                    }
                    let baseRecencyWeight = Math.exp(-0.025 * daysAgo);

                    let finalCompositeWeight = 1.0;
                    if (statDistNum > 0 && targetDistNum > 0) {
                        let distanceRatio = Math.min(statDistNum, targetDistNum) / Math.max(statDistNum, targetDistNum);
                        finalCompositeWeight = baseRecencyWeight * Math.pow(distanceRatio, 2);
                    } else {
                        finalCompositeWeight = baseRecencyWeight;
                    }

                    if (!isNaN(time) && statDistNum > 0 && targetDistNum > 0) {
                        let normalizedTime = (time / statDistNum) * targetDistNum;
                        dogAverages[name].allTimeTimeSum += normalizedTime;
                        dogAverages[name].allTimeTimeCount += 1;

                        let maxAllowedTime = evaluatedBestTime + 1.2;
                        let safeNormalizedTime = Math.min(normalizedTime, maxAllowedTime);

                        dogAverages[name].weightedTimeSum += (safeNormalizedTime * finalCompositeWeight);
                        dogAverages[name].weightedTimeWeightTotal += finalCompositeWeight;
                    }

                    if (!isNaN(split1) && statDistNum > 0 && targetDistNum > 0) {
                        let normalizedSplit = (split1 / statDistNum) * targetDistNum;
                        dogAverages[name].allTimeSplitSum += normalizedSplit;
                        dogAverages[name].allTimeSplitCount += 1;
                        if (normalizedSplit < dogAverages[name].normBest1Sec) {
                            dogAverages[name].normBest1Sec = normalizedSplit;
                        }

                        dogAverages[name].weightedSplitSum += (normalizedSplit * finalCompositeWeight);
                        dogAverages[name].weightedSplitWeightTotal += finalCompositeWeight;
                    }
                });
            }

            let wWinDiv = parseFloat(document.getElementById('w-windiv').value);
            let wBestTime = parseFloat(document.getElementById('w-besttime').value);
            let wAvgTime = parseFloat(document.getElementById('w-avgtime').value);
            let wBest1Sec = parseFloat(document.getElementById('w-best1sec').value);
            let wAvg1Sec = parseFloat(document.getElementById('w-avg1sec').value);
            let wEarlyPos = parseFloat(document.getElementById('w-earlypos').value);
            let wClosingGain = parseFloat(document.getElementById('w-closinggain').value);
            let wBoxBias = parseFloat(document.getElementById('w-boxbias').value);

            let activeStarters = activeRace.starters.filter(s => s.scratched !== true && !s.starterName.includes('VACANT'));
            
            let starterEarlyMap = {};
            activeStarters.forEach(starter => {
                let name = starter.starterName.toUpperCase();
                let boxNum = parseInt(starter.box) || 4;
                let earlyPaceVal = 4.0;
                if (dogAverages[name] && dogAverages[name].earlyCount > 0) {
                    earlyPaceVal = dogAverages[name].earlySum / dogAverages[name].earlyCount;
                }
                starterEarlyMap[boxNum] = { name: name, earlyPace: earlyPaceVal };
            });

            let scoredDogs = activeStarters.map(starter => {
                let name = starter.starterName.toUpperCase();
                let assignedBox = String(starter.box || "1").trim();
                let boxNum = parseInt(assignedBox) || 4;
                let winDiv = parseFloat(starter.winDiv);
                if (isNaN(winDiv) || winDiv === 0) winDiv = 50; 
                let placeDiv = parseFloat(starter.placeDiv);
                if (isNaN(placeDiv)) placeDiv = 0;
                
                let bestTimeVal = 30.0, avgTimeVal = 30.0, best1SecVal = 6.0, avg1SecVal = 6.0, avgEarly = 4.0, avgGain = 0.0;
                let displayBestTime = "N/A", displayBest1Sec = "N/A";
                let rawAvgTimeForCalc = null;
                let sex = starter.sex !== "Unknown" ? starter.sex : (dogAverages[name] ? dogAverages[name].sex : "Unknown");
                let formArray = [];
                let daysSinceLastRun = null;
                let boxBiasScoreBonus = 0;
                let boxRecordText = "No prior box stats";
                let trafficPenalty = 0;
                let trafficReason = "Clean run expected";
                let recencyAdjustment = 0;
                let recencyText = "Standard form recency";
                let variantDifferential = 0;

                if (dogAverages[name] && dogAverages[name].count > 0) {
                    let dStats = dogAverages[name];
                    formArray = dStats.formArray;
                    
                    if (dStats.lastRunDate) {
                        let today = new Date();
                        let diffTime = today - dStats.lastRunDate;
                        let diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                        if (diffDays >= 0) {
                            daysSinceLastRun = diffDays;
                        }
                    }

                    if (dStats.weightedTimeWeightTotal > 0) {
                        let recencyAvgTime = dStats.weightedTimeSum / dStats.weightedTimeWeightTotal;
                        avgTimeVal = recencyAvgTime;
                        rawAvgTimeForCalc = recencyAvgTime;
                        recencyText = "Chronological decay applied (~28-day half-life) with distance & outlier filtering";
                    } else if (dStats.distTimeCount > 0) {
                        avgTimeVal = dStats.distTimeSum / dStats.distTimeCount;
                        rawAvgTimeForCalc = avgTimeVal;
                    }

                    if (dStats.weightedSplitWeightTotal > 0) {
                        avg1SecVal = dStats.weightedSplitSum / dStats.weightedSplitWeightTotal;
                    } else if (dStats.distSplitCount > 0) {
                        avg1SecVal = dStats.distSplitSum / dStats.distSplitCount;
                    }

                    variantDifferential = avgTimeVal - trackMedianStandard;

                    if (daysSinceLastRun !== null && daysSinceLastRun > 60) {
                        recencyAdjustment = -1.2;
                        recencyText = `Extended layoff (${daysSinceLastRun} days): Fitness uncertainty penalty applied`;
                    }

                    if (dStats.boxStats[assignedBox]) {
                        let bInfo = dStats.boxStats[assignedBox];
                        boxRecordText = `${bInfo.wins} win(s) / ${bInfo.places} place(s) from ${bInfo.starts} start(s) in Box ${assignedBox}`;
                        let winStrikeRate = bInfo.starts > 0 ? (bInfo.wins / bInfo.starts) : 0;
                        let placeStrikeRate = bInfo.starts > 0 ? (bInfo.places / bInfo.starts) : 0;
                        boxBiasScoreBonus = (winStrikeRate * 5.0 + placeStrikeRate * 2.5) * (bInfo.starts >= 2 ? 1.3 : 0.8);
                    } else {
                        let bNum = parseInt(assignedBox) || 4;
                        if ((bNum === 1 || bNum === 2) && (targetTrack.includes("CANNINGTON") || targetTrack.includes("MANDURAH"))) {
                            boxBiasScoreBonus = 0.8;
                            boxRecordText = `No direct starts Box ${assignedBox} (Inside rail geometry bonus)`;
                        }
                    }

                    if (dStats.trackDistBestTime !== 999) {
                        bestTimeVal = dStats.trackDistBestTime;
                        displayBestTime = dStats.trackDistBestTime.toFixed(2);
                    } else if (dStats.normBestTime !== 999) {
                        bestTimeVal = dStats.normBestTime;
                        displayBestTime = dStats.normBestTime.toFixed(2) + " (Norm/Fluke-Filtered)";
                    } else if (dStats.bestTime !== 999) {
                        bestTimeVal = dStats.bestTime;
                        displayBestTime = dStats.bestTime.toFixed(2);
                    }

                    if (dStats.trackDistBest1Sec !== 999) {
                        best1SecVal = dStats.trackDistBest1Sec;
                        displayBest1Sec = dStats.trackDistBest1Sec.toFixed(2);
                    } else if (dStats.normBest1Sec !== 999) {
                        best1SecVal = dStats.normBest1Sec;
                        displayBest1Sec = dStats.normBest1Sec.toFixed(2) + " (Norm)";
                    } else if (dStats.best1Sec !== 999) {
                        best1SecVal = dStats.best1Sec;
                        displayBest1Sec = dStats.best1Sec.toFixed(2);
                    }

                    if (dStats.earlyCount > 0) {
                        avgEarly = dStats.earlySum / dStats.earlyCount;
                        avgGain = dStats.gainSum / dStats.gainCount;
                    }
                }

                let insideBoxNum = boxNum - 1;
                if (insideBoxNum >= 1 && starterEarlyMap[insideBoxNum]) {
                    let insideDog = starterEarlyMap[insideBoxNum];
                    let currentDogEarly = avgEarly;
                    if (currentDogEarly >= 4.0 && insideDog.earlyPace <= 3.5) {
                        trafficPenalty = 1.5;
                        trafficReason = `Traffic Risk: Slower early speed trapped outside fast early pacer (Box ${insideBoxNum})`;
                    }
                }
                if (boxNum >= 7 && avgGain >= 1.5) {
                    trafficPenalty = -0.8;
                    trafficReason = `Outside Draw Advantage: Strong closer in wide box ${boxNum}`;
                }

                let variantAdjustmentBonus = - (variantDifferential * 1.5);
                let closingGainVal = avgGain * wClosingGain;

                let score = (winDiv * wWinDiv) + 
                            (bestTimeVal * wBestTime) + 
                            (avgTimeVal * wAvgTime) + 
                            (best1SecVal * wBest1Sec) + 
                            (avg1SecVal * wAvg1Sec) + 
                            (avgEarly * wEarlyPos) - 
                            closingGainVal - 
                            (boxBiasScoreBonus * wBoxBias) + 
                            variantAdjustmentBonus +
                            trafficPenalty - 
                            recencyAdjustment;

                return {
                    name: starter.starterName,
                    box: assignedBox,
                    officialBox: starter.officialBox || assignedBox,
                    sex: sex,
                    formArray: formArray,
                    daysSinceLastRun: daysSinceLastRun,
                    winDiv: winDiv,
                    placeDiv: placeDiv,
                    bestTime: displayBestTime,
                    best1Sec: displayBest1Sec,
                    avgTrackDistTime: avgTimeVal !== 30.0 ? avgTimeVal.toFixed(2) : "N/A",
                    rawAvgTime: rawAvgTimeForCalc,
                    avgTrackDistSplit: avg1SecVal !== 6.0 ? avg1SecVal.toFixed(2) : "N/A",
                    avgEarly: avgEarly.toFixed(1),
                    avgGain: avgGain.toFixed(1),
                    boxRecordText: boxRecordText,
                    boxBiasBonus: boxBiasScoreBonus,
                    trafficPenalty: trafficPenalty,
                    trafficReason: trafficReason,
                    recencyText: recencyText,
                    score: score
                };
            });

            scoredDogs.sort((a, b) => a.score - b.score);

            let databaseBestScore = scoredDogs.length > 0 ? scoredDogs[0].score : 0;
            let databaseWorstScore = scoredDogs.length > 0 ? scoredDogs[scoredDogs.length - 1].score : 100;

            window.savedPredictions.forEach(savedItem => {
                if (savedItem.scoredDogs && Array.isArray(savedItem.scoredDogs)) {
                    savedItem.scoredDogs.forEach(d => {
                        if (d.score !== undefined && !isNaN(d.score)) {
                            if (d.score < databaseBestScore) databaseBestScore = d.score;
                            if (d.score > databaseWorstScore) databaseWorstScore = d.score;
                        }
                    });
                }
            });

            let dbScoreRange = databaseWorstScore - databaseBestScore;

            scoredDogs.forEach(dog => {
                if (dbScoreRange === 0) {
                    dog.ratingOutOf100 = 100;
                } else {
                    let normalized = 100 - ((dog.score - databaseBestScore) / dbScoreRange) * 50;
                    dog.ratingOutOf100 = Math.max(10, Math.min(100, Math.round(normalized)));
                }
            });
            if (scoredDogs.length > 0 && scoredDogs[0].score <= databaseBestScore) {
                scoredDogs[0].ratingOutOf100 = 100;
            }

            let softmaxExps = scoredDogs.map(dog => {
                let scaledDiff = (databaseBestScore - dog.score);
                return Math.exp(scaledDiff * 0.4);
            });
            let sumSoftmax = softmaxExps.reduce((a, b) => a + b, 0);

            let rawImpliedProbs = scoredDogs.map(dog => {
                let odds = dog.winDiv > 0 ? dog.winDiv : 50.0;
                return 1.0 / odds;
            });
            let sumMarketImplied = rawImpliedProbs.reduce((a, b) => a + b, 0);

            scoredDogs.forEach((dog, idx) => {
                let softmaxProb = sumSoftmax > 0 ? (softmaxExps[idx] / sumSoftmax) * 100 : (100 / scoredDogs.length);
                let marketImpliedProb = sumMarketImplied > 0 ? (rawImpliedProbs[idx] / sumMarketImplied) * 100 : softmaxProb;
                dog.winProb = (softmaxProb * 0.65) + (marketImpliedProb * 0.35);
            });

            let sumBlended = scoredDogs.reduce((acc, d) => acc + d.winProb, 0);
            if (sumBlended > 0) {
                scoredDogs.forEach(d => d.winProb = (d.winProb / sumBlended) * 100);
            }

            let confidenceText = "Medium";
            let confidenceBadgeClass = "bg-yellow-50 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-200 border border-yellow-200 dark:border-yellow-700";
            if (scoredDogs.length >= 2) {
                let scoreGap = scoredDogs[1].score - scoredDogs[0].score;
                if (scoreGap >= 2.5) {
                    confidenceText = "High";
                    confidenceBadgeClass = "bg-green-50 dark:bg-green-900/40 text-green-700 dark:text-green-200 border border-green-200 dark:border-green-700";
                } else if (scoreGap < 1.0) {
                    confidenceText = "Low";
                    confidenceBadgeClass = "bg-red-50 dark:bg-red-900/40 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-700";
                }
            }

            return { scoredDogs, confidenceText, confidenceBadgeClass, scratchedDogs: activeRace.starters.filter(s => s.scratched === true && !s.starterName.includes('VACANT')) };
        }

        async function refreshPredictions(showNotif = true) {
            if (!window.activeRaceKey || !window.allRaceMeetings[window.activeRaceKey] || !window.dogStats || window.dogStats.length === 0) {
                if (showNotif) {
                    showNotification("Please select an active race and import Dog Statistics CSV files or manual entries to analyze data.");
                }
                return;
            }

            let activeRace = window.allRaceMeetings[window.activeRaceKey];
            let computed = computeRacePredictionData(activeRace);
            let scoredDogs = computed.scoredDogs;

            if (scoredDogs.length > 0) {
                window.computedPredictionsCache[window.activeRaceKey] = true;
                await sortAndPersistMeetingsObject();
                updateAllUIComponents();

                let subtitleText = `${window.activeRaceKey}${activeRace.raceDistance && !window.activeRaceKey.includes(activeRace.raceDistance) ? ' (' + activeRace.raceDistance + ')' : ''}`;
                document.getElementById('predictions-race-subtitle').innerText = subtitleText;

                let topPick = scoredDogs[0];
                let defaultWinPayout = 0;
                let defaultPlacePayout = 0;
                if (activeRace.actualWinner && activeRace.actualWinner.toUpperCase() === topPick.name.toUpperCase()) {
                    defaultWinPayout = topPick.winDiv > 0 ? topPick.winDiv : 2.0;
                    defaultPlacePayout = topPick.placeDiv > 0 ? topPick.placeDiv : 1.2;
                } else {
                    let podium = [activeRace.actualPlace1, activeRace.actualPlace2, activeRace.actualPlace3].map(n => (n || "").toUpperCase());
                    let activeCompetitorsCount = scoredDogs.length;
                    let eligiblePlaceHit = false;
                    if (activeCompetitorsCount >= 8) {
                        eligiblePlaceHit = podium.slice(0, 3).includes(topPick.name.toUpperCase());
                    } else if (activeCompetitorsCount >= 5) {
                        eligiblePlaceHit = podium.slice(0, 2).includes(topPick.name.toUpperCase());
                    } else {
                        eligiblePlaceHit = podium.slice(0, 1).includes(topPick.name.toUpperCase());
                    }

                    if (eligiblePlaceHit) {
                        defaultWinPayout = 0;
                        defaultPlacePayout = topPick.placeDiv > 0 ? topPick.placeDiv : 1.2;
                    }
                }

                // Capture the exact weights used at the moment of prediction
                let appliedWeights = {
                    windiv: parseFloat(document.getElementById('w-windiv').value) || 0,
                    besttime: parseFloat(document.getElementById('w-besttime').value) || 0,
                    avgtime: parseFloat(document.getElementById('w-avgtime').value) || 0,
                    best1sec: parseFloat(document.getElementById('w-best1sec').value) || 0,
                    avg1sec: parseFloat(document.getElementById('w-avg1sec').value) || 0,
                    earlypos: parseFloat(document.getElementById('w-earlypos').value) || 0,
                    closinggain: parseFloat(document.getElementById('w-closinggain').value) || 0,
                    boxbias: parseFloat(document.getElementById('w-boxbias').value) || 0
                };

                window.currentComputedResult = {
                    trackName: window.activeRaceKey || "UNKNOWN",
                    raceNumber: activeRace.raceNumber || "1",
                    raceDistance: activeRace.raceDistance || "",
                    raceDate: activeRace.raceDate || "",
                    timestamp: new Date().toLocaleString(),
                    scoredDogs: scoredDogs,
                    scratchedDogs: computed.scratchedDogs,
                    actualWinner: activeRace.actualWinner || "",
                    actualPlace1: activeRace.actualPlace1 || "",
                    actualPlace2: activeRace.actualPlace2 || "",
                    actualPlace3: activeRace.actualPlace3 || "",
                    actualWinPayout: defaultWinPayout,
                    actualPlacePayout: defaultPlacePayout,
                    weights: appliedWeights
                };

                let confBadgeHTML = `<span class="text-[11px] px-2 py-0.5 rounded font-bold ${computed.confidenceBadgeClass}">${computed.confidenceText} Confidence</span>`;
                document.getElementById('confidence-indicator-container').innerHTML = confBadgeHTML;

                let meterHtml = '';
                scoredDogs.forEach((dog, idx) => {
                    let colorClass = idx === 0 ? 'text-green-600 dark:text-green-400 font-black' : (idx === 1 ? 'text-yellow-600 dark:text-yellow-400 font-bold' : 'text-slate-700 dark:text-slate-300 font-medium');
                    let barColor = idx === 0 ? 'bg-green-500' : (idx === 1 ? 'bg-yellow-400' : 'bg-slate-400 dark:bg-slate-600');
                    let sexIcon = dog.sex === 'Dog' ? '🐶' : (dog.sex === 'Bitch' ? '🐾' : '');
                    let probVal = dog.winProb.toFixed(1);

                    meterHtml += `
                        <div class="space-y-1">
                            <div class="flex justify-between items-center text-sm">
                                <span class="${colorClass}">${idx + 1}. ${dog.name} ${sexIcon} <span class="text-xs font-mono text-slate-400">(B${dog.officialBox})</span></span>
                                <span class="font-mono font-bold text-xs">${probVal}%</span>
                            </div>
                            <div class="w-full bg-slate-200 dark:bg-slate-700 h-2.5 rounded-full overflow-hidden">
                                <div class="${barColor} h-2.5 rounded-full transition-all duration-500" style="width: ${probVal}%"></div>
                            </div>
                        </div>
                    `;
                });
                document.getElementById('probability-win-meter-container').innerHTML = meterHtml;
                
                let topSexIcon = scoredDogs[0].sex === 'Dog' ? '🐶' : (scoredDogs[0].sex === 'Bitch' ? '🐾' : '');
                document.getElementById('winning-dog-name').innerText = `${scoredDogs[0].name} ${topSexIcon}`;
                document.getElementById('winning-dog-desc').innerText = `Based on Softmax probability calibration, outlier-filtered times, traffic mapping, and recency form decay, ${scoredDogs[0].name} leads the distribution at ${scoredDogs[0].winProb.toFixed(1)}%.`;
                
                let topPickAvgTime = scoredDogs[0].rawAvgTime;

                let analysisHtml = '';
                scoredDogs.forEach((dog, index) => {
                    let sexBadge = dog.sex === 'Dog' ? '<span class="text-blue-600 dark:text-blue-400 text-xs font-bold ml-1">🐶</span>' : (dog.sex === 'Bitch' ? '<span class="text-pink-600 dark:text-pink-400 text-xs font-bold ml-1">🐾</span>' : '');
                    let sparkline = generateSparkline(dog.formArray);
                    let daysSinceText = dog.daysSinceLastRun !== null ? `<span class="text-xs font-mono text-slate-500 dark:text-slate-400 mt-1 block">⏱️ Days Since Last Run: <strong class="text-slate-800 dark:text-slate-200">${dog.daysSinceLastRun} days</strong> (${dog.recencyText})</span>` : `<span class="text-xs font-mono text-slate-400 mt-1 block">⏱️ Days Since Last Run: N/A</span>`;
                    let ratingBadge = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-black font-mono bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-800 ml-2">⭐ Rating: ${dog.ratingOutOf100}</span>`;
                    let pirBadge = getRunningStyleBadge(parseFloat(dog.avgEarly), parseFloat(dog.avgGain));
                    let boxBiasBadge = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold font-mono bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">📦 Box ${dog.officialBox}: +${dog.boxBiasBonus.toFixed(1)}</span>`;
                    let trafficBadge = dog.trafficPenalty !== 0 ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold font-mono bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-800">🚦 Traffic Penalty: ${dog.trafficPenalty > 0 ? '+' : ''}${dog.trafficPenalty}</span>` : `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold font-mono bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">🚦 Clean Map</span>`;

                    let marginDisplay = "";
                    if (index === 0) {
                        marginDisplay = '<span class="text-green-600 dark:text-green-400 font-bold">Top Pick</span>';
                    } else if (topPickAvgTime !== null && dog.rawAvgTime !== null && !isNaN(topPickAvgTime) && !isNaN(dog.rawAvgTime)) {
                        let timeDiff = dog.rawAvgTime - topPickAvgTime;
                        let lengths = timeDiff / 0.07;
                        let sign = timeDiff >= 0 ? "+" : "";
                        marginDisplay = `Margin vs Top: <strong class="font-mono text-slate-800 dark:text-slate-200">${sign}${timeDiff.toFixed(2)}s (${sign}${lengths.toFixed(1)}L)</strong>`;
                    } else {
                        marginDisplay = `Margin vs Top: <span class="text-slate-400 font-mono">N/A</span>`;
                    }

                    let bgColor = "bg-white dark:bg-slate-900";
                    let borderColor = "border-slate-200 dark:border-slate-800";
                    let rankDisplay = `<strong class="text-lg text-slate-800 dark:text-white">${index + 1}. ${dog.name}</strong>`;
                    
                    if (index === 0) { 
                        bgColor = "bg-[#dcfce7] dark:bg-green-950/40"; borderColor = "border-[#86efac] dark:border-green-800";
                        rankDisplay = `<strong class="text-lg text-green-900 dark:text-green-200 font-black">${index + 1}. ${dog.name} <span class="text-xs uppercase bg-green-200 dark:bg-green-800 text-green-800 dark:text-green-200 px-1 py-0.5 ml-1 rounded">Top Pick</span></strong>`;
                    } else if (index === 1) { 
                        bgColor = "bg-[#fef08a] dark:bg-yellow-950/40"; borderColor = "border-[#fde047] dark:border-yellow-800";
                        rankDisplay = `<strong class="text-lg text-yellow-900 dark:text-yellow-200 font-black">${index + 1}. ${dog.name}</strong>`;
                    } else if (index === 2) { 
                        bgColor = "bg-[#ffedd5] dark:bg-orange-950/40"; borderColor = "border-[#fdba74] dark:border-orange-800";
                        rankDisplay = `<strong class="text-lg text-orange-900 dark:text-orange-200 font-black">${index + 1}. ${dog.name}</strong>`;
                    }

                    analysisHtml += `
                        <li class="${bgColor} p-4 border ${borderColor} rounded-lg shadow-sm flex flex-col md:flex-row md:justify-between mb-3 transition-colors">
                            <div class="mb-2 md:mb-0 flex flex-col justify-center">
                                <div class="flex items-center flex-wrap gap-1">
                                    ${rankDisplay} ${sexBadge} <span class="text-sm font-mono text-slate-500 dark:text-slate-400 font-bold ml-1">(Box ${dog.officialBox})</span> ${ratingBadge}
                                </div>
                                <div class="mt-2 flex flex-col gap-1">
                                    <div class="flex items-center gap-2">
                                        <span class="text-xs text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider">Form:</span>
                                        ${sparkline}
                                    </div>
                                    ${daysSinceText}
                                </div>
                            </div>
                            <div class="text-sm text-slate-700 dark:text-slate-300 md:text-right flex flex-col items-start md:items-end justify-center gap-1.5">
                                <div class="flex items-center gap-1.5 flex-wrap">${pirBadge} ${boxBiasBadge} ${trafficBadge}</div>
                                <span class="block">Win Div: <strong class="text-slate-900 dark:text-white font-mono text-base">$${dog.winDiv}</strong> | Place Div: <strong class="text-slate-900 dark:text-white font-mono text-base">$${dog.placeDiv}</strong> | Softmax Prob: <strong class="text-green-700 dark:text-green-400 font-mono">${dog.winProb.toFixed(1)}%</strong></span>
                                <span class="block text-slate-500 dark:text-slate-400 text-xs mt-1"><strong>Avg Time: <span class="font-mono text-slate-800 dark:text-slate-200">${dog.avgTrackDistTime}s</span></strong> | <strong>Avg 1Sec: <span class="font-mono text-slate-800 dark:text-slate-200">${dog.avgTrackDistSplit}s</span></strong> | ${marginDisplay}</span>
                                <span class="block text-slate-400 dark:text-slate-500 text-[11px]">Early Pos: ${dog.avgEarly} | Gain: <strong class="text-green-600 dark:text-green-400">+${dog.avgGain}</strong> | Best Time: <span class="font-mono">${dog.bestTime}s</span> | Best 1Sec: <span class="font-mono">${dog.best1Sec}s</span></span>
                            </div>
                        </li>
                    `;
                });
                
                if (window.currentComputedResult.scratchedDogs.length > 0) {
                    analysisHtml += `<h4 class="font-bold text-pink-700 uppercase tracking-wider text-xs mt-6 mb-2">Scratched Runners</h4>`;
                    window.currentComputedResult.scratchedDogs.forEach(dog => {
                        let sexBadge = dog.sex === 'Dog' ? '🐶' : (dog.sex === 'Bitch' ? '🐾' : '');
                        analysisHtml += `<li class="bg-pink-50 dark:bg-pink-950/40 p-3 border border-pink-200 dark:border-pink-800 rounded-lg shadow-sm text-pink-900 dark:text-pink-200 flex justify-between items-center mb-2">
                            <div><strong class="font-bold">${dog.starterName}</strong> ${sexBadge} <span class="text-xs text-pink-600 font-mono">(Box ${dog.officialBox || dog.box})</span></div>
                            <span class="bg-pink-200 dark:bg-pink-800 text-pink-800 dark:text-pink-200 border border-pink-300 dark:border-pink-700 text-xs px-2 py-1 rounded shadow-sm font-bold uppercase">Scratched</span>
                        </li>`;
                    });
                }

                document.getElementById('runner-analysis-list').innerHTML = analysisHtml;
                renderBatchSummaryDashboard();
                if (showNotif) {
                    showNotification("Predictions updated successfully!", "success");
                }
            } else {
                if (showNotif) {
                    showNotification("Not enough active runners found to calculate a prediction.");
                }
            }
        }

        async function saveCurrentPredictions() {
            if (!window.currentComputedResult) {
                showNotification("No active prediction result to save. Please run 'Refresh Predictions' first.");
                return;
            }

            let currentDate = String(window.currentComputedResult.raceDate || "").trim();

            let matchKey = Object.keys(window.allRaceMeetings).find(k => {
                let m = window.allRaceMeetings[k];
                let trackMatch = k.toUpperCase().includes(m.trackName.toUpperCase()) && window.currentComputedResult.trackName.toUpperCase().includes(m.trackName.toUpperCase());
                
                let savedRaceNum = String(window.currentComputedResult.raceNumber || "").trim();
                let meetingRaceNum = String(m.raceNumber || "").trim();
                let raceNumMatch = (savedRaceNum && savedRaceNum !== "N/A" && savedRaceNum === meetingRaceNum) ||
                                   new RegExp(`\\bRACE\\s*${meetingRaceNum}\\b`, 'i').test(window.currentComputedResult.trackName);

                let meetingDate = String(m.raceDate || "").trim();
                let dateMatch = (!currentDate || !meetingDate) ? true : currentDate === meetingDate;

                return trackMatch && raceNumMatch && dateMatch && m.actualWinner;
            });

            if (matchKey) {
                let meeting = window.allRaceMeetings[matchKey];
                window.currentComputedResult.actualWinner = meeting.actualWinner;
                window.currentComputedResult.actualPlace1 = meeting.actualPlace1;
                window.currentComputedResult.actualPlace2 = meeting.actualPlace2;
                window.currentComputedResult.actualPlace3 = meeting.actualPlace3;

                let scoredDogsList = window.currentComputedResult.scoredDogs || [];
                let topPick = scoredDogsList.length > 0 ? scoredDogsList[0] : null;
                let activeCompetitorsCount = scoredDogsList.length;

                if (topPick) {
                    let topPickName = topPick.name || "";
                    if (meeting.actualWinner && meeting.actualWinner.toUpperCase() === topPickName.toUpperCase()) {
                        window.currentComputedResult.actualWinPayout = topPick.winDiv > 0 ? topPick.winDiv : 2.0;
                        window.currentComputedResult.actualPlacePayout = topPick.placeDiv > 0 ? topPick.placeDiv : 1.2;
                    } else {
                        let podium = [meeting.actualPlace1, meeting.actualPlace2, meeting.actualPlace3].map(n => (n || "").toUpperCase());
                        let eligiblePlaceHit = false;
                        if (activeCompetitorsCount >= 8) {
                            eligiblePlaceHit = podium.slice(0, 3).includes(topPickName.toUpperCase());
                        } else if (activeCompetitorsCount >= 5) {
                            eligiblePlaceHit = podium.slice(0, 2).includes(topPickName.toUpperCase());
                        } else {
                            eligiblePlaceHit = podium.slice(0, 1).includes(topPickName.toUpperCase());
                        }

                        if (eligiblePlaceHit) {
                            window.currentComputedResult.actualWinPayout = 0;
                            window.currentComputedResult.actualPlacePayout = topPick.placeDiv > 0 ? topPick.placeDiv : 1.2;
                        } else {
                            window.currentComputedResult.actualWinPayout = 0;
                            window.currentComputedResult.actualPlacePayout = 0;
                        }
                    }
                }
            }

            let currentTrack = (window.currentComputedResult.trackName || "").toUpperCase();
            let currentRaceNum = String(window.currentComputedResult.raceNumber || "").trim();

            let existingIndex = window.savedPredictions.findIndex(item => {
                let itemTrack = (item.trackName || "").toUpperCase();
                let itemRaceNum = String(item.raceNumber || "").trim();
                let itemDate = String(item.raceDate || "").trim();

                let trackMatch = itemTrack.includes(currentTrack) || currentTrack.includes(itemTrack);
                let raceNumMatch = (itemRaceNum && currentRaceNum && itemRaceNum === currentRaceNum) ||
                                   new RegExp(`\\bRACE\\s*${currentRaceNum}\\b`, 'i').test(itemTrack) ||
                                   new RegExp(`\\bRACE\\s*${itemRaceNum}\\b`, 'i').test(currentTrack);
                
                let dateMatch = (!itemDate || !currentDate) ? true : itemDate === currentDate;

                return trackMatch && raceNumMatch && dateMatch;
            });

            if (existingIndex !== -1) {
                let existingItem = window.savedPredictions[existingIndex];
                if (existingItem.actualWinner && !window.currentComputedResult.actualWinner) {
                    window.currentComputedResult.actualWinner = existingItem.actualWinner;
                    window.currentComputedResult.actualPlace1 = existingItem.actualPlace1;
                    window.currentComputedResult.actualPlace2 = existingItem.actualPlace2;
                    window.currentComputedResult.actualPlace3 = existingItem.actualPlace3;
                    window.currentComputedResult.actualWinPayout = existingItem.actualWinPayout;
                    window.currentComputedResult.actualPlacePayout = existingItem.actualPlacePayout;
                }
                window.savedPredictions[existingIndex] = window.currentComputedResult;
            } else {
                window.savedPredictions.unshift(window.currentComputedResult);
            }

            await sortAndPersistMeetingsObject();
            populateSavedFilterDropdowns();
            renderSavedPredictions();
            updateAllUIComponents();
            showNotification("Predictions successfully saved!", "success");
        }

        async function updateActualWinner(index, winnerName) {
            if (window.savedPredictions[index]) {
                window.savedPredictions[index].actualWinner = winnerName;
                window.savedPredictions[index].actualPlace1 = winnerName;
                
                let scoredDogsList = window.savedPredictions[index].scoredDogs || [];
                let topPick = scoredDogsList.length > 0 ? scoredDogsList[0] : null;
                let activeCompetitorsCount = scoredDogsList.length;

                if (topPick && winnerName) {
                    let topPickName = topPick.name || "";
                    if (winnerName.toUpperCase() === topPickName.toUpperCase()) {
                        window.savedPredictions[index].actualWinPayout = topPick.winDiv > 0 ? topPick.winDiv : 2.0;
                        window.savedPredictions[index].actualPlacePayout = topPick.placeDiv > 0 ? topPick.placeDiv : 1.2;
                    } else {
                        let podium = [window.savedPredictions[index].actualPlace1, window.savedPredictions[index].actualPlace2, window.savedPredictions[index].actualPlace3].map(n => (n || "").toUpperCase());
                        let eligiblePlaceHit = false;
                        if (activeCompetitorsCount >= 8) {
                            eligiblePlaceHit = podium.slice(0, 3).includes(topPickName.toUpperCase());
                        } else if (activeCompetitorsCount >= 5) {
                            eligiblePlaceHit = podium.slice(0, 2).includes(topPickName.toUpperCase());
                        } else {
                            eligiblePlaceHit = podium.slice(0, 1).includes(topPickName.toUpperCase());
                        }

                        if (eligiblePlaceHit) {
                            window.savedPredictions[index].actualWinPayout = 0;
                            window.savedPredictions[index].actualPlacePayout = topPick.placeDiv > 0 ? topPick.placeDiv : 1.2;
                        } else {
                            window.savedPredictions[index].actualWinPayout = 0;
                            window.savedPredictions[index].actualPlacePayout = 0;
                        }
                    }
                } else {
                    window.savedPredictions[index].actualWinPayout = 0;
                    window.savedPredictions[index].actualPlacePayout = 0;
                }

                await sortAndPersistMeetingsObject();
                renderSavedPredictions();
                updateAllUIComponents();
            }
        }

        async function updateActualPlace2(index, dogName) {
            if (window.savedPredictions[index]) {
                window.savedPredictions[index].actualPlace2 = dogName;
                await sortAndPersistMeetingsObject();
                renderSavedPredictions();
            }
        }

        async function updateActualPlace3(index, dogName) {
            if (window.savedPredictions[index]) {
                window.savedPredictions[index].actualPlace3 = dogName;
                await sortAndPersistMeetingsObject();
                renderSavedPredictions();
            }
        }

        async function updateWinPayout(index, val) {
            if (window.savedPredictions[index]) {
                window.savedPredictions[index].actualWinPayout = parseFloat(val) || 0;
                await sortAndPersistMeetingsObject();
                renderSavedPredictions();
            }
        }

        async function updatePlacePayout(index, val) {
            if (window.savedPredictions[index]) {
                window.savedPredictions[index].actualPlacePayout = parseFloat(val) || 0;
                await sortAndPersistMeetingsObject();
                renderSavedPredictions();
            }
        }

        function extractTrackNameFromSaved(item) {
            let track = (item.trackName || "").toUpperCase();
            if (track.includes(" - ")) {
                return track.split(" - ")[0].trim();
            }
            let parts = track.split("RACE");
            if (parts.length > 1) {
                return parts[0].trim();
            }
            return track || "UNKNOWN";
        }

        function extractDateFromSaved(item) {
            if (item.raceDate && item.raceDate.trim() !== "") {
                return item.raceDate.trim();
            }
            let ts = item.timestamp || "";
            let match = ts.match(/\b\d{4}-\d{2}-\d{2}\b/) || ts.match(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/);
            if (match) return match[0];
            let parts = ts.split(',');
            if (parts.length > 0) return parts[0].trim();
            return "N/A";
        }

        function populateSavedFilterDropdowns() {
            let trackSelect = document.getElementById('filter-track-select');
            let dateSelect = document.getElementById('filter-date-select');
            if (!trackSelect || !dateSelect) return;

            let currentTrackVal = trackSelect.value;
            let currentDateVal = dateSelect.value;

            let tracks = new Set();
            let dates = new Set();

            window.savedPredictions.forEach(item => {
                let t = extractTrackNameFromSaved(item);
                let d = extractDateFromSaved(item);
                if (t) tracks.add(t);
                if (d && d !== "N/A") dates.add(d);
            });

            trackSelect.innerHTML = `<option value="">All Tracks</option>`;
            Array.from(tracks).sort().forEach(t => {
                let opt = document.createElement('option');
                opt.value = t;
                opt.innerText = t;
                if (t === currentTrackVal) opt.selected = true;
                trackSelect.appendChild(opt);
            });

            dateSelect.innerHTML = `<option value="">All Dates</option>`;
            Array.from(dates).sort().reverse().forEach(d => {
                let opt = document.createElement('option');
                opt.value = d;
                opt.innerText = d;
                if (d === currentDateVal) opt.selected = true;
                dateSelect.appendChild(opt);
            });
        }

        function resetSavedFilters() {
            let trackSelect = document.getElementById('filter-track-select');
            let dateSelect = document.getElementById('filter-date-select');
            let searchInput = document.getElementById('savedSearchInput');
            if (trackSelect) trackSelect.value = "";
            if (dateSelect) dateSelect.value = "";
            if (searchInput) searchInput.value = "";
            renderSavedPredictions();
        }

        function renderSavedPredictions() {
            const container = document.getElementById('saved-predictions-container');
            
            if (window.savedPredictions.length === 0) {
                container.innerHTML = `<p class="text-slate-400 italic">No saved predictions found.</p>`;
                updatePerformanceMetrics([]);
                return;
            }

            let searchFilter = document.getElementById('savedSearchInput') ? document.getElementById('savedSearchInput').value.toUpperCase().trim() : "";
            let selectedTrack = document.getElementById('filter-track-select') ? document.getElementById('filter-track-select').value.toUpperCase().trim() : "";
            let selectedDate = document.getElementById('filter-date-select') ? document.getElementById('filter-date-select').value.toUpperCase().trim() : "";

            let filteredList = window.savedPredictions.filter(item => {
                let trackName = extractTrackNameFromSaved(item);
                let itemDate = extractDateFromSaved(item);
                let displayTitle = `${item.trackName || ''} ${item.raceDistance || ''}`;

                if (selectedTrack && !trackName.includes(selectedTrack)) {
                    return false;
                }
                if (selectedDate && !itemDate.toUpperCase().includes(selectedDate)) {
                    return false;
                }

                if (searchFilter) {
                    let scoredDogsList = item.scoredDogs || [];
                    let topPickName = scoredDogsList.length > 0 ? (scoredDogsList[0].name || "") : "";
                    let isWinSettled = item.actualWinner && item.actualWinner.trim() !== "";
                    let isWinHit = isWinSettled && item.actualWinner.toUpperCase() === topPickName.toUpperCase();
                    let statusLabel = isWinSettled ? (isWinHit ? "WIN" : "LOSS") : "PENDING";
                    let searchTarget = `${displayTitle} ${item.timestamp || ''} ${statusLabel} ${topPickName} ${item.actualWinner || ''}`.toUpperCase();
                    if (searchTarget.indexOf(searchFilter) === -1) {
                        return false;
                    }
                }

                return true;
            });

            updatePerformanceMetrics(filteredList);

            if (filteredList.length === 0) {
                container.innerHTML = `<p class="text-slate-400 italic">No saved predictions match your selected filters.</p>`;
                return;
            }

            let html = '';
            filteredList.forEach((item) => {
                let actualIndex = window.savedPredictions.indexOf(item);
                let trackName = item.trackName || "UNKNOWN";
                let raceDistance = item.raceDistance || "";
                let scoredDogsList = item.scoredDogs || [];

                let distPart = raceDistance ? ` (${raceDistance})` : '';
                let displayTitle = `${trackName}${!trackName.includes(raceDistance) ? distPart : ''}`;
                
                let topPickName = scoredDogsList.length > 0 ? (scoredDogsList[0].name || "") : "";
                let isWinSettled = item.actualWinner && item.actualWinner.trim() !== "";
                let isWinHit = isWinSettled && item.actualWinner.toUpperCase() === topPickName.toUpperCase();
                
                let isPlaceSettled = isWinSettled;
                let podiumFinishingList = [item.actualPlace1, item.actualPlace2, item.actualPlace3].map(n => (n || "").toUpperCase());
                let activeCompetitorsCount = scoredDogsList.length;
                let isPlaceHit = false;

                if (isPlaceSettled && topPickName) {
                    if (activeCompetitorsCount >= 8) {
                        isPlaceHit = podiumFinishingList.slice(0, 3).includes(topPickName.toUpperCase());
                    } else if (activeCompetitorsCount >= 5) {
                        isPlaceHit = podiumFinishingList.slice(0, 2).includes(topPickName.toUpperCase());
                    } else {
                        isPlaceHit = podiumFinishingList.slice(0, 1).includes(topPickName.toUpperCase());
                    }
                }

                let lossBadgeHTML = (!isPlaceHit && !isWinHit && isWinSettled) ? '<span class="bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-200 border border-red-300 dark:border-red-700 text-xs px-2 py-0.5 rounded font-bold">Loss</span>' : '';

                html += `
                    <div class="bg-white dark:bg-slate-900 p-5 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm saved-item-card">
                        <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-3 border-b border-slate-100 dark:border-slate-800 pb-2 gap-2">
                            <div>
                                <button onclick="showSavedPredictionDetails(${actualIndex})" title="Click to view full historical analysis" class="font-black text-slate-900 dark:text-white text-lg tracking-tight hover:text-blue-600 dark:hover:text-blue-400 transition-colors text-left flex items-center gap-1.5 focus:outline-none">
                                    <span>${displayTitle}</span> 
                                    <svg class="w-5 h-5 text-slate-400 hover:text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
                                </button>
                                <span class="text-xs text-slate-400 font-mono mt-1 block">${item.timestamp || ''}</span>
                            </div>
                            <div class="flex items-center gap-2">
                                ${!isWinSettled ? '<span class="bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-200 border border-yellow-200 dark:border-yellow-700 text-xs px-2 py-0.5 rounded font-bold">Pending</span>' : ''}
                                ${isWinHit ? '<span class="bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-200 border border-green-300 dark:border-green-700 text-xs px-2 py-0.5 rounded font-bold">Win</span>' : ''}
                                ${isPlaceHit ? '<span class="bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200 border border-blue-300 dark:border-blue-700 text-xs px-2 py-0.5 rounded font-bold">Place</span>' : ''}
                                ${lossBadgeHTML}
                                <button onclick="deleteSavedPrediction(${actualIndex})" class="text-xs text-red-600 hover:text-red-800 font-bold px-2 py-1 rounded border border-red-200 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors">Delete</button>
                            </div>
                        </div>

                        <div class="bg-slate-50 dark:bg-slate-800 p-3 rounded-lg border border-slate-200 dark:border-slate-700 mb-3 grid grid-cols-1 sm:grid-cols-5 gap-3 text-xs">
                            <div>
                                <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">1st Place Winner:</label>
                                <select onchange="updateActualWinner(${actualIndex}, this.value)" class="w-full text-xs px-2 py-1 border border-slate-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-semibold focus:outline-none">
                                    <option value="">-- Select 1st --</option>
                                    ${scoredDogsList.map(d => `<option value="${d.name}" ${item.actualWinner === d.name ? 'selected' : ''}>${d.name}</option>`).join('')}
                                </select>
                            </div>
                            <div>
                                <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">2nd Place:</label>
                                <select onchange="updateActualPlace2(${actualIndex}, this.value)" class="w-full text-xs px-2 py-1 border border-slate-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-semibold focus:outline-none">
                                    <option value="">-- Select 2nd --</option>
                                    ${scoredDogsList.map(d => `<option value="${d.name}" ${item.actualPlace2 === d.name ? 'selected' : ''}>${d.name}</option>`).join('')}
                                </select>
                            </div>
                            <div>
                                <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">3rd Place:</label>
                                <select onchange="updateActualPlace3(${actualIndex}, this.value)" class="w-full text-xs px-2 py-1 border border-slate-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-semibold focus:outline-none">
                                    <option value="">-- Select 3rd --</option>
                                    ${scoredDogsList.map(d => `<option value="${d.name}" ${item.actualPlace3 === d.name ? 'selected' : ''}>${d.name}</option>`).join('')}
                                </select>
                            </div>
                            <div>
                                <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Win Payout ($):</label>
                                <input type="number" step="0.1" value="${item.actualWinPayout || 0}" onchange="updateWinPayout(${actualIndex}, this.value)" class="w-full text-xs px-2 py-1 border border-slate-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-mono font-bold focus:outline-none"/>
                            </div>
                            <div>
                                <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Place Payout ($):</label>
                                <input type="number" step="0.1" value="${item.actualPlacePayout || 0}" onchange="updatePlacePayout(${actualIndex}, this.value)" class="w-full text-xs px-2 py-1 border border-slate-300 dark:border-slate-700 rounded bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-mono font-bold focus:outline-none"/>
                            </div>
                        </div>

                        <div class="space-y-2">
                `;
                scoredDogsList.slice(0, 4).forEach((dog, idx) => {
                    let sexLabel = dog.sex === 'Dog' ? '🐶' : (dog.sex === 'Bitch' ? '🐾' : '');
                    let bg = "bg-slate-50 dark:bg-slate-800";
                    let textRank = "text-slate-700 dark:text-slate-200";
                    if(idx === 0) { bg = "bg-[#dcfce7] dark:bg-green-950/40"; textRank = "text-green-900 dark:text-green-200 font-black"; }
                    if(idx === 1) { bg = "bg-[#fef08a] dark:bg-yellow-950/40"; textRank = "text-yellow-900 dark:text-yellow-200 font-bold"; }
                    if(idx === 2) { bg = "bg-[#ffedd5] dark:bg-orange-950/40"; textRank = "text-orange-900 dark:text-orange-200 font-bold"; }
                    
                    let pDivDisplay = dog.placeDiv !== undefined && !isNaN(dog.placeDiv) ? dog.placeDiv : '0';
                    let ratingDisplay = dog.ratingOutOf100 !== undefined ? `<span class="bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-800 px-2 py-0.5 rounded text-xs font-black font-mono ml-2">⭐ Rating: ${dog.ratingOutOf100}</span>` : '';

                    html += `<div class="${bg} p-2.5 rounded text-sm text-slate-700 dark:text-slate-300 border border-slate-200/50 dark:border-slate-700 flex justify-between items-center">
                                <div class="flex items-center gap-1 flex-wrap"><span class="${textRank}">${idx + 1}. ${dog.name}</span> ${sexLabel} <span class="text-xs font-mono text-slate-500 dark:text-slate-400">(B${dog.officialBox || dog.box})</span> ${ratingDisplay}</div>
                                <div class="text-xs font-mono flex items-center gap-2">
                                    <span>Win:$${dog.winDiv} | Plc:$${pDivDisplay}</span> 
                                    <span class="text-slate-300 dark:text-slate-600">|</span> 
                                    ${generateSparkline(dog.formArray)}
                                </div>
                            </div>`;
                });
                html += `
                        </div>
                    </div>
                `;
            });

            container.innerHTML = html;
        }

        function updatePerformanceMetrics(savedList) {
            let totalSaved = savedList.length;
            let settled = savedList.filter(item => item.actualWinner && item.actualWinner.trim() !== "");
            let totalSettled = settled.length;

            let winHits = settled.filter(item => {
                let scoredDogsList = item.scoredDogs || [];
                let topPick = scoredDogsList.length > 0 ? (scoredDogsList[0].name || "") : "";
                return item.actualWinner.toUpperCase() === topPick.toUpperCase();
            }).length;
            let winStrikeRate = totalSettled > 0 ? (winHits / totalSettled) * 100 : 0;
            let winTurnover = totalSettled * 1.0;
            let winReturn = settled.reduce((acc, item) => {
                let scoredDogsList = item.scoredDogs || [];
                let topPick = scoredDogsList.length > 0 ? (scoredDogsList[0].name || "") : "";
                if (item.actualWinner.toUpperCase() === topPick.toUpperCase()) {
                    return acc + (parseFloat(item.actualWinPayout) || 1.0);
                }
                return acc;
            }, 0);
            let winRoi = winTurnover > 0 ? ((winReturn - winTurnover) / winTurnover) * 100 : 0;
            let winNetProfit = winReturn - winTurnover;

            let placeHits = settled.filter(item => {
                let scoredDogsList = item.scoredDogs || [];
                let topPick = scoredDogsList.length > 0 ? (scoredDogsList[0].name || "") : "";
                let podium = [item.actualPlace1, item.actualPlace2, item.actualPlace3].map(n => (n || "").toUpperCase());
                let activeCount = scoredDogsList.length;
                if (!topPick) return false;
                if (activeCount >= 8) {
                    return podium.slice(0, 3).includes(topPick.toUpperCase());
                } else if (activeCount >= 5) {
                    return podium.slice(0, 2).includes(topPick.toUpperCase());
                } else {
                    return podium.slice(0, 1).includes(topPick.toUpperCase());
                }
            }).length;
            let placeStrikeRate = totalSettled > 0 ? (placeHits / totalSettled) * 100 : 0;
            let placeTurnover = totalSettled * 1.0;
            let placeReturn = settled.reduce((acc, item) => {
                let scoredDogsList = item.scoredDogs || [];
                let topPick = scoredDogsList.length > 0 ? (scoredDogsList[0].name || "") : "";
                let podium = [item.actualPlace1, item.actualPlace2, item.actualPlace3].map(n => (n || "").toUpperCase());
                let activeCount = scoredDogsList.length;
                let isPlaceHit = false;
                if (topPick) {
                    if (activeCount >= 8) {
                        isPlaceHit = podium.slice(0, 3).includes(topPick.toUpperCase());
                    } else if (activeCount >= 5) {
                        isPlaceHit = podium.slice(0, 2).includes(topPick.toUpperCase());
                    } else {
                        isPlaceHit = podium.slice(0, 1).includes(topPick.toUpperCase());
                    }
                }
                if (isPlaceHit) {
                    return acc + (parseFloat(item.actualPlacePayout) || 1.0);
                }
                return acc;
            }, 0);
            let placeRoi = placeTurnover > 0 ? ((placeReturn - placeTurnover) / placeTurnover) * 100 : 0;
            let placeNetProfit = placeReturn - placeTurnover;

            let combinedTurnover = totalSettled * 2.0;
            let combinedReturn = winReturn + placeReturn;
            let combinedRoi = combinedTurnover > 0 ? ((combinedReturn - combinedTurnover) / combinedTurnover) * 100 : 0;
            let combinedNetProfit = combinedReturn - combinedTurnover;

            let combinedHits = settled.filter(item => {
                let scoredDogsList = item.scoredDogs || [];
                let topPick = scoredDogsList.length > 0 ? (scoredDogsList[0].name || "") : "";
                let isWinHit = topPick && item.actualWinner.toUpperCase() === topPick.toUpperCase();
                let podium = [item.actualPlace1, item.actualPlace2, item.actualPlace3].map(n => (n || "").toUpperCase());
                let activeCount = scoredDogsList.length;
                let isPlaceHit = false;
                if (topPick) {
                    if (activeCount >= 8) {
                        isPlaceHit = podium.slice(0, 3).includes(topPick.toUpperCase());
                    } else if (activeCount >= 5) {
                        isPlaceHit = podium.slice(0, 2).includes(topPick.toUpperCase());
                    } else {
                        isPlaceHit = podium.slice(0, 1).includes(topPick.toUpperCase());
                    }
                }
                return isWinHit || isPlaceHit;
            }).length;
            let combinedStrikeRate = totalSettled > 0 ? (combinedHits / totalSettled) * 100 : 0;

            document.getElementById('metric-total-races').innerText = `${totalSaved} / ${totalSettled}`;
            
            document.getElementById('metric-win-record').innerText = `${totalSettled} / ${winHits}`;
            document.getElementById('metric-win-strike').innerText = `${winStrikeRate.toFixed(1)}%`;
            let winProfitStr = `${winNetProfit >= 0 ? '+' : ''}$${winNetProfit.toFixed(2)}`;
            document.getElementById('metric-win-roi').innerText = `${winRoi >= 0 ? '+' : ''}${winRoi.toFixed(1)}% (${winProfitStr})`;
            document.getElementById('metric-win-roi').className = `text-sm font-black font-mono ${winNetProfit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`;
            
            document.getElementById('metric-place-record').innerText = `${totalSettled} / ${placeHits}`;
            document.getElementById('metric-place-strike').innerText = `${placeStrikeRate.toFixed(1)}%`;
            let placeProfitStr = `${placeNetProfit >= 0 ? '+' : ''}$${placeNetProfit.toFixed(2)}`;
            document.getElementById('metric-place-roi').innerText = `${placeRoi >= 0 ? '+' : ''}${placeRoi.toFixed(1)}% (${placeProfitStr})`;
            document.getElementById('metric-place-roi').className = `text-sm font-black font-mono ${placeNetProfit >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-red-600 dark:text-red-400'}`;

            document.getElementById('metric-combined-turnover').innerText = `$${combinedTurnover.toFixed(2)}`;
            document.getElementById('metric-combined-return').innerText = `$${combinedReturn.toFixed(2)}`;
            
            let combinedProfitStr = `${combinedNetProfit >= 0 ? '+' : ''}$${combinedNetProfit.toFixed(2)}`;
            document.getElementById('metric-combined-roi').innerText = `${combinedRoi >= 0 ? '+' : ''}${combinedRoi.toFixed(1)}% (${combinedProfitStr})`;
            document.getElementById('metric-combined-roi').className = `text-lg font-black font-mono ${combinedNetProfit >= 0 ? 'text-purple-600 dark:text-purple-400' : 'text-red-600 dark:text-red-400'}`;
            
            document.getElementById('metric-combined-strike').innerText = `${combinedStrikeRate.toFixed(1)}% (${combinedHits}/${totalSettled})`;
        }

        function filterSavedHistory() {
            renderSavedPredictions();
        }

        function exportSavedHistoryCSV() {
            if (window.savedPredictions.length === 0) {
                showNotification("No saved predictions to export.");
                return;
            }

            let csvContent = "data:text/csv;charset=utf-8,Track,Race,Distance,Date,Timestamp,Rank,Dog Name,Box,Sex,WinDiv,PlaceDiv,Rating,BestTime,Best 1Sec,Score,Form History,Actual Winner,Actual Place 2,Actual Place 3,Win Payout,Place Payout\n";
            
            window.savedPredictions.forEach(item => {
                let scoredDogsList = item.scoredDogs || [];
                scoredDogsList.forEach((dog, idx) => {
                    let formStr = dog.formArray ? dog.formArray.join(';') : '';
                    let row = [
                        `"${item.trackName || ''}"`,
                        `"${item.raceNumber || ''}"`,
                        `"${item.raceDistance || ''}"`,
                        `"${item.raceDate || ''}"`,
                        `"${item.timestamp || ''}"`,
                        idx + 1,
                        `"${dog.name || ''}"`,
                        dog.officialBox || dog.box || '',
                        `"${dog.sex || ''}"`,
                        dog.winDiv || 0,
                        dog.placeDiv || 0,
                        dog.ratingOutOf100 || 0,
                        `"${dog.bestTime || ''}"`,
                        `"${dog.best1Sec || ''}"`,
                        (dog.score !== undefined && !isNaN(dog.score)) ? dog.score.toFixed(2) : '0',
                        `"${formStr}"`,
                        `"${item.actualWinner || ''}"`,
                        `"${item.actualPlace2 || ''}"`,
                        `"${item.actualPlace3 || ''}"`,
                        item.actualWinPayout || 0,
                        item.actualPlacePayout || 0
                    ].join(",");
                    csvContent += row + "\n";
                });
            });

            let encodedUri = encodeURI(csvContent);
            let link = document.createElement("a");
            link.setAttribute("href", encodedUri);
            link.setAttribute("download", `gBet_Saved_Predictions_${new Date().toISOString().slice(0,10)}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            showNotification("CSV export successful!", "success");
        }

        async function importSavedHistoryCSV(event) {
            const file = event.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = async function(e) {
                const text = e.target.result;
                const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                if (lines.length < 2) {
                    showNotification("Invalid or empty CSV file.");
                    return;
                }

                let groups = {};
                for (let i = 1; i < lines.length; i++) {
                    let parts = [];
                    let inQuotes = false;
                    let currentVal = "";
                    for (let char of lines[i]) {
                        if (char === '"') {
                            inQuotes = !inQuotes;
                        } else if (char === ',' && !inQuotes) {
                            parts.push(currentVal.trim());
                            currentVal = "";
                        } else {
                            currentVal += char;
                        }
                    }
                    parts.push(currentVal.trim());
                    parts = parts.map(p => p.replace(/^"|"$/g, ''));

                    if (parts.length >= 14) {
                        let track = parts[0];
                        let raceNum = parts[1];
                        let dist = parts[2];
                        let date = parts[3];
                        let timestamp = parts[4];
                        let rank = parseInt(parts[5]);
                        let dogName = parts[6];
                        let box = parts[7];
                        let sex = parts[8];
                        let winDiv = parseFloat(parts[9]) || 0;
                        let placeDiv = parseFloat(parts[10]) || 0;
                        let rating = parseInt(parts[11]) || 50;
                        let bestTime = parts[12];
                        let best1Sec = parts[13];
                        let score = parseFloat(parts[14]) || 0;
                        let formStr = parts[15] || "";
                        let formArray = formStr ? formStr.split(';').map(n => parseInt(n)).filter(n => !isNaN(n)) : [];
                        let actualWinner = parts[16] || "";
                        let actualPlace2 = parts[17] || "";
                        let actualPlace3 = parts[18] || "";
                        let actualWinPayout = parseFloat(parts[19]) || 0;
                        let actualPlacePayout = parseFloat(parts[20]) || 0;

                        let groupKey = `${track}_${raceNum}_${timestamp}`;
                        if (!groups[groupKey]) {
                            groups[groupKey] = {
                                trackName: track,
                                raceNumber: raceNum,
                                raceDistance: dist,
                                raceDate: date,
                                timestamp: timestamp,
                                scoredDogs: [],
                                actualWinner: actualWinner,
                                actualPlace1: actualWinner,
                                actualPlace2: actualPlace2,
                                actualPlace3: actualPlace3,
                                actualWinPayout: actualWinPayout,
                                actualPlacePayout: actualPlacePayout
                            };
                        }

                        groups[groupKey].scoredDogs.push({
                            name: dogName,
                            officialBox: box,
                            box: box,
                            sex: sex,
                            winDiv: winDiv,
                            placeDiv: placeDiv,
                            ratingOutOf100: rating,
                            bestTime: bestTime,
                            best1Sec: best1Sec,
                            score: score,
                            formArray: formArray
                        });
                    }
                }

                let importedList = Object.values(groups);
                if (importedList.length > 0) {
                    window.savedPredictions = [...importedList, ...window.savedPredictions];
                    await sortAndPersistMeetingsObject();
                    populateSavedFilterDropdowns();
                    renderSavedPredictions();
                    updateAllUIComponents();
                    showNotification("CSV history imported successfully!", "success");
                }
                event.target.value = "";
            };
            reader.readAsText(file);
        }

        async function deleteSavedPrediction(index) {
            if (index >= 0 && index < window.savedPredictions.length) {
                if (confirm("Are you sure you want to delete this saved prediction?")) {
                    window.savedPredictions.splice(index, 1);
                    await sortAndPersistMeetingsObject();
                    populateSavedFilterDropdowns();
                    renderSavedPredictions();
                    updateAllUIComponents();
                    showNotification("Saved prediction removed.", "success");
                }
            }
        }

        async function clearSavedPredictions() {
            if (window.savedPredictions.length === 0) {
                showNotification("No saved history to clear.");
                return;
            }

            if (confirm("Are you sure you want to clear all saved prediction history?")) {
                window.savedPredictions = [];
                await sortAndPersistMeetingsObject();
                populateSavedFilterDropdowns();
                renderSavedPredictions();
                updateAllUIComponents();
                showNotification("Saved history cleared.", "success");
            }
        }
        
        // MODAL FUNCTIONS
        function showSavedPredictionDetails(index) {
            let item = window.savedPredictions[index];
            if (!item) return;

            let trackName = item.trackName || "UNKNOWN";
            let raceDistance = item.raceDistance || "";
            let distPart = raceDistance ? ` (${raceDistance})` : '';
            let displayTitle = `${trackName}${!trackName.includes(raceDistance) ? distPart : ''}`;

            document.getElementById('modal-race-title').innerText = displayTitle;
            document.getElementById('modal-race-meta-time').innerText = `Computed: ${item.timestamp || 'Unknown'}`;
            
            let actualWin = item.actualWinner && item.actualWinner.trim() !== "" ? item.actualWinner : "Pending / Unsettled";
            document.getElementById('modal-race-meta-winner').innerHTML = `Actual Winner: <strong class="${actualWin !== 'Pending / Unsettled' ? 'text-green-600 dark:text-green-400' : ''}">${actualWin}</strong>`;

            let analysisHtml = '';
            
            // --- NEW: Inject Model Weights Overlay & Preset Matcher ---
            if (item.weights) {
                let w = item.weights;
                let isSprint = true, isDistance = true;
                let keys = ['windiv', 'besttime', 'avgtime', 'best1sec', 'avg1sec', 'earlypos', 'closinggain', 'boxbias'];
                
                // Compare saved weights against current preset objects
                keys.forEach(k => {
                    if (window.customPresets.sprint[k] !== w[k]) isSprint = false;
                    if (window.customPresets.distance[k] !== w[k]) isDistance = false;
                });

                let badgeHtml = '';
                if (isSprint) {
                    badgeHtml = '<span class="bg-sky-100 text-sky-800 border border-sky-300 text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider shadow-sm">⚡ Sprint Preset</span>';
                } else if (isDistance) {
                    badgeHtml = '<span class="bg-purple-100 text-purple-800 border border-purple-300 text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider shadow-sm">🏆 Distance Preset</span>';
                } else {
                    badgeHtml = '<span class="bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-600 text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider shadow-sm">⚙️ Custom</span>';
                }

                analysisHtml += `
                    <li class="mb-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-4 rounded-lg shadow-sm block">
                        <div class="flex justify-between items-center mb-3">
                            <span class="text-sm font-black text-slate-800 dark:text-white tracking-tight">Model Weights Configuration</span>
                            ${badgeHtml}
                        </div>
                        <div class="grid grid-cols-4 sm:grid-cols-8 gap-2 text-[10px] font-mono text-center">
                            <div class="bg-slate-50 dark:bg-slate-800 p-1.5 rounded border border-slate-100 dark:border-slate-700"><span class="block text-slate-500 mb-0.5">WinDiv</span><strong class="text-slate-900 dark:text-slate-100">${w.windiv}</strong></div>
                            <div class="bg-slate-50 dark:bg-slate-800 p-1.5 rounded border border-slate-100 dark:border-slate-700"><span class="block text-slate-500 mb-0.5">BestTime</span><strong class="text-slate-900 dark:text-slate-100">${w.besttime}</strong></div>
                            <div class="bg-slate-50 dark:bg-slate-800 p-1.5 rounded border border-slate-100 dark:border-slate-700"><span class="block text-slate-500 mb-0.5">AvgTime</span><strong class="text-slate-900 dark:text-slate-100">${w.avgtime}</strong></div>
                            <div class="bg-slate-50 dark:bg-slate-800 p-1.5 rounded border border-slate-100 dark:border-slate-700"><span class="block text-slate-500 mb-0.5">Best1Sec</span><strong class="text-slate-900 dark:text-slate-100">${w.best1sec}</strong></div>
                            <div class="bg-slate-50 dark:bg-slate-800 p-1.5 rounded border border-slate-100 dark:border-slate-700"><span class="block text-slate-500 mb-0.5">Avg1Sec</span><strong class="text-slate-900 dark:text-slate-100">${w.avg1sec}</strong></div>
                            <div class="bg-slate-50 dark:bg-slate-800 p-1.5 rounded border border-slate-100 dark:border-slate-700"><span class="block text-slate-500 mb-0.5">EarlyPos</span><strong class="text-slate-900 dark:text-slate-100">${w.earlypos}</strong></div>
                            <div class="bg-slate-50 dark:bg-slate-800 p-1.5 rounded border border-slate-100 dark:border-slate-700"><span class="block text-slate-500 mb-0.5">CloseGain</span><strong class="text-slate-900 dark:text-slate-100">${w.closinggain}</strong></div>
                            <div class="bg-slate-50 dark:bg-slate-800 p-1.5 rounded border border-slate-100 dark:border-slate-700"><span class="block text-slate-500 mb-0.5">BoxBias</span><strong class="text-slate-900 dark:text-slate-100">${w.boxbias}</strong></div>
                        </div>
                    </li>
                `;
            }

            let scoredDogs = item.scoredDogs || [];
            let scratchedDogs = item.scratchedDogs || [];
            let topPickAvgTime = scoredDogs.length > 0 ? scoredDogs[0].rawAvgTime : null;

            scoredDogs.forEach((dog, idx) => {
                let sexBadge = dog.sex === 'Dog' ? '<span class="text-blue-600 dark:text-blue-400 text-xs font-bold ml-1">🐶</span>' : (dog.sex === 'Bitch' ? '<span class="text-pink-600 dark:text-pink-400 text-xs font-bold ml-1">🐾</span>' : '');
                let sparkline = generateSparkline(dog.formArray || []);
                let daysSinceText = dog.daysSinceLastRun !== null && dog.daysSinceLastRun !== undefined ? `<span class="text-xs font-mono text-slate-500 dark:text-slate-400 mt-1 block">⏱️ Days Since Last Run: <strong class="text-slate-800 dark:text-slate-200">${dog.daysSinceLastRun} days</strong> (${dog.recencyText || 'Standard form recency'})</span>` : `<span class="text-xs font-mono text-slate-400 mt-1 block">⏱️ Days Since Last Run: N/A (CSV Import/Missing)</span>`;
                
                let ratingBadge = dog.ratingOutOf100 !== undefined ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-black font-mono bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-800 ml-2">⭐ Rating: ${dog.ratingOutOf100}</span>` : '';
                
                let pirBadge = getRunningStyleBadge(parseFloat(dog.avgEarly), parseFloat(dog.avgGain));
                let boxBiasBonusVal = dog.boxBiasBonus || 0;
                let boxBiasBadge = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold font-mono bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800">📦 Box ${dog.officialBox || dog.box}: ${boxBiasBonusVal >= 0 ? '+' : ''}${boxBiasBonusVal.toFixed(1)}</span>`;
                
                let trafficPenaltyVal = dog.trafficPenalty || 0;
                let trafficBadge = trafficPenaltyVal !== 0 ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold font-mono bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-800">🚦 Traffic Penalty: ${trafficPenaltyVal > 0 ? '+' : ''}${trafficPenaltyVal}</span>` : `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold font-mono bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">🚦 Clean Map</span>`;

                let marginDisplay = "";
                if (idx === 0) {
                    marginDisplay = '<span class="text-green-600 dark:text-green-400 font-bold">Top Pick</span>';
                } else if (topPickAvgTime !== null && topPickAvgTime !== undefined && dog.rawAvgTime !== null && dog.rawAvgTime !== undefined && !isNaN(topPickAvgTime) && !isNaN(dog.rawAvgTime)) {
                    let timeDiff = dog.rawAvgTime - topPickAvgTime;
                    let lengths = timeDiff / 0.07;
                    let sign = timeDiff >= 0 ? "+" : "";
                    marginDisplay = `Margin vs Top: <strong class="font-mono text-slate-800 dark:text-slate-200">${sign}${timeDiff.toFixed(2)}s (${sign}${lengths.toFixed(1)}L)</strong>`;
                } else {
                    marginDisplay = `Margin vs Top: <span class="text-slate-400 font-mono">N/A</span>`;
                }

                let bgColor = "bg-white dark:bg-slate-900";
                let borderColor = "border-slate-200 dark:border-slate-800";
                let rankDisplay = `<strong class="text-lg text-slate-800 dark:text-white">${idx + 1}. ${dog.name}</strong>`;
                
                if (idx === 0) { 
                    bgColor = "bg-[#dcfce7] dark:bg-green-950/40"; borderColor = "border-[#86efac] dark:border-green-800";
                    rankDisplay = `<strong class="text-lg text-green-900 dark:text-green-200 font-black">${idx + 1}. ${dog.name} <span class="text-xs uppercase bg-green-200 dark:bg-green-800 text-green-800 dark:text-green-200 px-1 py-0.5 ml-1 rounded">Top Pick</span></strong>`;
                } else if (idx === 1) { 
                    bgColor = "bg-[#fef08a] dark:bg-yellow-950/40"; borderColor = "border-[#fde047] dark:border-yellow-800";
                    rankDisplay = `<strong class="text-lg text-yellow-900 dark:text-yellow-200 font-black">${idx + 1}. ${dog.name}</strong>`;
                } else if (idx === 2) { 
                    bgColor = "bg-[#ffedd5] dark:bg-orange-950/40"; borderColor = "border-[#fdba74] dark:border-orange-800";
                    rankDisplay = `<strong class="text-lg text-orange-900 dark:text-orange-200 font-black">${idx + 1}. ${dog.name}</strong>`;
                }
                
                let winProbVal = dog.winProb !== undefined && !isNaN(dog.winProb) ? dog.winProb.toFixed(1) + "%" : "N/A";
                
                analysisHtml += `
                    <li class="${bgColor} p-4 border ${borderColor} rounded-lg shadow-sm flex flex-col md:flex-row md:justify-between mb-3 transition-colors">
                        <div class="mb-2 md:mb-0 flex flex-col justify-center">
                            <div class="flex items-center flex-wrap gap-1">
                                ${rankDisplay} ${sexBadge} <span class="text-sm font-mono text-slate-500 dark:text-slate-400 font-bold ml-1">(Box ${dog.officialBox || dog.box})</span> ${ratingBadge}
                            </div>
                            <div class="mt-2 flex flex-col gap-1">
                                <div class="flex items-center gap-2">
                                    <span class="text-xs text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider">Form:</span>
                                    ${sparkline}
                                </div>
                                ${daysSinceText}
                            </div>
                        </div>
                        <div class="text-sm text-slate-700 dark:text-slate-300 md:text-right flex flex-col items-start md:items-end justify-center gap-1.5">
                            <div class="flex items-center gap-1.5 flex-wrap">${pirBadge} ${boxBiasBadge} ${trafficBadge}</div>
                            <span class="block">Win Div: <strong class="text-slate-900 dark:text-white font-mono text-base">$${dog.winDiv !== undefined ? dog.winDiv : '-'}</strong> | Place Div: <strong class="text-slate-900 dark:text-white font-mono text-base">$${dog.placeDiv !== undefined ? dog.placeDiv : '-'}</strong> | Prob: <strong class="text-green-700 dark:text-green-400 font-mono">${winProbVal}</strong></span>
                            <span class="block text-slate-500 dark:text-slate-400 text-xs mt-1"><strong>Avg Time: <span class="font-mono text-slate-800 dark:text-slate-200">${dog.avgTrackDistTime !== undefined ? dog.avgTrackDistTime : 'N/A'}s</span></strong> | <strong>Avg 1Sec: <span class="font-mono text-slate-800 dark:text-slate-200">${dog.avgTrackDistSplit !== undefined ? dog.avgTrackDistSplit : 'N/A'}s</span></strong> | ${marginDisplay}</span>
                            <span class="block text-slate-400 dark:text-slate-500 text-[11px]">Early Pos: ${dog.avgEarly !== undefined ? dog.avgEarly : '-'} | Gain: <strong class="text-green-600 dark:text-green-400">${dog.avgGain !== undefined ? (dog.avgGain >= 0 ? '+' : '') + dog.avgGain : '-'}</strong> | Best Time: <span class="font-mono">${dog.bestTime !== undefined ? dog.bestTime : '-'}s</span> | Best 1Sec: <span class="font-mono">${dog.best1Sec !== undefined ? dog.best1Sec : '-'}s</span></span>
                        </div>
                    </li>
                `;
            });
            
            if (scratchedDogs && scratchedDogs.length > 0) {
                analysisHtml += `<h4 class="font-bold text-pink-700 uppercase tracking-wider text-xs mt-6 mb-2">Scratched Runners</h4>`;
                scratchedDogs.forEach(dog => {
                    let sexBadge = dog.sex === 'Dog' ? '🐶' : (dog.sex === 'Bitch' ? '🐾' : '');
                    analysisHtml += `<li class="bg-pink-50 dark:bg-pink-950/40 p-3 border border-pink-200 dark:border-pink-800 rounded-lg shadow-sm text-pink-900 dark:text-pink-200 flex justify-between items-center mb-2">
                        <div><strong class="font-bold">${dog.starterName || dog.name}</strong> ${sexBadge} <span class="text-xs text-pink-600 font-mono">(Box ${dog.officialBox || dog.box})</span></div>
                        <span class="bg-pink-200 dark:bg-pink-800 text-pink-800 dark:text-pink-200 border border-pink-300 dark:border-pink-700 text-xs px-2 py-1 rounded shadow-sm font-bold uppercase">Scratched</span>
                    </li>`;
                });
            }

            document.getElementById('modal-runner-analysis-list').innerHTML = analysisHtml;
            
            let modal = document.getElementById('saved-details-modal');
            let modalContent = document.getElementById('saved-details-modal-content');
            modal.classList.remove('hidden');
            
            void modal.offsetWidth;
            modal.classList.remove('opacity-0');
            modalContent.classList.remove('scale-95');
        }

        function closeSavedPredictionDetails() {
            let modal = document.getElementById('saved-details-modal');
            let modalContent = document.getElementById('saved-details-modal-content');
            
            modal.classList.add('opacity-0');
            modalContent.classList.add('scale-95');
            
            setTimeout(() => {
                modal.classList.add('hidden');
            }, 300); 
        }