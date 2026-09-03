import { describe, expect, it } from 'vitest';
import { buildOpeningOpponent, seedFromString } from '@hoop-rush/test-fixtures';
import { playableSlotGroups } from '../domain/positions.ts';
import { generateBracket } from './generator.ts';
import { fixtureBracket, generationOptions } from './generator-testing.ts';
import { validateBracketContent } from '../challenge/commands.ts';
import { evaluateLineupBalance } from '../challenge/lineup-eval.ts';
import { scheduleInvariants } from './schedule.ts';
describe('generateBracket (propose-review-freeze)', () => {
  it('generates a validated 30-team bracket with the fixed 82-game schedule', () => {
    const bracket = fixtureBracket();
    expect(bracket.opponents).toHaveLength(30);
    expect(bracket.schedule).toHaveLength(82);
    expect(validateBracketContent(bracket)).toEqual([]);
    expect(scheduleInvariants(bracket.schedule)).toEqual([]);
    expect(bracket.schedule[0]?.opponentId).toBe('lakers-1990s-opening');
    expect(bracket.generation.seed).toBe(seedFromString('fixture-bracket'));
  }, 40000);
  it('keeps the opening opponent unchanged', () => {
    const opening = buildOpeningOpponent();
    const bracket = fixtureBracket();
    const entry = bracket.opponents.find((o) => o.opponentId === 'lakers-1990s-opening');
    expect(entry).toBeDefined();
    expect(entry?.teamId).toBe(opening.teamId);
    expect(entry?.displayName).toBe(opening.displayName);
    expect(JSON.stringify(entry?.lineup)).toBe(JSON.stringify(opening.lineup));
    expect(JSON.stringify(entry?.players)).toBe(JSON.stringify(opening.players));
  }, 40000);
  it('only selects balanced legal lineups with no internal duplicates', () => {
    const bracket = fixtureBracket();
    const usedPlayers = new Set<string>();
    for (const opponent of bracket.opponents) {
      const team = {
        teamId: opponent.teamId,
        displayName: opponent.displayName,
        players: opponent.players,
      };
      const balance = evaluateLineupBalance(team);
      expect(balance.ok).toBe(true);
      const ids = opponent.players.map((p) => p.playerId);
      expect(new Set(ids).size).toBe(5);
      for (const id of ids) {
        expect(usedPlayers.has(id)).toBe(false);
        usedPlayers.add(id);
      }
      const assignmentIds = opponent.lineup.assignments.map((a) => a.playerId);
      expect(assignmentIds).toEqual(ids);
    }
  }, 40000);
  it('spans the team percentile band with the league median inside its band', () => {
    const bracket = fixtureBracket();
    const percentiles = bracket.opponents
      .filter((o) => o.opponentId !== 'lakers-1990s-opening')
      .map((o) => o.strength.percentile)
      .sort((a, b) => a - b);
    const band = bracket.difficulty.teamPercentileBand;
    expect(Math.min(...percentiles)).toBeGreaterThanOrEqual(band[0] - 0.001);
    expect(Math.max(...percentiles)).toBeLessThanOrEqual(band[1] + 0.001);
    const all = bracket.opponents.map((o) => o.strength.percentile).sort((a, b) => a - b);
    const lower = all[14];
    const upper = all[15];
    if (lower === undefined || upper === undefined) {
      throw new Error('bracket requires 30 opponents');
    }
    const median = (lower + upper) / 2;
    const medianBand = bracket.difficulty.leagueMedianPercentileBand;
    expect(median).toBeGreaterThanOrEqual(medianBand[0]);
    expect(median).toBeLessThanOrEqual(medianBand[1]);
  }, 40000);
  it('records committed generation metadata', () => {
    const bracket = fixtureBracket();
    expect(bracket.generation.generationVersion).toBe('bracket-m3-v1');
    expect(bracket.generation.dataVersion).toBe('data-v1');
    expect(bracket.generation.targetBands.teamPercentileBand).toEqual([0.25, 0.65]);
    expect(bracket.bracketVersion).toBe('bracket-m3-v1');
    expect(bracket.scheduleVersion).toBe('schedule-v1');
    expect(bracket.difficulty.name).toBe('medium');
  }, 40000);
  it('throws when a franchise cannot form a legal lineup', () => {
    const options = generationOptions();
    const broken = options.candidates.map((candidate) =>
      candidate.franchiseId === 'hawks'
        ? {
            ...candidate,
            players: candidate.players.filter((p) => playableSlotGroups(p.positions).includes('G')),
          }
        : candidate,
    );
    expect(() => generateBracket({ ...options, candidates: broken })).toThrow(
      /cannot form a legal lineup/,
    );
  }, 60000);
});
