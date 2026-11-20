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

const pats: [string, RegExp][] = [
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
  ['it is important to note', /\bit is important to note\b/gi],
  ['plays a role', /\bplays? a (key |crucial |vital |central )?role\b/gi],
  ['nestled', /\bnestled\b/gi],
  ['groundbreaking', /\bgroundbreaking\b/gi],
  ['renowned', /\brenowned\b/gi],
  ['stunning', /\bstunning\b/gi],
  ['must-visit', /\bmust-visit\b/gi],
  ['highlights', /\bhighlight(s|ed|ing)\b/gi],
  ['ensuring', /\bensur(e|es|ed|ing)\b/gi],
  ['reflecting', /\breflect(s|ed|ing)?\b/gi],
  ['fostering', /\bfostering\b/gi],
  ['substrate', /\bsubstrate\b/gi],
  ['harness', /\bharness(es|ed|ing)?\b/gi],
  ['surface', /\bAPI surface|surface area\b/gi],
  ['primitive', /\bprimitives?\b/gi],
  ['paradigm', /\bparadigm\b/gi],
  ['endgame', /\bendgame\b/gi],
  ['north star', /\bnorth star\b/gi],
  ['flywheel', /\bflywheel\b/gi],
  ['gold-plating', /\bgold[- ]plat/gi],
  ['scaffolding', /\bscaffold/gi],
  ['ecosystem', /\becosystem\b/gi],
  ['empower', /\bempower/gi],
  ['streamline', /\bstreamlin/gi],
  ['elevate', /\belevat(e|es|ed|ing)\b/gi],
  ['unlock', /\bunlock(s|ed|ing)?\b/gi],
];
const totals: [string, number][] = [];
const byFile: Record<string, string[]> = {};
for (const [name, re] of pats) {
  let n = 0;
  for (const f of files) {
    const rel = relative(root, f).replace(/\\/g, '/');
    if (rel.endsWith('combined.md') || rel.startsWith('Docs/archive/')) continue;
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const m = line.match(re);
      if (m) {
        n += m.length;
        (byFile[rel] ??= []).push(`  ${name}:${i + 1}: ${line.trim().slice(0, 140)}`);
      }
    });
  }
  if (n) totals.push([name, n]);
}
totals.sort((a, b) => b[1] - a[1]);
console.log(totals.map(([k, v]) => `${k}: ${v}`).join('\n'));
const heavy = Object.entries(byFile)
  .sort((a, b) => b[1].length - a[1].length)
  .slice(0, 12);
for (const [f, hits] of heavy) {
  console.log(`\n### ${f} (${hits.length})`);
  hits.slice(0, 10).forEach((h) => console.log(h));
}
