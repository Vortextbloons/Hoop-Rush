import { describe, expect, it } from 'vitest';
import { SEASON_SPONSOR_GEAR_CATALOG } from '@hoop-rush/data-contracts';
import {
  sponsorBrandColorOf,
  sponsorBrandMetaOf,
  sponsorBrandSiteUrlOf,
  sponsorBrandTileOf,
} from './sponsor-brand-meta.ts';

describe('sponsor-brand-meta', () => {
  it('covers every catalog brand family with an https official site', () => {
    const families = new Set(SEASON_SPONSOR_GEAR_CATALOG.map((entry) => entry.brandFamily));
    expect(families.size).toBe(30);
    for (const family of families) {
      const meta = sponsorBrandMetaOf(family);
      expect(meta, `missing meta for ${family}`).not.toBeNull();
      expect(meta?.siteUrl).toMatch(/^https:\/\/[^/]+\.[a-z]{2,}/);
      expect(meta?.brandColor).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('returns known links and colors with safe fallbacks', () => {
    expect(sponsorBrandSiteUrlOf('nike')).toBe('https://www.nike.com');
    expect(sponsorBrandSiteUrlOf('jordan')).toBe('https://www.nike.com/jordan');
    expect(sponsorBrandSiteUrlOf('no-such-brand')).toBeNull();
    expect(sponsorBrandColorOf('gatorade')).toBe('#ff7a00');
    expect(sponsorBrandColorOf('no-such-brand')).toBe('#8b5cf6');
    expect(sponsorBrandColorOf('no-such-brand', '#000000')).toBe('#000000');
  });

  it('assigns a tile tone to every family, defaulting to light', () => {
    const families = new Set(SEASON_SPONSOR_GEAR_CATALOG.map((entry) => entry.brandFamily));
    for (const family of families) {
      expect(['light', 'dark']).toContain(sponsorBrandMetaOf(family)?.tile);
    }
    expect(sponsorBrandTileOf('nike')).toBe('light');
    expect(sponsorBrandTileOf('skratch')).toBe('dark');
    expect(sponsorBrandTileOf('muscle-milk')).toBe('dark');
    expect(sponsorBrandTileOf('monster')).toBe('dark');
    expect(sponsorBrandTileOf('no-such-brand')).toBe('light');
  });
});
