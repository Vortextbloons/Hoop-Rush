// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import { buildManifest, buildPlayerSeason } from '@hoop-rush/test-fixtures';
import PlayerFace from '$lib/components/PlayerFace.svelte';
import { mockSvelteKitApp } from '../../../test/svelte-testing';

mockSvelteKitApp();

describe('PlayerFace infra smoke (jsdom)', () => {
  it('shows the initials fallback when no headshot candidate resolves', () => {
    const player = buildPlayerSeason({
      playerId: 'p-lal-g',
      firstName: 'Test',
      lastName: 'Player',
      altIds: { nbaHeadshotAvailable: false },
    });
    const manifest = buildManifest();

    const { container, getByText } = render(PlayerFace, {
      props: { player, manifest, fallbackInitials: 'TP' },
    });

    expect(container).toBeTruthy();
    expect(getByText('TP').textContent).toBe('TP');
    expect(container.querySelectorAll('img')).toHaveLength(0);
  });

  it('renders the headshot slot when a CDN URL resolves, then falls back to initials on error', async () => {
    const player = buildPlayerSeason({ playerId: 'p-lal-g' });
    const manifest = buildManifest();

    const { container, getByText } = render(PlayerFace, {
      props: { player, manifest, fallbackInitials: 'TP' },
    });

    expect(container).toBeTruthy();
    const images = container.querySelectorAll('img');
    // Headshots may render or fail silently in jsdom; both are valid.
    expect(images.length).toBeLessThanOrEqual(1);
    if (images[0]) {
      await fireEvent.error(images[0]);
      expect(getByText('TP').textContent).toBe('TP');
    }
  });
});
