const fs = require("fs");
const b = JSON.parse(fs.readFileSync("apps/web/static/data/opponents/bracket.json","utf8"));
const rows = b.opponents.map(o=>({team:o.displayName, wr:o.strength.winRate}));
rows.sort((a,b)=>b.wr-a.wr);
let bad = 0;
for (const o of b.opponents) {
  const bySlot = [...o.lineup.assignments].sort((x,y)=>x.slotIndex-y.slotIndex);
  const parts = bySlot.map((a,i)=>{
    const p = o.players.find(pp=>pp.playerId===a.playerId);
    const slot = ["PG","SG","SF","PF","C"][a.slotIndex];
    const natural = p.positions.includes(slot);
    if(!natural) bad++;
    return `${slot}:${p.displayName}${natural?"":"*"}`;
  });
  console.log(parts.join(" | "));
}
console.log("\nnon-natural slot assignments:", bad);
