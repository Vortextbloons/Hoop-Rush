import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rootPackage = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const patterns = rootPackage.workspaces?.packages ?? rootPackage.workspaces;
const packageDirs = patterns.flatMap((pattern) => {
  const [parent, childPattern] = pattern.split('/');
  if (childPattern !== '*') return [];
  return readdirSync(join(root, parent), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(parent, entry.name));
});
const packages = packageDirs.flatMap((dir) => {
  const packagePath = join(root, dir, 'package.json');
  if (!existsSync(packagePath)) return [];
  return [{ dir: dir.replaceAll('\\', '/'), ...JSON.parse(readFileSync(packagePath, 'utf8')) }];
});
const diff = spawnSync('git', ['diff', '--name-only', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
});
if (diff.status !== 0) {
  process.stderr.write(diff.stderr);
  process.exit(diff.status ?? 1);
}

const changedPaths = diff.stdout.split(/\r?\n/).filter(Boolean);
const globalChanges = new Set([
  'package.json',
  'bun.lock',
  'bunfig.toml',
  'tsconfig.base.json',
  'eslint.config.js',
]);
const allPackagesChanged = changedPaths.some((path) => globalChanges.has(path));
const selected = new Set(
  allPackagesChanged
    ? packages.map((pkg) => pkg.name)
    : packages
        .filter((pkg) => changedPaths.some((path) => path.startsWith(`${pkg.dir}/`)))
        .map((pkg) => pkg.name),
);

let expanded = true;
while (expanded) {
  expanded = false;
  for (const pkg of packages) {
    if (selected.has(pkg.name)) continue;
    const deps = [
      pkg.dependencies,
      pkg.devDependencies,
      pkg.optionalDependencies,
      pkg.peerDependencies,
    ].flatMap((group) => Object.keys(group ?? {}));
    if (deps.some((dependency) => selected.has(dependency))) {
      selected.add(pkg.name);
      expanded = true;
    }
  }
}

if (selected.size === 0) {
  process.stdout.write('No workspace packages changed; skipping verification.\n');
  process.exit(0);
}

const args = ['run', '--parallel'];
for (const name of selected) args.push('--filter', name);
args.push('check', 'lint', 'test:run');
const run = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
process.exit(run.status ?? 1);
