/**
 * excelStorage.ts
 * ─────────────────────────────────────────────
 * Replaces JSON file storage with Excel-based storage.
 * Uses XLSX library to read/write data to Excel file.
 *
 * How it works:
 *   1. On first launch, user picks (or creates) an Excel file
 *   2. Each storage key becomes a separate worksheet in the Excel file
 *   3. Data is stored in table format with proper headers
 *   4. Reads/writes are cached in memory for performance
 *   5. Writes are debounced to prevent excessive file operations
 */

import * as XLSX from 'xlsx';

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const FILE_NAME = 'coma_data.xlsx';
const DEBOUNCE_MS = 800;

// Storage keys configuration - each key maps to a worksheet
const STORAGE_KEYS = [
    'cw_ledger',
    'cw_sessions',
    'cw_records',
    'cw_expenses',
    'cw_purchases',
    'cw_period_lock',
    'cw_audit_logs',
    'cw_settings',
    'cw_customers',
    'cw_users',
    'cw_inventory_items',
    'cw_bank_accounts',
    'cw_drinks',
    'cw_internet_cards',
    'cw_place_loans',
    'cw_partner_debts_list',
    'cw_cash_transfers',
    'cw_system_state',
    'cw_day_cycles',
    'cw_monthly_archives',
    'cw_daily_closings',
    'cw_inventory_snapshots',
    'cw_pricing',
    'cw_saving_plans',
    'cw_saving_goals'
];

// ─── INTERNAL STATE ───────────────────────────────────────────────────────────
let fileHandle: FileSystemFileHandle | null = null;
let cache: Record<string, string> = {};
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let autoSaveTimer: ReturnType<typeof setInterval> | null = null;
let initialised = false;
let useFallback = false;

// ─── READY SIGNAL: subscribers are notified once cache is populated ──────────
let cacheReadyResolve: (() => void) | null = null;
let cacheReadyPromise: Promise<void> = new Promise<void>((resolve) => {
    cacheReadyResolve = resolve;
});

/**
 * Returns a promise that resolves only after the Excel file has been read
 * into the in-memory cache (or fallback mode is active).
 * Components should await this before reading any keys.
 */
export function waitForCacheReady(): Promise<void> {
    return cacheReadyPromise;
}

function signalCacheReady(): void {
    if (cacheReadyResolve) {
        cacheReadyResolve();
        cacheReadyResolve = null; // one-shot
    }
}

// Store file handle in IndexedDB for persistence across page reloads
const FILE_HANDLE_DB_NAME = 'coma_excel_storage';
const FILE_HANDLE_STORE_NAME = 'fileHandle';
const FILE_HANDLE_KEY = 'excelFileHandle';
const AUTO_SAVE_INTERVAL = 30000; // Auto-save every 30 seconds

// ─── FALLBACK (localStorage) ─────────────────────────────────────────────────
function isFSASupported(): boolean {
    return (
        typeof window !== 'undefined' &&
        'showSaveFilePicker' in window &&
        'showOpenFilePicker' in window
    );
}

// ─── INDEXEDDB HELPERS FOR FILE HANDLE PERSISTENCE ──────────────────────────
async function saveFileHandleToDB(handle: FileSystemFileHandle): Promise<void> {
    try {
        const db = await openDB();
        const tx = db.transaction(FILE_HANDLE_STORE_NAME, 'readwrite');
        const store = tx.objectStore(FILE_HANDLE_STORE_NAME);
        await store.put(handle, FILE_HANDLE_KEY);
        await tx.complete;
    } catch (e) {
        console.error('Error saving file handle to IndexedDB:', e);
    }
}

async function loadFileHandleFromDB(): Promise<FileSystemFileHandle | null> {
    try {
        const db = await openDB();
        const tx = db.transaction(FILE_HANDLE_STORE_NAME, 'readonly');
        const store = tx.objectStore(FILE_HANDLE_STORE_NAME);
        const handle = await store.get(FILE_HANDLE_KEY);
        await tx.complete;
        
        // Verify we still have permission to access the file
        if (handle) {
            const permission = await verifyPermission(handle);
            if (permission) {
                return handle;
            }
        }
        return null;
    } catch (e) {
        console.error('Error loading file handle from IndexedDB:', e);
        return null;
    }
}

