import { describe, expect, test } from 'bun:test';
import {
  CAP_RUSH_CONFERENCE_GAMES_PER_TEAM,
  type FullCourtSeasonScore,
} from '@hoop-rush/data-contracts';
import {
  buildFullCourtAwards,
  buildFullCourtPlayerSeasonStats,
  createEngineContext,
  createFullCourtSeasonCheckpoint,
  fullCourtStandings,
  lockFullCourtRegularSeason,
  simulateFullCourtSeasonSlot,
} from '@hoop-rush/engine';
import { fullCourtTestSeasonLock } from './full-court-test-support.ts';

/**
 * Guards the invariant the final-report page depends on: a completed run's saved
 * checkpoint plus score rows must rebuild the standings, player table, and awards
 * from disk without re-simulating anything.
 */
describe('final report rebuild', () => {
  test('saved season rows reproduce standings, players, and awards', () => {
    const lock = fullCourtTestSeasonLock();
    const context = createEngineContext();
    let checkpoint = createFullCourtSeasonCheckpoint(lock);
    const scores: FullCourtSeasonScore[] = [];
    for (let slot = 1; slot <= CAP_RUSH_CONFERENCE_GAMES_PER_TEAM; slot += 1) {
      const outcome = simulateFullCourtSeasonSlot(lock, checkpoint, context, {});
      if (outcome.kind !== 'simulated') break;
      checkpoint = outcome.checkpoint;
      scores.push(...outcome.scores);
    }
    expect(checkpoint.completedThroughSlot).toBe(CAP_RUSH_CONFERENCE_GAMES_PER_TEAM);

    // The report loader rebuilds the lock from the archived draft and matches its digest.
    const rebuilt = lockFullCourtRegularSeason(lock.season);
    expect(rebuilt.digest).toBe(lock.digest);

    const standings = fullCourtStandings(lock.season.teams, scores);
    expect(standings.west.length + standings.east.length).toBe(30);

    const rows = buildFullCourtPlayerSeasonStats({ teams: lock.season.teams, scores });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.games > 0)).toBe(true);

    const awards = buildFullCourtAwards({
      teams: lock.season.teams,
      regularScores: scores,
      standings,
      completedSlots: checkpoint.completedThroughSlot,
    });
    expect(awards.hasPlayerStats).toBe(true);
    expect(awards.regularComplete).toBe(true);
    expect(awards.mvp.winner).not.toBeNull();
    expect(awards.sixthMan.winner).not.toBeNull();
  }, 900000);
});
