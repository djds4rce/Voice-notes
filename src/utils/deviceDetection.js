/**
 * Device Detection Utilities
 * 
 * Helpers to detect device capabilities and platform-specific quirks.
 * Used to work around iOS/macOS WebGPU memory leaks in transformers.js v3.
 * 
 * @see https://github.com/huggingface/transformers.js/issues/1242
 */

/**
 * Detect if running on an iOS/iPadOS device
 * These devices have known issues with transformers.js v3 and should use WASM.
 * Works in both main thread (window) and Web Worker (self) contexts.
 * 
 * NOTE: iPadOS 13+ reports as 'Macintosh' to get desktop sites.
 * We detect this via maxTouchPoints (iPad has touch, Mac desktop doesn't).
 * 
 * @returns {boolean} True if on an iOS/iPadOS device
 */
export function isAppleDevice() {
    // Use globalThis to work in both main thread and worker contexts
    const nav = globalThis.navigator;
    if (!nav) return false;

    const ua = nav.userAgent || '';

    // Classic iOS detection (iPhone, iPad with old iOS, iPod)
    const isIOS = /iPad|iPhone|iPod/.test(ua);
    if (isIOS) return true;

    // Modern iPadOS (13+) detection - reports as Mac but has touch
    // navigator.maxTouchPoints > 1 indicates a touch device (iPad)
    const isMac = /Macintosh/.test(ua);
    const hasTouch = nav.maxTouchPoints > 1;
    if (isMac && hasTouch) return true; // This is an iPad pretending to be a Mac

    return false; // Not iOS - use WebGPU
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
