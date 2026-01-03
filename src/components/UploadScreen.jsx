/**
 * UploadScreen
 * 
 * Upload interface for transcribing audio files:
 * - Model loading state with progress
 * - Transcribing state animation
 * - Error handling
 * - Uses same Whisper model as recording
 */

import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { IS_IOS } from '../hooks/useWhisperModel';
import { useSettings } from '../contexts/SettingsContext';
import Progress from './Progress';
import './UploadScreen.css';

export function UploadScreen({ worker, onSaveNote, whisperStatus, progressItems = [], loadingMessage = '' }) {
    const navigate = useNavigate();
    const location = useLocation();

    // Get settings from context
    const { language: currentLanguage, taggingEnabled: currentTagging, isEnglish } = useSettings();

    // Get the audio file from navigation state
    const audioFile = location.state?.audioFile;

    // Upload states: 'loading-model' | 'transcribing' | 'error' | 'complete'
    const [uploadState, setUploadState] = useState('loading-model');
    const [errorMessage, setErrorMessage] = useState('');
    const [transcriptionResult, setTranscriptionResult] = useState(null);
    const [audioDuration, setAudioDuration] = useState(0);
    const [transcriptionProgress, setTranscriptionProgress] = useState(0);

    // Handle worker messages for upload-specific events only
    // Note: 'ready' is already tracked via whisperStatus prop from useWhisperModel
    useEffect(() => {
        if (!worker) return;

        const handleMessage = (e) => {
            const { status } = e.data;

            switch (status) {
                case 'upload-transcribing':
                    setUploadState('transcribing');
                    setTranscriptionProgress(e.data.progress || 0);
                    break;

                case 'upload-progress':
                    setTranscriptionProgress(e.data.progress || 0);
                    break;

                case 'upload-complete': {
                    const { text, chunks, tags } = e.data;
                    setTranscriptionResult({ text, chunks, tags });
                    setTranscriptionProgress(100);
                    setUploadState('complete');
                    break;
                }

                case 'upload-error': {
                    setErrorMessage(e.data.error || 'Transcription failed');
                    setUploadState('error');
                    break;
                }

                case 'error':
                    setErrorMessage(e.data.error || 'Failed to load model');
                    setUploadState('error');
                    break;
            }
        };

        worker.addEventListener('message', handleMessage);
        return () => worker.removeEventListener('message', handleMessage);
    }, [worker, audioFile, uploadState]);

    // Start transcription when model is ready
    const startTranscription = useCallback(async () => {
        if (!audioFile || !worker) return;

        setUploadState('transcribing');

        try {
            // Read audio file as ArrayBuffer
            const arrayBuffer = await audioFile.arrayBuffer();

            // Decode audio to get Float32Array at 16kHz
            const audioContext = new AudioContext({ sampleRate: 16000 });
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

            // Get mono audio data
            const audioData = audioBuffer.getChannelData(0);

            // Store duration for later
            setAudioDuration(audioBuffer.duration);

            // Close audio context
            await audioContext.close();

            // Send to worker for transcription
            worker.postMessage({
                type: 'transcribe-upload',
                data: {
                    audio: audioData,
                    language: currentLanguage,
                    taggingEnabled: isEnglish && currentTagging && !IS_IOS
                }
            });
        } catch (error) {
            console.error('[UploadScreen] Error processing audio:', error);
            setErrorMessage(`Failed to process audio: ${error.message}`);
            setUploadState('error');
        }
    }, [audioFile, worker, currentLanguage, currentTagging, isEnglish]);

    // Auto-start when model becomes ready OR if already ready on mount
    useEffect(() => {
        console.log('[UploadScreen] whisperStatus:', whisperStatus, 'uploadState:', uploadState, 'audioFile:', !!audioFile);
        if (whisperStatus === 'ready' && uploadState === 'loading-model' && audioFile) {
            console.log('[UploadScreen] Model ready, starting transcription...');
            startTranscription();
        }
    }, [whisperStatus, uploadState, audioFile, startTranscription]);

    // Save note when transcription completes
    useEffect(() => {
        if (uploadState === 'complete' && transcriptionResult && audioFile) {
            const saveNote = async () => {
                try {
                    // Convert File to Blob for storage
                    const audioBlob = new Blob([await audioFile.arrayBuffer()], { type: audioFile.type });

                    await onSaveNote({
                        transcript: transcriptionResult.text,
                        audioBlob,
                        durationSeconds: audioDuration,
                        wordTimestamps: transcriptionResult.chunks || [],
                        tags: transcriptionResult.tags || []
                    });

                    navigate('/');
                } catch (error) {
                    console.error('[UploadScreen] Error saving note:', error);
                    setErrorMessage('Failed to save note');
                    setUploadState('error');
                }
            };

            saveNote();
        }
    }, [uploadState, transcriptionResult, audioFile, onSaveNote, navigate]);

    // Handle no file case
    useEffect(() => {
        if (!audioFile) {
            navigate('/');
        }
    }, [audioFile, navigate]);

    const handleCancel = () => {
        navigate('/');
    };

    // Error state
    if (uploadState === 'error') {
        return (
            <div className="upload-screen error-state">
                <div className="upload-container">
                    <div className="upload-icon error">
                        <svg className="error-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="12" y1="8" x2="12" y2="12" />
                            <line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                    </div>
                    <h2 className="upload-title error">
                        {errorMessage || 'Something went wrong'}
                    </h2>
                    <p className="upload-subtitle">
                        Please try again or use a different audio file.
                    </p>
                    <button className="cancel-button" onClick={handleCancel}>
                        Go Back
                    </button>
                </div>
            </div>
        );
    }

    // Loading model state
    if (uploadState === 'loading-model' || whisperStatus !== 'ready') {
        return (
            <div className="upload-screen loading-model">
                <div className="upload-container">
                    <div className="upload-icon">
                        <svg className="upload-loading" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="17 8 12 3 7 8" />
                            <line x1="12" y1="3" x2="12" y2="15" />
                        </svg>
                    </div>
                    <h2 className="upload-title">
                        {loadingMessage || 'Loading transcription model...'}
                    </h2>
                    <p className="upload-subtitle">
                        This only happens once. The model will be cached for future use.
                    </p>
                    {progressItems.length > 0 && (
                        <div className="upload-progress-container">
                            {progressItems.map(({ file, progress, total }, i) => (
                                <Progress key={i} text={file} percentage={progress} total={total} />
                            ))}
                        </div>
                    )}
                    <button className="cancel-button" onClick={handleCancel}>
                        Cancel
                    </button>
                </div>
            </div>
        );
    }

    // Transcribing state
    return (
        <div className="upload-screen transcribing">
            <div className="upload-container">
                <div className="transcribe-animation">
                    <div className="waveform-circle">
                        <div className="wave-bar" style={{ animationDelay: '0s' }}></div>
                        <div className="wave-bar" style={{ animationDelay: '0.1s' }}></div>
                        <div className="wave-bar" style={{ animationDelay: '0.2s' }}></div>
                        <div className="wave-bar" style={{ animationDelay: '0.3s' }}></div>
                        <div className="wave-bar" style={{ animationDelay: '0.4s' }}></div>
                    </div>
                </div>
                <h2 className="upload-title">
                    Transcribing your audio...
                </h2>
                <p className="upload-subtitle">
                    {transcriptionProgress > 0 ? `${transcriptionProgress}% complete` : (IS_IOS ? 'This may take a moment on mobile' : 'Processing...')}
                </p>
                {transcriptionProgress > 0 && (
                    <div className="transcription-progress-bar">
                        <div
                            className="transcription-progress-fill"
                            style={{ width: `${transcriptionProgress}%` }}
                        />
                    </div>
                )}
                <button className="cancel-button" onClick={handleCancel}>
                    <span className="cancel-icon">×</span>
                    Cancel
                </button>
            </div>
        </div>
    );
}

export default UploadScreen;