function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(FILE_HANDLE_DB_NAME, 1);
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        
        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(FILE_HANDLE_STORE_NAME)) {
                db.createObjectStore(FILE_HANDLE_STORE_NAME);
            }
        };
    });
}

async function verifyPermission(handle: FileSystemFileHandle): Promise<boolean> {
    const options: any = { mode: 'readwrite' };
    
    // Check if permission was already granted
    if ((await handle.queryPermission(options)) === 'granted') {
        return true;
    }
    
    // Request permission
    if ((await handle.requestPermission(options)) === 'granted') {
        return true;
    }
    
    return false;
}

// ─── EXCEL UTILITIES ─────────────────────────────────────────────────────────

/**
 * Convert Excel workbook to cache format
 */
function workbookToCache(workbook: XLSX.WorkBook): Record<string, string> {
    const newCache: Record<string, string> = {};
    
    workbook.SheetNames.forEach(sheetName => {
        const worksheet = workbook.Sheets[sheetName];
        
        // Convert worksheet to JSON
        const data = XLSX.utils.sheet_to_json(worksheet, { defval: null });
        
        // Store as JSON string in cache
        if (data && data.length > 0) {
            newCache[sheetName] = JSON.stringify(data);
        } else {
            // Check if it's a single-object sheet (like pricing or system_state)
            const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
            if (range.e.r === 1 && range.e.c > 0) {
                // This is likely a key-value pair sheet
                const kvData: any = {};
                for (let C = 0; C <= range.e.c; C++) {
                    const keyCell = worksheet[XLSX.utils.encode_cell({ r: 0, c: C })];
                    const valueCell = worksheet[XLSX.utils.encode_cell({ r: 1, c: C })];
                    if (keyCell && keyCell.v) {
                        kvData[keyCell.v] = valueCell ? valueCell.v : null;
                    }
                }
                if (Object.keys(kvData).length > 0) {
                    newCache[sheetName] = JSON.stringify(kvData);
                }
            } else {
                newCache[sheetName] = JSON.stringify([]);
            }
        }
    });
    
    return newCache;
}

/**
 * Convert cache to Excel workbook
 */
function cacheToWorkbook(): XLSX.WorkBook {
    const workbook = XLSX.utils.book_new();
    
    STORAGE_KEYS.forEach(key => {
        const dataString = cache[key];
        if (!dataString) return;
        
        try {
            const data = JSON.parse(dataString);
            let worksheet: XLSX.WorkSheet;
            
            if (Array.isArray(data)) {
                // Array data - create table
                if (data.length === 0) {
                    worksheet = XLSX.utils.aoa_to_sheet([['No Data']]);
                } else {
                    worksheet = XLSX.utils.json_to_sheet(data);
                }
            } else {
                // Object data (like settings) - create key-value pairs
                const keys = Object.keys(data);
                const values = Object.values(data);
                worksheet = XLSX.utils.aoa_to_sheet([keys, values]);
            }
            
            // Add worksheet to workbook
            XLSX.utils.book_append_sheet(workbook, worksheet, key);
        } catch (e) {
            console.error(`Failed to convert ${key} to worksheet:`, e);
        }
    });
    
    return workbook;
}

// ─── CORE: read Excel file into cache ────────────────────────────────────────
async function readFileIntoCache(): Promise<void> {
    if (!fileHandle) return;
    
    try {
        const file = await fileHandle.getFile();
        const arrayBuffer = await file.arrayBuffer();
        
        if (arrayBuffer.byteLength === 0) {
            cache = {};
            return;
        }
        
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        cache = workbookToCache(workbook);
        
    } catch (e) {
        console.error('Error reading Excel file:', e);
        cache = {};
    }
}

