/**
 * NoteCard
 * 
 * Individual note card displaying:
 * - Title (auto-generated from transcript)
 * - Transcript preview with optional highlighting
 * - Duration badge
 * - Timestamp
 * - Quick play button
 * - Matched words and similarity score (for search results)
 */

import './NoteCard.css';

export function NoteCard({ note, onClick, onPlay, onDelete, showMatchInfo = false }) {
    // Format duration as MM:SS min
    const formatDuration = (seconds) => {
        if (!seconds) return '0:00 min';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')} min`;
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
                day: 'numeric'
            });
        }
    };

    // Truncate transcript for preview while preserving HTML highlight marks
    const getPreview = (transcript, maxLength = 100) => {
        if (!transcript) return '';

        // For plain text (no HTML), just truncate normally
        if (!transcript.includes('<mark')) {
            if (transcript.length <= maxLength) return transcript;
            return transcript.slice(0, maxLength).trim() + '...';
        }

        // For highlighted text, we need to intelligently truncate while preserving marks
        // Strategy: Track visible character count while keeping mark tags intact
        let result = '';
        let visibleCount = 0;
        let inTag = false;
        let currentTag = '';
        let openMarks = 0;

        for (let i = 0; i < transcript.length && visibleCount < maxLength; i++) {
            const char = transcript[i];

            if (char === '<') {
                inTag = true;
                currentTag = '<';
            } else if (char === '>' && inTag) {
                currentTag += '>';
                result += currentTag;

                // Track open/close marks
                if (currentTag.startsWith('<mark')) {
                    openMarks++;
                } else if (currentTag === '</mark>') {
                    openMarks--;
                }

                inTag = false;
                currentTag = '';
            } else if (inTag) {
                currentTag += char;
            } else {
                result += char;
                visibleCount++;
            }
        }

        // Close any open mark tags
        while (openMarks > 0) {
            result += '</mark>';
            openMarks--;
        }

        // Add ellipsis if truncated
        if (visibleCount >= maxLength) {
            result += '...';
        }

        return result;
    };

    // Format similarity score as percentage
    const formatSimilarity = (similarity) => {
        if (!similarity) return null;
        return Math.round(similarity * 100);
    };

    const handlePlayClick = (e) => {
        e.stopPropagation();
        onPlay?.();
    };

    const handleDeleteClick = (e) => {
        e.stopPropagation();
        if (window.confirm('Delete this voice note?')) {
            onDelete?.();
        }
    };

    const similarityPercent = formatSimilarity(note.similarity);
    const hasMatchedWords = note.matchedWords && note.matchedWords.length > 0;
    const isSemanticMatch = showMatchInfo && similarityPercent && !hasMatchedWords;

    return (
        <div className="note-card" onClick={onClick}>
            <div className="note-card-content">
                <div className="note-card-header">
                    <h3 className="note-card-title">{note.title || 'Voice Note'}</h3>
                    <div className="note-card-badges">
                        <span className="note-card-duration">{formatDuration(note.duration_seconds)}</span>
                    </div>
                </div>

                {/* Transcript preview with optional highlighting */}
                {note.highlightedTranscript ? (
                    <p
                        className="note-card-preview"
                        dangerouslySetInnerHTML={{ __html: getPreview(note.highlightedTranscript) }}
                    />
                ) : (
                    <p className="note-card-preview">{getPreview(note.transcript)}</p>
                )}

                {/* Semantic match indicator - exact matches are shown via highlighting in transcript */}
                {showMatchInfo && isSemanticMatch && (
                    <div className="match-info">
                        <div className="semantic-match-label">
                            <span className="semantic-icon">✨</span>
                            <span>Semantic match (related meaning)</span>
                        </div>
                    </div>
                )}

                <div className="note-card-footer">
                    <span className="note-card-timestamp">
                        <span className="timestamp-icon">🕐</span>
                        {formatTimestamp(note.created_at)}
                    </span>

                    <div className="note-card-actions">
                        <button
                            className="play-button"
                            onClick={handlePlayClick}
                            aria-label="Play note"
                        >
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <polygon points="5 3 19 12 5 21 5 3" />
                            </svg>
                        </button>
                        <button
                            className="delete-button"
                            onClick={handleDeleteClick}
                            aria-label="Delete note"
                        >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M3 6h18" />
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default NoteCard;
