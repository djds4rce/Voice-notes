/**
 * useWhisperModel - Custom hook for Whisper model loading and management
 * 
 * Handles:
 * - Worker initialization for Whisper transcription
 * - Background model preloading on page load
 * - Model reloading when settings change
 * - Progress tracking for model downloads
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { useSettings } from '../contexts/SettingsContext';

// Check WebGPU availability
const IS_WEBGPU_AVAILABLE = !!navigator.gpu;

// Check for localStorage override to force WASM mode (for testing)
const forceWasm = localStorage.getItem('force-wasm') === 'true';

// Determine device: respect override, otherwise detect capability
export const DEVICE = (IS_WEBGPU_AVAILABLE && !forceWasm) ? "webgpu" : "wasm";

export function useWhisperModel() {
    // Worker reference for Whisper transcription
    const worker = useRef(null);

    // Model loading state
    const [status, setStatus] = useState(null);
    const [loadingMessage, setLoadingMessage] = useState('');
    const [progressItems, setProgressItems] = useState([]);

    // Get settings from context
    const {
        whisperModel,
        isEnglish,
        taggingEnabled,
    } = useSettings();

    // Track if initial load has been triggered
    const hasTriggeredLoad = useRef(false);
    // Track previous model to detect changes
    const previousModelRef = useRef(null);
    // Track previous language to detect changes (English uses .en models)
    const previousLanguageRef = useRef(null);

    // Setup worker for Whisper
    useEffect(() => {
        if (!worker.current) {
            worker.current = new Worker(new URL('../worker.js', import.meta.url), {
                type: 'module',
            });
        }

        const onMessageReceived = (e) => {
            switch (e.data.status) {
                case 'loading':
                    setStatus('loading');
                    setLoadingMessage(e.data.data);
                    break;

                case 'initiate':
                    setProgressItems((prev) => [...prev, e.data]);
                    break;

                case 'progress':
                    setProgressItems((prev) =>
                        prev.map((item) => {
                            if (item.file === e.data.file) {
                                return { ...item, ...e.data };
                            }
                            return item;
                        }),
                    );
                    break;

                case 'done':
                    setProgressItems((prev) =>
                        prev.filter((item) => item.file !== e.data.file),
                    );
                    break;

                case 'ready':
                    setStatus('ready');
                    break;

                case 'error':
                    setStatus('error');
                    setLoadingMessage(e.data.error || 'Failed to load model');
                    break;
            }
        };

        worker.current.addEventListener('message', onMessageReceived);

        return () => {
            worker.current?.removeEventListener('message', onMessageReceived);
        };
    }, []);

    // Load Whisper model - memoized with current settings
    const loadModel = useCallback((modelId, options = {}) => {
        if (!worker.current) return;

        const shouldLoadTags = isEnglish && taggingEnabled;
        worker.current.postMessage({
            type: 'load',
            data: {
                modelId: modelId || whisperModel,
                taggingEnabled: shouldLoadTags,
                device: DEVICE,
                language: isEnglish ? 'en' : 'other',
            }
        });
        setStatus('loading');
    }, [whisperModel, isEnglish, taggingEnabled]);

    // Auto-load model on mount - triggered once when settings are available
    useEffect(() => {
        // Wait for whisperModel to be available from context
        if (!whisperModel) return;

        // Only trigger initial load once
        if (!hasTriggeredLoad.current) {
            hasTriggeredLoad.current = true;
            previousModelRef.current = whisperModel;
            previousLanguageRef.current = isEnglish;

            const shouldLoadTags = isEnglish && taggingEnabled;
            worker.current?.postMessage({
                type: 'load',
                data: {
                    modelId: whisperModel,
                    taggingEnabled: shouldLoadTags,
                    device: DEVICE,
                    language: isEnglish ? 'en' : 'other',
                }
            });
            setStatus('loading');
        }
    }, [whisperModel, isEnglish, taggingEnabled]);

    // Auto-reload model when whisperModel or language changes (debounced by 5 seconds)
    useEffect(() => {
        // Skip if initial load hasn't happened yet
        if (!hasTriggeredLoad.current) return;

        // Skip if neither model nor language changed
        const modelChanged = previousModelRef.current !== whisperModel;
        const languageChanged = previousLanguageRef.current !== isEnglish;
        if (!modelChanged && !languageChanged) return;

        const timer = setTimeout(() => {
            previousModelRef.current = whisperModel;
            previousLanguageRef.current = isEnglish;
            const shouldLoadTags = isEnglish && taggingEnabled;
            worker.current?.postMessage({
                type: 'load',
                data: {
                    modelId: whisperModel,
                    taggingEnabled: shouldLoadTags,
                    device: DEVICE,
                    language: isEnglish ? 'en' : 'other',
                }
            });
            setStatus('loading');
        }, 5000);

        return () => {
            clearTimeout(timer);
        };
    }, [whisperModel, isEnglish, taggingEnabled]);

    return {
        worker,
        status,
        loadingMessage,
        progressItems,
        loadModel,
        device: DEVICE,
    };
}
