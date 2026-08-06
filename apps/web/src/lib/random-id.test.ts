import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from './random-id';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('randomUUID', () => {
  it('returns a v4 UUID from crypto.randomUUID when available', () => {
    vi.stubGlobal('crypto', { randomUUID: () => '550e8400-e29b-41d4-a716-446655440000' });
    expect(randomUUID()).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('builds a v4 UUID from getRandomValues when randomUUID is missing', () => {
    const bytes = new Uint8Array([
      0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70, 0x80, 0x90, 0xa0, 0xb0, 0xc0, 0xd0, 0xe0, 0xf0,
      0x11,
    ]);
    vi.stubGlobal('crypto', {
      getRandomValues: (buffer: Uint8Array) => {
        buffer.set(bytes);
        return buffer;
      },
    });
    expect(randomUUID()).toBe('10203040-5060-4080-90a0-b0c0d0e0f011');
  });

  it('produces a valid v4 UUID shape from the native CSPRNG', () => {
    expect(randomUUID()).toMatch(UUID_RE);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
