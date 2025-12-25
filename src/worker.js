import {
  AutoTokenizer,
  AutoProcessor,
  WhisperForConditionalGeneration,
  TextStreamer,
  full,
} from "@huggingface/transformers";

const WHISPER_SAMPLING_RATE = 16_000;
const MAX_NEW_TOKENS = 64;

/**
 * This class uses the Singleton pattern to ensure that only one instance of the model is loaded.
 */
class AutomaticSpeechRecognitionPipeline {
  static model_id = "onnx-community/whisper-base";
  static tokenizer = null;
  static processor = null;
  static model = null;

  static async getInstance(progress_callback = null) {
    this.tokenizer ??= AutoTokenizer.from_pretrained(this.model_id, {
      progress_callback,
    });
    this.processor ??= AutoProcessor.from_pretrained(this.model_id, {
      progress_callback,
    });

    this.model ??= WhisperForConditionalGeneration.from_pretrained(
      this.model_id,
      {
        dtype: {
          encoder_model: "fp32", // 'fp16' works too
          decoder_model_merged: "q4", // or 'fp32' ('fp16' is broken)
        },
        device: "webgpu",
        progress_callback,
      },
    );

    return Promise.all([this.tokenizer, this.processor, this.model]);
  }
}

let processing = false;
let currentTranscription = "";

// Local Agreement variables
let committedText = "";
let lastTentative = "";
let audioBuffer = new Float32Array(0);
const BUFFER_DURATION = 10; // Keep last 10 seconds of audio

/**
 * Local Agreement Algorithm
 * Finds the longest matching sequence of words at the start of two transcriptions
 * and commits only the matching words to prevent jittering.
 */
function applyLocalAgreement(newTranscription) {
  if (!newTranscription || newTranscription.trim() === "") {
    return { committed: committedText, tentative: lastTentative };
  }

  // Normalize text: trim, lowercase for comparison, but keep original for display
  const normalized = newTranscription.trim();
  const normalizedLast = lastTentative.trim();

  // Split into words for comparison
  const newWords = normalized.split(/\s+/).filter(word => word.length > 0);
  const lastWords = normalizedLast.split(/\s+/).filter(word => word.length > 0);

  let matchLength = 0;
  const minLength = Math.min(newWords.length, lastWords.length);

  // Find longest matching sequence at the start
  for (let i = 0; i < minLength; i++) {
    if (newWords[i].toLowerCase() === lastWords[i].toLowerCase()) {
      matchLength++;
    } else {
      break;
    }
  }

  // Commit the matching words
  if (matchLength > 0) {
    const wordsToCommit = lastWords.slice(0, matchLength);
    if (committedText === "") {
      committedText = wordsToCommit.join(" ");
    } else {
      committedText += " " + wordsToCommit.join(" ");
    }

    // Remove committed words from both transcriptions
    const remainingLast = lastWords.slice(matchLength);
    const remainingNew = newWords.slice(matchLength);

    // Update tentative with new remaining words (they might be different)
    lastTentative = remainingNew.join(" ");
  } else {
    // No match, keep all of new transcription as tentative
    lastTentative = normalized;
  }

  // Return the combined result
  const finalText = committedText + (lastTentative ? " " + lastTentative : "");

  return {
    committed: committedText,
    tentative: lastTentative,
    full: finalText
  };
}

async function generate({ audio, language }) {
  if (processing) return;
  processing = true;

  // Add new audio to buffer (keep last 10 seconds)
  // Convert new audio to Float32Array and concatenate
  const newAudio = new Float32Array(audio);
  const combinedLength = audioBuffer.length + newAudio.length;
  const combinedBuffer = new Float32Array(combinedLength);
  combinedBuffer.set(audioBuffer);
  combinedBuffer.set(newAudio, audioBuffer.length);
  audioBuffer = combinedBuffer;

  // Keep only last 10 seconds
  const maxBufferLength = WHISPER_SAMPLING_RATE * BUFFER_DURATION;
  if (audioBuffer.length > maxBufferLength) {
    audioBuffer = audioBuffer.slice(-maxBufferLength);
  }

  // Tell the main thread we are starting
  self.postMessage({ status: "start" });

  // Retrieve the text-generation pipeline.
  const [tokenizer, processor, model] =
    await AutomaticSpeechRecognitionPipeline.getInstance();

  let startTime;
  let numTokens = 0;
  let tps;
  const token_callback_function = () => {
    startTime ??= performance.now();

    if (numTokens++ > 0) {
      tps = (numTokens / (performance.now() - startTime)) * 1000;
    }
  };

  let latestTranscription = "";

  // Simple streaming callback function
  const callback_function = (output) => {
    latestTranscription = output;
  };

  // Initialize the streamer
  const streamer = new TextStreamer(tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function,
    token_callback_function,
  });

  // Process the audio from the buffer
  const inputs = await processor(audioBuffer);

  const outputs = await model.generate({
    ...inputs,
    max_new_tokens: MAX_NEW_TOKENS,
    language,
    streamer,
  });

  const decoded = tokenizer.batch_decode(outputs, {
    skip_special_tokens: true,
  });

  console.log(decoded)
  // Apply Local Agreement to the final transcription
  const result = applyLocalAgreement(decoded[0]);

  // Send the result with both committed and tentative parts
  self.postMessage({
    status: "update",
    output: result.full,
    committed: result.committed,
    tentative: result.tentative,
    tps,
    numTokens,
  });

  processing = false;
}

function resetLocalAgreement() {
  committedText = "";
  lastTentative = "";
  audioBuffer = new Float32Array(0);
}

async function load() {
  self.postMessage({
    status: "loading",
    data: "Loading model...",
  });

  // Load the pipeline and save it for future use.
  const [, , model] =
    await AutomaticSpeechRecognitionPipeline.getInstance((x) => {
      // We also add a progress callback to the pipeline so that we can
      // track model loading.
      self.postMessage(x);
    });

  self.postMessage({
    status: "loading",
    data: "Compiling shaders and warming up model...",
  });

  // Run model with dummy input to compile shaders
  await model.generate({
    input_features: full([1, 80, 3000], 0.0),
    max_new_tokens: 1,
  });
  self.postMessage({ status: "ready" });
}


// Listen for messages from the main thread
self.addEventListener("message", async (e) => {
  const { type, data } = e.data;

  switch (type) {
    case "load":
      load();
      break;

    case "generate":
      generate(data);
      break;

    case "reset":
      resetLocalAgreement();
      break;
  }
});