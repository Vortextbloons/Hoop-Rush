import { describe, expect, it } from 'vitest';
import {
  SEASON_MINUTE_POLICY_VERSION,
  SEASON_NEUTRAL_HOME_COURT,
  SEASON_ROTATION_VERSION,
  playerVersionId,
  seasonGameSummarySchema,
  seasonRetainedGameDetailSchema,
  type Position,
  type SeasonGameSimulationInput,
  type SeasonGameTeamInput,
  type SeasonRotation,
  type SeasonScheduleGame,
} from '@hoop-rush/data-contracts';
import {
  buildEraSimulationProfile,
  buildSimulationPlayer,
  seedFromString,
} from '@hoop-rush/test-fixtures';
import { createEngineContext } from '../sim/context.ts';
import { simulateSeasonGame } from './season-game.ts';
import {
  auditSeasonGameSummary,
  seasonGameSummaryFromResult,
  seasonRetainedDetailFromResult,
} from './game-summary.ts';
const ctx = createEngineContext();
const POSITION_PLAN: ReadonlyArray<readonly Position[]> = [
  ['PG'],
  ['SG'],
  ['SF'],
  ['PF'],
  ['C'],
  ['PG', 'SG'],
  ['SF', 'PF'],
  ['SG', 'SF'],
  ['C'],
  ['PF', 'C'],
];
function buildTeam(side: 'home' | 'away'): SeasonGameTeamInput {
  const franchiseId = side === 'home' ? 'lakers' : 'celtics';
  const players = POSITION_PLAN.map((positions, index) => {
    const playerId = `p-sum-${side}-${String(index)}`;
    const base = buildSimulationPlayer();
    return {
      playerVersionId: playerVersionId(playerId, franchiseId, '1990s', '1995-96'),
      playerId,
      displayName: `${side} player ${String(index)}`,
      positions: [...positions],
      heightInches: 76,
      weightLbs: 200,
      ratings: { ...base.ratings },
      tendencies: { ...base.tendencies },
    };
  });
  return { teamId: side, displayName: side, franchiseId, players };
}
function rotationOf(team: SeasonGameTeamInput): SeasonRotation {
  const ids = team.players.map((p) => p.playerVersionId);
  return {
    franchiseId: team.franchiseId,
    starters: ids.slice(0, 5),
    benchOrder: ids.slice(5),
    targetMinutes: [
      ...ids.slice(0, 5).map((id) => ({ playerVersionId: id, minutes: 33 })),
      ...ids
        .slice(5)
        .map((id, index) => ({ playerVersionId: id, minutes: [21, 18, 15, 12, 9][index] ?? 0 })),
    ],
    closingFive: [ids[1], ids[5], ids[6], ids[7], ids[8]].map((id) => id ?? ''),
    minutePolicy: { policyVersion: SEASON_MINUTE_POLICY_VERSION, strategy: 'balanced' },
    rotationVersion: SEASON_ROTATION_VERSION,
  };
}
function buildInput(seed: string): SeasonGameSimulationInput {
  const home = buildTeam('home');
  const away = buildTeam('away');
  return {
    schemaVersion: 1,
    seed: seedFromString(seed),
    gameNumber: 1,
    dataVersion: 'data-v1',
    profile: buildEraSimulationProfile(),
    home,
    away,
    homeRotation: rotationOf(home),
    awayRotation: rotationOf(away),
    availability: [...home.players, ...away.players].map((p) => ({
      playerVersionId: p.playerVersionId,
      available: true,
    })),
    removals: [],
    returns: [],
    homeCourt: SEASON_NEUTRAL_HOME_COURT,
  };
}
function scheduleGameOf(input: SeasonGameSimulationInput): SeasonScheduleGame {
  return {
    gameId: 's000001',
    round: 1,
    homeFranchiseId: input.home.franchiseId,
    awayFranchiseId: input.away.franchiseId,
  };
}
describe('season game summaries (M2.3)', () => {
  it('converts a completed result into a compact summary that audits clean', () => {
    const input = buildInput('summary-1');
    const result = simulateSeasonGame(input, ctx);
    expect(result.outcome).toBe('completed');
    if (result.outcome !== 'completed') return;
    const game = scheduleGameOf(input);
    const summary = seasonGameSummaryFromResult(result, game);
    expect(summary.status).toBe('final');
    expect(summary.homeScore).toBe(result.home.score);
    expect(summary.awayScore).toBe(result.away.score);
    expect(summary.overtimePeriods).toBe(result.overtimePeriods);
    expect(summary.homePlayers).toHaveLength(10);
    expect(summary.awayPlayers).toHaveLength(10);
    const homeIds = summary.homePlayers.map((line) => line.playerVersionId);
    expect([...homeIds].sort()).toEqual(homeIds);
    const homePoints = summary.homePlayers.reduce((sum, line) => sum + line.points, 0);
    expect(homePoints).toBe(summary.homeBox.points);
    expect(auditSeasonGameSummary(summary)).toEqual([]);
    expect(seasonGameSummarySchema.safeParse(summary).success).toBe(true);
    expect(summary.homeBox.franchiseId).toBe(game.homeFranchiseId);
    expect(summary.awayBox.franchiseId).toBe(game.awayFranchiseId);
  });
  it('retains the full result detail for human games', () => {
    const input = buildInput('summary-2');
    const result = simulateSeasonGame(input, ctx);
    const game = scheduleGameOf(input);
    const detail = seasonRetainedDetailFromResult(result, game, 'run-1');
    expect(detail.runId).toBe('run-1');
    expect(detail.gameId).toBe('s000001');
    expect(detail.result).toEqual(result);
    expect(seasonRetainedGameDetailSchema.safeParse(detail).success).toBe(true);
  });
  it('converts a forfeit into the official 2-0 summary with zero boxes', () => {
    const input = buildInput('summary-3');
    const awayIds = input.away.players.map((p) => p.playerVersionId);
    const unavailable = input.availability.map((entry) => ({
      ...entry,
      available: !awayIds.includes(entry.playerVersionId),
    }));
    const result = simulateSeasonGame({ ...input, availability: unavailable }, ctx);
    expect(result.outcome).toBe('forfeit');
    if (result.outcome !== 'forfeit') return;
    const game = scheduleGameOf(input);
    const summary = seasonGameSummaryFromResult(result, game);
    expect(summary.status).toBe('forfeit');
    expect(summary.homeScore + summary.awayScore).toBe(2);
    expect(summary.forfeitLoserFranchiseId).toBe(input.away.franchiseId);
    expect(summary.homePlayers).toHaveLength(0);
    expect(summary.awayPlayers).toHaveLength(0);
    expect(summary.homeBox.points).toBe(0);
    expect(summary.awayBox.points).toBe(0);
    expect(summary.awayBox.possessions).toBe(0);
    expect(auditSeasonGameSummary(summary)).toEqual([]);
    expect(seasonGameSummarySchema.safeParse(summary).success).toBe(true);
  });
  it('throws for the no-legal-five-both outcome', () => {
    const input = buildInput('summary-4');
    const bothUnavailable = input.availability.map((entry) => ({ ...entry, available: false }));
    const result = simulateSeasonGame({ ...input, availability: bothUnavailable }, ctx);
    expect(result.outcome).toBe('no-legal-five-both');
    expect(() => seasonGameSummaryFromResult(result, scheduleGameOf(input))).toThrow(
      /no-legal-five-both/,
    );
  });
  it('flags accounting failures in a tampered summary', () => {
    const input = buildInput('summary-5');
    const result = simulateSeasonGame(input, ctx);
    if (result.outcome !== 'completed') return;
    const summary = seasonGameSummaryFromResult(result, scheduleGameOf(input));
    const tampered = {
      ...summary,
      homeBox: { ...summary.homeBox, points: summary.homeBox.points + 1 },
    };
    const failures = auditSeasonGameSummary(tampered);
    expect(failures.some((failure) => failure.includes('points'))).toBe(true);
    const forfeitTampered = {
      ...summary,
      status: 'forfeit' as const,
      homeScore: 3,
      awayScore: 0,
      forfeitLoserFranchiseId: 'lakers',
      homePlayers: [],
      awayPlayers: [],
    };
    expect(auditSeasonGameSummary(forfeitTampered).some((f) => f.includes('2-0'))).toBe(true);
  });
});
