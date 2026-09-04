import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { buildManifest, buildPlayerSeason } from '@hoop-rush/test-fixtures';
import { playerIdSchema } from '@hoop-rush/data-contracts';
import PlayerFace from '$lib/components/PlayerFace.svelte';
import { mockSvelteKitApp } from '../../../test/svelte-testing';
mockSvelteKitApp();
describe('PlayerFace infra smoke (jsdom)', () => {
  afterEach(() => vi.useRealTimers());
  it('shows the initials fallback when no headshot candidate resolves', () => {
    const player = buildPlayerSeason({
      playerId: playerIdSchema.parse('p-lal-g'),
      firstName: 'Test',
      lastName: 'Player',
      altIds: { nbaHeadshotAvailable: false },
    });
    const manifest = buildManifest();
    const { container, getByText } = render(PlayerFace, {
      props: { player, manifest, fallbackInitials: 'TP' },
    });
    expect(getByText('TP').textContent).toBe('TP');
    expect(container.querySelectorAll('img')).toHaveLength(0);
  });
  it('does not time out a valid lazy headshot before the browser requests it', () => {
    vi.useFakeTimers();
    const photoUrl = 'https://upload.wikimedia.org/player-photo.png';
    const player = buildPlayerSeason({
      playerId: playerIdSchema.parse('p-lazy-photo'),
      playerExternalId: '999999',
      firstName: 'Lazy',
      lastName: 'Photo',
      altIds: { nbaHeadshotAvailable: false, photoUrl },
    });
    const { container } = render(PlayerFace, {
      props: { player, manifest: buildManifest(), fallbackInitials: 'LP' },
    });
    const image = container.querySelector('img');
    expect(image?.getAttribute('src')).toBe(photoUrl);
    if (image === null) throw new Error('expected a lazy player photo');
    Object.defineProperty(image, 'complete', { configurable: true, value: false });
    Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 0 });
    vi.advanceTimersByTime(30000);
    expect(container.querySelector('img')?.getAttribute('src')).toBe(photoUrl);
    expect(container.textContent).not.toContain('LP');
  });
});
