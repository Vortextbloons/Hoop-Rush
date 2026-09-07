import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  FIXED_SANDBOX_ERA,
  LINEUP_STRUCTURE,
  type ChallengeCreation,
} from '@hoop-rush/data-contracts';
import {
  createEngineContext,
  simulateChallengeBestOf,
  toSimulationPlayer,
} from '@hoop-rush/engine';
import { loadPackagedData, PackagedData, REPO_ROOT } from './commands/data-loader.ts';
import { resolvePoolLineup } from './commands/challenge.ts';

const SEED = 'abcdefabcdefabcdefabcdefabcdef';
const RERUNS = 100;

const LINEUPS: Array<{ id: string; label: string; spec: string }> = [
  {
    id: 'A',
    label: 'Balanced elite baseline',
    spec:
      'Stephen Curry@Golden State Warriors/2010s,Michael Jordan@Chicago Bulls/1980s,LeBron James@Miami Heat/2010s,Tim Duncan@San Antonio Spurs/2000s,Nikola Jokić@Denver Nuggets/2020s',
  },
  {
    id: 'B',
    label: 'Maximum offense / spacing',
    spec:
      'Stephen Curry@Golden State Warriors/2010s,James Harden@Houston Rockets/2010s,Kevin Durant@Golden State Warriors/2010s,Dirk Nowitzki@Dallas Mavericks/2000s,Nikola Jokić@Denver Nuggets/2020s',
  },
  {
    id: 'C',
    label: 'Maximum defense',
    spec:
      'Gary Payton@Oklahoma City Thunder/1990s,Michael Jordan@Chicago Bulls/1980s,Kawhi Leonard@San Antonio Spurs/2010s,Tim Duncan@San Antonio Spurs/2000s,Hakeem Olajuwon@Houston Rockets/1990s',
  },
  {
    id: 'D1',
    label: 'Weak POA defense',
    spec:
      'Trae Young@Atlanta Hawks/2020s,Michael Jordan@Chicago Bulls/1980s,LeBron James@Miami Heat/2010s,Tim Duncan@San Antonio Spurs/2000s,Nikola Jokić@Denver Nuggets/2020s',
  },
  {
    id: 'D2',
    label: 'Strong POA defense',
    spec:
      'Gary Payton@Oklahoma City Thunder/1990s,Michael Jordan@Chicago Bulls/1980s,LeBron James@Miami Heat/2010s,Tim Duncan@San Antonio Spurs/2000s,Nikola Jokić@Denver Nuggets/2020s',
  },
  {
    id: 'E1',
    label: 'Weak wing defense',
    spec:
      'Stephen Curry@Golden State Warriors/2010s,Michael Jordan@Chicago Bulls/1980s,Carmelo Anthony@New York Knicks/2010s,Tim Duncan@San Antonio Spurs/2000s,Nikola Jokić@Denver Nuggets/2020s',
  },
  {
    id: 'E2',
    label: 'Strong wing defense',
    spec:
      'Stephen Curry@Golden State Warriors/2010s,Michael Jordan@Chicago Bulls/1980s,Kawhi Leonard@San Antonio Spurs/2010s,Tim Duncan@San Antonio Spurs/2000s,Nikola Jokić@Denver Nuggets/2020s',
  },
  {
    id: 'F1',
    label: 'Weak-ish interior defense / spacing PF',
    spec:
      'Stephen Curry@Golden State Warriors/2010s,Michael Jordan@Chicago Bulls/1980s,LeBron James@Miami Heat/2010s,Dirk Nowitzki@Dallas Mavericks/2000s,Nikola Jokić@Denver Nuggets/2020s',
  },
  {
    id: 'F2',
    label: 'Elite rim protector',
    spec:
      'Stephen Curry@Golden State Warriors/2010s,Michael Jordan@Chicago Bulls/1980s,LeBron James@Miami Heat/2010s,Dirk Nowitzki@Dallas Mavericks/2000s,Hakeem Olajuwon@Houston Rockets/1990s',
  },
  {
    id: 'G1',
    label: 'Weak rebounding/defensive PF context',
    spec:
      'Stephen Curry@Golden State Warriors/2010s,Michael Jordan@Chicago Bulls/1980s,LeBron James@Miami Heat/2010s,Dirk Nowitzki@Dallas Mavericks/2000s,Nikola Jokić@Denver Nuggets/2020s',
  },
  {
    id: 'G2',
    label: 'Elite glass / PF defense',
    spec:
      'Stephen Curry@Golden State Warriors/2010s,Michael Jordan@Chicago Bulls/1980s,LeBron James@Miami Heat/2010s,Dennis Rodman@Detroit Pistons/1990s,Nikola Jokić@Denver Nuggets/2020s',
  },
  {
    id: 'H',
    label: 'Offensive talent with bad team defense',
    spec:
      'Trae Young@Atlanta Hawks/2020s,James Harden@Houston Rockets/2010s,Carmelo Anthony@New York Knicks/2010s,Dirk Nowitzki@Dallas Mavericks/2000s,Nikola Jokić@Denver Nuggets/2020s',
  },
];

function avg(value: number, games: number): number {
  return games > 0 ? value / games : 0;
}

function pct(made: number, attempted: number): string {
  return attempted > 0 ? `${((made / attempted) * 100).toFixed(1)}%` : '-';
}

