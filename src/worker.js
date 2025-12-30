/**
 * Web Worker for real-time speech transcription
 * 
 * Uses:
 * - WhisperTranscriber: Handles Whisper model loading and inference
 * - LocalAgreementProcessor: Handles transcription stability and deduplication
 */

import { WhisperTranscriber } from "./WhisperTranscriber.js";
import { LocalAgreementProcessor } from "./LocalAgreementProcessor.js";

// ===== INSTANCES =====

let transcriber = null;
const agreementProcessor = new LocalAgreementProcessor();
let isProcessing = false;
let isLoading = false;

// ===== MESSAGE HANDLERS =====

async function handleLoad() {
  // Prevent concurrent loads or reloading
  if (isLoading || transcriber) {
    if (transcriber) {
      self.postMessage({ status: "ready" });
    }
    return;
  }

  isLoading = true;

  try {
    self.postMessage({ status: "loading", data: "Loading model..." });

    transcriber = await WhisperTranscriber.getInstance((progress) => {
      self.postMessage(progress);
    });

    self.postMessage({ status: "loading", data: "Compiling shaders and warming up..." });

    await transcriber.warmup();

    self.postMessage({ status: "ready" });
  } catch (error) {
    console.error("Model loading error:", error);
    isLoading = false;
    transcriber = null;
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

async function handleFinalize({ audio, language, audioWindowStart = 0 }) {
  console.log("[Worker] Finalize requested, isProcessing:", isProcessing);

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

    self.postMessage({
      status: "finalized",
      output: result.committed,
      committed: result.committed,
      committedChunks: agreementProcessor.getAllCommittedChunks(),
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
      await handleLoad();
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
