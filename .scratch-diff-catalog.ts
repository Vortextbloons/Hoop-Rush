import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

type Candidate = {
  playerVersionId: string;
  playoffPerformance?: unknown;
  summaryRatings?: unknown;
} & Record<string, unknown>;

const oldText = execSync('git show HEAD:apps/web/static/data/draft-catalog.json', {
  maxBuffer: 1024 * 1024 * 300,
  encoding: 'utf8',
});
const oldCatalog = JSON.parse(oldText) as { candidates: Candidate[] };
const newCatalog = JSON.parse(
  readFileSync('apps/web/static/data/draft-catalog.json', 'utf8'),
) as { candidates: Candidate[] };

const oldById = new Map(oldCatalog.candidates.map((c) => [c.playerVersionId, c]));
const diffs: string[] = [];
let added = 0;
for (const candidate of newCatalog.candidates) {
  const before = oldById.get(candidate.playerVersionId);
  if (before === undefined) {
    diffs.push(`new candidate ${candidate.playerVersionId}`);
    continue;
  }
  if (candidate.playoffPerformance !== undefined) added += 1;
  const { playoffPerformance: _a, ...rest } = candidate;
  const { playoffPerformance: _b, ...oldRest } = before;
  if (JSON.stringify(rest) !== JSON.stringify(oldRest)) diffs.push(`drift ${candidate.playerVersionId}`);
}
const newIds = new Set(newCatalog.candidates.map((c) => c.playerVersionId));
const removed = oldCatalog.candidates.filter((c) => !newIds.has(c.playerVersionId));
console.log('old candidates', oldCatalog.candidates.length);
console.log('new candidates', newCatalog.candidates.length);
console.log('profiles added', added);
console.log('non-profile drift', diffs.length);
console.log('removed', removed.length);
if (diffs.length > 0) console.log(diffs.slice(0, 10));
