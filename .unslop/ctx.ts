// Dumps dash lines with surrounding context for rewriting.
// Usage: bun .unslop/ctx.ts <path> [<path> ...]
import { readFileSync } from 'node:fs';

const files = process.argv.slice(2);
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  console.log(`\n=== ${file} (${lines.length} lines)`);
  let fence = false;
  const wanted = new Set<number>();
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      return;
    }
    if (fence) return;
    if (!/[—–]/.test(line)) return;
    wanted.add(i);
    if (!/[.!?:;)"'*|]\s*$/.test(line) && i + 1 < lines.length) wanted.add(i + 1);
  });
  for (const i of [...wanted].sort((a, b) => a - b)) console.log(`${i + 1}| ${lines[i]}`);
}
