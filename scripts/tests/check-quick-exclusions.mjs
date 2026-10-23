import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function globToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const body = escaped
    .replace(/\*\*\//g, '\u0000')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '(?:.*/)?');
  return new RegExp(`^${body}$`);
}

function collectTestFiles() {
  const files = [];
  const roots = ['packages', 'apps', 'tools', 'scripts'];
  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.svelte-kit') continue;
        walk(path);
      } else if (/\.(test|spec)\.ts$/.test(entry.name)) {
        files.push(relative(ROOT, path).replace(/\\/g, '/'));
      }
    }
  }
  for (const root of roots) walk(join(ROOT, root));
  return files;
}

const failures = [];

const manifest = JSON.parse(
  readFileSync(join(ROOT, 'scripts/tests/quick-exclusions.json'), 'utf8'),
);
const manifestPatterns = manifest.exclusions.map((entry) => entry.pattern);
const allowEmpty = new Set(manifest.allowEmpty ?? []);

const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const rootQuick = packageJson.scripts['test:quick'] ?? '';
if (rootQuick.includes('--path-ignore-patterns')) {
  failures.push(
    'root test:quick must delegate to workspace test:quick scripts; exclusion patterns live in each workspace package.json',
  );
}
if (!rootQuick.includes('test:quick') || !rootQuick.includes('--filter')) {
  failures.push('root test:quick must fan out to workspace test:quick scripts');
}

function extractPatterns(script) {
  return [
    ...script.matchAll(/--path-ignore-patterns[=\s]+"([^"]+)"/g),
    ...script.matchAll(/--path-ignore-patterns[=\s]+'([^']+)'/g),
  ].map((match) => match[1]);
}

const workspaceGlobs = packageJson.workspaces?.packages ?? [];
let quickScripts = 0;
for (const glob of workspaceGlobs) {
  const [parent, child] = glob.split('/');
  if (child !== '*') continue;
  let entries;
  try {
    entries = readdirSync(join(ROOT, parent), { withFileTypes: true });
  } catch {
    continue;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = `${parent}/${entry.name}`;
    const packagePath = join(ROOT, dir, 'package.json');
    if (!existsSync(packagePath)) continue;
    const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
    if (!pkg.scripts?.['test:run']) continue;
    quickScripts += 1;
    const script = pkg.scripts?.['test:quick'] ?? '';
    if (!script) {
      failures.push(
        `${dir}: missing test:quick script (required: mirror test:run plus the manifest exclusions)`,
      );
      continue;
    }
    const scriptPatterns = extractPatterns(script);
    const missingFromScript = manifestPatterns.filter(
      (pattern) => !scriptPatterns.includes(pattern),
    );
    const missingFromManifest = scriptPatterns.filter(
      (pattern) => !manifestPatterns.includes(pattern),
    );
    if (missingFromScript.length > 0) {
      failures.push(
        `${dir}: test:quick missing manifest patterns: ${missingFromScript.join(', ')}`,
      );
    }
    if (missingFromManifest.length > 0) {
      failures.push(
        `${dir}: test:quick patterns missing from the manifest: ${missingFromManifest.join(', ')}`,
      );
    }
  }
}
if (quickScripts === 0) {
  failures.push('no workspace test:quick scripts found');
}

const testFiles = collectTestFiles();
const excluded = new Set();
for (const pattern of manifestPatterns) {
  const rx = globToRegExp(pattern);
  const matches = testFiles.filter((file) => rx.test(file));
  if (matches.length === 0 && !allowEmpty.has(pattern)) {
    failures.push(`stale exclusion (matches no test file): ${pattern}`);
    continue;
  }
  for (const match of matches) excluded.add(match);
}

if (excluded.size === 0) {
  failures.push('test:quick excludes no test files (quick would equal run)');
}
if (excluded.size >= testFiles.length) {
  failures.push('test:quick excludes every test file');
}

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`FAIL ${failure}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `quick exclusions: ${String(manifestPatterns.length)} patterns across ${String(quickScripts)} workspace scripts, ${String(excluded.size)} of ${String(testFiles.length)} test files excluded\n`,
  );
}
