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
 * Detect if running on an iOS/iPadOS device
 * Works in Web Worker context using self.navigator
 * 
 * NOTE: iPadOS 13+ reports as 'Macintosh' to get desktop sites
 * We detect this via maxTouchPoints (iPad has touch, Mac desktop doesn't)
 */
function isAppleDevice() {
  const ua = self.navigator?.userAgent || '';

  // Classic iOS detection
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  if (isIOS) return true;

  // Modern iPadOS (13+) detection - reports as Mac but has touch
  const isMac = /Macintosh/.test(ua);
  const hasTouch = self.navigator?.maxTouchPoints > 1;
  if (isMac && hasTouch) return true; // This is an iPad pretending to be a Mac

  return false; // Not iOS - use WebGPU
}

/**
 * Get recommended device, forcing WASM on Apple devices
 */
function getRecommendedDevice() {
  return isAppleDevice() ? 'wasm' : 'webgpu';
}

// ===== ENGLISH-ONLY MODEL OPTIMIZATION =====

/**
 * English-only Whisper models are smaller and faster for English transcription.
 * Maps base model to its English-only variant.
 */
const ENGLISH_ONLY_WHISPER_MODELS = {
  'Xenova/whisper-tiny': 'Xenova/whisper-tiny.en',
  'Xenova/whisper-base': 'Xenova/whisper-base.en',
  'Xenova/whisper-small': 'Xenova/whisper-small.en',
  'Xenova/whisper-medium': 'Xenova/whisper-medium.en',
  // Large models don't have English-only variants
  'Xenova/whisper-large': 'Xenova/whisper-large',
  'Xenova/whisper-large-v2': 'Xenova/whisper-large-v2',
  'Xenova/whisper-large-v3': 'Xenova/whisper-large-v3',
};

/**
 * Get the optimal Whisper model based on language.
 * For English, returns the English-only variant if available.
 */
function getOptimalWhisperModel(baseModel, language) {
  if (language === 'en' && ENGLISH_ONLY_WHISPER_MODELS[baseModel]) {
    return ENGLISH_ONLY_WHISPER_MODELS[baseModel];
  }
  return baseModel;
}

// ===== INSTANCES =====

let transcriber = null;
let currentModelId = null;
let currentDevice = null; // Track current device
let currentLanguage = null; // Track current language for model optimization
let pendingModelId = null; // Track model being loaded
const agreementProcessor = new LocalAgreementProcessor();
let isProcessing = false;
let isLoading = false;

// Track failed load attempts to prevent infinite loops
let loadAttempts = 0;
const MAX_LOAD_ATTEMPTS = 2; // Try WebGPU once, then WASM once

// ===== MESSAGE HANDLERS =====

async function handleLoad({ modelId = null, taggingEnabled = true, device = null, language = 'en' } = {}) {
  const baseModel = modelId || 'Xenova/whisper-base';
  // Use English-only model when language is 'en' for better performance
  const targetModel = getOptimalWhisperModel(baseModel, language);
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

    // Skip warmup on iOS - not needed for WASM and can cause memory crashes
    const deviceType = isAppleDevice() ? 'iOS/Apple' : 'Desktop';
    if (!isAppleDevice()) {
      self.postMessage({ status: "loading", data: `Compiling shaders and warming up... (${targetDevice.toUpperCase()})` });
      await transcriber.warmup();
    } else {
      self.postMessage({ status: "loading", data: `Model ready (${targetDevice.toUpperCase()} - ${deviceType})` });
    }

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
    // Don't auto-retry on iOS - retrying doubles memory usage and causes crashes
    if (!isAppleDevice() && loadAttempts < MAX_LOAD_ATTEMPTS) {
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

async function handleFinalize({ audio, language, audioWindowStart = 0, taggingEnabled = true, batchMode = false }) {

  // If currently processing, wait for it to complete
  if (isProcessing) {
    await new Promise((resolve) => {
      pendingFinalize = resolve;
    });
  }

  isProcessing = true;
  self.postMessage({ status: "start" });

  try {
    if (batchMode && audio && audio.length >= 8000) {
      // iOS BATCH MODE: Transcribe entire audio in 30-second chunks
      // This is used when live transcription was skipped to avoid memory issues
      const CHUNK_SIZE = 16000 * 30; // 30 seconds at 16kHz
      const OVERLAP = 16000 * 5; // 5 seconds overlap for better continuity

      let allChunks = [];
      let position = 0;
      let chunkIndex = 0;
      let lastProcessedTime = 0; // Track where we left off to avoid duplicates

      while (position < audio.length) {
        const endPosition = Math.min(position + CHUNK_SIZE, audio.length);
        const audioChunk = audio.slice(position, endPosition);

        // Only process if chunk is at least 0.5 seconds
        if (audioChunk.length >= 8000) {
          const chunkStartTime = position / 16000;
          const { text, chunks, tps } = await transcriber.transcribe(audioChunk, language);

          // Adjust chunk timestamps to absolute position and filter out overlap duplicates
          const adjustedChunks = chunks
            .map(c => ({
              ...c,
              start: c.start + chunkStartTime,
              end: c.end + chunkStartTime,
            }))
            .filter(c => c.start >= lastProcessedTime); // Only keep words after last processed time

          allChunks = allChunks.concat(adjustedChunks);

          // Update last processed time to the end of this chunk's content
          if (adjustedChunks.length > 0) {
            lastProcessedTime = adjustedChunks[adjustedChunks.length - 1].end;
          }

          chunkIndex++;

          // Send progress update
          self.postMessage({
            status: "loading",
            data: `Transcribing... (${Math.min(100, Math.round((endPosition / audio.length) * 100))}%)`
          });
        }

        // Move to next chunk with overlap subtracted (except for last chunk)
        position = endPosition - (endPosition < audio.length ? OVERLAP : 0);
        if (position <= 0 || endPosition >= audio.length) {
          position = endPosition; // Prevent infinite loop
        }
      }

      // Process all chunks through agreement processor
      agreementProcessor.process(allChunks, 0);

    } else if (audio && audio.length >= 8000) {
      // NORMAL MODE: Single transcription (for desktop live mode finalization)
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
