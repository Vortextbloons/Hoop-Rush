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
const groups: Record<string, { files: number; dashes: number; words: number }> = {};
for (const f of files) {
  const rel = relative(root, f).replace(/\\/g, '/');
  if (rel.includes('combined.md') || rel.startsWith('Docs/archive/')) continue;
  const text = readFileSync(f, 'utf8');
  const key = rel.startsWith('spec/')
    ? 'spec'
    : rel.startsWith('Docs/')
      ? 'Docs'
      : rel.startsWith('apps/')
        ? 'apps'
        : rel.startsWith('packages/')
          ? 'packages'
          : 'root+misc';
  const g = (groups[key] ??= { files: 0, dashes: 0, words: 0 });
  g.files++;
  g.dashes += text.match(/[—–]/g)?.length ?? 0;
  g.words += text.split(/\s+/).length;
}
console.table(groups);
const total = Object.values(groups).reduce(
  (a, b) => ({ files: a.files + b.files, dashes: a.dashes + b.dashes, words: a.words + b.words }),
  { files: 0, dashes: 0, words: 0 },
);
console.log(total);
