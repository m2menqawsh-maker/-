import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initExcelStorage, isExcelStorageReady } from './excelStorage';
import { FilePickerScreen } from './components/auth/FilePickerScreen';
import './index.css';

function Root() {
    const [storageReady, setStorageReady] = React.useState(false);
    const [initializing, setInitializing] = React.useState(true);

    React.useEffect(() => {
        // Try to initialize storage automatically
        const initStorage = async () => {
            try {
                // First check if already ready
                if (isExcelStorageReady()) {
                    setStorageReady(true);
                    setInitializing(false);
                    return;
                }
                
                // Try to initialize (will load saved file handle if available)
                const success = await initExcelStorage();
                
                if (success) {
                    setStorageReady(true);
                } else {
                    // User cancelled or no saved file, show file picker
                    setStorageReady(false);
                }
            } catch (error) {
                console.error('Storage initialization error:', error);
                setStorageReady(false);
            } finally {
                setInitializing(false);
            }
        };
        
        initStorage();
    }, []);

    const handleFileSelected = () => {
        setStorageReady(true);
    };

    if (initializing) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4"></div>
                    <p className="text-gray-600">جارٍ التحميل...</p>
                </div>
            </div>
        );
    }

    if (!storageReady) {
        return <FilePickerScreen onFileSelected={handleFileSelected} />;
    }

    return <App />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <Root />
    </React.StrictMode>
);
