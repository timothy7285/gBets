// --- MASTER GLOBAL STATE INITIALIZATION ---
window.allRaceMeetings = window.allRaceMeetings || {};
window.activeRaceKey = window.activeRaceKey || "";
window.currentComputedResult = window.currentComputedResult || null;
window.computedPredictionsCache = window.computedPredictionsCache || {};
window.dogStats = window.dogStats || [];

// Master consolidated savedPredictions array initialization
window.savedPredictions = [];
try {
    let stored = localStorage.getItem('savedPredictions');
    if (stored) {
        let parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) window.savedPredictions = parsed;
    }
} catch (e) {
    window.savedPredictions = [];
}

window.userWallet = {
    balance: 0.00,
    staked: 0.00,
    profit: 0.00,
    transactions: [] // Added to store transaction logs
};
window.activeBets = [];
window.settledBets = [];

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
            s.title = "Connected & Cloud-Syncing (Firebase)";
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
    try {
        const savedTheme = localStorage.getItem('gbet_theme');
        if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
            document.getElementById('html-root').classList.add('dark');
            document.getElementById('theme-icon').innerText = '☀️';
        }

        let storedMeetings = null;
        let storedActiveKey = null;
        let storedStats = null;
        let storedCache = null;
        let storedSavedPredictions = null;
        let storedCustomPresets = null;
        let storedWallet = null;
        let storedActiveBets = null;
        let storedSettledBets = null;
        let storedHandle = null;

        let loadedFromFirebase = false;
        try {
            if (window.db && window.firebaseTools) {
                const { doc, getDoc } = window.firebaseTools;
                const docSnap = await getDoc(doc(window.db, "gbets", "masterState"));
                if (docSnap.exists()) {
                    const parsed = docSnap.data();
                    if (parsed.meetings) storedMeetings = parsed.meetings;
                    if (parsed.activeKey) storedActiveKey = parsed.activeKey;
                    if (parsed.stats) storedStats = parsed.stats;
                    if (parsed.cache) storedCache = parsed.cache;
                    if (parsed.savedPredictions) storedSavedPredictions = parsed.savedPredictions;
                    if (parsed.customPresets) storedCustomPresets = parsed.customPresets;
                    if (parsed.userWallet) storedWallet = parsed.userWallet;
                    if (parsed.activeBets) storedActiveBets = parsed.activeBets;
                    if (parsed.settledBets) storedSettledBets = parsed.settledBets;
                    loadedFromFirebase = true;
                    setLiveStatusSymbol('connected');
                }
            }
        } catch (fbErr) {
            console.warn("Firebase load failed:", fbErr);
        }

        if (!loadedFromFirebase && db) {
            try {
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
                storedWallet = await getVal('gbet_session_wallet');
                storedActiveBets = await getVal('gbet_session_active_bets');
                storedSettledBets = await getVal('gbet_session_settled_bets');
            } catch (err) {
                window.isIndexedDBAvailable = false;
            }
        }

        // Assign to global state safely
        if (storedMeetings) window.allRaceMeetings = storedMeetings;
        if (storedStats) window.dogStats = storedStats;
        if (storedCache) window.computedPredictionsCache = storedCache;
        if (storedSavedPredictions) window.savedPredictions = storedSavedPredictions;
        if (storedCustomPresets) window.customPresets = storedCustomPresets;
        if (storedWallet) window.userWallet = storedWallet;
        if (storedActiveBets) window.activeBets = storedActiveBets;
        if (storedSettledBets) window.settledBets = storedSettledBets;

    } catch (bootErr) {
        console.error("Boot storage read error (falling back to empty state):", bootErr);
    }

    // --- ALWAYS ENSURE UI RENDERS REGARDLESS OF STORAGE ERRORS ---
    try {
        populatePresetSettingsUI();
        renderBettingTab();
        populateSavedFilterDropdowns();
        renderSavedPredictions();
        
        let keys = getSortedRaceKeys();
        if (keys.length > 0) {
            if (!window.activeRaceKey || !window.allRaceMeetings[window.activeRaceKey]) {
                window.activeRaceKey = keys[0];
            }
            updateAllUIComponents();
            if (window.dogStats.length > 0) {
                renderStatsTable();
            }
        }
    } catch (uiErr) {
        console.error("UI post-boot render error:", uiErr);
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
    showNotification("Preset configurations successfully saved & synced!", "success");
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

    let storageModeText = window.liveFileHandle ? "Live File Syncing (Disk)" : "Firebase Cloud Firestore & IndexedDB";
    document.getElementById('diag-storage').innerText = storageModeText;

    let lastAudit = localStorage.getItem('gbet_last_audit_log') || "No backup exported yet";
    document.getElementById('diag-audit').innerText = lastAudit;
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
            if (parsed.userWallet) window.userWallet = parsed.userWallet;
            if (parsed.activeBets) window.activeBets = parsed.activeBets;
            if (parsed.settledBets) window.settledBets = parsed.settledBets;
            if (parsed.activeKey && window.allRaceMeetings[parsed.activeKey]) {
                window.activeRaceKey = parsed.activeKey;
            } else {
                let keys = getSortedRaceKeys();
                if (keys.length > 0) window.activeRaceKey = keys[0];
            }
            populatePresetSettingsUI();
            renderBettingTab();

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
        if (parsed.userWallet) window.userWallet = parsed.userWallet;
        if (parsed.activeBets) window.activeBets = parsed.activeBets;
        if (parsed.settledBets) window.settledBets = parsed.settledBets;
        if (parsed.activeKey && window.allRaceMeetings[parsed.activeKey]) {
            window.activeRaceKey = parsed.activeKey;
        } else {
            let keys = getSortedRaceKeys();
            if (keys.length > 0) window.activeRaceKey = keys[0];
        }
        populatePresetSettingsUI();
        renderBettingTab();

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
            userWallet: window.userWallet,
            activeBets: window.activeBets,
            settledBets: window.settledBets,
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
        userWallet: window.userWallet,
        activeBets: window.activeBets,
        settledBets: window.settledBets,
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
            if (data.userWallet) window.userWallet = data.userWallet;
            if (data.activeBets) window.activeBets = data.activeBets;
            if (data.settledBets) window.settledBets = data.settledBets;
            if (data.activeKey && window.allRaceMeetings[data.activeKey]) {
                window.activeRaceKey = data.activeKey;
            } else {
                let keys = getSortedRaceKeys();
                if (keys.length > 0) window.activeRaceKey = keys[0];
            }
            populatePresetSettingsUI();
            renderBettingTab();

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
            showNotification("Snapshot successfully restored into Cloud Firestore & IndexedDB!", "success");        
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

    // Ensure wallet and bet arrays always have valid defaults so they never wipe out to undefined
    window.userWallet = window.userWallet || { balance: 0.00, staked: 0.00, profit: 0.00, transactions: [] };
    window.activeBets = Array.isArray(window.activeBets) ? window.activeBets : [];
    window.settledBets = Array.isArray(window.settledBets) ? window.settledBets : [];

    const snapshotPayload = {
        meetings: window.allRaceMeetings,
        activeKey: window.activeRaceKey,
        stats: window.dogStats,
        cache: window.computedPredictionsCache,
        savedPredictions: window.savedPredictions,
        customPresets: window.customPresets,
        userWallet: window.userWallet,
        activeBets: window.activeBets,
        settledBets: window.settledBets,
        exportDate: new Date().toISOString()
    };

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

    try {
        if (db && window.isIndexedDBAvailable) {
            await db.transaction('rw', db.sessions, async () => {
                await db.sessions.put({ key: 'gbet_session_meetings', value: window.allRaceMeetings });
                await db.sessions.put({ key: 'gbet_session_active_key', value: window.activeRaceKey });
                await db.sessions.put({ key: 'gbet_session_stats', value: window.dogStats });
                await db.sessions.put({ key: 'gbet_computed_cache', value: window.computedPredictionsCache });
                await db.sessions.put({ key: 'gbet_session_saved_predictions', value: window.savedPredictions });
                await db.sessions.put({ key: 'gbet_session_custom_presets', value: window.customPresets });
                await db.sessions.put({ key: 'gbet_session_wallet', value: window.userWallet });
                await db.sessions.put({ key: 'gbet_session_active_bets', value: window.activeBets });
                await db.sessions.put({ key: 'gbet_session_settled_bets', value: window.settledBets });
            });
        }
    } catch (err) {
        console.warn("Storage persistence fallback error:", err);
    }

    await writeToLiveFileIfConnected();
}

function updateAllUIComponents() {
    updateRaceSelector();
    renderBatchSummaryDashboard();
    
    // Update TXT files imported label dynamically based on remaining meetings count
    let totalMeetingsCount = Object.keys(window.allRaceMeetings).length;
    let txtLabel = document.getElementById('txtFileLabel');
    if (txtLabel) {
        txtLabel.innerText = totalMeetingsCount > 0 ? `${totalMeetingsCount} file(s) loaded` : "Drag files or click";
    }
}

