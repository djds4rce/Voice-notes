import { getTransformers, isUsingLegacyTransformers } from "./utils/transformerLoader.js";
import { getRecommendedDevice, isAppleDevice } from "./utils/deviceDetection.js";

/**
 * Device-specific configuration for Whisper model
 * - WebGPU: Use high precision encoder with quantized decoder for GPU acceleration
 * - WASM: Use fully quantized model for CPU efficiency (matches whisper-web demo)
 * 
 * Note: On Apple devices (iOS/macOS Safari), we force WASM to avoid WebGPU memory leaks.
 * The whisper-web demo (https://github.com/xenova/whisper-web) works on iOS by using:
 * 1. Explicit quantized: true option
 * 2. no_attentions revision for medium models
 * @see https://github.com/huggingface/transformers.js/issues/1242
 */
const PER_DEVICE_CONFIG = {
    webgpu: {
        dtype: {
            encoder_model: "fp32",
            decoder_model_merged: "q4",
        },
        device: "webgpu",
    },
    wasm: {
        // iOS: Use quantized models to reduce memory footprint (matches whisper-web)
        dtype: "q8",
        device: "wasm",
        quantized: true,
    },
};

/**
 * WhisperTranscriber
 * 
 * Handles loading and running the Whisper model for speech-to-text.
 * Uses the pipeline API to get word-level timestamps for proper local agreement.
 * Singleton pattern ensures model is loaded only once.
 * 
 * Reference: https://huggingface.co/docs/transformers.js/api/pipelines#automaticspeechrecognitionpipeline
 */
export class WhisperTranscriber {
    // Default model - can be overridden via getInstance()
    static DEFAULT_MODEL_ID = "Xenova/whisper-base";

    static instance = null;
    static currentModelId = null;
    static currentDevice = null;
    static transcriber = null;

    constructor(transcriber) {
        this.transcriber = transcriber;
    }

    static async getInstance(progressCallback = null, modelId = null, device = null) {
        // Load the appropriate transformers.js version (v2 for iOS, v3 for others)
        const { pipeline } = await getTransformers();
        const isLegacy = isUsingLegacyTransformers();

        const targetModel = modelId || this.DEFAULT_MODEL_ID;
        const targetDevice = device || getRecommendedDevice(isLegacy);

        // If model or device changed, reset instance
        if (this.instance && (this.currentModelId !== targetModel || this.currentDevice !== targetDevice)) {
            this.instance = null;
            this.transcriber = null;
        }

        if (this.instance) {
            return this.instance;
        }

        // Get device-specific configuration
        const config = PER_DEVICE_CONFIG[targetDevice] || PER_DEVICE_CONFIG.wasm;

        // Determine if we need the no_attentions revision (required for medium models on iOS)
        // This significantly reduces memory usage - matches whisper-web demo behavior
        const needsNoAttentions = targetModel.includes('/whisper-medium') && isAppleDevice();
        const revision = needsNoAttentions ? 'no_attentions' : 'main';

        // Use pipeline API for automatic speech recognition with word-level timestamps support
        // Note: v2 ignores device/dtype options gracefully (uses WASM with default quantization)
        // On iOS: we explicitly pass quantized: true to match the whisper-web demo behavior
        const pipelineOptions = {
            dtype: config.dtype,
            device: config.device,
            quantized: config.quantized,
            progress_callback: progressCallback,
            revision: revision,
        };

        console.log(`[Whisper] Loading model: ${targetModel}, device: ${targetDevice}, revision: ${revision}`);

        const transcriber = await pipeline(
            "automatic-speech-recognition",
            targetModel,
            pipelineOptions
        );

        this.currentModelId = targetModel;
        this.currentDevice = targetDevice;
        this.instance = new WhisperTranscriber(transcriber);
        return this.instance;
    }

    async warmup() {
        // Warmup with multiple passes to fully compile WebGPU shaders
        // Different audio lengths exercise different codepaths
        console.log('[Whisper] Starting warmup...');

        // Pass 1: Short audio (1 second)
        const shortAudio = new Float32Array(16000); // 1 second of silence
        await this.transcriber(shortAudio, { return_timestamps: false });

        // Pass 2: Longer audio (3 seconds) - exercises more attention layers
        const longAudio = new Float32Array(16000 * 3); // 3 seconds
        await this.transcriber(longAudio, { return_timestamps: 'word' });

        console.log('[Whisper] Warmup complete');
    }

