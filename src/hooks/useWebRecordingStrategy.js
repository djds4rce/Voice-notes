import { useCallback } from 'react';
import { WHISPER_SAMPLING_RATE, MAX_SAMPLES, WINDOW_SHIFT_SAMPLES } from './recordingConstants';
import { decodeAudioBlob } from '../utils/audioUtils';

export function useWebRecordingStrategy({
    worker,
    language,
    audioContextRef,
    chunksRef,
    recorderRef,
    lastProcessedSamples,
    isProcessing,
    finalDataResolveRef
}) {
    // Process audio chunks for live transcription
    const processAudioChunks = useCallback(async () => {
        if (chunksRef.current.length === 0) return;
        if (!audioContextRef.current) return;
        if (isProcessing) return;

        const blob = new Blob(chunksRef.current, {
            type: recorderRef.current?.mimeType || 'audio/webm'
        });

        try {
            const allAudio = await decodeAudioBlob(blob, audioContextRef.current);

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
                    data: { audio: audioToProcess, language, audioWindowStart },
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
    }, [worker, language, isProcessing, audioContextRef, chunksRef, recorderRef, lastProcessedSamples]);

    const onDataAvailable = useCallback((e) => {
        if (e.data.size > 0) {
            chunksRef.current.push(e.data);

            // If we're stopping and waiting for final data, resolve the promise
            if (finalDataResolveRef.current) {
                finalDataResolveRef.current();
                // It's up to the caller to clear the ref, or we can do it here if we had setter
                // But ref mutation is fine.
                // However, RecordingScreen cleared it. We should probably just notify?
                // For now, let's assume the mutation is handled or we just call it.
                // finalDataResolveRef.current = null; // We can't easily nullify the ref content passed in unless we pass the ref object itself.
                // We passed the ref, so we can mute it.
                finalDataResolveRef.current = null;
            } else {
                // Process chunks for live transcription
                processAudioChunks();
            }
        }
    }, [processAudioChunks, chunksRef, finalDataResolveRef]);

    const getFinalizePayload = useCallback(async () => {
        if (chunksRef.current.length === 0 || !audioContextRef.current) return null;

        const blob = new Blob(chunksRef.current, {
            type: recorderRef.current?.mimeType || 'audio/webm'
        });
        const allAudio = await decodeAudioBlob(blob, audioContextRef.current);

        let audioToProcess = allAudio;
        let audioWindowStart = 0;

        // Desktop: Only send remaining window (live transcription already handled earlier chunks)
        if (audioToProcess.length > MAX_SAMPLES) {
            const excessSamples = audioToProcess.length - MAX_SAMPLES;
            const numShifts = Math.ceil(excessSamples / WINDOW_SHIFT_SAMPLES);
            const samplesToSkip = numShifts * WINDOW_SHIFT_SAMPLES;
            audioWindowStart = samplesToSkip / WHISPER_SAMPLING_RATE;
            audioToProcess = allAudio.slice(samplesToSkip, samplesToSkip + MAX_SAMPLES);
        }

        return {
            audio: audioToProcess,
            audioWindowStart,
            batchMode: false,
            timeoutMs: 30000 // 30s for desktop
        };
    }, [chunksRef, audioContextRef, recorderRef]);

    return {
        onDataAvailable,
        getFinalizePayload
    };
}
