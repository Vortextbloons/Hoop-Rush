import { describe, expect, test } from 'bun:test';
import { render } from 'svelte/server';
import Harness from './conference-standings-table.test-harness.svelte';

describe('ConferenceStandingsTable', () => {
  test('renders the cutoff after the playoff seeds and marks the user team', () => {
    const { body } = render(Harness, { props: { selectable: true } });

    expect(body).toContain('West standings');
    expect(body).toContain('Qualification cutoff');
    expect(body).toContain('Team 3');
    expect(body).toContain('You');
    expect(body).toContain('Cutoff note');
    expect(body).toContain('<button');
  });

  test('renders plain team names when selection is unavailable', () => {
    const { body } = render(Harness, { props: { selectable: false } });

    expect(body).not.toContain('<button');
    expect(body).toContain('Team 3');
  });
});
