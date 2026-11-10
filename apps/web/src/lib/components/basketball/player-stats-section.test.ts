import { describe, expect, test } from 'bun:test';
import { render } from 'svelte/server';
import Harness from './player-stats-section.test-harness.svelte';

const rows = [{ id: 'p1', name: 'Ada Lovelace', slot: 'PG', minutes: 32, points: 18, rebounds: 7 }];

describe('PlayerStatsSection', () => {
  test('renders the player table and omits controls in the empty state', () => {
    const { body } = render(Harness, { props: { rows } });

    expect(body).toContain('aria-label="Test player stats"');
    expect(body).toContain('aria-label="Roster"');
    expect(body).toContain('aria-label="Stat values"');
    expect(body).toContain('data-player-stats-table');
    expect(body).toContain('data-sticky-identity="true"');
    expect(body).toContain('data-align="start"');
    expect(body).toContain('data-hide-below="sm"');
    expect(body.match(/data-hide-below="sm"/g)).toHaveLength(2);
    expect(body).toContain('ui-stats-value-strong');
    expect(body).toContain('Ada Lovelace');
    expect(body).toContain('Per-game averages');
    expect(body).toContain('Test player stats table');

    const empty = render(Harness, { props: { rows: null } }).body;
    expect(empty).toContain('No player stats');
    expect(empty).not.toContain('data-player-stats-table');
    expect(empty).not.toContain('aria-label="Roster"');
    expect(empty).not.toContain('Per-game averages');
  });
});
