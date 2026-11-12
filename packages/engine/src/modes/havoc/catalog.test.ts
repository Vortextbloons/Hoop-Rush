import { describe, expect, test } from 'bun:test';
import { havocCatalogSchema } from '@hoop-rush/data-contracts';
import { AdaptHavocCatalog } from './catalog.ts';
import { buildHavocCatalogFixture } from './havoc-test-support.ts';

describe('havoc catalog adaptation', () => {
  test('adapted catalog still satisfies the wire schema', () => {
    const fixture = buildHavocCatalogFixture();
    const adapted = AdaptHavocCatalog(fixture.catalog, fixture.source);
    expect(havocCatalogSchema.safeParse(adapted).success).toBe(true);
  });
});
