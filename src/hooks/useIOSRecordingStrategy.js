import { useCallback } from 'react';
import { decodeAudioBlob } from '../utils/audioUtils';

export function useIOSRecordingStrategy({
    chunksRef,
    recorderRef,
    finalDataResolveRef,
    audioContextRef
}) {
    const onDataAvailable = useCallback((e) => {
        if (e.data.size > 0) {
            chunksRef.current.push(e.data);

            if (finalDataResolveRef.current) {
                finalDataResolveRef.current();
                finalDataResolveRef.current = null;
            } else {
                // iOS: Skip live transcription but keep collecting audio chunks
                // Schedule next data request to accumulate chunks
                setTimeout(() => {
                    if (recorderRef.current?.state === 'recording') {
                        recorderRef.current.requestData();
                    }
                }, 1000); // Request data every 1 second on iOS
            }
        }
    }, [chunksRef, finalDataResolveRef, recorderRef]);

    const getFinalizePayload = useCallback(async () => {
        if (chunksRef.current.length === 0 || !audioContextRef.current) return null;

        const blob = new Blob(chunksRef.current, {
            type: recorderRef.current?.mimeType || 'audio/webm'
        });
        const allAudio = await decodeAudioBlob(blob, audioContextRef.current);

        // iOS: Send full audio for batch transcription (no live transcription was done)
        return {
            audio: allAudio,
            audioWindowStart: 0,
            batchMode: true,
            timeoutMs: 300000 // 5 minutes for iOS
        };
    }, [chunksRef, audioContextRef, recorderRef]);

    return {
        onDataAvailable,
        getFinalizePayload
    };
}
