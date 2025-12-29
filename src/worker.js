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

// ===== MESSAGE HANDLERS =====

async function handleLoad() {
  self.postMessage({ status: "loading", data: "Loading model..." });

  transcriber = await WhisperTranscriber.getInstance((progress) => {
    self.postMessage(progress);
  });

  self.postMessage({ status: "loading", data: "Compiling shaders and warming up..." });

  await transcriber.warmup();

  self.postMessage({ status: "ready" });
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

    case "reset":
      handleReset();
      break;
  }
});
