import { afterEach, describe, expect, it, vi } from 'vitest';
import { sha256Hex, verifySha256 } from './verify-hash.ts';
const KNOWN_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const abcBuffer = (): ArrayBuffer => new TextEncoder().encode('abc').buffer;
describe('sha256Hex', () => {
    it('produces the SHA-256 digest of the input bytes', async () => {
        expect(await sha256Hex(abcBuffer())).toBe(KNOWN_SHA256);
    });
    it('returns null when WebCrypto is unavailable', async () => {
        vi.stubGlobal('crypto', {});
        expect(await sha256Hex(abcBuffer())).toBeNull();
    });
});
describe('verifySha256', () => {
    it('passes when the content hash matches', async () => {
        await expect(verifySha256(abcBuffer(), KNOWN_SHA256)).resolves.toBeUndefined();
    });
    it('throws when the content hash mismatches', async () => {
        await expect(verifySha256(abcBuffer(), '0'.repeat(64))).rejects.toThrow(/content hash mismatch/);
    });
    it('throws when WebCrypto is unavailable', async () => {
        vi.stubGlobal('crypto', {});
        await expect(verifySha256(abcBuffer(), '0'.repeat(64))).rejects.toThrow(/content hash unavailable/);
    });
});
afterEach(() => {
    vi.unstubAllGlobals();
});
