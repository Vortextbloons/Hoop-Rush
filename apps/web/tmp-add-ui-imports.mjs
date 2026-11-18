import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'svelte/compiler';

const known = [
  'ActionLink',
  'Alert',
  'Badge',
  'Button',
  'EmptyState',
  'IconButton',
  'PageHeader',
  'PageShell',
  'Panel',
  'SectionHeading',
  'SegmentedControl',
  'StatGrid',
  'StatTile',
];

const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) walk(p);
    else if (entry.endsWith('.svelte')) files.push(p);
  }
})('src');

for (const file of files) {
  let source = readFileSync(file, 'utf8');
  const missing = known.filter(
    (name) => new RegExp(`<${name}\\b`).test(source) && !new RegExp(`import ${name} from`).test(source),
  );
  if (missing.length === 0) continue;
  const ast = parse(source, { modern: true, filename: file });
  const body = ast.instance?.content?.body ?? [];
  const imports = body.filter((node) => node.type === 'ImportDeclaration');
  const insertAt = imports.length > 0 ? Math.max(...imports.map((node) => node.end)) : 0;
  const lines = missing.map((name) => `import ${name} from '#lib/components/ui/${name}.svelte';`).join('\n  ');
  source = source.slice(0, insertAt) + `\n  ${lines}` + source.slice(insertAt);
  writeFileSync(file, source);
  console.log(`${file}: +${missing.join(', +')}`);
}
