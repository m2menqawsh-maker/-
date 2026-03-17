import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initExcelStorage } from './excelStorage';
import { useStorageReady } from './hooks/useAppState';
import FilePickerScreen from './components/auth/FilePickerScreen';

function isFSASupported(): boolean {
    return (
        typeof window !== 'undefined' &&
        'showSaveFilePicker' in window &&
        'showOpenFilePicker' in window
    );
}

const Root: React.FC = () => {
    // picked = user has chosen (or confirmed) a file this session
    const [picked, setPicked] = useState(false);
    // cacheReady = the Excel file has been read into memory
    const cacheReady = useStorageReady();

    // On every mount (including page refresh) try to auto-init.
    // initExcelStorage internally checks IndexedDB for a saved file handle
    // and loads it silently — no picker dialog needed if permission is still valid.
    useEffect(() => {
        initExcelStorage().then((ok) => {
            if (ok) setPicked(true);
            // if not ok (user cancelled picker) we stay on FilePickerScreen
        });
    }, []);

    if (!picked) {
        return (
            <FilePickerScreen
                initFileStorage={initExcelStorage}
                isFSASupported={isFSASupported()}
                onReady={() => setPicked(true)}
            />
        );
    }

    // Wait for cache before mounting App — prevents useState initializers
    // from reading an empty cache
    if (!cacheReady) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-indigo-100 flex items-center justify-center">
                <div className="text-center">
                    <svg className="animate-spin h-10 w-10 mx-auto text-indigo-600 mb-3" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
                    </svg>
                    <p className="text-sm text-indigo-600 font-bold">جاري تحميل البيانات...</p>
                </div>
            </div>
        );
    }

    return <App />;
};

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(<Root />);
