import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
const root = process.cwd();
const skip = new Set([
  'node_modules',
  '.git',
  '.pnpm-store',
  '.raw_nba_cache',
  'work',
  '.perf-cap-rush',
  'build',
  'dist',
  '.svelte-kit',
  '.unslop',
  'coverage',
  'raw-data',
  'data',
  '.husky',
  '.vscode',
]);
const files: string[] = [];
(function walk(dir: string) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!skip.has(e.name)) walk(p);
    } else if (/\.mdx?$/.test(e.name)) files.push(p);
  }
})(root);
let inCode = 0,
  inLink = 0;
const samples: string[] = [];
for (const f of files) {
  const rel = relative(root, f).replace(/\\/g, '/');
  if (rel.endsWith('combined.md') || rel.startsWith('Docs/archive/')) continue;
  const lines = readFileSync(f, 'utf8').split('\n');
  let fence = false;
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      return;
    }
    if (fence) return;
    for (const m of line.matchAll(/`[^`]*`/g))
      if (/[—–]/.test(m[0])) {
        inCode++;
        if (samples.length < 15) samples.push(`${rel}:${i + 1}: ${m[0]}`);
      }
    for (const m of line.matchAll(/\]\([^)]*\)/g))
      if (/[—–]/.test(m[0])) {
        inLink++;
        if (samples.length < 25) samples.push(`${rel}:${i + 1}: ${m[0]}`);
      }
  });
}
console.log('in code spans:', inCode, 'in link targets:', inLink);
samples.forEach((s) => console.log(s));
