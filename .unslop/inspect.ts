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
const tight: string[] = [],
  en: string[] = [],
  curly: string[] = [],
  hyph: string[] = [];
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n');
  let fence = false;
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      return;
    }
    if (fence) return;
    const stripped = line.replace(/`[^`]*`/g, '');
    if (/—(?! )|(?<! )—/.test(stripped))
      tight.push(`${relative(root, f)}:${i + 1}: ${line.trim()}`);
    if (stripped.includes('–')) en.push(`${relative(root, f)}:${i + 1}: ${line.trim()}`);
    if (/[“”‘’]/.test(stripped)) curly.push(`${relative(root, f)}:${i + 1}: ${line.trim()}`);
    if (/\s-\s/.test(stripped)) hyph.push(`${relative(root, f)}:${i + 1}: ${line.trim()}`);
  });
}
console.log('=== TIGHT EM', tight.length);
tight.slice(0, 40).forEach((s) => console.log(s));
console.log('=== EN DASH', en.length);
en.slice(0, 40).forEach((s) => console.log(s));
console.log('=== CURLY', curly.length);
curly.slice(0, 30).forEach((s) => console.log(s));
console.log('=== HYPHEN DASH', hyph.length);
hyph.slice(0, 30).forEach((s) => console.log(s));
