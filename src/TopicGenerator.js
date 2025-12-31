
import { pipeline, env } from "@huggingface/transformers";

// Skip local checks for better browser/worker compatibility in some environments
env.allowLocalModels = false;
env.useBrowserCache = true;

// Using SmolLM2-360M-Instruct as a high-quality, non-gated alternative to Gemma 270M
// which currently requires authentication/gating even for ONNX versions.
const MODEL_ID = "HuggingFaceTB/SmolLM2-360M-Instruct";
// const MODEL_ID = "onnx-community/gemma-3-270m-it"; // Requires HF Token
// Fallback if the specific quantization isn't found, or use specific revision if needed.
// For now trusting standard transformers.js convention for popular models.

/**
 * Device-specific configuration for TopicGenerator model
 * - WebGPU: Use q4 quantization with GPU acceleration
 * - WASM: Use q4 quantization for CPU (could use q8 if available for better quality)
 */
const PER_DEVICE_CONFIG = {
    webgpu: {
        dtype: "q4",
        device: "webgpu",
    },
    wasm: {
        dtype: "q4", // q4 is widely available; q8 could be used if model supports it
        device: "wasm",
    },
};

// Helper for Title Case
function toTitleCase(str) {
    return str.replace(
        /\w\S*/g,
        text => text.charAt(0).toUpperCase() + text.substring(1).toLowerCase()
    );
}

export class TopicGenerator {
    static instance = null;
    static currentDevice = null;

    static async getInstance(progressCallback = null, device = "webgpu") {
        const targetDevice = device || "webgpu";

        // If device changed, reset instance
        if (TopicGenerator.instance && TopicGenerator.currentDevice !== targetDevice) {
            console.log(`[TopicGenerator] Device changed from ${TopicGenerator.currentDevice} to ${targetDevice}, resetting...`);
            TopicGenerator.instance = null;
        }

        if (!TopicGenerator.instance) {
            TopicGenerator.instance = new TopicGenerator();
            await TopicGenerator.instance.init(progressCallback, targetDevice);
            TopicGenerator.currentDevice = targetDevice;
        }
        return TopicGenerator.instance;
    }

    constructor() {
        this.generator = null;
        this.tokenizer = null;
        this.modelId = MODEL_ID;
        this.device = null;
        this.ready = false;
    }

    async init(progressCallback, device = "webgpu") {
        // Get device-specific configuration (proactive, no fallback needed)
        const config = PER_DEVICE_CONFIG[device] || PER_DEVICE_CONFIG.wasm;
        this.device = device;

        console.log(`[TopicGenerator] Loading model: ${this.modelId} with device: ${device}`, config);

        this.generator = await pipeline("text-generation", this.modelId, {
            dtype: config.dtype,
            device: config.device,
            progress_callback: progressCallback,
        });
        this.ready = true;
        console.log(`[TopicGenerator] Model loaded successfully on ${device}`);
    }

    async generateTags(transcript) {
        if (!this.ready || !this.generator) {
            throw new Error("Model not loaded");
        }

        // 1. Basic validation: If transcript is too short, don't barely generate topics
        if (!transcript || transcript.trim().length < 50) {
            return [];
        }

        // 2. Construct Prompt
        // Gemma instruct format: <start_of_turn>user\n{prompt}<end_of_turn>\n<start_of_turn>model\n
        // However, pipeline often handles chat serialization if passed messages.
        // We'll use the chat templates if possible, or manual formatting.
        // Let's try simple prompting first which is often robust enough for tags.

        const messages = [
            { role: "user", content: `Generate 3-5 concise topic metadata tags for the following transcript. Return ONLY the tags separated by commas. Do not use numbered lists.\n\nFormat: Tag1, Tag2, Tag3\n\nTranscript: "${transcript}"` }
        ];

        try {
            const output = await this.generator(messages, {
                max_new_tokens: 50,
                temperature: 0.3, // Low temperature for deterministic tags
                do_sample: false,
                top_k: 50,
                return_full_text: false,
            });

            // Output usually: [{ generated_text: "..." }]
            // If chat input is used, pipeline might return struct.
            // For text-generation pipeline with chat inputs (array), it uses apply_chat_template internally usually.

            console.log("[TopicGenerator] Raw model output:", JSON.stringify(output));

            let generatedText = "";
            if (Array.isArray(output) && output.length > 0) {
                generatedText = output[0].generated_text;
                // Sometimes generated_text might be the messages array itself if pipeline is confused?
                // Or if return_full_text is false, verify what it is.
            }

            // Handle case where generated_text is an object (common in some chat pipelines) or undefined
            if (typeof generatedText !== 'string') {
                if (Array.isArray(generatedText) && generatedText.length > 0 && generatedText[generatedText.length - 1].content) {
                    // It returned the messages array with new response appended
                    generatedText = generatedText[generatedText.length - 1].content;
                } else if (generatedText && typeof generatedText === 'object' && generatedText.content) {
                    generatedText = generatedText.content;
                } else {
                    generatedText = JSON.stringify(generatedText || "");
                }
            }

            console.log("[TopicGenerator] Extracted text:", generatedText);

            // 3. Parse Tags
            // Handle various formats:
            // - "1. Apple, 2. Banana"
            // - "1. Apple\n2. Banana"
            // - "- Apple\n- Banana"
            // - "Apple, Banana, Cherry"

            const cleanText = String(generatedText)
                // Remove brackets (handles JSON array output like ["A", "B"])
                .replace(/[\[\]]/g, "")
                // Remove quotes around words
                .replace(/['"`]+/g, "")
                // Replace newlines with commas
                .replace(/\n/g, ",")
                // Replace "1. ", "2. ", etc. (any number followed by dot or paren) with commas
                .replace(/\s*[\d]+[\.\)]\s*/g, ",")
                // Remove bullets (-, *)
                .replace(/^\s*[-*]\s*/gm, "");

            const rawTags = cleanText.split(",");

            const uniqueTags = new Set();

            rawTags.forEach(tag => {
                let t = tag.trim();
                // Normalize to Title Case
                t = toTitleCase(t);

                if (t && t.length > 1 && !t.toLowerCase().includes("transcript")) {
                    uniqueTags.add(t);
                }
            });

            return Array.from(uniqueTags).slice(0, 5); // Limit to 5 tags

        } catch (err) {
            console.error("Error generating tags:", err);
            return [];
        }
    }
}
