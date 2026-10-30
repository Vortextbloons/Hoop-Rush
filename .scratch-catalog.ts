import { readFileSync } from 'node:fs';
const c = JSON.parse(readFileSync('apps/web/static/data/draft-catalog.json', 'utf8'));
console.log(
  'candidates',
  c.candidates.length,
  'with profile',
  c.candidates.filter((x: any) => x.playoffPerformance).length,
);
const lbj = c.candidates.find(
  (x: any) => x.displayName.includes('LeBron') && x.seasonKey === '2017-18',
);
console.log(
  lbj
    ? JSON.stringify({
        name: lbj.displayName,
        season: lbj.seasonKey,
        has: !!lbj.playoffPerformance,
      })
    : 'not found',
);
