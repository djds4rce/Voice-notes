/**
 * Web Worker for real-time speech transcription
 * 
 * Uses:
 * - WhisperTranscriber: Handles Whisper model loading and inference
 * - LocalAgreementProcessor: Handles transcription stability and deduplication
 * 
 * Note: On Apple devices (iOS/macOS Safari), we force WASM to avoid WebGPU memory leaks.
 * @see https://github.com/huggingface/transformers.js/issues/1242
 */

import { WhisperTranscriber } from "./WhisperTranscriber.js";
import { LocalAgreementProcessor } from "./LocalAgreementProcessor.js";
import { TopicGenerator } from "./TopicGenerator.js";

// ===== DEVICE DETECTION (Worker Context) =====

/**
 * Detect if running on an Apple device (iOS/macOS Safari)
 * Works in Web Worker context using self.navigator
 */
function isAppleDevice() {
  const ua = self.navigator?.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  const isMacSafari = /Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Firefox|Edg/.test(ua);
  return isIOS || isMacSafari;
}

/**
 * Get recommended device, forcing WASM on Apple devices
 */
function getRecommendedDevice() {
  return isAppleDevice() ? 'wasm' : 'webgpu';
}

// ===== INSTANCES =====

let transcriber = null;
let currentModelId = null;
let currentDevice = null; // Track current device
let pendingModelId = null; // Track model being loaded
const agreementProcessor = new LocalAgreementProcessor();
let isProcessing = false;
let isLoading = false;

// Track failed load attempts to prevent infinite loops
let loadAttempts = 0;
const MAX_LOAD_ATTEMPTS = 2; // Try WebGPU once, then WASM once

// ===== MESSAGE HANDLERS =====

async function handleLoad({ modelId = null, taggingEnabled = true, device = null } = {}) {
  const targetModel = modelId || 'Xenova/whisper-base';
  let targetDevice = device || getRecommendedDevice();

  // If already loaded with same model and device, just send ready
  if (transcriber && currentModelId === targetModel && currentDevice === targetDevice && !isLoading) {
    self.postMessage({ status: "ready" });
    return;
  }

  // If currently loading a DIFFERENT model, we need to restart
  if (isLoading && pendingModelId !== targetModel) {
    // Reset everything and restart
    transcriber = null;
    currentModelId = null;
    currentDevice = null;
    isLoading = false;
    loadAttempts = 0;
  }

  // If already loading the SAME model, just wait
  if (isLoading && pendingModelId === targetModel) {
    return;
  }

  // Check if we've exceeded max attempts
  if (loadAttempts >= MAX_LOAD_ATTEMPTS) {
    self.postMessage({
      status: "error",
      error: "Failed to load model after multiple attempts. Please refresh the page and try again."
    });
    return;
  }

  // If this is a retry and we were using WebGPU, fall back to WASM
  if (loadAttempts > 0 && targetDevice === "webgpu") {
    targetDevice = "wasm";
    self.postMessage({ status: "loading", data: "WebGPU failed, falling back to CPU mode..." });
  }

  isLoading = true;
  pendingModelId = targetModel;
  loadAttempts++;

  try {
    self.postMessage({ status: "loading", data: "Loading model..." });

    transcriber = await WhisperTranscriber.getInstance((progress) => {
      self.postMessage(progress);
    }, targetModel, targetDevice);

    currentModelId = targetModel;
    currentDevice = targetDevice;

    self.postMessage({ status: "loading", data: "Compiling shaders and warming up..." });

    await transcriber.warmup();

    if (taggingEnabled) {
      self.postMessage({ status: "loading", data: "Loading topic model..." });
      await TopicGenerator.getInstance((progress) => {
        // We can forward topic model progress if needed, or just let it load silently/with generic message
        // For now, let's just log it or forward if it's significant, 
        // but to avoid protocol confusion with Whisper progress, we might keep it simple.
        // Or we can verify if the UI handles generic progress. 
        // The UI maps file names to progress.
        if (progress.status === "progress") {
          self.postMessage({
            status: "initiate",
            file: progress.file,
            name: progress.name,
            status: progress.status,
          });
          self.postMessage(progress);
        }
      }, targetDevice);
    } else {
    }

    isLoading = false;
    pendingModelId = null;
    loadAttempts = 0; // Reset on success
    self.postMessage({ status: "ready" });
  } catch (error) {
    console.error("Model loading error:", error);
    isLoading = false;
    pendingModelId = null;
    transcriber = null;
    currentModelId = null;
    currentDevice = null;

    // Post error status and attempt automatic retry with fallback
    if (loadAttempts < MAX_LOAD_ATTEMPTS) {
      // Retry with WASM fallback
      setTimeout(() => {
        handleLoad({ modelId, taggingEnabled, device: "wasm" });
      }, 500);
    } else {
      // All attempts exhausted
      self.postMessage({
        status: "error",
        error: `Failed to load model: ${error.message || "Unknown error"}. Try refreshing the page.`
      });
    }
  }
}