    /**
     * Transcribe audio to text with word-level timestamps (WebGPU / Live Recording)
     * @param {Float32Array} audio - Audio samples at 16kHz
     * @param {string} language - Language code (e.g., "en") - ignored for English-only models
     * @returns {Promise<{text: string, chunks: Array<{text: string, start: number, end: number}>, tps: number}>}
     */
    async transcribe(audio, language) {
        const startTime = performance.now();

        let result;
        let hasWordTimestamps = false;

        // English-only models (*.en) don't accept language or task parameters
        const isEnglishOnlyModel = WhisperTranscriber.currentModelId?.endsWith('.en');
        const transcribeOptions = isEnglishOnlyModel
            ? { return_timestamps: "word" }
            : { language, return_timestamps: "word" };

        try {
            // Try to get word-level timestamps first
            result = await this.transcriber(audio, transcribeOptions);
            hasWordTimestamps = result.chunks && result.chunks.length > 0;
        } catch (e) {
            console.warn("[Whisper] Word timestamps not supported, falling back to segment timestamps:", e.message);
            // Fall back to segment-level timestamps
            const fallbackOptions = isEnglishOnlyModel
                ? { return_timestamps: true }
                : { language, return_timestamps: true };
            result = await this.transcriber(audio, fallbackOptions);
        }

        return this._processResult(result, startTime, hasWordTimestamps);
    }

    /**
     * Transcribe full audio with sliding window (iOS / Batch Mode)
     * Matches the demo implementation for long-form audio.
     * @param {Float32Array} audio - Full audio samples at 16kHz
     * @param {string} language - Language code
     */
    async transcribeFull(audio, language) {
        const startTime = performance.now();

        let result;
        const isEnglishOnlyModel = WhisperTranscriber.currentModelId?.endsWith('.en');

        // Options specifically for long-form audio (demo-style)
        // matches https://github.com/xenova/whisper-web/blob/main/src/worker.js
        const options = {
            return_timestamps: true,
            chunk_length_s: 30,
            stride_length_s: 5,
            force_full_sequences: false,
            // Greedy decoding for memory efficiency and speed
            do_sample: false,
            top_k: 0,
            ...(isEnglishOnlyModel ? {} : { language }),
        };

        try {
            console.log('[Whisper] Starting full transcription with options:', options);
            result = await this.transcriber(audio, options);
        } catch (e) {
            console.error("[Whisper] Full transcription error:", e);
            throw e;
        }

        const endTime = performance.now();
        const duration = (endTime - startTime) / 1000;

        // Process segment-level results from long-form transcription
        let text = result.text || "";
        let chunks = [];

        // Simple cleanup
        text = text.trim();

        if (result.chunks) {
            // result.chunks are segments in this mode
            chunks = result.chunks.map(chunk => ({
                text: chunk.text?.trim() || "",
                start: chunk.timestamp?.[0] ?? 0,
                end: chunk.timestamp?.[1] ?? 0,
            }));
        }

        const tps = chunks.length / duration;

        return { text, chunks, tps };
    }

