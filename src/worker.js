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
    // Get raw transcription from Whisper
    const { text, tps, numTokens } = await transcriber.transcribe(audio, language);

    // Apply Local Agreement for stability
    const result = agreementProcessor.process(text, audioWindowStart);

    // Send results
    const output = result.committed + (result.tentative ? " " + result.tentative : "");

    self.postMessage({
      status: "update",
      output,
      committed: result.committed + " " + result.tentative,
      tentative: "",
      tps,
      numTokens,
    });

    self.postMessage({
      status: "complete",
      output: result.committed,
    });

  } catch (error) {
    console.error("Transcription error:", error);

    self.postMessage({
      status: "update",
      output: agreementProcessor.committedText,
      committed: agreementProcessor.committedText,
      tentative: "",
      tps: 0,
      numTokens: 0,
    });

    self.postMessage({
      status: "complete",
      output: agreementProcessor.committedText
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