async function handleGenerate({ audio, language, audioWindowStart = 0 }) {
  if (isProcessing || !transcriber) return;
  isProcessing = true;

  self.postMessage({ status: "start" });

  try {
    // Get transcription with word-level timestamps
    const { text, chunks, tps } = await transcriber.transcribe(audio, language);

    // Apply Local Agreement for stability using word chunks with timestamps
    const result = agreementProcessor.process(chunks, audioWindowStart);

    // Send results - include both committed (stable) and tentative (may change) text
    const output = result.committed + (result.tentative ? " " + result.tentative : "");

    self.postMessage({
      status: "update",
      output,
      committed: result.committed,
      tentative: result.tentative,
      committedChunks: agreementProcessor.getAllCommittedChunks(),
      tps,
      numTokens: chunks.length,
    });

    self.postMessage({
      status: "complete",
      output: result.committed,
    });

  } catch (error) {
    console.error("Transcription error:", error);

    const committedText = agreementProcessor.getCommittedText();
    self.postMessage({
      status: "update",
      output: committedText,
      committed: committedText,
      tentative: "",
      tps: 0,
      numTokens: 0,
    });

    self.postMessage({
      status: "complete",
      output: committedText
    });
  }

  isProcessing = false;

  // If finalize is waiting, resolve it
  if (pendingFinalize) {
    pendingFinalize();
    pendingFinalize = null;
  }
}

// Queue to track pending finalize request
let pendingFinalize = null;

async function handleFinalize({ audio, language, audioWindowStart = 0, taggingEnabled = true }) {

  // If currently processing, wait for it to complete
  if (isProcessing) {
    await new Promise((resolve) => {
      pendingFinalize = resolve;
    });
  }

  isProcessing = true;
  self.postMessage({ status: "start" });

  try {
    // If we have audio, process it first
    if (audio && audio.length >= 8000) { // At least 0.5 seconds
      const { text, chunks, tps } = await transcriber.transcribe(audio, language);
      agreementProcessor.process(chunks, audioWindowStart);
    }

    // Finalize: commit all remaining tentative text
    const result = agreementProcessor.finalize();

    self.postMessage({
      status: "update",
      output: result.committed,
      committed: result.committed,
      tentative: "",
      committedChunks: agreementProcessor.getAllCommittedChunks(),
      tps: 0,
      numTokens: 0,
    });

    // --- TOPIC GENERATION (only if enabled) ---
    let tags = [];
    if (taggingEnabled) {
      try {
        const finalText = result.committed;
        if (finalText && finalText.length > 50) {
          // Ensure generator is ready or load it
          const topicGen = await TopicGenerator.getInstance((progress) => {
            if (progress.status === "progress") {
            }
          });

          tags = await topicGen.generateTags(finalText);
        }
      } catch (tagError) {
        console.error("[Worker] Topic generation failed:", tagError);
      }
    } else {
    }
    // ------------------------

    self.postMessage({
      status: "finalized",
      output: result.committed,
      committed: result.committed,
      committedChunks: agreementProcessor.getAllCommittedChunks(),
      tags: tags
    });

  } catch (error) {
    console.error("Finalize error:", error);

    // Still try to finalize even if transcription failed
    const result = agreementProcessor.finalize();
    self.postMessage({
      status: "update",
      output: result.committed,
      committed: result.committed,
      tentative: "",
      committedChunks: agreementProcessor.getAllCommittedChunks(),
      tps: 0,
      numTokens: 0,
    });

    self.postMessage({
      status: "finalized",
      output: result.committed,
      committed: result.committed,
      committedChunks: agreementProcessor.getAllCommittedChunks(),
    });
  }

  isProcessing = false;
}

function handleReset() {
  agreementProcessor.reset();
}

// ===== EVENT LISTENER =====

self.addEventListener("message", async (e) => {
  const { type, data } = e.data;

  switch (type) {
    case "load":
      await handleLoad(data);
      break;

    case "generate":
      await handleGenerate(data);
      break;

    case "finalize":
      await handleFinalize(data);
      break;

    case "reset":
      handleReset();
      break;
  }
});
