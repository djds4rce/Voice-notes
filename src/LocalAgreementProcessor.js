/**
 * LocalAgreementProcessor
 * 
 * Direct port of Python whisper_streaming's HypothesisBuffer class.
 * Uses word-level timestamps for proper duplicate detection.
 * 
 * Key principle: Only commit words that appear in BOTH the previous transcription
 * AND the current transcription (Local Agreement policy).
 * 
 * Reference: https://github.com/ufal/whisper_streaming
 * Paper: "Turning Whisper into Real-Time Transcription System" (2023)
 */
export class LocalAgreementProcessor {
    constructor() {
        // Buffer of already committed words that are still in the audio window
        this.committedInBuffer = [];
        // Previous transcription buffer (from last iteration)
        this.buffer = [];
        // New transcription (current iteration)  
        this.new = [];

        // Tracking
        this.lastCommittedTime = 0;
        this.lastCommittedWord = null;

        // All committed words across all windows
        this.allCommitted = [];

        // Configuration (from Python whisper_streaming)
        this.MAX_NGRAM_SIZE = 5;  // Check 1-5 consecutive words for duplicates
    }

    reset() {
        this.committedInBuffer = [];
        this.buffer = [];
        this.new = [];
        this.lastCommittedTime = 0;
        this.lastCommittedWord = null;
        this.allCommitted = [];
    }

    /**
     * Process new transcription with word-level timestamps
     * @param {Array<{text: string, start: number, end: number}>} chunks - Word chunks with timestamps
     * @param {number} audioWindowStart - Start time of audio window in seconds (offset)
     * @returns {{committed: string, tentative: string}}
     */
    process(chunks, audioWindowStart) {
        if (!chunks || chunks.length === 0) {
            return this._buildResult();
        }

        // Add offset to all timestamps
        const wordsWithOffset = chunks.map(chunk => ({
            text: chunk.text,
            start: chunk.start + audioWindowStart,
            end: chunk.end + audioWindowStart,
        }));

        // Insert new words with duplicate detection (Python: HypothesisBuffer.insert)
        this._insert(wordsWithOffset);

        // Flush: commit words that appear in both previous and current buffer (Python: HypothesisBuffer.flush)
        this._flush();

        return this._buildResult();
    }

    /**
     * Insert new transcription, filtering duplicates via timestamp and n-gram matching
     * Direct port of Python HypothesisBuffer.insert()
     */
    _insert(newWords) {
        // Filter words that are after the last committed time (with 0.1s tolerance)
        // Python: self.new = [(a,b,t) for a,b,t in new if a > self.last_commited_time-0.1]
        this.new = newWords.filter(w => w.start > this.lastCommittedTime - 0.1);

        if (this.new.length >= 1) {
            const firstWord = this.new[0];

            // If the first new word is close to the last committed time (within 1 second)
            // Python: if abs(a - self.last_commited_time) < 1:
            if (Math.abs(firstWord.start - this.lastCommittedTime) < 1) {
                if (this.committedInBuffer.length > 0) {
                    // N-gram duplicate removal
                    // Python: for i in range(1,min(min(cn,nn),5)+1):
                    const cn = this.committedInBuffer.length;
                    const nn = this.new.length;

                    for (let i = 1; i <= Math.min(Math.min(cn, nn), this.MAX_NGRAM_SIZE); i++) {
                        // Get last i words from committed buffer
                        // Python: c = " ".join([self.commited_in_buffer[-j][2] for j in range(1,i+1)][::-1])
                        const committedTail = this.committedInBuffer
                            .slice(-i)
                            .map(w => w.text)
                            .join(" ");

                        // Get first i words from new
                        // Python: tail = " ".join(self.new[j-1][2] for j in range(1,i+1))
                        const newHead = this.new
                            .slice(0, i)
                            .map(w => w.text)
                            .join(" ");

                        if (committedTail.toLowerCase() === newHead.toLowerCase()) {
                            // Remove duplicate words from the beginning of new
                            // Python: for j in range(i): words.append(repr(self.new.pop(0)))
                            const removed = this.new.splice(0, i);
                            console.log(`[LocalAgreement] N-gram match (${i} words): removed "${removed.map(w => w.text).join(" ")}"`);
                            break;
                        }
                    }
                }
            }
        }

        console.log(`[LocalAgreement] After insert: ${this.new.length} new words, lastCommittedTime=${this.lastCommittedTime.toFixed(2)}s`);
    }

