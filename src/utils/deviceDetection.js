/**
 * Device Detection Utilities
 * 
 * Helpers to detect device capabilities and platform-specific quirks.
 * Used to work around iOS/macOS WebGPU memory leaks in transformers.js v3.
 * 
 * @see https://github.com/huggingface/transformers.js/issues/1242
 */

/**
 * Detect if running on an Apple device (iOS, iPadOS, or macOS Safari)
 * These devices have known WebGPU memory leak issues with transformers.js v3.
 * Works in both main thread (window) and Web Worker (self) contexts.
 * 
 * @returns {boolean} True if on an Apple device with Safari/WebKit
 */
export function isAppleDevice() {
    // Use globalThis to work in both main thread and worker contexts
    const nav = globalThis.navigator;
    if (!nav) return false;

    const ua = nav.userAgent || '';

    // Check for iOS/iPadOS
    // Note: We avoid checking window.MSStream as window is not available in Web Workers
    const isIOS = /iPad|iPhone|iPod/.test(ua);

    return isIOS;
}

/**
 * Get the recommended ML device based on platform
 * Forces WASM on Apple devices to avoid WebGPU memory leaks.
 * Also forces WASM when using legacy transformers.js v2 (which doesn't support WebGPU).
 * 
 * @param {boolean} [usingLegacy] - Whether we're using legacy transformers.js v2
 * @returns {"webgpu" | "wasm"} The device to use for ML models
 */
export function getRecommendedDevice(usingLegacy = null) {
    // Check localStorage override first (for testing)
    // Note: localStorage is not available in Web Workers, so we use try/catch
    try {
        if (typeof localStorage !== 'undefined') {
            const override = localStorage.getItem('ml-device-override');
            if (override === 'webgpu' || override === 'wasm') {
                return override;
            }
        }
    } catch {
        // localStorage not available (e.g., in Web Worker)
    }

    // Legacy transformers.js v2 only supports WASM
    if (usingLegacy === true) {
        return 'wasm';
    }

    return isAppleDevice() ? 'wasm' : 'webgpu';
}

/**
 * Check if we should skip preloading heavy models (to save memory on constrained devices)
 * @returns {boolean}
 */
export function shouldSkipPreload() {
    return isAppleDevice();
}
