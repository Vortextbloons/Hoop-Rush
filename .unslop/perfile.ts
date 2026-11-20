import { readFileSync } from 'node:fs';
const rows = readFileSync('.unslop/all-dashes.tsv', 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => {
    const [f, n, t] = l.split('\t');
    return { f, n: +n, t };
  });
const per = new Map<string, { count: number; curly: number }>();
for (const r of rows) {
  const e = per.get(r.f) ?? { count: 0, curly: 0 };
  e.count++;
  e.curly += /[“”‘’]/.test(r.t) ? 1 : 0;
  per.set(r.f, e);
}
const arr = [...per].sort((a, b) => b[1].count - a[1].count);
console.log('files with dashes:', arr.length, 'total lines:', rows.length);
for (const [f, e] of arr) console.log(`${String(e.count).padStart(4)}  ${f}`);
