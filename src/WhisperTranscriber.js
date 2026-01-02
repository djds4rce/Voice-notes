import { pipeline } from "@huggingface/transformers";
import { getRecommendedDevice } from "./utils/deviceDetection.js";

/**
 * Device-specific configuration for Whisper model
 * - WebGPU: Use high precision encoder with quantized decoder for GPU acceleration
 * - WASM: Use fully quantized model for CPU efficiency
 * 
 * Note: On Apple devices (iOS/macOS Safari), we force WASM to avoid WebGPU memory leaks.
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
        dtype: "q8",
        device: "wasm",
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
        const targetModel = modelId || this.DEFAULT_MODEL_ID;
        const targetDevice = device || getRecommendedDevice();

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

        // Use pipeline API for automatic speech recognition with word-level timestamps support
        const transcriber = await pipeline(
            "automatic-speech-recognition",
            targetModel,
            {
                dtype: config.dtype,
                device: config.device,
                progress_callback: progressCallback,
            }
        );

        this.currentModelId = targetModel;
        this.currentDevice = targetDevice;
        this.instance = new WhisperTranscriber(transcriber);
        return this.instance;
    }

    async warmup() {
        // Warmup with a tiny audio sample
        const dummyAudio = new Float32Array(16000); // 1 second of silence
        await this.transcriber(dummyAudio, {
            return_timestamps: false,
        });
    }

    /**
     * Transcribe audio to text with word-level timestamps
     * @param {Float32Array} audio - Audio samples at 16kHz
     * @param {string} language - Language code (e.g., "en")
     * @returns {Promise<{text: string, chunks: Array<{text: string, start: number, end: number}>, tps: number}>}
     */
    async transcribe(audio, language) {
        const startTime = performance.now();

        let result;
        let hasWordTimestamps = false;

        try {
            // Try to get word-level timestamps first
            result = await this.transcriber(audio, {
                language,
                return_timestamps: "word",
            });
            hasWordTimestamps = result.chunks && result.chunks.length > 0;
        } catch (e) {
            console.warn("[Whisper] Word timestamps not supported, falling back to segment timestamps:", e.message);
            // Fall back to segment-level timestamps
            result = await this.transcriber(audio, {
                language,
                return_timestamps: true,
            });
        }

        const endTime = performance.now();
        const duration = (endTime - startTime) / 1000;

        // Regex to match special tokens that should be filtered out
        // Matches: [BLANK_AUDIO], [music], (upbeat music), [laughter], etc.
        const specialTokenRegex = /^\s*[\[\(][^\]\)]*[\]\)]\s*$/i;

        // Helper to check if text is a real word (not a special token)
        const isRealWord = (text) => {
            if (!text || text.trim().length === 0) return false;
            // Filter out special tokens in brackets or parentheses
            if (specialTokenRegex.test(text)) return false;
            // Filter out single punctuation or special characters
            if (/^[^\w]+$/.test(text)) return false;
            return true;
        };

        // Clean up text - remove all special tokens
        let text = result.text || "";
        text = text
            .replace(/\[[^\]]*\]/g, "")  // Remove [anything]
            .replace(/\([^)]*\)/g, "")   // Remove (anything) 
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
