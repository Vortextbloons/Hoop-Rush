// Applies exact string replacements from a JSON edit file.
// Matches against LF-normalized text, then restores the file's original line endings.
// Usage: bun .unslop/apply.ts <edits.json>
// edits.json: { "<path>": [["old", "new"], ...], ... }
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) throw new Error('usage: bun .unslop/apply.ts <edits.json>');
const edits = JSON.parse(readFileSync(file, 'utf8')) as Record<string, [string, string][]>;

let failures = 0;
let applied = 0;
for (const [path, pairs] of Object.entries(edits)) {
  const raw = readFileSync(path, 'utf8');
  const crlf = raw.includes('\r\n');
  let text = raw.replace(/\r\n/g, '\n');
  for (const [from, to] of pairs) {
    const plainFrom = from.replace(/\r\n/g, '\n');
    const plainTo = to.replace(/\r\n/g, '\n');
    const count = text.split(plainFrom).length - 1;
    if (count === 0) {
      failures++;
      console.error(`MISS ${path}: ${plainFrom.slice(0, 90)}`);
      continue;
    }
    if (count > 1) console.error(`WARN ${path}: ${count} matches for ${plainFrom.slice(0, 70)}`);
    text = text.split(plainFrom).join(plainTo);
    applied++;
  }
  writeFileSync(path, crlf ? text.replace(/\n/g, '\r\n') : text);
}
console.log(
  `applied ${applied} replacements across ${Object.keys(edits).length} files, ${failures} misses`,
);
if (failures > 0) process.exit(1);
