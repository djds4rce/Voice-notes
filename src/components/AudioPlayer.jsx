/**
 * AudioPlayer
 *
 * Full-featured audio player with:
 * - Play/pause controls
 * - Seek slider with time display
 * - Skip forward/backward
 * - Playback speed control
 * - Transcript view toggle
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Howl } from 'howler';
import './AudioPlayer.css';

const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function AudioPlayer({ note, onClose }) {
    const navigate = useNavigate();

    // Player state
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [playbackSpeed, setPlaybackSpeed] = useState(1);
    const [showTranscript, setShowTranscript] = useState(false);
    const [sound, setSound] = useState(null);
    const [soundLoaded, setSoundLoaded] = useState(false);

    const transcriptRef = useRef(null);
    const activeWordRef = useRef(null);
    const intervalRef = useRef(null);
    const soundIdRef = useRef(null); // Track the current sound instance ID

    // Initialize duration from note immediately
    useEffect(() => {
        if (note?.duration_seconds && isFinite(note.duration_seconds)) {
            setDuration(note.duration_seconds);
        }
    }, [note?.id, note?.duration_seconds]);

    // Create Howl instance when audio blob changes
    useEffect(() => {
        if (!note?.audioBlob) return;

        // Cleanup previous sound
        if (sound) {
            sound.unload();
        }
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
        }
        soundIdRef.current = null;

        // Reset state
        setSoundLoaded(false);
        setCurrentTime(0);
        setIsPlaying(false);

        // Create blob URL
        const url = URL.createObjectURL(note.audioBlob);

        // Try to detect format from blob type
        let format = [];
        if (note.audioBlob.type) {
            console.log('[AudioPlayer] Blob MIME type:', note.audioBlob.type);
            // Extract the base MIME type (remove codecs and other parameters)
            const baseMimeType = note.audioBlob.type.split(';')[0];
            console.log('[AudioPlayer] Base MIME type:', baseMimeType);

            const mimeToFormat = {
                'audio/mp3': 'mp3',
                'audio/mpeg': 'mp3',
                'audio/mp4': 'mp4',
                'audio/m4a': 'mp4',
                'audio/webm': 'webm',
                'audio/ogg': 'ogg',
                'audio/wav': 'wav',
                'audio/wave': 'wav',
            };
            const detectedFormat = mimeToFormat[baseMimeType];
            if (detectedFormat) {
                format = [detectedFormat];
                console.log('[AudioPlayer] Detected format:', detectedFormat);
            }
        }

        // Create new Howl instance
        const newSound = new Howl({
            src: [url],
            html5: true, // Use HTML5 for blob URLs
            format: format.length > 0 ? format : undefined,
            preload: true,
            onload: () => {
                const soundDuration = newSound.duration();
                console.log('[AudioPlayer] Audio loaded, duration:', soundDuration);
                // Only update duration if we don't have one from the note
                if (!note?.duration_seconds || !isFinite(note.duration_seconds)) {
                    setDuration(soundDuration);
                }
                setSoundLoaded(true);
            },
            onloaderror: (id, error) => {
                console.error('[AudioPlayer] Load error:', error);
                console.error('[AudioPlayer] Blob type:', note.audioBlob.type);
            },
            onplay: (id) => {
                console.log('[AudioPlayer] Playing, sound ID:', id);
                soundIdRef.current = id;
                setIsPlaying(true);
                // Start time update interval
                if (intervalRef.current) {
                    clearInterval(intervalRef.current);
                }
                intervalRef.current = setInterval(() => {
                    const time = newSound.seek();
                    setCurrentTime(typeof time === 'number' ? time : 0);
                }, 100);
            },
            onpause: () => {
                console.log('[AudioPlayer] Paused');
                setIsPlaying(false);
                if (intervalRef.current) {
                    clearInterval(intervalRef.current);
                }
            },
            onend: () => {
                console.log('[AudioPlayer] Ended');
                setIsPlaying(false);
                setCurrentTime(0);
                soundIdRef.current = null;
                if (intervalRef.current) {
                    clearInterval(intervalRef.current);
                }
            },
            onseek: () => {
                const time = newSound.seek();
                console.log('[AudioPlayer] Seeked to:', time);
                setCurrentTime(typeof time === 'number' ? time : 0);
            }
        });

        // Set initial playback rate
        if (playbackSpeed !== 1) {
            newSound.rate(playbackSpeed);
        }

        setSound(newSound);

        // Cleanup
        return () => {
            newSound.unload();
            if (intervalRef.current) {
                clearInterval(intervalRef.current);
            }
            URL.revokeObjectURL(url);
        };
    }, [note?.audioBlob]); // Only re-run when blob changes

    // Update playback speed when it changes
    useEffect(() => {
        if (sound && soundLoaded) {
            console.log('[AudioPlayer] Setting rate to:', playbackSpeed);
            if (soundIdRef.current !== null) {
                // If currently playing, update rate for the specific sound instance
                sound.rate(playbackSpeed, soundIdRef.current);
            } else {
                // Not currently playing, update default rate
                sound.rate(playbackSpeed);
            }
        }
    }, [playbackSpeed]);

    // Play/pause
    const togglePlay = useCallback(() => {
        if (!sound || !soundLoaded) return;

        if (sound.playing()) {
            sound.pause();
        } else {
            const id = sound.play();
            soundIdRef.current = id;
        }
    }, [sound, soundLoaded]);

    // Seek - called when user releases the slider
    const handleSeek = useCallback((e) => {
        if (!sound || !soundLoaded || !duration) return;

        const newTime = parseFloat(e.target.value);
        if (isFinite(newTime) && newTime >= 0 && newTime <= duration) {
            console.log('[Seek] Seeking to:', newTime);
            sound.seek(newTime);
            setCurrentTime(newTime);
        }
    }, [sound, soundLoaded, duration]);

    // SeekInput - called during drag for immediate visual feedback
    const handleSeekInput = useCallback((e) => {
        const newTime = parseFloat(e.target.value);
        if (isFinite(newTime)) {
            setCurrentTime(newTime);
        }
    }, []);

    // Skip forward/backward
    const skip = useCallback((seconds) => {
        if (!sound || !soundLoaded) {
            console.log('[Skip] Sound not ready');
            return;
        }

        const currentDuration = duration || sound.duration() || 0;
        if (!currentDuration) {
            console.log('[Skip] No duration available');
            return;
        }

        const currentTimeValue = sound.seek() || 0;
        const newTime = Math.max(0, Math.min(currentDuration, currentTimeValue + seconds));

        console.log('[Skip] Duration:', currentDuration, 'Current:', currentTimeValue, 'Seeking to:', newTime);

        // Use the specific sound ID if playing, otherwise seek globally
        if (soundIdRef.current !== null) {
            sound.seek(newTime, soundIdRef.current);
        } else {
            sound.seek(newTime);
        }
        setCurrentTime(newTime);
    }, [sound, soundLoaded, duration]);

    // Change playback speed
    const cycleSpeed = useCallback(() => {
        const currentIndex = PLAYBACK_SPEEDS.indexOf(playbackSpeed);
        const nextIndex = (currentIndex + 1) % PLAYBACK_SPEEDS.length;
        const newSpeed = PLAYBACK_SPEEDS[nextIndex];
        setPlaybackSpeed(newSpeed);
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

    const handleClose = () => {
        if (onClose) {
            onClose();
        } else {
            navigate('/');
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

            {/* Content Area */}
            <div className="player-content">
                {showTranscript ? (
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
                                            onClick={() => {
                                                // Click to seek to word
                                                if (sound && soundLoaded && word.start !== undefined) {
                                                    if (soundIdRef.current !== null) {
                                                        sound.seek(word.start, soundIdRef.current);
                                                    } else {
                                                        sound.seek(word.start);
                                                    }
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

            {/* Player Controls */}
            <div className="player-controls">
                {/* Time & Seek */}
                <div className="seek-container">
                    <span className="time current">{formatTime(currentTime)}</span>
                    <input
                        type="range"
                        className="seek-slider"
                        min="0"
                        max={duration || note?.duration_seconds || 100}
                        step="0.1"
                        value={currentTime}
                        onInput={handleSeekInput}
                        onChange={handleSeek}
                        disabled={!soundLoaded}
                        style={{
                            '--progress': `${duration ? (currentTime / duration) * 100 : 0}%`
                        }}
                    />
                    <span className="time total">{formatTime(duration || note?.duration_seconds)}</span>
                </div>

                {/* Main Controls */}
                <div className="main-controls">
                    <button className="speed-button" onClick={cycleSpeed}>
                        {playbackSpeed}x
                    </button>

                    <button className="skip-button" onClick={() => skip(-15)} disabled={!soundLoaded}>
                        <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
                        </svg>
                        <span>15</span>
                    </button>

                    <button className="play-pause-button" onClick={togglePlay} disabled={!soundLoaded}>
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

                    <button className="skip-button" onClick={() => skip(15)} disabled={!soundLoaded}>
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
