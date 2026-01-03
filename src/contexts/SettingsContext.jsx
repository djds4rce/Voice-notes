/**
 * SettingsContext
 * 
 * Centralized settings management with localStorage persistence.
 * Provides settings state and setters to all consuming components.
 */

import { createContext, useContext, useState, useEffect } from 'react';
import { isAppleDevice } from '../utils/deviceDetection';

const SettingsContext = createContext(null);



/**
 * SettingsProvider - Wraps the app to provide settings context
 */
export function SettingsProvider({ children }) {
    // Language setting (persisted to localStorage)
    const [language, setLanguage] = useState(() => {
        const saved = localStorage.getItem('whisper-language');
        return saved || 'en';
    });

    // Whisper model setting (persisted to localStorage)
    // On iOS, validate that the model is compatible (downgrade if necessary)
    const [whisperModel, setWhisperModel] = useState(() => {
        const saved = localStorage.getItem('whisper-model');
        if (saved) return saved;

        // iOS default: use tiny model for better performance/stability
        if (isAppleDevice()) {
            return 'Xenova/whisper-tiny';
        }

        return 'Xenova/whisper-base';
    });

    // Semantic search setting (only available for English)
    const [semanticSearchEnabled, setSemanticSearchEnabled] = useState(() => {
        const saved = localStorage.getItem('semantic-search-enabled');
        return saved !== null ? saved === 'true' : true; // Default enabled
    });

    // Tagging setting (only available for English)
    const [taggingEnabled, setTaggingEnabled] = useState(() => {
        const saved = localStorage.getItem('tagging-enabled');
        return saved !== null ? saved === 'true' : false; // Default disabled
    });

    // Dark mode setting
    const [darkMode, setDarkMode] = useState(() => {
        const saved = localStorage.getItem('dark-mode');
        return saved !== null ? saved === 'true' : false; // Default to light mode
    });

    // Computed value: is the current language English?
    const isEnglish = language === 'en';

    // Persist language changes to localStorage
    useEffect(() => {
        localStorage.setItem('whisper-language', language);
    }, [language]);

    // Persist model changes to localStorage
    useEffect(() => {
        localStorage.setItem('whisper-model', whisperModel);
    }, [whisperModel]);

    // Persist feature settings to localStorage
    useEffect(() => {
        localStorage.setItem('semantic-search-enabled', semanticSearchEnabled);
    }, [semanticSearchEnabled]);

    useEffect(() => {
        localStorage.setItem('tagging-enabled', taggingEnabled);
    }, [taggingEnabled]);

    // Apply dark mode to document and persist
    useEffect(() => {
        localStorage.setItem('dark-mode', darkMode);
        if (darkMode) {
            document.documentElement.setAttribute('data-theme', 'dark');
        } else {
            document.documentElement.removeAttribute('data-theme');
        }
    }, [darkMode]);

    const value = {
        // Language
        language,
        setLanguage,
        // Whisper model
        whisperModel,
        setWhisperModel,
        // Feature toggles
        semanticSearchEnabled,
        setSemanticSearchEnabled,
        taggingEnabled,
        setTaggingEnabled,
        // Appearance
        darkMode,
        setDarkMode,
        // Computed
        isEnglish,
    };

    return (
        <SettingsContext.Provider value={value}>
            {children}
        </SettingsContext.Provider>
    );
}

/**
 * useSettings - Custom hook to consume settings context
 * @returns {Object} Settings state and setters
 */
export function useSettings() {
    const context = useContext(SettingsContext);
    if (!context) {
        throw new Error('useSettings must be used within a SettingsProvider');
    }
    return context;
}

export default SettingsContext;
