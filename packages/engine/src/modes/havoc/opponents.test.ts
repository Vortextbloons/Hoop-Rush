import { describe, expect, it } from 'bun:test';
import type { HavocDraftPick } from '@hoop-rush/data-contracts';
import {
  POSITIONS,
  havocLockedInputsSchema,
  playerIdSchema,
  seedSchema,
  seedFromString,
  slotGroupOf,
  summaryRatingsOfRatings,
} from '@hoop-rush/data-contracts';
import {
  buildFixtureBracket,
  buildHavocCard,
  buildHavocDraftPick,
  buildHavocSourcePlayer,
  buildHavocVersionSet,
} from '@hoop-rush/test-fixtures';
import { applyHavocMutationPackage } from './transform.ts';
import {
  HAVOC_HUMAN_TEAM_ID,
  buildHavocHumanTeam,
  buildHavocLockedInputs,
  buildHavocOpponentTeam,
  buildHavocSchedule,
} from './opponents.ts';
import { buildHavocEraProfileFixture } from './havoc-test-support.ts';

const bracket = buildFixtureBracket();
const profile = buildHavocEraProfileFixture();
const runSeed = seedSchema.parse(seedFromString('havoc-opponent-test'));
const versionSet = buildHavocVersionSet();

function fixturePicks(overrides: readonly Partial<HavocDraftPick>[] = []): HavocDraftPick[] {
  return [0, 1, 2, 3, 4].map((ordinal) => buildHavocDraftPick(ordinal, overrides[ordinal] ?? {}));
}

function lockedFixture() {
  return buildHavocLockedInputs({
    runId: 'havoc-opponent-run',
    runSeed,
    versionSet,
    picks: fixturePicks(),
    bracket,
    profile,
  });
}

