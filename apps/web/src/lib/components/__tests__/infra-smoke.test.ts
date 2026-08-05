// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
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
});
