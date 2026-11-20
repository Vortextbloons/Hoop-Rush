import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
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
(function walk(d: string) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) {
      if (!skip.has(e.name)) walk(p);
    } else if (/\.mdx?$/.test(e.name)) files.push(p);
  }
})(root);
let n = 0;
for (const f of files) {
  const rel = relative(root, f);
  const target = join(root, '.unslop', 'base', rel);
  if (!existsSync(dirname(target))) mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, readFileSync(f));
  n++;
}
console.log('baselined', n);
