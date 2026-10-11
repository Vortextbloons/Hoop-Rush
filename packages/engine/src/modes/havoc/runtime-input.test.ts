import { describe, expect, it } from 'vitest';
import type { HavocParticipant, HavocTeamInput } from '@hoop-rush/data-contracts';
import { havocGameSeed, playerIdSchema } from '@hoop-rush/data-contracts';
import {
  buildHavocEffectiveProfile,
  buildHavocLockedInputs,
  buildHavocParticipant,
  buildHavocSourcePlayer,
  buildHavocTeamInput,
} from '@hoop-rush/test-fixtures';
import {
  buildHavocGameInput,
  havocCapabilityTargets,
  rankedHavocOpponentStarters,
} from './input.ts';

function starterWithOverall(
  slot: HavocParticipant['slot'],
  index: number,
  overall: number,
  versionFill: string,
  mutations: HavocParticipant['mutationPackage'] = [],
): HavocParticipant {
  const source = buildHavocSourcePlayer({
    playerId: playerIdSchema.parse(`p-input-${String(index)}`),
    playerVersionId: `pv-${versionFill.repeat(32)}`,
    displayName: `Input ${String(index)}`,
    positions: [slot],
    originalOverall: overall,
  });
  return buildHavocParticipant({
    instanceId: `hvi-${index.toString(16).padStart(32, '0')}`,
    kind: 'starter',
    slot,
    source,
    mutationPackage: mutations,
    effective: buildHavocEffectiveProfile(source),
  });
}

function humanWithSnatchers(): HavocTeamInput {
  const packages = [
    [{ mutationId: 'body-snatcher' as const }],
    [],
    [],
    [{ mutationId: 'the-bounty' as const }],
    [],
  ];
  return buildHavocTeamInput('human', {
    starters: ['PG', 'SG', 'SF', 'PF', 'C'].map((slot, index) =>
      starterWithOverall(
        slot as HavocParticipant['slot'],
        index + 1,
        85,
        String(index + 1),
        packages[index] ?? [],
      ),
    ),
  });
}

function opponentWithOveralls(): HavocTeamInput {
  const overalls = [70, 95, 80, 90, 85];
  return buildHavocTeamInput('opponent', {
    starters: ['PG', 'SG', 'SF', 'PF', 'C'].map((slot, index) =>
      starterWithOverall(
        slot as HavocParticipant['slot'],
        index + 11,
        overalls[index] ?? 80,
        String(index + 5),
      ),
    ),
  });
}

function lockedWith(human: HavocTeamInput, opponent: HavocTeamInput) {
  return buildHavocLockedInputs({
    human,
    opponents: [{ opponentId: 'opponent-a', team: opponent }],
  });
}

describe('buildHavocGameInput', () => {
  it('uses the shared basketball seed for both variants', () => {
    const locked = buildHavocLockedInputs();
    const havoc = buildHavocGameInput({ locked, gameNumber: 7, variant: 'havoc' });
    const normal = buildHavocGameInput({ locked, gameNumber: 7, variant: 'normal' });
    expect(havoc.seed).toBe(havocGameSeed(locked.runSeed, 7));
    expect(normal.seed).toBe(havocGameSeed(locked.runSeed, 7));
    expect(havoc.seed).toBe(normal.seed);
  });

  it('assigns home and away from the schedule entry', () => {
    const locked = buildHavocLockedInputs();
    const home = buildHavocGameInput({ locked, gameNumber: 1, variant: 'havoc' });
    const away = buildHavocGameInput({ locked, gameNumber: 2, variant: 'havoc' });
    expect(home.humanSide).toBe('home');
    expect(home.home.side).toBe('human');
    expect(home.away.side).toBe('opponent');
    expect(away.humanSide).toBe('away');
    expect(away.away.side).toBe('human');
    expect(away.home.side).toBe('opponent');
  });

  it('derives the normal variant from the same frozen inputs without mutations', () => {
    const locked = buildHavocLockedInputs();
    const normal = buildHavocGameInput({ locked, gameNumber: 1, variant: 'normal' });
    expect(normal.home.clones).toEqual([]);
    for (const participant of [...normal.home.starters, ...normal.home.replacements]) {
      expect(participant.mutationPackage).toEqual([]);
      expect(participant.effective.authoritativeChannels).toEqual([]);
      expect(participant.effective.ratings).toEqual(participant.source.profile.ratings);
      expect(participant.effective.tendencies).toEqual(participant.source.profile.tendencies);
      expect(participant.effective.physical.heightInches).toBe(
        participant.effective.physical.baselineHeightInches,
      );
      expect(participant.effective.physical.wingspanDeltaInches).toBe(0);
      expect(participant.effective.physical.reachUnits).toBe(0);
    }
    const havoc = buildHavocGameInput({ locked, gameNumber: 1, variant: 'havoc' });
    expect(havoc.home.starters[0]?.instanceId).toBe(normal.home.starters[0]?.instanceId);
  });
});

describe('havoc capability targets', () => {
  it('ranks opponent starters by original overall with version tie-breaks', () => {
    const locked = lockedWith(humanWithSnatchers(), opponentWithOveralls());
    const game = buildHavocGameInput({ locked, gameNumber: 1, variant: 'havoc' });
    const ranked = rankedHavocOpponentStarters(game);
    expect(ranked.map((starter) => starter.source.originalOverall)).toEqual([95, 90, 85, 80, 70]);
    const targets = havocCapabilityTargets(game);
    const owners = game.home.starters.filter((starter) =>
      starter.mutationPackage.some((entry) => entry.mutationId === 'body-snatcher'),
    );
    expect(owners.length).toBe(1);
    expect(targets.bodySnatcher.get(owners[0]?.instanceId ?? '')).toBe(ranked[0]?.instanceId);
    expect(targets.bounty).toBe(ranked[0]?.instanceId);
  });

  it('assigns distinct targets in draft order for multiple owners', () => {
    const human = humanWithSnatchers();
    const starters = human.starters.map((starter, index) =>
      index === 0 || index === 2
        ? { ...starter, mutationPackage: [{ mutationId: 'body-snatcher' as const }] }
        : starter,
    );
    const locked = lockedWith(buildHavocTeamInput('human', { starters }), opponentWithOveralls());
    const game = buildHavocGameInput({ locked, gameNumber: 1, variant: 'havoc' });
    const ranked = rankedHavocOpponentStarters(game);
    const targets = havocCapabilityTargets(game);
    expect(targets.bodySnatcher.get(starters[0]?.instanceId ?? '')).toBe(ranked[0]?.instanceId);
    expect(targets.bodySnatcher.get(starters[2]?.instanceId ?? '')).toBe(ranked[1]?.instanceId);
    expect(new Set(targets.bodySnatcher.values()).size).toBe(2);
  });
});
