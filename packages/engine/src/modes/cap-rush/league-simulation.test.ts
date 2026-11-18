import { describe, expect, it } from 'bun:test';
import type {
  CapRushLeagueGame,
  CapRushLeagueScheduleEntry,
  CapRushLockedInputs,
  HavocBattleInput,
} from '@hoop-rush/data-contracts';
import {
  CAP_RUSH_GAME_COUNT,
  HAVOC_MUTATION_CATALOG_VERSION,
  HAVOC_RULES_VERSION,
  HAVOC_SCHEMA_VERSION,
  POSITIONS,
  capRushCardSchema,
  capRushLeagueGameSchema,
  capRushLeagueGameSeed,
  canonicalJsonDataDigest,
} from '@hoop-rush/data-contracts';
import { createEngineContext } from '../../sim/kernel.ts';
import { capRushTestSetup } from './cap-rush-test-support.ts';
import {
  buildCapRushLeagueSchedule,
  capRushAssignFranchise,
  capRushLeagueFieldOf,
} from './league-schedule.ts';
import { buildCapRushLockedInputs } from './lock.ts';
import { capRushBattleVersionSet } from './input.ts';
import {
  capRushBoxOf,
  capRushLeagueSlotGames,
  capRushTeamById,
  simulateCapRushLeagueSlot,
} from './league-simulation.ts';
import { simulateAuditedHavocBattleGame } from '../havoc/core/battle-game.ts';
import {
  havocBattleGameInputDigest,
  havocBattleGameResultDigest,
} from '../havoc/core/battle-digests.ts';

function lockedWithLeague(): CapRushLockedInputs {
  const setup = capRushTestSetup();
  const picks = POSITIONS.map((slot, index) => {
    const player = setup.index.bySlot.get(slot)?.[0];
    if (player === undefined) throw new Error(`missing ${slot}`);
    return {
      pickOrdinal: index,
      slot,
      card: capRushCardSchema.parse({
        cardId: `crc-${String(index).repeat(32)}`,
        offerId: `cro-${'0'.repeat(32)}`,
        cardIndex: index,
        slot,
        bucket: 'budget',
        source: player,
        salaryDollars: 10_000_000,
      }),
    };
  });
  const field = capRushLeagueFieldOf(setup.lockSources.bracket);
  const takeover = {
    franchise: capRushAssignFranchise({ runSeed: setup.state.runSeed, field }),
    games: buildCapRushLeagueSchedule({ runSeed: setup.state.runSeed, field }).games,
  };
  return buildCapRushLockedInputs({
    runId: setup.state.runId,
    runSeed: setup.state.runSeed,
    variant: setup.state.variant,
    versionSet: setup.state.versionSet,
    catalog: setup.state.catalog,
    picks,
    spin: null,
    bracket: setup.lockSources.bracket,
    profile: setup.lockSources.profile,
    takeover,
  });
}

function battleInputOf(
  locked: CapRushLockedInputs,
  entry: CapRushLeagueScheduleEntry,
): HavocBattleInput {
  const home = capRushTeamById(locked, entry.homeTeamId);
  const away = capRushTeamById(locked, entry.awayTeamId);
  return {
    schemaVersion: HAVOC_SCHEMA_VERSION,
    rulesVersion: HAVOC_RULES_VERSION,
    mutationCatalogVersion: HAVOC_MUTATION_CATALOG_VERSION,
    gameNumber: entry.slot,
    variant: 'havoc',
    seed: capRushLeagueGameSeed(locked.runSeed, entry.gameId),
    profile: locked.profile,
    home: { ...home, side: 'home' },
    away: { ...away, side: 'away' },
    versionSet: capRushBattleVersionSet(locked),
  };
}

/** The pre-compact league caller, kept here as the parity reference. */
function fullLeagueGame(
  locked: CapRushLockedInputs,
  entry: CapRushLeagueScheduleEntry,
): CapRushLeagueGame {
  const battle = simulateAuditedHavocBattleGame(
    battleInputOf(locked, entry),
    createEngineContext(),
  );
  const audit = battle.audit;
  if (!audit.ok) {
    throw new Error(
      `cap rush league: game ${entry.gameId} failed accounting: ${audit.findings.map((finding) => finding.message).join('; ')}`,
    );
  }
  return capRushLeagueGameSchema.parse({
    gameId: entry.gameId,
    slot: entry.slot,
    homeTeamId: entry.homeTeamId,
    awayTeamId: entry.awayTeamId,
    homePoints: battle.result.home.points,
    awayPoints: battle.result.away.points,
    winnerTeamId:
      battle.result.home.points > battle.result.away.points ? entry.homeTeamId : entry.awayTeamId,
    box: capRushBoxOf(battle.result.home, battle.result.away, battle.result.overtimePeriods),
    inputDigest: battle.result.inputDigest,
    resultDigest: havocBattleGameResultDigest(battle.result),
  });
}

describe('cap rush AI-league simulation', () => {
  it('keeps every slot game identical to the full tape-backed path', () => {
    const locked = lockedWithLeague();
    const context = createEngineContext();
    for (let slot = 1; slot <= 3; slot += 1) {
      const compact = simulateCapRushLeagueSlot({ locked, slot, context });
      const entries = capRushLeagueSlotGames(locked, slot);
      expect(compact).toHaveLength(entries.length);
      for (const [index, entry] of entries.entries()) {
        expect(compact[index], entry.gameId).toEqual(fullLeagueGame(locked, entry));
      }
    }
  }, 120_000);

  it('keeps every league input digest identical to the reference canonical digest', () => {
    const locked = lockedWithLeague();
    const entries = Array.from({ length: CAP_RUSH_GAME_COUNT }, (_value, index) =>
      capRushLeagueSlotGames(locked, index + 1),
    ).flat();
    expect(entries).toHaveLength(1148);
    for (const entry of entries) {
      const input = battleInputOf(locked, entry);
      expect(Object.isFrozen(input.profile), entry.gameId).toBe(true);
      expect(havocBattleGameInputDigest(input), entry.gameId).toBe(
        canonicalJsonDataDigest('havoc-battle-input-v1:', input as never),
      );
    }
  }, 120_000);

  it('covers the full 1,148-game league schedule for every AI game', () => {
    const locked = lockedWithLeague();
    expect(locked.leagueSchedule).toBeDefined();
    const aiGames = (locked.leagueSchedule ?? []).filter(
      (entry) =>
        entry.homeTeamId !== locked.human.teamId && entry.awayTeamId !== locked.human.teamId,
    );
    expect(aiGames).toHaveLength(1148);
    for (let slot = 1; slot <= CAP_RUSH_GAME_COUNT; slot += 1) {
      const entries = capRushLeagueSlotGames(locked, slot);
      expect(entries).toHaveLength(14);
    }
  });
});
