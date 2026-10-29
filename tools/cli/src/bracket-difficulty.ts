import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { ChallengeRun, OpponentBracket, SimulationPlayer } from '@hoop-rush/data-contracts';
import { seedFromString, seedSchema } from '@hoop-rush/data-contracts';
import {
  createChallenge,
  deriveAttemptSeed,
  createRng,
  shuffle,
  simulateChallenge,
  toSimulationPlayer,
} from '@hoop-rush/engine';
import { loadPackagedData, PackagedData } from './commands/data-loader.ts';
import { prepareChallenge } from './commands/challenge.ts';
import { highestOverallLineup } from './commands/draft-fit-benchmark.ts';

const packaged = loadPackagedData();
const data = new PackagedData(packaged.manifest, packaged.dir);
const setup = prepareChallenge({
  lineup:
    "Stephen Curry@warriors,Michael Jordan@bulls,LeBron James@cavaliers,Tim Duncan@spurs,Shaquille O'Neal@lakers",
  seed: '1234567890abcdef1234567890abcdef',
});
const probes: Array<{ kind: string; id: string; players: SimulationPlayer[]; attempts: number }> =
  [];
const refs = shuffle(packaged.manifest.pools, createRng('absolute-difficulty:pool-sample'))
  .filter((ref) => data.pool(ref.franchiseId, ref.eraId).players.length >= 10)
  .slice(0, 24);
for (const [index, ref] of refs.entries()) {
  const pool = data.pool(ref.franchiseId, ref.eraId);
  const rng = createRng(`absolute-difficulty:random:${String(index)}`);
  const randomized = pool.players.map((player) => ({
    ...player,
    summaryRatings: { ...player.summaryRatings, overallRating: rng.next() * 100 },
  }));
  for (const [kind, roster] of [
    ['random', highestOverallLineup(randomized)],
    ['strong', highestOverallLineup(pool.players)],
  ] as const) {
    if (!roster) throw new Error(`no legal lineup for ${ref.franchiseId}/${ref.eraId}`);
    probes.push({
      kind,
      id: `${ref.franchiseId}/${ref.eraId}`,
      players: roster.map(toSimulationPlayer),
      attempts: 20,
    });
  }
}
probes.push({
  kind: 'legendary',
  id: 'Curry Jordan LeBron Duncan Shaq',
  players: setup.creation.players,
  attempts: 1000,
});

interface Group {
  wins: number[];
  perfect: number;
  bestOfTwoPerfect: number;
  opponents: Record<string, { wins: number; games: number }>;
  rosters: Array<{ id: string; players: string[] }>;
}
function measure(bracket: OpponentBracket) {
  const groups = new Map<string, Group>();
  for (const [index, probe] of probes.entries()) {
    const group = groups.get(probe.kind) ?? {
      wins: [],
      perfect: 0,
      bestOfTwoPerfect: 0,
      opponents: {},
      rosters: [],
    };
    groups.set(probe.kind, group);
    group.rosters.push({
      id: probe.id,
      players: probe.players.map((player) => player.displayName),
    });
    let previousPerfect = false;
    for (let attempt = 0; attempt < probe.attempts; attempt += 1) {
      const run: ChallengeRun = simulateChallenge(
        createChallenge({
          ...setup.creation,
          players: probe.players,
          bracket,
          runSeed: deriveAttemptSeed(
            seedSchema.parse(seedFromString(`absolute-difficulty:seasons:${String(index)}`)),
            attempt,
          ),
          lineup: {
            structure: setup.creation.lineup.structure,
            assignments: probe.players.map((player, slotIndex) => ({
              slotIndex: slotIndex as 0 | 1 | 2 | 3 | 4,
              playerId: player.playerId,
              positions: player.positions,
            })),
          },
        }),
        setup.profile,
        setup.context,
      );
      const wins = run.aggregates.team.wins;
      group.wins.push(wins);
      if (wins === 82) group.perfect += 1;
      if (attempt % 2 === 1 && (previousPerfect || wins === 82)) group.bestOfTwoPerfect += 1;
      previousPerfect = wins === 82;
      for (const game of run.games) {
        const row = group.opponents[game.away.teamId] ?? { wins: 0, games: 0 };
        group.opponents[game.away.teamId] = row;
        row.games += 1;
        row.wins += Number(game.winner === 'home');
      }
    }
  }
  return {
    bracket: bracket.bracketVersion,
    bracketHash: createHash('sha256').update(JSON.stringify(bracket)).digest('hex'),
    engine: setup.context.engineVersion,
    profile: setup.profile.profileVersion,
    groups: Object.fromEntries(
      [...groups].map(([name, group]) => [
        name,
        {
          attempts: group.wins.length,
          meanWins: group.wins.reduce((sum, wins) => sum + wins, 0) / group.wins.length,
          minWins: Math.min(...group.wins),
          maxWins: Math.max(...group.wins),
          perfect: group.perfect,
          bestOfTwoPerfect: group.bestOfTwoPerfect,
          opponents: group.opponents,
          rosters: group.rosters,
        },
      ]),
    ),
  };
}
const baseline = process.argv[2];
if (baseline) {
  const { opponentBracketSchema } = await import('@hoop-rush/data-contracts');
  console.log(
    JSON.stringify(
      measure(opponentBracketSchema.parse(JSON.parse(readFileSync(baseline, 'utf8')))),
    ),
  );
}
console.log(JSON.stringify(measure(setup.creation.bracket)));