    /**
     * Transcribe full audio optimized for WebGPU (Upload / Batch Mode)
     * Manually splits audio into 30s chunks with overlap for fast processing
     * This is for non-iOS devices only
     * @param {Float32Array} audio - Full audio samples at 16kHz
     * @param {string} language - Language code
     * @param {Function} onProgress - Optional callback for progress updates (0-100)
     */
    async transcribeFullWebGPU(audio, language, onProgress = null) {
        const startTime = performance.now();
        const isEnglishOnlyModel = WhisperTranscriber.currentModelId?.endsWith('.en');
        const SAMPLE_RATE = 16000;

        // Calculate audio duration
        const audioDurationSeconds = audio.length / SAMPLE_RATE;
        console.log(`[Whisper] Audio duration: ${audioDurationSeconds.toFixed(1)}s`);

        const baseOptions = {
            return_timestamps: true,
            ...(isEnglishOnlyModel ? {} : { language }),
        };

        let allText = '';
        let allChunks = [];

        // For short audio (<30s), process directly
        if (audioDurationSeconds <= 30) {
            console.log('[Whisper] Using simple transcription for short audio');
            onProgress?.(50); // Mid-point for short audio
            const result = await this.transcriber(audio, baseOptions);
            allText = result.text || '';
            if (result.chunks) {
                allChunks = result.chunks;
            }
            onProgress?.(100);
        } else {
            // For long audio, manually split into 30s chunks with 5s overlap
            const CHUNK_LENGTH_S = 30;
            const OVERLAP_S = 5;
            const CHUNK_SAMPLES = CHUNK_LENGTH_S * SAMPLE_RATE;
            const STRIDE_SAMPLES = (CHUNK_LENGTH_S - OVERLAP_S) * SAMPLE_RATE;

            console.log(`[Whisper] Splitting into ${CHUNK_LENGTH_S}s chunks with ${OVERLAP_S}s overlap`);

            let offset = 0;
            let chunkIndex = 0;
            let prevEndTime = 0;  // Track where previous chunk ended for deduplication

            // Calculate total chunks for progress
            const totalChunks = Math.ceil((audio.length - CHUNK_SAMPLES) / STRIDE_SAMPLES) + 1;

            while (offset < audio.length) {
                const end = Math.min(offset + CHUNK_SAMPLES, audio.length);
                const chunkAudio = audio.slice(offset, end);

                // Report progress
                const progress = Math.round((chunkIndex / totalChunks) * 100);
                onProgress?.(progress);

                console.log(`[Whisper] Processing chunk ${chunkIndex + 1}/${totalChunks} (${(offset / SAMPLE_RATE).toFixed(1)}s - ${(end / SAMPLE_RATE).toFixed(1)}s)`);

                const result = await this.transcriber(chunkAudio, baseOptions);
                const timeOffset = offset / SAMPLE_RATE;

                if (result.text && result.chunks) {
                    for (const chunk of result.chunks) {
                        const segStart = (chunk.timestamp?.[0] ?? 0);
                        const segEnd = (chunk.timestamp?.[1] ?? 0);
                        const globalStart = segStart + timeOffset;
                        const globalEnd = segEnd + timeOffset;

                        // Skip segments whose center point is before the previous end time
                        // This allows partial overlaps while avoiding full duplicates
                        const segCenter = (globalStart + globalEnd) / 2;
                        if (chunkIndex > 0 && segCenter < prevEndTime) {
                            continue;
                        }

                        // Add to text
                        const segText = (chunk.text || '').trim();
                        if (segText) {
                            if (allText && !allText.endsWith(' ')) {
                                allText += ' ';
                            }
                            allText += segText;
                        }

                        // Add to chunks with global timestamps
                        allChunks.push({
                            ...chunk,
                            timestamp: [globalStart, globalEnd]
                        });

                        // Update prevEndTime
                        prevEndTime = Math.max(prevEndTime, globalEnd);
                    }
                } else if (result.text) {
                    // Fallback if no chunks returned - just append text
                    if (allText && !allText.endsWith(' ')) {
                        allText += ' ';
                    }
                    allText += result.text.trim();
                    // Estimate end time for text without chunks
                    prevEndTime = (end / SAMPLE_RATE);
                }

                offset += STRIDE_SAMPLES;
                chunkIndex++;
            }
        }

        const endTime = performance.now();
        const duration = (endTime - startTime) / 1000;
        console.log(`[Whisper] Transcription completed in ${duration.toFixed(2)}s`);

        // Process chunks into word-level timestamps
        let chunks = [];
        const text = allText.trim();

        if (allChunks && allChunks.length > 0) {
            // Segment-level: split into words with estimated times
            for (const segment of allChunks) {
                const words = (segment.text || "").trim().split(/\s+/).filter(w => w.length > 0);
                const segStart = segment.timestamp?.[0] ?? 0;
                const segEnd = segment.timestamp?.[1] ?? 0;
                const wordDuration = words.length > 0 ? (segEnd - segStart) / words.length : 0;

                words.forEach((word, i) => {
                    chunks.push({
                        text: word,
                        start: segStart + i * wordDuration,
                        end: segStart + (i + 1) * wordDuration,
                    });
                });
            }
        }

        const tps = chunks.length / duration;

        return { text, chunks, tps };
    }

    _processResult(result, startTime, hasWordTimestamps) {
        // ... (existing helper remains for normal mode)
        const endTime = performance.now();
        const duration = (endTime - startTime) / 1000;

        // Regex to match special tokens that should be filtered out
        const specialTokenRegex = /^\s*[\[\(][^\]\)]*[\]\)]\s*$/i;

        // Helper to check if text is a real word (not a special token)
        const isRealWord = (text) => {
            if (!text || text.trim().length === 0) return false;
            if (specialTokenRegex.test(text)) return false;
            if (/^[^\w]+$/.test(text)) return false;
            return true;
        };

        // Clean up text - remove all special tokens
        let text = result.text || "";
        text = text
            .replace(/\[[^\]]*\]/g, "")
            .replace(/\([^)]*\)/g, "")
            .replace(/\s+/g, " ")
            .trim();

        // Convert to chunks with start/end times
        let chunks = [];

        if (hasWordTimestamps && result.chunks) {
            // Word-level timestamps: [{text: " And", timestamp: [0, 0.78]}, ...]
            chunks = result.chunks
                .map(chunk => ({
                    text: chunk.text?.trim() || "",
                    start: chunk.timestamp?.[0] ?? 0,
                    end: chunk.timestamp?.[1] ?? 0,
                }))
                .filter(chunk => isRealWord(chunk.text));
        } else if (result.chunks) {
            // Segment-level timestamps: split into words with estimated times
            chunks = [];
            for (const segment of result.chunks) {
                const words = (segment.text || "").trim().split(/\s+/).filter(w => isRealWord(w));
                const segStart = segment.timestamp?.[0] ?? 0;
                const segEnd = segment.timestamp?.[1] ?? 0;
                const wordDuration = words.length > 0 ? (segEnd - segStart) / words.length : 0;

                words.forEach((word, i) => {
                    chunks.push({
                        text: word,
                        start: segStart + i * wordDuration,
                        end: segStart + (i + 1) * wordDuration,
                    });
                });
            }
        } else {
            // No timestamps at all - estimate based on text
            const words = text.split(/\s+/).filter(w => isRealWord(w));
            const wordDuration = 0.3;
            chunks = words.map((word, i) => ({
                text: word,
                start: i * wordDuration,
                end: (i + 1) * wordDuration,
            }));
        }

        const tps = chunks.length / duration;

        return { text, chunks, tps };
    }
}
