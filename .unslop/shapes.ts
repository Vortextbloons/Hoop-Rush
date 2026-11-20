import { readFileSync } from 'node:fs';
const rows = readFileSync('.unslop/all-dashes.tsv', 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => {
    const [f, n, t] = l.split('\t');
    return { f, n: +n, t };
  });
const shapes = new Map<string, number>();
for (const r of rows) {
  const t = r.t;
  let s = 'sentence';
  if (/^#{1,6}\s/.test(t)) s = 'heading';
  else if (/^\s*[-*]\s+`[^`]+`\s*—/.test(t)) s = 'bullet-code-label';
  else if (/^\s*[-*]\s+\*\*[^*]+\*\*\s*—/.test(t)) s = 'bullet-bold-label';
  else if (/^\s*[-*]\s+\[[^\]]+\]\([^)]+\)\s*—/.test(t)) s = 'bullet-link-label';
  else if (/^\s*[-*]\s/.test(t)) s = 'bullet-other';
  else if (/^\s*\|/.test(t)) s = 'table';
  else if (/^\s*>/.test(t)) s = 'blockquote';
  shapes.set(s, (shapes.get(s) ?? 0) + 1);
}
console.log([...shapes].sort((a, b) => b[1] - a[1]));
