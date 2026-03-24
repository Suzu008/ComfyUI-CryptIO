/**
 * Chunked base64 encode/decode utilities.
 * Avoids call-stack overflow on large Uint8Arrays that
 * `btoa(String.fromCharCode(...largeArray))` would cause.
 */

const CHUNK_SIZE = 8192;

export function base64ToBytes(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
        const chunk = bytes.subarray(i, i + CHUNK_SIZE);
        binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
}
