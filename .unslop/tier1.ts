import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
const root = process.cwd();
const files = [
  'README.md',
  'ADDING_MODES.md',
  'AGENTS.md',
  'apps/web/AGENTS.md',
  'apps/web/README.md',
  'packages/engine/AGENTS.md',
  'packages/engine/README.md',
  'packages/persistence/AGENTS.md',
  'packages/persistence/README.md',
  'packages/importer/AGENTS.md',
  'packages/importer/README.md',
  'packages/application/README.md',
  'packages/data-contracts/README.md',
  'packages/test-fixtures/README.md',
  'tools/cli/README.md',
  'Guide/Typescript-Best-Practices.md',
];
for (const f of files) {
  const lines = readFileSync(join(root, f), 'utf8').split('\n');
  let fence = false;
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      return;
    }
    if (fence) return;
    if (line.includes('—') || /[“”]/.test(line)) console.log(`${f}:${i + 1}: ${line}`);
  });
}
