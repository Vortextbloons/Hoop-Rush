import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defaultFixedFiveVersionLocks } from '@hoop-rush/data-contracts';
import { createFixedFiveTransport, isUsablePublishableKey } from './fixed-five-transport';

function base64url(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function legacyJwt(role: string): string {
  const header = base64url({ alg: 'HS256', typ: 'JWT' });
  const payload = base64url({ iss: 'supabase', ref: 'abcdefgh', role, iat: 1 });
  return `${header}.${payload}.c2lnbmF0dXJl`;
}

const SECRET_KEY_PATTERN = /sb_secret_[A-Za-z0-9_-]{8,}/g;
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;

function exposedSecrets(text: string): string[] {
  const exposed: string[] = [];
  for (const match of text.matchAll(SECRET_KEY_PATTERN)) exposed.push(match[0]);
  for (const match of text.matchAll(JWT_PATTERN)) {
    const segment = match[0].split('.')[1] ?? '';
    try {
      const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
      const payload: unknown = JSON.parse(atob(normalized));
      const role = (payload as Record<string, unknown>)['role'];
      if (role !== 'anon') exposed.push(match[0]);
    } catch {
      exposed.push(match[0]);
    }
  }
  return exposed;
}

describe('fixed-five transport key validation', () => {
  it('accepts modern publishable keys', () => {
    expect(isUsablePublishableKey(`sb_publishable_${'a'.repeat(32)}`)).toBe(true);
  });

  it('rejects secret keys even when they look well formed', () => {
    expect(isUsablePublishableKey(`sb_secret_${'a'.repeat(32)}`)).toBe(false);
  });

  it('accepts legacy JWTs only when the payload role is anon', () => {
    expect(isUsablePublishableKey(legacyJwt('anon'))).toBe(true);
    expect(isUsablePublishableKey(legacyJwt('service_role'))).toBe(false);
    expect(isUsablePublishableKey(legacyJwt('authenticated'))).toBe(false);
  });

  it('rejects malformed, short, whitespace, and placeholder keys', () => {
    expect(isUsablePublishableKey('eyJhbGciOiJIUzI1NiJ9.not-base64..signature')).toBe(false);
    expect(isUsablePublishableKey('eyJhbGciOiJIUzI1NiJ9')).toBe(false);
    expect(isUsablePublishableKey('sb_publishable_abc')).toBe(false);
    expect(isUsablePublishableKey(`sb_publishable_${'a'.repeat(20)} with space`)).toBe(false);
    expect(isUsablePublishableKey('sb_publishable_your-key-here-value')).toBe(false);
  });

  it('falls back to the in-memory transport for missing or invalid keys', async () => {
    const settings = {
      mode: 'duel' as const,
      sourceMode: 'classic' as const,
      variant: 'ratings' as const,
      versions: defaultFixedFiveVersionLocks({}),
    };
    const secretTransport = createFixedFiveTransport({
      url: 'https://project-ref.supabase.co',
      publishableKey: `sb_secret_${'a'.repeat(32)}`,
    });
    const secretRoom = await secretTransport.create(settings);
    expect(secretRoom.snapshot.phase).toBe('lobby');

    const missingKeyTransport = createFixedFiveTransport({
      url: 'https://project-ref.supabase.co',
    });
    const missingKeyRoom = await missingKeyTransport.create(settings);
    expect(missingKeyRoom.snapshot.phase).toBe('lobby');
  });
});

describe('fixed-five transport secret sentinel', () => {
  it('does not expose secret-shaped values in the transport source or env example', () => {
    const transportSource = readFileSync(new URL('./fixed-five-transport.ts', import.meta.url), {
      encoding: 'utf8',
    });
    const envExample = readFileSync(new URL('../../.env.example', import.meta.url), {
      encoding: 'utf8',
    });
    expect(exposedSecrets(transportSource)).toEqual([]);
    expect(exposedSecrets(envExample)).toEqual([]);
  });
});
