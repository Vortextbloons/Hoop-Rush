// Reports style tells in markdown. Usage: bun .unslop/lint.ts [--dir <path>]
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
const generated = new Set([
  'Docs/combined.md',
  'Docs/archive/combined.md',
  'Docs/archive/combined(4).md',
]);

export function collectMarkdown(dir = root): string[] {
  const files: string[] = [];
  (function walk(d: string) {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (!skip.has(e.name)) walk(p);
      } else if (/\.mdx?$/.test(e.name)) {
        const rel = relative(root, p).replace(/\\/g, '/');
        if (!generated.has(rel)) files.push(p);
      }
    }
  })(root);
  return files;
}

const VOCAB: [string, RegExp][] = [
  ['Additionally', /\bAdditionally\b/g],
  ['crucial', /\bcrucial(ly)?\b/gi],
  ['delve', /\bdelv(e|ing|ed)\b/gi],
  ['enduring', /\benduring\b/gi],
  ['enhance', /\benhanc(e|es|ed|ing|ement)\b/gi],
  ['foster', /\bfoster(s|ed|ing)?\b/gi],
  ['garner', /\bgarner(s|ed|ing)?\b/gi],
  ['interplay', /\binterplay\b/gi],
  ['intricate', /\bintricate(ly)?\b/gi],
  ['landscape', /\blandscape\b/gi],
  ['pivotal', /\bpivotal\b/gi],
  ['showcase', /\bshowcas(e|es|ed|ing)\b/gi],
  ['tapestry', /\btapestry\b/gi],
  ['testament', /\btestament\b/gi],
  ['underscore', /\bunderscor(e|es|ed|ing)\b/gi],
  ['vibrant', /\bvibrant(ly)?\b/gi],
  ['serves as', /\bserves? as\b/gi],
  ['stands as', /\bstands? as\b/gi],
  ['boasts', /\bboast(s|ed|ing)?\b/gi],
  ['leverage', /\bleverag(e|es|ed|ing)\b/gi],
  ['utilize', /\butiliz(e|es|ed|ing)\b/gi],
  ['facilitate', /\bfacilitat(e|es|ed|ing)\b/gi],
  ['robust', /\brobust(ly|ness)?\b/gi],
  ['seamless', /\bseamless(ly)?\b/gi],
  ['comprehensive', /\bcomprehensive(ly)?\b/gi],
  ['holistic', /\bholistic\b/gi],
  ['nuanced', /\bnuanced\b/gi],
  ['moreover', /\bMoreover\b/g],
  ['furthermore', /\bFurthermore\b/g],
  ['in order to', /\bin order to\b/gi],
  ['due to the fact', /\bdue to the fact\b/gi],
  ['important to note', /\bit is important to note\b/gi],
  ['plays a role', /\bplays? a (key |crucial |vital |central )?role\b/gi],
  ['nestled', /\bnestled\b/gi],
  ['groundbreaking', /\bgroundbreaking\b/gi],
  ['renowned', /\brenowned\b/gi],
  ['stunning', /\bstunning\b/gi],
  ['not just X but Y', /\bnot just [^.]{1,60} but\b/gi],
  ['excessive hedge', /\bcould potentially|might possibly\b/gi],
];

const mode = process.argv.includes('--list') ? 'list' : 'count';
let totals = new Map<string, number>();
const hits = new Map<string, string[]>();

for (const file of collectMarkdown()) {
  const rel = relative(root, file).replace(/\\/g, '/');
  const lines = readFileSync(file, 'utf8').split('\n');
  let fence = false;
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      return;
    }
    if (fence) return;
    const prose = line.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length));
    const report = (label: string) => {
      totals.set(label, (totals.get(label) ?? 0) + 1);
      const key = `${rel}:${i + 1}`;
      (hits.get(label) ?? hits.set(label, []).get(label)!).push(
        `${key}: ${line.trim().slice(0, 150)}`,
      );
    };
    if (/[—–]/.test(prose)) report('em/en dash');
    if (/[“”‘’]/.test(prose)) report('curly quote');
    for (const [name, re] of VOCAB) if (re.test(prose)) report(`vocab: ${name}`);
    const labelRestate = line.match(
      /^\s*[-*]\s+\*\*([^*]+)\*\*\s*[:—–]\s*(?:The\s+|This\s+)?([A-Za-z]+)/,
    );
    if (labelRestate) {
      const label = labelRestate[1]!
        .toLowerCase()
        .split(/[^a-z]+/)
        .filter(Boolean);
      const first = labelRestate[2]!.toLowerCase();
      if (label.includes(first)) report('inline-header bullet');
    }
    if (/^\s*[-*]\s+[A-Za-z][^:]{0,40}:\s+[A-Z]/.test(line)) report('possible inline-header');
    if (/^#{1,6}\s/.test(line) && /\b(A|An|The|And|For|Of|With|To|In|On)\b.*[A-Z]/.test(line))
      report('possible title case heading');
    if (/^[^|]*\|[^|]*\s—\s/.test(line)) report('dash in table row');
  });
}

const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
console.log(sorted.map(([k, v]) => `${String(v).padStart(5)}  ${k}`).join('\n'));
if (mode === 'list') {
  for (const label of process.argv.slice(2).filter((a) => !a.startsWith('--'))) {
    console.log(`\n### ${label}`);
    (hits.get(label) ?? []).forEach((h) => console.log('  ' + h));
  }
}
