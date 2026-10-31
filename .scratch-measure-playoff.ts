import { readFileSync } from 'node:fs';
import { parseSeasonDraftCatalog } from './packages/data-contracts/src/loaders/draft-catalog.ts';
import {
  capRushPlayoffGameSeed,
  eraSimulationProfileSchema,
  opponentBracketSchema,
} from './packages/data-contracts/src/index.ts';
import {
  adaptCapRushCatalog,
  buildCapRushCatalogIndex,
} from './packages/engine/src/modes/cap-rush/catalog.ts';
import { buildCapRushHistoricalField } from './packages/engine/src/modes/cap-rush/historical-field.ts';
import { buildCapRushLockedInputs } from './packages/engine/src/modes/cap-rush/lock.ts';
import { capRushPlayoffTeam } from './packages/engine/src/modes/cap-rush/playoff.ts';
import { simulateCapRushPlayoffGame } from './packages/engine/src/modes/cap-rush/playoff-sim.ts';
import { createEngineContext } from './packages/engine/src/sim/kernel.ts';

const catalog = parseSeasonDraftCatalog(
  JSON.parse(readFileSync('apps/web/static/data/draft-catalog.json', 'utf8')),
);
const source = {
  catalogVersion: catalog.catalogVersion,
  catalogHash: 'a'.repeat(64),
  dataVersion: catalog.dataVersion,
  ratingsVersion: catalog.ratingsVersion,
  playerVersionIdVersion: catalog.playerVersionIdVersion,
  positionNormalizationVersion: catalog.positionNormalizationVersion,
};
const index = buildCapRushCatalogIndex(adaptCapRushCatalog(catalog, source));
const profile = eraSimulationProfileSchema.parse(
  JSON.parse(readFileSync('apps/web/static/data/era-sim/2010s.json', 'utf8')),
);
const baseBracket = opponentBracketSchema.parse(
  JSON.parse(readFileSync('apps/web/static/data/opponents/bracket.json', 'utf8')),
);

const slots = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
const used = new Set<string>();
const picks = slots.map((slot, ordinal) => {
  const pool = index.bySlot.get(slot)!;
  const candidate = [...pool]
    .filter((p) => p.eraId === '2010s' && !used.has(p.playerVersionId))
    .sort((a, b) => b.originalOverall - a.originalOverall)[0];
  if (candidate === undefined) throw new Error(`no ${slot}`);
  used.add(candidate.playerVersionId);
  return {
    pickOrdinal: ordinal,
    slot,
    card: {
      cardId: `crc-${String(ordinal).padStart(32, '0')}`,
      offerId: 'cro-00000000000000000000000000000000',
      cardIndex: ordinal,
      slot,
      bucket: 'elite' as const,
      source: candidate,
      salaryDollars: 1_000_000,
    },
  };
});

const runSeed = 'abc123def4567890' as never;
const field = buildCapRushHistoricalField(baseBracket, catalog, runSeed);
const profiles = new Map(
  catalog.candidates.flatMap((c) =>
    c.playoffPerformance === undefined
      ? []
      : ([[c.playerVersionId, c.playoffPerformance]] as const),
  ),
);
const locked = buildCapRushLockedInputs({
  runId: 'run-measure-01',
  runSeed,
  variant: 'clash',
  versionSet: {
    schemaVersion: 1,
    rulesVersion: 'cap-rush-rules-v3',
    salaryCurveVersion: 'cap-rush-salary-v3',
    seedDerivationVersion: 'cap-rush-seeds-v1',
    engineVersion: 'm3-engine-v25',
    profileVersion: profile.profileVersion,
    dataVersion: catalog.dataVersion,
    catalogVersion: catalog.catalogVersion,
    catalogHash: source.catalogHash,
    bracketHash: 'b'.repeat(64),
    profileHash: 'c'.repeat(64),
  } as never,
  catalog: source,
  picks: picks as never,
  spin: null,
  bracket: field,
  profile,
  playoffProfiles: profiles,
});

