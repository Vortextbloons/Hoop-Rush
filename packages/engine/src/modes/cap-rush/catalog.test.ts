import { describe, expect, test } from 'bun:test';
import { capRushCatalogSchema, type SeasonDraftCatalog } from '@hoop-rush/data-contracts';
import { buildCapRushTestCatalog, capRushTestCatalogSource } from '@hoop-rush/test-fixtures';
import { adaptCapRushCatalog } from './catalog.ts';

describe('cap rush catalog adaptation', () => {
  test('adapted catalog still satisfies the wire schema', () => {
    const catalog: SeasonDraftCatalog = buildCapRushTestCatalog();
    const adapted = adaptCapRushCatalog(catalog, capRushTestCatalogSource(catalog));
    expect(capRushCatalogSchema.safeParse(adapted).success).toBe(true);
  });

  test('drops candidates whose overall falls outside the draft range', () => {
    const catalog = buildCapRushTestCatalog();
    const source = capRushTestCatalogSource(catalog);
    const adapted = adaptCapRushCatalog(catalog, source);
    expect(adapted.candidates.length).toBeGreaterThan(0);
    for (const candidate of adapted.candidates) {
      expect(candidate.originalOverall).toBeGreaterThanOrEqual(40);
      expect(candidate.originalOverall).toBeLessThanOrEqual(99);
    }
  });
});
