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
 * 
 * @returns {boolean} True if on an Apple device with Safari/WebKit
 */
export function isAppleDevice() {
    if (typeof navigator === 'undefined') return false;

    const ua = navigator.userAgent;

    // Check for iOS/iPadOS
    const isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;


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
    if (typeof localStorage !== 'undefined') {
        const override = localStorage.getItem('ml-device-override');
        if (override === 'webgpu' || override === 'wasm') {
            return override;
        }
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
