/**
 * Transformer Loader
 * 
 * Dynamically loads the appropriate version of transformers.js based on platform:
 * - iOS devices: @xenova/transformers v2 (stable, no memory leaks)
 * - Other platforms: @huggingface/transformers v3 (WebGPU support)
 * 
 * This abstraction exists to work around iOS memory leaks in transformers.js v3.
 * @see https://github.com/huggingface/transformers.js/issues/1242
 */

import { isAppleDevice } from './deviceDetection.js';

// Cached module reference
let transformersModule = null;
let isLegacyVersion = null;

/**
 * Load and return the appropriate transformers.js module.
 * The module is cached after first load.
 * 
 * @returns {Promise<{pipeline: Function, env: Object}>} The transformers module exports
 */
export async function getTransformers() {
    if (transformersModule) {
        return transformersModule;
    }

    if (isAppleDevice()) {
        // Use v2 for iOS - stable, no memory leaks
        // v2 doesn't support device/dtype options but ignores them gracefully
        console.log('[TransformerLoader] iOS detected - using @xenova/transformers v2 for stability');
        transformersModule = await import('@xenova/transformers');
        isLegacyVersion = true;
    } else {
        // Use v3 for other platforms - WebGPU support
        console.log('[TransformerLoader] Using @huggingface/transformers v3 with WebGPU support');
        transformersModule = await import('@huggingface/transformers');
        isLegacyVersion = false;
    }

    return transformersModule;
}

/**
 * Check if we're using the legacy v2 transformers.js
 * Useful for adjusting behavior based on library capabilities
 * 
 * @returns {boolean|null} true if v2, false if v3, null if not yet loaded
 */
export function isUsingLegacyTransformers() {
    return isLegacyVersion;
}

/**
 * Get the pipeline function from the loaded transformers module.
 * Convenience wrapper for common use case.
 * 
 * @returns {Promise<Function>} The pipeline function
 */
export async function getPipeline() {
    const { pipeline } = await getTransformers();
    return pipeline;
}

/**
 * Get the env object from the loaded transformers module.
 * Convenience wrapper for environment configuration.
 * 
 * @returns {Promise<Object>} The env configuration object
 */
export async function getEnv() {
    const { env } = await getTransformers();
    return env;
}
