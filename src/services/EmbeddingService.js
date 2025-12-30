/**
 * EmbeddingService
 * 
 * Generates text embeddings using Transformers.js for semantic search.
 * Uses all-MiniLM-L6-v2 which produces 384-dimensional vectors.
 * Loads lazily on first use to avoid blocking initial app load.
 */

import { pipeline } from '@huggingface/transformers';

class EmbeddingService {
    static instance = null;
    embedder = null;
    loading = false;
    loadPromise = null;

    static MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

    static async getInstance(progressCallback = null) {
        if (!this.instance) {
            this.instance = new EmbeddingService();
        }
        // Ensure model is loaded
        await this.instance.load(progressCallback);
        return this.instance;
    }

    async load(progressCallback = null) {
        if (this.embedder) return;

        if (this.loading) {
            // Wait for existing load to complete
            return this.loadPromise;
        }

        this.loading = true;
        console.log('[EmbeddingService] Loading embedding model...');

        this.loadPromise = pipeline('feature-extraction', EmbeddingService.MODEL_ID, {
            progress_callback: progressCallback,
        }).then(embedder => {
            this.embedder = embedder;
            this.loading = false;
            console.log('[EmbeddingService] Model loaded successfully');
            return this.embedder;
        }).catch(error => {
            this.loading = false;
            console.error('[EmbeddingService] Failed to load model:', error);
            throw error;
        });

        return this.loadPromise;
    }

    /**
     * Check if the embedding model is loaded
     * @returns {boolean}
     */
    isLoaded() {
        return this.embedder !== null;
    }

    /**
     * Check if the model is currently loading
     * @returns {boolean}
     */
    isLoading() {
        return this.loading;
    }

    /**
     * Generate embedding for a text string
     * @param {string} text - Text to embed
     * @returns {Promise<Float32Array>} 384-dimensional embedding vector
     */
    async embed(text) {
        if (!this.embedder) {
            await this.load();
        }

        if (!text || typeof text !== 'string' || text.trim().length === 0) {
            throw new Error('Text must be a non-empty string');
        }

        // Clean and truncate text (model has ~256 token limit for best results)
        const cleanText = text.trim().slice(0, 2000);

        // Generate embedding
        const output = await this.embedder(cleanText, {
            pooling: 'mean',
            normalize: true,
        });

        // Convert to Float32Array
        const embedding = new Float32Array(output.data);

        console.log(`[EmbeddingService] Generated ${embedding.length}D embedding for "${cleanText.slice(0, 50)}..."`);
        return embedding;
    }

    /**
     * Generate embeddings for multiple texts
     * @param {string[]} texts - Array of texts to embed
     * @returns {Promise<Float32Array[]>} Array of embeddings
     */
    async embedBatch(texts) {
        if (!Array.isArray(texts) || texts.length === 0) {
            return [];
        }

        const embeddings = [];
        for (const text of texts) {
            try {
                const embedding = await this.embed(text);
                embeddings.push(embedding);
            } catch (error) {
                console.error('[EmbeddingService] Failed to embed text:', error);
                embeddings.push(null);
            }
        }
        return embeddings;
    }

    /**
     * Calculate cosine similarity between two embeddings
     * @param {Float32Array} a - First embedding
     * @param {Float32Array} b - Second embedding
     * @returns {number} Similarity score between 0 and 1
     */
    static cosineSimilarity(a, b) {
        if (!a || !b || a.length !== b.length) {
            return 0;
        }

        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }

        const denominator = Math.sqrt(normA) * Math.sqrt(normB);
        if (denominator === 0) return 0;

        return dotProduct / denominator;
    }
}

export default EmbeddingService;
