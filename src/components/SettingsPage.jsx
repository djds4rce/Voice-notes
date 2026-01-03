/**
 * SettingsPage
 * 
 * Settings screen with:
 * - Language selection for Whisper transcription
 * - Model size selection for accuracy vs speed tradeoff
 * - Settings managed via SettingsContext
 */

import { useNavigate } from 'react-router-dom';
import { useSettings } from '../contexts/SettingsContext';
import './SettingsPage.css';

// List of supported languages:
// https://help.openai.com/en/articles/7031512-whisper-api-faq
// https://github.com/openai/whisper/blob/248b6cb124225dd263bb9bd32d060b6517e067f8/whisper/tokenizer.py#L79
const LANGUAGES = {
    en: "English",
    zh: "Chinese",
    de: "German",
    es: "Spanish",
    ru: "Russian",
    ko: "Korean",
    fr: "French",
    ja: "Japanese",
    pt: "Portuguese",
    tr: "Turkish",
    pl: "Polish",
    ca: "Catalan",
    nl: "Dutch",
    ar: "Arabic",
    sv: "Swedish",
    it: "Italian",
    id: "Indonesian",
    hi: "Hindi",
    fi: "Finnish",
    vi: "Vietnamese",
    he: "Hebrew",
    uk: "Ukrainian",
    el: "Greek",
    ms: "Malay",
    cs: "Czech",
    ro: "Romanian",
    da: "Danish",
    hu: "Hungarian",
    ta: "Tamil",
    no: "Norwegian",
    th: "Thai",
    ur: "Urdu",
    hr: "Croatian",
    bg: "Bulgarian",
    lt: "Lithuanian",
    la: "Latin",
    mi: "Maori",
    ml: "Malayalam",
    cy: "Welsh",
    sk: "Slovak",
    te: "Telugu",
    fa: "Persian",
    lv: "Latvian",
    bn: "Bengali",
    sr: "Serbian",
    az: "Azerbaijani",
    sl: "Slovenian",
    kn: "Kannada",
    et: "Estonian",
    mk: "Macedonian",
    br: "Breton",
    eu: "Basque",
    is: "Icelandic",
    hy: "Armenian",
    ne: "Nepali",
    mn: "Mongolian",
    bs: "Bosnian",
    kk: "Kazakh",
    sq: "Albanian",
    sw: "Swahili",
    gl: "Galician",
    mr: "Marathi",
    pa: "Punjabi",
    si: "Sinhala",
    km: "Khmer",
    sn: "Shona",
    yo: "Yoruba",
    so: "Somali",
    af: "Afrikaans",
    oc: "Occitan",
    ka: "Georgian",
    be: "Belarusian",
    tg: "Tajik",
    sd: "Sindhi",
    gu: "Gujarati",
    am: "Amharic",
    yi: "Yiddish",
    lo: "Lao",
    uz: "Uzbek",
    fo: "Faroese",
    ht: "Haitian Creole",
    ps: "Pashto",
    tk: "Turkmen",
    nn: "Nynorsk",
    mt: "Maltese",
    sa: "Sanskrit",
    lb: "Luxembourgish",
    my: "Myanmar",
    bo: "Tibetan",
    tl: "Tagalog",
    mg: "Malagasy",
    as: "Assamese",
    tt: "Tatar",
    haw: "Hawaiian",
    ln: "Lingala",
    ha: "Hausa",
    ba: "Bashkir",
    jw: "Javanese",
    su: "Sundanese",
};

// Whisper model sizes with descriptions
// Models from Xenova on HuggingFace
const WHISPER_MODELS = {
    'Xenova/whisper-tiny': {
        name: 'Tiny',
        params: '39M',
        description: 'Fastest, lower accuracy',
    },
    'Xenova/whisper-base': {
        name: 'Base',
        params: '74M',
        description: 'Good balance (recommended)',
    },
    'Xenova/whisper-small': {
        name: 'Small',
        params: '244M',
        description: 'Better accuracy, slower',
    },
    'Xenova/whisper-medium': {
        name: 'Medium',
        params: '769M',
        description: 'Best accuracy, slowest',
    },
};

