// Recovers original Docs/*.md text from the generated Docs/combined.md so edits
// can be verified after the fact. Sections are separated by "\n\n---\n\n" and
// each begins with "## <relpath>\n\n".
// Usage: bun .unslop/recover.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = process.cwd();
const combined = readFileSync(join(root, 'Docs', 'combined.md'), 'utf8');

const chunks = combined.split('\n\n---\n\n');
let written = 0;
for (const chunk of chunks) {
  const match = chunk.match(/^## ([^\n]+\.md)\n\n([\s\S]*)$/);
  if (!match) continue;
  const rel = match[1]!.trim();
  const body = match[2]!;
  if (rel === 'combined.md' || rel.startsWith('handoffs/') || rel.startsWith('archive/')) continue;
  const target = join(root, '.unslop', 'orig', 'Docs', rel);
  if (!existsSync(dirname(target))) mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, body.trimEnd() + '\n');
  written++;
}
console.log(`recovered ${written} Docs files into .unslop/orig/Docs`);
