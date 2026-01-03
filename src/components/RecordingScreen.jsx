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

import { useEffect, useState, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { DEVICE, IS_IOS } from '../hooks/useWhisperModel';
import { useRecording } from '../hooks/useRecording';
import Progress from './Progress';
import './RecordingScreen.css';

export function RecordingScreen({ worker, onSaveNote, whisperStatus, progressItems = [], loadingMessage = '' }) {
    const navigate = useNavigate();

    // Use the recording hook
    const {
        recording,
        isProcessing,
        isSaving,
        elapsedTime,
        audioLevels,
        committedText,
        tentativeText,
        stopRecording,
        cancelRecording
    } = useRecording({ worker, onSaveNote, whisperStatus });

    // Track if we're waiting for model to load
    const [waitingForModel, setWaitingForModel] = useState(whisperStatus !== 'ready');

    // Update waiting state
    useEffect(() => {
        if (whisperStatus === 'ready') {
            setWaitingForModel(false);
        } else {
            setWaitingForModel(true);
        }
    }, [whisperStatus]);

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

    // Format time as MM:SS
    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return { mins: mins.toString().padStart(2, '0'), secs: secs.toString().padStart(2, '0') };
    };

    const time = formatTime(elapsedTime);

    // Loading state - waiting for model
    if (waitingForModel && whisperStatus !== 'ready') {
        // Error state
        if (whisperStatus === 'error') {
            return (
                <div className="recording-screen loading-model">
                    <div className="model-loading-container">
                        <div className="model-loading-icon error">
                            <svg className="error-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="12" cy="12" r="10" />
                                <line x1="12" y1="8" x2="12" y2="12" />
                                <line x1="12" y1="16" x2="12.01" y2="16" />
                            </svg>
                        </div>
                        <h2 className="model-loading-title error">
                            Failed to load transcription model
                        </h2>
                        <p className="model-loading-subtitle">
                            {loadingMessage || 'An error occurred while loading the AI model.'}
                        </p>
                        <p className="model-loading-hint">
                            This may happen on some mobile browsers. Try refreshing the page or using a different browser.
                        </p>
                        <button className="cancel-button model-cancel" onClick={() => navigate('/')}>
                            Go Back
                        </button>
                    </div>
                </div>
            );
        }

        // Loading state
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
                <h2 className="saving-title">
                    {loadingMessage || 'Scribbling down your thoughts...'}
                </h2>
                <p className="saving-subtitle">
                    {IS_IOS && loadingMessage ? 'This may take a moment on mobile' : 'Just a moment'}
                </p>
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
                    {IS_IOS ? (
                        <p className="transcript-text ios-placeholder">
                            {committedWords.length > 0 || tentativeText ? (
                                <>
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
                                </>
                            ) : (
                                <span className="placeholder-text">
                                    Live transcription is not available on iOS.
                                    Processing will happen after you stop recording.
                                </span>
                            )}
                            <span className="cursor">|</span>
                        </p>
                    ) : (
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
                    )}
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
