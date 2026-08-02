import { describe, expect, it } from 'vitest';
import { buildManifest } from '@hoop-rush/test-fixtures';
import { buildSandboxUrl, parseSandboxUrl } from './sandbox-url';

function manifestWithAvailability(): ReturnType<typeof buildManifest> {
  const manifest = buildManifest();
  // Mark lakers/1990s and thunder/1980s available; leave the rest unavailable.
  const available: Record<string, boolean> = { 'lakers/1990s': true, 'thunder/1980s': true };
  manifest.availability = manifest.availability.map((entry) => {
    const key = `${entry.franchiseId}/${entry.eraId}`;
    if (entry.status === 'available' || !available[key]) return entry;
    return {
      franchiseId: entry.franchiseId,
      eraId: entry.eraId,
      status: 'available',
      url: `pools/${entry.franchiseId}-${entry.eraId}.json`,
      contentHash: 'a'.repeat(64),
      playerCount: 20,
      coverageSummary: {
        coverageBand: 'complete-box-derived',
        observedFamilies: ['base'],
        derivedFamilies: ['advanced'],
        estimatedFamilies: [],
        missingCategories: [],
        lowConfidenceShare: 0,
        policyVersion: 'policy-v1',
      },
    };
  });
  return manifest;
}

describe('buildSandboxUrl', () => {
  it('encodes franchise, era, slots, and seed', () => {
    const href = buildSandboxUrl({
      franchiseId: 'lakers',
      eraId: '1990s',
      slots: ['p-1', 'p-2', 'p-3', 'p-4', 'p-5'],
      seed: 'a'.repeat(32),
    });
    const url = new URL(href, 'https://example.com');
    expect(url.searchParams.get('franchise')).toBe('lakers');
    expect(url.searchParams.get('era')).toBe('1990s');
    expect(url.searchParams.get('slots')).toBe('p-1,p-2,p-3,p-4,p-5');
    expect(url.searchParams.get('seed')).toBe('a'.repeat(32));
  });

  it('omits slots when none are drafted', () => {
    const href = buildSandboxUrl({ franchiseId: 'lakers', eraId: '1990s' });
    expect(href).toBe('/sandbox?franchise=lakers&era=1990s');
  });
});

describe('parseSandboxUrl', () => {
  const manifest = manifestWithAvailability();

  it('accepts a valid available pair without slots', () => {
    const result = parseSandboxUrl(
      new URL('/sandbox?franchise=lakers&era=1990s', 'https://example.com'),
      manifest,
    );
    expect(result.ok).toBe(true);
    expect(result.state).toEqual({
      franchiseId: 'lakers',
      eraId: '1990s',
      slots: undefined,
      seed: undefined,
    });
  });

  it('accepts five validated player slots', () => {
    const result = parseSandboxUrl(
      new URL(
        '/sandbox?franchise=lakers&era=1990s&slots=p-1,p-2,p-3,p-4,p-5',
        'https://example.com',
      ),
      manifest,
    );
    expect(result.ok).toBe(true);
    expect(result.state?.slots).toEqual(['p-1', 'p-2', 'p-3', 'p-4', 'p-5']);
  });

  it('rejects a missing franchise or decade', () => {
    expect(
      parseSandboxUrl(new URL('/sandbox?franchise=lakers', 'https://example.com'), manifest).ok,
    ).toBe(false);
    expect(parseSandboxUrl(new URL('/sandbox?era=1990s', 'https://example.com'), manifest).ok).toBe(
      false,
    );
  });

  it('rejects an unknown franchise or decade', () => {
    expect(
      parseSandboxUrl(new URL('/sandbox?franchise=nope&era=1990s', 'https://example.com'), manifest)
        .ok,
    ).toBe(false);
    expect(
      parseSandboxUrl(
        new URL('/sandbox?franchise=lakers&era=1800s', 'https://example.com'),
        manifest,
      ).ok,
    ).toBe(false);
  });

  it('rejects an unavailable combination even when known', () => {
    const result = parseSandboxUrl(
      new URL('/sandbox?franchise=pelicans&era=1980s', 'https://example.com'),
      manifest,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not available');
  });

  it('rejects malformed slot lists', () => {
    const base = '/sandbox?franchise=lakers&era=1990s&slots=';
    expect(
      parseSandboxUrl(new URL(`${base}p-1,p-2,p-3,p-4`, 'https://example.com'), manifest).ok,
    ).toBe(false);
    expect(
      parseSandboxUrl(new URL(`${base}p-1,p-1,p-3,p-4,p-5`, 'https://example.com'), manifest).ok,
    ).toBe(false);
  });

  it('rejects a malformed seed', () => {
    const result = parseSandboxUrl(
      new URL('/sandbox?franchise=lakers&era=1990s&seed=not-hex', 'https://example.com'),
      manifest,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('seed');
  });
});
