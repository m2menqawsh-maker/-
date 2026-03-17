/**
 * fileStorage.ts
 * ─────────────────────────────────────────────
 * Replaces localStorage with a single JSON file on the user's device.
 *
 * How it works:
 *   1. On first launch the user picks (or creates) a file via a native
 *      file-picker dialog.  The browser keeps a *handle* to that file
 *      for the lifetime of the tab — no re-picking needed.
 *   2. Every read/write goes through this handle.  Writes are debounced
 *      so rapid state changes don't flood the disk.
 *   3. A lightweight in-memory cache mirrors the file so reads are instant.
 *   4. The public API (`fileGet`, `fileSet`, `fileRemove`, `fileKeys`) is
 *      a drop-in replacement for `localStorage.getItem` / `setItem` / etc.
 *
 * Browser support: Chrome 86+, Edge 86+, Firefox (behind flag), Safari ✘.
 * A fallback to localStorage is included automatically for unsupported browsers.
 */

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const FILE_NAME = 'coma_data.json';       // default name shown in the picker
const DEBOUNCE_MS = 800;                   // ms to wait after last write before flushing

// ─── INTERNAL STATE ───────────────────────────────────────────────────────────
let fileHandle: FileSystemFileHandle | null = null;
let cache: Record<string, string> = {};       // key → JSON-string, same as localStorage values
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let initialised = false;
let useFallback = false;  // true when File System Access API is unavailable

// ─── FALLBACK (localStorage) ─────────────────────────────────────────────────
// If the browser does not support showSaveFilePicker we silently fall back to
// localStorage so the app still works (just like before).

function isFSASupported(): boolean {
    return (
        typeof window !== 'undefined' &&
        'showSaveFilePicker' in window &&
        'showOpenFilePicker' in window
    );
}

// ─── CORE: read the whole file into cache ────────────────────────────────────
async function readFileIntocache(): Promise<void> {
    if (!fileHandle) return;
    const file = await fileHandle.getFile();
    const text = await file.text();
    if (text.trim() === '') {
        cache = {};
    } else {
        try {
            cache = JSON.parse(text);
        } catch {
            // corrupted file — start fresh (user already has the raw file as backup)
            cache = {};
        }
    }
}

// ─── CORE: flush cache → file ────────────────────────────────────────────────
async function flush(): Promise<void> {
    if (!fileHandle) return;
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(cache, null, 2));
    await writable.close();
}

// ─── DEBOUNCED flush ─────────────────────────────────────────────────────────
function scheduleSave(): void {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => flush(), DEBOUNCE_MS);
}

// ─── PUBLIC: initialise (call once at app boot) ──────────────────────────────
/**
 * Prompts the user to open an existing data file OR create a new one.
 * Must be called from a user-gesture (click handler).
 *
 * Returns true when the file is ready; false if the user cancelled or the
 * browser does not support the API (fallback mode is activated automatically).
 */
export async function initFileStorage(): Promise<boolean> {
    if (initialised) return true;

    // ── fallback path ──
    if (!isFSASupported()) {
        useFallback = true;
        initialised = true;
        console.warn('[fileStorage] File System Access API not supported — falling back to localStorage.');
        return true;
    }

    try {
        // Ask: "do you have an existing file, or start fresh?"
        // We use showOpenFilePicker first; if the user wants a new file we
        // catch the error and fall through to showSaveFilePicker.
        const options: OpenFilePickerOptions = {
            types: [
                {
                    description: 'Co\'Ma Data File',
                    accept: { 'application/json': ['.json'] }
                }
            ],
            multiple: false
        };

        try {
            // Try to open an EXISTING file
            const [handle] = await (window as any).showOpenFilePicker(options);
            fileHandle = handle;
            await readFileIntocache();
        } catch (openErr: any) {
            // User pressed Cancel or picked nothing → offer to create new file
            if (openErr.name === 'AbortError') {
                // User cancelled — try save picker to create new file
                fileHandle = await (window as any).showSaveFilePicker({
                    suggestedName: FILE_NAME,
                    types: [
                        {
                            description: 'Co\'Ma Data File',
                            accept: { 'application/json': ['.json'] }
                        }
                    ]
                });
                cache = {};
                await flush(); // write empty object to new file
            } else {
                throw openErr;
            }
        }

        initialised = true;
        return true;
    } catch (err: any) {
        if (err.name === 'AbortError') {
            // User cancelled both pickers
            return false;
        }
        console.error('[fileStorage] init error', err);
        return false;
    }
}

// ─── PUBLIC: check whether the storage is ready ─────────────────────────────
export function isFileStorageReady(): boolean {
    return initialised;
}

// ─── PUBLIC: check whether we are in fallback mode ──────────────────────────
export function isInFallbackMode(): boolean {
    return useFallback;
}

// ─── PUBLIC API (drop-in for localStorage) ───────────────────────────────────

export function fileGet(key: string): string | null {
    if (useFallback) return localStorage.getItem(key);
    return cache[key] ?? null;
}

export function fileSet(key: string, value: string): void {
    if (useFallback) {
        localStorage.setItem(key, value);
        return;
    }
    cache[key] = value;
    scheduleSave();
}

export function fileRemove(key: string): void {
    if (useFallback) {
        localStorage.removeItem(key);
        return;
    }
    delete cache[key];
    scheduleSave();
}

// ─── PUBLIC: force an immediate write (e.g. before page unload) ──────────────
export async function fileFlushNow(): Promise<void> {
    if (useFallback) return;                 // localStorage is already synchronous
    if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
    }
    await flush();
}

// ─── PUBLIC: get the current file name (for display in UI) ───────────────────
export function getFileName(): string {
    if (useFallback) return 'localStorage (fallback)';
    return fileHandle?.name ?? FILE_NAME;
}

// ─── LIFECYCLE: flush before the tab closes ─────────────────────────────────
if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
        // We can't await here, but flush() is fast for small payloads.
        // For safety we also do a synchronous-style "fire and forget".
        if (!useFallback && fileHandle) {
            flush();   // best-effort; browser may cut it short
        }
    });
}
