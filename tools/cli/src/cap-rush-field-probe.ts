import { writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createEngineContext,
  simulateGame,
  toSimulationPlayer,
  buildCapRushLeagueSchedule,
  capRushAssignFranchise,
  capRushUserScheduleOf,
  checkGameResult,
  ENGINE_VERSION,
} from '@hoop-rush/engine';
import {
  seedFromString,
  seedSchema,
  opponentBracketSchema,
  capRushGameSeed,
} from '@hoop-rush/data-contracts';
import { loadPackagedData, PackagedData } from './commands/data-loader.ts';
import { resolvePoolLineup } from './commands/challenge.ts';
import { sha256Hex } from './io.ts';

const count = Number(process.argv[2] ?? 100);
const namespace = process.argv[3] ?? 'cap-rush-field-v1:tuning-probe-v1';
const output = process.argv[4] ?? 'cap-rush-probe.json';
if (!Number.isSafeInteger(count) || count < 1 || count > 100000)
  throw new Error('attempts must be 1..100000');
const packaged = loadPackagedData();
const data = new PackagedData(packaged.manifest, packaged.dir);
const profile = data.eraProfile();
const players = resolvePoolLineup(
  process.argv[5] ??
    "Stephen Curry@warriors,Michael Jordan@bulls,LeBron James@cavaliers,Tim Duncan@spurs,Shaquille O'Neal@lakers",
  data,
);
const reference = {
  teamId: 'elite-reference',
  displayName: 'Elite diagnostic',
  players: players.map(toSimulationPlayer),
};
const context = createEngineContext();
const field = packaged.manifest.modernFranchiseSlots.map((s) => ({
  teamId: s.franchiseId,
  displayName: s.displayName,
}));
const entries = [packaged.manifest.bracket, packaged.manifest.capRushBracket];
const results = entries.map((entry) => {
  if (!entry) throw new Error('missing field');
  const bytes = readFileSync(resolve(packaged.dir, entry.url));
  if (sha256Hex(bytes) !== entry.contentHash) throw new Error('field hash mismatch');
  const bracket = opponentBracketSchema.parse(JSON.parse(bytes.toString()));
  const byAssignment: Record<string, { attempts: number; wins: number; undefeated: number }> = {};
  const matchups: Record<string, { games: number; wins: number }> = {};
  return {
    entry,
    bracket,
    histogram: Array<number>(83).fill(0),
    wins: 0,
    differential: 0,
    undefeated: 0,
    byAssignment,
    matchups,
    seasonWins: [] as number[],
  };
});
for (let attempt = 0; attempt < count; attempt++) {
  const runSeed = seedSchema.parse(seedFromString(`${namespace}:attempt:${String(attempt)}`));
  const assignment = capRushAssignFranchise({ runSeed, field });
  const schedule = capRushUserScheduleOf({
    games: buildCapRushLeagueSchedule({ runSeed, field }).games,
    userTeamId: assignment.franchiseId,
  });
  for (const result of results) {
    let wins = 0;
    for (const game of schedule) {
      const opponent = result.bracket.opponents.find((o) => o.teamId === game.opponentId);
      if (!opponent) throw new Error('missing opponent');
      const rival = {
        teamId: opponent.teamId,
        displayName: opponent.displayName,
        players: opponent.players,
      };
      const played = simulateGame(
        {
          schemaVersion: 2,
          seed: capRushGameSeed(runSeed, game.gameNumber),
          gameNumber: game.gameNumber,
          dataVersion: profile.dataVersion,
          profile,
          home: game.humanHome ? reference : rival,
          away: game.humanHome ? rival : reference,
        },
        context,
      );
      const failures = checkGameResult(played);
      if (failures.length) throw new Error(failures.join(';'));
      const won = played.winner === (game.humanHome ? 'home' : 'away');
      wins += Number(won);
      const margin = played.home.box.points - played.away.box.points;
      result.differential += game.humanHome ? margin : -margin;
      const matchup = (result.matchups[opponent.teamId] ??= { games: 0, wins: 0 });
      matchup.games++;
      matchup.wins += Number(won);
    }
    result.wins += wins;
    result.histogram[wins] = (result.histogram[wins] ?? 0) + 1;
    result.undefeated += Number(wins === 82);
    result.seasonWins.push(wins);
    const cohort = (result.byAssignment[assignment.franchiseId] ??= {
      attempts: 0,
      wins: 0,
      undefeated: 0,
    });
    cohort.attempts++;
    cohort.wins += wins;
    cohort.undefeated += Number(wins === 82);
  }
  if ((attempt + 1) % 100 === 0) console.log(`${String(attempt + 1)}/${String(count)}`);
}
function interval(k: number, n: number) {
  const z = 1.959963984540054,
    p = k / n,
    d = 1 + (z * z) / n,
    c = (p + (z * z) / (2 * n)) / d,
    h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [c - h, c + h];
}
const baseline = results[0];
const custom = results[1];
if (baseline === undefined || custom === undefined) throw new Error('missing paired field');
const pairedDifference = custom.seasonWins.reduce((sum, wins, index) => {
  const previous = baseline.seasonWins[index];
  if (previous === undefined) throw new Error('missing paired attempt');
  return sum + wins - previous;
}, 0);
const report = {
  protocol: 'elite-diagnostic-v1',
  namespace,
  count,
  engineVersion: ENGINE_VERSION,
  profileVersion: profile.profileVersion,
  profileHash: packaged.manifest.eraSimulationProfiles.find((p) => p.eraId === profile.eraId)
    ?.contentHash,
  reference: players.map((p) => ({ playerId: p.playerId, seasonKey: p.seasonKey })),
  conditions:
    'Production ordinary game engine; production Cap Rush takeover/schedule/game seeds; no salary effects or mutations; diagnostic lineup is not a legal cap run. All 82 games simulated, including after losses.',
  fields: results.map((r) => ({
    hash: r.entry.contentHash,
    version: r.bracket.bracketVersion,
    wins: r.wins,
    meanWins: r.wins / count,
    meanPointDifferential: r.differential / (count * 82),
    undefeated: r.undefeated,
    rate: r.undefeated / count,
    confidence95: interval(r.undefeated, count),
    histogram: r.histogram,
    byAssignment: r.byAssignment,
    matchups: r.matchups,
  })),
  pairedMeanWinDifference: pairedDifference / count,
};
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(
  JSON.stringify(
    report.fields.map((f) => ({
      version: f.version,
      meanWins: f.meanWins,
      undefeated: f.undefeated,
      confidence95: f.confidence95,
    })),
  ),
);
