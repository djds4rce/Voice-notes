/**
 * NotesListPage
 * 
 * Main page listing all voice notes:
 * - Notes grouped by date (Today, Yesterday, Earlier)
 * - Inline search with semantic search support
 * - Loading indicator during search
 * - Matched words display in results
 * - FAB to create new recording
 * - Empty state when no notes
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import NoteCard from './NoteCard';
import { isAppleDevice } from '../utils/deviceDetection';
import './NotesListPage.css';

export function NotesListPage({
    notes,
    onDeleteNote,
    onSemanticSearch,
    onKeywordSearch,
    semanticSearchEnabled = true,
    isSearching,
    isEmbeddingLoading = false,
    isLoading = false
}) {
    const navigate = useNavigate();
    const [searchOpen, setSearchOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [searchPending, setSearchPending] = useState(false); // Immediate feedback when typing
    const [hasSearched, setHasSearched] = useState(false);

    // Permission state
    const [permissionState, setPermissionState] = useState('idle'); // idle, checking, denied, error
    const [permissionError, setPermissionError] = useState('');

    // Track search version to cancel stale results
    const searchVersionRef = useRef(0);

    // Request microphone permission before navigating to record
    const handleRecordClick = async () => {
        setPermissionState('checking');
        setPermissionError('');

        try {
            // First check if permission API is available (not all browsers support it)
            if (navigator.permissions && navigator.permissions.query) {
                try {
                    const result = await navigator.permissions.query({ name: 'microphone' });
                    if (result.state === 'denied') {
                        setPermissionState('denied');
                        setPermissionError('Microphone access was denied. Please allow microphone access in your browser settings.');
                        return;
                    }
                } catch (e) {
                    // Permission query might not be supported for microphone in some browsers
                    // Continue to try getUserMedia
                }
            }

            // Request actual microphone access
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            // Got permission - stop the stream immediately (we just needed to check)
            stream.getTracks().forEach(track => track.stop());

            // Navigate to record
            setPermissionState('idle');
            navigate('/record');
        } catch (error) {
            console.error('[NotesListPage] Microphone permission error:', error);

            if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
                setPermissionState('denied');
                setPermissionError('Microphone access was denied. Please allow microphone access to record voice notes.');
            } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
                setPermissionState('error');
                setPermissionError('No microphone found. Please connect a microphone and try again.');
            } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
                setPermissionState('error');
                setPermissionError('Microphone is in use by another application. Please close other apps using the microphone.');
            } else {
                setPermissionState('error');
                setPermissionError(`Could not access microphone: ${error.message || 'Unknown error'}`);
            }
        }
    };

    // Dismiss permission error
    const dismissPermissionError = () => {
        setPermissionState('idle');
        setPermissionError('');
    };

    // Upload handling
    const fileInputRef = useRef(null);

    const handleUploadClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileSelect = (event) => {
        const file = event.target.files?.[0];
        if (file) {
            // Navigate to upload screen with the file
            navigate('/upload', { state: { audioFile: file } });
        }
        // Reset input so same file can be selected again
        event.target.value = '';
    };

    // Debounced search (semantic or keyword based on setting)
    useEffect(() => {
        if (!query.trim()) {
            setSearchResults([]);
            setHasSearched(false);
            setSearchPending(false);
            return;
        }

        // Show pending state immediately
        setSearchPending(true);
        const currentVersion = ++searchVersionRef.current;

        // Use semantic search if enabled, otherwise keyword search
        const searchFn = semanticSearchEnabled ? onSemanticSearch : onKeywordSearch;
        const debounceMs = semanticSearchEnabled ? 500 : 300; // Faster debounce for keyword search

        const timer = setTimeout(async () => {
            setHasSearched(true);
            if (searchFn) {
                try {
                    const results = await searchFn(query);
                    // Only update if this is still the latest search
                    if (searchVersionRef.current === currentVersion) {
                        setSearchResults(results);
                        setSearchPending(false);
                    }
                } catch (error) {
                    console.error('Search failed:', error);
                    if (searchVersionRef.current === currentVersion) {
                        setSearchResults([]);
                        setSearchPending(false);
                    }
                }
            }
        }, debounceMs);

        return () => {
            clearTimeout(timer);
        };
    }, [query, onSemanticSearch, onKeywordSearch, semanticSearchEnabled]);

    // Highlight search terms in text and return snippet around first match
    const highlightText = useCallback((text, searchQuery) => {
        if (!searchQuery.trim() || !text) return { highlighted: text, snippet: null };

        const words = searchQuery.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        if (words.length === 0) return { highlighted: text, snippet: null };

        let result = text;
        let firstMatchIndex = -1;
        const textLower = text.toLowerCase();

        // Find first match position
        for (const word of words) {
            const index = textLower.indexOf(word);
            if (index !== -1 && (firstMatchIndex === -1 || index < firstMatchIndex)) {
                firstMatchIndex = index;
            }
        }

        // Create highlighted version of full text
        words.forEach(word => {
            const regex = new RegExp(`(${word})`, 'gi');
            result = result.replace(regex, '<mark class="highlight">$1</mark>');
        });

        // Create snippet around first match (for preview)
        let snippet = null;
        if (firstMatchIndex !== -1) {
            const snippetLength = 120;
            const contextBefore = 20;
            let start = Math.max(0, firstMatchIndex - contextBefore);
            let end = Math.min(text.length, start + snippetLength);

            // Adjust start to not cut words
            if (start > 0) {
                const spaceIndex = text.indexOf(' ', start);
                if (spaceIndex !== -1 && spaceIndex < firstMatchIndex) {
                    start = spaceIndex + 1;
                }
            }

            snippet = text.slice(start, end);
            // Highlight the snippet
            words.forEach(word => {
                const regex = new RegExp(`(${word})`, 'gi');
                snippet = snippet.replace(regex, '<mark class="highlight">$1</mark>');
            });

            // Add ellipsis
            if (start > 0) snippet = '...' + snippet;
            if (end < text.length) snippet = snippet + '...';
        }

        return { highlighted: result, snippet };
    }, []);

    // Find matched words for display
    const getMatchedWords = useCallback((transcript, searchQuery) => {
        if (!searchQuery.trim() || !transcript) return [];

        const queryWords = searchQuery.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        const transcriptLower = transcript.toLowerCase();
        const matched = [];

        queryWords.forEach(word => {
            if (transcriptLower.includes(word)) {
                matched.push({ word, type: 'exact' });
            }
        });

        return matched;
    }, []);

    // Notes to display (search results or all notes)
    const displayNotes = hasSearched ? searchResults : notes;

    // Group notes by date
    const groupedNotes = useMemo(() => {
        const groups = {
            today: [],
            yesterday: [],
            earlier: [],
        };

        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

        displayNotes.forEach(note => {
            const noteDate = new Date(note.created_at);
            const noteDateOnly = new Date(noteDate.getFullYear(), noteDate.getMonth(), noteDate.getDate());

            if (noteDateOnly.getTime() === today.getTime()) {
                groups.today.push(note);
            } else if (noteDateOnly.getTime() === yesterday.getTime()) {
                groups.yesterday.push(note);
            } else {
                groups.earlier.push(note);
            }
        });

        return groups;
    }, [displayNotes]);

    const clearSearch = () => {
        setQuery('');
        setSearchResults([]);
        setHasSearched(false);
        setSearchPending(false);
        setSearchOpen(false);
    };

    const hasNotes = notes.length > 0;
    const hasResults = displayNotes.length > 0;

    return (
        <div className="notes-list-page">
            {/* iOS Warning Banner */}
            {true && ( // Ideally use IS_IOS from hook, but for now we will import it or checking navigator
                <div style={{
                    backgroundColor: '#fff3cd',
                    color: '#856404',
                    padding: '12px',
                    textAlign: 'center',
                    fontSize: '0.9rem',
                    borderBottom: '1px solid #ffeeba',
                    display: isAppleDevice() ? 'block' : 'none'
                }}>
                    ⚠️ <strong>iOS Warning:</strong> Audio inference is experimental. Recordings &gt;30s may fail or crash.
                </div>
            )}

            {/* Header */}
            <header className="notes-header">
                {!searchOpen ? (
                    <>
                        <h1 className="notes-title">Voice Notes</h1>
                        <div className="header-actions">
                            <button
                                className="search-button"
                                onClick={() => setSearchOpen(true)}
                                aria-label="Search notes"
                            >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <circle cx="11" cy="11" r="8" />
                                    <path d="M21 21l-4.35-4.35" />
                                </svg>
                            </button>
                            <button
                                className="settings-button"
                                onClick={() => navigate('/settings')}
                                aria-label="Settings"
                            >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <circle cx="12" cy="12" r="3" />
                                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                                </svg>
                            </button>
                        </div>
                    </>
                ) : (
                    <div className="search-input-container">
                        <div className="search-input-wrapper">
                            <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="11" cy="11" r="8" />
                                <path d="M21 21l-4.35-4.35" />
                            </svg>
                            <input
                                type="text"
                                className="search-input"
                                placeholder="Search your notes..."
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                autoFocus
                            />
                            {(query || isSearching || searchPending) && (
                                <button className="clear-button" onClick={clearSearch}>
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M18 6L6 18M6 6l12 12" />
                                    </svg>
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </header>

            {/* Search Results Header */}
            {hasSearched && (
                <div className="search-results-header">
                    <span className="results-count">
                        {(isSearching || searchPending) ? 'Searching...' : `${searchResults.length} result${searchResults.length !== 1 ? 's' : ''}`}
                    </span>
                    <span className="search-query">for "{query}"</span>
                </div>
            )}

            {/* Loading Indicator */}
            {(isSearching || searchPending) && (
                <div className="search-loading">
                    <div className="loading-spinner"></div>
                    <p>{isEmbeddingLoading ? 'Loading AI search model...' : 'Searching with AI...'}</p>
                </div>
            )}

            <div className="notes-content">
                {/* Initial Loading State */}
                {isLoading && (
                    <div className="initial-loading">
                        <div className="initial-loading-icon">
                            <svg className="notes-loading-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                <polyline points="14 2 14 8 20 8" />
                                <line x1="16" y1="13" x2="8" y2="13" />
                                <line x1="16" y1="17" x2="8" y2="17" />
                                <polyline points="10 9 9 9 8 9" />
                            </svg>
                        </div>
                        <h2 className="initial-loading-title">Loading your notes...</h2>
                        <p className="initial-loading-subtitle">Just a moment while we gather your thoughts</p>
                    </div>
                )}

                {!isLoading && !(isSearching || searchPending) && hasNotes ? (
                    hasResults ? (
                        <>
                            {groupedNotes.today.length > 0 && (
                                <section className="notes-section">
                                    <h2 className="section-title">TODAY</h2>
                                    <div className="notes-grid">
                                        {groupedNotes.today.map(note => {
                                            const searchResult = hasSearched ? highlightText(note.transcript, query) : { highlighted: null, snippet: null };
                                            return (
                                                <NoteCard
                                                    key={note.id}
                                                    note={{
                                                        ...note,
                                                        highlightedTranscript: searchResult.snippet || searchResult.highlighted,
                                                        matchedWords: hasSearched ? getMatchedWords(note.transcript, query) : [],
                                                        similarity: note.similarity
                                                    }}
                                                    showMatchInfo={hasSearched}
                                                    onDelete={() => onDeleteNote?.(note.id)}
                                                    onClick={() => navigate(`/note/${note.id}`)}
                                                />
                                            )
                                        })}
                                    </div>
                                </section>
                            )}

                            {groupedNotes.yesterday.length > 0 && (
                                <section className="notes-section">
                                    <h2 className="section-title">YESTERDAY</h2>
                                    <div className="notes-grid">
                                        {groupedNotes.yesterday.map(note => {
                                            const searchResult = hasSearched ? highlightText(note.transcript, query) : { highlighted: null, snippet: null };
                                            return (
                                                <NoteCard
                                                    key={note.id}
                                                    note={{
                                                        ...note,
                                                        highlightedTranscript: searchResult.snippet || searchResult.highlighted,
                                                        matchedWords: hasSearched ? getMatchedWords(note.transcript, query) : [],
                                                        similarity: note.similarity
                                                    }}
                                                    showMatchInfo={hasSearched}
                                                    onDelete={() => onDeleteNote?.(note.id)}
                                                    onClick={() => navigate(`/note/${note.id}`)}
                                                />
                                            )
                                        })}
                                    </div>
                                </section>
                            )}

                            {groupedNotes.earlier.length > 0 && (
                                <section className="notes-section">
                                    <h2 className="section-title">EARLIER</h2>
                                    <div className="notes-grid">
                                        {groupedNotes.earlier.map(note => {
                                            const searchResult = hasSearched ? highlightText(note.transcript, query) : { highlighted: null, snippet: null };
                                            return (
                                                <NoteCard
                                                    key={note.id}
                                                    note={{
                                                        ...note,
                                                        highlightedTranscript: searchResult.snippet || searchResult.highlighted,
                                                        matchedWords: hasSearched ? getMatchedWords(note.transcript, query) : [],
                                                        similarity: note.similarity
                                                    }}
                                                    showMatchInfo={hasSearched}
                                                    onDelete={() => onDeleteNote?.(note.id)}
                                                    onClick={() => navigate(`/note/${note.id}`)}
                                                />
                                            )
                                        })}
                                    </div>
                                </section>
                            )}
                        </>
                    ) : hasSearched ? (
                        <div className="no-results">
                            <h2>No results found</h2>
                            <p>Try different keywords or check your spelling</p>
                        </div>
                    ) : null
                ) : !isLoading && !(isSearching || searchPending) && !hasNotes ? (
                    <div className="empty-state">
                        <h2>No voice notes yet</h2>
                        <p>Tap the button below to record your first note</p>
                    </div>
                ) : null}
            </div>

            {/* FAB Container */}
            <div className="fab-container">
                {/* Upload FAB */}
                <button
                    className="fab fab-secondary"
                    onClick={handleUploadClick}
                    aria-label="Upload audio file"
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                </button>
                <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileSelect}
                    accept="audio/*"
                    style={{ display: 'none' }}
                />

                {/* Record FAB */}
                <button
                    className={`fab ${permissionState === 'checking' ? 'fab-loading' : ''}`}
                    onClick={handleRecordClick}
                    disabled={permissionState === 'checking'}
                    aria-label="Record new note"
                >
                    {permissionState === 'checking' ? (
                        <div className="fab-spinner" />
                    ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                            <line x1="12" y1="19" x2="12" y2="23" />
                            <line x1="8" y1="23" x2="16" y2="23" />
                        </svg>
                    )}
                </button>
            </div>

            {/* Permission Error Modal */}
            {(permissionState === 'denied' || permissionState === 'error') && (
                <div className="permission-modal-overlay" onClick={dismissPermissionError}>
                    <div className="permission-modal" onClick={e => e.stopPropagation()}>
                        <div className="permission-modal-icon">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                                <line x1="12" y1="19" x2="12" y2="23" />
                                <line x1="8" y1="23" x2="16" y2="23" />
                                <line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" strokeWidth="3" />
                            </svg>
                        </div>
                        <h3 className="permission-modal-title">
                            {permissionState === 'denied' ? 'Microphone Access Required' : 'Microphone Error'}
                        </h3>
                        <p className="permission-modal-message">{permissionError}</p>
                        <div className="permission-modal-actions">
                            <button className="permission-modal-button secondary" onClick={dismissPermissionError}>
                                Cancel
                            </button>
                            <button className="permission-modal-button primary" onClick={handleRecordClick}>
                                Try Again
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default NotesListPage;
