import { describe, expect, test } from 'bun:test';
import {
  FULL_COURT_HISTORICAL_PRESETS,
  type SaveFullCourtBlueprintOptions,
} from '@hoop-rush/application/full-court';
import {
  FULL_COURT_DEFAULT_COACHING_PLAN,
  playerIdSchema,
  type FullCourtBlueprint,
  type FullCourtCoachingPlan,
  type FullCourtTactics,
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

function renderView(props: {
  plan: FullCourtCoachingPlan;
  readOnly?: boolean;
  busy?: boolean;
  onListBlueprints?: () => Promise<FullCourtBlueprint[]>;
  onSaveBlueprint?: (
    name: string,
    tactics: FullCourtTactics,
    options?: SaveFullCourtBlueprintOptions,
  ) => Promise<FullCourtBlueprint>;
  onRemoveBlueprint?: (name: string) => Promise<void>;
}): string {
  return render(FullCourtCoachingView, {
    props: {
      roster: ROSTER,
      defaultRotation: DEFAULT_ROTATION,
      plan: props.plan,
      busy: props.busy ?? false,
      onSave: () => Promise.resolve(true),
      ...(props.readOnly === undefined ? {} : { readOnly: props.readOnly }),
      ...(props.onListBlueprints === undefined ? {} : { onListBlueprints: props.onListBlueprints }),
      ...(props.onSaveBlueprint === undefined ? {} : { onSaveBlueprint: props.onSaveBlueprint }),
      ...(props.onRemoveBlueprint === undefined
        ? {}
        : { onRemoveBlueprint: props.onRemoveBlueprint }),
    },
  }).body;
}

describe('FullCourtCoachingView', () => {
  test('shows tactics, automatic rotation, and the next-game note', () => {
    const body = renderView({ plan: FULL_COURT_DEFAULT_COACHING_PLAN });

    expect(body).toContain('Set the rotation and tactics that apply from your next game.');
    expect(body).toContain('aria-label="Pace"');
    expect(body).toContain('aria-label="Shot emphasis"');
    expect(body).toContain('Move the ball');
    expect(body).toContain('aria-label="Defense"');
    expect(body).toContain('aria-label="Rotation source"');
    expect(body).toContain('The staff sets the starters and minutes for every game.');
    expect(body).toContain('Discard');
    expect(body).toContain('Reset');
    expect(body).toContain('type="submit"');
    expect(body).toContain('Starter 1');
    expect(body).toContain('240 / 240 min');
    expect(body).not.toContain('Minutes for Player 1');
  });

  test('shows five starters, roster minute targets, and an optional closing five', () => {
    const body = renderView({ plan: CUSTOM_PLAN });

    expect(body).toContain('aria-label="Change Starter 1"');
    expect(body).toContain('Autofill minutes');
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

  test('switches interface depth without dropping the saved rotation or rules', () => {
    const quick = renderView({
      plan: { ...CUSTOM_PLAN, interfaceLevel: 'quick' },
    });
    expect(quick).toContain('aria-label="Coaching interface"');
    expect(quick).toContain('Set a strategy, choose your starters, and manage bench minutes.');
    expect(quick).toContain('aria-label="Rotation source"');
    expect(quick).toContain('aria-label="Minutes"');
    expect(quick).toContain('aria-label="Tactics"');
    expect(quick).toContain('aria-label="Sit Player 7"');
    expect(quick).toContain('aria-label="Game plan summary"');

    const mastermind = renderView({
      plan: { ...CUSTOM_PLAN, interfaceLevel: 'mastermind' },
    });
    expect(mastermind).toContain('aria-label="Rotation source"');
    expect(mastermind).toContain('data-testid="full-court-rule-editor"');
    expect(mastermind).toContain('Add closing lineup');
    expect(mastermind).toContain('Add foul trouble');
  });

  test('offers offensive roles and passing reads in Remix and Mastermind', () => {
    expect(renderView({ plan: CUSTOM_PLAN })).toContain('Top passing target');
    expect(renderView({ plan: { ...CUSTOM_PLAN, interfaceLevel: 'quick' } })).not.toContain(
      'aria-label="Offensive roles"',
    );

    const mastermind = renderView({
      plan: {
        ...CUSTOM_PLAN,
        interfaceLevel: 'mastermind',
        hierarchy: { primaryPlayerId: 'p2', floorGeneralPlayerId: 'p1' },
        staggerStars: true,
      },
    });
    expect(mastermind).toContain('aria-label="Offensive roles"');
    expect(mastermind).toContain('aria-label="Primary option"');
    expect(mastermind).toContain('aria-label="Second option"');
    expect(mastermind).toContain('aria-label="Floor general"');
    expect(mastermind).toContain('Not set');
    expect(mastermind).toContain('Gets the strongest boost to scoring opportunities');
    expect(mastermind).toContain('value="p2"');
    expect(mastermind).toContain('value="p1"');
    expect(mastermind).toContain('Stagger stars');
    expect(mastermind).toContain(
      'Foul-outs, injuries, exhaustion, and explicit rules still take priority.',
    );
  });

  test('shows named units only in Mastermind and offers them to closing rules', () => {
    const withUnits: FullCourtCoachingPlan = {
      ...CUSTOM_PLAN,
      interfaceLevel: 'mastermind',
      units: [{ name: 'Small Ball', plannedMinutes: 4, playerIds: ['p1', 'p2', 'p3', 'p4', 'p6'] }],
      rules: [
        {
          ruleId: 'closing-1',
          kind: 'closing-lineup',
          secondsRemainingMax: 360,
          scoreMarginMax: 6,
          lineup: ['p1', 'p2', 'p3', 'p4', 'p6'],
        },
      ],
    };
    expect(renderView({ plan: { ...withUnits, interfaceLevel: 'remix' } })).not.toContain(
      'aria-label="Named units"',
    );

    const body = renderView({ plan: withUnits });
    expect(body).toContain('aria-label="Named units"');
    expect(body).toContain('Small Ball');
    expect(body).toContain('Add named unit');
    expect(body).toContain('Planned minutes');
    expect(body).toContain('Use as closing five');
    expect(body).toContain('Current closing five');
    expect(body).toContain('Start from named unit');
    expect(body).toContain('value="Small Ball"');
    expect(body).toContain('maxlength="32"');
  });

  test('renders ordered rules with priority and editable fields in Mastermind', () => {
    const body = renderView({
      plan: {
        ...CUSTOM_PLAN,
        interfaceLevel: 'mastermind',
        rules: [
          {
            ruleId: 'closing-1',
            kind: 'closing-lineup',
            secondsRemainingMax: 360,
            scoreMarginMax: 6,
            lineup: ['p1', 'p2', 'p3', 'p4', 'p6'],
          },
          {
            ruleId: 'foul-1',
            kind: 'foul-trouble',
            playerId: 'p2',
            foulLimit: 4,
            replacementPlayerId: 'p7',
          },
        ],
      },
    });

    expect(body).toContain('Priority 1');
    expect(body).toContain('Priority 2');
    expect(body).toContain('Closing lineup');
    expect(body).toContain('Foul trouble');
    expect(body).toContain('Best available reserve');
    expect(body).toContain('Move up');
    expect(body).toContain('Move down');
  });

  test('renders historical strategy presets inside the Tactics panel without a nested form', () => {
    const body = renderView({ plan: FULL_COURT_DEFAULT_COACHING_PLAN });

    expect(body.split('<form').length - 1).toBe(1);
    expect(body).toContain('data-testid="full-court-strategy-presets"');
    expect(body).toContain('Strategy preset');
    for (const preset of FULL_COURT_HISTORICAL_PRESETS) {
      expect(body).toContain(preset.name);
    }
    expect(body).toContain(FULL_COURT_HISTORICAL_PRESETS[0].description);
    expect(body).toContain('Apply');

    const courtIndex = body.indexOf('aria-label="Starting five on the court"');
    const minutesIndex = body.indexOf('aria-label="Minutes"');
    const tacticsIndex = body.indexOf('aria-label="Tactics"');
    const presetsIndex = body.indexOf('data-testid="full-court-strategy-presets"');
    const saveBarIndex = body.indexOf('save-bar');
    expect(courtIndex).toBeGreaterThan(-1);
    expect(courtIndex).toBeGreaterThan(minutesIndex);
    expect(tacticsIndex).toBeLessThan(minutesIndex);
    expect(tacticsIndex).toBeLessThan(courtIndex);
    expect(presetsIndex).toBeGreaterThan(tacticsIndex);
    expect(saveBarIndex).toBeGreaterThan(-1);
    expect(saveBarIndex).toBeLessThan(courtIndex);
  });

  test('renders blueprint save controls when callbacks are provided and respects readOnly and busy', () => {
    const body = renderView({
      plan: CUSTOM_PLAN,
      onListBlueprints: () => Promise.resolve([]),
      onSaveBlueprint: (name, tactics) => Promise.resolve({ schemaVersion: 1, name, tactics }),
      onRemoveBlueprint: () => Promise.resolve(),
    });

    expect(body).toContain('id="full-court-blueprint-name"');
    expect(body).toContain('maxlength="48"');
    expect(body).toContain('Save strategy');

    const readOnlyBody = renderView({
      plan: CUSTOM_PLAN,
      readOnly: true,
      onListBlueprints: () => Promise.resolve([]),
      onSaveBlueprint: (name, tactics) => Promise.resolve({ schemaVersion: 1, name, tactics }),
      onRemoveBlueprint: () => Promise.resolve(),
    });
    expect(readOnlyBody).not.toContain('data-testid="full-court-strategy-presets"');
    expect(readOnlyBody).not.toContain('Save strategy');

    const busyBody = renderView({
      plan: CUSTOM_PLAN,
      busy: true,
      onSaveBlueprint: (name, tactics) => Promise.resolve({ schemaVersion: 1, name, tactics }),
    });
    expect(busyBody).toContain('<fieldset class="m-0 min-w-0 border-0 p-0" disabled');
    expect(busyBody).not.toContain('Include portable scoring roles');

    const withHierarchyBody = renderView({
      plan: {
        ...CUSTOM_PLAN,
        interfaceLevel: 'mastermind',
        hierarchy: { primaryPlayerId: 'p1', floorGeneralPlayerId: 'p2' },
      },
      onListBlueprints: () => Promise.resolve([]),
      onSaveBlueprint: (name, tactics, options) =>
        Promise.resolve({
          schemaVersion: 1,
          name,
          tactics,
          ...(options?.hierarchy === undefined ? {} : { hierarchy: options.hierarchy }),
        }),
    });
    expect(withHierarchyBody).toContain('Include portable scoring roles');
    expect(withHierarchyBody).toContain('Primary option: Starter 1 (PG)');
    expect(withHierarchyBody).toContain('Floor general: Starter 2 (SG)');
  });

  test('keeps the coaching screen focused on the team', () => {
    const body = renderView({ plan: { ...CUSTOM_PLAN, interfaceLevel: 'mastermind' } });
    expect(body).not.toContain('Defensive matchups');
    expect(body).not.toContain('Opponent roster');
  });
});
