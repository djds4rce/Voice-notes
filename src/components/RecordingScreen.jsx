/**
 * RecordingScreen
 * 
 * Recording interface with:
 * - Timer display (MM:SS)
 * - Real-time transcript with tentative/committed text
 * - Audio waveform visualizer
 * - Stop/Cancel controls
 * - Processing state animation
 */

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Progress from './Progress';
import './RecordingScreen.css';

const WHISPER_SAMPLING_RATE = 16_000;
const MAX_AUDIO_LENGTH = 30; // seconds
const MAX_SAMPLES = WHISPER_SAMPLING_RATE * MAX_AUDIO_LENGTH;
const WINDOW_SHIFT = 20; // seconds
const WINDOW_SHIFT_SAMPLES = WHISPER_SAMPLING_RATE * WINDOW_SHIFT;

export function RecordingScreen({ worker, onSaveNote, whisperStatus, progressItems = [], loadingMessage = '' }) {
    const navigate = useNavigate();

    // Track if we're waiting for model to load
    const [waitingForModel, setWaitingForModel] = useState(whisperStatus !== 'ready');

    // Recording state
    const [recording, setRecording] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [stoppingRecording, setStoppingRecording] = useState(false); // waiting for final chunks
    const [elapsedTime, setElapsedTime] = useState(0);

    // Transcription state
    const [committedText, setCommittedText] = useState('');
    const [tentativeText, setTentativeText] = useState('');
    const [committedChunks, setCommittedChunks] = useState([]);

    // Refs to track latest transcript values for stopRecording
    const committedTextRef = useRef('');
    const tentativeTextRef = useRef('');
    const committedChunksRef = useRef([]);

    // Audio refs
    const audioContextRef = useRef(null);
    const recorderRef = useRef(null);
    const chunksRef = useRef([]);
    const lastProcessedSamples = useRef(0);
    const streamRef = useRef(null);
    const timerRef = useRef(null);
    const startTimeRef = useRef(null);

    // Audio visualization
    const [audioLevels, setAudioLevels] = useState([0.3, 0.5, 0.7, 0.5, 0.3]);
    const analyserRef = useRef(null);
    const animationRef = useRef(null);

    // Transcript scroll ref
    const transcriptScrollRef = useRef(null);

    // Ref to resolve when final processing completes
    const finalProcessingResolveRef = useRef(null);

    // Ref to resolve when final ondataavailable fires
    const finalDataResolveRef = useRef(null);

    // Track previous committed count for animation
    const prevCommittedCount = useRef(0);

    // Memoize committed words with animation info
    const committedWords = useMemo(() => {
        const words = committedText.split(/\s+/).filter(w => w);
        const currentCount = prevCommittedCount.current;
        const result = words.map((word, idx) => ({
            word,
            isNew: idx >= currentCount,
        }));
        // Update ref for next render
        prevCommittedCount.current = words.length;
        return result;
    }, [committedText]);

    // Auto-scroll transcript to bottom when text changes
    useEffect(() => {
        if (transcriptScrollRef.current) {
            transcriptScrollRef.current.scrollTop = transcriptScrollRef.current.scrollHeight;
        }
    }, [committedText, tentativeText]);

    // Setup worker message handler
    useEffect(() => {
        if (!worker) return;

        const handleMessage = (e) => {
            switch (e.data.status) {
                case 'start':
                    setIsProcessing(true);
                    break;

                case 'update': {
                    const { committed, tentative, committedChunks: chunks } = e.data;
                    setCommittedText(committed || '');
                    setTentativeText(tentative || '');
                    // Also update refs for stopRecording to access latest values
                    committedTextRef.current = committed || '';
                    tentativeTextRef.current = tentative || '';
                    if (chunks && chunks.length > 0) {
                        setCommittedChunks(chunks);
                        committedChunksRef.current = chunks;
                    }
                    break;
                }

                case 'complete':
                    setIsProcessing(false);
                    // If we're stopping recording, resolve the promise so save can proceed
                    if (finalProcessingResolveRef.current) {
                        finalProcessingResolveRef.current();
                        finalProcessingResolveRef.current = null;
                    } else {
                        // Request more data if still recording
                        setTimeout(() => {
                            if (recorderRef.current?.state === 'recording') {
                                recorderRef.current.requestData();
                            }
                        }, 100);
                    }
                    break;

                case 'finalized': {
                    setIsProcessing(false);
                    const { committed, committedChunks: chunks } = e.data;
                    console.log('[RecordingScreen] Received finalized signal, committed:', committed?.substring(0, 50) + '...');
                    // Update refs with final values
                    if (committed) {
                        committedTextRef.current = committed;
                        tentativeTextRef.current = ''; // No more tentative after finalize
                    }
                    if (chunks) {
                        committedChunksRef.current = chunks;
                    }
                    // Resolve the promise to signal finalization complete
                    if (finalProcessingResolveRef.current) {
                        finalProcessingResolveRef.current();
                        finalProcessingResolveRef.current = null;
                    }
                    break;
                }
            }
        };

        worker.addEventListener('message', handleMessage);
        return () => worker.removeEventListener('message', handleMessage);
    }, [worker]);

    // Process audio chunks
    const processAudioChunks = useCallback(async () => {
        if (chunksRef.current.length === 0) return;
        if (!audioContextRef.current) return;
        if (isProcessing) return;

        const blob = new Blob(chunksRef.current, {
            type: recorderRef.current?.mimeType || 'audio/webm'
        });

        try {
            const arrayBuffer = await blob.arrayBuffer();
            const audioBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer);
            const allAudio = audioBuffer.getChannelData(0);

            if (allAudio.length <= lastProcessedSamples.current) {
                setTimeout(() => {
                    if (recorderRef.current?.state === 'recording') {
                        recorderRef.current.requestData();
                    }
                }, 100);
                return;
            }

            let audioToProcess = allAudio;
            let audioWindowStart = 0;

            if (audioToProcess.length > MAX_SAMPLES) {
                const excessSamples = audioToProcess.length - MAX_SAMPLES;
                const numShifts = Math.ceil(excessSamples / WINDOW_SHIFT_SAMPLES);
                const samplesToSkip = numShifts * WINDOW_SHIFT_SAMPLES;
                audioWindowStart = samplesToSkip / WHISPER_SAMPLING_RATE;
                audioToProcess = allAudio.slice(samplesToSkip, samplesToSkip + MAX_SAMPLES);
            }

            if (audioToProcess.length >= WHISPER_SAMPLING_RATE * 0.5) {
                lastProcessedSamples.current = allAudio.length;
                worker?.postMessage({
                    type: 'generate',
                    data: { audio: audioToProcess, language: 'en', audioWindowStart },
                });
            } else {
                setTimeout(() => {
                    if (recorderRef.current?.state === 'recording') {
                        recorderRef.current.requestData();
                    }
                }, 100);
            }
        } catch (err) {
            console.error('Error processing audio:', err);
            setTimeout(() => {
                if (recorderRef.current?.state === 'recording') {
                    recorderRef.current.requestData();
                }
            }, 500);
        }
    }, [worker, isProcessing]);

    // Update audio visualization
    const updateAudioLevels = useCallback(() => {
        if (!analyserRef.current) return;

        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(dataArray);

        // Sample 5 frequency bands
        const bands = 5;
        const bandSize = Math.floor(dataArray.length / bands);
        const levels = [];
        for (let i = 0; i < bands; i++) {
            const start = i * bandSize;
            const end = start + bandSize;
            let sum = 0;
            for (let j = start; j < end; j++) {
                sum += dataArray[j];
            }
            const avg = sum / bandSize / 255;
            levels.push(Math.max(0.1, Math.min(1, avg * 2 + 0.1)));
        }
        setAudioLevels(levels);

        animationRef.current = requestAnimationFrame(updateAudioLevels);
    }, []);

    // Start recording
    const startRecording = useCallback(async () => {
        // Reset worker state to clear previous transcript
        worker?.postMessage({ type: 'reset' });

        try {
            const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = mediaStream;

            audioContextRef.current = new AudioContext({ sampleRate: WHISPER_SAMPLING_RATE });

            // Set up analyser for visualization
            const source = audioContextRef.current.createMediaStreamSource(mediaStream);
            analyserRef.current = audioContextRef.current.createAnalyser();
            analyserRef.current.fftSize = 256;
            source.connect(analyserRef.current);

            recorderRef.current = new MediaRecorder(mediaStream);
            chunksRef.current = [];
            lastProcessedSamples.current = 0;

            recorderRef.current.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    chunksRef.current.push(e.data);
                    console.log('[RecordingScreen] ondataavailable, chunk count:', chunksRef.current.length);

                    // If we're stopping and waiting for final data, resolve the promise
                    if (finalDataResolveRef.current) {
                        finalDataResolveRef.current();
                        finalDataResolveRef.current = null;
                    } else {
                        // Only auto-process if not stopping
                        processAudioChunks();
                    }
                }
            };

            recorderRef.current.onstop = () => {
                setRecording(false);
            };

            recorderRef.current.start();
            setRecording(true);
            startTimeRef.current = Date.now();

            // Start timer
            timerRef.current = setInterval(() => {
                setElapsedTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
            }, 1000);

            // Start visualization
            updateAudioLevels();

            // Start requesting data
            setTimeout(() => {
                if (recorderRef.current?.state === 'recording') {
                    recorderRef.current.requestData();
                }
            }, 1000);
        } catch (err) {
            console.error('Error starting recording:', err);
        }
    }, [processAudioChunks, updateAudioLevels]);

    // Stop recording and save
    const stopRecording = useCallback(async () => {
        console.log('[RecordingScreen] Stopping recording...');
        setStoppingRecording(true);

        // Stop audio visualization
        if (animationRef.current) {
            cancelAnimationFrame(animationRef.current);
        }

        // Stop timer
        if (timerRef.current) {
            clearInterval(timerRef.current);
        }

        setRecording(false);
        setIsSaving(true);

        // Wait for any in-progress transcription to complete first
        if (isProcessing) {
            console.log('[RecordingScreen] Waiting for in-progress transcription...');
            await new Promise((resolve) => {
                finalProcessingResolveRef.current = resolve;
                setTimeout(() => {
                    if (finalProcessingResolveRef.current) {
                        console.log('[RecordingScreen] Timeout waiting for in-progress transcription');
                        finalProcessingResolveRef.current();
                        finalProcessingResolveRef.current = null;
                    }
                }, 10000);
            });
        }

        // Set up promise to wait for final data before stopping
        let finalDataPromise = null;
        if (recorderRef.current?.state === 'recording') {
            finalDataPromise = new Promise((resolve) => {
                finalDataResolveRef.current = resolve;
                // Timeout in case ondataavailable doesn't fire
                setTimeout(() => {
                    if (finalDataResolveRef.current) {
                        console.log('[RecordingScreen] Timeout waiting for final data');
                        finalDataResolveRef.current();
                        finalDataResolveRef.current = null;
                    }
                }, 2000);
            });

            // Request final data and stop
            recorderRef.current.requestData();
            recorderRef.current.stop();
        }

        // Stop stream (stop audio input)
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
        }

        // Wait for final data to arrive
        if (finalDataPromise) {
            console.log('[RecordingScreen] Waiting for final data chunk...');
            await finalDataPromise;
            console.log('[RecordingScreen] Final data chunk received');
        }

        // Now send finalize message to process any remaining audio and commit all tentative text
        if (chunksRef.current.length > 0 && audioContextRef.current) {
            try {
                const blob = new Blob(chunksRef.current, {
                    type: recorderRef.current?.mimeType || 'audio/webm'
                });
                const arrayBuffer = await blob.arrayBuffer();
                const audioBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer);
                const allAudio = audioBuffer.getChannelData(0);

                console.log('[RecordingScreen] Sending finalize message...');

                let audioToProcess = allAudio;
                let audioWindowStart = 0;

                if (audioToProcess.length > MAX_SAMPLES) {
                    const excessSamples = audioToProcess.length - MAX_SAMPLES;
                    const numShifts = Math.ceil(excessSamples / WINDOW_SHIFT_SAMPLES);
                    const samplesToSkip = numShifts * WINDOW_SHIFT_SAMPLES;
                    audioWindowStart = samplesToSkip / WHISPER_SAMPLING_RATE;
                    audioToProcess = allAudio.slice(samplesToSkip, samplesToSkip + MAX_SAMPLES);
                }

                // Set up promise to wait for finalization
                const finalProcessingPromise = new Promise((resolve) => {
                    finalProcessingResolveRef.current = resolve;
                    setTimeout(() => {
                        if (finalProcessingResolveRef.current) {
                            console.log('[RecordingScreen] Timeout on finalize');
                            finalProcessingResolveRef.current();
                            finalProcessingResolveRef.current = null;
                        }
                    }, 15000); // Longer timeout for finalize
                });

                // Send finalize message - this will wait for any in-progress work,
                // process the audio, and commit all remaining tentative text
                worker?.postMessage({
                    type: 'finalize',
                    data: { audio: audioToProcess, language: 'en', audioWindowStart },
                });

                // Wait for finalization to complete
                await finalProcessingPromise;
                console.log('[RecordingScreen] Finalization complete');
            } catch (err) {
                console.error('[RecordingScreen] Error during finalization:', err);
            }
        }

        // Small delay to allow state updates to propagate
        await new Promise(resolve => setTimeout(resolve, 100));

        // Create final audio blob
        const audioBlob = new Blob(chunksRef.current, {
            type: recorderRef.current?.mimeType || 'audio/webm'
        });

        // Get final transcript - use refs for latest values (avoid stale closure)
        const finalTranscript = committedTextRef.current + (tentativeTextRef.current ? ' ' + tentativeTextRef.current : '');

        console.log('[RecordingScreen] Final transcript:', finalTranscript.substring(0, 100) + '...');

        if (finalTranscript.trim().length > 0 && onSaveNote) {
            await onSaveNote({
                transcript: finalTranscript.trim(),
                audioBlob,
                durationSeconds: elapsedTime,
                wordTimestamps: committedChunksRef.current,
            });
        }

        setIsSaving(false);
        setStoppingRecording(false);
        navigate('/');
    }, [elapsedTime, onSaveNote, navigate, isProcessing, worker]);

    // Cancel recording
    const cancelRecording = useCallback(() => {
        // Stop audio visualization
        if (animationRef.current) {
            cancelAnimationFrame(animationRef.current);
        }

        // Stop timer
        if (timerRef.current) {
            clearInterval(timerRef.current);
        }

        // Stop recorder
        if (recorderRef.current?.state === 'recording') {
            recorderRef.current.stop();
        }

        // Stop stream
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
        }

        // Reset worker
        worker?.postMessage({ type: 'reset' });

        navigate('/');
    }, [worker, navigate]);

    // Start recording on mount (only if model is ready)
    useEffect(() => {
        if (whisperStatus === 'ready' && waitingForModel) {
            setWaitingForModel(false);
            startRecording();
        } else if (whisperStatus === 'ready' && !waitingForModel && !recording) {
            startRecording();
        }
    }, [whisperStatus, waitingForModel]);

    // If still waiting for model, allow cancel
    useEffect(() => {
        if (whisperStatus !== 'ready') {
            setWaitingForModel(true);
        }
    }, [whisperStatus]);

    // Format time as MM:SS
    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return { mins: mins.toString().padStart(2, '0'), secs: secs.toString().padStart(2, '0') };
    };

    const time = formatTime(elapsedTime);

    // Loading state - waiting for model
    if (waitingForModel && whisperStatus !== 'ready') {
        return (
            <div className="recording-screen loading-model">
                <div className="model-loading-container">
                    <div className="model-loading-icon">
                        <svg className="mic-loading" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                            <line x1="12" y1="19" x2="12" y2="23" />
                            <line x1="8" y1="23" x2="16" y2="23" />
                        </svg>
                    </div>
                    <h2 className="model-loading-title">
                        {loadingMessage || 'Loading transcription model...'}
                    </h2>
                    <p className="model-loading-subtitle">
                        This only happens once. The model will be cached for future use.
                    </p>
                    {progressItems.length > 0 && (
                        <div className="model-progress-container">
                            {progressItems.map(({ file, progress, total }, i) => (
                                <Progress key={i} text={file} percentage={progress} total={total} />
                            ))}
                        </div>
                    )}
                    <button className="cancel-button model-cancel" onClick={() => navigate('/')}>
                        Cancel
                    </button>
                </div>
            </div>
        );
    }

    // Saving/Processing state
    if (isSaving) {
        return (
            <div className="recording-screen saving">
                <div className="saving-animation">
                    <div className="pencil-circle">
                        <svg className="pencil-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                    </div>
                </div>
                <h2 className="saving-title">Scribbling down your thoughts...</h2>
                <p className="saving-subtitle">Just a moment</p>
                <button className="cancel-button" onClick={cancelRecording}>
                    <span className="cancel-icon">×</span>
                    Cancel
                </button>
            </div>
        );
    }

    return (
        <div className="recording-screen">
            {/* Header */}
            <div className="recording-header">
                <button className="close-button" onClick={cancelRecording}>×</button>
                <div className="recording-indicator">
                    <span className="recording-dot"></span>
                    LISTENING...
                </div>
                <button className="settings-button">⚙</button>
            </div>

            {/* Timer */}
            <div className="timer">
                <div className="timer-segment">
                    <span className="timer-value">{time.mins}</span>
                    <span className="timer-label">MIN</span>
                </div>
                <span className="timer-separator">:</span>
                <div className="timer-segment">
                    <span className="timer-value">{time.secs}</span>
                    <span className="timer-label">SEC</span>
                </div>
            </div>

            {/* Transcript */}
            <div className="transcript-container">
                <span className="quote-mark left">"</span>
                <div className="transcript-scroll-area" ref={transcriptScrollRef}>
                    <p className="transcript-text">
                        {committedWords.map((item, idx) => (
                            <span
                                key={`committed-${idx}`}
                                className={item.isNew ? 'word-new' : ''}
                            >
                                {idx > 0 ? ' ' : ''}{item.word}
                            </span>
                        ))}
                        {tentativeText && (
                            <span className="tentative-text">
                                {committedText ? ' ' : ''}{tentativeText}
                            </span>
                        )}
                        <span className="cursor">|</span>
                    </p>
                </div>
                <span className="quote-mark right">"</span>
            </div>

            {/* Waveform */}
            <div className="waveform">
                {audioLevels.map((level, idx) => (
                    <div
                        key={idx}
                        className="waveform-bar"
                        style={{ height: `${level * 40}px` }}
                    />
                ))}
            </div>


            {/* Controls */}
            <div className="controls">
                <button className="stop-button" onClick={stopRecording}>
                    <span className="stop-icon">■</span>
                    Stop Recording
                </button>
                <button className="cancel-text-button" onClick={cancelRecording}>
                    Cancel
                </button>
            </div>
        </div>
    );
}

export default RecordingScreen;
