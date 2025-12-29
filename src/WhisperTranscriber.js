import {
    AutoTokenizer,
    AutoProcessor,
    WhisperForConditionalGeneration,
    full,
} from "@huggingface/transformers";

/**
 * WhisperTranscriber
 * 
 * Handles loading and running the Whisper model for speech-to-text.
 * Singleton pattern ensures model is loaded only once.
 */
export class WhisperTranscriber {
    static MODEL_ID = "onnx-community/whisper-base";
    static MAX_NEW_TOKENS = 128;

    static instance = null;

    constructor(tokenizer, processor, model) {
        this.tokenizer = tokenizer;
        this.processor = processor;
        this.model = model;
    }

    static async getInstance(progressCallback = null) {
        if (this.instance) {
            return this.instance;
        }

        const tokenizer = await AutoTokenizer.from_pretrained(this.MODEL_ID, {
            progress_callback: progressCallback,
        });

        const processor = await AutoProcessor.from_pretrained(this.MODEL_ID, {
            progress_callback: progressCallback,
        });

        const model = await WhisperForConditionalGeneration.from_pretrained(
            this.MODEL_ID,
            {
                dtype: {
                    encoder_model: "fp32",
                    decoder_model_merged: "q4",
                },
                device: "webgpu",
                progress_callback: progressCallback,
            }
        );

        this.instance = new WhisperTranscriber(tokenizer, processor, model);
        return this.instance;
    }

    async warmup() {
        await this.model.generate({
            input_features: full([1, 80, 3000], 0.0),
            max_new_tokens: 1,
        });
    }

    /**
     * Transcribe audio to text
     * @param {Float32Array} audio - Audio samples at 16kHz
     * @param {string} language - Language code (e.g., "en")
     * @returns {Promise<{text: string, tps: number, numTokens: number}>}
     */
    async transcribe(audio, language) {
        const startTime = performance.now();

        const inputs = await this.processor(audio);

        const outputs = await this.model.generate({
            ...inputs,
            max_new_tokens: WhisperTranscriber.MAX_NEW_TOKENS,
            language,
        });

        // Extract sequences from output
        let sequences = outputs.sequences || outputs;

        const numTokens = sequences.dims ? sequences.dims[1] : 0;
        const tps = (numTokens / (performance.now() - startTime)) * 1000;

        // Convert to array for decoding
        let tokenIds = sequences;
        if (sequences.tolist) {
            tokenIds = sequences.tolist();
        } else if (sequences.data) {
            tokenIds = Array.from(sequences.data);
        }

        const decoded = this.tokenizer.batch_decode(tokenIds, {
            skip_special_tokens: true,
        });

        // Clean up transcription
        let text = decoded[0] || "";
        text = text
            .replace(/\[BLANK_AUDIO\]/gi, "")
            .replace(/\s+/g, " ")
            .trim();

        return { text, tps, numTokens };
    }
}
