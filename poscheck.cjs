const fs=require("fs");
const d="raw-data/nba";
const names=["Richard Jefferson","JJ Redick","Bam Adebayo","Ziaire Williams","Dennis Smith","Andray Blatche","Jerome Jordan","Shane Heal","Fred Hoiberg","Anthony Bennett"];
const seen=new Map();
for(const s of fs.readdirSync(d).filter(x=>/^\d{4}-\d{2}$/.test(x))){
  let ro; try{ro=JSON.parse(fs.readFileSync(`${d}/${s}/roster.json`,"utf8"));}catch{continue;}
  for(const p of ro){
    const n=`${p.firstName} ${p.lastName}`.trim();
    if(!names.includes(n))continue;
    const k=n;
    if(!seen.has(k))seen.set(k,[]);
    seen.get(k).push(`${s}:${p.position}${p.secondaryPositions&&p.secondaryPositions.length?"/"+p.secondaryPositions.join(","):""}`);
  }
}
for(const [n,v] of seen){ console.log(n, "=>", v.slice(0,8).join("  ")); }
