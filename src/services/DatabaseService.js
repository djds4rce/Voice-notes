/**
 * DatabaseService
 * 
 * Manages local storage using PGlite.
 * All data is stored in IndexedDB for persistence.
 * Note: pgvector semantic search is disabled for simpler setup.
 * Keyword search is used instead.
 */

import { PGlite } from '@electric-sql/pglite';

class DatabaseService {
    static instance = null;
    db = null;
    initialized = false;

    static async getInstance() {
        if (!this.instance) {
            this.instance = new DatabaseService();
            await this.instance.initialize();
        }
        return this.instance;
    }

    async initialize() {
        if (this.initialized) return;

        try {
            // Create PGlite with IndexedDB persistence
            this.db = new PGlite('idb://voice-notes');

            // Wait for database to be ready
            await this.db.waitReady;

            // Create voice_notes table
            await this.db.exec(`
        CREATE TABLE IF NOT EXISTS voice_notes (
          id SERIAL PRIMARY KEY,
          title TEXT,
          transcript TEXT NOT NULL,
          audio_blob BYTEA,
          audio_mime_type TEXT DEFAULT 'audio/webm',
          duration_seconds REAL,
          word_timestamps TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_voice_notes_created_at
          ON voice_notes(created_at DESC);
      `);

            this.initialized = true;
            console.log('[DatabaseService] Initialized with PGlite');
        } catch (error) {
            console.error('[DatabaseService] Initialization failed:', error);
            throw error;
        }
    }

    /**
     * Create a new voice note
     * @param {Object} note - The note to create
     * @param {string} note.transcript - The transcribed text
     * @param {Blob} note.audioBlob - The audio recording
     * @param {number} note.durationSeconds - Duration in seconds
     * @param {Array} note.wordTimestamps - Word-level timestamps
     * @returns {Promise<Object>} The created note with id
     */
    async createNote({ transcript, audioBlob, durationSeconds, wordTimestamps }) {
        // Generate title from first few words of transcript
        const title = this.generateTitle(transcript);

        // Convert audio blob to base64 for storage
        const audioBase64 = await this.blobToBase64(audioBlob);
        const mimeType = audioBlob?.type || 'audio/webm';

        // Serialize word timestamps to JSON
        const timestampsJson = wordTimestamps ? JSON.stringify(wordTimestamps) : null;

        // Store local time for display (format: 'YYYY-MM-DD HH:mm:ss')
        const now = new Date();
        const localTimestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

        const query = `
      INSERT INTO voice_notes (title, transcript, audio_blob, audio_mime_type, duration_seconds, word_timestamps, created_at, updated_at)
      VALUES ($1, $2, decode($3, 'base64'), $4, $5, $6, $7, $7)
      RETURNING id, title, transcript, duration_seconds, created_at
    `;
        const params = [title, transcript, audioBase64, mimeType, durationSeconds, timestampsJson, localTimestamp];

        const result = await this.db.query(query, params);
        console.log('[DatabaseService] Created note:', result.rows[0]);
        return result.rows[0];
    }

    /**
     * Get all voice notes ordered by creation date
     * @returns {Promise<Array>} Array of notes (without audio blob for performance)
     */
    async getAllNotes() {
        const result = await this.db.query(`
      SELECT id, title, transcript, duration_seconds, created_at, updated_at
      FROM voice_notes
      ORDER BY created_at DESC
    `);
        return result.rows;
    }

    /**
     * Get a single note by ID including audio
     * @param {number} id - The note ID
     * @returns {Promise<Object|null>} The note with audio blob
     */
    async getNoteById(id) {
        const result = await this.db.query(`
      SELECT id, title, transcript, encode(audio_blob, 'base64') as audio_base64, 
             audio_mime_type, duration_seconds, word_timestamps, created_at, updated_at
      FROM voice_notes
      WHERE id = $1
    `, [id]);

        if (result.rows.length === 0) return null;

        const note = result.rows[0];
        // Convert base64 back to blob if audio exists
        if (note.audio_base64) {
            note.audioBlob = this.base64ToBlob(note.audio_base64, note.audio_mime_type);
            delete note.audio_base64;
        }
        // Parse word timestamps from JSON
        if (note.word_timestamps) {
            try {
                note.wordTimestamps = JSON.parse(note.word_timestamps);
            } catch (e) {
                console.warn('[DatabaseService] Failed to parse word_timestamps:', e);
                note.wordTimestamps = null;
            }
        }
        return note;
    }

    /**
     * Delete a note by ID
     * @param {number} id - The note ID
     */
    async deleteNote(id) {
        await this.db.query('DELETE FROM voice_notes WHERE id = $1', [id]);
        console.log('[DatabaseService] Deleted note:', id);
    }

    /**
     * Full-text keyword search
     * @param {string} query - Search query
     * @param {number} limit - Maximum number of results
     * @returns {Promise<Array>} Matching notes
     */
    async keywordSearch(query, limit = 20) {
        const searchPattern = `%${query.toLowerCase()}%`;

        const result = await this.db.query(`
      SELECT id, title, transcript, duration_seconds, created_at
      FROM voice_notes
      WHERE LOWER(transcript) LIKE $1 OR LOWER(title) LIKE $1
      ORDER BY created_at DESC
      LIMIT $2
    `, [searchPattern, limit]);

        return result.rows;
    }

    /**
     * Get storage statistics
     * @returns {Promise<Object>} Storage info
     */
    async getStorageStats() {
        const result = await this.db.query(`
      SELECT 
        COUNT(*) as total_notes,
        COALESCE(SUM(duration_seconds), 0) as total_duration_seconds
      FROM voice_notes
    `);
        return result.rows[0];
    }

    // Helper: Generate title from transcript
    generateTitle(transcript) {
        if (!transcript || transcript.trim().length === 0) {
            return 'Voice Note';
        }
        const words = transcript.trim().split(/\s+/).slice(0, 5);
        let title = words.join(' ');
        if (transcript.trim().split(/\s+/).length > 5) {
            title += '...';
        }
        return title;
    }

    // Helper: Convert Blob to base64
    async blobToBase64(blob) {
        if (!blob) return null;
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64 = reader.result.split(',')[1];
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    // Helper: Convert base64 to Blob
    base64ToBlob(base64, mimeType = 'audio/webm') {
        const byteCharacters = atob(base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        return new Blob([byteArray], { type: mimeType });
    }
}

export default DatabaseService;
