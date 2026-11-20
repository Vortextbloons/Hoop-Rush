// Verifies that an unslop edit preserved code spans, links, and structure, and
// that prose has no em/en dashes or curly quotes left.
// Usage: bun .unslop/check.ts <path> [<path> ...]
// Baseline order: .unslop/orig (recovered from Docs/combined.md, links already
// rewritten to the docs root), then .unslop/base, then git HEAD.
import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';

const root = process.cwd();

type Baseline = { text: string; kind: 'git' | 'orig' | 'base' };

function baseline(rel: string): Baseline | null {
  const orig = join(root, '.unslop', 'orig', rel);
  if (existsSync(orig)) return { text: readFileSync(orig, 'utf8'), kind: 'orig' };
  const snap = join(root, '.unslop', 'base', rel);
  if (existsSync(snap)) return { text: readFileSync(snap, 'utf8'), kind: 'base' };
  const tracked = Bun.spawnSync(['git', 'ls-files', '--error-unmatch', rel], { cwd: root });
  if (tracked.exitCode === 0) {
    const show = Bun.spawnSync(['git', 'show', `HEAD:${rel}`], { cwd: root });
    if (show.exitCode === 0) return { text: show.stdout.toString(), kind: 'git' };
  }
  return null;
}

function collect(text: string, re: RegExp): string[] {
  const out: string[] = [];
  let fence = false;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    for (const m of line.matchAll(re)) out.push(m[0]);
  }
  return out.sort();
}

function normalizedLinks(text: string, rel: string, kind: Baseline['kind']): string[] {
  const baseDir =
    kind === 'orig'
      ? ''
      : rel.startsWith('Docs/')
        ? posix.dirname(rel.slice(5))
        : posix.dirname(rel);
  return collect(text, /\]\(([^)\s]+)\)/g)
    .map((m) => m.slice(2, -1))
    .map((target) => {
      if (/^(https?:|mailto:|#)/.test(target)) return target;
      const [path, hash] = target.split('#');
      const abs = posix.normalize(posix.join(baseDir, path ?? ''));
      return hash ? `${abs}#${hash}` : abs;
    })
    .sort();
}

function proseLines(text: string): { line: string; n: number }[] {
  const out: { line: string; n: number }[] = [];
  let fence = false;
  text.split('\n').forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      return;
    }
    if (!fence) out.push({ line, n: i + 1 });
  });
  return out;
}

let failures = 0;
for (const rel of process.argv.slice(2)) {
  const base = baseline(rel);
  if (!base) {
    console.error(`NO BASELINE ${rel}`);
    failures++;
    continue;
  }
  const after = readFileSync(join(root, rel), 'utf8');
  const problems: string[] = [];

  const missingCode = collect(base.text, /`[^`\n]*`/g).filter(
    (x) => !collect(after, /`[^`\n]*`/g).includes(x),
  );
  if (missingCode.length) problems.push(`code span gone: ${missingCode.slice(0, 5).join(' | ')}`);

  const afterLinks = normalizedLinks(after, rel, 'git');
  const missingLinks = normalizedLinks(base.text, rel, base.kind).filter(
    (x) => !afterLinks.includes(x),
  );
  if (missingLinks.length) problems.push(`link gone: ${missingLinks.slice(0, 5).join(' | ')}`);

  const headings = (t: string) => (t.match(/^#{1,6} /gm) ?? []).length;
  if (headings(base.text) !== headings(after)) {
    problems.push(`headings ${headings(base.text)} -> ${headings(after)}`);
  }

  const rows = (t: string) => (t.match(/^\s*\|/gm) ?? []).length;
  if (rows(base.text) !== rows(after))
    problems.push(`table rows ${rows(base.text)} -> ${rows(after)}`);

  for (const { line, n } of proseLines(after)) {
    const prose = line.replace(/`[^`]*`/g, ' ');
    if (/[—–]/.test(prose)) problems.push(`dash at ${rel}:${n}: ${line.trim().slice(0, 100)}`);
    if (/[“”‘’]/.test(prose)) problems.push(`curly quote at ${rel}:${n}`);
  }

  if (problems.length) {
    failures += problems.length;
    console.log(`FAIL ${rel} [${base.kind}]`);
    problems.slice(0, 10).forEach((p) => console.log('  ' + p));
  } else {
    console.log(`ok   ${rel} [${base.kind}]`);
  }
}
console.log(failures === 0 ? 'ALL CLEAN' : `${failures} problem(s)`);
process.exit(failures === 0 ? 0 : 1);
