import { describe, expect, it } from 'bun:test';
import type { FullCourtCoachingPlan, FullCourtCoachingRule } from '@hoop-rush/data-contracts';
import { assertFullCourtCoachingRoster, withFullCourtCoaching } from './coaching.ts';
import { fullCourtTestRoster } from './game-test-support.ts';

const ROSTER = fullCourtTestRoster('coaching', 8);
const IDS = ROSTER.map((player) => player.playerId);

function planWithRules(rules: readonly FullCourtCoachingRule[]): FullCourtCoachingPlan {
  return {
    schemaVersion: 1,
    tactics: { pace: 'balanced', offense: 'balanced', defense: 'balanced' },
    rules: [...rules],
  };
}

describe('Full Court coaching rules', () => {
  it('accepts rules whose players are all on the roster', () => {
    const plan = planWithRules([
      {
        ruleId: 'closing',
        kind: 'closing-lineup',
        secondsRemainingMax: 360,
        scoreMarginMax: 8,
        lineup: IDS.slice(0, 5),
      },
      {
        ruleId: 'foul',
        kind: 'foul-trouble',
        playerId: IDS[0] ?? '',
        foulLimit: 4,
        replacementPlayerId: IDS[5],
      },
    ]);

    expect(() => assertFullCourtCoachingRoster(plan, ROSTER)).not.toThrow();
  });

  it('rejects a rule that names a player outside the roster', () => {
    const plan = planWithRules([
      {
        ruleId: 'closing',
        kind: 'closing-lineup',
        secondsRemainingMax: 360,
        scoreMarginMax: 8,
        lineup: [...IDS.slice(0, 4), 'outside-player'],
      },
    ]);

    expect(() => assertFullCourtCoachingRoster(plan, ROSTER)).toThrow(
      'The saved coaching rule includes a player outside your roster.',
    );
  });

  it('merges rules into the team rotation and leaves an empty plan unchanged', () => {
    const team = {
      teamId: 'home',
      displayName: 'Home',
      roster: ROSTER,
      rotation: { startingFive: IDS.slice(0, 5) },
    };
    const rules = planWithRules([
      {
        ruleId: 'foul',
        kind: 'foul-trouble',
        playerId: IDS[0] ?? '',
        foulLimit: 4,
      },
    ]).rules;
    if (rules === undefined) throw new Error('expected rules');

    const merged = withFullCourtCoaching(team, { rules });
    expect(merged.rotation?.startingFive).toEqual(IDS.slice(0, 5));
    expect(merged.rotation?.rules).toEqual(rules);
    expect(withFullCourtCoaching(team, { rules: [] })).toBe(team);
  });

  it('validates the scoring hierarchy against the roster', () => {
    const hierarchy = {
      primaryPlayerId: IDS[0] ?? '',
      secondaryPlayerId: IDS[1] ?? '',
      floorGeneralPlayerId: IDS[2] ?? '',
    };
    expect(() =>
      assertFullCourtCoachingRoster({ ...planWithRules([]), hierarchy }, ROSTER),
    ).not.toThrow();
    expect(() =>
      assertFullCourtCoachingRoster(
        {
          ...planWithRules([]),
          hierarchy: { primaryPlayerId: 'outside-player' },
        },
        ROSTER,
      ),
    ).toThrow('The saved scoring hierarchy includes a player outside your roster.');
  });

  it('carries a hierarchy without inventing a rotation', () => {
    const team = { teamId: 'home', displayName: 'Home', roster: ROSTER };
    const hierarchy = { primaryPlayerId: IDS[3] ?? '' };
    const merged = withFullCourtCoaching(team, { hierarchy });

    expect(merged.hierarchy).toEqual(hierarchy);
    expect(merged.rotation).toBeUndefined();
    expect(withFullCourtCoaching(team, {})).toBe(team);
  });

  it('rejects a hierarchy naming a player outside the team when applying options', () => {
    const team = { teamId: 'home', displayName: 'Home', roster: ROSTER };
    expect(() =>
      withFullCourtCoaching(team, { hierarchy: { primaryPlayerId: 'outside-player' } }),
    ).toThrow('The saved scoring hierarchy includes a player outside your roster.');
  });
});
