/**
 * ModelManager - Centralized Singleton for All AI Models
 * 
 * Encapsulates and manages:
 * - Whisper (speech-to-text)
 * - Embedding model (semantic search)
 * - TopicGenerator (tag generation)
 * 
 * Key Features:
 * - Single point of access for all models
 * - Automatic English-only Whisper model selection when language is 'en'
 * - Lazy loading with shared progress tracking
 * - Device-aware configuration (WebGPU vs WASM)
 */

import { WhisperTranscriber } from '../WhisperTranscriber.js';
import EmbeddingService from './EmbeddingService.js';
import { TopicGenerator } from '../TopicGenerator.js';
import { getRecommendedDevice } from '../utils/deviceDetection.js';

/**
 * English-only Whisper models are smaller and faster for English transcription.
 * Maps base model to its English-only variant.
 */
const ENGLISH_ONLY_WHISPER_MODELS = {
    'Xenova/whisper-tiny': 'Xenova/whisper-tiny.en',
    'Xenova/whisper-base': 'Xenova/whisper-base.en',
    'Xenova/whisper-small': 'Xenova/whisper-small.en',
    'Xenova/whisper-medium': 'Xenova/whisper-medium.en',
    // Large models don't have English-only variants
    'Xenova/whisper-large': 'Xenova/whisper-large',
    'Xenova/whisper-large-v2': 'Xenova/whisper-large-v2',
    'Xenova/whisper-large-v3': 'Xenova/whisper-large-v3',
};

class ModelManager {
    static instance = null;

    constructor() {
        // Model instances (managed by their own singleton patterns)
        this._whisperInstance = null;
        this._embeddingInstance = null;
        this._topicGeneratorInstance = null;

        // Current configuration
        this._currentDevice = null;
        this._currentWhisperModel = null;
        this._currentLanguage = null;

        // Loading states
        this._loadingWhisper = false;
        this._loadingEmbedding = false;
        this._loadingTopicGenerator = false;
    }

    /**
     * Get the singleton instance of ModelManager
     */
    static getInstance() {
        if (!ModelManager.instance) {
            ModelManager.instance = new ModelManager();
        }
        return ModelManager.instance;
    }

    /**
     * Get the recommended Whisper model based on language.
     * For English, returns the English-only variant if available.
     * 
     * @param {string} baseModel - Base model ID (e.g., 'Xenova/whisper-base')
     * @param {string} language - Language code (e.g., 'en', 'es')
     * @returns {string} - Optimal model ID for the language
     */
    getOptimalWhisperModel(baseModel, language) {
        if (language === 'en' && ENGLISH_ONLY_WHISPER_MODELS[baseModel]) {
            return ENGLISH_ONLY_WHISPER_MODELS[baseModel];
        }
        return baseModel;
    }

    /**
     * Get or load the Whisper transcriber
     * 
     * @param {Function} progressCallback - Progress callback for model loading
     * @param {string} modelId - Base model ID
     * @param {string} language - Language code for English-only optimization
     * @param {string} device - Target device ('webgpu' or 'wasm')
     * @returns {Promise<WhisperTranscriber>}
     */
    async getWhisper(progressCallback = null, modelId = null, language = 'en', device = null) {
        const targetDevice = device || getRecommendedDevice();
        const baseModel = modelId || 'Xenova/whisper-base';
        const optimalModel = this.getOptimalWhisperModel(baseModel, language);

        // Check if we need to reload (model or language changed)
        const needsReload = !this._whisperInstance ||
            this._currentWhisperModel !== optimalModel ||
            this._currentDevice !== targetDevice;

        if (needsReload && !this._loadingWhisper) {
            this._loadingWhisper = true;
            try {
                this._whisperInstance = await WhisperTranscriber.getInstance(
                    progressCallback,
                    optimalModel,
                    targetDevice
                );
                this._currentWhisperModel = optimalModel;
                this._currentDevice = targetDevice;
                this._currentLanguage = language;
            } finally {
                this._loadingWhisper = false;
            }
        }

        return this._whisperInstance;
    }

    /**
     * Get or load the Embedding service
     * 
     * @param {Function} progressCallback - Progress callback for model loading
     * @param {string} device - Target device ('webgpu' or 'wasm')
     * @returns {Promise<EmbeddingService>}
     */
    async getEmbedding(progressCallback = null, device = null) {
        const targetDevice = device || getRecommendedDevice();

        if (!this._loadingEmbedding) {
            this._loadingEmbedding = true;
            try {
                this._embeddingInstance = await EmbeddingService.getInstance(
                    progressCallback,
                    targetDevice
                );
            } finally {
                this._loadingEmbedding = false;
            }
        }

        return this._embeddingInstance;
    }

    /**
     * Get or load the TopicGenerator
     * 
     * @param {Function} progressCallback - Progress callback for model loading
     * @param {string} device - Target device ('webgpu' or 'wasm')
     * @returns {Promise<TopicGenerator>}
     */
    async getTopicGenerator(progressCallback = null, device = null) {
        const targetDevice = device || getRecommendedDevice();

        if (!this._loadingTopicGenerator) {
            this._loadingTopicGenerator = true;
            try {
                this._topicGeneratorInstance = await TopicGenerator.getInstance(
                    progressCallback,
                    targetDevice
                );
            } finally {
                this._loadingTopicGenerator = false;
            }
        }

        return this._topicGeneratorInstance;
    }

    /**
     * Preload all models in the background
     * 
     * @param {Object} options - Preload options
     * @param {Function} options.progressCallback - Progress callback
     * @param {string} options.whisperModel - Whisper model ID
     * @param {string} options.language - Language code
     * @param {boolean} options.loadEmbedding - Whether to load embedding model
     * @param {boolean} options.loadTopicGenerator - Whether to load topic generator
     * @param {string} options.device - Target device
     */
    async preloadAll({
        progressCallback = null,
        whisperModel = 'Xenova/whisper-base',
        language = 'en',
        loadEmbedding = false,
        loadTopicGenerator = false,
        device = null,
    } = {}) {
        const targetDevice = device || getRecommendedDevice();

        // Load models in parallel where possible
        const promises = [
            this.getWhisper(progressCallback, whisperModel, language, targetDevice),
        ];

        if (loadEmbedding) {
            promises.push(this.getEmbedding(progressCallback, targetDevice));
        }

        if (loadTopicGenerator) {
            promises.push(this.getTopicGenerator(progressCallback, targetDevice));
        }

        await Promise.all(promises);
    }

    /**
     * Check if Whisper is loaded
     */
    isWhisperLoaded() {
        return this._whisperInstance !== null;
    }

    /**
     * Check if Embedding is loaded
     */
    isEmbeddingLoaded() {
        return this._embeddingInstance !== null;
    }

    /**
     * Check if TopicGenerator is loaded
     */
    isTopicGeneratorLoaded() {
        return this._topicGeneratorInstance !== null;
    }

    /**
     * Get current Whisper model ID
     */
    getCurrentWhisperModel() {
        return this._currentWhisperModel;
    }

    /**
     * Get current device
     */
    getCurrentDevice() {
        return this._currentDevice;
    }

    /**
     * Reset all model instances (useful for testing or cleanup)
     */
    reset() {
        this._whisperInstance = null;
        this._embeddingInstance = null;
        this._topicGeneratorInstance = null;
        this._currentDevice = null;
        this._currentWhisperModel = null;
        this._currentLanguage = null;
    }
}

export default ModelManager;