const rows = locked.playoffPerformance?.players ?? [];
console.log('field teams', locked.opponents.length + 1, 'pinned rows', rows.length);
let coveredStarters = 0;
let totalStarters = 0;
for (const team of [locked.human, ...locked.opponents.map((o) => o.team)]) {
  for (const starter of team.starters) {
    totalStarters += 1;
    if (rows.some((r) => r.playerVersionId === starter.source.playerVersionId)) {
      coveredStarters += 1;
    }
  }
}
console.log('starters with rows', coveredStarters, '/', totalStarters);

const weights = [...rows.map((r) => r.weight)].sort((a, b) => a - b);
const pct = (q: number) => weights[Math.min(weights.length - 1, Math.floor(weights.length * q))];
console.log('weight p10/p50/p90', pct(0.1)?.toFixed(2), pct(0.5)?.toFixed(2), pct(0.9)?.toFixed(2));

const appliedSummary = rows.reduce(
  (acc, r) => {
    const a = r.applied;
    if (a.fieldGoalPct > 0) acc.fgUp += 1;
    if (a.fieldGoalPct < 0) acc.fgDown += 1;
    if (a.fieldGoalPct === 0) acc.fgFlat += 1;
    if (Math.abs(r.observed.tsPct ?? 0) >= 0.02) acc.tsSig += 1;
    return acc;
  },
  { fgUp: 0, fgDown: 0, fgFlat: 0, tsSig: 0 },
);
console.log('applied fg direction', appliedSummary);
const fgValues = rows.map((r) => Math.abs(r.applied.fieldGoalPct * 100)).sort((a, b) => a - b);
console.log(
  'applied fg |pp| p50/p90/max',
  fgValues[Math.floor(fgValues.length * 0.5)]?.toFixed(2),
  fgValues[Math.floor(fgValues.length * 0.9)]?.toFixed(2),
  fgValues.at(-1)?.toFixed(2),
);

// How much of the observed difference survives the mapping?
const survived = rows
  .filter((r) => (r.observed.tsPct ?? 0) !== 0)
  .map((r) => (r.applied.fieldGoalPct * 100) / ((r.observed.tsPct ?? 0) * 100));
console.log(
  'ts survival ratio p50',
  survived.sort((a, b) => a - b)[Math.floor(survived.length / 2)]?.toFixed(2),
);

const humanAdjusted = capRushPlayoffTeam({ team: locked.human, performance: locked.playoffPerformance });
const changed = humanAdjusted.starters.filter((s, i) => s !== locked.human.starters[i]);
console.log('human starters changed', changed.length);

const context = createEngineContext();
function run(input: typeof locked, count: number) {
  let points = 0;
  let homeWins = 0;
  for (let index = 1; index <= count; index += 1) {
    const plan = {
      seriesId: 'crs-4-0',
      round: 4 as const,
      seriesSlot: 0,
      gameOrdinal: ((index - 1) % 7) + 1,
      homeTeamId: input.human.teamId,
      awayTeamId: input.opponents[0]!.team.teamId,
      homeSeed: 1,
      awaySeed: 2,
      userSide: 'home' as const,
      isFinals: true,
      seed: capRushPlayoffGameSeed(input.runSeed, ((index % 4) + 1) as never, 0, ((index - 1) % 7) + 1),
    };
    const sim = simulateCapRushPlayoffGame({ locked: input, plan: plan as never, context });
    if (!sim.game.audit.ok) throw new Error('audit failed');
    points += sim.game.summary.homePoints + sim.game.summary.awayPoints;
    if (sim.game.summary.winnerTeamId === input.human.teamId) homeWins += 1;
  }
  return { pointsPerGame: points / count, winRate: homeWins / count };
}

const N = 120;
const plain = { ...locked, playoffPerformance: undefined };
const base = run(plain, N);
const adj = run(locked, N);
console.log('baseline', base);
console.log('adjusted', adj);
console.log('delta', {
  points: +(adj.pointsPerGame - base.pointsPerGame).toFixed(2),
  winRate: +(adj.winRate - base.winRate).toFixed(3),
});
