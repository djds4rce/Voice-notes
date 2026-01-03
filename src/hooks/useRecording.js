import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettings } from '../contexts/SettingsContext';
import { DEVICE, IS_IOS } from './useWhisperModel';
import { WHISPER_SAMPLING_RATE } from './recordingConstants';
import { useWebRecordingStrategy } from './useWebRecordingStrategy';
import { useIOSRecordingStrategy } from './useIOSRecordingStrategy';

export function useRecording({ worker, onSaveNote, whisperStatus }) {
    const navigate = useNavigate();
    const { language: currentLanguage, taggingEnabled: currentTagging, isEnglish: currentIsEnglish } = useSettings();

    // Recording state
    const [recording, setRecording] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [elapsedTime, setElapsedTime] = useState(0);

    // Transcription state
    const [committedText, setCommittedText] = useState('');
    const [tentativeText, setTentativeText] = useState('');

    // Refs
    const committedTextRef = useRef('');
    const tentativeTextRef = useRef('');
    const committedChunksRef = useRef([]);
    const tagsRef = useRef([]);

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

    // Lifecycle refs
    const finalDataResolveRef = useRef(null);
    const finalProcessingResolveRef = useRef(null);
    const finalizationResolveRef = useRef(null);

    // Strategy Context
    const strategyContext = {
        worker,
        language: currentLanguage,
        audioContextRef,
        chunksRef,
        recorderRef,
        lastProcessedSamples,
        isProcessing,
        finalDataResolveRef
    };

    // Instantiate strategies
    const webStrategy = useWebRecordingStrategy(strategyContext);
    const iosStrategy = useIOSRecordingStrategy(strategyContext);

    // Select strategy
    const strategy = IS_IOS ? iosStrategy : webStrategy;

    // Worker Message Handler
    useEffect(() => {
        if (!worker) return;

        const handleMessage = (e) => {
            switch (e.data.status) {
                case 'start':
                    setIsProcessing(true);
                    break;

                case 'update': {
                    const { committed, tentative, committedChunks } = e.data;
                    setCommittedText(committed || '');
                    setTentativeText(tentative || '');
                    committedTextRef.current = committed || '';
                    tentativeTextRef.current = tentative || '';
                    if (committedChunks && committedChunks.length > 0) {
                        committedChunksRef.current = committedChunks;
                    }
                    break;
                }

                case 'complete':
                    setIsProcessing(false);
                    if (finalProcessingResolveRef.current) {
                        finalProcessingResolveRef.current();
                        finalProcessingResolveRef.current = null;
                    } else {
                        // Request more data if still recording (Web only usually)
                        setTimeout(() => {
                            if (recorderRef.current?.state === 'recording') {
                                recorderRef.current.requestData();
                            }
                        }, 100);
                    }
                    break;

                case 'finalized': {
                    setIsProcessing(false);
                    const { committed, committedChunks, tags, error } = e.data;
                    console.log('[useRecording] Received finalized signal');

                    if (error) alert(`Transcription Error: ${error}`);

                    if (committed) {
                        committedTextRef.current = committed;
                        tentativeTextRef.current = '';
                    }
                    if (committedChunks) {
                        committedChunksRef.current = committedChunks;
                    }
                    if (tags) {
                        tagsRef.current = tags;
                    }

                    if (finalizationResolveRef.current) {
                        finalizationResolveRef.current();
                        finalizationResolveRef.current = null;
                    }
                    break;
                }
            }
        };

        worker.addEventListener('message', handleMessage);
        return () => worker.removeEventListener('message', handleMessage);
    }, [worker]);

    // Audio Visualization Loop
    const updateAudioLevels = useCallback(() => {
        if (!analyserRef.current) return;

        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(dataArray);

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

    const startRecording = useCallback(async () => {
        worker?.postMessage({ type: 'reset' });

        try {
            const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = mediaStream;
            audioContextRef.current = new AudioContext({ sampleRate: WHISPER_SAMPLING_RATE });

            // iOS requirement: Resume context if suspended (often happens if created outside direct touch event)
            if (audioContextRef.current.state === 'suspended') {
                await audioContextRef.current.resume();
            }

            const source = audioContextRef.current.createMediaStreamSource(mediaStream);
            analyserRef.current = audioContextRef.current.createAnalyser();
            analyserRef.current.fftSize = 256;
            source.connect(analyserRef.current);

            recorderRef.current = new MediaRecorder(mediaStream);
            chunksRef.current = [];
            lastProcessedSamples.current = 0;

            // Strategy hook injection
            recorderRef.current.ondataavailable = strategy.onDataAvailable;

            recorderRef.current.onstop = () => setRecording(false);

            // iOS: Start with 1s timeslice to auto-fire ondataavailable
            // Desktop: Start without timeslice, driven by manual requestData in WebStrategy
            if (IS_IOS) {
                recorderRef.current.start(1000);
            } else {
                recorderRef.current.start();
            }

            setRecording(true);

            startTimeRef.current = Date.now();
            timerRef.current = setInterval(() => {
                setElapsedTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
            }, 1000);

            updateAudioLevels();

            // Initial request - only for Desktop Web Strategy which needs manual kickstart
            if (!IS_IOS) {
                setTimeout(() => {
                    if (recorderRef.current?.state === 'recording') {
                        console.log('[useRecording] Initial requestData()');
                        recorderRef.current.requestData();
                    }
                }, 1000);
            }

        } catch (err) {
            console.error('Error starting recording:', err);
        }
    }, [worker, strategy, updateAudioLevels]);

    const stopRecording = useCallback(async () => {
        console.log('[useRecording] Stopping recording...');

        if (animationRef.current) cancelAnimationFrame(animationRef.current);
        if (timerRef.current) clearInterval(timerRef.current);

        setRecording(false);
        setIsSaving(true);

        // 1. Stop Recorder & Get Final Data
        let finalDataPromise = null;
        if (recorderRef.current?.state === 'recording') {
            finalDataPromise = new Promise((resolve) => {
                finalDataResolveRef.current = resolve;
                setTimeout(() => {
                    if (finalDataResolveRef.current) {
                        finalDataResolveRef.current(); // resolve anyway on timeout
                        finalDataResolveRef.current = null;
                    }
                }, 2000);
            });
            recorderRef.current.requestData();
            recorderRef.current.stop();
        }

        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
        }

        if (finalDataPromise) await finalDataPromise;

        // 2. Wait for in-progress processing
        if (isProcessing) {
            await new Promise((resolve) => {
                finalProcessingResolveRef.current = resolve;
                setTimeout(() => {
                    // Force resolve after timeout
                    if (finalProcessingResolveRef.current) {
                        finalProcessingResolveRef.current();
                        finalProcessingResolveRef.current = null;
                    }
                }, 10000);
            });
        }

        // 3. Finalize
        const payload = await strategy.getFinalizePayload();

        if (payload && worker) {
            const { audio, audioWindowStart, batchMode, timeoutMs } = payload;

            console.log(`[useRecording] Finalizing with batchMode=${batchMode}`);

            const finalizationPromise = new Promise(resolve => {
                finalizationResolveRef.current = resolve;
                setTimeout(() => {
                    if (finalizationResolveRef.current) {
                        console.warn('[useRecording] Finalize timeout');
                        finalizationResolveRef.current();
                        finalizationResolveRef.current = null;
                    }
                }, timeoutMs);
            });

            worker.postMessage({
                type: 'finalize',
                data: {
                    audio,
                    language: currentLanguage,
                    audioWindowStart,
                    taggingEnabled: currentIsEnglish && currentTagging && !IS_IOS,
                    batchMode
                }
            });

            await finalizationPromise;
        }

        // 4. Save
        const audioBlob = new Blob(chunksRef.current, { type: recorderRef.current?.mimeType || 'audio/webm' });
        const finalTranscript = (committedTextRef.current + ' ' + tentativeTextRef.current).trim();

        if (finalTranscript.length > 0 && onSaveNote) {
            await onSaveNote({
                transcript: finalTranscript,
                audioBlob,
                durationSeconds: elapsedTime,
                wordTimestamps: committedChunksRef.current,
                tags: tagsRef.current
            });
        } else if (chunksRef.current.length > 0 && onSaveNote) {
            const saveAnyway = confirm(`Transcription failed. Save audio anyway?\nDuration: ${elapsedTime}s`);
            if (saveAnyway) {
                await onSaveNote({
                    transcript: '[Transcription failed - audio only]',
                    audioBlob,
                    durationSeconds: elapsedTime,
                    wordTimestamps: [],
                    tags: []
                });
            }
        } else {
            alert('No audio recorded.');
        }

        setIsSaving(false);
        navigate('/');

    }, [worker, strategy, currentLanguage, currentTagging, currentIsEnglish, onSaveNote, elapsedTime, navigate, isProcessing]);

    const cancelRecording = useCallback(() => {
        if (animationRef.current) cancelAnimationFrame(animationRef.current);
        if (timerRef.current) clearInterval(timerRef.current);
        if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
        if (streamRef.current) streamRef.current.getTracks().forEach(track => track.stop());

        worker?.postMessage({ type: 'reset' });
        navigate('/');
    }, [worker, navigate]);

    // Auto-start
    const hasStartedRecording = useRef(false);
    useEffect(() => {
        if (hasStartedRecording.current) return;
        if (whisperStatus === 'ready') {
            hasStartedRecording.current = true;
            // setWaitingForModel handled by consumer checking whisperStatus vs start
            startRecording();
        }
    }, [whisperStatus, startRecording]);

    return {
        recording,
        isProcessing,
        isSaving,
        elapsedTime,
        audioLevels,
        committedText,
        tentativeText,
        startRecording,
        stopRecording,
        cancelRecording
    };
}
