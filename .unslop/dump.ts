import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
const out: string[] = [];
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
    if (!/[—–]/.test(line)) return;
    out.push(`${rel}\t${i + 1}\t${line}`);
  });
}
writeFileSync('.unslop/all-dashes.tsv', out.join('\n'), 'utf8');
console.log(out.length);
