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
import './RecordingScreen.css';

const WHISPER_SAMPLING_RATE = 16_000;
const MAX_AUDIO_LENGTH = 30; // seconds
const MAX_SAMPLES = WHISPER_SAMPLING_RATE * MAX_AUDIO_LENGTH;
const WINDOW_SHIFT = 20; // seconds
const WINDOW_SHIFT_SAMPLES = WHISPER_SAMPLING_RATE * WINDOW_SHIFT;

export function RecordingScreen({ worker, onSaveNote }) {
    const navigate = useNavigate();

    // Recording state
    const [recording, setRecording] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [elapsedTime, setElapsedTime] = useState(0);

    // Transcription state
    const [committedText, setCommittedText] = useState('');
    const [tentativeText, setTentativeText] = useState('');
    const [committedChunks, setCommittedChunks] = useState([]);

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
                    if (chunks && chunks.length > 0) {
                        setCommittedChunks(chunks);
                    }
                    break;
                }

                case 'complete':
                    setIsProcessing(false);
                    // Request more data if still recording
                    setTimeout(() => {
                        if (recorderRef.current?.state === 'recording') {
                            recorderRef.current.requestData();
                        }
                    }, 100);
                    break;
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
                    processAudioChunks();
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

        setRecording(false);
        setIsSaving(true);

        // Create final audio blob
        const audioBlob = new Blob(chunksRef.current, {
            type: recorderRef.current?.mimeType || 'audio/webm'
        });

        // Get final transcript
        const finalTranscript = committedText + (tentativeText ? ' ' + tentativeText : '');

        if (finalTranscript.trim().length > 0 && onSaveNote) {
            await onSaveNote({
                transcript: finalTranscript.trim(),
                audioBlob,
                durationSeconds: elapsedTime,
                wordTimestamps: committedChunks,
            });
        }

        setIsSaving(false);
        navigate('/');
    }, [committedText, tentativeText, elapsedTime, onSaveNote, navigate]);

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

    // Start recording on mount
    useEffect(() => {
        startRecording();
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
            if (animationRef.current) cancelAnimationFrame(animationRef.current);
        };
    }, []);

    // Format time as MM:SS
    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return { mins: mins.toString().padStart(2, '0'), secs: secs.toString().padStart(2, '0') };
    };

    const time = formatTime(elapsedTime);

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
            <p className="tap-hint">Tap to pause</p>

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
