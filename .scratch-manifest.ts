import { readFileSync } from 'node:fs';
const m = JSON.parse(readFileSync('apps/web/static/data/manifest.json', 'utf8'));
console.log('dataVersion', m.dataVersion);
console.log('draftCatalog', m.draftCatalog);
console.log('keys', Object.keys(m));
