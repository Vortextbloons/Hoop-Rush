#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.svelte-kit',
  '.pnpm-store',
  'dist',
  'build',
  'coverage',
  '.turbo',
  '.cache',
  '.nyc_output',
  'playwright-report',
  'test-results',
  'raw-data',
  '.raw_nba_cache',
  'static',
]);
const DEFAULT_EXTS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.mjs',
  '.cjs',
  '.svelte',
  '.css',
]);

const args = process.argv.slice(2);
let charsPerLine = 60;
let topN = 10;
let perFile = false;
let exts = DEFAULT_EXTS;
let paths = [];
for (const arg of args) {
  if (arg.startsWith('--chars-per-line='))
    charsPerLine = Math.max(1, parseInt(arg.split('=')[1], 10) || 60);
  else if (arg.startsWith('--top=')) topN = Math.max(0, parseInt(arg.split('=')[1], 10) || 0);
  else if (arg === '--per-file') perFile = true;
  else if (arg === '--no-top') topN = 0;
  else if (arg.startsWith('--ext=')) {
    const list = arg
      .slice(6)
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
      .map((s) => (s.startsWith('.') ? s : `.${s}`));
    if (list.length > 0) exts = new Set(list);
  } else if (arg === '--help' || arg === '-h') {
    process.stdout.write(
      `Usage: node scripts/count-loc.mjs [paths...] [options]\n\nCounts physical lines plus normalized LOC where ${60} chars = 1 line.\n\nOptions:\n  --chars-per-line=N  chars per normalized line (default 60)\n  --ext=.ts,.js       file extensions to include (default ts,tsx,mts,cts,js,mjs,cjs,svelte,css)\n  --top=N             show N largest files by normalized LOC (default 10, 0 to hide)\n  --no-top            hide largest-files list\n  --per-file          list every file\n`,
    );
    process.exit(0);
  } else if (!arg.startsWith('-')) paths.push(arg);
}
if (paths.length === 0) paths = ['.'];

function collectFiles() {
  const out = [];
  const stack = [];
  for (const p of paths) {
    try {
      stack.push(resolve(ROOT, p));
    } catch {
      continue;
    }
  }
  while (stack.length > 0) {
    const current = stack.pop();
    let stat;
    try {
      stat = statSync(current);
    } catch {
      continue;
    }
    if (stat.isFile()) {
      if (exts.has(extname(current).toLowerCase())) out.push(current);
      continue;
    }
    if (!stat.isDirectory()) continue;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        stack.push(join(current, entry.name));
      } else if (entry.isFile() && exts.has(extname(entry.name).toLowerCase())) {
        out.push(join(current, entry.name));
      }
    }
  }
  return out;
}

function scanBuffer(buf) {
  let lines = 0;
  let blank = 0;
  let codeChars = 0;
  let lineHasCode = false;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b === 10) {
      lines += 1;
      if (!lineHasCode) blank += 1;
      lineHasCode = false;
    } else if (b === 13) {
      continue;
    } else {
      codeChars += 1;
      if (b !== 32 && b !== 9) lineHasCode = true;
    }
  }
  if (buf.length > 0 && buf[buf.length - 1] !== 10) {
    lines += 1;
    if (!lineHasCode) blank += 1;
  }
  return { lines, blank, codeChars };
}

const start = performance.now();
const files = collectFiles();
let totalLines = 0;
let totalBlank = 0;
let totalChars = 0;
const byExt = new Map();
const largest = [];
for (const file of files) {
  let buf;
  try {
    buf = readFileSync(file);
  } catch {
    continue;
  }
  const { lines, blank, codeChars } = scanBuffer(buf);
  const norm = Math.ceil(codeChars / charsPerLine);
  totalLines += lines;
  totalBlank += blank;
  totalChars += codeChars;
  const ext = extname(file).toLowerCase() || '(none)';
  let agg = byExt.get(ext);
  if (!agg) {
    agg = { files: 0, lines: 0, chars: 0, norm: 0 };
    byExt.set(ext, agg);
  }
  agg.files += 1;
  agg.lines += lines;
  agg.chars += codeChars;
  agg.norm += norm;
  if (perFile || topN > 0)
    largest.push({ file: relative(ROOT, file).replaceAll('\\', '/'), lines, norm });
}
largest.sort((a, b) => b.norm - a.norm);
const ms = performance.now() - start;
const totalNorm = Math.ceil(totalChars / charsPerLine);
const pad = (s, n) => String(s).padStart(n);

process.stdout.write(
  `Files: ${files.length}  Physical lines: ${totalLines}  Code lines: ${totalLines - totalBlank}  Blank: ${totalBlank}\n`,
);
process.stdout.write(
  `Total chars (excl. newlines): ${totalChars}  Chars/line: ${charsPerLine}  Normalized LOC (ceil(chars/${charsPerLine})): ${totalNorm}\n`,
);
process.stdout.write(`\nBy extension:\n`);
process.stdout.write(`  ext        files    physical   normalized\n`);
for (const [ext, agg] of [...byExt.entries()].sort((a, b) => b[1].norm - a[1].norm)) {
  process.stdout.write(
    `  ${ext.padEnd(10)} ${pad(agg.files, 6)} ${pad(agg.lines, 10)} ${pad(agg.norm, 12)}\n`,
  );
}
if (perFile) {
  process.stdout.write(`\nAll files (physical -> normalized):\n`);
  for (const entry of largest)
    process.stdout.write(`  ${pad(entry.norm, 7)} ${pad(entry.lines, 7)}  ${entry.file}\n`);
} else if (topN > 0 && largest.length > 0) {
  process.stdout.write(
    `\nTop ${Math.min(topN, largest.length)} largest files by normalized LOC:\n`,
  );
  for (const entry of largest.slice(0, topN))
    process.stdout.write(`  ${pad(entry.norm, 7)} ${pad(entry.lines, 7)}  ${entry.file}\n`);
}
process.stdout.write(`\nDone in ${ms.toFixed(0)}ms.\n`);
