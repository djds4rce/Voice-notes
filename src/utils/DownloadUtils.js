/**
 * DownloadUtils
 * 
 * Helper functions for downloading notes as zip files.
 */

import JSZip from 'jszip';
import DatabaseService from '../services/DatabaseService';

/**
 * Download a note as a zip file containing:
 * - Original audio file
 * - Plain text transcript
 * - Transcript with timestamps in readable format
 * 
 * @param {number} noteId - ID of the note to download
 * @param {string} title - Title for the zip filename
 */
export async function downloadNoteZip(noteId, title = 'voice-note') {
    try {
        const db = await DatabaseService.getInstance();
        const fullNote = await db.getNoteById(noteId);

        if (!fullNote) {
            throw new Error('Note not found');
        }

        const zip = new JSZip();

        // Sanitized filename
        const safeTitle = title.replace(/[^a-z0-9]/gi, '_').toLowerCase();

        // 1. Add Audio File
        if (fullNote.audioBlob) {
            // Determine extension from mime type
            const mimeType = fullNote.audio_mime_type || 'audio/webm';
            let ext = 'webm';
            if (mimeType.includes('mp4') || mimeType.includes('m4a')) ext = 'm4a';
            else if (mimeType.includes('mp3')) ext = 'mp3';
            else if (mimeType.includes('wav')) ext = 'wav';

            zip.file(`audio.${ext}`, fullNote.audioBlob);
        }

        // 2. Add Plain Transcript
        if (fullNote.transcript) {
            zip.file('transcript.txt', fullNote.transcript);
        }

        // 3. Add Transcript with Timestamps
        if (fullNote.wordTimestamps && Array.isArray(fullNote.wordTimestamps)) {
            let currentLine = '';
            let currentTimestamp = '';
            let timestampedLines = [];

            fullNote.wordTimestamps.forEach((word, index) => {
                const time = formatTime(word.start);

                if (time !== currentTimestamp) {
                    // Push previous line if exists
                    if (currentLine) {
                        timestampedLines.push(`[${currentTimestamp}] ${currentLine.trim()}`);
                    }
                    currentTimestamp = time;
                    currentLine = word.text;
                } else {
                    // Same timestamp, append to line
                    currentLine += ' ' + word.text;
                }

                // Handle last word
                if (index === fullNote.wordTimestamps.length - 1 && currentLine) {
                    timestampedLines.push(`[${currentTimestamp}] ${currentLine.trim()}`);
                }
            });

            const timestampedText = timestampedLines.join('\n');

            zip.file('transcript_with_timestamps.txt', timestampedText);
        }

        // Generate and download zip
        const content = await zip.generateAsync({ type: 'blob' });

        const url = window.URL.createObjectURL(content);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${safeTitle}.zip`;
        document.body.appendChild(a);
        a.click();

        // Cleanup
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

    } catch (error) {
        console.error('Failed to download note zip:', error);
        throw error;
    }
}

// Helper to format seconds to MM:SS
function formatTime(seconds) {
    if (!seconds) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}