describe('havoc opponents and locked inputs', () => {
  it('freezes schema-valid locked inputs for the bracket', () => {
    const locked = lockedFixture();
    expect(havocLockedInputsSchema.safeParse(locked).success).toBe(true);
    expect(locked.opponents).toHaveLength(bracket.opponents.length);
    expect(locked.schedule).toHaveLength(82);
    expect(locked.picks).toHaveLength(5);
    for (const opponent of locked.opponents) {
      expect(opponent.team.starters).toHaveLength(5);
      expect(opponent.team.replacements).toHaveLength(5);
      expect(opponent.team.clones).toEqual([]);
      expect(opponent.team.side).toBe('opponent');
      for (const starter of opponent.team.starters) {
        expect(starter.kind).toBe('starter');
        expect(starter.mutationPackage).toEqual([]);
        expect(starter.ownerInstanceId).toBeNull();
      }
      for (const replacement of opponent.team.replacements) {
        expect(replacement.kind).toBe('replacement');
        expect(replacement.mutationPackage).toEqual([]);
        expect(replacement.ownerInstanceId).not.toBeNull();
      }
    }
  });

  it('derives opponent Overall from the bracket profile and labels it derived', () => {
    const locked = lockedFixture();
    const team = locked.opponents[0];
    const opponent = bracket.opponents[0];
    if (team === undefined || opponent === undefined) throw new Error('missing opponent');
    expect(locked.opponents.map((entry) => entry.opponentId)).toEqual(
      bracket.opponents.map((entry) => entry.opponentId),
    );
    for (let slotIndex = 0; slotIndex < POSITIONS.length; slotIndex += 1) {
      const slot = POSITIONS[slotIndex];
      const starter = team.team.starters[slotIndex];
      const assignment = opponent.lineup.assignments.find((row) => row.slotIndex === slotIndex);
      if (slot === undefined || starter === undefined || assignment === undefined) {
        throw new Error('missing lineup row');
      }
      const player = opponent.players.find((entry) => entry.playerId === assignment.playerId);
      if (player === undefined) throw new Error('missing player');
      const expected = summaryRatingsOfRatings(
        player.ratings,
        player.tendencies,
        profile.parameters.league3PARate,
        slotGroupOf(slot),
      );
      expect(starter.slot).toBe(slot);
      expect(starter.source.originalOverall).toBe(expected.overallRating);
      expect(starter.source.overallSource).toBe('derived');
      expect(starter.source.eraId).toBe(profile.eraId);
      expect(starter.source.franchiseId).toBe(opponent.teamId);
      expect(starter.source.seasonKey).toBeNull();
      expect(starter.effective.ratings).toEqual(player.ratings);
      expect(starter.effective.physical.wingspanDeltaInches).toBe(0);
      expect(starter.effective.authoritativeChannels).toEqual([]);
    }
  });

  it('keeps every participant instance id distinct across a frozen run', () => {
    const locked = lockedFixture();
    const ids = new Set<string>();
    const collect = (team: typeof locked.human) => {
      for (const participant of [...team.starters, ...team.replacements, ...team.clones]) {
        expect(ids.has(participant.instanceId)).toBe(false);
        ids.add(participant.instanceId);
        expect(participant.instanceId).toMatch(/^hvi-[0-9a-f]{32}$/);
      }
    };
    collect(locked.human);
    for (const opponent of locked.opponents) collect(opponent.team);
    expect(ids.size).toBe(
      locked.opponents.length * 10 +
        locked.human.starters.length +
        locked.human.replacements.length,
    );
  });

  it('builds the 82-game schedule with the documented alternating home pattern', () => {
    const schedule = buildHavocSchedule(bracket);
    expect(schedule).toHaveLength(82);
    schedule.forEach((entry, index) => {
      expect(entry.gameNumber).toBe(index + 1);
      expect(entry.humanHome).toBe(entry.gameNumber % 2 === 1);
    });
  });

  it('builds unmutated human replacements from the locked picks', () => {
    const picks = fixturePicks();
    const human = buildHavocHumanTeam({ runSeed, picks });
    expect(human.teamId).toBe(HAVOC_HUMAN_TEAM_ID);
    expect(human.starters).toHaveLength(5);
    expect(human.clones).toEqual([]);
    for (let ordinal = 0; ordinal < 5; ordinal += 1) {
      const pick = picks[ordinal];
      const starter = human.starters[ordinal];
      const replacement = human.replacements[ordinal];
      if (pick === undefined || starter === undefined || replacement === undefined) {
        throw new Error('missing human slot');
      }
      expect(starter.slot).toBe(pick.slot);
      expect(starter.mutationPackage).toEqual(pick.card.mutations);
      expect(starter.effective).toEqual(pick.card.effective);
      expect(replacement.kind).toBe('replacement');
      expect(replacement.ownerInstanceId).toBe(starter.instanceId);
      expect(replacement.mutationPackage).toEqual([]);
      expect(replacement.source.playerId).toBe(pick.card.source.playerId);
      expect(replacement.effective).toEqual(
        applyHavocMutationPackage(pick.card.source, [], { slot: pick.slot }),
      );
    }
  });

  it('adds exactly one clone per Clone Army owner with the owner effective profile', () => {
    const cloneCard = buildHavocCard({
      slot: 'C',
      cardId: `hvc-${'c'.repeat(32)}`,
      mutations: [{ mutationId: 'clone-army' }],
      source: buildHavocSourcePlayer({
        playerId: playerIdSchema.parse('p-clone-owner'),
        positions: ['C'],
      }),
    });
    const picks: HavocDraftPick[] = [
      buildHavocDraftPick(0),
      buildHavocDraftPick(1),
      buildHavocDraftPick(2),
      buildHavocDraftPick(3),
      buildHavocDraftPick(4, { card: cloneCard }),
    ];
    const human = buildHavocHumanTeam({ runSeed, picks });
    expect(human.clones).toHaveLength(1);
    const clone = human.clones[0];
    const starter = human.starters[4];
    if (clone === undefined || starter === undefined) throw new Error('missing clone');
    expect(clone.kind).toBe('clone');
    expect(clone.ownerInstanceId).toBe(starter.instanceId);
    expect(clone.slot).toBe('C');
    expect(clone.mutationPackage).toEqual([]);
    expect(clone.source.playerId).toBe(cloneCard.source.playerId);
    expect(clone.effective).toEqual(cloneCard.effective);
    const withoutClone = buildHavocHumanTeam({ runSeed, picks: fixturePicks() });
    expect(withoutClone.clones).toEqual([]);
  });

  it('is deterministic per run seed and varies instance ids across seeds', () => {
    const first = lockedFixture();
    const second = lockedFixture();
    expect(first).toEqual(second);
    const other = buildHavocLockedInputs({
      runId: 'havoc-opponent-run',
      runSeed: seedSchema.parse(seedFromString('havoc-opponent-test-2')),
      versionSet,
      picks: fixturePicks(),
      bracket,
      profile,
    });
    const firstStarter = first.human.starters[0];
    const otherStarter = other.human.starters[0];
    if (firstStarter === undefined || otherStarter === undefined)
      throw new Error('missing starter');
    expect(otherStarter.instanceId).not.toBe(firstStarter.instanceId);
    expect(other.schedule).toEqual(first.schedule);
  });

  it('validates opponent teams independently of the locked wrapper', () => {
    const opponent = bracket.opponents[0];
    if (opponent === undefined) throw new Error('missing opponent');
    const frozen = buildHavocOpponentTeam({ runSeed, opponent, profile });
    expect(frozen.opponentId).toBe(opponent.opponentId);
    expect(frozen.team.starters.map((row) => row.slot)).toEqual([...POSITIONS]);
    for (const replacement of frozen.team.replacements) {
      const owner = frozen.team.starters.find(
        (starter) => starter.instanceId === replacement.ownerInstanceId,
      );
      if (owner === undefined) throw new Error('replacement owner missing');
      expect(replacement.source.playerId).toBe(owner.source.playerId);
      expect(replacement.source.playerVersionId).toBe(owner.source.playerVersionId);
    }
  });
});
