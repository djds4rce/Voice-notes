/**
 * SearchPage
 * 
 * Search interface with:
 * - Search input with clear button
 * - Filter chips (All, Date, Tags, Audio, Length)
 * - Results grouped by date
 * - Semantic search using embeddings
 * - Highlighted search terms
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import NoteCard from './NoteCard';
import './SearchPage.css';

const FILTERS = ['All', 'Date', 'Tags', 'Audio', 'Length'];

export function SearchPage({
    notes,
    onSearch,
    onSemanticSearch,
    isSearching,
    onPlayNote
}) {
    const navigate = useNavigate();
    const [query, setQuery] = useState('');
    const [activeFilter, setActiveFilter] = useState('All');
    const [searchResults, setSearchResults] = useState([]);
    const [hasSearched, setHasSearched] = useState(false);

    // Debounced search
    useEffect(() => {
        if (!query.trim()) {
            setSearchResults([]);
            setHasSearched(false);
            return;
        }

        const timer = setTimeout(async () => {
            setHasSearched(true);

            // Try semantic search first, fall back to keyword search
            if (onSemanticSearch) {
                try {
                    const results = await onSemanticSearch(query);
                    setSearchResults(results);
                } catch (error) {
                    console.error('Semantic search failed, falling back to keyword search:', error);
                    if (onSearch) {
                        const results = await onSearch(query);
                        setSearchResults(results);
                    }
                }
            } else if (onSearch) {
                const results = await onSearch(query);
                setSearchResults(results);
            }
        }, 300);

        return () => clearTimeout(timer);
    }, [query, onSearch, onSemanticSearch]);

    // Group results by date
    const groupedResults = useMemo(() => {
        const groups = {
            today: [],
            yesterday: [],
            earlier: [],
        };

        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

        searchResults.forEach(note => {
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
    }, [searchResults]);

    // Highlight search terms in text
    const highlightText = useCallback((text, searchQuery) => {
        if (!searchQuery.trim() || !text) return text;

        const words = searchQuery.toLowerCase().split(/\s+/).filter(w => w);
        let result = text;

        words.forEach(word => {
            const regex = new RegExp(`(${word})`, 'gi');
            result = result.replace(regex, '<mark class="highlight">$1</mark>');
        });

        return result;
    }, []);

    const clearSearch = () => {
        setQuery('');
        setSearchResults([]);
        setHasSearched(false);
    };

    return (
        <div className="search-page">
            {/* Header */}
            <header className="search-header">
                <button className="back-button" onClick={() => navigate('/')}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M19 12H5M12 19l-7-7 7-7" />
                    </svg>
                </button>
                <h1 className="search-title">Search Results</h1>
            </header>

            {/* Search Input */}
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
                    {query && (
                        <button className="clear-button" onClick={clearSearch}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="12" cy="12" r="10" />
                                <path d="M15 9l-6 6M9 9l6 6" />
                            </svg>
                        </button>
                    )}
                </div>
            </div>

            {/* Filters */}
            <div className="filter-chips">
                {FILTERS.map(filter => (
                    <button
                        key={filter}
                        className={`filter-chip ${activeFilter === filter ? 'active' : ''}`}
                        onClick={() => setActiveFilter(filter)}
                    >
                        {filter}
                    </button>
                ))}
            </div>

            {/* Results */}
            <div className="search-results">
                {isSearching ? (
                    <div className="search-loading">
                        <div className="loading-spinner"></div>
                        <p>Searching...</p>
                    </div>
                ) : hasSearched ? (
                    searchResults.length > 0 ? (
                        <>
                            {groupedResults.today.length > 0 && (
                                <section className="results-section">
                                    <h2 className="section-title">TODAY</h2>
                                    <div className="results-list">
                                        {groupedResults.today.map(note => (
                                            <NoteCard
                                                key={note.id}
                                                note={{
                                                    ...note,
                                                    // Highlight search terms in preview
                                                    highlightedTranscript: highlightText(note.transcript, query)
                                                }}
                                                onClick={() => navigate(`/note/${note.id}`)}
                                                onPlay={() => onPlayNote?.(note)}
                                            />
                                        ))}
                                    </div>
                                </section>
                            )}

                            {groupedResults.yesterday.length > 0 && (
                                <section className="results-section">
                                    <h2 className="section-title">YESTERDAY</h2>
                                    <div className="results-list">
                                        {groupedResults.yesterday.map(note => (
                                            <NoteCard
                                                key={note.id}
                                                note={{
                                                    ...note,
                                                    highlightedTranscript: highlightText(note.transcript, query)
                                                }}
                                                onClick={() => navigate(`/note/${note.id}`)}
                                                onPlay={() => onPlayNote?.(note)}
                                            />
                                        ))}
                                    </div>
                                </section>
                            )}

                            {groupedResults.earlier.length > 0 && (
                                <section className="results-section">
                                    <h2 className="section-title">EARLIER</h2>
                                    <div className="results-list">
                                        {groupedResults.earlier.map(note => (
                                            <NoteCard
                                                key={note.id}
                                                note={{
                                                    ...note,
                                                    highlightedTranscript: highlightText(note.transcript, query)
                                                }}
                                                onClick={() => navigate(`/note/${note.id}`)}
                                                onPlay={() => onPlayNote?.(note)}
                                            />
                                        ))}
                                    </div>
                                </section>
                            )}
                        </>
                    ) : (
                        <div className="no-results">
                            <div className="no-results-icon">🔍</div>
                            <h2>No results found</h2>
                            <p>Try different keywords or check your spelling</p>
                        </div>
                    )
                ) : (
                    <div className="search-hint">
                        <div className="hint-icon">💡</div>
                        <p>Search by keywords or describe what you're looking for</p>
                        <p className="hint-subtext">AI-powered semantic search understands meaning, not just keywords</p>
                    </div>
                )}
            </div>
        </div>
    );
}

export default SearchPage;