function openTab(evt, tabName) {
    // Hide all elements with class="tab-content"
    let tabcontent = document.getElementsByClassName("tab-content");
    for (let i = 0; i < tabcontent.length; i++) {
        tabcontent[i].style.display = "none";
    }

    // Remove the class "active" from all tab links/buttons
    let tablinks = document.getElementsByClassName("tablink");
    for (let i = 0; i < tablinks.length; i++) {
        tablinks[i].className = tablinks[i].className.replace(" active", "");
    }

    // Show the specific tab content, and add an "active" class to the button that opened the tab
    let targetTab = document.getElementById(tabName);
    if (targetTab) {
        targetTab.style.display = "block";
    }
    if (evt && evt.currentTarget) {
        evt.currentTarget.className += " active";
    }

    // --- ADD THIS BLOCK ---
    if (tabName === 'saved-predictions-tab' || tabName === 'saved-tab') {
        populateSavedFilterDropdowns();
        renderSavedPredictions();
    } else if (tabName === 'batch-summary-tab') {
        renderBatchSummaryDashboard();
    } else if (tabName === 'betting-tab') {
        renderBettingTab();
    }
    // ----------------------
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
    
    let parsedActualWinner = null;
    let parsedActualPlace1 = null;
    let parsedActualPlace2 = null;
    let parsedActualPlace3 = null;
    let parsedActualPlace4 = null;

    let startersColMap = {};

    let filenameDateMatch = filename.match(/(\d{2}[./-]\d{2}[./-]\d{4}|\d{8})/);
    let fallbackDate = filenameDateMatch ? filenameDateMatch[1].replace(/\D/g, "") : "";
    if (fallbackDate.length === 8) {
        fallbackDate = `${fallbackDate.slice(0,2)}.${fallbackDate.slice(2,4)}.${fallbackDate.slice(4,8)}`;
    }

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
                let headers = lines[i].split(',').map(h => h.replace(/[\r"]/g, '').trim().toLowerCase());
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
            const parts = currentLine.split(',').map(p => p.replace(/[\r"]/g, '').trim());
            if (parts.length >= 3) {
                raceDate = parts[0];
                trackName = parts[2];
            }
        }

        if (inContest && currentLine.length > 0) {
            const parts = currentLine.split(',').map(p => p.replace(/[\r"]/g, '').trim());
            raceNumber = parts[0];
            for (let p of parts) {
                let trimmed = p;
                if (/^\d+m$/i.test(trimmed) || (/^\d+$/.test(trimmed) && parseInt(trimmed) > 100 && parseInt(trimmed) < 2000)) {
                    raceDistance = trimmed.endsWith('m') ? trimmed : trimmed + 'm';
                    break;
                }
            }
        }

        if (inStarters && currentLine.length > 3 && !currentLine.startsWith('number')) {
            const parts = currentLine.split(',').map(p => p.replace(/[\r"]/g, '').trim());
            
            let getCol = (colName, fallbackIdx) => {
                let idx = startersColMap[colName] !== undefined ? startersColMap[colName] : fallbackIdx;
                return parts[idx] !== undefined ? parts[idx].replace(/[\r"]/g, '').trim() : "";
            };

            let rawDogName = getCol('startername', 3) || getCol('dog name', 3);
            if (!rawDogName || rawDogName === "" || rawDogName.startsWith('number')) continue;

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
            
            let placingStr = getCol('placing', 9);
            let placingVal = parseInt(placingStr) || 0;

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

            // Explicitly map placing numbers to podium positions
            if (placingVal === 1) {
                parsedActualWinner = cleanDogName;
                parsedActualPlace1 = cleanDogName;
            } else if (placingVal === 2) {
                parsedActualPlace2 = cleanDogName;
            } else if (placingVal === 3) {
                parsedActualPlace3 = cleanDogName;
            } else if (placingVal === 4) {
                parsedActualPlace4 = cleanDogName;
            }
        }
    }

    if (!raceDistance) {
        let text = lines.join('\n');
        const match = text.match(/\b(\d{3,4}m)\b/i);
        if (match) {
            raceDistance = match[1];
        }
    }

    if (!raceDate && fallbackDate) {
        raceDate = fallbackDate;
    }

    let cleanDateKey = raceDate ? raceDate.replace(/\D/g, "") : "NODATE";
    if (cleanDateKey.length === 8) {
        cleanDateKey = `${cleanDateKey.slice(0,2)}.${cleanDateKey.slice(2,4)}.${cleanDateKey.slice(4,8)}`;
    }

    let uniqueMeetingKey = trackName && raceNumber ? `${trackName.trim().toUpperCase()} - Race ${raceNumber} (${cleanDateKey})` : filename;
    let existingMeeting = window.allRaceMeetings[uniqueMeetingKey];

    let incomingHasResults = (parsedActualWinner && parsedActualWinner.trim() !== "") || starters.some(s => s.placing === 1);

    let finalWinner = parsedActualWinner;
    let finalPlace1 = parsedActualPlace1;
    let finalPlace2 = parsedActualPlace2;
    let finalPlace3 = parsedActualPlace3;
    let finalPlace4 = parsedActualPlace4;

    // If incoming file has NO results, preserve existing meeting data if it had results
    if (!incomingHasResults && existingMeeting && ((existingMeeting.actualWinner && existingMeeting.actualWinner.trim() !== "") || existingMeeting.starters.some(s => s.placing === 1))) {
        finalWinner = existingMeeting.actualWinner;
        finalPlace1 = existingMeeting.actualPlace1;
        finalPlace2 = existingMeeting.actualPlace2;
        finalPlace3 = existingMeeting.actualPlace3;
        finalPlace4 = existingMeeting.actualPlace4;
        
        starters.forEach(newStarter => {
            let oldStarter = existingMeeting.starters.find(s => s.starterName.toUpperCase() === newStarter.starterName.toUpperCase());
            if (oldStarter && oldStarter.placing > 0) {
                newStarter.placing = oldStarter.placing;
            }
        });
    }

    window.allRaceMeetings[uniqueMeetingKey] = {
        trackName: trackName || (existingMeeting ? existingMeeting.trackName : "UNKNOWN"),
        raceNumber: raceNumber || (existingMeeting ? existingMeeting.raceNumber : "1"),
        raceDistance: raceDistance || (existingMeeting ? existingMeeting.raceDistance : ""),
        raceDate: raceDate || fallbackDate || (existingMeeting ? existingMeeting.raceDate : ""),
        starters: starters,
        actualWinner: finalWinner,
        actualPlace1: finalPlace1,
        actualPlace2: finalPlace2,
        actualPlace3: finalPlace3,
        actualPlace4: finalPlace4
    };

    if (!window.activeRaceKey) {
        window.activeRaceKey = uniqueMeetingKey;
    }

    // Automatically check settlement for active/saved items whenever a meeting updates
    checkAutoFillPostRaceResults();
}

async function checkAutoFillPostRaceResults() {
    let updated = false;

    window.activeBets = Array.isArray(window.activeBets) ? window.activeBets : [];
    window.settledBets = Array.isArray(window.settledBets) ? window.settledBets : [];

    // --- 1. SAVED PREDICTIONS SYNC ---
    window.savedPredictions.forEach(savedItem => {
        let matchingMeeting = Object.values(window.allRaceMeetings).find(m => {
            if (!m.starters || !Array.isArray(m.starters)) return false;
            
            let hasValidPlacings = (m.actualWinner && m.actualWinner.trim() !== "") || m.starters.some(s => Number(s.placing) === 1);
            if (!hasValidPlacings) return false;

            let savedTrack = extractTrackNameFromSaved(savedItem).toUpperCase().trim();
            let meetingTrack = (m.trackName || "").toUpperCase().trim();
            let cleanSavedTrack = savedTrack.replace(/RACE\s*\d+/gi, "").trim();
            
            if (!cleanSavedTrack || !meetingTrack) return false;
            let trackMatch = cleanSavedTrack === meetingTrack || cleanSavedTrack.includes(meetingTrack) || meetingTrack.includes(cleanSavedTrack);
            if (!trackMatch) return false;

            let savedRaceNum = String(savedItem.raceNumber || "").trim();
            let meetingRaceNum = String(m.raceNumber || "").trim();
            if (!savedRaceNum || savedRaceNum === "N/A") {
                let match = (savedItem.trackName || "").match(/RACE\s*(\d+)/i);
                if (match) savedRaceNum = match[1];
            }
            let raceNumMatch = savedRaceNum && meetingRaceNum && savedRaceNum === meetingRaceNum;
            if (!raceNumMatch) return false;

            let savedDateClean = String(savedItem.raceDate || extractDateFromSaved(savedItem) || "").replace(/\D/g, "");
            if (!savedDateClean) {
                let match = (savedItem.trackName || "").match(/(\d{2}[./-]\d{2}[./-]\d{4}|\d{8})/);
                if (match) savedDateClean = match[1].replace(/\D/g, "");
            }
            let meetingDateClean = String(m.raceDate || "").replace(/\D/g, "");

            if (savedDateClean && meetingDateClean) {
                return savedDateClean === meetingDateClean;
            }

            return true;
        });

        if (matchingMeeting) {
            savedItem.actualWinner = matchingMeeting.actualWinner;
            savedItem.actualPlace1 = matchingMeeting.actualPlace1;
            savedItem.actualPlace2 = matchingMeeting.actualPlace2;
            savedItem.actualPlace3 = matchingMeeting.actualPlace3;
            savedItem.actualPlace4 = matchingMeeting.actualPlace4;
            
            let winningStarter = matchingMeeting.starters.find(s => s.starterName.toUpperCase() === matchingMeeting.actualWinner.toUpperCase() || s.placing === 1);
            let officialWinDiv = winningStarter && winningStarter.winDiv > 0 ? winningStarter.winDiv : 0;

            let scoredDogsList = savedItem.scoredDogs || [];
            let topPick = scoredDogsList.length > 0 ? scoredDogsList[0] : null;
            let activeCompetitorsCount = scoredDogsList.length;
            let payoutTier = savedItem.manualPayoutTier || (activeCompetitorsCount >= 8 ? "1,2,3" : (activeCompetitorsCount >= 5 ? "2" : "Pay Win Only"));
            
            if (topPick) {
                let topPickName = topPick.name || "";
                if (matchingMeeting.actualWinner.toUpperCase() === topPickName.toUpperCase()) {
                    savedItem.actualWinPayout = officialWinDiv > 0 ? officialWinDiv : (topPick.winDiv > 0 ? topPick.winDiv : 2.0);
                } else {
                    savedItem.actualWinPayout = 0;
                }

                let podium = [matchingMeeting.actualPlace1, matchingMeeting.actualPlace2, matchingMeeting.actualPlace3].map(n => (n || "").toUpperCase());
                let eligiblePlaceHit = false;
                if (payoutTier === "1,2,3") {
                    eligiblePlaceHit = podium.slice(0, 3).includes(topPickName.toUpperCase());
                } else if (payoutTier === "2") {
                    eligiblePlaceHit = podium.slice(0, 2).includes(topPickName.toUpperCase());
                }

                if (eligiblePlaceHit) {
                    let topPickStarter = matchingMeeting.starters.find(s => s.starterName.toUpperCase() === topPickName.toUpperCase());
                    let officialPlaceDiv = topPickStarter && topPickStarter.placeDiv > 0 ? topPickStarter.placeDiv : (topPick.placeDiv > 0 ? topPick.placeDiv : 1.2);
                    savedItem.actualPlacePayout = officialPlaceDiv;
                } else {
                    savedItem.actualPlacePayout = 0;
                }
            }
            updated = true;
        }
    });

    // --- 2. ACTIVE BETS SETTLEMENT (ROBUST SYNC & DATE MATCHING) ---
    let remainingActiveBets = [];

    window.activeBets.forEach(bet => {
        let matchingMeeting = Object.values(window.allRaceMeetings).find(m => {
            if (!m.starters || !Array.isArray(m.starters)) return false;

            let meetingTrack = (m.trackName || "").toUpperCase().trim();
            let betTrack = (bet.trackName || "").toUpperCase().trim();
            let cleanBetTrack = betTrack.replace(/RACE\s*\d+/gi, "").replace(/\(.*?\)/g, "").trim();
            let cleanMeetingTrack = meetingTrack.replace(/\(.*?\)/g, "").trim();
            
            if (!cleanBetTrack || !cleanMeetingTrack) return false;

            let trackMatch = cleanBetTrack === cleanMeetingTrack || cleanBetTrack.includes(cleanMeetingTrack) || cleanMeetingTrack.includes(cleanBetTrack);
            if (!trackMatch) return false;

            let meetingRaceNum = String(m.raceNumber || "").trim();
            let betRaceNum = String(bet.raceNum || "").trim();
            if (!betRaceNum || betRaceNum === "N/A") {
                let match = bet.trackName.match(/RACE\s*(\d+)/i);
                if (match) betRaceNum = match[1];
            }
            let raceNumMatch = meetingRaceNum && betRaceNum && meetingRaceNum === betRaceNum;
            if (!raceNumMatch) return false;

            // Robust Date Extraction from Bet and Meeting
            let betDateClean = String(bet.raceDate || "").replace(/\D/g, "");
            if (!betDateClean) {
                let match = bet.trackName.match(/(\d{2}[./-]\d{2}[./-]\d{4}|\d{8})/);
                if (match) betDateClean = match[1].replace(/\D/g, "");
            }
            
            let meetingDateClean = String(m.raceDate || "").replace(/\D/g, "");
            if (!meetingDateClean) {
                let match = (m.trackName || "").match(/(\d{2}[./-]\d{2}[./-]\d{4}|\d{8})/);
                if (match) meetingDateClean = match[1].replace(/\D/g, "");
            }

            // If both dates exist, they must match. If either is missing, allow the match based on track/race number.
            if (betDateClean && meetingDateClean) {
                return betDateClean === meetingDateClean;
            }

            return true;
        });

        // ABSOLUTE GUARD FOR MISSING RACE .TXT FILE:
        if (!matchingMeeting) {
            remainingActiveBets.push(bet);
            return; 
        }

        // Check if this specific meeting has valid official results
        let hasValidOfficialResults = matchingMeeting.starters && 
                                       matchingMeeting.starters.length > 0 &&
                                       ((matchingMeeting.actualWinner && matchingMeeting.actualWinner.trim() !== "") || 
                                        matchingMeeting.starters.some(s => Number(s.placing) === 1));

		if (hasValidOfficialResults) {
            let won = false;
            let payout = 0;

            let targetStarter = matchingMeeting.starters.find(s => s.starterName.toUpperCase() === bet.dogName.toUpperCase());
            let activeCompetitorsCount = matchingMeeting.starters.filter(s => !s.scratched && !s.starterName.includes('VACANT')).length;
            let payoutTier = activeCompetitorsCount >= 8 ? "1,2,3" : (activeCompetitorsCount >= 5 ? "2" : "Pay Win Only");
            let podium = [matchingMeeting.actualPlace1, matchingMeeting.actualPlace2, matchingMeeting.actualPlace3].map(n => (n || "").toUpperCase());

            // FIX: Lock in fixed odds if enabled, ignoring official race detail dividends completely
            let oddsToUse = bet.isFixedOdds && bet.odds ? bet.odds : 0;

            if (bet.betType === 'Win') {
                if (matchingMeeting.actualWinner && matchingMeeting.actualWinner.toUpperCase() === bet.dogName.toUpperCase()) {
                    won = true;
                    if (!bet.isFixedOdds || !bet.odds) {
                        oddsToUse = targetStarter && targetStarter.winDiv > 0 ? targetStarter.winDiv : (bet.odds || 1.0);
                    }
                    payout = bet.stake * oddsToUse;
                    bet.odds = oddsToUse; // Lock the settled odds
                }
            } else if (bet.betType === 'Place') {
                let eligiblePlaceHit = false;
                if (payoutTier === "1,2,3") {
                    eligiblePlaceHit = podium.slice(0, 3).includes(bet.dogName.toUpperCase());
                } else if (payoutTier === "2") {
                    eligiblePlaceHit = podium.slice(0, 2).includes(bet.dogName.toUpperCase());
                }

                if (eligiblePlaceHit) {
                    won = true;
                    if (!bet.isFixedOdds || !bet.odds) {
                        oddsToUse = targetStarter && targetStarter.placeDiv > 0 ? targetStarter.placeDiv : (bet.odds > 0 ? bet.odds : 1.2);
                    }
                    payout = bet.stake * oddsToUse;
                    bet.odds = oddsToUse; // Lock the settled odds
                }
            }

            bet.status = 'settled';
            bet.won = won;
            bet.payout = won ? payout : 0;
            
            if (won && payout > 0) {
                if (!window.userWallet.transactions) window.userWallet.transactions = [];
                window.userWallet.transactions.unshift({
                    id: Date.now() + Math.random(),
                    type: 'Payout',
                    description: `Bet Payout: ${bet.dogName} (${bet.betType})`,
                    amount: payout,
                    balanceAfter: window.userWallet.balance + payout,
                    timestamp: new Date().toLocaleString()
                });
            }

            window.settledBets.unshift(bet);
            window.userWallet.balance += bet.payout;
            updated = true;
        } else {
            remainingActiveBets.push(bet);
        }
    });

    window.activeBets = remainingActiveBets;

    if (updated) {
        await sortAndPersistMeetingsObject();
        populateSavedFilterDropdowns();
        renderSavedPredictions();
        renderBettingTab();
        updateAllUIComponents();
    }
}

async function syncResultsWithSavedHistory() {
    await checkAutoFillPostRaceResults();
    populateSavedFilterDropdowns();
    renderSavedPredictions();
    renderBettingTab();
    updateAllUIComponents();
    showNotification("Saved history and active bets synchronized successfully!", "success");
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

function isRaceSaved(raceObj, key) {
    return window.savedPredictions.some(item => {
        let trackMatch = (item.trackName || "").toUpperCase().includes(raceObj.trackName.toUpperCase()) || raceObj.trackName.toUpperCase().includes((item.trackName || "").toUpperCase());
        let raceNumMatch = String(item.raceNumber || "") === String(raceObj.raceNumber || "") || new RegExp(`\\bRACE\\s*${raceObj.raceNumber}\\b`, 'i').test(item.trackName || "");
        let dateMatch = (!item.raceDate || !raceObj.raceDate) ? true : item.raceDate === raceObj.raceDate;
        return trackMatch && raceNumMatch && dateMatch;
    });
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
            groupContainer.className = "flex flex-col mb-2";
            
            let headerWrapper = document.createElement('div');
            headerWrapper.className = "flex items-center w-full px-2.5 py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-colors bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 shadow-sm";
            
            let deleteGroupBtn = document.createElement('button');
            deleteGroupBtn.className = "text-slate-400 hover:text-red-500 dark:text-slate-500 dark:hover:text-red-400 mr-2 transition-colors flex-shrink-0 text-xs";
            deleteGroupBtn.title = `Delete all races for ${group.trackName} on ${group.raceDate}`;
            deleteGroupBtn.innerHTML = "🗑️";
            
            // --- USE ADDITION EVENT LISTENER INSTEAD OF ONCLICK ---
            deleteGroupBtn.dataset.trackName = group.trackName;
            deleteGroupBtn.dataset.raceDate = group.raceDate;
            deleteGroupBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                let tName = e.currentTarget.dataset.trackName;
                let rDate = e.currentTarget.dataset.raceDate;
                if (confirm(`Are you sure you want to delete all meetings for ${tName} (${rDate})?`)) {
                    group.keys.forEach(k => {
                        delete window.allRaceMeetings[k];
                        if (window.computedPredictionsCache[k]) delete window.computedPredictionsCache[k];
                    });
                    if (group.keys.includes(window.activeRaceKey)) {
                        let remainingKeys = getSortedRaceKeys();
                        window.activeRaceKey = remainingKeys.length > 0 ? remainingKeys[0] : "";
                    }
                    await sortAndPersistMeetingsObject();
                    updateAllUIComponents();
                    showNotification(`Successfully deleted all meetings for ${tName} (${rDate}).`, "success");
                }
            });

            let headerBtn = document.createElement('button');
            headerBtn.className = "flex-grow flex flex-col items-start text-left focus:outline-none pl-0.5 overflow-hidden";
            
            let chevronClass = isExpanded ? "rotate-180" : "";
            headerBtn.innerHTML = `
                <div class="flex justify-between items-center w-full pr-1">
                    <span class="font-black text-slate-900 dark:text-white truncate">${group.trackName}</span>
                    <svg id="${safeGroupId}-icon" class="w-3.5 h-3.5 text-slate-400 transition-transform duration-200 flex-shrink-0 ${chevronClass}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7"></path></svg>
                </div>
                <span class="text-[10px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">${group.raceDate} (${group.keys.length} races)</span>
            `;

            headerWrapper.appendChild(deleteGroupBtn);
            headerWrapper.appendChild(headerBtn);

            let contentDiv = document.createElement('div');
            contentDiv.id = safeGroupId;
            contentDiv.className = `pl-2 ml-2 border-l-2 border-slate-200 dark:border-slate-700 mt-2 gap-1.5 flex-col ${isExpanded ? 'flex' : 'hidden'}`;

            headerBtn.dataset.targetId = safeGroupId;
            headerBtn.addEventListener('click', (e) => {
                let targetId = e.currentTarget.dataset.targetId;
                let targetContentDiv = document.getElementById(targetId);
                let iconElem = document.getElementById(`${targetId}-icon`);
                let currentlyExpanded = window.expandedRibbonGroups.has(targetId);
                
                if (currentlyExpanded) {
                    window.expandedRibbonGroups.delete(targetId);
                    targetContentDiv.classList.remove('flex');
                    targetContentDiv.classList.add('hidden');
                    iconElem.classList.remove('rotate-180');
                } else {
                    window.expandedRibbonGroups.add(targetId);
                    targetContentDiv.classList.remove('hidden');
                    targetContentDiv.classList.add('flex');
                    iconElem.classList.add('rotate-180');
                }
            });

            groupContainer.appendChild(headerWrapper);

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
                    statusIndicator = '<span class="text-blue-600 dark:text-blue-400 font-bold" title="Settled">🎯</span>';
                } else if (statusType === 'computed') {
                    statusIndicator = '<span class="text-green-500 dark:text-green-400 font-bold" title="Computed">🟢</span>';
                }

                let savedBadgeIcon = isRaceSaved(raceObj, k) ? '<span class="text-purple-600 dark:text-purple-400 font-bold ml-1" title="Saved to Predictions History">💾</span>' : '';
                
                let pillWrapper = document.createElement('div');
                pillWrapper.className = `w-full rounded text-xs font-bold transition-colors flex items-center justify-between border ${
                    isCurrent 
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 border-slate-900 dark:border-white shadow-sm' 
                    : 'bg-slate-50 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700'
                } px-2.5 py-2`;

                let deleteRaceBtn = document.createElement('button');
                deleteRaceBtn.className = `flex-shrink-0 p-0.5 mr-2 rounded transition-colors text-xs ${isCurrent ? 'text-slate-300 hover:text-white dark:text-slate-600 dark:hover:text-slate-900' : 'text-slate-400 hover:text-red-500 dark:text-slate-500 dark:hover:text-red-400'}`;
                deleteRaceBtn.title = `Delete ${k}`;
                deleteRaceBtn.innerHTML = "🗑️";
                
                deleteRaceBtn.dataset.raceKey = k;
                deleteRaceBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    let targetKey = e.currentTarget.dataset.raceKey;
                    if (confirm(`Are you sure you want to delete ${targetKey}?`)) {
                        delete window.allRaceMeetings[targetKey];
                        if (window.computedPredictionsCache[targetKey]) delete window.computedPredictionsCache[targetKey];
                        if (window.activeRaceKey === targetKey) {
                            let remainingKeys = getSortedRaceKeys();
                            window.activeRaceKey = remainingKeys.length > 0 ? remainingKeys[0] : "";
                        }
                        await sortAndPersistMeetingsObject();
                        updateAllUIComponents();
                        showNotification(`Successfully deleted ${targetKey}.`, "success");
                    }
                });

                let pillBtn = document.createElement('button');
                pillBtn.className = "flex-grow text-left flex items-center justify-between pr-1 focus:outline-none";
                pillBtn.innerHTML = `
                    <div class="flex items-center gap-1.5 truncate">
                        <span class="font-black">Race ${raceObj.raceNumber || '?'}</span>
                        ${raceObj.raceDistance ? `<span class="text-[10px] font-mono px-1 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">${raceObj.raceDistance}</span>` : ''}
                    </div>
                    <span class="flex-shrink-0 flex items-center gap-0.5">${savedBadgeIcon}${statusIndicator}</span>
                `;
                pillBtn.title = k;
                
                pillBtn.dataset.raceKey = k;
                pillBtn.addEventListener('click', (e) => {
                    let targetKey = e.currentTarget.dataset.raceKey;
                    switchActiveRace(targetKey);
                });

                pillWrapper.appendChild(deleteRaceBtn);
                pillWrapper.appendChild(pillBtn);
                contentDiv.appendChild(pillWrapper);
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
        
        let txtLabel = document.getElementById('txtFileLabel');
        if (txtLabel) txtLabel.innerText = "Drag files or click";

        document.getElementById('race-title').innerText = "Race Details (Pending Import)";
        document.getElementById('starters-tbody').innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-400 font-medium">No race data loaded. Please import TXT meeting files.</td></tr>`;
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
        else if (s.placing === 4) placingBadge = '<span class="bg-indigo-100 text-indigo-800 font-bold px-2 py-0.5 rounded">4th</span>';
        else if (s.placing > 4) placingBadge = `<span class="text-slate-500">${s.placing}th</span>`;

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

function populateBatchFilterDropdowns() {
    let trackSelect = document.getElementById('filter-batch-track-select');
    let dateSelect = document.getElementById('filter-batch-date-select');
    if (!trackSelect || !dateSelect) return;

    let currentTrackVal = trackSelect.value.toUpperCase().trim();
    let currentDateVal = dateSelect.value.toUpperCase().trim();

    let tracks = new Set();
    let dates = new Set();

    Object.keys(window.allRaceMeetings).forEach(k => {
        let race = window.allRaceMeetings[k];
        let t = (race.trackName || "UNKNOWN").toUpperCase();
        if (t) tracks.add(t);
    });

    trackSelect.innerHTML = `<option value="">All Tracks</option>`;
    Array.from(tracks).sort().forEach(t => {
        let opt = document.createElement('option');
        opt.value = t;
        opt.innerText = t;
        if (t === currentTrackVal) opt.selected = true;
        trackSelect.appendChild(opt);
    });

    Object.keys(window.allRaceMeetings).forEach(k => {
        let race = window.allRaceMeetings[k];
        let t = (race.trackName || "UNKNOWN").toUpperCase();
        let d = race.raceDate || "No Date";
        
        if (!currentTrackVal || t === currentTrackVal) {
            if (d && d !== "No Date") dates.add(d);
        }
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

function resetBatchFilters() {
    let trackSelect = document.getElementById('filter-batch-track-select');
    let dateSelect = document.getElementById('filter-batch-date-select');
    if (trackSelect) trackSelect.value = "";
    if (dateSelect) dateSelect.value = "";
    renderBatchSummaryDashboard();
}

function renderBatchSummaryDashboard() {
    populateBatchFilterDropdowns();
    
    const gridContainer = document.getElementById('batch-cards-grid');
    let sortedKeys = getSortedRaceKeys();

    if (sortedKeys.length === 0) {
        gridContainer.innerHTML = `<div class="col-span-full p-8 text-center text-slate-400 italic">No race meetings imported yet. Please upload TXT meeting files.</div>`;
        return;
    }

    let selectedTrack = document.getElementById('filter-batch-track-select') ? document.getElementById('filter-batch-track-select').value.toUpperCase().trim() : "";
    let selectedDate = document.getElementById('filter-batch-date-select') ? document.getElementById('filter-batch-date-select').value.toUpperCase().trim() : "";

    let filteredKeys = sortedKeys.filter(key => {
        let race = window.allRaceMeetings[key];
        let trackName = (race.trackName || "").toUpperCase();
        let raceDate = (race.raceDate || "").toUpperCase();

        if (selectedTrack && !trackName.includes(selectedTrack)) {
            return false;
        }
        if (selectedDate && !raceDate.includes(selectedDate)) {
            return false;
        }
        return true;
    });

    if (filteredKeys.length === 0) {
        gridContainer.innerHTML = `<div class="col-span-full p-8 text-center text-slate-400 italic">No race meetings match your selected filters.</div>`;
        return;
    }

    gridContainer.innerHTML = '';
    filteredKeys.forEach(key => {
        let race = window.allRaceMeetings[key];
        let topPick = "Pending Stats";
        let confidence = "-";
        let confBadgeClass = "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300";

        // --- NEW: Calculate total runners for this specific race ---
		let runnerCount = 0;
        if (race.dogs && Array.isArray(race.dogs) && race.dogs.length > 0) {
            runnerCount = race.dogs.length;
        } else if (race.runners && Array.isArray(race.runners) && race.runners.length > 0) {
            runnerCount = race.runners.length;
        } else if (race.dogList && Array.isArray(race.dogList) && race.dogList.length > 0) {
            runnerCount = race.dogList.length;
        } else if (window.dogStats && window.dogStats.length > 0) {
            let computed = computeRacePredictionData(race);
            if (computed && computed.scoredDogs && computed.scoredDogs.length > 0) {
                runnerCount = computed.scoredDogs.length;
            }
        }

        if (window.dogStats && window.dogStats.length > 0) {
            let computed = computeRacePredictionData(race);
            if (computed && computed.scoredDogs.length > 0) {
                topPick = computed.scoredDogs[0].name;
                confidence = computed.confidenceText;
                confBadgeClass = computed.confidenceBadgeClass;
            }
        }

        let cleanDate = race.raceDate || "No Date";
        if (/^\d{8}$/.test(cleanDate)) {
            cleanDate = `${cleanDate.slice(0,2)}/${cleanDate.slice(2,4)}/${cleanDate.slice(4,8)}`;
        }

        const card = document.createElement('div');
        card.className = "bg-slate-50 dark:bg-slate-800 p-4 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm hover:border-slate-400 cursor-pointer transition-colors flex flex-col justify-between";
        card.onclick = function() {
            switchActiveRace(key);
            document.querySelectorAll("button.tab-btn")[3].click();
        };
        card.innerHTML = `
            <div>
                <div class="flex flex-col mb-2 pb-2 border-b border-slate-200 dark:border-slate-700">
                    <div class="flex justify-between items-center">
                        <span class="text-xs font-black uppercase text-slate-900 dark:text-white tracking-wide">${race.trackName || 'UNKNOWN'}</span>
                        <div class="flex items-center gap-1.5">
                            <!-- NEW: Runner count badge -->
                            <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 font-bold">${runnerCount} Runners</span>
                            <span class="text-[10px] font-mono px-2 py-0.5 rounded font-bold bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">Race ${race.raceNumber || '?'}</span>
                        </div>
                    </div>
                    <div class="flex justify-between items-center mt-1">
                        <span class="text-[11px] text-slate-500 dark:text-slate-400 font-mono">📅 ${cleanDate}</span>
                        <span class="text-[10px] font-mono text-slate-500 dark:text-slate-400">${race.raceDistance ? '📏 ' + race.raceDistance : ''}</span>
                    </div>
                </div>
                <div class="text-sm font-black text-slate-900 dark:text-white mb-3">🥇 ${topPick}</div>
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
    }
}

function clearDogStatsData() {
    if (!window.dogStats || window.dogStats.length === 0) {
        showNotification("No dog statistics loaded to clear.");
        return;
    }
    renderCsvManagerModalList();
    
    let modal = document.getElementById('csv-manager-modal');
    let modalContent = document.getElementById('csv-manager-modal-content');
    modal.classList.remove('hidden');
    void modal.offsetWidth;
    modal.classList.remove('opacity-0');
    modalContent.classList.remove('scale-95');
}

function closeCsvManagerModal() {
    let modal = document.getElementById('csv-manager-modal');
    let modalContent = document.getElementById('csv-manager-modal-content');
    modal.classList.add('opacity-0');
    modalContent.classList.add('scale-95');
    setTimeout(() => {
        modal.classList.add('hidden');
    }, 300);
}

function renderCsvManagerModalList() {
    const container = document.getElementById('csv-manager-file-list');
    if (!window.dogStats || window.dogStats.length === 0) {
        container.innerHTML = `<p class="text-slate-400 italic text-center py-4">No CSV stats files loaded.</p>`;
        return;
    }

    let fileGroups = {};
    window.dogStats.forEach((stat) => {
        let fileName = stat.sourceFile || "Unassigned_Stats.csv";
        let groupKey = fileName;

        if (!fileGroups[groupKey]) {
            fileGroups[groupKey] = {
                groupKey: groupKey,
                displayName: fileName,
                count: 0
            };
        }
        fileGroups[groupKey].count++;
    });

    let html = '';
    Object.keys(fileGroups).sort().forEach(groupKey => {
        let group = fileGroups[groupKey];

        html += `
            <div class="bg-slate-50 dark:bg-slate-800/80 p-3 rounded-lg border border-slate-200 dark:border-slate-700 flex justify-between items-center">
                <div>
                    <span class="font-black text-sm text-slate-900 dark:text-white font-mono tracking-wide block">${group.displayName}</span>
                    <span class="text-xs font-mono text-slate-500 dark:text-slate-400"><strong class="text-slate-700 dark:text-slate-300">${group.count}</strong> linked dog record(s)</span>
                </div>
                <button onclick="deleteCsvBatchGroup('${encodeURIComponent(group.groupKey)}')" class="bg-red-600 hover:bg-red-700 text-white text-xs font-bold py-1.5 px-3 rounded shadow transition-colors">
                    Delete File & All Linked Stats
                </button>
            </div>
        `;
    });

    container.innerHTML = html;
}

async function deleteCsvBatchGroup(encodedGroupKey) {
    let targetFileName = decodeURIComponent(encodedGroupKey);
    if (confirm(`Are you sure you want to delete "${targetFileName}" and all its linked dog statistics records?`)) {
        window.dogStats = window.dogStats.filter(stat => {
            let fileName = stat.sourceFile || `${stat.track || 'UNKNOWN'}_${stat.date || 'NODATE'}.csv`;
            return fileName !== targetFileName;
        });

        await sortAndPersistMeetingsObject();
        renderStatsTable();
        renderActiveRace();
        renderBatchSummaryDashboard();
        
        if (window.activeRaceKey) {
            refreshPredictions(false);
        }

        renderCsvManagerModalList();
        showNotification(`Successfully deleted "${targetFileName}" and all linked stats.`, "success");

        if (window.dogStats.length === 0) {
            closeCsvManagerModal();
        }
    }
}

async function confirmDeleteAllCsvFiles() {
    if (confirm("Are you sure you want to clear ALL accumulated dog statistics history?")) {
        window.dogStats = [];
        await sortAndPersistMeetingsObject();

        document.getElementById('csvFileLabel').innerText = "Drag files or click";
        renderStatsTable();
        renderActiveRace();
        renderBatchSummaryDashboard();
        
        if (window.activeRaceKey) {
            refreshPredictions(false);
        }

        closeCsvManagerModal();
        showNotification("All dog statistics history cleared.", "success");
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
            existingRecords.add(`${d.name}_${d.date}_${d.track}_${d.sourceFile || ''}`);
        });
    }

    for (let file of files) {
        let originalFileName = file.name;
        let inferredDogName = file.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ").toUpperCase();
        
        const reader = new FileReader();
        reader.onload = async function(e) {
            let result = parseHeaderCsvContent(e.target.result, inferredDogName, existingRecords, originalFileName);
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

function parseHeaderCsvContent(csvText, fallbackDogName, existingRecordsSet, originalFileName = "Manual_Import.csv") {
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
            let recordKey = `${currentDogName}_${raceDate}_${trackUpper}_${originalFileName}`;

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
                    time: time,
                    sourceFile: originalFileName
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
        <td class="p-1.5"><input type="text" id="edit-name-${index}" value="${d.name}" class="w-full text-xs px-1.5 py-1 border rounded bg-white dark:bg-slate-900 font-bold"/></td>
        <td class="p-1.5"><input type="text" id="edit-date-${index}" value="${d.date || ''}" placeholder="YYYY-MM-DD" class="w-20 text-xs px-1 py-1 border rounded bg-white dark:bg-slate-900 font-mono"/></td>
        <td class="p-1.5">
            <select id="edit-sex-${index}" class="text-xs px-1 py-1 border rounded bg-white dark:bg-slate-900">
                <option value="" ${!d.sex || d.sex === 'Unknown' ? 'selected' : ''}>--</option>
                <option value="Dog" ${d.sex === 'Dog' ? 'selected' : ''}>Dog</option>
                <option value="Bitch" ${d.sex === 'Bitch' ? 'selected' : ''}>Bitch</option>
            </select>
        </td>
        <td class="p-1.5"><input type="text" id="edit-plc-${index}" value="${d.plc}" class="w-10 text-xs px-1 py-1 border rounded bg-white dark:bg-slate-900 font-mono text-center"/></td>
        <td class="p-1.5"><input type="text" id="edit-box-${index}" value="${d.box}" class="w-10 text-xs px-1 py-1 border rounded bg-white dark:bg-slate-900 font-mono text-center"/></td>
        <td class="p-1.5"><input type="text" id="edit-dist-${index}" value="${d.dist}" class="w-12 text-xs px-1 py-1 border rounded bg-white dark:bg-slate-900 font-mono text-center"/></td>
        <td class="p-1.5"><input type="text" id="edit-track-${index}" value="${d.track}" class="w-14 text-xs px-1 py-1 border rounded bg-white dark:bg-slate-900"/></td>
        <td class="p-1.5"><input type="text" id="edit-pir-${index}" value="${d.pir || ''}" class="w-14 text-xs px-1 py-1 border rounded bg-white dark:bg-slate-900 font-mono text-center"/></td>
        <td class="p-1.5"><input type="text" id="edit-split1-${index}" value="${d.split1 || ''}" class="w-12 text-xs px-1 py-1 border rounded bg-white dark:bg-slate-900 font-mono text-center"/></td>
        <td class="p-1.5"><input type="text" id="edit-time-${index}" value="${d.time}" class="w-14 text-xs px-1 py-1 border rounded bg-white dark:bg-slate-900 font-mono text-center"/></td>
        <td class="p-1.5 text-right whitespace-nowrap">
            <div class="flex items-center justify-end gap-1">
                <button onclick="saveStatRow(${index})" class="bg-green-600 hover:bg-green-700 text-white text-[11px] font-bold py-1 px-1.5 rounded shadow transition-colors">Save</button>
                <button onclick="renderStatsTable()" class="bg-slate-400 hover:bg-slate-500 text-white text-[11px] font-bold py-1 px-1.5 rounded shadow transition-colors">Cancel</button>
            </div>
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

// --- 1. STANDALONE RECENCY WEIGHTING HELPER ---
function calculateWeightedRecencyAverage(valuesArray) {
    if (!valuesArray || valuesArray.length === 0) return 0;
    
    // Define weights based on recency index (index 0 is most recent start)
    const weights = [0.30, 0.20, 0.18, 0.12, 0.20]; 
    
    let weightedSum = 0;
    let totalWeight = 0;

    for (let i = 0; i < valuesArray.length; i++) {
        let val = parseFloat(valuesArray[i]);
        if (isNaN(val)) continue;
        
        let w = i < weights.length ? weights[i] : (0.20 / Math.max(1, valuesArray.length - 4));
        
        weightedSum += val * w;
        totalWeight += w;
    }

    if (totalWeight === 0) {
        let validVals = valuesArray.filter(v => !isNaN(parseFloat(v)));
        if (validVals.length === 0) return 0;
        return validVals.reduce((a, b) => a + parseFloat(b), 0) / validVals.length;
    }

    return weightedSum / totalWeight;
}

// --- 2. YOUR PREDICTION FUNCTION ---
function computeRacePredictionData(activeRace) {
    let targetDist = activeRace.raceDistance ? activeRace.raceDistance.replace('m', '').trim() : "";
    let targetDistNum = parseFloat(targetDist) || 0;
    let targetTrack = activeRace.trackName ? activeRace.trackName.toUpperCase().trim() : "";

    // Track Speed Benchmarks (Base par times for common distances)
    const trackBenchmarks = {
        "MOUNT GAMBIER": { 305: 17.50, 400: 23.20, 512: 30.10, 600: 35.50 },
        "ANGLE PARK": { 342: 19.60, 515: 30.00, 531: 31.20, 595: 34.80 },
        "CANNINGTON": { 275: 16.10, 380: 22.00, 520: 30.00, 600: 34.80, 715: 42.00 },
        "MANDURAH": { 302: 17.20, 400: 22.50, 490: 27.60, 550: 31.00 }
    };

    let trackKey = targetTrack;
    let defaultPar = targetDistNum > 0 ? (targetDistNum * 0.058) + 1.0 : 30.0;
    let trackBenchmark = defaultPar;

    for (let knownTrack in trackBenchmarks) {
        if (trackKey.includes(knownTrack)) {
            if (trackBenchmarks[knownTrack][targetDistNum]) {
                trackBenchmark = trackBenchmarks[knownTrack][targetDistNum];
            }
            break;
        }
    }

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

			let parsedDate = parseRacingDate(stat.date);
            let todayCheck = new Date(); // or meetingDate
            
            if (parsedDate && !isNaN(parsedDate)) {
                // Ensure the past run date is not in the future!
                if (parsedDate <= todayCheck) {
                    if (!dogAverages[name].lastRunDate || parsedDate > dogAverages[name].lastRunDate) {
                        dogAverages[name].lastRunDate = parsedDate;
                    }
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

				if (!isNaN(split1) && statDistNum > 0) {
                // Normalize split time relative to the target distance if distances differ, 
                // or keep it exact if distances match.
                let normalizedSplit = statDistNum === targetDistNum 
                    ? split1 
                    : (split1 / statDistNum) * targetDistNum; // Proportional distance scaling for splits

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
            
            // If lastRunDate exists, compute days since last run here
				if (dStats.lastRunDate) {
                // 1. Get meeting date or fall back to current date, stripped of hours/minutes
                let meetingDate = activeRace.meetingDate ? parseRacingDate(activeRace.meetingDate) : new Date();
                if (!meetingDate || isNaN(meetingDate)) {
                    meetingDate = new Date();
                }
                
                // Normalize both dates to midnight (00:00:00) to prevent time-of-day offsets
                let targetDay = new Date(meetingDate.getFullYear(), meetingDate.getMonth(), meetingDate.getDate());
                let lastRunDay = new Date(dStats.lastRunDate.getFullYear(), dStats.lastRunDate.getMonth(), dStats.lastRunDate.getDate());

                let diffTime = targetDay - lastRunDay;
                let diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
                
                if (diffDays >= 0) {
                    daysSinceLastRun = diffDays;
                } else {
                    console.warn(`[Turnaround Notice] Future date detected for ${name} (${dStats.lastRunDate}). Setting turnaround to 0 days.`);
                    daysSinceLastRun = 0; 
                }
            } else {
                console.log(`[Missing Date Notice] No valid lastRunDate found for dog: ${name}`);
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

            let meetingMedian = trackMedianStandard;
            let trackSpeedVariant = trackBenchmark - meetingMedian;
            let normalizedAvgTime = avgTimeVal + trackSpeedVariant;
            variantDifferential = normalizedAvgTime - trackBenchmark;

			// --- HIERARCHICAL 1SEC SPLIT CALCULATION ---
            let exactDistSplits = [];
            let closeDistSplits = []; // Splits from similar distances (within 50m)

            if (rawDogRecords[name]) {
                rawDogRecords[name].forEach(stat => {
                    let sSplit = parseFloat(stat.split1);
                    if (isNaN(sSplit) || sSplit < 3.5 || sSplit > 14.0) return; // Expanded safety bounds

                    let sDist = parseFloat(stat.dist) || 0;
                    let sTrack = (stat.track || "").toUpperCase().trim();
                    let isSameTrack = targetTrack && (sTrack.includes(targetTrack) || targetTrack.includes(sTrack));
                    let isExactDist = sDist === targetDistNum;
                    let isCloseDist = Math.abs(sDist - targetDistNum) <= 50; // Within 50m

                    if (isSameTrack && isExactDist) {
                        exactDistSplits.push(sSplit);
                    } else if (isSameTrack && isCloseDist) {
                        // Normalize close distance splits before pushing
                        let scaledSplit = (sSplit / sDist) * targetDistNum;
                        closeDistSplits.push(scaledSplit);
                    }
                });
            }

            if (exactDistSplits.length > 0) {
                avg1SecVal = exactDistSplits.reduce((a, b) => a + b, 0) / exactDistSplits.length;
                displayBest1Sec = Math.min(...exactDistSplits).toFixed(2);
            } else if (closeDistSplits.length > 0) {
                avg1SecVal = closeDistSplits.reduce((a, b) => a + b, 0) / closeDistSplits.length;
                displayBest1Sec = Math.min(...closeDistSplits).toFixed(2);
            } else if (dStats.weightedSplitWeightTotal > 0) {
                avg1SecVal = dStats.weightedSplitSum / dStats.weightedSplitWeightTotal;
                displayBest1Sec = dStats.normBest1Sec !== 999 ? dStats.normBest1Sec.toFixed(2) : "N/A";
            } else {
                avg1SecVal = 6.5;
                displayBest1Sec = "N/A";
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

            if (dStats.earlyCount > 0) {
                avgEarly = dStats.earlySum / dStats.earlyCount;
                avgGain = dStats.gainSum / dStats.gainCount;
            }
        }

		// --- LATE SCRATCHING & VACANT BOX INSIDE BONUS ---
        let insideBoxNum = boxNum - 1;
        let isInsideVacant = false;

        // Check if the inside box contains a scratched dog or is marked vacant in activeRace
        if (insideBoxNum >= 1) {
            let insideStarter = activeRace.starters.find(s => parseInt(s.box) === insideBoxNum);
            if (insideStarter && (insideStarter.scratched === true || insideStarter.starterName.includes('VACANT'))) {
                isInsideVacant = true;
                trafficPenalty -= 1.0; // Reward bonus for clearing the inside traffic risk
                trafficReason = `Clear Air Advantage: Inside Box ${insideBoxNum} is vacant/scratched`;
            }
        }

        // Existing traffic map check for fast early pacers
        if (!isInsideVacant && insideBoxNum >= 1 && starterEarlyMap[insideBoxNum]) {
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

        let earlySpeedRatingBonus = 0;
        if (avg1SecVal <= 5.30 && avgEarly <= 2.5) {
            earlySpeedRatingBonus = -1.8; 
        } else if ((avg1SecVal > 0 && avg1SecVal <= 5.25) || (avgEarly > 0 && avgEarly <= 2.2)) {
            earlySpeedRatingBonus = -0.9;
        }

        let score = (winDiv * wWinDiv) + 
                    (bestTimeVal * wBestTime) + 
                    (avgTimeVal * wAvgTime) + 
                    (best1SecVal * wBest1Sec) + 
                    (avg1SecVal * wAvg1Sec) + 
                    (avgEarly * wEarlyPos) + 
                    closingGainVal - 
                    (boxBiasScoreBonus * wBoxBias) + 
                    variantAdjustmentBonus +
                    earlySpeedRatingBonus +
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
            score: score,
            expectedValuePercent: 0 
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
        scoredDogs.forEach(d => {
            d.winProb = (d.winProb / sumBlended) * 100;
            
            let winDivNum = parseFloat(d.winDiv) || 0;
            if (winDivNum > 0) {
                let modelProbDecimal = d.winProb / 100.0;
                d.expectedValuePercent = (modelProbDecimal * winDivNum - 1.0) * 100;
            } else {
                d.expectedValuePercent = -100;
            }
        });        
    }
    
// Ensure consistent target distance checking across properties
    let resolvedTargetDist = parseFloat(
        (typeof activeRace !== 'undefined' && (activeRace.raceDistance || activeRace.distance || activeRace.dist)) || 520
    );

    scoredDogs.forEach(dog => {
        let totalWeightedSplit = 0;
        let validRunsCount = 0;

        // Query the global dogStats repository directly for this dog's history
        let dogRecords = window.dogStats ? window.dogStats.filter(s => s.name && s.name.toUpperCase() === dog.name.toUpperCase()) : [];

        if (dogRecords && dogRecords.length > 0) {
            dogRecords.forEach(run => {
                let s1 = run.split1 || run.split1Sec || run.firstSection || run.sec1;
                let dist = run.dist || run.distance || run.raceDist;

                if (s1 && s1 !== "-" && dist) {
                    // Use the robust distance-tier normalizer with the correctly resolved target distance
                    const normalizedSplit = normalizeEarlySplit(parseFloat(s1), parseFloat(dist), resolvedTargetDist);
                    
                    if (!isNaN(normalizedSplit)) {
                        totalWeightedSplit += normalizedSplit;
                        validRunsCount++;
                    }
                }
            });
        }

        // If records were found, use the normalized average; otherwise fallback to existing avg1SecVal or "0.00"
        if (validRunsCount > 0) {
            dog.avgTrackDistSplit = (totalWeightedSplit / validRunsCount).toFixed(2);
        } else if (!dog.avgTrackDistSplit || dog.avgTrackDistSplit === "N/A") {
            dog.avgTrackDistSplit = "0.00";
        }
    });

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

    return { 
        scoredDogs, 
        confidenceText, 
        confidenceBadgeClass, 
        scratchedDogs: activeRace.starters.filter(s => s.scratched === true && !s.starterName.includes('VACANT')) 
    };
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
            let activeCompetitorsCount = scoredDogs.length;
            let payoutTier = activeCompetitorsCount >= 8 ? "1,2,3" : (activeCompetitorsCount >= 5 ? "2" : "Pay Win Only");
            let podium = [activeRace.actualPlace1, activeRace.actualPlace2, activeRace.actualPlace3].map(n => (n || "").toUpperCase());
            let eligiblePlaceHit = false;
            if (payoutTier === "1,2,3") {
                eligiblePlaceHit = podium.slice(0, 3).includes(topPick.name.toUpperCase());
            } else if (payoutTier === "2") {
                eligiblePlaceHit = podium.slice(0, 2).includes(topPick.name.toUpperCase());
            }
            if (eligiblePlaceHit) {
                defaultPlacePayout = topPick.placeDiv > 0 ? topPick.placeDiv : 1.2;
            }
        }

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
            actualPlace4: activeRace.actualPlace4 || "",
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

        let validWinDivs = scoredDogs.map(d => parseFloat(d.winDiv) || 0).filter(div => div > 0);
        let lowestWinDiv = validWinDivs.length > 0 ? Math.min(...validWinDivs) : 0;

        let favoriteDogName = "";
        if (lowestWinDiv > 0) {
            let tiedDogs = scoredDogs.filter(d => (parseFloat(d.winDiv) || 0) === lowestWinDiv);
            if (tiedDogs.length === 1) {
                favoriteDogName = tiedDogs[0].name.toUpperCase();
            } else if (tiedDogs.length > 1) {
                tiedDogs.sort((a, b) => {
                    let pA = (parseFloat(a.placeDiv) > 0) ? parseFloat(a.placeDiv) : 999;
                    let pB = (parseFloat(b.placeDiv) > 0) ? parseFloat(b.placeDiv) : 999;
                    return pA - pB;
                });
                favoriteDogName = tiedDogs[0].name.toUpperCase();
            }
        }

let analysisHtml = '';
		scoredDogs.forEach((dog, index) => {
			let sexBadge = dog.sex === 'Dog' ? '<span class="text-blue-600 dark:text-blue-400 text-xs font-bold ml-1">🐶</span>' : (dog.sex === 'Bitch' ? '<span class="text-pink-600 dark:text-pink-400 text-xs font-bold ml-1">🐾</span>' : '');
			let sparkline = generateSparkline(dog.formArray);
			
			// --- DECLARE daysSinceText HERE ---
			let daysSinceText = (dog.daysSinceLastRun !== null && dog.daysSinceLastRun !== undefined) 
				? `<span class="text-xs font-mono text-slate-500 dark:text-slate-400 mt-1 block">⏱️ Days Since Last Run: <strong class="text-slate-800 dark:text-slate-200">${dog.daysSinceLastRun} days</strong> (${dog.recencyText || ''})</span>` 
				: `<span class="text-xs font-mono text-slate-400 mt-1 block">⏱️ Days Since Last Run: N/A</span>`;
			// -----------------------------------

			let ratingBadge = dog.ratingOutOf100 !== undefined ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-black font-mono bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-800 ml-2"><span class="text-red-500">&#9733;</span> ${dog.ratingOutOf100}</span>` : '';
			
			let isFavorite = favoriteDogName !== "" && dog.name.toUpperCase() === favoriteDogName;
			let favoriteBadge = isFavorite ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-black bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800 ml-2">⭐ Favorite</span>` : '';

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

			let encodedName = encodeURIComponent(dog.name);
            let encodedRaceKey = encodeURIComponent(window.activeRaceKey);
            let evVal = dog.expectedValuePercent !== undefined ? dog.expectedValuePercent : 0;
            let valueBadge = evVal >= 8.0 ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold font-mono bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">🟢 VALUE (+${evVal.toFixed(1)}% EV)</span>` : '';

			analysisHtml += `
              <li class="runner-card ${bgColor} p-4 border ${borderColor} rounded-lg shadow-sm flex flex-col md:flex-row md:justify-between mb-3 transition-colors">
                    <div class="mb-2 md:mb-0 flex flex-col justify-center">
                        <div class="flex items-center flex-wrap gap-2">
                            <!-- H2H Comparison Checkbox -->
                            <input type="checkbox" class="h2h-checkbox w-4 h-4 text-blue-600 rounded cursor-pointer" data-dog-name="${dog.name}" onchange="handleH2HSelection(this)" title="Select for Head-to-Head Comparison">

                            <!-- SAFE: Uses class and data attribute instead of inline onclick -->
                            <strong data-dog-name="${encodedName}" class="dog-name-click text-lg ${index === 0 ? 'text-green-900 dark:text-green-200 font-black cursor-pointer hover:text-blue-600 dark:hover:text-blue-400': 'text-slate-800 dark:text-white cursor-pointer hover:text-blue-600 dark:hover:text-blue-400'}">
                                ${index + 1}. ${dog.name}
                            </strong> 
                            ${sexBadge} 
                            <span class="text-sm font-mono text-slate-500 dark:text-slate-400 font-bold ml-1">(Box ${dog.officialBox})</span> 
                            ${ratingBadge} 
                            ${favoriteBadge}
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
                        <div class="flex items-center gap-1.5 flex-wrap">${pirBadge} ${boxBiasBadge} ${trafficBadge} ${valueBadge}</div>
                        
                        <div class="flex items-center gap-2 flex-wrap">
                            <span class="block">Win Div: <strong class="text-slate-900 dark:text-white font-mono text-base">$${dog.winDiv}</strong> | Place Div: <strong class="text-slate-900 dark:text-white font-mono text-base">$${dog.placeDiv}</strong> | Softmax Prob: <strong class="text-green-700 dark:text-green-400 font-mono">${dog.winProb.toFixed(1)}%</strong></span>
                           <button data-dog-name="${encodedName}" data-race-key="${encodedRaceKey}" data-race-num="${activeRace.raceNumber || 1}" data-win-div="${dog.winDiv}" data-place-div="${dog.placeDiv}" class="bet-btn bg-blue-600 hover:bg-blue-700 text-white font-bold py-1 px-2.5 rounded text-xs shadow transition-colors">💰 Bet</button>
                        </div>
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
                analysisHtml += `
                    <li class="bg-pink-50 dark:bg-pink-950/40 p-3 border border-pink-200 dark:border-pink-800 rounded-lg shadow-sm text-pink-900 dark:text-pink-200 flex justify-between items-center mb-2">
                        <div><strong class="font-bold">${dog.starterName}</strong> ${sexBadge} <span class="text-xs text-pink-600 font-mono">(Box ${dog.officialBox || dog.box})</span></div>
                        <span class="bg-pink-200 dark:bg-pink-800 text-pink-800 dark:text-pink-200 border border-pink-300 dark:border-pink-700 text-xs px-2 py-1 rounded shadow-sm font-bold uppercase">Scratched</span>
                    </li>
                `;
            });
        }

		document.getElementById('runner-analysis-list').innerHTML = analysisHtml;
		document.querySelectorAll('.dog-name-click').forEach(el => {
		el.addEventListener('click', (e) => {
        e.stopPropagation();
        let encodedName = e.currentTarget.getAttribute('data-dog-name');
        openScoreBreakdownModal(encodedName);
    });
});

        // Attach safe click listeners to all bet buttons (prevents apostrophe syntax errors)
        document.querySelectorAll('.bet-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevents card breakdown modal from opening when clicking bet
                let dName = decodeURIComponent(btn.getAttribute('data-dog-name'));
                let tKey = decodeURIComponent(btn.getAttribute('data-race-key'));
                let rNum = btn.getAttribute('data-race-num');
                let wDiv = parseFloat(btn.getAttribute('data-win-div')) || 0;
                let pDiv = parseFloat(btn.getAttribute('data-place-div')) || 0;
                openPlaceBetModal(encodeURIComponent(dName), encodeURIComponent(tKey), rNum, wDiv, pDiv);
            });
        });

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
        window.currentComputedResult.actualPlace4 = meeting.actualPlace4;

		let scoredDogsList = window.currentComputedResult.scoredDogs || [];
        let topPick = scoredDogsList.length > 0 ? scoredDogsList[0] : null;
        let activeCompetitorsCount = scoredDogsList.length;
        let payoutTier = window.currentComputedResult.manualPayoutTier || (activeCompetitorsCount >= 8 ? "1,2,3" : (activeCompetitorsCount >= 5 ? "2" : "Pay Win Only"));

        if (topPick) {
            let topPickName = topPick.name || "";
            let topPickStarter = meeting.starters.find(s => s.starterName.toUpperCase() === topPickName.toUpperCase());
            let resolvedOfficialWinDiv = (topPickStarter && topPickStarter.winDiv > 0) ? topPickStarter.winDiv : 0;

            if (meeting.actualWinner.toUpperCase() === topPickName.toUpperCase()) {
                window.currentComputedResult.actualWinPayout = resolvedOfficialWinDiv > 0 ? resolvedOfficialWinDiv : (topPick.winDiv > 0 ? topPick.winDiv : 2.0);
            } else {
                window.currentComputedResult.actualWinPayout = 0;
            }

            let podium = [meeting.actualPlace1, meeting.actualPlace2, meeting.actualPlace3].map(n => (n || "").toUpperCase());
            let eligiblePlaceHit = false;
            if (payoutTier === "1,2,3") {
                eligiblePlaceHit = podium.slice(0, 3).includes(topPickName.toUpperCase());
            } else if (payoutTier === "2") {
                eligiblePlaceHit = podium.slice(0, 2).includes(topPickName.toUpperCase());
            }

            if (eligiblePlaceHit) {
                let officialPlaceDiv = topPickStarter && topPickStarter.placeDiv > 0 ? topPickStarter.placeDiv : (topPick.placeDiv > 0 ? topPick.placeDiv : 1.2);
                window.currentComputedResult.actualPlacePayout = officialPlaceDiv;
            } else {
                window.currentComputedResult.actualPlacePayout = 0;
            }
        }
    }

	let currentTrackClean = extractTrackNameFromSaved({ trackName: window.currentComputedResult.trackName }).toUpperCase();
	let currentRaceNum = String(window.currentComputedResult.raceNumber || "").trim();
	let currentDateRaw = String(window.currentComputedResult.raceDate || "").replace(/\D/g, "");
	if (!currentDateRaw) {
		let match = (window.currentComputedResult.trackName || "").match(/(\d{2}[./-]\d{2}[./-]\d{4}|\d{8})/);
		if (match) currentDateRaw = match[1].replace(/\D/g, "");
	}

	let existingIndex = window.savedPredictions.findIndex(item => {
		let itemTrackClean = extractTrackNameFromSaved(item).toUpperCase();
		let itemRaceNum = String(item.raceNumber || "").trim();
		if (!itemRaceNum || itemRaceNum === "N/A") {
			let match = (item.trackName || "").match(/RACE\s*(\d+)/i);
			if (match) itemRaceNum = match[1];
		}
		let itemDateRaw = String(item.raceDate || extractDateFromSaved(item) || "").replace(/\D/g, "");
		if (!itemDateRaw) {
			let match = (item.trackName || "").match(/(\d{2}[./-]\d{2}[./-]\d{4}|\d{8})/);
			if (match) itemDateRaw = match[1].replace(/\D/g, "");
		}

		let trackMatch = itemTrackClean === currentTrackClean;
		let raceNumMatch = itemRaceNum && currentRaceNum && itemRaceNum === currentRaceNum;
		
		let dateMatch = true;
		if (itemDateRaw && currentDateRaw) {
			dateMatch = itemDateRaw === currentDateRaw;
		}

		return trackMatch && raceNumMatch && dateMatch;
	});

    if (existingIndex !== -1) {
        let existingItem = window.savedPredictions[existingIndex];
        if (existingItem.actualWinner && !window.currentComputedResult.actualWinner) {
            window.currentComputedResult.actualWinner = existingItem.actualWinner;
            window.currentComputedResult.actualPlace1 = existingItem.actualPlace1;
            window.currentComputedResult.actualPlace2 = existingItem.actualPlace2;
            window.currentComputedResult.actualPlace3 = existingItem.actualPlace3;
            window.currentComputedResult.actualPlace4 = existingItem.actualPlace4;
            window.currentComputedResult.actualWinPayout = existingItem.actualWinPayout;
            window.currentComputedResult.actualPlacePayout = existingItem.actualPlacePayout;
            window.currentComputedResult.manualPayoutTier = existingItem.manualPayoutTier;
        }
        window.savedPredictions[existingIndex] = window.currentComputedResult;
    } else {
        window.savedPredictions.unshift(window.currentComputedResult);
    }

    await sortAndPersistMeetingsObject();
    populateSavedFilterDropdowns();
    renderSavedPredictions();
    updateAllUIComponents();
    showNotification("Predictions successfully saved & synced!", "success");
}

async function updateActualWinner(index, winnerName) {
    if (window.savedPredictions[index]) {
        window.savedPredictions[index].actualWinner = winnerName;
        window.savedPredictions[index].actualPlace1 = winnerName;
        
        let item = window.savedPredictions[index];
        let scoredDogsList = item.scoredDogs || [];
        let topPick = scoredDogsList.length > 0 ? scoredDogsList[0] : null;
        let activeCompetitorsCount = scoredDogsList.length;
        let payoutTier = item.manualPayoutTier || (activeCompetitorsCount >= 8 ? "1,2,3" : (activeCompetitorsCount >= 5 ? "2" : "Pay Win Only"));

        if (topPick && winnerName) {
            let topPickName = topPick.name || "";
            if (winnerName.toUpperCase() === topPickName.toUpperCase()) {
                item.actualWinPayout = topPick.winDiv > 0 ? topPick.winDiv : 2.0;
            } else {
                item.actualWinPayout = 0;
            }

            let podium = [item.actualPlace1, item.actualPlace2, item.actualPlace3].map(n => (n || "").toUpperCase());
            let eligiblePlaceHit = false;
            if (payoutTier === "1,2,3") {
                eligiblePlaceHit = podium.slice(0, 3).includes(topPickName.toUpperCase());
            } else if (payoutTier === "2") {
                eligiblePlaceHit = podium.slice(0, 2).includes(topPickName.toUpperCase());
            }

            if (eligiblePlaceHit) {
                item.actualPlacePayout = topPick.placeDiv > 0 ? topPick.placeDiv : 1.2;
            } else {
                item.actualPlacePayout = 0;
            }
        } else {
            item.actualWinPayout = 0;
            item.actualPlacePayout = 0;
        }

        await sortAndPersistMeetingsObject();
        renderSavedPredictions();
        updateAllUIComponents();
    }
}

async function updateActualPlace2(index, dogName) {
    if (window.savedPredictions[index]) {
        let item = window.savedPredictions[index];
        item.actualPlace2 = dogName;
        
        let scoredDogsList = item.scoredDogs || [];
        let topPick = scoredDogsList.length > 0 ? scoredDogsList[0] : null;
        let activeCompetitorsCount = scoredDogsList.length;
        let payoutTier = item.manualPayoutTier || (activeCompetitorsCount >= 8 ? "1,2,3" : (activeCompetitorsCount >= 5 ? "2" : "Pay Win Only"));

        if (topPick && item.actualWinner) {
            let topPickName = topPick.name || "";
            let podium = [item.actualPlace1, item.actualPlace2, item.actualPlace3].map(n => (n || "").toUpperCase());
            let eligiblePlaceHit = false;
            if (payoutTier === "1,2,3") {
                eligiblePlaceHit = podium.slice(0, 3).includes(topPickName.toUpperCase());
            } else if (payoutTier === "2") {
                eligiblePlaceHit = podium.slice(0, 2).includes(topPickName.toUpperCase());
            }

            if (eligiblePlaceHit) {
                item.actualPlacePayout = topPick.placeDiv > 0 ? topPick.placeDiv : 1.2;
            } else {
                item.actualPlacePayout = 0;
            }
        }

        await sortAndPersistMeetingsObject();
        renderSavedPredictions();
        updateAllUIComponents();
    }
}

async function updateActualPlace3(index, dogName) {
    if (window.savedPredictions[index]) {
        let item = window.savedPredictions[index];
        item.actualPlace3 = dogName;
        
        let scoredDogsList = item.scoredDogs || [];
        let topPick = scoredDogsList.length > 0 ? scoredDogsList[0] : null;
        let activeCompetitorsCount = scoredDogsList.length;
        let payoutTier = item.manualPayoutTier || (activeCompetitorsCount >= 8 ? "1,2,3" : (activeCompetitorsCount >= 5 ? "2" : "Pay Win Only"));

        if (topPick && item.actualWinner) {
            let topPickName = topPick.name || "";
            let podium = [item.actualPlace1, item.actualPlace2, item.actualPlace3].map(n => (n || "").toUpperCase());
            let eligiblePlaceHit = false;
            if (payoutTier === "1,2,3") {
                eligiblePlaceHit = podium.slice(0, 3).includes(topPickName.toUpperCase());
            } else if (payoutTier === "2") {
                eligiblePlaceHit = podium.slice(0, 2).includes(topPickName.toUpperCase());
            }

            if (eligiblePlaceHit) {
                item.actualPlacePayout = topPick.placeDiv > 0 ? topPick.placeDiv : 1.2;
            } else {
                item.actualPlacePayout = 0;
            }
        }

        await sortAndPersistMeetingsObject();
        renderSavedPredictions();
        updateAllUIComponents();
    }
}

async function updateActualPlace4(index, dogName) {
    if (window.savedPredictions[index]) {
        let item = window.savedPredictions[index];
        item.actualPlace4 = dogName;
        await sortAndPersistMeetingsObject();
        renderSavedPredictions();
        updateAllUIComponents();
    }
}

async function updateWinPayout(index, val) {
    if (window.savedPredictions[index]) {
        window.savedPredictions[index].actualWinPayout = parseFloat(val) || 0;
        await sortAndPersistMeetingsObject();
        renderSavedPredictions();
        updateAllUIComponents();
    }
}

async function updatePlacePayout(index, val) {
    if (window.savedPredictions[index]) {
        window.savedPredictions[index].actualPlacePayout = parseFloat(val) || 0;
        await sortAndPersistMeetingsObject();
        renderSavedPredictions();
        updateAllUIComponents();
    }
}

async function updatePayoutTier(index, tierVal) {
    if (window.savedPredictions[index]) {
        let item = window.savedPredictions[index];
        item.manualPayoutTier = tierVal;
        
        let scoredDogsList = item.scoredDogs || [];
        let topPick = scoredDogsList.length > 0 ? scoredDogsList[0] : null;
        let podium = [item.actualPlace1, item.actualPlace2, item.actualPlace3].map(n => (n || "").toUpperCase());
        
        let isPlaceHit = false;
        if (item.actualWinner && topPick) {
            let topPickName = topPick.name || "";
            if (tierVal === "1,2,3") {
                isPlaceHit = podium.slice(0, 3).includes(topPickName.toUpperCase());
            } else if (tierVal === "2") {
                isPlaceHit = podium.slice(0, 2).includes(topPickName.toUpperCase());
            } else {
                isPlaceHit = false;
            }

            if (isPlaceHit) {
                item.actualPlacePayout = topPick.placeDiv > 0 ? topPick.placeDiv : 1.2;
            } else {
                item.actualPlacePayout = 0;
            }
        }

        await sortAndPersistMeetingsObject();
        renderSavedPredictions();
        updateAllUIComponents();
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

    let currentTrackVal = trackSelect.value.toUpperCase().trim();
    let currentDateVal = dateSelect.value.trim();

    let tracks = new Set();
    let dates = new Set();

    window.savedPredictions.forEach(item => {
        let t = extractTrackNameFromSaved(item);
        if (t) tracks.add(t);
    });

    trackSelect.innerHTML = `<option value="">All Tracks</option>`;
    Array.from(tracks).sort().forEach(t => {
        let opt = document.createElement('option');
        opt.value = t;
        opt.innerText = t;
        if (t === currentTrackVal) opt.selected = true;
        trackSelect.appendChild(opt);
    });

    window.savedPredictions.forEach(item => {
        let t = extractTrackNameFromSaved(item);
        let d = extractDateFromSaved(item);
        
        if (!currentTrackVal || t === currentTrackVal) {
            if (d && d !== "N/A") dates.add(d);
        }
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

    filteredList.sort((a, b) => {
        let dateA = extractDateFromSaved(a);
        let dateB = extractDateFromSaved(b);
        let dateCompare = dateB.localeCompare(dateA);
        if (dateCompare !== 0) return dateCompare;

        let trackA = extractTrackNameFromSaved(a);
        let trackB = extractTrackNameFromSaved(b);
        let trackCompare = trackB.localeCompare(trackA);
        if (trackCompare !== 0) return trackCompare;

        let raceNumA = parseInt(a.raceNumber) || 0;
        let raceNumB = parseInt(b.raceNumber) || 0;
        if (raceNumA === 0) {
            let matchA = (a.trackName || "").match(/RACE\s*(\d+)/i);
            if (matchA) raceNumA = parseInt(matchA[1]) || 0;
        }
        if (raceNumB === 0) {
            let matchB = (b.trackName || "").match(/RACE\s*(\d+)/i);
            if (matchB) raceNumB = parseInt(matchB[1]) || 0;
        }
        return raceNumB - raceNumA;
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
        let secondPickName = scoredDogsList.length > 1 ? (scoredDogsList[1].name || "") : "";
        let thirdPickName = scoredDogsList.length > 2 ? (scoredDogsList[2].name || "") : "";
        let fourthPickName = scoredDogsList.length > 3 ? (scoredDogsList[3].name || "") : "";

        let isWinSettled = item.actualWinner && item.actualWinner.trim() !== "";
        let isWinHit = isWinSettled && item.actualWinner.toUpperCase() === topPickName.toUpperCase();
        
        let isPlaceSettled = isWinSettled;
        let podiumFinishingList = [item.actualPlace1, item.actualPlace2, item.actualPlace3].map(n => (n || "").toUpperCase());
        let activeCompetitorsCount = scoredDogsList.length;
        
        let defaultPayoutTier = activeCompetitorsCount >= 8 ? "1,2,3" : (activeCompetitorsCount >= 5 ? "2" : "Pay Win Only");
        let payoutTier = item.manualPayoutTier || defaultPayoutTier;
        let isPlaceHit = false;

        if (isPlaceSettled && topPickName) {
            if (payoutTier === "1,2,3") {
                isPlaceHit = podiumFinishingList.slice(0, 3).includes(topPickName.toUpperCase());
            } else if (payoutTier === "2") {
                isPlaceHit = podiumFinishingList.slice(0, 2).includes(topPickName.toUpperCase());
            } else {
                isPlaceHit = false;
            }
        }

        let isExactSettled = isWinSettled && item.actualPlace2 && item.actualPlace2.trim() !== "";
        let isExactHit = false;
        if (isExactSettled && topPickName && secondPickName) {
            let actualTopTwo = [item.actualPlace1, item.actualPlace2].map(n => (n || "").toUpperCase());
            let predictedTopTwo = [topPickName.toUpperCase(), secondPickName.toUpperCase()];
            isExactHit = actualTopTwo.length === 2 && actualTopTwo.every(dog => predictedTopTwo.includes(dog));
        }

		let isTrifectaSettled = isExactSettled && item.actualPlace3 && item.actualPlace3.trim() !== "";
        let isTrifectaHit = false;
        if (isTrifectaSettled && topPickName && secondPickName && thirdPickName) {
            let actualTopThree = [item.actualPlace1, item.actualPlace2, item.actualPlace3].map(n => (n || "").toUpperCase());
            let predictedTopThree = [topPickName.toUpperCase(), secondPickName.toUpperCase(), thirdPickName.toUpperCase()];
            
            // CORRECTED CHECK: Every predicted top pick must be present in the actual top 3 podium finish list
            isTrifectaHit = predictedTopThree.every(dog => actualTopThree.includes(dog));
        }

        let isFirst4Settled = isTrifectaSettled && item.actualPlace4 && item.actualPlace4.trim() !== "";
        let isFirst4Hit = false;
        if (isFirst4Settled && scoredDogsList.length >= 4) {
            let actualTopFour = [item.actualPlace1, item.actualPlace2, item.actualPlace3, item.actualPlace4].map(n => (n || "").toUpperCase());
            let predictedTopFour = scoredDogsList.slice(0, 4).map(d => (d.name || "").toUpperCase());
            isFirst4Hit = actualTopFour.length === 4 && predictedTopFour.every(dog => actualTopFour.includes(dog));
        }

        let tierBadgeClass = "bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-700 font-bold";

        let lossBadgeHTML = (!isPlaceHit && !isWinHit && !isExactHit && !isTrifectaHit && !isFirst4Hit && isWinSettled) ? '<span class="bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-200 border border-red-300 dark:border-red-700 text-xs px-2 py-0.5 rounded font-bold">Loss</span>' : '';

        let validWinDivs = scoredDogsList.map(d => parseFloat(d.winDiv) || 0).filter(div => div > 0);
        let lowestWinDiv = validWinDivs.length > 0 ? Math.min(...validWinDivs) : 0;

        let favoriteDogName = "";
        if (lowestWinDiv > 0) {
            let tiedDogs = scoredDogsList.filter(d => (parseFloat(d.winDiv) || 0) === lowestWinDiv);
            if (tiedDogs.length === 1) {
                favoriteDogName = tiedDogs[0].name.toUpperCase();
            } else if (tiedDogs.length > 1) {
                tiedDogs.sort((a, b) => {
                    let pA = (parseFloat(a.placeDiv) > 0) ? parseFloat(a.placeDiv) : 999;
                    let pB = (parseFloat(b.placeDiv) > 0) ? parseFloat(b.placeDiv) : 999;
                    return pA - pB;
                });
                favoriteDogName = tiedDogs[0].name.toUpperCase();
            }
        }

        html += `
            <div class="bg-white dark:bg-slate-900 p-5 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm saved-item-card">
                <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-3 border-b border-slate-100 dark:border-slate-800 pb-2 gap-2">
                    <div>
                        <button onclick="showSavedPredictionDetails(${actualIndex})" title="Click to view full historical analysis" class="font-black text-slate-900 dark:text-white text-lg tracking-tight hover:text-blue-600 dark:hover:text-blue-400 transition-colors text-left flex items-center gap-1.5 focus:outline-none">
                            <span>${displayTitle}</span> 
                            <svg class="w-5 h-5 text-slate-400 hover:text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"></path></svg>
                        </button>
                        <span class="text-xs text-slate-400 font-mono mt-1 block">${item.timestamp || ''} (${activeCompetitorsCount} runners)</span>
                    </div>
                    <div class="flex items-center gap-2 flex-wrap">
                        <select onchange="updatePayoutTier(${actualIndex}, this.value)" class="text-xs px-2.5 py-1 rounded ${tierBadgeClass} focus:outline-none cursor-pointer shadow-sm" title="Change Payout Tier">
                            <option value="Pay Win Only" ${payoutTier === 'Pay Win Only' ? 'selected' : ''}>Pay Win Only</option>
                            <option value="2" ${payoutTier === '2' ? 'selected' : ''}>Pay 1,2</option>
                            <option value="1,2,3" ${payoutTier === '1,2,3' ? 'selected' : ''}>Pay 1,2,3</option>
                        </select>
                        ${!isWinSettled ? '<span class="bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-200 border border-yellow-200 dark:border-yellow-700 text-xs px-2 py-0.5 rounded font-bold">Pending</span>' : ''}
                        ${isWinHit ? '<span class="bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-200 border border-green-300 dark:border-green-700 text-xs px-2 py-0.5 rounded font-bold">Win</span>' : ''}
                        ${isPlaceHit && payoutTier !== 'Pay Win Only' ? '<span class="bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200 border border-blue-300 dark:border-blue-700 text-xs px-2 py-0.5 rounded font-bold">Place</span>' : ''}
                        ${isExactHit ? '<span class="bg-indigo-100 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-200 border border-indigo-300 dark:border-indigo-700 text-xs px-2 py-0.5 rounded font-bold">Exac</span>' : ''}
                        ${isTrifectaHit ? '<span class="bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-200 border border-purple-300 dark:border-purple-700 text-xs px-2 py-0.5 rounded font-bold">Tri</span>' : ''}
                        ${isFirst4Hit ? '<span class="bg-teal-100 dark:bg-teal-900/40 text-teal-800 dark:text-teal-200 border border-teal-300 dark:border-teal-700 text-xs px-2 py-0.5 rounded font-bold">First 4</span>' : ''}
                        ${lossBadgeHTML}
                        <button onclick="deleteSavedPrediction(${actualIndex})" class="text-xs text-red-600 hover:text-red-800 font-bold px-2 py-1 rounded border border-red-200 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors">Delete</button>
                    </div>
                </div>

                <div class="bg-slate-50 dark:bg-slate-800 p-3 rounded-lg border border-slate-200 dark:border-slate-700 mb-3 grid grid-cols-1 sm:grid-cols-6 gap-2 text-xs">
                    <div>
                        <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">1st Winner:</label>
                        <select onchange="updateActualWinner(${actualIndex}, this.value)" class="w-full text-xs px-2 py-1 border rounded bg-white dark:bg-slate-900 font-semibold focus:outline-none">
                            <option value="">-- 1st --</option>
                            ${scoredDogsList.map(d => `<option value="${d.name}" ${item.actualWinner === d.name ? 'selected' : ''}>${d.name}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">2nd Place:</label>
                        <select onchange="updateActualPlace2(${actualIndex}, this.value)" class="w-full text-xs px-2 py-1 border rounded bg-white dark:bg-slate-900 font-semibold focus:outline-none">
                            <option value="">-- 2nd --</option>
                            ${scoredDogsList.map(d => `<option value="${d.name}" ${item.actualPlace2 === d.name ? 'selected' : ''}>${d.name}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">3rd Place:</label>
                        <select onchange="updateActualPlace3(${actualIndex}, this.value)" class="w-full text-xs px-2 py-1 border rounded bg-white dark:bg-slate-900 font-semibold focus:outline-none">
                            <option value="">-- 3rd --</option>
                            ${scoredDogsList.map(d => `<option value="${d.name}" ${item.actualPlace3 === d.name ? 'selected' : ''}>${d.name}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">4th Place:</label>
                        <select onchange="updateActualPlace4(${actualIndex}, this.value)" class="w-full text-xs px-2 py-1 border rounded bg-white dark:bg-slate-900 font-semibold focus:outline-none">
                            <option value="">-- 4th --</option>
                            ${scoredDogsList.map(d => `<option value="${d.name}" ${item.actualPlace4 === d.name ? 'selected' : ''}>${d.name}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Win Payout ($):</label>
                        <input type="number" step="0.1" value="${item.actualWinPayout || 0}" onchange="updateWinPayout(${actualIndex}, this.value)" class="w-full text-xs px-2 py-1 border rounded bg-white dark:bg-slate-900 font-mono font-bold focus:outline-none"/>
                    </div>
                    <div>
                        <label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">Place Payout ($):</label>
                        <input type="number" step="0.1" value="${item.actualPlacePayout || 0}" onchange="updatePlacePayout(${actualIndex}, this.value)" class="w-full text-xs px-2 py-1 border rounded bg-white dark:bg-slate-900 font-mono font-bold focus:outline-none"/>
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
            if(idx === 3) { bg = "bg-[#e0e7ff] dark:bg-indigo-950/40"; textRank = "text-indigo-900 dark:text-indigo-200 font-bold"; }
            
            let pDivDisplay = dog.placeDiv !== undefined && !isNaN(dog.placeDiv) ? dog.placeDiv : '0';
            let ratingDisplay = dog.ratingOutOf100 !== undefined ? `<span class="bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-800 px-2 py-0.5 rounded text-xs font-black font-mono ml-2"><span class="text-red-500">&#9733;</span> ${dog.ratingOutOf100}</span>` : '';
            
            let isFavorite = favoriteDogName !== "" && dog.name.toUpperCase() === favoriteDogName;
            let favoriteDisplay = isFavorite ? `<span class="bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800 px-2 py-0.5 rounded text-xs font-black ml-2">⭐ Favorite</span>` : '';

            html += `<div class="${bg} p-2.5 rounded text-sm text-slate-700 dark:text-slate-300 border border-slate-200/50 dark:border-slate-700 flex justify-between items-center">
                        <div class="flex items-center gap-1 flex-wrap"><span class="${textRank}">${idx + 1}. ${dog.name}</span> ${sexLabel} <span class="text-xs font-mono text-slate-500 dark:text-slate-400">(B${dog.officialBox || dog.box})</span> ${ratingDisplay} ${favoriteDisplay}</div>
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

    // --- EXOTIC TALLIES CALCULATION (EXAC, TRI, FIRST 4) ---
    let exacSettledCount = 0;
    let exacHits = 0;
    let triSettledCount = 0;
    let triHits = 0;
    let first4SettledCount = 0;
    let first4Hits = 0;

    settled.forEach(item => {
        let scoredDogsList = item.scoredDogs || [];
        let topPickName = scoredDogsList.length > 0 ? (scoredDogsList[0].name || "") : "";
        let secondPickName = scoredDogsList.length > 1 ? (scoredDogsList[1].name || "") : "";
        let thirdPickName = scoredDogsList.length > 2 ? (scoredDogsList[2].name || "") : "";

        // Exacta Check
        let isExactSettled = item.actualWinner && item.actualWinner.trim() !== "" && item.actualPlace2 && item.actualPlace2.trim() !== "";
        if (isExactSettled && topPickName && secondPickName) {
            exacSettledCount++;
            let actualTopTwo = [item.actualPlace1, item.actualPlace2].map(n => (n || "").toUpperCase());
            let predictedTopTwo = [topPickName.toUpperCase(), secondPickName.toUpperCase()];
            if (actualTopTwo.length === 2 && actualTopTwo.every(dog => predictedTopTwo.includes(dog))) {
                exacHits++;
            }
        }

        // Trifecta Check
        let isTrifectaSettled = isExactSettled && item.actualPlace3 && item.actualPlace3.trim() !== "";
        if (isTrifectaSettled && topPickName && secondPickName && thirdPickName) {
            triSettledCount++;
            let actualTopThree = [item.actualPlace1, item.actualPlace2, item.actualPlace3].map(n => (n || "").toUpperCase());
            let predictedTopThree = [topPickName.toUpperCase(), secondPickName.toUpperCase(), thirdPickName.toUpperCase()];
            if (predictedTopThree.every(dog => actualTopThree.includes(dog))) {
                triHits++;
            }
        }

        // First 4 Check
        let isFirst4Settled = isTrifectaSettled && item.actualPlace4 && item.actualPlace4.trim() !== "";
        if (isFirst4Settled && scoredDogsList.length >= 4) {
            first4SettledCount++;
            let actualTopFour = [item.actualPlace1, item.actualPlace2, item.actualPlace3, item.actualPlace4].map(n => (n || "").toUpperCase());
            let predictedTopFour = scoredDogsList.slice(0, 4).map(d => (d.name || "").toUpperCase());
            if (actualTopFour.length === 4 && predictedTopFour.every(dog => actualTopFour.includes(dog))) {
                first4Hits++;
            }
        }
    });

    // Update Exotic Tallies UI Elements
    let exacEl = document.getElementById('tally-exac');
    let triEl = document.getElementById('tally-tri');
    let first4El = document.getElementById('tally-first4');

    if (exacEl) exacEl.innerText = `${exacHits} / ${exacSettledCount}`;
    if (triEl) triEl.innerText = `${triHits} / ${triSettledCount}`;
    if (first4El) first4El.innerText = `${first4Hits} / ${first4SettledCount}`;

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
        let payoutTier = item.manualPayoutTier || (activeCount >= 8 ? "1,2,3" : (activeCount >= 5 ? "2" : "Pay Win Only"));

        if (!topPick || payoutTier === "Pay Win Only") return false;
        if (payoutTier === "1,2,3") {
            return podium.slice(0, 3).includes(topPick.toUpperCase());
        } else if (payoutTier === "2") {
            return podium.slice(0, 2).includes(topPick.toUpperCase());
        }
        return false;
    }).length;
    let placeStrikeRate = totalSettled > 0 ? (placeHits / totalSettled) * 100 : 0;
    let placeTurnover = totalSettled * 1.0;
    let placeReturn = settled.reduce((acc, item) => {
        let scoredDogsList = item.scoredDogs || [];
        let topPick = scoredDogsList.length > 0 ? (scoredDogsList[0].name || "") : "";
        let podium = [item.actualPlace1, item.actualPlace2, item.actualPlace3].map(n => (n || "").toUpperCase());
        let activeCount = scoredDogsList.length;
        let payoutTier = item.manualPayoutTier || (activeCount >= 8 ? "1,2,3" : (activeCount >= 5 ? "2" : "Pay Win Only"));

        let isPlaceHit = false;
        if (topPick && payoutTier !== "Pay Win Only") {
            if (payoutTier === "1,2,3") {
                isPlaceHit = podium.slice(0, 3).includes(topPick.toUpperCase());
            } else if (payoutTier === "2") {
                isPlaceHit = podium.slice(0, 2).includes(topPick.toUpperCase());
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
        let payoutTier = item.manualPayoutTier || (activeCount >= 8 ? "1,2,3" : (activeCount >= 5 ? "2" : "Pay Win Only"));

        let isPlaceHit = false;
        if (topPick && payoutTier !== "Pay Win Only") {
            if (payoutTier === "1,2,3") {
                isPlaceHit = podium.slice(0, 3).includes(topPick.toUpperCase());
            } else if (payoutTier === "2") {
                isPlaceHit = podium.slice(0, 2).includes(topPick.toUpperCase());
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

    let csvContent = "data:text/csv;charset=utf-8,Track,Race,Distance,Date,Timestamp,Rank,Dog Name,Box,Sex,WinDiv,PlaceDiv,Rating,BestTime,Best 1Sec,Score,Form History,Actual Winner,Actual Place 2,Actual Place 3,Actual Place 4,Win Payout,Place Payout,Payout Tier\n";
    
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
                `"${item.actualPlace4 || ''}"`,
                item.actualWinPayout || 0,
                item.actualPlacePayout || 0,
                `"${item.manualPayoutTier || ''}"`
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
                let actualPlace4 = parts[19] || "";
                let actualWinPayout = parseFloat(parts[20]) || 0;
                let actualPlacePayout = parseFloat(parts[21]) || 0;
                let manualPayoutTier = parts[22] || "";

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
                        actualPlace4: actualPlace4,
                        actualWinPayout: actualWinPayout,
                        actualPlacePayout: actualPlacePayout,
                        manualPayoutTier: manualPayoutTier
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
            showNotification("CSV history imported & synced successfully!", "success");
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
    
	if (item.weights) {
        let w = item.weights;
        let isBaseline = true;
        let isSprint = true;
        let isDistance = true;

        let defaultBaseline = { windiv: 0.4, besttime: 0.5, avgtime: 0.6, best1sec: 0.5, avg1sec: 0.5, earlypos: 0.4, closinggain: 0.4, boxbias: 0.5 };
        let keys = ['windiv', 'besttime', 'avgtime', 'best1sec', 'avg1sec', 'earlypos', 'closinggain', 'boxbias'];
        
        keys.forEach(k => {
            if (w[k] !== defaultBaseline[k]) isBaseline = false;
            if (window.customPresets.sprint[k] !== w[k]) isSprint = false;
            if (window.customPresets.distance[k] !== w[k]) isDistance = false;
        });

        let badgeHtml = '';
        if (isBaseline) {
            badgeHtml = '<span class="bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-600 text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider shadow-sm">⚖️ Baseline Default</span>';
        } else if (isSprint) {
            badgeHtml = '<span class="bg-sky-100 text-sky-800 border border-sky-300 text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider shadow-sm">⚡ Sprint Preset</span>';
        } else if (isDistance) {
            badgeHtml = '<span class="bg-purple-100 text-purple-800 border border-purple-300 text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider shadow-sm">🏆 Distance Preset</span>';
        } else {
            badgeHtml = '<span class="bg-amber-100 text-amber-800 border border-amber-300 text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider shadow-sm">⚙️ Custom</span>';
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

    let validWinDivs = scoredDogs.map(d => parseFloat(d.winDiv) || 0).filter(div => div > 0);
    let lowestWinDiv = validWinDivs.length > 0 ? Math.min(...validWinDivs) : 0;

    let favoriteDogName = "";
    if (lowestWinDiv > 0) {
        let tiedDogs = scoredDogs.filter(d => (parseFloat(d.winDiv) || 0) === lowestWinDiv);
        if (tiedDogs.length === 1) {
            favoriteDogName = tiedDogs[0].name.toUpperCase();
        } else if (tiedDogs.length > 1) {
            tiedDogs.sort((a, b) => {
                let pA = (parseFloat(a.placeDiv) > 0) ? parseFloat(a.placeDiv) : 999;
                let pB = (parseFloat(b.placeDiv) > 0) ? parseFloat(b.placeDiv) : 999;
                return pA - pB;
            });
            favoriteDogName = tiedDogs[0].name.toUpperCase();
        }
    }

    scoredDogs.forEach((dog, idx) => {
        let sexBadge = dog.sex === 'Dog' ? '<span class="text-blue-600 dark:text-blue-400 text-xs font-bold ml-1">🐶</span>' : (dog.sex === 'Bitch' ? '<span class="text-pink-600 dark:text-pink-400 text-xs font-bold ml-1">🐾</span>' : '');
        let sparkline = generateSparkline(dog.formArray || []);
        let daysSinceText = dog.daysSinceLastRun !== null && dog.daysSinceLastRun !== undefined ? `<span class="text-xs font-mono text-slate-500 dark:text-slate-400 mt-1 block">⏱️ Days Since Last Run: <strong class="text-slate-800 dark:text-slate-200">${dog.daysSinceLastRun} days</strong> (${dog.recencyText || 'Standard form recency'})</span>` : `<span class="text-xs font-mono text-slate-400 mt-1 block">⏱️ Days Since Last Run: N/A (CSV Import/Missing)</span>`;
        
        let ratingBadge = dog.ratingOutOf100 !== undefined ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-black font-mono bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-800 ml-2"><span class="text-red-500">&#9733;</span> ${dog.ratingOutOf100}</span>` : '';
        
        let isFavorite = favoriteDogName !== "" && dog.name.toUpperCase() === favoriteDogName;
        let favoriteBadge = isFavorite ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-black bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800 ml-2">⭐ Favorite</span>` : '';

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
        } else if (idx === 3) { 
            bgColor = "bg-[#e0e7ff] dark:bg-indigo-950/40"; borderColor = "border-[#c7d2fe] dark:border-indigo-800";
            rankDisplay = `<strong class="text-lg text-indigo-900 dark:text-indigo-200 font-black">${idx + 1}. ${dog.name}</strong>`;
        }
        
        let winProbVal = dog.winProb !== undefined && !isNaN(dog.winProb) ? dog.winProb.toFixed(1) + "%" : "N/A";
        
        analysisHtml += `
            <li class="${bgColor} p-4 border ${borderColor} rounded-lg shadow-sm flex flex-col md:flex-row md:justify-between mb-3 transition-colors">
                <div class="mb-2 md:mb-0 flex flex-col justify-center">
                    <div class="flex items-center flex-wrap gap-1">
                        ${rankDisplay} ${sexBadge} <span class="text-sm font-mono text-slate-500 dark:text-slate-400 font-bold ml-1">(Box ${dog.officialBox || dog.box})</span> ${ratingBadge} ${favoriteBadge}
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

// User Betting & Bankroll Management functions
function openWalletModal() {
    let modal = document.getElementById('wallet-modal');
    let modalContent = document.getElementById('wallet-modal-content');
    modal.classList.remove('hidden');
    void modal.offsetWidth;
    modal.classList.remove('opacity-0');
    modalContent.classList.remove('scale-95');
}

function closeWalletModal() {
    let modal = document.getElementById('wallet-modal');
    let modalContent = document.getElementById('wallet-modal-content');
    modal.classList.add('opacity-0');
    modalContent.classList.add('scale-95');
    setTimeout(() => {
        modal.classList.add('hidden');
    }, 300);
}

async function submitWalletAction() {
    let actionType = document.getElementById('wallet-action-type').value;
    let amount = parseFloat(document.getElementById('wallet-action-amount').value);
    if (isNaN(amount) || amount <= 0) {
        showNotification("Please enter a valid amount.");
        return;
    }

    if (!window.userWallet) window.userWallet = { balance: 1000.00, staked: 0.00, profit: 0.00 };
    if (!window.userWallet.transactions) window.userWallet.transactions = [];

    let timestampStr = new Date().toLocaleString();

    if (actionType === 'deposit') {
        window.userWallet.balance += amount;
        window.userWallet.transactions.unshift({
            id: Date.now(),
            type: 'Deposit',
            description: 'Funds Deposited to Wallet',
            amount: amount,
            balanceAfter: window.userWallet.balance,
            timestamp: timestampStr
        });
        showNotification(`Successfully deposited $${amount.toFixed(2)}.`, "success");
    } else if (actionType === 'withdraw') {
        if (amount > window.userWallet.balance) {
            showNotification("Insufficient funds in available balance for withdrawal.");
            return;
        }
        window.userWallet.balance -= amount;
        window.userWallet.transactions.unshift({
            id: Date.now(),
            type: 'Withdrawal',
            description: 'Funds Withdrawn from Wallet',
            amount: -amount,
            balanceAfter: window.userWallet.balance,
            timestamp: timestampStr
        });
        showNotification(`Successfully withdrew $${amount.toFixed(2)}.`, "success");
    }

    closeWalletModal();
    await sortAndPersistMeetingsObject();
    updateWalletDisplay();
    renderTransactionHistory();
}

async function resetWalletData() {
    if (confirm("Are you sure you want to reset your wallet balance and betting history?")) {
        window.userWallet = { balance: 0.00, staked: 0.00, profit: 0.00 };
        window.activeBets = [];
        window.settledBets = [];
        await sortAndPersistMeetingsObject();
        updateWalletDisplay();
        renderBettingTab();
        showNotification("Wallet and betting history reset successfully.", "success");
    }
}

	function openPlaceBetModal(encodedDogName, encodedTrackName, raceNum, winDiv, placeDiv) {
		let dogName = decodeURIComponent(encodedDogName);
		let trackName = decodeURIComponent(encodedTrackName);

		document.getElementById('bet-modal-dog-name').value = dogName;
		document.getElementById('bet-modal-track-name').value = trackName;
		document.getElementById('bet-modal-race-num').value = raceNum;
		document.getElementById('bet-modal-windiv').value = winDiv;
		document.getElementById('bet-modal-placediv').value = placeDiv;

		document.getElementById('bet-lbl-runner').innerText = dogName;
		
	let kellyToggle = document.getElementById('kellyCriterionToggle');
    if (kellyToggle) {
        kellyToggle.checked = false;
        isKellyActive = false;
        
        // Remove any old listeners and attach a fresh one
        kellyToggle.onchange = function() {
            isKellyActive = this.checked;
            console.log("Kelly checkbox clicked! Active state:", isKellyActive); // This will show in console now!
            updateCombinedBetCalculation();
        };
    }	
    
    let raceObj = (window.allRaceMeetings && window.allRaceMeetings[trackName]) ? window.allRaceMeetings[trackName] : null;
    let raceDate = raceObj && raceObj.raceDate ? raceObj.raceDate : "";
    let displayText = trackName;
    if (raceDate && !displayText.includes(raceDate)) {
        displayText = `${trackName} (${raceDate})`;
    }
    document.getElementById('bet-lbl-meeting').innerText = displayText;
    
    let winStakeEl = document.getElementById('winStakeInput');
    let placeStakeEl = document.getElementById('placeStakeInput');
    let fixedWinEl = document.getElementById('fixedWinOddsInput');
    let fixedPlaceEl = document.getElementById('fixedPlaceOddsInput');
    let fixedToggle = document.getElementById('fixedOddsToggle');
    let fixedContainer = document.getElementById('fixedOddsInputsContainer');

    if (winStakeEl) winStakeEl.value = "";
    if (placeStakeEl) placeStakeEl.value = "";
    if (fixedWinEl) fixedWinEl.value = winDiv > 0 ? winDiv : "";
    if (fixedPlaceEl) fixedPlaceEl.value = placeDiv > 0 ? placeDiv : "";
    if (fixedToggle) fixedToggle.checked = false;
    if (fixedContainer) fixedContainer.classList.add('hidden');

    updateCombinedBetCalculation();

    let modal = document.getElementById('place-bet-modal');
    let modalContent = document.getElementById('place-bet-modal-content');
    if (modal && modalContent) {
        modal.classList.remove('hidden');
        void modal.offsetWidth;
        modal.classList.remove('opacity-0');
        modalContent.classList.remove('scale-95');
    }
}

let isKellyActive = false;

function toggleKellyCriterion() {
    let checkbox = document.getElementById('kellyCriterionToggle');
    isKellyActive = checkbox ? checkbox.checked : false;    
    // Force an immediate stake calculation update
    updateCombinedBetCalculation();
}

function updateCombinedBetCalculation() {
    let winStakeEl = document.getElementById('winStakeInput');
    let placeStakeEl = document.getElementById('placeStakeInput');
    let winDivInput = document.getElementById('fixedWinOddsInput');
    let winDivEl = document.getElementById('bet-modal-windiv') || document.getElementById('fixedWinOddsInput');
    let placeDivEl = document.getElementById('bet-modal-placediv');

    if (!winStakeEl) return;

    if (isKellyActive && window.currentComputedResult && window.currentComputedResult.scoredDogs) {
        let currentDogName = document.getElementById('bet-modal-dog-name').value;
        let dogObj = window.currentComputedResult.scoredDogs.find(d => d.name.toUpperCase() === currentDogName.toUpperCase());
        
        console.log("🔍 Kelly Debug - Looking for dog:", currentDogName);
        console.log("🔍 Kelly Debug - Found dogObj:", dogObj);

        if (dogObj) {
            console.log("🔍 Kelly Debug - winProb:", dogObj.winProb);
            let winDiv = parseFloat(winDivInput ? winDivInput.value : 0) || parseFloat(dogObj.winDiv) || 2.0;
            let p = (dogObj.winProb || 0) / 100.0; 
            let q = 1.0 - p;
            let b = winDiv - 1.0; 
            
            console.log("🔍 Kelly Debug - calculated winDiv:", winDiv, "p:", p, "Net Odds b:", b);

            if (b > 0 && p > 0) {
                let fullKelly = (b * p - q) / b;
                let quarterKellyFraction = fullKelly > 0 ? (fullKelly * 0.25) : 0.01;
                
                let currentWallet = window.userWalletBalance || (window.userWallet && window.userWallet.balance) || parseFloat(localStorage.getItem('userWalletBalance')) || 1000.0; 
                let optimalStake = currentWallet * quarterKellyFraction;
                
                if (optimalStake < 2.5 && p >= 0.20) {
                    optimalStake = 5.0; 
                }

                // --- ROUND TO NEAREST $0.50 ---
                optimalStake = Math.round(optimalStake * 2) / 2;
                
                console.log("🎯 Kelly Debug - Rounded Stake:", optimalStake);
                winStakeEl.value = optimalStake > 0 ? optimalStake.toFixed(2) : "0.00";

                let placeDiv = parseFloat(placeDivEl ? placeDivEl.value : 0) || parseFloat(dogObj.placeDiv) || 0;
                if (placeStakeEl && optimalStake > 0 && placeDiv > 1.0) {
                    let calculatedPlaceStake = optimalStake / placeDiv;
                    // Round to nearest $0.50
                    calculatedPlaceStake = Math.round(calculatedPlaceStake * 2) / 2;
                    placeStakeEl.value = calculatedPlaceStake > 0 ? calculatedPlaceStake.toFixed(2) : "0.00";
                }
            } else {
                console.log("⚠️ Kelly Debug - Condition failed: Net odds b or winProb is <= 0");
            }
        } else {
            console.log("❌ Kelly Debug - Dog object could not be found in scoredDogs!");
        }
    }

    let winStake = winStakeEl ? parseFloat(winStakeEl.value) || 0 : 0;
    let placeStake = placeStakeEl ? parseFloat(placeStakeEl.value) || 0 : 0;
    let winDiv = winDivEl ? parseFloat(winDivEl.value) || 0 : 0;
    let placeDiv = placeDivEl ? parseFloat(placeDivEl.value) || 0 : 0;

    let estWinReturn = winStake * winDiv;
    let estPlaceReturn = placeStake * placeDiv;

    let winRetEl = document.getElementById('bet-lbl-win-return');
    let placeRetEl = document.getElementById('bet-lbl-place-return');

    if (winRetEl) winRetEl.innerText = `$${estWinReturn.toFixed(2)}`;
    if (placeRetEl) placeRetEl.innerText = `$${estPlaceReturn.toFixed(2)}`;
}

async function confirmAndPlaceBet() {
    let dogNameEl = document.getElementById('bet-modal-dog-name');
    let trackNameEl = document.getElementById('bet-modal-track-name');
    let raceNumEl = document.getElementById('bet-modal-race-num');
    
    let dogName = dogNameEl ? dogNameEl.value : "Unknown";
    let trackName = trackNameEl ? trackNameEl.value : "Unknown Track";
    let raceNum = raceNumEl ? raceNumEl.value : "1";
    
    let winStake = parseFloat(document.getElementById('winStakeInput')?.value) || 0;
    let placeStake = parseFloat(document.getElementById('placeStakeInput')?.value) || 0;
    let winDiv = parseFloat(document.getElementById('bet-modal-windiv')?.value) || 0;
    let placeDiv = parseFloat(document.getElementById('bet-modal-placediv')?.value) || 0;

    let isFixed = document.getElementById('fixedOddsToggle')?.checked || false;
    let fixedWinOdds = isFixed ? parseFloat(document.getElementById('fixedWinOddsInput')?.value) || winDiv : winDiv;
    let fixedPlaceOdds = isFixed ? parseFloat(document.getElementById('fixedPlaceOddsInput')?.value) || placeDiv : placeDiv;

    let totalStakeNeeded = winStake + placeStake;

    if (totalStakeNeeded <= 0) {
        showNotification("Please enter a valid stake for Win or Place.");
        return;
    }

    if (!window.userWallet) window.userWallet = { balance: 0.00, staked: 0.00, profit: 0.00 };
    if (!window.userWallet.transactions) window.userWallet.transactions = [];

    if (totalStakeNeeded > window.userWallet.balance) {
        showNotification("Insufficient wallet balance for these combined stakes.");
        return;
    }

    window.userWallet.balance -= totalStakeNeeded;
    window.userWallet.staked += totalStakeNeeded;

    let timestampStr = new Date().toLocaleString();
    let betsPlacedCount = 0;

    if (winStake > 0) {
        window.activeBets.push({
            id: Date.now() + Math.random(),
            dogName: dogName,
            trackName: trackName,
            raceNum: raceNum,
            betType: 'Win',
            stake: winStake,
            odds: fixedWinOdds,
            estReturn: winStake * fixedWinOdds,
            isFixedOdds: isFixed,
            fixedOdds: isFixed ? fixedWinOdds : null,
            timestamp: timestampStr,
            status: 'active'
        });
        window.userWallet.transactions.unshift({
            id: Date.now() + Math.random(),
            type: 'Bet Stake',
            description: `Win Bet: ${dogName} (${trackName})`,
            amount: -winStake,
            balanceAfter: window.userWallet.balance,
            timestamp: timestampStr
        });
        betsPlacedCount++;
    }

    if (placeStake > 0) {
        window.activeBets.push({
            id: Date.now() + Math.random() + 1,
            dogName: dogName,
            trackName: trackName,
            raceNum: raceNum,
            betType: 'Place',
            stake: placeStake,
            odds: fixedPlaceOdds,
            estReturn: placeStake * fixedPlaceOdds,
            isFixedOdds: isFixed,
            fixedOdds: isFixed ? fixedPlaceOdds : null,
            timestamp: timestampStr,
            status: 'active'
        });
        window.userWallet.transactions.unshift({
            id: Date.now() + Math.random() + 1,
            type: 'Bet Stake',
            description: `Place Bet: ${dogName} (${trackName})`,
            amount: -placeStake,
            balanceAfter: window.userWallet.balance,
            timestamp: timestampStr
        });
        betsPlacedCount++;
    }

    closePlaceBetModal();
    await sortAndPersistMeetingsObject();
    updateWalletDisplay();
    renderBettingTab();
    renderTransactionHistory();
    showNotification(`Successfully placed ${betsPlacedCount} bet(s) on ${dogName} for a total of $${totalStakeNeeded.toFixed(2)}!`, "success");
}

function closePlaceBetModal() {
    let modal = document.getElementById('place-bet-modal');
    let modalContent = document.getElementById('place-bet-modal-content');
    
    if (modal && modalContent) {
        modal.classList.add('opacity-0');
        modalContent.classList.add('scale-95');
        
        setTimeout(() => {
            modal.classList.add('hidden');
        }, 300); // Matches the 300ms transition duration
    }
}

function updateWalletDisplay() {
    let totalStakedActive = window.activeBets.reduce((acc, b) => acc + b.stake, 0);
    window.userWallet.staked = totalStakedActive;

    let netProfit = window.settledBets.reduce((acc, b) => acc + (b.payout - b.stake), 0);
    window.userWallet.profit = netProfit;

    let totalTurnoverSettled = window.settledBets.reduce((acc, b) => acc + b.stake, 0);
    let walletRoi = totalTurnoverSettled > 0 ? (netProfit / totalTurnoverSettled) * 100 : 0;

    let totalSettledCount = window.settledBets.length;
    let winBetsSettled = window.settledBets.filter(b => b.betType === 'Win');
    let placeBetsSettled = window.settledBets.filter(b => b.betType === 'Place');

    let winHits = winBetsSettled.filter(b => b.payout > 0).length;
    let placeHits = placeBetsSettled.filter(b => b.payout > 0).length;
    
    let totalWinsHit = window.settledBets.filter(b => b.payout > 0).length;

    let winStrike = winBetsSettled.length > 0 ? (winHits / winBetsSettled.length) * 100 : 0;
    let placeStrike = placeBetsSettled.length > 0 ? (placeHits / placeBetsSettled.length) * 100 : 0;
    let combinedStrike = totalSettledCount > 0 ? (totalWinsHit / totalSettledCount) * 100 : 0;

    document.getElementById('wallet-balance-display').innerText = `$${window.userWallet.balance.toFixed(2)}`;
    document.getElementById('wallet-staked-display').innerText = `$${window.userWallet.staked.toFixed(2)}`;
    
    let profitEl = document.getElementById('wallet-profit-display');
    profitEl.innerText = `${netProfit >= 0 ? '+' : ''}$${netProfit.toFixed(2)}`;
    profitEl.className = `text-xl font-black font-mono ${netProfit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`;

    let roiEl = document.getElementById('wallet-roi-display');
    roiEl.innerText = `${walletRoi >= 0 ? '+' : ''}${walletRoi.toFixed(1)}%`;
    roiEl.className = `text-xl font-black font-mono ${walletRoi >= 0 ? 'text-purple-600 dark:text-purple-400' : 'text-red-600 dark:text-red-400'}`;

    document.getElementById('wallet-win-strike-display').innerText = `${winStrike.toFixed(1)}% (${winHits}/${winBetsSettled.length})`;
    document.getElementById('wallet-place-strike-display').innerText = `${placeStrike.toFixed(1)}% (${placeHits}/${placeBetsSettled.length})`;
    document.getElementById('wallet-combined-strike-display').innerText = `${combinedStrike.toFixed(1)}% (${totalWinsHit}/${totalSettledCount})`;
}

// --- ADDED MISSING HELPER FUNCTION TO FIX REFERENCE ERROR ---
function extractBetDate(bet) {
    if (bet.trackName) {
        let matchParen = bet.trackName.match(/\(([^)]+)\)/);
        if (matchParen && matchParen[1].includes('.')) {
            return matchParen[1].trim().replace(/\./g, '/');
        }
    }
    let rawTime = bet.timestamp || bet.date || "";
    if (rawTime) {
        let match = String(rawTime).match(/\b\d{4}-\d{2}-\d{2}\b/) || String(rawTime).match(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/);
        if (match) return match[0];
        return String(rawTime).split(',')[0].split(' ')[0].trim();
    }
    return "";
}

function populateUserBetFilterDropdowns() {
    let trackSelect = document.getElementById('filter-user-track-select');
    let dateSelect = document.getElementById('filter-user-date-select');
    if (!trackSelect || !dateSelect) return;

    let currentTrackVal = trackSelect.value ? String(trackSelect.value).trim().toUpperCase() : "";
    let currentDateVal = dateSelect.value ? String(dateSelect.value).trim() : "";

    let tracks = new Set();
    let dates = new Set();

    let allBets = [...(window.activeBets || []), ...(window.settledBets || [])];

    const getCleanTrackName = (rawTrack) => {
        if (!rawTrack) return "";
        let track = String(rawTrack).toUpperCase().trim();
        if (track.includes(" - ")) track = track.split(" - ")[0].trim();
        let parts = track.split("RACE");
        if (parts.length > 1) track = parts[0].trim();
        return track;
    };

    allBets.forEach(bet => {
        if (bet && bet.trackName) {
            let cleanTrack = getCleanTrackName(bet.trackName);
            if (cleanTrack) tracks.add(cleanTrack);
        }
    });

    trackSelect.innerHTML = `<option value="">All Tracks</option>`;
    Array.from(tracks).sort().forEach(t => {
        let opt = document.createElement('option');
        opt.value = t;
        opt.innerText = t;
        if (t === currentTrackVal) opt.selected = true;
        trackSelect.appendChild(opt);
    });

    allBets.forEach(bet => {
        if (bet) {
            let betCleanTrack = getCleanTrackName(bet.trackName);
            let datePart = extractBetDate(bet);
            
            if (!currentTrackVal || betCleanTrack === currentTrackVal) {
                if (datePart && datePart !== "N/A" && datePart.length > 3) {
                    dates.add(datePart);
                }
            }
        }
    });

    if (dates.size === 0) {
        allBets.forEach(bet => {
            let datePart = extractBetDate(bet);
            if (datePart) dates.add(datePart);
        });
    }

    dateSelect.innerHTML = `<option value="">All Dates</option>`;
    Array.from(dates).sort().reverse().forEach(d => {
        let opt = document.createElement('option');
        opt.value = d;
        opt.innerText = d;
        if (d === currentDateVal) opt.selected = true;
        dateSelect.appendChild(opt);
    });
}

function resetUserBetFilters() {
    let trackSelect = document.getElementById('filter-user-track-select');
    let dateSelect = document.getElementById('filter-user-date-select');
    if (trackSelect) trackSelect.value = "";
    if (dateSelect) dateSelect.value = "";
    populateUserBetFilterDropdowns();
    renderBettingTab();
}

function renderBettingTab() {
    updateWalletDisplay();
    populateUserBetFilterDropdowns();

    // DECLARE A SAFE GLOBAL DEFAULT HERE SO IT CAN NEVER BE UNDEFINED
    let badgeClass = 'bg-slate-100 text-slate-800 border-slate-300'; 

    let trackSelectEl = document.getElementById('filter-user-track-select');
    let dateSelectEl = document.getElementById('filter-user-date-select');
    
    let selectedTrack = trackSelectEl && trackSelectEl.value ? String(trackSelectEl.value).trim().toUpperCase() : "";
    let selectedDate = dateSelectEl && dateSelectEl.value ? String(dateSelectEl.value).trim() : "";

    const getCleanTrackName = (rawTrack) => {
        if (!rawTrack) return "";
        let track = String(rawTrack).toUpperCase().trim();
        if (track.includes(" - ")) track = track.split(" - ")[0].trim();
        let parts = track.split("RACE");
        if (parts.length > 1) track = parts[0].trim();
        return track;
    };

    const sortBetsComparator = (a, b) => {
        let dateA = extractBetDate(a);
        let dateB = extractBetDate(b);
        let dateComp = dateB.localeCompare(dateA);
        if (dateComp !== 0) return dateComp;

        let trackA = a && a.trackName ? getCleanTrackName(a.trackName) : "";
        let trackB = b && b.trackName ? getCleanTrackName(b.trackName) : "";
        let trackComp = trackA.localeCompare(trackB);
        if (trackComp !== 0) return trackComp;

        const extractRaceNum = (bet) => {
            if (bet.raceNum !== undefined && !isNaN(parseInt(bet.raceNum))) {
                return parseInt(bet.raceNum);
            }
            let match = String(bet.trackName || "").match(/RACE\s*(\d+)/i);
            return match ? parseInt(match[1]) : 0;
        };

        let raceA = extractRaceNum(a);
        let raceB = extractRaceNum(b);
        return raceB - raceA;
    };

	let filteredActive = (window.activeBets || []).filter(bet => {
        if (!bet) return false;
        if (!selectedTrack && !selectedDate) return true;

        let betTrack = getCleanTrackName(bet.trackName);
        let betDate = extractBetDate(bet);

        let trackMatch = !selectedTrack || betTrack === selectedTrack;
        let dateMatch = !selectedDate || betDate === selectedDate;
        return trackMatch && dateMatch;
    });

    const activeContainer = document.getElementById('active-bets-container');
    if (activeContainer) {
        if (filteredActive.length === 0) {
            activeContainer.innerHTML = `<p class="text-xs text-slate-400 italic">No active bets match your selected filters.</p>`;
        } else {
            let sortedActive = [...filteredActive].sort(sortBetsComparator);
            let html = '';
            sortedActive.forEach((bet) => {
                let originalActiveIdx = window.activeBets.indexOf(bet);
                let stake = bet.stake || 0;
                let odds = bet.odds || 0;
                let estReturn = bet.estReturn || (stake * odds);
                
                // Fixed odds badge check
                let fixedBadge = bet.isFixedOdds ? `<span class="ml-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-50/80 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400 border border-amber-100 dark:border-amber-900/30">Fixed</span>` : '';

                html += `
                    <div class="bg-slate-50 dark:bg-slate-800 p-3.5 rounded-lg border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row justify-between items-start sm:items-center text-xs gap-3">
                        <div>
                            <div class="flex items-center gap-2 flex-wrap">
                                <span class="font-black text-slate-900 dark:text-white text-sm">${bet.dogName || "Unknown"} (${bet.betType || "Win"})</span>
                                <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-300">Active</span>
                            </div>
                            <div class="text-[11px] text-slate-500 mt-0.5">${bet.trackName || ""} • Stake: <strong class="text-slate-800 dark:text-slate-200 font-mono">$${stake.toFixed(2)}</strong> • Odds: <strong class="text-slate-800 dark:text-slate-200 font-mono">${odds.toFixed(2)}</strong>${fixedBadge}</div>
                        </div>
                        <div class="flex items-center gap-4 flex-wrap w-full sm:w-auto justify-between sm:justify-end">
                            <div class="text-right">
                                <span class="block text-[10px] text-slate-400 uppercase font-bold">Est. Return</span>
                                <span class="font-mono font-bold text-green-600 dark:text-green-400">$${estReturn.toFixed(2)}</span>
                            </div>
                            <button onclick="cancelActiveBet(${originalActiveIdx})" class="text-xs text-red-600 hover:text-red-800 font-bold px-2.5 py-1 rounded border border-red-200 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors">Cancel</button>
                        </div>
                    </div>
                `;
            });
            activeContainer.innerHTML = html;
        }
    }

let filteredSettled = (window.settledBets || []).filter(bet => {
        if (!bet) return false;
        if (!selectedTrack && !selectedDate) return true;

        let betTrack = getCleanTrackName(bet.trackName);
        let betDate = extractBetDate(bet);

        let trackMatch = !selectedTrack || betTrack === selectedTrack;
        let dateMatch = !selectedDate || betDate === selectedDate;
        return trackMatch && dateMatch;
    });

const settledContainer = document.getElementById('settled-bets-container');
    if (settledContainer) {
        if (filteredSettled.length === 0) {
            settledContainer.innerHTML = `<p class="text-xs text-slate-400 italic">No settled bets match your selected filters.</p>`;
        } else {
            let sortedSettled = [...filteredSettled].sort(sortBetsComparator);
            let html = '';
            sortedSettled.forEach((bet) => {
                let originalSettledIdx = window.settledBets.indexOf(bet);
                
                // Declare these variables first so they are fully scoped:
                let stake = bet.stake || 0;
                let payout = bet.payout || 0;
                let profit = payout - stake;
                let isWin = profit > 0;
                
                let badgeClass = isWin ? 'bg-green-100 text-green-800 dark:bg-green-950/60 dark:text-green-300 border-green-300' : 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300 border-red-300';
                let fixedBadge = bet.isFixedOdds ? `<span class="ml-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-50/80 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400 border border-amber-100 dark:border-amber-900/30">Fixed</span>` : '';

                html += `
                    <div class="bg-slate-50 dark:bg-slate-800 p-3.5 rounded-lg border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row justify-between items-start sm:items-center text-xs gap-3">
                        <div>
                            <div class="flex items-center gap-2 flex-wrap">
                                <span class="font-black text-slate-900 dark:text-white text-sm">${bet.dogName || "Unknown"} (${bet.betType || "Win"})</span>
                                <span class="px-2 py-0.5 rounded text-[10px] font-bold border ${badgeClass}">${isWin ? 'Won' : 'Lost'}</span>
                            </div>
                            <div class="text-[11px] text-slate-500 mt-0.5">${bet.trackName || ""} • Stake: <strong class="text-slate-800 dark:text-slate-200 font-mono">$${stake.toFixed(2)}</strong> • Odds: <strong class="text-slate-800 dark:text-slate-200 font-mono">${(bet.odds || 0).toFixed(2)}</strong>${fixedBadge}</div>
                        </div>
                        <div class="flex items-center gap-3 flex-wrap w-full sm:w-auto justify-between sm:justify-end">
                            <div class="flex items-center gap-1.5">
                                <label class="text-[10px] font-bold text-slate-500 uppercase">Payout ($):</label>
                                <input type="number" step="0.1" value="${payout.toFixed(2)}" onchange="updateSettledBetPayout(${originalSettledIdx}, this.value)" class="w-24 text-xs px-2 py-1 border rounded bg-white dark:bg-slate-900 font-mono font-bold focus:outline-none" title="Manually override total payout amount"/>
                            </div>
                            <div class="text-right">
                                <span class="block text-[10px] text-slate-400 uppercase font-bold">Profit / Loss</span>
                                <span class="font-mono font-bold ${profit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}">
                                    ${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}
                                </span>
                            </div>
                            <button onclick="deleteSettledBet(${originalSettledIdx})" class="text-xs text-red-600 hover:text-red-800 font-bold px-2 py-1 rounded border border-red-200 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors" title="Delete Settled Bet">🗑️</button>
                        </div>
                    </div>
                `;
            });
            settledContainer.innerHTML = html;
        }
    }
}

async function updateActiveBetOdds(index, newOddsVal) {
    if (window.activeBets[index]) {
        let odds = parseFloat(newOddsVal) || 0;
        window.activeBets[index].odds = odds;
        window.activeBets[index].estReturn = window.activeBets[index].stake * odds;
        await sortAndPersistMeetingsObject();
        renderBettingTab();
    }
}

async function updateSettledBetPayout(index, newPayoutVal) {
    if (window.settledBets[index]) {
        let newPayout = parseFloat(newPayoutVal) || 0;
        window.settledBets[index].payout = newPayout;
        window.settledBets[index].won = newPayout > 0;
        await sortAndPersistMeetingsObject();
        renderBettingTab();
        updateWalletDisplay();
        showNotification("Settled bet payout updated successfully!", "success");
    }
}

async function cancelActiveBet(index) {
    if (index < 0 || index >= window.activeBets.length) return;
    let bet = window.activeBets[index];
    
    window.userWallet.balance += bet.stake;
    window.activeBets.splice(index, 1);
    
    await sortAndPersistMeetingsObject();
    renderBettingTab();
    showNotification("Bet cancelled and stake refunded.", "info");
}

async function clearSettledBets() {
    if (window.settledBets.length === 0) {
        showNotification("No settled bets to clear.");
        return;
    }
    if (confirm("Are you sure you want to clear settled betting history?")) {
        window.settledBets = [];
        await sortAndPersistMeetingsObject();
        renderBettingTab();
        showNotification("Settled betting history cleared.");
    }
}

function highlightBottomNav(btnElement) {
    const navButtons = document.querySelectorAll('.nav-icon-btn');
    navButtons.forEach(btn => {
        btn.classList.remove('text-slate-900', 'dark:text-white', 'font-bold');
        btn.classList.add('text-slate-500', 'dark:text-slate-400', 'font-medium');
    });
    if (btnElement) {
        btnElement.classList.remove('text-slate-500', 'dark:text-slate-400', 'font-medium');
        btnElement.classList.add('text-slate-900', 'dark:text-white', 'font-bold');
    }
}

function renderTransactionHistory() {
    const container = document.getElementById('transaction-history-container');
    if (!container) return;

    if (!window.userWallet.transactions || window.userWallet.transactions.length === 0) {
        container.innerHTML = `<p class="text-xs text-slate-400 italic">No transactions recorded yet.</p>`;
        return;
    }

    let html = '';
    window.userWallet.transactions.forEach(tx => {
        let isPositive = tx.amount >= 0;
        let badgeColor = '';

        if (tx.type === 'Withdrawal') {
            badgeColor = 'text-orange-700 dark:text-orange-300 bg-orange-50 dark:bg-orange-950/40 border-orange-200 dark:border-orange-800';
        } else if (isPositive) {
            badgeColor = 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/40 border-green-200 dark:border-green-800';
        } else {
            badgeColor = 'text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700';
        }

        let sign = isPositive ? '+' : '';

        html += `
            <div class="bg-slate-50 dark:bg-slate-800/60 p-3 rounded-lg border border-slate-200 dark:border-slate-700 flex justify-between items-center text-xs">
                <div>
                    <div class="flex items-center gap-2">
                        <span class="font-black text-slate-900 dark:text-white">${tx.type}</span>
                        <span class="text-[10px] font-mono px-2 py-0.5 rounded border ${badgeColor}">${tx.description}</span>
                    </div>
                    <span class="text-[11px] font-mono text-slate-400 mt-0.5 block">${tx.timestamp || 'Unknown Date'}</span>
                </div>
                <div class="text-right font-mono">
                    <span class="block font-bold text-sm ${isPositive ? 'text-green-600 dark:text-green-400' : 'text-slate-800 dark:text-slate-200'}">${sign}$${tx.amount.toFixed(2)}</span>
                    <span class="text-[10px] text-slate-400">Balance: $${tx.balanceAfter.toFixed(2)}</span>
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
}

async function clearTransactionHistory() {
    if (confirm("Are you sure you want to clear your transaction history ledger?")) {
        window.userWallet.transactions = [];
        await sortAndPersistMeetingsObject();
        renderTransactionHistory();
        showNotification("Transaction ledger cleared.", "success");
    }
}

function openTransactionModal() {
    renderTransactionHistory();
    let modal = document.getElementById('transaction-modal');
    let modalContent = document.getElementById('transaction-modal-content');
    
    modal.classList.remove('hidden');
    void modal.offsetWidth;
    modal.classList.remove('opacity-0');
    modalContent.classList.remove('scale-95');
}

function closeTransactionModal() {
    let modal = document.getElementById('transaction-modal');
    let modalContent = document.getElementById('transaction-modal-content');
    
    modal.classList.add('opacity-0');
    modalContent.classList.add('scale-95');
    
    setTimeout(() => {
        modal.classList.add('hidden');
    }, 300);
}

async function deleteSettledBet(index) {
    if (index < 0 || index >= window.settledBets.length) return;
    if (confirm("Are you sure you want to delete this settled bet record?")) {
        window.settledBets.splice(index, 1);
        await sortAndPersistMeetingsObject();
        renderBettingTab();
        showNotification("Settled bet deleted.", "info");
    }
}

// 1. Toggle visibility of fixed odds input fields when switch is clicked
const fixedOddsToggle = document.getElementById('fixedOddsToggle');
const fixedOddsInputsContainer = document.getElementById('fixedOddsInputsContainer');

if (fixedOddsToggle && fixedOddsInputsContainer) {
  fixedOddsToggle.addEventListener('change', (e) => {
    if (e.target.checked) {
      fixedOddsInputsContainer.classList.remove('hidden');
    } else {
      fixedOddsInputsContainer.classList.add('hidden');
    }
  });
}

// 2. Include these fields when collecting form data to save to Firestore / database
function collectBetFormData() {
  const isFixed = document.getElementById('fixedOddsToggle')?.checked || false;
  
  return {
    winStake: parseFloat(document.getElementById('winStakeInput')?.value) || 0,
    placeStake: parseFloat(document.getElementById('placeStakeInput')?.value) || 0,
    isFixedOdds: isFixed,
    fixedWinOdds: isFixed ? parseFloat(document.getElementById('fixedWinOddsInput')?.value) || 0 : null,
    fixedPlaceOdds: isFixed ? parseFloat(document.getElementById('fixedPlaceOddsInput')?.value) || 0 : null
  };
}

// 3. Prevent incoming race syncs/imports from overwriting your custom fixed odds
function applySyncOrImportOddsUpdate(existingBet, incomingRaceData) {
  if (existingBet.isFixedOdds) {
    // Keeps your manual fixed odds intact during syncs/settlement checks
    existingBet.winOdds = existingBet.fixedWinOdds;
    existingBet.placeOdds = existingBet.fixedPlaceOdds;
    return; 
  }
  
  // Standard sync fallback if fixed odds is toggled off
  existingBet.winOdds = incomingRaceData.currentWinOdds;
  existingBet.placeOdds = incomingRaceData.currentPlaceOdds;
}

function openScoreBreakdownModal(dogNameEncoded) {
    let dogName = decodeURIComponent(dogNameEncoded);
    if (!window.currentComputedResult || !window.currentComputedResult.scoredDogs) return;

    let dog = window.currentComputedResult.scoredDogs.find(d => d.name.toUpperCase() === dogName.toUpperCase());
    if (!dog) return;

    let activeRace = window.allRaceMeetings[window.activeRaceKey] || {};
    let trackMeta = `${activeRace.trackName || "Unknown Track"} — ${activeRace.raceDistance || ""} (Race ${activeRace.raceNumber || 1})`;

    document.getElementById('breakdown-dog-title').innerText = `${dog.name} (Box ${dog.officialBox || dog.box})`;
    document.getElementById('breakdown-race-meta').innerText = trackMeta;
    document.getElementById('breakdown-lbl-score').innerText = dog.score.toFixed(2);
    document.getElementById('breakdown-lbl-rating').innerText = `★ ${dog.ratingOutOf100 || 50}`;

    let timeVal = dog.rawAvgTime !== null ? dog.rawAvgTime : 30.0;
    document.getElementById('breakdown-val-time').innerText = `${timeVal.toFixed(2)}s Avg`;
    
    let timeBarElem = document.getElementById('breakdown-bar-time');
    if (timeBarElem) {
        timeBarElem.style.width = `${Math.min(100, Math.max(10, (timeVal / 35.0) * 100))}%`;
    }

    document.getElementById('breakdown-val-early').innerText = `1Sec: ${dog.best1Sec}s | Early: ${dog.avgEarly}`;
    document.getElementById('breakdown-val-box').innerText = `+${(dog.boxBiasBonus || 0).toFixed(1)} pts`;
    document.getElementById('breakdown-val-traffic').innerText = `${dog.trafficPenalty > 0 ? '+' : ''}${dog.trafficPenalty} pts`;
    document.getElementById('breakdown-val-recency').innerText = dog.daysSinceLastRun !== null ? `${dog.daysSinceLastRun} days ago` : `Standard`;

    document.getElementById('breakdown-note-box').innerText = `📦 ${dog.boxRecordText || 'No box stats'}`;
    document.getElementById('breakdown-note-traffic').innerText = `🚦 ${dog.trafficReason || 'Clean run expected'}`;
    document.getElementById('breakdown-note-recency').innerText = `⏱️ ${dog.recencyText || 'Standard form recency'}`;

    const modal = document.getElementById('score-breakdown-modal');
    const content = document.getElementById('score-breakdown-modal-content');
    if (modal && content) {
        modal.classList.remove('hidden');
        setTimeout(() => {
            modal.classList.remove('opacity-0');
            content.classList.remove('scale-95');
            content.classList.add('scale-100');
        }, 10);
    }
}

function closeScoreBreakdownModal() {
    const modal = document.getElementById('score-breakdown-modal');
    const content = document.getElementById('score-breakdown-modal-content');
    if (!modal || !content) return;
    
    modal.classList.add('opacity-0');
    content.classList.remove('scale-100');
    content.classList.add('scale-95');
    setTimeout(() => {
        modal.classList.add('hidden');
    }, 300);
}

function parseRacingDate(dateStr) {
    if (!dateStr || dateStr === "-" || dateStr === "N/A") return null;
    if (dateStr instanceof Date && !isNaN(dateStr)) return dateStr;
    let str = String(dateStr).trim();
    
    // Try standard JS parse first
    let d = new Date(str);
    if (!isNaN(d)) return d;
    
    // Handle split-based parsing for different regional formats
    let parts = str.split(/[\/\-]/);
    if (parts.length === 3) {
        let year, month, day;
        
        if (parts[0].length === 4) {
            // Format: YYYY-MM-DD or YYYY/MM/DD
            year = parseInt(parts[0], 10);
            month = parseInt(parts[1], 10) - 1;
            day = parseInt(parts[2], 10);
        } else {
            // Format: DD/MM/YYYY or DD-MM-YYYY
            day = parseInt(parts[0], 10);
            month = parseInt(parts[1], 10) - 1;
            year = parseInt(parts[2], 10);
            if (year < 100) year += 2000;
        }
        
        let customDate = new Date(year, month, day);
        if (!isNaN(customDate)) return customDate;
    }
    
    return null;
}

 //Normalizes and weights an early split (1st section) when comparing past races 
 //to a target distance, applying acceleration damping across distance tiers.
 
function normalizeEarlySplit(rawSplit, pastDistance, targetDistance) {
    if (!rawSplit || !pastDistance || !targetDistance || pastDistance === targetDistance) {
        return rawSplit;
    }

    const getTier = (dist) => {
        if (dist < 400) return 'sprint';
        if (dist <= 550) return 'middle';
        return 'staying';
    };

    const pastTier = getTier(pastDistance);
    const targetTier = getTier(targetDistance);

    let scaledSplit = (rawSplit / pastDistance) * targetDistance;

    if (pastTier !== targetTier) {
        const dampingFactor = 0.85; 
        scaledSplit = (scaledSplit * dampingFactor) + ((rawSplit) * (1 - dampingFactor) * (targetDistance / pastDistance));
    }

    return parseFloat(scaledSplit.toFixed(3));
}

let selectedH2HDogs = [];

function handleH2HSelection(checkbox) {
    let dogName = checkbox.getAttribute('data-dog-name');
    
    if (checkbox.checked) {
        if (selectedH2HDogs.length >= 3) {
            let firstCheckbox = document.querySelector(`.h2h-checkbox[data-dog-name="${selectedH2HDogs[0]}"]`);
            if (firstCheckbox) firstCheckbox.checked = false;
            selectedH2HDogs.shift();
        }
        selectedH2HDogs.push(dogName);
    } else {
        selectedH2HDogs = selectedH2HDogs.filter(name => name !== dogName);
    }

    let triggerContainer = document.getElementById('h2h-trigger-container');
    let countSpan = document.getElementById('h2h-count');
    let namesSpan = document.getElementById('h2h-selected-names');

    if (countSpan) countSpan.textContent = selectedH2HDogs.length;

    if (namesSpan) {
        if (selectedH2HDogs.length > 0) {
            namesSpan.textContent = `(${selectedH2HDogs.join(', ')})`;
        } else {
            namesSpan.textContent = '';
        }
    }

    if (triggerContainer) {
        if (selectedH2HDogs.length > 0) {
            triggerContainer.classList.remove('hidden');
        } else {
            triggerContainer.classList.add('hidden');
        }
    }
}

function openH2HComparisonModal() {
    if (selectedH2HDogs.length < 2) {
        showNotification("Please select at least 2 dogs to compare.");
        return;
    }

    let dogsList = window.currentComputedResult?.scoredDogs || [];
    let comparedDogs = selectedH2HDogs.map(name => dogsList.find(d => d.name.toUpperCase() === name.toUpperCase())).filter(Boolean);

    if (comparedDogs.length < 2) return;

    // --- CALCULATE BEST STAT BENCHMARKS & ADVANTAGE DOG ---
    let bestScore = Math.min(...comparedDogs.map(d => d.score));
    let bestWinProb = Math.max(...comparedDogs.map(d => d.winProb));
    let bestRating = Math.max(...comparedDogs.map(d => d.ratingOutOf100 || 0));
    
    let validBestTimes = comparedDogs.map(d => parseFloat(d.bestTime)).filter(t => !isNaN(t));
    let minBestTime = validBestTimes.length > 0 ? Math.min(...validBestTimes) : null;

    let validSplits = comparedDogs.map(d => parseFloat(d.avgTrackDistSplit)).filter(s => !isNaN(s) && s > 0);
    let minSplit = validSplits.length > 0 ? Math.min(...validSplits) : null;

    let validEarly = comparedDogs.map(d => parseFloat(d.avgEarly)).filter(e => !isNaN(e));
    let minEarly = validEarly.length > 0 ? Math.min(...validEarly) : null;

    let validGain = comparedDogs.map(d => parseFloat(d.avgGain)).filter(g => !isNaN(g));
    let maxGain = validGain.length > 0 ? Math.max(...validGain) : null;

    // Determine overall advantage dog (lowest model score wins)
    let advantageDog = comparedDogs.reduce((prev, curr) => (prev.score < curr.score) ? prev : curr);
    // -----------------------------------------------------------

    let columnsHTML = comparedDogs.map((dog, idx) => {
        let colors = ['text-blue-600', 'text-purple-600', 'text-amber-600'];
        let colorClass = colors[idx % colors.length];
        let highlightClass = "bg-green-100 dark:bg-green-950/60 text-green-800 dark:text-green-200 px-1.5 py-0.5 rounded font-bold";

        let scoreVal = dog.score;
        let winProbVal = dog.winProb;
        let ratingVal = dog.ratingOutOf100 || 0;
        let bestTimeVal = parseFloat(dog.bestTime);
        let splitVal = parseFloat(dog.avgTrackDistSplit);
        let earlyVal = parseFloat(dog.avgEarly);
        let gainVal = parseFloat(dog.avgGain);

        return `
            <div class="bg-slate-50 dark:bg-slate-800 p-4 rounded-lg flex-1 border border-slate-200 dark:border-slate-700">
                <h4 class="text-lg font-bold ${colorClass}">${dog.name}</h4>
                <p class="text-sm text-slate-500 dark:text-slate-400 mb-3">Box ${dog.box} (${dog.sex})</p>
                <ul class="space-y-2 text-left text-sm">
                    <li><strong>Model Score:</strong> <span class="${scoreVal === bestScore ? highlightClass : ''}">${scoreVal.toFixed(1)}</span></li>
                    <li><strong>Win Prob:</strong> <span class="${winProbVal === bestWinProb ? highlightClass : ''}">${winProbVal.toFixed(1)}%</span></li>
                    <li><strong>Rating (O/100):</strong> <span class="${ratingVal === bestRating ? highlightClass : ''}">${dog.ratingOutOf100}</span></li>
                    <li><strong>Best Time:</strong> <span class="${!isNaN(bestTimeVal) && bestTimeVal === minBestTime ? highlightClass : ''}">${dog.bestTime}</span></li>
                    <li><strong>Avg 1 Sec Split:</strong> <span class="${!isNaN(splitVal) && splitVal === minSplit ? highlightClass : ''}">${dog.avgTrackDistSplit}</span></li>
                    <li><strong>Early Pace:</strong> <span class="${!isNaN(earlyVal) && earlyVal === minEarly ? highlightClass : ''}">${dog.avgEarly}</span></li>
                    <li><strong>Closing Gain:</strong> <span class="${!isNaN(gainVal) && gainVal === maxGain ? highlightClass : ''}">${dog.avgGain}</span></li>
                    <li><strong>Box Record:</strong> ${dog.boxRecordText}</li>
                </ul>
            </div>
        `;
    }).join('');

    let modalHTML = `
        <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div class="bg-white dark:bg-slate-900 rounded-xl max-w-4xl w-full p-6 shadow-2xl overflow-y-auto max-h-[90vh]">
                <div class="flex justify-between items-center mb-3 border-b pb-3 dark:border-slate-800">
                    <h3 class="text-xl font-bold text-slate-800 dark:text-slate-100">Multi-Runner Comparison (${comparedDogs.length} Dogs)</h3>
                    <button id="h2h-modal-close-x" class="text-slate-500 hover:text-slate-700 font-bold text-lg">&times;</button>
                </div>
                
                <!-- Overall Advantage Banner -->
                <div class="mb-4 p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-lg flex items-center gap-3">
                    <span class="text-2xl">🏆</span>
                    <div>
                        <h4 class="text-xs uppercase font-bold text-emerald-800 dark:text-emerald-300 tracking-wider">Statistical Advantage</h4>
                        <p class="text-sm font-medium text-emerald-900 dark:text-emerald-200">
                            <strong>${advantageDog.name}</strong> holds the overall edge with a composite score of <span class="font-mono">${advantageDog.score.toFixed(1)}</span> and a win probability of <span class="font-mono">${advantageDog.winProb.toFixed(1)}%</span>.
                        </p>
                    </div>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-${comparedDogs.length} gap-4">
                    ${columnsHTML}
                </div>

                <div class="mt-6 flex justify-center gap-3">
                    <button id="h2h-clear-btn" class="bg-rose-100 dark:bg-rose-950/60 hover:bg-rose-200 text-rose-700 px-4 py-2 rounded-lg text-sm font-semibold">🗑️ Clear Selection</button>
                    <button id="h2h-modal-close-btn" class="bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 text-slate-800 dark:text-slate-200 px-5 py-2 rounded-lg text-sm font-semibold">Close Comparison</button>
                </div>
            </div>
        </div>
    `;

    let modalContainer = document.createElement('div');
    modalContainer.id = 'h2h-modal-wrapper';
    modalContainer.innerHTML = modalHTML;
    document.body.appendChild(modalContainer);

    // --- ATTACH CLEAN EVENT LISTENERS ---
    document.getElementById('h2h-modal-close-x').addEventListener('click', closeH2HModal);
    document.getElementById('h2h-modal-close-btn').addEventListener('click', closeH2HModal);
    document.getElementById('h2h-clear-btn').addEventListener('click', clearH2HSelection);
}

// Listen for the Escape key to close the H2H comparison modal
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        let wrapper = document.getElementById('h2h-modal-wrapper');
        if (wrapper) {
            closeH2HModal();
        }
    }
});

document.addEventListener('DOMContentLoaded', () => {
    let compareBtn = document.getElementById('h2h-compare-btn');
    if (compareBtn) {
        compareBtn.addEventListener('click', openH2HComparisonModal);
    }
});

window.closeH2HModal = function() {
    let wrapper = document.getElementById('h2h-modal-wrapper');
    if (wrapper) wrapper.remove();
};

window.clearH2HSelection = function() {
    document.querySelectorAll('.h2h-checkbox').forEach(cb => {
        cb.checked = false;
    });

    selectedH2HDogs = [];
    
    let triggerContainer = document.getElementById('h2h-trigger-container');
    let countSpan = document.getElementById('h2h-count');
    let namesSpan = document.getElementById('h2h-selected-names');
    
    if (countSpan) countSpan.textContent = "0";
    if (namesSpan) namesSpan.textContent = "";
    if (triggerContainer) triggerContainer.classList.add('hidden');

    window.closeH2HModal();
};