export function SettingsPage() {
    const navigate = useNavigate();

    // Get all settings from context
    const {
        language,
        setLanguage,
        whisperModel,
        setWhisperModel,
        semanticSearchEnabled,
        setSemanticSearchEnabled,
        taggingEnabled,
        setTaggingEnabled,
        darkMode,
        setDarkMode,
        isEnglish,
    } = useSettings();

    const handleLanguageChange = (e) => {
        setLanguage(e.target.value);
    };

    const handleModelChange = (e) => {
        console.log('[SettingsPage] Model changed to:', e.target.value);
        setWhisperModel(e.target.value);
    };

    return (
        <div className="settings-page">
            {/* Header */}
            <header className="settings-header">
                <button className="back-button" onClick={() => navigate('/')}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M19 12H5M12 19l-7-7 7-7" />
                    </svg>
                </button>
                <h1 className="settings-title">Settings</h1>
                <div className="header-spacer"></div>
            </header>

            {/* Settings Content */}
            <div className="settings-content">


                {/* Language Setting */}
                <div className="settings-section">
                    <div className="setting-item">
                        <div className="setting-info">
                            <h3 className="setting-label">Transcription Language</h3>
                            <p className="setting-description">
                                Choose the language for speech-to-text transcription
                            </p>
                        </div>
                        <select
                            className="language-select"
                            value={language}
                            onChange={handleLanguageChange}
                        >
                            {Object.entries(LANGUAGES).map(([code, name]) => (
                                <option key={code} value={code}>
                                    {name}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* Model Selection */}
                <div className="settings-section">
                    <div className="setting-item setting-item-stacked">
                        <div className="setting-info">
                            <h3 className="setting-label">Whisper Model</h3>
                            <p className="setting-description">
                                Larger models are more accurate but slower to load and run. </p> <p className="setting-description">Changing the model requires reloading. The new model will download on your next recording.</p>
                        </div>
                        <div className="model-options">
                            {Object.entries(WHISPER_MODELS).map(([modelId, model]) => (
                                <label
                                    key={modelId}
                                    className={`model-option ${whisperModel === modelId ? 'selected' : ''}`}
                                >
                                    <input
                                        type="radio"
                                        name="whisperModel"
                                        value={modelId}
                                        checked={whisperModel === modelId}
                                        onChange={handleModelChange}
                                    />
                                    <div className="model-option-content">
                                        <span className="model-name">{model.name}</span>
                                        <span className="model-params">{model.params}</span>
                                        <span className="model-desc">{model.description}</span>
                                    </div>
                                </label>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Feature Toggles */}
                <div className="settings-section">
                    <div className="setting-item">
                        <div className="setting-info">
                            <h3 className="setting-label">Semantic Search</h3>
                            <p className="setting-description">
                                Find notes by meaning, not just keywords
                            </p>
                            {!isEnglish && (
                                <p className="setting-warning">
                                    ⚠️ Only available for English
                                </p>
                            )}
                        </div>
                        <label className={`toggle-switch ${!isEnglish ? 'disabled' : ''}`}>
                            <input
                                type="checkbox"
                                checked={isEnglish && semanticSearchEnabled}
                                onChange={(e) => setSemanticSearchEnabled(e.target.checked)}
                                disabled={!isEnglish}
                            />
                            <span className="toggle-slider"></span>
                        </label>
                    </div>

                    <div className="setting-item">
                        <div className="setting-info">
                            <h3 className="setting-label">Auto-Tagging</h3>
                            <p className="setting-description">
                                Automatically generate tags for your notes
                            </p>
                            {!isEnglish && (
                                <p className="setting-warning">
                                    ⚠️ Only available for English
                                </p>
                            )}
                        </div>
                        <label className={`toggle-switch ${!isEnglish ? 'disabled' : ''}`}>
                            <input
                                type="checkbox"
                                checked={isEnglish && taggingEnabled}
                                onChange={(e) => setTaggingEnabled(e.target.checked)}
                                disabled={!isEnglish}
                            />
                            <span className="toggle-slider"></span>
                        </label>
                    </div>


                </div>
                {/* Appearance Section */}
                <div className="settings-section">
                    <div className="setting-item">
                        <div className="setting-info">
                            <h3 className="setting-label">Dark Mode</h3>
                            <p className="setting-description">
                                Switch between light and dark themes
                            </p>
                        </div>
                        <label className="toggle-switch">
                            <input
                                type="checkbox"
                                checked={darkMode}
                                onChange={(e) => setDarkMode(e.target.checked)}
                            />
                            <span className="toggle-slider"></span>
                        </label>
                    </div>
                </div>
            </div>
        </div >
    );
}

export default SettingsPage;
