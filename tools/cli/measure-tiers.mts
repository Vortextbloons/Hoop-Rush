import { readFileSync } from 'node:fs';
import { seasonDraftCatalogSchema } from '@hoop-rush/data-contracts';
import {
  evaluateSeasonRoster,
  rolePercentileThresholds,
  percentileTierOf,
  playerPercentileTier,
} from '@hoop-rush/engine';

const catalog = seasonDraftCatalogSchema.parse(
  JSON.parse(readFileSync('../../apps/web/static/data/season/draft-catalog.json', 'utf8')),
);
const candidates = [...catalog.candidates].sort((a, b) =>
  a.playerVersionId < b.playerVersionId ? -1 : 1,
);
const scores = candidates.map(
  (c) =>
    evaluateSeasonRoster({
      franchiseId: c.playerVersionId,
      band: 'average',
      identity: 'continuity',
      members: [{ detailedRatings: c.detailedRatings, tendencies: c.tendencies }],
    }).roleScores,
);
const thresholds = rolePercentileThresholds(scores);
console.log('thresholds:', JSON.stringify(thresholds));

const tiers = candidates.map((c, i) =>
  playerPercentileTier(percentileTierOf(scores[i], thresholds)),
);
const count = (t: string) => tiers.filter((x) => x === t).length;
console.log(
  'tier counts:',
  'elite',
  count('elite'),
  'strong',
  count('strong'),
  'useful',
  count('useful'),
  'depth',
  count('depth'),
);
console.log('eligible (non-elite):', count('strong') + count('useful') + count('depth'));

// depth-tier trait analysis
const roles = [
  'primary-creation',
  'secondary-creation',
  'perimeter-shooting',
  'rim-finishing-interior-scoring',
  'perimeter-defense',
  'interior-defense',
  'offensive-rebounding',
  'defensive-rebounding',
];
const depthInfo: Array<{
  maxScore: number;
  durability: number;
  stamina: number;
  versatile: boolean;
}> = [];
for (let i = 0; i < candidates.length; i++) {
  if (tiers[i] !== 'depth') continue;
  const c = candidates[i];
  const maxScore = Math.max(...roles.map((r) => scores[i][r]));
  const versatile =
    new Set(['G', 'F', 'C'].filter((g) => c.positions.playable.includes(g))).size >= 2;
  depthInfo.push({
    maxScore,
    durability: c.durability.rating,
    stamina: c.stamina.rating,
    versatile,
  });
}
const pct = (arr: number[], p: number) =>
  arr[Math.min(arr.length - 1, Math.max(0, Math.floor(p * arr.length)))];
const maxScores = depthInfo.map((d) => d.maxScore).sort((a, b) => a - b);
const durs = depthInfo.map((d) => d.durability).sort((a, b) => a - b);
const stas = depthInfo.map((d) => d.stamina).sort((a, b) => a - b);
console.log('depth n:', depthInfo.length);
console.log(
  'depth maxScore p10/p25/p50/p75:',
  pct(maxScores, 0.1),
  pct(maxScores, 0.25),
  pct(maxScores, 0.5),
  pct(maxScores, 0.75),
);
console.log(
  'depth durability p10/p25/p50/p75:',
  pct(durs, 0.1),
  pct(durs, 0.25),
  pct(durs, 0.5),
  pct(durs, 0.75),
);
console.log(
  'depth stamina p10/p25/p50/p75:',
  pct(stas, 0.1),
  pct(stas, 0.25),
  pct(stas, 0.5),
  pct(stas, 0.75),
);
console.log('depth versatile:', depthInfo.filter((d) => d.versatile).length);
for (const [label, fn] of [
  ['maxScore>=50', (d: { maxScore: number }) => d.maxScore >= 50],
  ['maxScore>=48', (d: { maxScore: number }) => d.maxScore >= 48],
  ['maxScore>=45', (d: { maxScore: number }) => d.maxScore >= 45],
] as const) {
  const dev = depthInfo.filter(fn).length;
  console.log('development via', label, ':', dev, '-> emergency:', depthInfo.length - dev);
}
// durable-only split (durability < 60 = availability-risk floor)
console.log(
  'depth durability<70:',
  depthInfo.filter((d) => d.durability < 70).length,
  'stamina<55:',
  depthInfo.filter((d) => d.stamina < 55).length,
);

// strong-tier candidates: how many have >= 2 roles >= p75 (featured 3-influence candidates)
let featuredStrongMulti = 0;
let featuredStrong = 0;
for (let i = 0; i < candidates.length; i++) {
  if (tiers[i] !== 'strong') continue;
  featuredStrong++;
  let n = 0;
  for (const r of roles) if (scores[i][r] >= thresholds[r].strong) n++;
  if (n >= 2) featuredStrongMulti++;
}
console.log('featured (strong):', featuredStrong, 'of which multi-strong:', featuredStrongMulti);

// role tier useful
let roleUseful = 0;
let roleMulti = 0;
for (let i = 0; i < candidates.length; i++) {
  if (tiers[i] !== 'useful') continue;
  roleUseful++;
  let n = 0;
  for (const r of roles) if (scores[i][r] >= thresholds[r].useful) n++;
  if (n >= 2) roleMulti++;
}
console.log('role (useful):', roleUseful, 'multi-useful:', roleMulti);

// sanity: playerVersionId sorted ascending already?
let sorted = true;
for (let i = 1; i < candidates.length; i++)
  if (candidates[i].playerVersionId < candidates[i - 1].playerVersionId) sorted = false;
console.log('catalog candidates already canonically sorted:', sorted);
