import { readFileSync } from 'node:fs';
import { createEngineContext } from './packages/engine/src/sim/kernel.ts';
import {
  adaptCapRushCatalog,
  buildCapRushCatalogIndex,
} from './packages/engine/src/modes/cap-rush/catalog.ts';
import {
  capRushPlayoffPerformanceOf,
  capRushPlayoffTeam,
  capRushPlayoffSampleWeight,
  capRushPlayoffIsNeutral,
} from './packages/engine/src/modes/cap-rush/playoff.ts';
import { buildCapRushHumanTeam } from './packages/engine/src/modes/cap-rush/lock.ts';
import { capRushPayrollStatus } from './packages/engine/src/modes/cap-rush/salary.ts';
import { parseSeasonDraftCatalog } from './packages/data-contracts/src/loaders/draft-catalog.ts';

const raw = JSON.parse(readFileSync('apps/web/static/data/draft-catalog.json', 'utf8'));
const catalog = parseSeasonDraftCatalog(raw);
const index = buildCapRushCatalogIndex(
  adaptCapRushCatalog(catalog, {
    catalogVersion: catalog.catalogVersion,
    catalogHash: 'a'.repeat(64),
    dataVersion: catalog.dataVersion,
    ratingsVersion: catalog.ratingsVersion,
    playerVersionIdVersion: catalog.playerVersionIdVersion,
    positionNormalizationVersion: catalog.positionNormalizationVersion,
  }),
);

const profiles = new Map(
  catalog.candidates.flatMap((c) =>
    c.playoffPerformance === undefined ? [] : ([[c.playerVersionId, c.playoffPerformance]] as const),
  ),
);
console.log('catalog candidates', index.catalog.candidates.length, 'profiles', profiles.size);

const lebron = index.catalog.candidates.find(
  (c) => c.displayName.includes('LeBron') && c.seasonKey === '2017-18',
);
if (lebron === undefined) throw new Error('no LeBron 2017-18');
console.log('lebron', lebron.playerId, lebron.seasonKey, lebron.franchiseId, lebron.originalOverall);

// Build a roster containing LeBron at SF.
const slotPlayers = new Map<string, typeof lebron>();
slotPlayers.set('SF', lebron);
for (const slot of ['PG', 'SG', 'PF', 'C'] as const) {
  const player = index.bySlot.get(slot)!.find((c) => c.originalOverall <= 78);
  if (player === undefined) throw new Error(`no ${slot}`);
  slotPlayers.set(slot, player);
}
const cards = [...slotPlayers.entries()].map(([slot, player], ordinal) => ({
  pickOrdinal: ordinal,
  slot: slot as 'PG',
  card: {
    cardId: `crc-${String(ordinal).padStart(32, '0')}`,
    offerId: 'cro-00000000000000000000000000000000',
    cardIndex: ordinal,
    slot: slot as 'PG',
    bucket: 'strong' as const,
    source: player,
    salaryDollars: 4_000_000,
  },
}));
const picks = cards.sort(
  (a, b) =>
    ['PG', 'SG', 'SF', 'PF', 'C'].indexOf(a.slot) - ['PG', 'SG', 'SF', 'PF', 'C'].indexOf(b.slot),
);
const human = buildCapRushHumanTeam({
  runSeed: 'abc123def4567890',
  picks: picks as never,
  payrollStatus: capRushPayrollStatus(20_000_000),
  spin: null,
});

const performance = capRushPlayoffPerformanceOf({
  human,
  opponents: [],
  profileOf: (source) =>
    source.playerVersionId === null ? undefined : profiles.get(source.playerVersionId),
});
console.log('pinned rows', performance.players.length);

const lebronRow = performance.players.find((r) => r.playerVersionId === lebron.playerVersionId);
console.log('lebron row', JSON.stringify(lebronRow, null, 2));

const adjusted = capRushPlayoffTeam({ team: human, performance });
const baseSf = human.starters.find((s) => s.slot === 'SF')!;
const adjSf = adjusted.starters.find((s) => s.slot === 'SF')!;
console.log('base anchors', {
  fgPct: baseSf.source.profile.anchors?.fieldGoalPct,
  fga: baseSf.source.profile.anchors?.fieldGoalAttemptsPerGame,
  ast: baseSf.source.profile.anchors?.assistsPerGame,
  oreb: baseSf.source.profile.anchors?.offensiveReboundsPerGame,
  dreb: baseSf.source.profile.anchors?.defensiveReboundsPerGame,
  passRate: baseSf.source.profile.tendencies.passRate,
  turnoverRate: baseSf.source.profile.tendencies.turnoverRate,
});
console.log('adjusted anchors', {
  fgPct: adjSf.source.profile.anchors?.fieldGoalPct,
  fga: adjSf.source.profile.anchors?.fieldGoalAttemptsPerGame,
  ast: adjSf.source.profile.anchors?.assistsPerGame,
  oreb: adjSf.source.profile.anchors?.offensiveReboundsPerGame,
  dreb: adjSf.source.profile.anchors?.defensiveReboundsPerGame,
  passRate: adjSf.source.profile.tendencies.passRate,
  turnoverRate: adjSf.source.profile.tendencies.turnoverRate,
});
console.log(
  'base untouched',
  JSON.stringify(baseSf.source.profile.tendencies) ===
    JSON.stringify(human.starters.find((s) => s.slot === 'SF')!.source.profile.tendencies),
);

// A different season of LeBron must not pick up the 2017-18 evidence.
const otherLebron = index.catalog.candidates.find(
  (c) => c.displayName.includes('LeBron') && c.seasonKey !== '2017-18',
);
if (otherLebron !== undefined) {
  const otherRow = performance.players.find((r) => r.playerVersionId === otherLebron.playerVersionId);
  console.log('other LeBron season row present?', otherRow !== undefined, otherLebron.seasonKey);
}

// Distribution of actual applied deltas across the whole catalog.
let weighted = 0;
let neutral = 0;
let up = 0;
let down = 0;
const weights: number[] = [];
for (const candidate of index.catalog.candidates) {
  const profile = profiles.get(candidate.playerVersionId);
  if (profile === undefined) continue;
  const w = capRushPlayoffSampleWeight(profile.playoffs.minutes);
  weights.push(w);
  if (w > 0.05) weighted += 1;
}
weights.sort((a, b) => a - b);
console.log('profiles', weights.length, 'weight>0.05', weighted);
console.log('weight p10/p50/p90', weights[Math.floor(weights.length * 0.1)], weights[Math.floor(weights.length * 0.5)], weights[Math.floor(weights.length * 0.9)]);
void createEngineContext;
void neutral;
void up;
void down;
void capRushPlayoffIsNeutral;
