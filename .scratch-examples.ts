import { readdirSync, readFileSync } from 'node:fs';
const dir = 'apps/web/static/data/pools';
const want = [
  'LeBron James',
  'Michael Jordan',
  'Stephen Curry',
  'Tim Duncan',
  'Draymond Green',
  'Russell Westbrook',
];
const out: any[] = [];
for (const f of readdirSync(dir)) {
  const pool = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));
  for (const p of pool.players) {
    if (!p.playoffPerformance) continue;
    if (!want.includes(p.displayName)) continue;
    const pp = p.playoffPerformance;
    const reg = pp.regularSeason,
      po = pp.playoffs;
    out.push({
      name: p.displayName,
      season: p.seasonKey,
      ovr: p.summaryRatings.overallRating,
      regG: reg.gamesPlayed,
      regMin: reg.minutes,
      regMpg: +(reg.minutes / reg.gamesPlayed).toFixed(1),
      regTs: reg.tsPct?.toFixed(4),
      poG: po.gamesPlayed,
      poMin: po.minutes,
      poMpg: +(po.minutes / po.gamesPlayed).toFixed(1),
      poTs: po.tsPct?.toFixed(4),
      d: {
        ts: pp.differences.tsPct?.toFixed(4),
        p36: pp.differences.pointsPer36?.toFixed(2),
        a36: pp.differences.assistsPer36?.toFixed(2),
        r36: pp.differences.reboundsPer36?.toFixed(2),
        to36: pp.differences.turnoversPer36?.toFixed(2),
      },
    });
  }
}
out.sort((a, b) => b.poMin - a.poMin);
for (const row of out.slice(0, 14)) console.log(JSON.stringify(row));
