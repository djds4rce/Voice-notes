/**
 * AudioPlayerV2
 *
 * Full-featured audio player using Web Audio API for instant seeking.
 * Features:
 * - Pre-decodes audio for instant seeking to any position
 * - Play/pause controls
 * - Seek slider with time display
 * - Skip forward/backward (15s)
 * - Playback speed control (0.5x to 2x)
 * - Transcript word following with click-to-seek
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { downloadNoteZip } from '../utils/DownloadUtils';
import './AudioPlayer.css';

const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function AudioPlayerV2({ note, onClose }) {
    const navigate = useNavigate();

    // Player state
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [playbackSpeed, setPlaybackSpeed] = useState(1);
    // Transcript is always shown (no toggle)
    const [isReady, setIsReady] = useState(false);
    const [loadError, setLoadError] = useState(null);

    // Refs for Web Audio API
    const audioContextRef = useRef(null);
    const audioBufferRef = useRef(null);
    const sourceNodeRef = useRef(null);
    const gainNodeRef = useRef(null);
    const startTimeRef = useRef(0); // AudioContext time when playback started
    const startOffsetRef = useRef(0); // Offset in the audio when playback started
    const animationFrameRef = useRef(null);
    const transcriptRef = useRef(null);
    const activeWordRef = useRef(null);

    // Initialize duration from note immediately
    useEffect(() => {
        if (note?.duration_seconds && isFinite(note.duration_seconds)) {
            setDuration(note.duration_seconds);
        }
    }, [note?.id, note?.duration_seconds]);

    // Load and decode audio when note changes
    useEffect(() => {
        if (!note?.audioBlob) return;

        let isMounted = true;
        let localAudioContext = null;

        const loadAudio = async () => {
            try {
                setIsReady(false);
                setLoadError(null);
                setCurrentTime(0);
                setIsPlaying(false);

                // Create new AudioContext
                const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                localAudioContext = audioContext;

                // Check if component was unmounted during async operations
                if (!isMounted) {
                    audioContext.close();
                    return;
                }

                audioContextRef.current = audioContext;

                // Create gain node for volume control
                const gainNode = audioContext.createGain();
                gainNode.connect(audioContext.destination);
                gainNodeRef.current = gainNode;

                // Decode the entire audio blob into an AudioBuffer
                const arrayBuffer = await note.audioBlob.arrayBuffer();

                // Check again after async operation
                if (!isMounted) {
                    if (audioContext.state !== 'closed') {
                        audioContext.close();
                    }
                    return;
                }

                const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

                // Final check after decode
                if (!isMounted) {
                    if (audioContext.state !== 'closed') {
                        audioContext.close();
                    }
                    return;
                }

                audioBufferRef.current = audioBuffer;

                // Set duration from decoded buffer (most accurate)
                setDuration(audioBuffer.duration);
                setIsReady(true);
            } catch (error) {
                console.error('[AudioPlayerV2] Error loading audio:', error);
                if (isMounted) {
                    setLoadError('Failed to load audio');
                }
            }
        };

        loadAudio();

        // Cleanup
        return () => {
            isMounted = false;
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
            if (sourceNodeRef.current) {
                try {
                    sourceNodeRef.current.stop();
                } catch (e) {
                    // Source may already be stopped
                }
                sourceNodeRef.current = null;
            }
            // Close the AudioContext if it exists and is not already closed
            if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
                audioContextRef.current.close();
            }
            audioContextRef.current = null;
            audioBufferRef.current = null;
            gainNodeRef.current = null;
        };
    }, [note?.audioBlob]);

    // Update current time during playback
    const updateTime = useCallback(() => {
        if (!audioContextRef.current || !isPlaying) return;

        const elapsed = (audioContextRef.current.currentTime - startTimeRef.current) * playbackSpeed;
        const newTime = startOffsetRef.current + elapsed;

        if (newTime >= duration) {
            // Playback ended
            setCurrentTime(duration);
            setIsPlaying(false);
            if (sourceNodeRef.current) {
                try {
                    sourceNodeRef.current.stop();
                } catch (e) { }
            }
            sourceNodeRef.current = null;
            return;
        }

        setCurrentTime(newTime);
        animationFrameRef.current = requestAnimationFrame(updateTime);
    }, [isPlaying, playbackSpeed, duration]);

    // Start update loop when playing
    useEffect(() => {
        if (isPlaying) {
            animationFrameRef.current = requestAnimationFrame(updateTime);
        } else {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        }
        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, [isPlaying, updateTime]);

    // Play audio from a specific position
    const playFrom = useCallback((position) => {
        if (!audioContextRef.current || !audioBufferRef.current || !gainNodeRef.current) return;

        // Stop current source if playing
        if (sourceNodeRef.current) {
            try {
                sourceNodeRef.current.stop();
            } catch (e) { }
        }

        // Resume context if suspended
        if (audioContextRef.current.state === 'suspended') {
            audioContextRef.current.resume();
        }

        // Create new source node
        const source = audioContextRef.current.createBufferSource();
        source.buffer = audioBufferRef.current;
        source.playbackRate.value = playbackSpeed;
        source.connect(gainNodeRef.current);

        // Handle end of playback
        source.onended = () => {
            if (sourceNodeRef.current === source) {
                setIsPlaying(false);
                sourceNodeRef.current = null;
            }
        };

        // Start playback from position
        const clampedPosition = Math.max(0, Math.min(position, duration));
        startTimeRef.current = audioContextRef.current.currentTime;
        startOffsetRef.current = clampedPosition;

        source.start(0, clampedPosition);
        sourceNodeRef.current = source;
        setIsPlaying(true);
        setCurrentTime(clampedPosition);
    }, [playbackSpeed, duration]);

    // Toggle play/pause
    const togglePlay = useCallback(() => {
        if (!isReady) return;

        if (isPlaying) {
            // Pause: stop current source and save position
            if (sourceNodeRef.current) {
                const elapsed = (audioContextRef.current.currentTime - startTimeRef.current) * playbackSpeed;
                const pausePosition = startOffsetRef.current + elapsed;
                startOffsetRef.current = Math.min(pausePosition, duration);
                setCurrentTime(startOffsetRef.current);

                try {
                    sourceNodeRef.current.stop();
                } catch (e) { }
                sourceNodeRef.current = null;
            }
            setIsPlaying(false);
        } else {
            // Play from current position
            playFrom(startOffsetRef.current);
        }
    }, [isReady, isPlaying, playbackSpeed, duration, playFrom]);

    // Seek to position
    const seekTo = useCallback((position) => {
        if (!isReady) return;

        const clampedPosition = Math.max(0, Math.min(position, duration));
        startOffsetRef.current = clampedPosition;
        setCurrentTime(clampedPosition);

        if (isPlaying) {
            playFrom(clampedPosition);
        }
    }, [isReady, duration, isPlaying, playFrom]);

    // Handle seek slider change
    const handleSeek = useCallback((e) => {
        const newTime = parseFloat(e.target.value);
        if (isFinite(newTime)) {
            seekTo(newTime);
        }
    }, [seekTo]);

    // Handle seek slider input (visual feedback during drag)
    const handleSeekInput = useCallback((e) => {
        const newTime = parseFloat(e.target.value);
        if (isFinite(newTime)) {
            setCurrentTime(newTime);
        }
    }, []);

    // Skip forward/backward
    const skip = useCallback((seconds) => {
        if (!isReady) return;
        const newTime = currentTime + seconds;
        seekTo(newTime);
    }, [isReady, currentTime, seekTo]);

    // Update playback speed
    useEffect(() => {
        if (sourceNodeRef.current) {
            // Save current position
            const elapsed = (audioContextRef.current.currentTime - startTimeRef.current) * sourceNodeRef.current.playbackRate.value;
            const currentPos = startOffsetRef.current + elapsed;

            // Update rate and recalculate timing
            sourceNodeRef.current.playbackRate.value = playbackSpeed;
            startTimeRef.current = audioContextRef.current.currentTime;
            startOffsetRef.current = currentPos;
        }
    }, [playbackSpeed]);

    // Cycle through playback speeds
    const cycleSpeed = useCallback(() => {
        const currentIndex = PLAYBACK_SPEEDS.indexOf(playbackSpeed);
        const nextIndex = (currentIndex + 1) % PLAYBACK_SPEEDS.length;
        setPlaybackSpeed(PLAYBACK_SPEEDS[nextIndex]);
    }, [playbackSpeed]);

    // Format time as MM:SS
    const formatTime = (seconds) => {
        if (!seconds || isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    // Find current word index based on currentTime
    const currentWordIndex = useMemo(() => {
        if (!note?.wordTimestamps || note.wordTimestamps.length === 0) {
            return -1;
        }
        // Find the word that contains currentTime
        for (let i = note.wordTimestamps.length - 1; i >= 0; i--) {
            const word = note.wordTimestamps[i];
            if (currentTime >= word.start) {
                return i;
            }
        }
        return -1;
    }, [note?.wordTimestamps, currentTime]);

    // Auto-scroll to active word
    useEffect(() => {
        if (activeWordRef.current && transcriptRef.current && isPlaying) {
            activeWordRef.current.scrollIntoView({
                behavior: 'smooth',
                block: 'center',
            });
        }
    }, [currentWordIndex, isPlaying]);

    // Handle word click for seeking
    const handleWordClick = useCallback((wordStart) => {
        if (isReady && wordStart !== undefined) {
            seekTo(wordStart);
            if (!isPlaying) {
                playFrom(wordStart);
            }
        }
    }, [isReady, seekTo, isPlaying, playFrom]);

    const handleClose = () => {
        if (onClose) {
            onClose();
        } else {
            navigate('/');
        }
    };

    const handleDownloadClick = async () => {
        try {
            await downloadNoteZip(note.id, note.title);
        } catch (error) {
            console.error('Download failed:', error);
            alert('Failed to download note. Please try again.');
        }
    };

    // Format timestamp for display
    const formatTimestamp = (dateStr) => {
        if (!dateStr) return '';

        const date = dateStr instanceof Date ? dateStr : new Date(dateStr);

        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000); // 24 hours in milliseconds
        const noteDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

        if (noteDate.getTime() === today.getTime()) {
            return date.toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            });
        } else if (noteDate.getTime() === yesterday.getTime()) {
            return 'Yesterday';
        } else {
            return date.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            });
        }
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
            {/* Header */}
            <header className="player-header">
                <button className="back-button" onClick={handleClose}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M19 12H5M12 19l-7-7 7-7" />
                    </svg>
                </button>

                <div className="player-header-content">
                    <h1 className="player-title">{note.title || 'Voice Note'}</h1>
                    <div className="player-metadata">
                        <span className="player-date">
                            {formatTimestamp(note.created_at)}
                        </span>
                        {note.tags && note.tags.length > 0 && (
                            <div className="player-tags">
                                {note.tags.map((tag, idx) => (
                                    <span key={idx} className="player-tag">#{tag}</span>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Spacer for header balance */}
                {/* Download Button */}
                <button
                    className="download-button-large"
                    onClick={handleDownloadClick}
                    title="Download zip"
                    aria-label="Download note"
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                </button>
            </header>

            {/* Content Area */}
            <div className="player-content">
                {loadError ? (
                    <div className="player-loading">{loadError}</div>
                ) : !isReady ? (
                    <div className="player-loading">Loading audio...</div>
                ) : (
                    <div className="transcript-view" ref={transcriptRef}>
                        {note.wordTimestamps && note.wordTimestamps.length > 0 ? (
                            <p className="full-transcript synced">
                                {note.wordTimestamps.map((word, idx) => {
                                    const isActive = idx === currentWordIndex;
                                    const isPast = idx < currentWordIndex;
                                    return (
                                        <span
                                            key={idx}
                                            ref={isActive ? activeWordRef : null}
                                            className={`transcript-word${isActive ? ' active' : ''}${isPast ? ' past' : ''}`}
                                            onClick={() => handleWordClick(word.start)}
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
                )}
            </div>

            {/* Player Controls */}
            <div className="player-controls">
                {/* Time & Seek */}
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
                        style={{
                            '--progress': `${duration ? (currentTime / duration) * 100 : 0}%`
                        }}
                    />
                    <span className="time total">{formatTime(duration)}</span>
                </div>

                {/* Main Controls */}
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

export default AudioPlayerV2;
