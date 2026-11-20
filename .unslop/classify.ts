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
const buckets: Record<string, string[]> = {
  bullet: [],
  bulletInlineCode: [],
  table: [],
  label: [],
  sentence: [],
  heading: [],
  other: [],
};
for (const f of files) {
  const rel = relative(root, f).replace(/\\/g, '/');
  if (rel.includes('combined.md') || rel.startsWith('Docs/archive/')) continue;
  const lines = readFileSync(f, 'utf8').split('\n');
  let fence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence || !line.includes(' — ')) continue;
    let key = 'other';
    if (/^\s*[-*]\s/.test(line))
      key = /^\s*[-*]\s+`[^`]+`\s+—/.test(line) ? 'bulletInlineCode' : 'bullet';
    else if (line.trim().startsWith('|')) key = 'table';
    else if (/^\s*\*\*[^*]+\*\*\s+—/.test(line)) key = 'label';
    else if (/^#{1,6}\s/.test(line)) key = 'heading';
    else key = 'sentence';
    (buckets[key] ??= []).push(`${rel}: ${line.trim().slice(0, 150)}`);
  }
}
for (const [k, v] of Object.entries(buckets)) {
  console.log(`\n### ${k} (${v.length})`);
  v.slice(0, 18).forEach((s) => console.log('  ' + s));
}
