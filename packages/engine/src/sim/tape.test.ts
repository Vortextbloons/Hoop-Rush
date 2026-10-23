import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_ERA_SIM_PROFILE,
  buildLegalSimulationTeam,
  seedFromString,
} from '@hoop-rush/test-fixtures';
import { draftDuelGameOutputSchema, idSchema, seedSchema } from '@hoop-rush/data-contracts';
import type { DraftDuelSimulationInput, GameSimulationInput } from '@hoop-rush/data-contracts';
import { createEngineContext } from './kernel.ts';
import { simulateGame } from './game.ts';
import { simulateRecordedGame } from './tape.ts';
import {
  draftDuelGameResultDigest,
  draftDuelGameTapeDigest,
  draftDuelSimulationInputDigest,
} from '../modes/draft-duel/digests.ts';

const context = createEngineContext();
function fixtureInput(seed: string): GameSimulationInput {
  return {
    schemaVersion: 2,
    seed: seedSchema.parse(seedFromString(seed)),
    gameNumber: 1,
    dataVersion: 'fixture-data-v1',
    profile: DEFAULT_ERA_SIM_PROFILE,
    home: buildLegalSimulationTeam({ teamId: 'home', displayName: 'Home' }),
    away: buildLegalSimulationTeam({ teamId: 'away', displayName: 'Away' }),
  };
}
describe('recorded fixed-five game tape', () => {
  it('produces the same GameResult as ordinary simulation', () => {
    const input = fixtureInput('tape-parity');
    const plain = simulateGame(input, context);
    const recorded = simulateRecordedGame(input, context);
    expect(recorded.result).toEqual(plain);
    expect(recorded.tape.length).toBeGreaterThan(10);
    const trips = recorded.tape.filter((event) => event.kind === 'trip');
    expect(trips.length).toBeGreaterThan(100);
  });
  it('reconstructs player and team boxes from trip deltas', () => {
    const recorded = simulateRecordedGame(fixtureInput('tape-accounting'), context);
    const sides = [recorded.result.home, recorded.result.away] as const;
    const zeroFifteen = (): number[] => new Array<number>(15).fill(0);
    const zeroRow = (): number[][] => [0, 1, 2, 3, 4].map(() => zeroFifteen());
    const playerSums: [number[][], number[][]] = [zeroRow(), zeroRow()];
    const teamSums: [number[], number[]] = [zeroFifteen(), zeroFifteen()];
    for (const event of recorded.tape) {
      if (event.kind !== 'trip') continue;
      const deltaSets = [event.homeDeltas, event.awayDeltas] as const;
      const teamDeltas = [event.homeTeamDeltas, event.awayTeamDeltas] as const;
      for (const sideIndex of [0, 1] as const) {
        const deltas = deltaSets[sideIndex];
        for (let slot = 0; slot < 5; slot += 1) {
          const line = deltas[slot];
          if (!line) continue;
          for (let field = 0; field < 15; field += 1) {
            const sums = playerSums[sideIndex][slot] ?? zeroFifteen();
            playerSums[sideIndex][slot] = sums;
            sums[field] = (sums[field] ?? 0) + (line[field] ?? 0);
          }
        }
        const line = teamDeltas[sideIndex];
        for (let field = 0; field < 15; field += 1) {
          teamSums[sideIndex][field] = (teamSums[sideIndex][field] ?? 0) + (line[field] ?? 0);
        }
      }
    }
    for (const sideIndex of [0, 1] as const) {
      const side = sides[sideIndex];
      for (let slot = 0; slot < 5; slot += 1) {
        const player = side.players[slot];
        const sum = playerSums[sideIndex][slot];
        if (!player || !sum) continue;
        expect(sum[0]).toBe(player.points);
        expect(sum[1]).toBe(player.fieldGoals.made);
        expect(sum[2]).toBe(player.fieldGoals.attempted);
        expect(sum[3]).toBe(player.threes.made);
        expect(sum[4]).toBe(player.threes.attempted);
        expect(sum[5]).toBe(player.freeThrows.made);
        expect(sum[6]).toBe(player.freeThrows.attempted);
        expect(sum[7]).toBe(player.rebounds.offensive);
        expect(sum[8]).toBe(player.rebounds.defensive);
        expect(sum[9]).toBe(player.assists);
        expect(sum[10]).toBe(player.steals);
        expect(sum[11]).toBe(player.blocks);
        expect(sum[12]).toBe(player.turnovers);
        expect(sum[13]).toBe(player.fouls);
        expect(sum[14]).toBe(0);
      }
      const team = side.box;
      const teamTotals = teamSums[sideIndex];
      expect(teamTotals[0]).toBe(team.points);
      expect(teamTotals[1]).toBe(team.fieldGoals.made);
      expect(teamTotals[2]).toBe(team.fieldGoals.attempted);
      expect(teamTotals[3]).toBe(team.threes.made);
      expect(teamTotals[4]).toBe(team.threes.attempted);
      expect(teamTotals[5]).toBe(team.freeThrows.made);
      expect(teamTotals[6]).toBe(team.freeThrows.attempted);
      expect(teamTotals[7]).toBe(team.rebounds.offensive);
      expect(teamTotals[8]).toBe(team.rebounds.defensive);
      expect(teamTotals[9]).toBe(team.assists);
      expect(teamTotals[10]).toBe(team.steals);
      expect(teamTotals[11]).toBe(team.blocks);
      expect(teamTotals[12]).toBe(team.turnovers);
      expect(teamTotals[13]).toBe(team.fouls);
      expect(teamTotals[14]).toBe(team.rebounds.team);
    }
  });
  it('records period boundaries with cumulative scores', () => {
    const recorded = simulateRecordedGame(fixtureInput('tape-periods'), context);
    const periodEvents = recorded.tape.filter((event) => event.kind === 'period');
    const { periodScores } = recorded.result;
    expect(periodEvents.length).toBe(periodScores.home.length - 1);
    let home = 0;
    let away = 0;
    for (const [index, event] of periodEvents.entries()) {
      home += periodScores.home[index] ?? 0;
      away += periodScores.away[index] ?? 0;
      expect(event.period).toBe(index + 1);
      expect(event.homeScore).toBe(home);
      expect(event.awayScore).toBe(away);
    }
    const trips = recorded.tape.filter((event) => event.kind === 'trip');
    const final = trips[trips.length - 1];
    expect(final?.homeScore).toBe(recorded.result.home.box.points);
    expect(final?.awayScore).toBe(recorded.result.away.box.points);
  });
  it('keeps trip offense and clock fields consistent with the final tape prefix', () => {
    const recorded = simulateRecordedGame(fixtureInput('tape-clock'), context);
    const trips = recorded.tape.filter((event) => event.kind === 'trip');
    for (const trip of trips) {
      expect([0, 1]).toContain(trip.offense);
      expect(trip.clockSeconds).toBeGreaterThanOrEqual(0);
      expect(trip.clockSeconds).toBeLessThanOrEqual(periodSecondsFor(trip.period));
      expect(trip.homeDeltas.length).toBe(5);
      expect(trip.awayDeltas.length).toBe(5);
    }
  });
});
function periodSecondsFor(period: number): number {
  return period <= 4 ? 12 * 60 : 5 * 60;
}
describe('draft duel game output contract', () => {
  it('accepts a recorded game with digests and rejects tampered digests', () => {
    const gameInput = fixtureInput('tape-contract');
    const recorded = simulateRecordedGame(gameInput, context);
    const roomId = idSchema.parse('room-contract');
    const simulationInput: DraftDuelSimulationInput = {
      schemaVersion: 1,
      roomId,
      gameNumber: 1,
      homeParticipantId: 'p1',
      awayParticipantId: 'p2',
      seed: gameInput.seed,
      dataVersion: gameInput.dataVersion,
      home: gameInput.home,
      away: gameInput.away,
    };
    const output = draftDuelGameOutputSchema.parse({
      schemaVersion: 1,
      roomId,
      gameNumber: 1,
      homeParticipantId: 'p1',
      awayParticipantId: 'p2',
      seed: gameInput.seed,
      result: recorded.result,
      tape: recorded.tape,
      inputDigest: draftDuelSimulationInputDigest(simulationInput),
      resultDigest: draftDuelGameResultDigest(recorded.result),
      tapeDigest: draftDuelGameTapeDigest(recorded.tape),
    });
    expect(output.tape.length).toBe(recorded.tape.length);
    const shorter = recorded.tape.slice(0, -1);
    expect(draftDuelGameTapeDigest(shorter)).not.toBe(draftDuelGameTapeDigest(recorded.tape));
    const movedSeed = seedSchema.parse(seedFromString('tape-contract-2'));
    expect(draftDuelSimulationInputDigest({ ...simulationInput, seed: movedSeed })).not.toBe(
      draftDuelSimulationInputDigest(simulationInput),
    );
  });
});
