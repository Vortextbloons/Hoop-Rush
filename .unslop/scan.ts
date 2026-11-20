import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const skipDirs = new Set([
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
]);
const files: string[] = [];
function walk(dir: string) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') && e.name !== '.') {
      if (
        [
          'node_modules',
          '.git',
          '.pnpm-store',
          '.raw_nba_cache',
          '.perf-cap-rush',
          '.svelte-kit',
          '.unslop',
          '.husky',
          '.github-ignore',
          '.vscode',
        ].includes(e.name)
      )
        continue;
    }
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!skipDirs.has(e.name)) walk(p);
    } else if (e.name.endsWith('.md') || e.name.endsWith('.mdx')) files.push(p);
  }
}
walk(root);

let stats = { spaced: 0, tight: 0, enDashSpaced: 0, curly: 0, inFence: 0, files: 0 };
const perFile: Record<string, number> = {};
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  const lines = text.split('\n');
  let inFence = false;
  let n = 0;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    const m1 = line.match(/ — /g)?.length ?? 0;
    const m2 = (line.match(/—/g)?.length ?? 0) - m1;
    const m3 = line.match(/ – /g)?.length ?? 0;
    const m4 = line.match(/[“”‘’]/g)?.length ?? 0;
    if (inFence) {
      stats.inFence += m1 + m2 + m3 + m4;
      continue;
    }
    stats.spaced += m1;
    stats.tight += m2;
    stats.enDashSpaced += m3;
    stats.curly += m4;
    n += m1 + m2 + m3 + m4;
  }
  if (n) {
    perFile[relative(root, f)] = n;
    stats.files++;
  }
}
console.log(JSON.stringify(stats, null, 2));
console.log('TOTAL FILES:', files.length);
