import { readdirSync, readFileSync } from "node:fs";
const dir = "apps/web/static/data/pools";
const rows: any[] = [];
for (const f of readdirSync(dir)) {
  const pool = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
  for (const p of pool.players) if (p.playoffPerformance) rows.push(p.playoffPerformance);
}
const q = (vals: number[]) => { const s=[...vals].sort((a,b)=>a-b); const at=(p:number)=>s[Math.min(s.length-1, Math.max(0, Math.round(p*(s.length-1))))]; return {p05:at(0.05),p25:at(0.25),p50:at(0.5),p75:at(0.75),p95:at(0.95),min:s[0],max:s.at(-1)}; };
console.log("profiles", rows.length);
for (const key of ["tsPct","pointsPer36","assistsPer36","reboundsPer36","turnoversPer36"]) {
  const vals = rows.map((r) => r.differences[key]).filter((v) => typeof v === "number");
  console.log(key, vals.length, q(vals));
}
console.log("games", q(rows.map(r=>r.playoffs.gamesPlayed)));
console.log("minutes", q(rows.map(r=>r.playoffs.minutes)));
console.log("mpg", q(rows.map(r=>r.playoffs.minutes/Math.max(1,r.playoffs.gamesPlayed))));
console.log("regularMPG", q(rows.map(r=>r.regularSeason.minutes/Math.max(1,r.regularSeason.gamesPlayed))));
console.log("nullTurnovers", rows.filter(r=>r.differences.turnoversPer36===null).length);
