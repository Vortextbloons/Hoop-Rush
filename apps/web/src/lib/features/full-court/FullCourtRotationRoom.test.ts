import { describe, expect, test } from 'bun:test';
import { playerIdSchema } from '@hoop-rush/data-contracts';
import { buildSimulationPlayer } from '@hoop-rush/test-fixtures';
import { render } from 'svelte/server';
import FullCourtCourtLineup from './FullCourtCourtLineup.svelte';
import FullCourtHierarchyCards from './FullCourtHierarchyCards.svelte';
import FullCourtMinutesBoard from './FullCourtMinutesBoard.svelte';
import FullCourtRotationLadder from './FullCourtRotationLadder.svelte';
import FullCourtUnitPlanner from './FullCourtUnitPlanner.svelte';
import type { FullCourtTeamMinutesRow } from './full-court-coaching-presenter.ts';

const ROSTER = Array.from({ length: 6 }, (_, index) =>
  buildSimulationPlayer({
    playerId: playerIdSchema.parse(`p${String(index + 1)}`),
    displayName: `Player ${String(index + 1)}`,
    positions: [index < 2 ? 'PG' : index < 4 ? 'SF' : 'C'],
  }),
);

function minutesRow(
  index: number,
  minutes: number,
  starterSlot: number | null,
): FullCourtTeamMinutesRow {
  const player = ROSTER[index];
  if (player === undefined) throw new Error(`missing roster player ${String(index)}`);
  return {
    player,
    starterSlot,
    minutes,
    savedMinutes: minutes,
    closer: false,
    health: null,
    cumulativeLoad: 0,
  };
}

describe('Full Court rotation room', () => {
  test('hierarchy cards show headshot role slots instead of selects', () => {
    const body = render(FullCourtHierarchyCards, {
      props: {
        roster: ROSTER,
        hierarchy: { primaryPlayerId: 'p1', secondaryPlayerId: null, floorGeneralPlayerId: 'p2' },
        onChange: () => undefined,
      },
    }).body;

    expect(body).toContain('aria-label="Primary option"');
    expect(body).toContain('aria-label="Second option"');
    expect(body).toContain('aria-label="Floor general"');
    expect(body).toContain('Change primary option');
    expect(body).toContain('Change floor general');
    expect(body).toContain('Choose a player');
    expect(body).not.toContain('Not set');
  });

  test('minutes board exposes sliders, steppers, exact inputs, and locks', () => {
    const rows = [minutesRow(0, 36, 0), minutesRow(1, 32, 1), minutesRow(2, 12, null)];
    const body = render(FullCourtMinutesBoard, {
      props: {
        groups: [
          { label: 'Starters', rows: rows.slice(0, 2), total: 68 },
          { label: 'Bench', rows: rows.slice(2), total: 12 },
        ],
        summary: '80 of 240 minutes assigned.',
        displayedMinutes: 80,
        locked: false,
        onMinutes: () => undefined,
        onToggleLock: () => undefined,
        onSit: () => undefined,
      },
    }).body;

    expect(body).toContain('Minutes slider for Player 1');
    expect(body).toContain('Increase minutes for Player 1');
    expect(body).toContain('Decrease minutes for Player 1');
    expect(body).toContain('Minutes for Player 1');
    expect(body).toContain('Lock minutes for Player 1');
    expect(body).toContain('Quick minute preset for Player 1');
    expect(body).toContain('Star 36');
    expect(body).toContain('Sit Player 3');
    expect(body).toContain('80 of 240 minutes assigned');
    expect(body).toContain('class="minute-slider ui-range');
    expect(body).toContain('--ui-range-progress: 75%');
    expect(body).toContain('Cumulative workload for Player 1: 0%');
  });

  test('read-only minutes board hides the editing controls', () => {
    const rows = [minutesRow(0, 36, 0)];
    const body = render(FullCourtMinutesBoard, {
      props: {
        groups: [{ label: 'Starters', rows, total: 36 }],
        summary: '36 of 240 minutes assigned.',
        displayedMinutes: 36,
        locked: true,
        readOnly: true,
        onMinutes: () => undefined,
        onToggleLock: () => undefined,
        onSit: () => undefined,
      },
    }).body;

    expect(body).toContain('36');
    expect(body).not.toContain('Minutes slider for Player 1');
    expect(body).not.toContain('Lock minutes for Player 1');
  });

  test('rotation ladder renders a 0–48 minute bar per rotation player', () => {
    const body = render(FullCourtRotationLadder, {
      props: {
        rows: [minutesRow(0, 36, 0), minutesRow(2, 12, null), minutesRow(3, 0, null)],
      },
    }).body;

    expect(body).toContain('Rotation minute distribution');
    expect(body).toContain('Player 1, 36 minutes');
    expect(body).toContain('width: 75%');
    expect(body).not.toContain('Player 4');
  });

  test('court editor keeps the court and offers a swap hint', () => {
    const rows = [minutesRow(0, 36, 0), minutesRow(1, 32, 1)];
    const body = render(FullCourtCourtLineup, {
      props: {
        starters: rows,
        bench: [minutesRow(2, 12, null)],
        roster: ROSTER,
        onSelectStarter: () => undefined,
      },
    }).body;

    expect(body).toContain('aria-label="Starting five on the court"');
    expect(body).toContain('Tap a player on the court to swap him into the starting five.');
    expect(body).toContain('Point Guard: Player 1');
  });

  test('unit planner shows the shared 12-minute strip and closing-five tag', () => {
    const unit = {
      name: 'Small Ball',
      plannedMinutes: 4,
      playerIds: ['p1', 'p2', 'p3', 'p4', 'p5'],
    };
    const body = render(FullCourtUnitPlanner, {
      props: {
        units: [unit],
        roster: ROSTER,
        closingFive: ['p1', 'p2', 'p3', 'p4', 'p5'],
        onAdd: () => undefined,
        onRemove: () => undefined,
        onRename: () => undefined,
        onMinutes: () => undefined,
        onPlayer: () => undefined,
        onUseAsClosingFive: () => undefined,
      },
    }).body;

    expect(body).toContain('Second-quarter unit plan: 4 of 12 minutes');
    expect(body).toContain('Small Ball');
    expect(body).toContain('Planned minutes slider for Small Ball');
    expect(body).toContain('Current closing five');
    expect(body).toContain('Add named unit');
  });
});