// ─── CORE: flush cache to Excel file ─────────────────────────────────────────
async function flush(): Promise<void> {
    if (!fileHandle) {
        console.warn('[excelStorage] Cannot flush: no file handle');
        return;
    }
    
    console.log('[excelStorage] Starting flush to Excel file...');
    
    try {
        const workbook = cacheToWorkbook();
        
        // Write to ArrayBuffer
        const excelBuffer = XLSX.write(workbook, { 
            bookType: 'xlsx', 
            type: 'array',
            cellStyles: true 
        });
        
        console.log('[excelStorage] Workbook created, writing to file...');
        
        // Write to file
        const writable = await fileHandle.createWritable();
        await writable.write(excelBuffer);
        await writable.close();
        
        console.log('[excelStorage] ✅ Flush completed successfully');
        // Clear dirty flag
        if (typeof window !== 'undefined' && (window as any).__excelStorageDirty) {
            (window as any).__excelStorageDirty.clear();
        }
        
    } catch (e) {
        console.error('[excelStorage] ❌ Error writing Excel file:', e);
        throw e;
    }
}

// ─── DEBOUNCED flush ─────────────────────────────────────────────────────────
function scheduleSave(): void {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => flush(), DEBOUNCE_MS);
}

// ─── AUTO-SAVE ───────────────────────────────────────────────────────────────
function startAutoSave(): void {
    if (autoSaveTimer) clearInterval(autoSaveTimer);
    autoSaveTimer = setInterval(() => {
        if (!useFallback && fileHandle) {
            flush().catch(err => console.error('Auto-save error:', err));
        }
    }, AUTO_SAVE_INTERVAL);
}

function stopAutoSave(): void {
    if (autoSaveTimer) {
        clearInterval(autoSaveTimer);
        autoSaveTimer = null;
    }
}

// ─── PUBLIC: initialise ──────────────────────────────────────────────────────
let initPromise: Promise<boolean> | null = null;

export async function initExcelStorage(): Promise<boolean> {
    // Already done
    if (initialised) return true;
    // Already in-flight — return the same promise so callers don't race
    if (initPromise) return initPromise;

    initPromise = _doInit();
    try {
        return await initPromise;
    } finally {
        // Clear so a future retry is possible if it failed
        if (!initialised) initPromise = null;
    }
}

async function _doInit(): Promise<boolean> {
    if (!isFSASupported()) {
        useFallback = true;
        initialised = true;
        signalCacheReady(); // ← fallback uses localStorage directly, always ready
        console.warn('[excelStorage] File System Access API not supported — falling back to localStorage.');
        return true;
    }
    
    try {
        // First, try to load previously saved file handle
        const savedHandle = await loadFileHandleFromDB();
        
        if (savedHandle) {
            console.log('[excelStorage] Found saved file handle, loading data...');
            fileHandle = savedHandle;
            await readFileIntoCache();
            initialised = true;
            signalCacheReady(); // ← cache is now populated
            startAutoSave();
            return true;
        }
        
        // No saved handle, prompt user to select file
        const options = {
            types: [{
                description: 'Co\'Ma Excel Database',
                accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] }
            }],
            multiple: false
        };
        
        try {
            // Try to open existing file
            const [handle] = await (window as any).showOpenFilePicker(options);
            fileHandle = handle;
            await readFileIntoCache();
            
            // Save the handle for future sessions
            await saveFileHandleToDB(handle);
            
        } catch (openErr: any) {
            if (openErr.name === 'AbortError') {
                // Create new file
                fileHandle = await (window as any).showSaveFilePicker({
                    suggestedName: FILE_NAME,
                    types: options.types
                });
                
                // Initialize with empty data structure
                STORAGE_KEYS.forEach(key => {
                    cache[key] = JSON.stringify([]);
                });
                
                // Create initial Excel file
                await flush();
                
                // Save the handle for future sessions
                await saveFileHandleToDB(fileHandle);
            } else {
                throw openErr;
            }
        }
        
        initialised = true;
        signalCacheReady(); // ← cache is now populated (new file or opened file)
        
        // Start auto-save timer
        if (!useFallback && fileHandle) {
            startAutoSave();
        }
        
        return true;
        
    } catch (err: any) {
        if (err.name === 'AbortError') {
            return false;
        }
        console.error('[excelStorage] init error', err);
        return false;
    }
}

