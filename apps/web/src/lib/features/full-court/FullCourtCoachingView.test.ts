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

function renderView(props: { plan: FullCourtCoachingPlan; readOnly?: boolean }): string {
  return render(FullCourtCoachingView, {
    props: {
      roster: ROSTER,
      defaultRotation: DEFAULT_ROTATION,
      plan: props.plan,
      busy: false,
      onSave: () => Promise.resolve(true),
      ...(props.readOnly === undefined ? {} : { readOnly: props.readOnly }),
    },
  }).body;
}

describe('FullCourtCoachingView', () => {
  test('shows tactics, automatic rotation, and the next-game note', () => {
    const body = renderView({ plan: FULL_COURT_DEFAULT_COACHING_PLAN });

    expect(body).toContain('Set the rotation and tactics that apply from your next game.');
    expect(body).toContain('aria-label="Pace"');
    expect(body).toContain('aria-label="Offense"');
    expect(body).toContain('aria-label="Defense"');
    expect(body).toContain('aria-label="Rotation source"');
    expect(body).toContain('The staff sets the starters and minutes for every game.');
    expect(body).toContain('Discard');
    expect(body).toContain('Reset');
    expect(body).toContain('type="submit"');
    expect(body).toContain('Starter 1');
    expect(body).toContain('Minutes for Player 1');
  });

  test('shows five starters, roster minute targets, and an optional closing five', () => {
    const body = renderView({ plan: CUSTOM_PLAN });

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

  test('shows the court preview with starters, minutes, and the bench split', () => {
    const body = renderView({ plan: CUSTOM_PLAN });

    expect(body).toContain('aria-label="Starting five on the court"');
    expect(body).toContain('aria-label="Minutes"');
    expect(body).toContain('Point Guard: Player 1');
    expect(body).toContain('180 min');
    expect(body).toContain('60 min');
  });

  test('read-only browsing keeps the plan visible without save or discard controls', () => {
    const body = renderView({ plan: CUSTOM_PLAN, readOnly: true });

    expect(body).toContain('The rotation and tactics used for this run.');
    expect(body).toContain('Starter 1');
    expect(body).toContain('aria-label="Starting five on the court"');
    expect(body).not.toContain('type="submit"');
    expect(body).not.toContain('Discard');
    expect(body).not.toContain('Rotation source');
  });

  test('does not mark a freshly loaded plan as unsaved', () => {
    const body = renderView({ plan: CUSTOM_PLAN });

    expect(body).toContain('Saved');
    expect(body).not.toContain('Unsaved changes');
  });
});
