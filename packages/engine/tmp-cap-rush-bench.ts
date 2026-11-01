import catalog from '../../apps/web/static/data/draft-catalog.json';
import { adaptCapRushCatalog, buildCapRushCatalogIndex } from './src/modes/cap-rush/catalog.ts';
import { seasonDraftCatalogSchema } from '@hoop-rush/data-contracts';

const source = {
  catalogVersion: catalog.catalogVersion,
  catalogHash: '0'.repeat(64),
  dataVersion: catalog.dataVersion,
  ratingsVersion: catalog.ratingsVersion,
  playerVersionIdVersion: catalog.playerVersionIdVersion,
  positionNormalizationVersion: catalog.positionNormalizationVersion,
};

function time(label: string, action: () => void): void {
  const start = performance.now();
  action();
  console.log(label, Math.round((performance.now() - start) * 10) / 10, 'ms');
}

const adapted = adaptCapRushCatalog(catalog as never, source);
time('catalog adapt (no index)', () => adaptCapRushCatalog(catalog as never, source));
time('catalog index', () => buildCapRushCatalogIndex(adapted));
time('seasonDraftCatalogSchema.parse', () => {
  seasonDraftCatalogSchema.parse(catalog);
});
time('JSON clone', () => {
  structuredClone(catalog);
});