// ─── PUBLIC: check if ready ──────────────────────────────────────────────────
export function isExcelStorageReady(): boolean {
    return initialised;
}

export function isInFallbackMode(): boolean {
    return useFallback;
}

// ─── PUBLIC API (drop-in replacement for fileStorage) ───────────────────────
export function excelGet(key: string): string | null {
    if (useFallback) return localStorage.getItem(key);
    return cache[key] ?? null;
}

export function excelSet(key: string, value: string): void {
    if (useFallback) {
        localStorage.setItem(key, value);
        return;
    }
    
    console.log(`[excelStorage] Setting ${key} (${value.length} chars)`);
    cache[key] = value;
    // Mark dirty so beforeunload knows there's pending data
    if (typeof window !== 'undefined' && (window as any).__excelStorageDirty) {
        (window as any).__excelStorageDirty.set();
    }
    scheduleSave();
}

export function excelRemove(key: string): void {
    if (useFallback) {
        localStorage.removeItem(key);
        return;
    }
    delete cache[key];
    scheduleSave();
}

export async function excelFlushNow(): Promise<void> {
    if (useFallback) return;
    if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
    }
    await flush();
}

export function getExcelFileName(): string {
    if (useFallback) return 'localStorage (fallback)';
    return fileHandle?.name ?? FILE_NAME;
}

// Clear saved file handle (allows user to select a different file)
export async function clearSavedFileHandle(): Promise<void> {
    stopAutoSave();
    try {
        const db = await openDB();
        const tx = db.transaction(FILE_HANDLE_STORE_NAME, 'readwrite');
        const store = tx.objectStore(FILE_HANDLE_STORE_NAME);
        await store.delete(FILE_HANDLE_KEY);
        await tx.complete;
        fileHandle = null;
        cache = {};
        initialised = false;
    } catch (e) {
        console.error('Error clearing saved file handle:', e);
    }
}

// ─── LIFECYCLE: flush before tab closes ─────────────────────────────────────
if (typeof window !== 'undefined') {
    // Track whether there are unflushed changes
    let dirty = false;

    window.addEventListener('beforeunload', (e) => {
        if (!useFallback && fileHandle && dirty) {
            // Cancel pending timers
            if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
            stopAutoSave();

            // Synchronous-compatible: build buffer and fire-and-forget flush.
            // Modern browsers DO allow a short async window in beforeunload
            // if we call preventDefault, but the safest path is to just try.
            const workbook = cacheToWorkbook();
            const excelBuffer = XLSX.write(workbook, {
                bookType: 'xlsx',
                type: 'array',
                cellStyles: true
            });

            // Fire the write. The browser may or may not wait for it.
            if (fileHandle) {
                fileHandle.createWritable({ keepExistingFile: false }).then(async (writable) => {
                    await writable.write(excelBuffer);
                    await writable.close();
                    dirty = false;
                }).catch(err => console.error('Flush error on unload:', err));
            }

            // Ask the browser to wait (shows dialog on some browsers)
            e.preventDefault();
            e.returnValue = '';
        }
    });

    // Flush immediately when tab becomes hidden (most reliable signal)
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && !useFallback && fileHandle) {
            if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
            flush().then(() => { dirty = false; }).catch(err => console.error('Flush error on visibility change:', err));
        }
    });

    // Expose dirty tracker so excelSet can mark it
    (window as any).__excelStorageDirty = { set: () => { dirty = true; }, clear: () => { dirty = false; } };
}

// ─── MIGRATION: Convert existing JSON to Excel ──────────────────────────────
export async function migrateFromJsonToExcel(jsonData: Record<string, any>): Promise<void> {
    STORAGE_KEYS.forEach(key => {
        if (jsonData[key]) {
            cache[key] = JSON.stringify(jsonData[key]);
        }
    });
    await flush();
}
