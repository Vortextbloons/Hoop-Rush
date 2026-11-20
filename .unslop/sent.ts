import { readFileSync } from 'node:fs';
const rows = readFileSync('.unslop/all-dashes.tsv', 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => {
    const [f, n, t] = l.split('\t');
    return { f, n: +n, t };
  });
const sentences = rows.filter(
  (r) =>
    !/^#{1,6}\s/.test(r.t) && !/^\s*[-*]\s/.test(r.t) && !/^\s*\|/.test(r.t) && !/^\s*>/.test(r.t),
);
// classify clause after first dash
const cats = new Map<string, string[]>();
for (const r of sentences) {
  const after = r.t.split(' — ')[1] ?? '';
  let c = 'other';
  if (/^[A-Z]/.test(after)) c = 'cap-start';
  else c = 'lower-start';
  if (
    /\b(if|when|who|which|that|so|because|but|and|or|then|where|while|unless|until|it|this|they|you|we)\b/.test(
      after.split(/[,.;]/)[0] ?? '',
    )
  )
    c += '/clause';
  (cats.get(c) ?? cats.set(c, []).get(c)!).push(`${r.f}:${r.n}: ${r.t.trim().slice(0, 190)}`);
}
for (const [k, v] of [...cats].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n#### ${k} (${v.length})`);
  v.slice(0, 12).forEach((s) => console.log('  ' + s));
}
