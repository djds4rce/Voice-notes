import { useEffect, useState, useRef, useCallback, useMemo } from "react";

import { AudioVisualizer } from "./components/AudioVisualizer";
import Progress from "./components/Progress";
import { LanguageSelector } from "./components/LanguageSelector";

const IS_WEBGPU_AVAILABLE = !!navigator.gpu;

const WHISPER_SAMPLING_RATE = 16_000;
const MAX_AUDIO_LENGTH = 30; // seconds
const MAX_SAMPLES = WHISPER_SAMPLING_RATE * MAX_AUDIO_LENGTH;
const WINDOW_SHIFT = 20; // seconds - how much to shift when buffer exceeds 30s
const WINDOW_SHIFT_SAMPLES = WHISPER_SAMPLING_RATE * WINDOW_SHIFT;

/**
 * Component to render words with smooth fade-in animation
 * Only newly added words get animated
 */
function AnimatedWords({ text, className, isNew = false }) {
  const words = text.split(/\s+/).filter(w => w);
  const prevWordsCountRef = useRef(0);

  // Track which words are new
  const newWordStartIndex = prevWordsCountRef.current;

  useEffect(() => {
    prevWordsCountRef.current = words.length;
  }, [words.length]);

  return (
    <span className={className}>
      {words.map((word, idx) => (
        <span
          key={`${idx}-${word}`}
          className={idx >= newWordStartIndex ? "word-fade-in" : ""}
          style={{ display: "inline" }}
        >
          {idx > 0 ? " " : ""}{word}
        </span>
      ))}
    </span>
  );
}

