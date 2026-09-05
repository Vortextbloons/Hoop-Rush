import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createFixedFiveTransport } from '$lib/fixed-five-transport';
const LIVE = process.env.FIXED_FIVE_LIVE_E2E === '1';
function liveEnv(): {
  url: string;
  publishableKey: string;
} {
  const direct = {
    url: process.env.VITE_SUPABASE_URL,
    publishableKey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  };
  if (direct.url && direct.publishableKey)
    return direct as {
      url: string;
      publishableKey: string;
    };
  const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const text = readFileSync(join(webRoot, '.env.local'), 'utf8');
  const parsed: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index > 0) parsed[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
  const url = parsed['VITE_SUPABASE_URL'];
  const publishableKey = parsed['VITE_SUPABASE_PUBLISHABLE_KEY'];
  if (!url || !publishableKey) throw new Error('live supabase env unavailable');
  return { url, publishableKey };
}
function versions() {
  return {
    dataVersion: 'data-v1',
    ratingVersion: 'ratings-v3.8',
    positionNormalizationVersion: 'position-v3',
    engineVersion: 'm3-engine-v14',
    bracketVersion: 'bracket-m3-v3',
    scheduleVersion: 'schedule-v1',
    seedDerivationVersion: 'seed-v1',
    classicRollVersion: 'classic-roll-v1',
    profileVersion: '2010s-fixed-v1',
    multiplayerVersion: 'fixed-five-multiplayer-v1',
    autopickVersion: 'fixed-five-autopick-v1',
  };
}
describe.skipIf(!LIVE)('fixed-five live join (diagnostic, hits the real backend)', () => {
  it('guest previews and joins a fresh room with zero client parse errors', async () => {
    const { url, publishableKey } = liveEnv();
    const host = createFixedFiveTransport({ url, publishableKey, storageKey: 'ff-e2e-host' });
    const guest = createFixedFiveTransport({ url, publishableKey, storageKey: 'ff-e2e-guest' });
    const created = await host.create({
      mode: 'classic-shared-82',
      sourceMode: 'classic',
      variant: 'ratings',
      versions: versions(),
    });
    expect(created.code).toMatch(/^[0-9]{4}$/);
    console.log(`E2E_ROOM ${created.snapshot.roomId}`);
    const previewed = await guest.preview(created.code);
    expect(previewed.settings.mode).toBe('classic-shared-82');
    const joined = await guest.join(created.code);
    expect(joined.membership.participantId).toBe('p2');
    expect(joined.snapshot.members).toHaveLength(2);
    expect(joined.snapshot.settings.variant).toBe('ratings');
    expect(joined.snapshot.rootSeed).toMatch(/^[0-9a-f]{16,64}$/);
  }, 60000);
});
