/**
 * AudioPlayer - Clean implementation with howler.js
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Howl } from 'howler';
import './AudioPlayer.css';

const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function AudioPlayer({ note, onClose }) {
    const navigate = useNavigate();

    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [playbackSpeed, setPlaybackSpeed] = useState(1);
    const [showTranscript, setShowTranscript] = useState(false);
    const [isReady, setIsReady] = useState(false);

    const howlRef = useRef(null);
    const intervalRef = useRef(null);

    // Initialize duration from note
    useEffect(() => {
        if (note?.duration_seconds) {
            setDuration(note.duration_seconds);
        }
    }, [note?.id]);

    // Setup Howl when note changes
    useEffect(() => {
        if (!note?.audioBlob) return;

        // Cleanup
        if (howlRef.current) {
            howlRef.current.unload();
        }
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
        }

        const blobUrl = URL.createObjectURL(note.audioBlob);

        const howl = new Howl({
            src: [blobUrl],
            html5: true,
            format: ['webm', 'mp3', 'wav', 'ogg'], // Try multiple formats
            onload: () => {
                console.log('Audio loaded, duration:', howl.duration());
                setDuration(howl.duration());
                setIsReady(true);
            },
            onplay: () => {
                setIsPlaying(true);
                // Start updating time
                intervalRef.current = setInterval(() => {
                    const time = howl.seek();
                    setCurrentTime(time);
                }, 100);
            },
            onpause: () => {
                setIsPlaying(false);
                if (intervalRef.current) {
                    clearInterval(intervalRef.current);
                }
            },
            onend: () => {
                setIsPlaying(false);
                setCurrentTime(0);
                if (intervalRef.current) {
                    clearInterval(intervalRef.current);
                }
            },
            onseek: () => {
                setCurrentTime(howl.seek());
            }
        });

        howlRef.current = howl;

        return () => {
            howl.unload();
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
            }
            URL.revokeObjectURL(blobUrl);
        };
    }, [note?.audioBlob]);

    // Update playback speed
    useEffect(() => {
        if (howlRef.current) {
            howlRef.current.rate(playbackSpeed);
        }
    }, [playbackSpeed]);

    const togglePlay = () => {
        if (!howlRef.current || !isReady) return;
        if (isPlaying) {
            howlRef.current.pause();
        } else {
            howlRef.current.play();
        }
    };

    const skip = (seconds) => {
        if (!howlRef.current || !isReady) return;
        const current = howlRef.current.seek() || 0;
        const newTime = Math.max(0, Math.min(duration, current + seconds));
        console.log(`Skipping ${seconds}s from ${current} to ${newTime}`);
        howlRef.current.seek(newTime);
        setCurrentTime(newTime);
    };

    const handleSeek = (e) => {
        if (!howlRef.current || !isReady) return;
        const newTime = parseFloat(e.target.value);
        howlRef.current.seek(newTime);
        setCurrentTime(newTime);
    };

    const handleSeekInput = (e) => {
        setCurrentTime(parseFloat(e.target.value));
    };

    const cycleSpeed = () => {
        const idx = PLAYBACK_SPEEDS.indexOf(playbackSpeed);
        const nextIdx = (idx + 1) % PLAYBACK_SPEEDS.length;
        setPlaybackSpeed(PLAYBACK_SPEEDS[nextIdx]);
    };

    const formatTime = (seconds) => {
        if (!seconds || isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const currentWordIndex = useMemo(() => {
        if (!note?.wordTimestamps?.length) return -1;
        for (let i = note.wordTimestamps.length - 1; i >= 0; i--) {
            if (currentTime >= note.wordTimestamps[i].start) {
                return i;
            }
        }
        return -1;
    }, [note?.wordTimestamps, currentTime]);

    const handleClose = () => {
        onClose ? onClose() : navigate('/');
    };

    if (!note) {
        return (
            <div className="audio-player-page">
                <div className="player-loading">Loading...</div>
            </div>
        );
    }

    return (
        <div className="audio-player-page">
            <header className="player-header">
                <button className="back-button" onClick={handleClose}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M19 12H5M12 19l-7-7 7-7" />
                    </svg>
                </button>
                <h1 className="player-title">{note.title || 'Voice Note'}</h1>
                <button
                    className={`transcript-toggle ${showTranscript ? 'active' : ''}`}
                    onClick={() => setShowTranscript(!showTranscript)}
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
                    </svg>
                </button>
            </header>

            <div className="player-content">
                {showTranscript ? (
                    <div className="transcript-view">
                        {note.wordTimestamps?.length > 0 ? (
                            <p className="full-transcript synced">
                                {note.wordTimestamps.map((word, idx) => {
                                    const isActive = idx === currentWordIndex;
                                    const isPast = idx < currentWordIndex;
                                    return (
                                        <span
                                            key={idx}
                                            className={`transcript-word${isActive ? ' active' : ''}${isPast ? ' past' : ''}`}
                                            onClick={() => {
                                                if (howlRef.current && isReady) {
                                                    howlRef.current.seek(word.start);
                                                    setCurrentTime(word.start);
                                                }
                                            }}
                                        >
                                            {idx > 0 ? ' ' : ''}{word.text}
                                        </span>
                                    );
                                })}
                            </p>
                        ) : (
                            <p className="full-transcript">{note.transcript}</p>
                        )}
                    </div>
                ) : (
                    <div className="waveform-view">
                        <div className="waveform-placeholder">
                            {[...Array(30)].map((_, i) => (
                                <div
                                    key={i}
                                    className="waveform-bar"
                                    style={{
                                        height: `${20 + Math.sin(i * 0.5) * 30 + Math.random() * 20}px`,
                                        opacity: duration && currentTime / duration > i / 30 ? 1 : 0.3
                                    }}
                                />
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <div className="player-controls">
                <div className="seek-container">
                    <span className="time current">{formatTime(currentTime)}</span>
                    <input
                        type="range"
                        className="seek-slider"
                        min="0"
                        max={duration || 100}
                        step="0.1"
                        value={currentTime}
                        onInput={handleSeekInput}
                        onChange={handleSeek}
                        disabled={!isReady}
                        style={{ '--progress': `${duration ? (currentTime / duration) * 100 : 0}%` }}
                    />
                    <span className="time total">{formatTime(duration)}</span>
                </div>

                <div className="main-controls">
                    <button className="speed-button" onClick={cycleSpeed}>
                        {playbackSpeed}x
                    </button>

                    <button className="skip-button" onClick={() => skip(-15)} disabled={!isReady}>
                        <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
                        </svg>
                        <span>15</span>
                    </button>

                    <button className="play-pause-button" onClick={togglePlay} disabled={!isReady}>
                        {isPlaying ? (
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <rect x="6" y="4" width="4" height="16" />
                                <rect x="14" y="4" width="4" height="16" />
                            </svg>
                        ) : (
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <polygon points="5 3 19 12 5 21 5 3" />
                            </svg>
                        )}
                    </button>

                    <button className="skip-button" onClick={() => skip(15)} disabled={!isReady}>
                        <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z" />
                        </svg>
                        <span>15</span>
                    </button>

                    <button className="speed-button invisible">
                        {playbackSpeed}x
                    </button>
                </div>
            </div>
        </div>
    );
}

export default AudioPlayer;
