/**
 * Decodes an audio blob and ensures the output is 16kHz mono,
 * which is required for Whisper.
 * 
 * Includes fallback for resampling if the browser allows decoding but 
 * doesn't support setting the sample rate in the AudioContext constructor 
 * (common on iOS).
 */
export async function decodeAudioBlob(blob, audioContext) {
    if (!blob || blob.size === 0) return new Float32Array(0);

    const arrayBuffer = await blob.arrayBuffer();

    // AudioContext.decodeAudioData is consistent across browsers
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const TARGET_RATE = 16000;

    // If the sample rate already matches, return the data directly
    if (audioBuffer.sampleRate === TARGET_RATE) {
        return audioBuffer.getChannelData(0);
    }

    // Otherwise, we must resample using an OfflineAudioContext
    // This is robust and high-quality
    const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OfflineContext) {
        console.warn('OfflineAudioContext not capable, returning original sample rate data (may fail)');
        return audioBuffer.getChannelData(0);
    }

    // Calculate new duration
    // duration (s) is same, but sample count changes
    const newLength = Math.ceil(audioBuffer.duration * TARGET_RATE);

    const offlineContext = new OfflineContext(1, newLength, TARGET_RATE);
    const source = offlineContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineContext.destination);
    source.start(0);

    const rendered = await offlineContext.startRendering();
    return rendered.getChannelData(0);
}