function App() {
  // Worker reference
  const worker = useRef(null);

  // Transcript container ref for auto-scroll
  const transcriptRef = useRef(null);

  // Model loading state
  const [status, setStatus] = useState(null);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [progressItems, setProgressItems] = useState([]);

  // Transcription state - Local Agreement based
  const [committedText, setCommittedText] = useState(""); // Stable, confirmed text
  const [tentativeText, setTentativeText] = useState(""); // May change with more audio
  const [tps, setTps] = useState(null);
  const [language, setLanguage] = useState("en");

  // Track previous committed word count for animation
  const [prevCommittedCount, setPrevCommittedCount] = useState(0);

  // Recording state
  const [recording, setRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [stream, setStream] = useState(null);

  // Audio processing refs
  const audioContextRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const lastProcessedSamples = useRef(0);

  // Memoize committed words with animation info
  const committedWords = useMemo(() => {
    const words = committedText.split(/\s+/).filter(w => w);
    return words.map((word, idx) => ({
      word,
      isNew: idx >= prevCommittedCount,
    }));
  }, [committedText, prevCommittedCount]);

  // Update previous count after render
  useEffect(() => {
    const currentCount = committedText.split(/\s+/).filter(w => w).length;
    if (currentCount > prevCommittedCount) {
      // Delay the update slightly to allow animation to play
      const timer = setTimeout(() => {
        setPrevCommittedCount(currentCount);
      }, 250);
      return () => clearTimeout(timer);
    }
  }, [committedText, prevCommittedCount]);

  // Setup worker
  useEffect(() => {
    if (!worker.current) {
      worker.current = new Worker(new URL("./worker.js", import.meta.url), {
        type: "module",
      });
    }

    const onMessageReceived = (e) => {
      switch (e.data.status) {
        case "loading":
          setStatus("loading");
          setLoadingMessage(e.data.data);
          break;

        case "initiate":
          setProgressItems((prev) => [...prev, e.data]);
          break;

        case "progress":
          setProgressItems((prev) =>
            prev.map((item) => {
              if (item.file === e.data.file) {
                return { ...item, ...e.data };
              }
              return item;
            }),
          );
          break;

        case "done":
          setProgressItems((prev) =>
            prev.filter((item) => item.file !== e.data.file),
          );
          break;

        case "ready":
          setStatus("ready");
          break;

        case "start":
          setIsProcessing(true);
          break;

        case "update": {
          const { committed, tentative, tps } = e.data;
          setCommittedText(committed || "");
          setTentativeText(tentative || "");
          setTps(tps);
          break;
        }

        case "complete": {
          setIsProcessing(false);
          setTimeout(() => {
            if (recorderRef.current?.state === "recording") {
              recorderRef.current.requestData();
            }
          }, 100);
          break;
        }
      }
    };

    worker.current.addEventListener("message", onMessageReceived);

    return () => {
      worker.current.removeEventListener("message", onMessageReceived);
    };
  }, []);

  // Process audio chunks
  const processAudioChunks = useCallback(async () => {
    if (chunksRef.current.length === 0) return;
    if (!audioContextRef.current) return;
    if (isProcessing) return;

    const blob = new Blob(chunksRef.current, {
      type: recorderRef.current?.mimeType || "audio/webm"
    });

    try {
      const arrayBuffer = await blob.arrayBuffer();
      const audioBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer);
      const allAudio = audioBuffer.getChannelData(0);

      const previousSamples = lastProcessedSamples.current;

      if (allAudio.length <= previousSamples) {
        setTimeout(() => {
          if (recorderRef.current?.state === "recording") {
            recorderRef.current.requestData();
          }
        }, 100);
        return;
      }

      // Calculate window for timestamp-based deduplication
      let audioToProcess = allAudio;
      let audioWindowStart = 0; // Start time in seconds of the audio window

      if (audioToProcess.length > MAX_SAMPLES) {
        // Shift window by 20s (keeping 10s overlap)
        // Calculate how many 20s shifts we need
        const excessSamples = audioToProcess.length - MAX_SAMPLES;
        const numShifts = Math.ceil(excessSamples / WINDOW_SHIFT_SAMPLES);
        const samplesToSkip = numShifts * WINDOW_SHIFT_SAMPLES;

        audioWindowStart = samplesToSkip / WHISPER_SAMPLING_RATE;
        audioToProcess = allAudio.slice(samplesToSkip, samplesToSkip + MAX_SAMPLES);

        console.log(`Audio window: ${audioWindowStart.toFixed(1)}s - ${(audioWindowStart + 30).toFixed(1)}s (shifted ${numShifts}x20s)`);
      }

      if (audioToProcess.length >= WHISPER_SAMPLING_RATE * 0.5) {
        lastProcessedSamples.current = allAudio.length;
        worker.current?.postMessage({
          type: "generate",
          data: { audio: audioToProcess, language, audioWindowStart },
        });
      } else {
        setTimeout(() => {
          if (recorderRef.current?.state === "recording") {
            recorderRef.current.requestData();
          }
        }, 100);
      }
    } catch (err) {
      console.error("Error processing audio:", err);
      setTimeout(() => {
        if (recorderRef.current?.state === "recording") {
          recorderRef.current.requestData();
        }
      }, 500);
    }
  }, [language, isProcessing]);

  // Start recording
  const startRecording = useCallback(async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setStream(mediaStream);

      audioContextRef.current = new AudioContext({ sampleRate: WHISPER_SAMPLING_RATE });
      recorderRef.current = new MediaRecorder(mediaStream);
      chunksRef.current = [];
      lastProcessedSamples.current = 0;

      recorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
          processAudioChunks();
        } else {
          setTimeout(() => {
            if (recorderRef.current?.state === "recording") {
              recorderRef.current.requestData();
            }
          }, 100);
        }
      };

      recorderRef.current.onstop = () => {
        setRecording(false);
      };

      recorderRef.current.start();
      setRecording(true);

      setTimeout(() => {
        if (recorderRef.current?.state === "recording") {
          recorderRef.current.requestData();
        }
      }, 1000);
    } catch (err) {
      console.error("Error starting recording:", err);
    }
  }, [processAudioChunks]);

  // Stop recording
  const stopRecording = useCallback(() => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
    setRecording(false);
  }, [stream]);

  // Reset transcript
  const resetTranscript = useCallback(() => {
    setCommittedText("");
    setTentativeText("");
    setTps(null);
    setPrevCommittedCount(0);
    chunksRef.current = [];
    lastProcessedSamples.current = 0;
    worker.current?.postMessage({ type: "reset" });
  }, []);

  return IS_WEBGPU_AVAILABLE ? (
    <div className="flex flex-col h-screen mx-auto justify-end text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-900">
      <div className="h-full overflow-auto scrollbar-thin flex justify-center items-center flex-col relative">
        <div className="flex flex-col items-center mb-1 max-w-[400px] text-center">
          <img
            src="logo192.png"
            width="50%"
            height="auto"
            className="block"
          />
          <h1 className="text-4xl font-bold mb-1">Voice Notes</h1>
          <h2 className="text-xl font-semibold">
            Real-time speech-to-text
          </h2>
        </div>

        <div className="flex flex-col items-center px-4 w-full max-w-[600px]">
          {status === null && (
            <>
              <p className="max-w-[480px] mb-4">
                <br />
                Load the Whisper model to start transcribing. The model (~200 MB)
                will be cached and reused when you revisit the page.
                <br />
                <br />
                Everything runs directly in your browser using WebGPU.
                No data is sent to a server.
              </p>

              <button
                className="border px-4 py-2 rounded-lg bg-blue-400 text-white hover:bg-blue-500 disabled:bg-blue-100 disabled:cursor-not-allowed select-none"
                onClick={() => {
                  worker.current.postMessage({ type: "load" });
                  setStatus("loading");
                }}
                disabled={status !== null}
              >
                Load model
              </button>
            </>
          )}

          {status === "loading" && (
            <div className="w-full max-w-[500px] text-left mx-auto p-4">
              <p className="text-center mb-4">{loadingMessage}</p>
              {progressItems.map(({ file, progress, total }, i) => (
                <Progress
                  key={i}
                  text={file}
                  percentage={progress}
                  total={total}
                />
              ))}
            </div>
          )}

          {status === "ready" && (
            <>
              {/* Audio Visualizer */}
              <div className="w-full mb-4">
                <AudioVisualizer className="w-full rounded-lg h-16" stream={stream} />
              </div>

              {/* Transcription Display with Local Agreement */}
              <div className="w-full mb-4">
                <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-1">
                  Transcript
                  {tps && (
                    <span className="ml-2 text-xs text-gray-500">
                      ({tps.toFixed(1)} tok/s)
                    </span>
                  )}
                </h3>
                <div
                  ref={transcriptRef}
                  className="w-full min-h-[200px] max-h-[400px] overflow-y-auto scrollbar-thin border rounded-lg p-3 bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700"
                >
                  {committedText || tentativeText ? (
                    <p className="whitespace-pre-wrap leading-relaxed">
                      {/* Committed words with fade-in animation for new words */}
                      {committedWords.map((item, idx) => (
                        <span
                          key={`committed-${idx}`}
                          className={`text-black dark:text-white ${item.isNew ? "word-fade-in" : ""}`}
                        >
                          {idx > 0 ? " " : ""}{item.word}
                        </span>
                      ))}
                      {/* Tentative text with pulse animation */}
                      {tentativeText && (
                        <span className="text-gray-500 dark:text-gray-400 italic tentative-pulse">
                          {committedText ? " " : ""}{tentativeText}
                        </span>
                      )}
                    </p>
                  ) : recording ? (
                    <p className="text-gray-400 dark:text-gray-500 italic">
                      {isProcessing ? "Processing audio..." : "Listening..."}
                    </p>
                  ) : (
                    <p className="text-gray-400 dark:text-gray-500 italic">
                      Click Start to begin recording
                    </p>
                  )}
                </div>
                <div className="mt-1 text-xs text-gray-500 flex gap-4">
                  <span>■ Committed (stable)</span>
                  <span className="italic">■ Tentative (may change)</span>
                </div>
              </div>

              {/* Controls */}
              <div className="flex items-center gap-4 mb-4">
                <LanguageSelector language={language} setLanguage={setLanguage} />

                {!recording ? (
                  <button
                    className="px-6 py-2 rounded-lg bg-green-500 text-white hover:bg-green-600 font-medium"
                    onClick={startRecording}
                  >
                    Start Recording
                  </button>
                ) : (
                  <button
                    className="px-6 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 font-medium"
                    onClick={stopRecording}
                  >
                    Stop Recording
                  </button>
                )}

                <button
                  className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"
                  onClick={resetTranscript}
                >
                  Clear
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  ) : (
    <div className="fixed w-screen h-screen bg-black z-10 bg-opacity-[92%] text-white text-2xl font-semibold flex justify-center items-center text-center">
      WebGPU is not supported
      <br />
      by this browser :&#40;
    </div>
  );
}

export default App;
