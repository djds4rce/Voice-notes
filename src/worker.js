/**
 * Web Worker for real-time speech transcription
 * 
 * Uses:
 * - WhisperTranscriber: Handles Whisper model loading and inference
 * - LocalAgreementProcessor: Handles transcription stability and deduplication
 */

import { WhisperTranscriber } from "./WhisperTranscriber.js";
import { LocalAgreementProcessor } from "./LocalAgreementProcessor.js";
import { TopicGenerator } from "./TopicGenerator.js";

// ===== INSTANCES =====

let transcriber = null;
let currentModelId = null;
let pendingModelId = null; // Track model being loaded
const agreementProcessor = new LocalAgreementProcessor();
let isProcessing = false;
let isLoading = false;

// ===== MESSAGE HANDLERS =====

async function handleLoad(modelId = null) {
  const targetModel = modelId || 'Xenova/whisper-base';

  console.log(`[Worker] handleLoad called, target: ${targetModel}, current: ${currentModelId}, pending: ${pendingModelId}, isLoading: ${isLoading}`);

  // If already loaded with same model, just send ready
  if (transcriber && currentModelId === targetModel && !isLoading) {
    console.log(`[Worker] Model ${targetModel} already loaded, sending ready`);
    self.postMessage({ status: "ready" });
    return;
  }

  // If currently loading a DIFFERENT model, we need to restart
  if (isLoading && pendingModelId !== targetModel) {
    console.log(`[Worker] Switching from loading ${pendingModelId} to ${targetModel}`);
    // Reset everything and restart
    transcriber = null;
    currentModelId = null;
    isLoading = false;
  }

  // If already loading the SAME model, just wait
  if (isLoading && pendingModelId === targetModel) {
    console.log(`[Worker] Already loading ${targetModel}, waiting...`);
    return;
  }

  isLoading = true;
  pendingModelId = targetModel;

  try {
    self.postMessage({ status: "loading", data: "Loading model..." });

    transcriber = await WhisperTranscriber.getInstance((progress) => {
      self.postMessage(progress);
    }, targetModel);

    currentModelId = targetModel;

    self.postMessage({ status: "loading", data: "Compiling shaders and warming up..." });

    await transcriber.warmup();

    await transcriber.warmup();

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
    });

    isLoading = false;
    pendingModelId = null;
    self.postMessage({ status: "ready" });
  } catch (error) {
    console.error("Model loading error:", error);
    isLoading = false;
    pendingModelId = null;
    transcriber = null;
    currentModelId = null;
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
  console.log("[Worker] Finalize requested, isProcessing:", isProcessing, "taggingEnabled:", taggingEnabled);

  // If currently processing, wait for it to complete
  if (isProcessing) {
    console.log("[Worker] Waiting for current processing to complete...");
    await new Promise((resolve) => {
      pendingFinalize = resolve;
    });
    console.log("[Worker] Current processing completed");
  }

  isProcessing = true;
  self.postMessage({ status: "start" });

  try {
    // If we have audio, process it first
    if (audio && audio.length >= 8000) { // At least 0.5 seconds
      console.log("[Worker] Processing final audio...");
      const { text, chunks, tps } = await transcriber.transcribe(audio, language);
      agreementProcessor.process(chunks, audioWindowStart);
    }

    // Finalize: commit all remaining tentative text
    const result = agreementProcessor.finalize();
    console.log("[Worker] Finalized transcript:", result.committed.substring(0, 100) + "...");

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
          console.log("[Worker] Generating topics...");
          // Ensure generator is ready or load it
          const topicGen = await TopicGenerator.getInstance((progress) => {
            if (progress.status === "progress") {
              console.log(`[Worker] Loading Topic Model: ${progress.file} ${progress.progress}%`);
            }
          });

          tags = await topicGen.generateTags(finalText);
          console.log("[Worker] Generated Tags:", tags);
        }
      } catch (tagError) {
        console.error("[Worker] Topic generation failed:", tagError);
      }
    } else {
      console.log("[Worker] Tagging disabled, skipping topic generation");
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
      await handleLoad(data?.modelId);
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
