import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SEASON_EMPTY_COMMAND_LOG_DIGEST,
  buildSeasonRunReplayExport,
  contentHashSchema,
  eraIdSchema,
  franchiseIdSchema,
  idSchema,
  seasonCommandLogDigest,
  seasonCommandLogEntrySchema,
  seasonCommandLogSchema,
  seasonPostseasonSummaryDigest,
  seasonPostseasonSummarySchema,
  type FranchiseId,
  type SeasonPostseasonSummary,
} from '@hoop-rush/data-contracts';
import { jsonPayload, REPO_ROOT, runCli, withTmpDir } from './cli-test-helpers.ts';
import { seasonPostseasonAuditReportSchema } from './report-schemas.ts';
import {
  auditSeasonPostseasonFacts,
  seasonPostseasonAuditFixtureSchema,
} from './commands/season-postseason-audit.ts';
import { loadSeasonRunFixture } from './commands/season-block.ts';
const EAST: {
  seeds: string[];
  firstRound: Array<{
    home: string;
    away: string;
  }>;
} = {
  seeds: [
    'lakers',
    'celtics',
    'knicks',
    'heat',
    'magic',
    'bucks',
    'bulls',
    'hawks',
    'pistons',
    'hornets',
  ],
  firstRound: [
    { home: 'lakers', away: 'pistons' },
    { home: 'heat', away: 'magic' },
    { home: 'knicks', away: 'bucks' },
    { home: 'celtics', away: 'bulls' },
  ],
} as const;
const WEST: {
  seeds: string[];
  firstRound: Array<{
    home: string;
    away: string;
  }>;
} = {
  seeds: [
    'warriors',
    'clippers',
    'suns',
    'nuggets',
    'jazz',
    'thunder',
    'mavericks',
    'rockets',
    'timberwolves',
    'grizzlies',
  ],
  firstRound: [
    { home: 'warriors', away: 'timberwolves' },
    { home: 'nuggets', away: 'jazz' },
    { home: 'suns', away: 'thunder' },
    { home: 'clippers', away: 'mavericks' },
  ],
} as const;
function zeroLine(versionId: string): SeasonPostseasonSummary['homePlayers'][number] {
  return {
    playerVersionId: versionId,
    seconds: 0,
    points: 0,
    fieldGoalsMade: 0,
    fieldGoalsAttempted: 0,
    threePointersMade: 0,
    threePointersAttempted: 0,
    freeThrowsMade: 0,
    freeThrowsAttempted: 0,
    offensiveRebounds: 0,
    defensiveRebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    fouls: 0,
  };
}
function baseSummary(facts: {
  gameId: string;
  phase: 'play-in' | 'playoffs';
  round: SeasonPostseasonSummary['round'];
  seriesId: string | null;
  gameNumber: number;
  conference: 'east' | 'west';
  homeFranchiseId: string;
  awayFranchiseId: string;
  winnerFranchiseId: string;
  loserFranchiseId: string;
  status?: 'final' | 'forfeit';
  homeScore?: number;
  awayScore?: number;
}): SeasonPostseasonSummary {
  const status = facts.status ?? 'final';
  const homeWon = facts.winnerFranchiseId === facts.homeFranchiseId;
  const homeScore = facts.homeScore ?? (status === 'forfeit' ? 2 : homeWon ? 101 : 97);
  const awayScore = facts.awayScore ?? (status === 'forfeit' ? 0 : homeWon ? 97 : 101);
  const summary = seasonPostseasonSummarySchema.parse({
    schemaVersion: 1,
    summaryVersion: 'postseason-summary-v1',
    runId: 'fixture-season-run-1',
    gameId: facts.gameId,
    phase: facts.phase,
    round: facts.round,
    seriesId: facts.seriesId,
    gameNumber: facts.gameNumber,
    conference: facts.conference,
    homeFranchiseId: facts.homeFranchiseId,
    awayFranchiseId: facts.awayFranchiseId,
    winnerFranchiseId: facts.winnerFranchiseId,
    loserFranchiseId: facts.loserFranchiseId,
    status,
    homeScore,
    awayScore,
    forfeitLoserFranchiseId: status === 'forfeit' ? facts.loserFranchiseId : null,
    homeBox: {
      franchiseId: facts.homeFranchiseId,
      points: status === 'forfeit' ? 0 : homeScore,
      fieldGoalsMade: 0,
      fieldGoalsAttempted: 0,
      threePointersMade: 0,
      threePointersAttempted: 0,
      freeThrowsMade: 0,
      freeThrowsAttempted: 0,
      offensiveRebounds: 0,
      defensiveRebounds: 0,
      assists: 0,
      steals: 0,
      blocks: 0,
      turnovers: 0,
      fouls: 0,
      possessions: 100,
    },
    awayBox: {
      franchiseId: facts.awayFranchiseId,
      points: status === 'forfeit' ? 0 : awayScore,
      fieldGoalsMade: 0,
      fieldGoalsAttempted: 0,
      threePointersMade: 0,
      threePointersAttempted: 0,
      freeThrowsMade: 0,
      freeThrowsAttempted: 0,
      offensiveRebounds: 0,
      defensiveRebounds: 0,
      assists: 0,
      steals: 0,
      blocks: 0,
      turnovers: 0,
      fouls: 0,
      possessions: 100,
    },
    homePlayers:
      status === 'forfeit'
        ? []
        : Array.from({ length: 10 }, (_, index) =>
            zeroLine(`pv-${String(index).padStart(32, '0')}`),
          ),
    awayPlayers:
      status === 'forfeit'
        ? []
        : Array.from({ length: 10 }, (_, index) =>
            zeroLine(`pv-${String(index + 10).padStart(32, '0')}`),
          ),
    rotationEvidence:
      status === 'forfeit'
        ? { home: { playersUsed: 0, substitutions: 0 }, away: { playersUsed: 0, substitutions: 0 } }
        : {
            home: { playersUsed: 10, substitutions: 20 },
            away: { playersUsed: 10, substitutions: 20 },
          },
    injuryEvents: [],
    resultDigest: '0'.repeat(32),
  });
  return { ...summary, resultDigest: seasonPostseasonSummaryDigest(summary) };
}
function sweep(
  seriesId: string,
  round: SeasonPostseasonSummary['round'],
  conference: 'east' | 'west',
  homeCourt: string,
  challenger: string,
  winner: string,
): SeasonPostseasonSummary[] {
  const games: SeasonPostseasonSummary[] = [];
  for (let number = 1; number <= 4; number += 1) {
    const homeGames = new Set([1, 2, 5, 7]);
    const home = homeGames.has(number) ? homeCourt : challenger;
    const away = home === homeCourt ? challenger : homeCourt;
    const homeWon = winner === home;
    games.push(
      baseSummary({
        gameId: `po-${seriesId}-g${String(number)}`,
        phase: 'playoffs',
        round,
        seriesId,
        gameNumber: number,
        conference,
        homeFranchiseId: home,
        awayFranchiseId: away,
        winnerFranchiseId: homeWon ? home : away,
        loserFranchiseId: homeWon ? away : home,
      }),
    );
  }
  return games;
}
function validPostseason(): SeasonPostseasonSummary[] {
  const summaries: SeasonPostseasonSummary[] = [];
  for (const conference of ['east', 'west'] as const) {
    const seeds = conference === 'east' ? EAST.seeds : WEST.seeds;
    const firstRound = conference === 'east' ? EAST.firstRound : WEST.firstRound;
    const seven = seeds[6] as string;
    const eight = seeds[7] as string;
    const nine = seeds[8] as string;
    const ten = seeds[9] as string;
    summaries.push(
      baseSummary({
        gameId: `pi-${conference}-seven-eight`,
        phase: 'play-in',
        round: 'seven-eight',
        seriesId: null,
        gameNumber: 1,
        conference,
        homeFranchiseId: seven,
        awayFranchiseId: eight,
        winnerFranchiseId: seven,
        loserFranchiseId: eight,
      }),
      baseSummary({
        gameId: `pi-${conference}-nine-ten`,
        phase: 'play-in',
        round: 'nine-ten',
        seriesId: null,
        gameNumber: 1,
        conference,
        homeFranchiseId: nine,
        awayFranchiseId: ten,
        winnerFranchiseId: nine,
        loserFranchiseId: ten,
      }),
      baseSummary({
        gameId: `pi-${conference}-final`,
        phase: 'play-in',
        round: 'final',
        seriesId: null,
        gameNumber: 1,
        conference,
        homeFranchiseId: eight,
        awayFranchiseId: nine,
        winnerFranchiseId: nine,
        loserFranchiseId: eight,
      }),
    );
    const qualifiers = new Map<string, string>([
      [seven, seven],
      [nine, nine],
    ]);
    const conferenceLetter = conference === 'east' ? 'e' : 'w';
    const seriesIds = [
      `${conferenceLetter}fr1`,
      `${conferenceLetter}fr2`,
      `${conferenceLetter}fr3`,
      `${conferenceLetter}fr4`,
    ];
    firstRound.forEach((pair, index) => {
      const home = pair.home;
      const away = pair.away;
      summaries.push(
        ...sweep(seriesIds[index] as string, 'first-round', conference, home, away, home),
      );
      qualifiers.set(home, home);
      qualifiers.set(away, away);
    });
    const semifinalPairs = [
      { home: firstRound[0]?.home ?? 'lakers', away: firstRound[1]?.home ?? 'celtics' },
      { home: firstRound[2]?.home ?? 'knicks', away: firstRound[3]?.home ?? 'heat' },
    ];
    semifinalPairs.forEach((pair, index) => {
      summaries.push(
        ...sweep(
          `${conferenceLetter}sf${String(index + 1)}`,
          'conference-semifinal',
          conference,
          pair.home,
          pair.away,
          pair.home,
        ),
      );
    });
    summaries.push(
      ...sweep(
        `${conferenceLetter}cf`,
        'conference-final',
        conference,
        semifinalPairs[0]?.home ?? 'lakers',
        semifinalPairs[1]?.home ?? 'knicks',
        semifinalPairs[0]?.home ?? 'lakers',
      ),
    );
  }
  summaries.push(...sweep('finals', 'finals', 'east', 'lakers', 'warriors', 'lakers'));
  return summaries;
}
function runWithChampion(championRaw: string) {
  const champion = franchiseIdSchema.parse(championRaw);
  const run = loadSeasonRunFixture(join(REPO_ROOT, 'tools/cli/src/fixtures/season-run.json'));
  const opponent = franchiseIdSchema.parse(championRaw === 'lakers' ? 'warriors' : 'lakers');
  const eastSeeds = [...EAST.seeds.slice(0, 8)].map((seed) => franchiseIdSchema.parse(seed));
  const westSeeds = [...WEST.seeds.slice(0, 8)].map((seed) => franchiseIdSchema.parse(seed));
  const emptySeries = (
    seriesIdRaw: string,
    round: 'first-round' | 'conference-semifinal' | 'conference-final' | 'finals',
    conference: 'east' | 'west' | null,
    higherSeed: number | null,
    lowerSeed: number | null,
  ) => ({
    seriesId: idSchema.parse(seriesIdRaw),
    round,
    conference,
    higherSeed,
    lowerSeed,
    homeCourtFranchiseId: null,
    challengerFranchiseId: null,
    homeCourtWins: 0,
    challengerWins: 0,
    games: [],
    winnerFranchiseId: null,
  });
  const finalsGames = [1, 2, 3, 4].map((number) => {
    const homeGames = new Set([1, 2, 5, 7]);
    const home = homeGames.has(number) ? champion : opponent;
    const away = home === champion ? opponent : champion;
    return {
      gameId: `po-finals-g${String(number)}`,
      gameNumber: number,
      homeFranchiseId: home,
      awayFranchiseId: away,
      status: 'final' as const,
      homeScore: 101,
      awayScore: 97,
      winnerFranchiseId: home === champion ? champion : opponent,
    };
  });
  const conferenceBracket = (conference: 'east' | 'west', seeds: FranchiseId[]) => {
    const letter = conference === 'east' ? 'e' : 'w';
    return {
      conference,
      seeds,
      firstRound: Array.from({ length: 4 }, (_, index) =>
        emptySeries(
          `${letter}fr${String(index + 1)}`,
          'first-round',
          conference,
          8 - index,
          index + 1,
        ),
      ),
      semifinals: Array.from({ length: 2 }, (_, index) =>
        emptySeries(
          `${letter}sf${String(index + 1)}`,
          'conference-semifinal',
          conference,
          4 - index,
          index + 1,
        ),
      ),
      conferenceFinal: emptySeries(`${letter}cf`, 'conference-final', conference, 1, 2),
    };
  };
  const bracket = {
    schemaVersion: 1 as const,
    postseasonVersion: 'postseason-v2' as const,
    east: conferenceBracket('east', eastSeeds),
    west: conferenceBracket('west', westSeeds),
    finals: {
      seriesId: idSchema.parse('finals'),
      round: 'finals' as const,
      conference: null,
      higherSeed: null,
      lowerSeed: null,
      homeCourtFranchiseId: champion,
      challengerFranchiseId: opponent,
      homeCourtWins: 4,
      challengerWins: 0,
      games: finalsGames,
      winnerFranchiseId: champion,
    },
    championFranchiseId: champion,
  };
  return {
    ...run,
    stage: 'completed' as const,
    postseason: {
      ...run.postseason,
      playIn: {
        ...run.postseason.playIn,
        east: { ...run.postseason.playIn.east, playoffSeeds: eastSeeds },
        west: { ...run.postseason.playIn.west, playoffSeeds: westSeeds },
      },
      bracket,
      championFranchiseId: champion,
    },
    completion: {
      championFranchiseId: champion,
      almanacDigest: '0'.repeat(32),
      finalizedAtStateRevision: 0,
    },
  };
}
function auditOf(summaries: SeasonPostseasonSummary[], championRaw = 'lakers') {
  const champion = franchiseIdSchema.parse(championRaw);
  return auditSeasonPostseasonFacts({
    summaries,
    championFranchiseId: champion,
    run: runWithChampion(championRaw),
  });
}
describe('season postseason audit (postseason-v2)', () => {
  it('passes a fully consistent postseason with zero failures', () => {
    const { failures, counts } = auditOf(validPostseason());
    expect(failures).toEqual([]);
    expect(counts).toEqual({
      duplicateTeams: 0,
      missingTeams: 0,
      invalidFeeders: 0,
      incorrectHomeCourt: 0,
      gamesAfterClinching: 0,
      inconsistentSummaries: 0,
      championCompletionMismatch: 0,
      digestMismatch: 0,
    });
  });
  it('detects a team in two first-round series (duplicate teams)', () => {
    const summaries = validPostseason();
    const index = summaries.findIndex((summary) => summary.gameId === 'po-efr2-g1');
    summaries[index] = {
      ...(summaries[index] as SeasonPostseasonSummary),
      homeFranchiseId: franchiseIdSchema.parse('lakers'),
    };
    const { failures, counts } = auditOf(summaries);
    expect(counts.duplicateTeams).toBeGreaterThan(0);
    expect(failures.some((failure) => failure.includes('two first-round series'))).toBe(true);
  });
  it('audits the full-run replay export path with the same recorded facts', () => {
    const summaries = validPostseason();
    const run = runWithChampion('lakers');
    const log = seasonCommandLogSchema.parse({
      schemaVersion: 1,
      commandLogVersion: 'command-log-v3',
      runId: run.runId,
      entries: [
        seasonCommandLogEntrySchema.parse({
          runId: run.runId,
          ordinal: 0,
          command: {
            schemaVersion: 11,
            command: 'start-postseason',
            commandId: 'audit-start-1',
            runId: run.runId,
            expectedStateRevision: 0,
            expectedStateDigest: '0'.repeat(32),
          },
          preStateRevision: 0,
          preStateDigest: '0'.repeat(32),
          postStateRevision: 1,
          postStateDigest: '1'.repeat(32),
          resultDigest: '2'.repeat(32),
          previousLogDigest: SEASON_EMPTY_COMMAND_LOG_DIGEST,
          relatedGameIds: [],
          transactionIds: [],
        }),
      ],
    });
    const exportArtifact = buildSeasonRunReplayExport({
      runId: run.runId,
      rootSeed: run.rootSeed,
      eraId: eraIdSchema.parse('1990s'),
      versions: run.versions,
      assetHashes: {
        league: contentHashSchema.parse('0'.repeat(64)),
        schedule: contentHashSchema.parse('0'.repeat(64)),
        draftCatalog: contentHashSchema.parse('0'.repeat(64)),
        eraProfile: contentHashSchema.parse('0'.repeat(64)),
      },
      commandLog: log,
      postseasonSummaries: summaries,
      almanac: {
        schemaVersion: 1,
        almanacVersion: 'almanac-v2',
        runId: run.runId,
        rootSeed: run.rootSeed,
        championFranchiseId: franchiseIdSchema.parse('lakers'),
        postseasonDigest: '0'.repeat(32),
        commandLogDigest: seasonCommandLogDigest(log.entries),
        awardsDigest: '0'.repeat(32),
        tradeGradesDigest: '0'.repeat(32),
        digest: '0'.repeat(32),
      },
      championFranchiseId: franchiseIdSchema.parse('lakers'),
      finalStateDigest: '1'.repeat(32),
    });
    const { failures, counts } = auditSeasonPostseasonFacts({
      summaries: exportArtifact.postseasonSummaries,
      championFranchiseId: exportArtifact.championFranchiseId,
      exportArtifact,
    });
    expect(failures).toEqual([]);
    expect(counts.championCompletionMismatch).toBe(0);
    const warriors = franchiseIdSchema.parse('warriors');
    const mismatched = auditSeasonPostseasonFacts({
      summaries,
      championFranchiseId: warriors,
      exportArtifact: { ...exportArtifact, championFranchiseId: warriors },
    });
    expect(mismatched.counts.championCompletionMismatch).toBeGreaterThan(0);
  });
  it('detects an incomplete bracket (missing teams)', () => {
    const summaries = validPostseason().filter((summary) => !summary.gameId.startsWith('po-wfr'));
    const { failures, counts } = auditOf(summaries);
    expect(counts.missingTeams).toBeGreaterThan(0);
    expect(
      failures.some(
        (failure) => failure.includes('instead of 8') || failure.includes('has no recorded series'),
      ),
    ).toBe(true);
  });
  it('detects an invalid play-in final pairing (invalid feeders)', () => {
    const summaries = validPostseason();
    const index = summaries.findIndex((summary) => summary.gameId === 'pi-east-final');
    const final = summaries[index];
    if (final === undefined) throw new Error('missing final');
    const hornets = franchiseIdSchema.parse('hornets');
    summaries[index] = { ...final, awayFranchiseId: hornets, loserFranchiseId: hornets };
    const { failures, counts } = auditOf(summaries);
    expect(counts.invalidFeeders).toBeGreaterThan(0);
    expect(failures.some((failure) => failure.includes('must pair the seven-eight loser'))).toBe(
      true,
    );
    expect(
      failures.some((failure) => failure.includes('re-pairs the eliminated nine-ten loser')),
    ).toBe(true);
  });
  it('detects an incorrect play-in final host (home court)', () => {
    const summaries = validPostseason();
    const index = summaries.findIndex((summary) => summary.gameId === 'pi-west-final');
    const final = summaries[index];
    if (final === undefined) throw new Error('missing final');
    summaries[index] = {
      ...final,
      homeFranchiseId: franchiseIdSchema.parse('timberwolves'),
    };
    const { failures, counts } = auditOf(summaries);
    expect(counts.incorrectHomeCourt).toBeGreaterThan(0);
    expect(
      failures.some((failure) => failure.includes('must be hosted by the seven-eight loser')),
    ).toBe(true);
  });
  it('detects a broken 2-2-1-1-1 pattern in a playoff series (home court)', () => {
    const summaries = validPostseason();
    const index = summaries.findIndex((summary) => summary.gameId === 'po-efr1-g3');
    const game = summaries[index];
    if (game === undefined) throw new Error('missing game');
    summaries[index] = {
      ...game,
      homeFranchiseId: franchiseIdSchema.parse('lakers'),
      awayFranchiseId: franchiseIdSchema.parse('pistons'),
    };
    const { failures, counts } = auditOf(summaries);
    expect(counts.incorrectHomeCourt).toBeGreaterThan(0);
    expect(failures.some((failure) => failure.includes('2-2-1-1-1'))).toBe(true);
  });
  it('detects a game recorded after a series clinched (games after clinching)', () => {
    const summaries = validPostseason();
    const game = summaries[summaries.findIndex((summary) => summary.gameId === 'po-efr1-g4')];
    if (game === undefined) throw new Error('missing game');
    summaries.push(
      baseSummary({
        gameId: 'po-efr1-g5',
        phase: 'playoffs',
        round: 'first-round',
        seriesId: 'efr1',
        gameNumber: 5,
        conference: 'east',
        homeFranchiseId: 'lakers',
        awayFranchiseId: 'pistons',
        winnerFranchiseId: 'lakers',
        loserFranchiseId: 'pistons',
      }),
    );
    const { failures, counts } = auditOf(summaries);
    expect(counts.gamesAfterClinching).toBeGreaterThan(0);
    expect(failures.some((failure) => failure.includes('clinched'))).toBe(true);
  });
  it('detects an inconsistent summary digest (inconsistent summaries)', () => {
    const summaries = validPostseason();
    const index = summaries.findIndex((summary) => summary.gameId === 'pi-east-seven-eight');
    summaries[index] = {
      ...(summaries[index] as SeasonPostseasonSummary),
      resultDigest: 'f'.repeat(32),
    };
    const { failures, counts } = auditOf(summaries);
    expect(counts.digestMismatch).toBeGreaterThan(0);
    expect(failures.some((failure) => failure.includes('result digest does not recompute'))).toBe(
      true,
    );
  });
  it('detects a series ending before four wins (inconsistent summaries)', () => {
    const summaries = validPostseason().filter((summary) => summary.gameId !== 'po-efr1-g4');
    const { failures, counts } = auditOf(summaries);
    expect(counts.inconsistentSummaries).toBeGreaterThan(0);
    expect(
      failures.some((failure) => failure.includes('ends before any team reached four wins')),
    ).toBe(true);
  });
  it('detects champion/completion mismatches (fixture and export paths)', () => {
    const summaries = validPostseason();
    const warriors = franchiseIdSchema.parse('warriors');
    const lakers = franchiseIdSchema.parse('lakers');
    const fixture = auditSeasonPostseasonFacts({
      summaries,
      championFranchiseId: warriors,
      run: runWithChampion('warriors'),
    });
    expect(fixture.counts.championCompletionMismatch).toBeGreaterThan(0);
    expect(
      fixture.failures.some((failure) =>
        failure.includes('recorded champion warriors does not match the finals winner lakers'),
      ),
    ).toBe(true);
    const stateMismatch = auditSeasonPostseasonFacts({
      summaries,
      championFranchiseId: lakers,
      run: {
        ...runWithChampion('lakers'),
        completion: {
          championFranchiseId: warriors,
          almanacDigest: '0'.repeat(32),
          finalizedAtStateRevision: 0,
        },
      },
    });
    expect(stateMismatch.counts.championCompletionMismatch).toBeGreaterThan(0);
    expect(
      stateMismatch.failures.some((failure) =>
        failure.includes('completion champion warriors does not match the state machine champion'),
      ),
    ).toBe(true);
  });
  it('runs the CLI end-to-end on an audit fixture (exit 0 clean, exit 1 corrupt)', async () => {
    await withTmpDir(async (dir) => {
      const fixture = seasonPostseasonAuditFixtureSchema.parse({
        schemaVersion: 1,
        command: 'season postseason audit fixture',
        run: runWithChampion('lakers'),
        postseasonSummaries: validPostseason(),
      });
      const path = join(dir, 'postseason-audit.json');
      writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`);
      const ok = await runCli([
        'season',
        'postseason',
        'audit',
        '--input',
        path,
        '--format',
        'json',
      ]);
      expect(ok.code).toBe(0);
      const payload = seasonPostseasonAuditReportSchema.parse(jsonPayload(ok.stdout, ok.stderr));
      expect(payload.pass).toBe(true);
      expect(payload.gameCount).toBe(validPostseason().length);
      const corrupt = seasonPostseasonAuditFixtureSchema.parse({
        schemaVersion: 1,
        command: 'season postseason audit fixture',
        run: runWithChampion('lakers'),
        postseasonSummaries: validPostseason().slice(0, 4),
      });
      writeFileSync(path, `${JSON.stringify(corrupt, null, 2)}\n`);
      const bad = await runCli([
        'season',
        'postseason',
        'audit',
        '--input',
        path,
        '--format',
        'json',
      ]);
      expect(bad.code).toBe(1);
      const badPayload = seasonPostseasonAuditReportSchema.parse(
        jsonPayload(bad.stdout, bad.stderr),
      );
      expect(badPayload.pass).toBe(false);
      expect(badPayload.counts.missingTeams).toBeGreaterThan(0);
    });
  });
});
