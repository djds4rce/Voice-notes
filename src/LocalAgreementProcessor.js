/**
 * LocalAgreementProcessor
 * 
 * Handles transcription stability using the Local Agreement algorithm.
 * Detects window shifts and handles duplicate text detection.
 */
export class LocalAgreementProcessor {
    constructor() {
        this.SUFFIX_SIZE = 45;
        this.WINDOW_SHIFT_THRESHOLD = 0.5;
        this.MIN_OVERLAP_LENGTH = 2;
        this.reset();
    }

    reset() {
        this.committedText = "";
        this.lastWindowStart = 0;
        this.committedSuffix = [];
        this.previousWords = [];
        this.segmentCommittedCount = 0;
    }

    /**
     * Process new transcription and return committed + tentative text
     */
    process(transcription, audioWindowStart) {
        const currentWords = tokenize(transcription);

        if (currentWords.length === 0) {
            return this._buildResult([]);
        }

        const windowShifted = audioWindowStart > this.lastWindowStart + this.WINDOW_SHIFT_THRESHOLD;

        if (windowShifted) {
            return this._handleWindowShift(currentWords, audioWindowStart);
        }

        return this._handleSameWindow(currentWords, audioWindowStart);
    }

    _handleWindowShift(currentWords, audioWindowStart) {
        console.log(`\n[LocalAgreement] Window shift: ${this.lastWindowStart.toFixed(1)}s → ${audioWindowStart.toFixed(1)}s`);

        // Finalize pending words
        if (this.segmentCommittedCount > 0 && this.previousWords.length > 0) {
            const toFinalize = this.previousWords.slice(0, this.segmentCommittedCount).join(" ");
            if (toFinalize) {
                this.committedText = appendText(this.committedText, toFinalize);
                this._updateCommittedSuffix();
                console.log(`[LocalAgreement] Finalized: "${toFinalize}"`);
            }
        }

        // Find and skip duplicates
        const duplicateCount = this._findOverlapLength(currentWords);
        const newWords = currentWords.slice(duplicateCount);
        console.log(`[LocalAgreement] Skipped ${duplicateCount} duplicates, ${newWords.length} new words`);

        // Reset for new window
        this.previousWords = newWords;
        this.segmentCommittedCount = 0;
        this.lastWindowStart = audioWindowStart;

        return this._buildResult(newWords);
    }

    _handleSameWindow(currentWords, audioWindowStart) {
        this.lastWindowStart = audioWindowStart;

        const matchCount = countMatchingPrefix(this.previousWords, currentWords);
        if (matchCount > this.segmentCommittedCount) {
            this.segmentCommittedCount = matchCount;
        }
        this.previousWords = currentWords;

        return this._buildResultWithSegment(currentWords);
    }

    _updateCommittedSuffix() {
        const words = tokenize(this.committedText);
        this.committedSuffix = words.slice(-this.SUFFIX_SIZE);
    }

    _findOverlapLength(newWords) {
        if (this.committedSuffix.length === 0 || newWords.length === 0) {
            return 0;
        }

        const maxOverlap = Math.min(this.committedSuffix.length, newWords.length);

        for (let len = maxOverlap; len >= this.MIN_OVERLAP_LENGTH; len--) {
            const suffix = this.committedSuffix.slice(-len);
            const prefix = newWords.slice(0, len);

            if (suffix.every((w, i) => w.toLowerCase() === prefix[i].toLowerCase())) {
                console.log(`[LocalAgreement] Found ${len} duplicate words`);
                return len;
            }
        }

        return 0;
    }

    _buildResult(tentativeWords) {
        return {
            committed: this.committedText,
            tentative: tentativeWords.join(" "),
        };
    }

    _buildResultWithSegment(currentWords) {
        const segmentCommitted = currentWords.slice(0, this.segmentCommittedCount).join(" ");
        const fullCommitted = appendText(this.committedText, segmentCommitted);

        // Get tentative words and filter duplicates before returning
        let tentativeWords = currentWords.slice(this.segmentCommittedCount);

        // Build a temporary suffix from fullCommitted to check for duplicates
        const fullCommittedWords = tokenize(fullCommitted);
        const tempSuffix = fullCommittedWords.slice(-this.SUFFIX_SIZE);

        if (tempSuffix.length > 0 && tentativeWords.length > 0) {
            const duplicateCount = this._findOverlapLengthWith(tempSuffix, tentativeWords);
            if (duplicateCount > 0) {
                console.log(`[LocalAgreement] Filtered ${duplicateCount} duplicates from tentative`);
                tentativeWords = tentativeWords.slice(duplicateCount);
            }
        }

        return {
            committed: fullCommitted,
            tentative: tentativeWords.join(" "),
        };
    }

    _findOverlapLengthWith(suffix, newWords) {
        if (suffix.length === 0 || newWords.length === 0) {
            return 0;
        }

        const maxOverlap = Math.min(suffix.length, newWords.length);

        for (let len = maxOverlap; len >= this.MIN_OVERLAP_LENGTH; len--) {
            const suffixPart = suffix.slice(-len);
            const prefix = newWords.slice(0, len);

            if (suffixPart.every((w, i) => w.toLowerCase() === prefix[i].toLowerCase())) {
                return len;
            }
        }

        return 0;
    }
}

function tokenize(text) {
    return text.trim().split(/\s+/).filter(w => w.length > 0);
}

function appendText(existing, addition) {
    if (!addition) return existing;
    return existing + (existing ? " " : "") + addition;
}

function countMatchingPrefix(words1, words2) {
    const minLen = Math.min(words1.length, words2.length);
    let count = 0;
    for (let i = 0; i < minLen; i++) {
        if (words1[i].toLowerCase() === words2[i].toLowerCase()) {
            count++;
        } else {
            break;
        }
    }
    return count;
}
