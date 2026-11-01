import catalog from './apps/web/static/data/draft-catalog.json';
import { adaptCapRushCatalog, buildCapRushCatalogIndex } from '@hoop-rush/engine';

const source = {
  catalogVersion: catalog.catalogVersion,
  catalogHash: '0'.repeat(64),
  dataVersion: catalog.dataVersion,
  ratingsVersion: catalog.ratingsVersion,
  playerVersionIdVersion: catalog.playerVersionIdVersion,
  positionNormalizationVersion: catalog.positionNormalizationVersion,
};

let start = performance.now();
const adapted = adaptCapRushCatalog(catalog as never, source);
const adaptMs = performance.now() - start;
start = performance.now();
buildCapRushCatalogIndex(adapted);
const indexMs = performance.now() - start;
console.log({
  candidates: catalog.candidates.length,
  adaptMs,
  indexMs,
  totalMs: adaptMs + indexMs,
});