function runLineup(
  lineup: (typeof LINEUPS)[number],
  data: PackagedData,
  context: ReturnType<typeof createEngineContext>,
) {
  const eraId = FIXED_SANDBOX_ERA;
  const profile = data.eraProfile(eraId);
  const bracket = data.bracket();
  const resolved = resolvePoolLineup(lineup.spec, data);
  const players = resolved.map((player) => toSimulationPlayer(player));
  const sample = resolved[0];
  const creation: ChallengeCreation = {
    runId: `benchmark-${lineup.id}-${SEED.slice(0, 8)}`,
    mode: 'sandbox',
    franchiseId: null,
    eraId,
    homeDisplayName: resolved.map((player) => player.displayName).join(' · ').slice(0, 96),
    lineup: {
      structure: [...LINEUP_STRUCTURE],
      assignments: resolved.map((player, slotIndex) => ({
        slotIndex: slotIndex as 0 | 1 | 2 | 3 | 4,
        playerId: player.playerId,
        positions: player.positions.playable,
      })),
    },
    players,
    selections: resolved.map((player) => ({
      playerId: player.playerId,
      franchiseId: player.franchiseId,
      eraId: player.eraId,
    })),
    runSeed: SEED,
    dataVersion: profile.dataVersion,
    ratingVersion: sample?.source.ratingsVersion ?? 'unknown',
    positionNormalizationVersion: sample?.positions.normalizationVersion ?? 'position-v1',
    engineVersion: context.engineVersion,
    profile,
    bracket,
  };
  const started = performance.now();
  const run = simulateChallengeBestOf(creation, profile, context, RERUNS);
  const timingMs = performance.now() - started;
  const displayName = new Map(run.players.map((player) => [player.playerId, player.displayName]));
  const roster = resolved
    .map((player) => `${player.displayName} (${player.seasonKey})`)
    .join(' · ');
  let differential = 0;
  for (const game of run.games) {
    differential += game.home.box.points - game.away.box.points;
  }
  return {
    lineup,
    roster,
    timingMs,
    run,
    displayName,
    differential,
  };
}

function playerTable(
  run: ReturnType<typeof runLineup>['run'],
  displayName: Map<string, string>,
): string {
  const lines = [
    '| Player | GP | MIN | PTS | REB | AST | STL | BLK | TOV | FG | 3P | FT |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const player of run.aggregates.players) {
    const name = displayName.get(player.playerId) ?? player.playerId;
    const games = player.gamesPlayed;
    lines.push(
      `| ${name} | ${games} | ${avg(player.minutes, games).toFixed(1)} | ${avg(player.points, games).toFixed(1)} | ${avg(player.rebounds.total, games).toFixed(1)} | ${avg(player.assists, games).toFixed(1)} | ${avg(player.steals, games).toFixed(1)} | ${avg(player.blocks, games).toFixed(1)} | ${avg(player.turnovers, games).toFixed(1)} | ${pct(player.fieldGoals.made, player.fieldGoals.attempted)} | ${pct(player.threes.made, player.threes.attempted)} | ${pct(player.freeThrows.made, player.freeThrows.attempted)} |`,
    );
  }
  return lines.join('\n');
}

const packaged = loadPackagedData();
const data = new PackagedData(packaged.manifest, packaged.dir);
const context = createEngineContext();
const results: ReturnType<typeof runLineup>[] = [];

for (const lineup of LINEUPS) {
  console.log(`Running lineup ${lineup.id} (${String(RERUNS)} reruns)...`);
  results.push(runLineup(lineup, data, context));
  const last = results[results.length - 1];
  console.log(
    `  ${last.run.aggregates.team.wins}-${last.run.aggregates.team.losses} (${(last.timingMs / 1000).toFixed(1)}s)`,
  );
}

const summaryRows = results
  .map((result) => {
    const { wins, losses } = result.run.aggregates.team;
    return `| ${result.lineup.id} | ${result.lineup.label} | ${wins}-${losses} | ${result.differential > 0 ? '+' : ''}${result.differential} | ${result.run.outcome ?? 'eliminated'} | ${(result.timingMs / 1000).toFixed(1)}s |`;
  })
  .join('\n');

const sections = results
  .map((result) => {
    const { wins, losses, gamesPlayed } = result.run.aggregates.team;
    return `## ${result.lineup.id} — ${result.lineup.label}

**Roster:** ${result.roster}

| Setting | Value |
| --- | --- |
| Seed | \`${SEED}\` |
| Reruns | ${RERUNS} (best-of) |
| Chosen seed | \`${result.run.runSeed}\` |
| Record | **${wins}-${losses}** (${gamesPlayed} GP) |
| Point differential | ${result.differential > 0 ? '+' : ''}${result.differential} |
| Outcome | ${result.run.outcome ?? 'eliminated'} |
| First loss (game #) | ${result.run.firstLossGameNumber ?? '—'} |
| Runtime | ${(result.timingMs / 1000).toFixed(1)}s |

${playerTable(result.run, result.displayName)}
`;
  })
  .join('\n');

const markdown = `# Lineup Challenge Benchmark (Best-of-${RERUNS})

Generated: ${new Date().toISOString()}

Each lineup ran **${RERUNS}** full 82-game challenge attempts with base seed \`${SEED}\`. The best result by wins, then point differential, is reported below.

## Summary

| ID | Test | Record | Diff | Outcome | Runtime |
| --- | --- | ---: | ---: | --- | ---: |
${summaryRows}

${sections}
`;

const outPath = resolve(REPO_ROOT, 'Docs/lineup-challenge-benchmark.md');
writeFileSync(outPath, markdown);
console.log(`\nWrote ${outPath}`);
