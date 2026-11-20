import { describe, expect, test } from 'bun:test';
import {
  FULL_COURT_DEFAULT_COACHING_PLAN,
  playerIdSchema,
  type FullCourtCoachingPlan,
  type SimulationPlayer,
} from '@hoop-rush/data-contracts';
import { buildSimulationPlayer } from '@hoop-rush/test-fixtures';
import { render } from 'svelte/server';
import FullCourtCoachingView from './FullCourtCoachingView.svelte';

const ROSTER: readonly SimulationPlayer[] = Array.from({ length: 8 }, (_, index) =>
  buildSimulationPlayer({
    playerId: playerIdSchema.parse(`p${String(index + 1)}`),
    displayName: `Player ${String(index + 1)}`,
    positions: [index < 3 ? 'PG' : index < 5 ? 'SF' : 'C'],
  }),
);
const DEFAULT_ROTATION: NonNullable<FullCourtCoachingPlan['rotation']> = {
  startingFive: ['p1', 'p2', 'p3', 'p4', 'p5'],
  minuteTargets: { p1: 40, p2: 38, p3: 36, p4: 34, p5: 32, p6: 28, p7: 20, p8: 12 },
};
const CUSTOM_PLAN: FullCourtCoachingPlan = {
  schemaVersion: 1,
  tactics: { pace: 'fast', offense: 'perimeter', defense: 'pressure' },
  rotation: {
    startingFive: ['p1', 'p2', 'p3', 'p4', 'p5'],
    minuteTargets: { p1: 40, p2: 38, p3: 36, p4: 34, p5: 32, p6: 28, p7: 20, p8: 12 },
    closingFive: ['p1', 'p2', 'p3', 'p4', 'p6'],
  },
};

function renderView(plan: FullCourtCoachingPlan): string {
  return render(FullCourtCoachingView, {
    props: {
      roster: ROSTER,
      defaultRotation: DEFAULT_ROTATION,
      plan,
      busy: false,
      onSave: () => Promise.resolve(true),
    },
  }).body;
}

describe('FullCourtCoachingView', () => {
  test('shows tactics, automatic rotation, and the next-game note', () => {
    const body = renderView(FULL_COURT_DEFAULT_COACHING_PLAN);

    expect(body).toContain('Tactics and rotation');
    expect(body).toContain('Save to apply these settings from your next game.');
    expect(body).toContain('aria-label="Pace"');
    expect(body).toContain('aria-label="Offense"');
    expect(body).toContain('aria-label="Defense"');
    expect(body).toContain('aria-label="Rotation source"');
    expect(body).toContain('The staff sets the starters and minutes for every game.');
    expect(body).toContain('Cancel');
    expect(body).toContain('Reset');
    expect(body).toContain('type="submit"');
    expect(body).not.toContain('Starter 1');
    expect(body).not.toContain('Minutes for Player 1');
  });

  test('shows five starters, roster minute targets, and an optional closing five', () => {
    const body = renderView(CUSTOM_PLAN);

    expect(body).toContain('Positions are advisory');
    expect(body).toContain('Starter 1');
    expect(body).toContain('Starter 5');
    expect(body.split('Minutes for ').length - 1).toBe(ROSTER.length);
    expect(body).toContain('240 / 240 min');
    expect(body).toContain('All 240 minutes assigned.');
    expect(body).toContain('Starter');
    expect(body).toContain('Bench');
    expect(body).toContain('Closer 1');
    expect(body).toContain('Closer 5');
  });
});