    /**
     * Commit words that appear in BOTH previous buffer AND current new transcription
     * This is the core "Local Agreement" logic.
     * Direct port of Python HypothesisBuffer.flush()
     */
    _flush() {
        const commit = [];

        // Python: while self.new:
        while (this.new.length > 0) {
            const newWord = this.new[0];

            // If previous buffer is empty, can't confirm yet
            // Python: if len(self.buffer) == 0: break
            if (this.buffer.length === 0) {
                break;
            }

            // LOCAL AGREEMENT: Only commit if word matches between previous and current
            // Python: if nt == self.buffer[0][2]:
            if (newWord.text.toLowerCase() === this.buffer[0].text.toLowerCase()) {
                commit.push(newWord);
                this.lastCommittedWord = newWord.text;
                this.lastCommittedTime = newWord.end;
                this.buffer.shift();  // Python: self.buffer.pop(0)
                this.new.shift();     // Python: self.new.pop(0)
            } else {
                // Words don't match - stop committing
                break;
            }
        }

        // Move remaining new words to buffer for next iteration
        // Python: self.buffer = self.new; self.new = []
        this.buffer = this.new;
        this.new = [];

        // Add committed words to tracking
        // Python: self.commited_in_buffer.extend(commit)
        this.committedInBuffer.push(...commit);
        this.allCommitted.push(...commit);

        if (commit.length > 0) {
            console.log(`[LocalAgreement] Committed ${commit.length} words: "${commit.map(w => w.text).join(" ")}" (until ${this.lastCommittedTime.toFixed(2)}s)`);
        }

        return commit;
    }

    /**
     * Remove old committed words when audio buffer is trimmed
     * Direct port of Python HypothesisBuffer.pop_commited()
     */
    popCommitted(time) {
        while (this.committedInBuffer.length > 0 && this.committedInBuffer[0].end <= time) {
            this.committedInBuffer.shift();
        }
    }

    /**
     * Get currently uncommitted (tentative) words
     * Direct port of Python HypothesisBuffer.complete()
     */
    getTentative() {
        return this.buffer;
    }

    /**
     * Build result with committed and tentative text
     */
    _buildResult() {
        const committed = this.allCommitted.map(w => w.text).join(" ");
        const tentative = this.buffer.map(w => w.text).join(" ");

        return {
            committed,
            tentative
        };
    }

    /**
     * Get all committed text
     */
    getCommittedText() {
        return this.allCommitted.map(w => w.text).join(" ");
    }

    /**
     * Finalize transcription by committing all remaining buffer words
     * Called when recording stops - no more local agreement needed
     */
    finalize() {
        // Commit all words in buffer (tentative) since we won't get more confirmations
        if (this.buffer.length > 0) {
            console.log(`[LocalAgreement] Finalizing: committing ${this.buffer.length} remaining buffer words`);
            for (const word of this.buffer) {
                this.allCommitted.push(word);
                this.lastCommittedTime = word.end;
                this.lastCommittedWord = word.text;
            }
            this.committedInBuffer.push(...this.buffer);
            this.buffer = [];
        }

        // Also commit any words in 'new' buffer
        if (this.new.length > 0) {
            console.log(`[LocalAgreement] Finalizing: committing ${this.new.length} remaining new words`);
            for (const word of this.new) {
                this.allCommitted.push(word);
                this.lastCommittedTime = word.end;
                this.lastCommittedWord = word.text;
            }
            this.committedInBuffer.push(...this.new);
            this.new = [];
        }

        return this._buildResult();
    }

    /**
     * Get all committed chunks with timestamps
     * @returns {Array<{text: string, start: number, end: number}>}
     */
    getAllCommittedChunks() {
        return [...this.allCommitted];
    }
}
