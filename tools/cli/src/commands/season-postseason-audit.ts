import { z } from 'zod';
import {
  seasonPostseasonSummaryDigest,
  seasonPostseasonSummarySchema,
  seasonRunReplayExportSchema,
  seasonRunSchema,
  type SeasonPostseasonSummary,
  type SeasonRun,
  type SeasonRunReplayExport,
} from '@hoop-rush/data-contracts';
import { makeReport, type CliReport } from '../report.ts';
import { seasonPostseasonAuditReportSchema } from '../report-schemas.ts';
import { readJsonFile } from './season-data.ts';
export const SEASON_POSTSEASON_AUDIT_OPTIONS: Record<string, boolean> = {
  input: true,
  format: true,
};
export const seasonPostseasonAuditFixtureSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('season postseason audit fixture'),
  run: seasonRunSchema,
  postseasonSummaries: z.array(seasonPostseasonSummarySchema),
});
export type SeasonPostseasonAuditFixture = z.infer<typeof seasonPostseasonAuditFixtureSchema>;
export interface SeasonPostseasonAuditCounts {
  duplicateTeams: number;
  missingTeams: number;
  invalidFeeders: number;
  incorrectHomeCourt: number;
  gamesAfterClinching: number;
  inconsistentSummaries: number;
  championCompletionMismatch: number;
  digestMismatch: number;
}
const ZERO_COUNTS: SeasonPostseasonAuditCounts = {
  duplicateTeams: 0,
  missingTeams: 0,
  invalidFeeders: 0,
  incorrectHomeCourt: 0,
  gamesAfterClinching: 0,
  inconsistentSummaries: 0,
  championCompletionMismatch: 0,
  digestMismatch: 0,
};
const PREV_ROUND: Record<string, string> = {
  'conference-semifinal': 'first-round',
  'conference-final': 'conference-semifinal',
  finals: 'conference-final',
};
function gameOrdinalOf(summary: SeasonPostseasonSummary): number {
  if (summary.phase === 'play-in') {
    const conferenceOffset = summary.conference === 'west' ? 3 : 0;
    const matchup: Record<string, number> = { 'seven-eight': 0, 'nine-ten': 1, final: 2 };
    return conferenceOffset + (matchup[summary.round] ?? 0);
  }
  const roundBase: Record<string, number> = {
    'first-round': 10,
    'conference-semifinal': 20,
    'conference-final': 30,
    finals: 40,
  };
  return (roundBase[summary.round] ?? 50) + summary.gameNumber;
}
function teamsOf(summary: SeasonPostseasonSummary): string[] {
  return [summary.homeFranchiseId, summary.awayFranchiseId];
}
export function auditSeasonPostseasonFacts(input: {
  summaries: SeasonPostseasonSummary[];
  championFranchiseId: string | null;
  run?: SeasonRun;
  exportArtifact?: SeasonRunReplayExport;
}): {
  failures: string[];
  counts: SeasonPostseasonAuditCounts;
} {
  const failures: string[] = [];
  const counts = { ...ZERO_COUNTS };
  const byGameId = new Map<string, SeasonPostseasonSummary>();
  for (const summary of input.summaries) {
    if (byGameId.has(summary.gameId)) {
      counts.inconsistentSummaries += 1;
      failures.push(`duplicate postseason summary ${summary.gameId}`);
      continue;
    }
    byGameId.set(summary.gameId, summary);
    const parsed = seasonPostseasonSummarySchema.safeParse(summary);
    if (!parsed.success) {
      counts.inconsistentSummaries += 1;
      failures.push(
        `summary ${summary.gameId} fails the schema: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
      );
      continue;
    }
    if (seasonPostseasonSummaryDigest(summary) !== summary.resultDigest) {
      counts.digestMismatch += 1;
      failures.push(`summary ${summary.gameId} result digest does not recompute`);
    }
  }
  const playIn = new Map<string, SeasonPostseasonSummary>();
  for (const summary of input.summaries) {
    if (summary.phase !== 'play-in') continue;
    const key = `${summary.conference}-${summary.round}`;
    if (playIn.has(key)) {
      counts.invalidFeeders += 1;
      failures.push(`duplicate play-in game ${summary.gameId}`);
      continue;
    }
    playIn.set(key, summary);
    if (summary.homeFranchiseId === summary.awayFranchiseId) {
      counts.invalidFeeders += 1;
      failures.push(`play-in ${summary.gameId} pairs a team with itself`);
    }
  }
  for (const conference of ['east', 'west'] as const) {
    const sevenEight = playIn.get(`${conference}-seven-eight`);
    const nineTen = playIn.get(`${conference}-nine-ten`);
    const finalGame = playIn.get(`${conference}-final`);
    if (sevenEight === undefined || nineTen === undefined) continue;
    const sevenWinner = sevenEight.winnerFranchiseId;
    const sevenLoser =
      sevenEight.winnerFranchiseId === sevenEight.homeFranchiseId
        ? sevenEight.awayFranchiseId
        : sevenEight.homeFranchiseId;
    const nineWinner = nineTen.winnerFranchiseId;
    const nineLoser =
      nineTen.winnerFranchiseId === nineTen.homeFranchiseId
        ? nineTen.awayFranchiseId
        : nineTen.homeFranchiseId;
    if (finalGame !== undefined) {
      const finalTeams = new Set(teamsOf(finalGame));
      if (!finalTeams.has(sevenLoser) || !finalTeams.has(nineWinner)) {
        counts.invalidFeeders += 1;
        failures.push(
          `${conference} play-in final must pair the seven-eight loser ${sevenLoser} and nine-ten winner ${nineWinner}`,
        );
      }
      if (finalTeams.has(sevenWinner)) {
        counts.invalidFeeders += 1;
        failures.push(
          `${conference} play-in final re-pairs the seven-eight winner ${sevenWinner} (already seeded)`,
        );
      }
      if (finalTeams.has(nineLoser)) {
        counts.invalidFeeders += 1;
        failures.push(
          `${conference} play-in final re-pairs the eliminated nine-ten loser ${nineLoser}`,
        );
      }
    }
  }
  const playoffSummaries = input.summaries.filter((summary) => summary.phase === 'playoffs');
  const ordered = [...playoffSummaries].sort((a, b) => gameOrdinalOf(a) - gameOrdinalOf(b));
  const firstRoundTeams = new Map<string, Set<string>>();
  const firstRoundSeriesByTeam = new Map<string, Map<string, string>>();
  for (const summary of ordered) {
    if (summary.round !== 'first-round') continue;
    const set = firstRoundTeams.get(summary.conference) ?? new Set<string>();
    const seriesByTeam =
      firstRoundSeriesByTeam.get(summary.conference) ?? new Map<string, string>();
    for (const team of teamsOf(summary)) {
      const priorSeries = seriesByTeam.get(team);
      if (priorSeries !== undefined && priorSeries !== summary.seriesId) {
        counts.duplicateTeams += 1;
        failures.push(
          `${summary.conference} team ${team} appears in two first-round series (${priorSeries}, ${String(summary.seriesId)})`,
        );
      }
      seriesByTeam.set(team, summary.seriesId ?? '');
      set.add(team);
    }
    firstRoundTeams.set(summary.conference, set);
    firstRoundSeriesByTeam.set(summary.conference, seriesByTeam);
  }
  for (const conference of ['east', 'west'] as const) {
    const set = firstRoundTeams.get(conference);
    if (set === undefined) {
      if (playoffSummaries.length > 0) {
        counts.missingTeams += 1;
        failures.push(`${conference} first round has no recorded series`);
      }
      continue;
    }
    if (set.size !== 8) {
      counts.missingTeams += 1;
      failures.push(
        `${conference} first round carries ${String(set.size)} distinct teams instead of 8`,
      );
    }
  }
  const finalsSummaries = playoffSummaries.filter((summary) => summary.seriesId === 'finals');
  const finalsTeamSet = new Set<string>();
  for (const summary of finalsSummaries) {
    for (const team of teamsOf(summary)) finalsTeamSet.add(team);
  }
  if (finalsSummaries.length > 0 && finalsTeamSet.size !== 2) {
    counts.missingTeams += 1;
    failures.push(`the finals name ${String(finalsTeamSet.size)} distinct teams instead of 2`);
  }
  const seriesGames = new Map<string, SeasonPostseasonSummary[]>();
  for (const summary of playoffSummaries) {
    const games = seriesGames.get(summary.seriesId ?? '');
    if (games === undefined) seriesGames.set(summary.seriesId ?? '', [summary]);
    else games.push(summary);
  }
  const roundWinners = new Map<string, Set<string>>();
  for (const [seriesId, games] of seriesGames) {
    if (games.length === 0) continue;
    const homeCourtSide = games[0]?.homeFranchiseId;
    if (homeCourtSide === undefined) continue;
    let homeCourtWins = 0;
    let challengerWins = 0;
    const byNumber = new Map(games.map((game) => [game.gameNumber, game]));
    for (let number = 1; number <= games.length; number += 1) {
      const game = byNumber.get(number);
      if (game === undefined) {
        counts.inconsistentSummaries += 1;
        failures.push(`series ${seriesId} skips game ${String(number)}`);
        continue;
      }
      if (homeCourtWins >= 4 || challengerWins >= 4) {
        counts.gamesAfterClinching += 1;
        failures.push(`game ${game.gameId} recorded after ${seriesId} clinched`);
      }
      if (game.status === 'forfeit') continue;
      if (game.winnerFranchiseId === homeCourtSide) homeCourtWins += 1;
      else challengerWins += 1;
      const homeGames = new Set([1, 2, 5, 7]);
      const shouldBeHomeSide = homeGames.has(game.gameNumber);
      if ((game.homeFranchiseId === homeCourtSide) !== shouldBeHomeSide) {
        counts.incorrectHomeCourt += 1;
        failures.push(
          `series ${seriesId} game ${String(game.gameNumber)} home ${game.homeFranchiseId} breaks the 2-2-1-1-1 pattern (home side ${homeCourtSide})`,
        );
      }
    }
    const last = games[games.length - 1];
    const winner = last?.winnerFranchiseId ?? null;
    const winnerWins =
      winner === null ? 0 : games.filter((game) => game.winnerFranchiseId === winner).length;
    if (last !== undefined && last.status === 'final' && winnerWins < 4) {
      counts.inconsistentSummaries += 1;
      failures.push(`series ${seriesId} ends before any team reached four wins`);
    }
    if (winner !== null && games[0] !== undefined) {
      const key = `${games[0].conference}-${games[0].round}`;
      const winners = roundWinners.get(key) ?? new Set<string>();
      winners.add(winner);
      roundWinners.set(key, winners);
    }
  }
  for (const summary of ordered) {
    if (summary.round === 'first-round') continue;
    if (summary.round === 'finals') {
      const eastWinners = roundWinners.get('east-conference-final') ?? new Set<string>();
      const westWinners = roundWinners.get('west-conference-final') ?? new Set<string>();
      const champions = new Set([...eastWinners, ...westWinners]);
      for (const team of teamsOf(summary)) {
        if (!champions.has(team)) {
          counts.gamesAfterClinching += 1;
          failures.push(`${summary.gameId} starts before ${team} clinched its conference final`);
        }
      }
      continue;
    }
    const previous = PREV_ROUND[summary.round];
    if (previous === undefined) continue;
    const winners = roundWinners.get(`${summary.conference}-${previous}`);
    if (winners === undefined) continue;
    for (const team of teamsOf(summary)) {
      if (!winners.has(team)) {
        counts.gamesAfterClinching += 1;
        failures.push(`${summary.gameId} starts before ${team} clinched the ${previous} series`);
      }
    }
  }
  for (const conference of ['east', 'west'] as const) {
    const playInOrdinals = [...playIn.values()]
      .filter((summary) => summary.conference === conference)
      .map((summary) => gameOrdinalOf(summary));
    const lastPlayIn = playInOrdinals.reduce((max, ordinal) => Math.max(max, ordinal), 0);
    for (const summary of ordered) {
      if (summary.round !== 'first-round' || summary.conference !== conference) continue;
      if (gameOrdinalOf(summary) <= lastPlayIn) {
        counts.gamesAfterClinching += 1;
        failures.push(
          `${conference} first-round game ${summary.gameId} precedes the conference play-in games`,
        );
      }
      break;
    }
  }
  for (const conference of ['east', 'west'] as const) {
    const sevenEight = playIn.get(`${conference}-seven-eight`);
    const finalGame = playIn.get(`${conference}-final`);
    if (sevenEight === undefined || finalGame === undefined) continue;
    const sevenLoser =
      sevenEight.winnerFranchiseId === sevenEight.homeFranchiseId
        ? sevenEight.awayFranchiseId
        : sevenEight.homeFranchiseId;
    if (finalGame.homeFranchiseId !== sevenLoser) {
      counts.incorrectHomeCourt += 1;
      failures.push(
        `${conference} play-in final must be hosted by the seven-eight loser ${sevenLoser}, not ${finalGame.homeFranchiseId}`,
      );
    }
  }
  const finalsSeries = seriesGames.get('finals');
  const finalsWinner =
    finalsSeries?.find((game) => game.status === 'final')?.winnerFranchiseId ?? null;
  const expectedChampion = input.championFranchiseId;
  if (expectedChampion !== null && finalsWinner !== null && expectedChampion !== finalsWinner) {
    counts.championCompletionMismatch += 1;
    failures.push(
      `recorded champion ${expectedChampion} does not match the finals winner ${finalsWinner}`,
    );
  }
  if (
    input.exportArtifact !== undefined &&
    expectedChampion !== null &&
    input.exportArtifact.almanac.championFranchiseId !== expectedChampion
  ) {
    counts.championCompletionMismatch += 1;
    failures.push(
      `export champion ${expectedChampion} does not match the almanac champion ${input.exportArtifact.almanac.championFranchiseId}`,
    );
  }
  if (input.run !== undefined) {
    const stateChampion = input.run.postseason.championFranchiseId;
    const completionChampion = input.run.completion?.championFranchiseId ?? null;
    if (stateChampion !== null && expectedChampion !== null && stateChampion !== expectedChampion) {
      counts.championCompletionMismatch += 1;
      failures.push(
        `state machine champion ${stateChampion} does not match the recorded champion ${expectedChampion}`,
      );
    }
    if (
      completionChampion !== null &&
      stateChampion !== null &&
      completionChampion !== stateChampion
    ) {
      counts.championCompletionMismatch += 1;
      failures.push(
        `completion champion ${completionChampion} does not match the state machine champion ${stateChampion}`,
      );
    }
  }
  return { failures, counts };
}
export function seasonPostseasonAudit(args: { input: string | null }): CliReport {
  const inputPath = args.input;
  if (inputPath === null) {
    throw new Error('season postseason audit requires --input <file>');
  }
  const raw = readJsonFile(inputPath);
  const exportParsed = seasonRunReplayExportSchema.safeParse(raw);
  if (exportParsed.success) {
    const exportArtifact = exportParsed.data;
    const { failures, counts } = auditSeasonPostseasonFacts({
      summaries: exportArtifact.postseasonSummaries,
      championFranchiseId: exportArtifact.championFranchiseId,
      exportArtifact,
    });
    return auditReport(
      inputPath,
      exportArtifact.runId,
      exportArtifact.championFranchiseId,
      exportArtifact.postseasonSummaries.length,
      failures,
      counts,
    );
  }
  const fixtureParsed = seasonPostseasonAuditFixtureSchema.safeParse(raw);
  if (!fixtureParsed.success) {
    return makeReport(
      'season postseason audit',
      { input: inputPath },
      {
        failures: [
          `input is neither a full-run replay export nor an audit fixture: ${fixtureParsed.error.issues[0]?.message ?? 'unknown'}`,
        ],
        exitCode: 2,
      },
    );
  }
  const fixture = fixtureParsed.data;
  const champion = fixture.run.completion?.championFranchiseId ?? null;
  const { failures, counts } = auditSeasonPostseasonFacts({
    summaries: fixture.postseasonSummaries,
    championFranchiseId: champion,
    run: fixture.run,
  });
  return auditReport(
    inputPath,
    fixture.run.runId,
    champion,
    fixture.postseasonSummaries.length,
    failures,
    counts,
  );
}
function auditReport(
  inputPath: string,
  runId: string,
  champion: string | null,
  gameCount: number,
  failures: string[],
  counts: SeasonPostseasonAuditCounts,
): CliReport {
  const payload = seasonPostseasonAuditReportSchema.parse({
    schemaVersion: 1,
    command: 'season postseason audit',
    runId,
    championFranchiseId: champion,
    gameCount,
    failures,
    counts,
    pass: failures.length === 0,
  });
  const details = [
    `run ${runId} · champion ${String(champion)} · ${String(gameCount)} postseason games`,
    `duplicate teams ${String(counts.duplicateTeams)} · missing teams ${String(counts.missingTeams)} · invalid feeders ${String(counts.invalidFeeders)}`,
    `incorrect home court ${String(counts.incorrectHomeCourt)} · games after clinching ${String(counts.gamesAfterClinching)} · inconsistent summaries ${String(counts.inconsistentSummaries)} · champion/completion mismatches ${String(counts.championCompletionMismatch)}`,
  ];
  return makeReport(
    'season postseason audit',
    { input: inputPath },
    { details, failures, payload },
  );
}
