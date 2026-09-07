export type SponsorTileTone = 'light' | 'dark';

export interface SponsorBrandMeta {
  family: string;
  displayName: string;
  siteUrl: string;
  brandColor: string;
  tile: SponsorTileTone;
}

type SponsorBrandMetaSeed = Omit<SponsorBrandMeta, 'tile'> & { tile?: SponsorTileTone };

const SPONSOR_BRAND_META_SEEDS: readonly SponsorBrandMetaSeed[] = [
  { family: 'nike', displayName: 'Nike', siteUrl: 'https://www.nike.com', brandColor: '#e8e8e8' },
  {
    family: 'jordan',
    displayName: 'Jordan',
    siteUrl: 'https://www.nike.com/jordan',
    brandColor: '#ce1141',
  },
  {
    family: 'adidas',
    displayName: 'Adidas',
    siteUrl: 'https://www.adidas.com/us',
    brandColor: '#ffffff',
  },
  {
    family: 'li-ning',
    displayName: 'Li-Ning',
    siteUrl: 'https://www.lining.com',
    brandColor: '#e4002b',
  },
  { family: 'anta', displayName: 'Anta', siteUrl: 'https://www.anta.com', brandColor: '#d22630' },
  { family: 'puma', displayName: 'Puma', siteUrl: 'https://us.puma.com', brandColor: '#e30613' },
  {
    family: 'reebok',
    displayName: 'Reebok',
    siteUrl: 'https://www.reebok.com',
    brandColor: '#4a90d9',
  },
  {
    family: 'new-balance',
    displayName: 'New Balance',
    siteUrl: 'https://www.newbalance.com',
    brandColor: '#c41230',
  },
  {
    family: 'converse',
    displayName: 'Converse',
    siteUrl: 'https://www.converse.com',
    brandColor: '#d9d9d9',
  },
  {
    family: 'asics',
    displayName: 'Asics',
    siteUrl: 'https://www.asics.com/us/en-us',
    brandColor: '#0a4ba8',
  },
  {
    family: 'under-armour',
    displayName: 'Under Armour',
    siteUrl: 'https://www.underarmour.com',
    brandColor: '#cc0000',
  },
  {
    family: 'beats',
    displayName: 'Beats',
    siteUrl: 'https://www.beatsbydre.com',
    brandColor: '#e31837',
  },
  {
    family: 'spalding',
    displayName: 'Spalding',
    siteUrl: 'https://www.spalding.com',
    brandColor: '#e36f1e',
  },
  {
    family: 'mitchell-ness',
    displayName: 'Mitchell & Ness',
    siteUrl: 'https://www.mitchellandness.com',
    brandColor: '#3b82f6',
  },
  {
    family: 'oakley',
    displayName: 'Oakley',
    siteUrl: 'https://www.oakley.com',
    brandColor: '#f97316',
  },
  {
    family: 'wilson',
    displayName: 'Wilson',
    siteUrl: 'https://www.wilson.com',
    brandColor: '#d22630',
  },
  {
    family: 'hyperice',
    displayName: 'Hyperice',
    siteUrl: 'https://hyperice.com',
    brandColor: '#facc15',
  },
  {
    family: 'champion',
    displayName: 'Champion',
    siteUrl: 'https://www.champion.com',
    brandColor: '#2563eb',
  },
  {
    family: 'stance',
    displayName: 'Stance',
    siteUrl: 'https://www.stance.com',
    brandColor: '#e7e5e4',
  },
  {
    family: 'new-era',
    displayName: 'New Era',
    siteUrl: 'https://www.neweracap.com',
    brandColor: '#60a5fa',
  },
  {
    family: 'gatorade',
    displayName: 'Gatorade',
    siteUrl: 'https://www.gatorade.com',
    brandColor: '#ff7a00',
  },
  {
    family: 'red-bull',
    displayName: 'Red Bull',
    siteUrl: 'https://www.redbull.com',
    brandColor: '#facc15',
  },
  {
    family: 'monster',
    displayName: 'Monster',
    siteUrl: 'https://www.monsterenergy.com',
    brandColor: '#84cc16',
    tile: 'dark',
  },
  {
    family: 'therabody',
    displayName: 'Therabody',
    siteUrl: 'https://www.therabody.com',
    brandColor: '#2dd4bf',
  },
  {
    family: 'bodyarmor',
    displayName: 'BodyArmor',
    siteUrl: 'https://drinkbodyarmor.com',
    brandColor: '#fb923c',
  },
  {
    family: 'muscle-milk',
    displayName: 'Muscle Milk',
    siteUrl: 'https://www.musclemilk.com',
    brandColor: '#e8e8e8',
    tile: 'dark',
  },
  {
    family: 'skratch',
    displayName: 'Skratch',
    siteUrl: 'https://www.skratchlabs.com',
    brandColor: '#a3e635',
    tile: 'dark',
  },
  {
    family: 'celsius',
    displayName: 'Celsius',
    siteUrl: 'https://www.celsius.com',
    brandColor: '#f97316',
  },
  {
    family: 'powerade',
    displayName: 'Powerade',
    siteUrl: 'https://www.powerade.com',
    brandColor: '#2563eb',
  },
  {
    family: 'liquid-iv',
    displayName: 'Liquid I.V.',
    siteUrl: 'https://www.liquid-iv.com',
    brandColor: '#eab308',
  },
];

const SPONSOR_BRAND_META_BY_FAMILY: ReadonlyMap<string, SponsorBrandMeta> = new Map(
  SPONSOR_BRAND_META_SEEDS.map((meta) => [
    meta.family,
    { tile: 'light', ...meta } satisfies SponsorBrandMeta,
  ]),
);

export function sponsorBrandMetaOf(family: string): SponsorBrandMeta | null {
  return SPONSOR_BRAND_META_BY_FAMILY.get(family) ?? null;
}

export function sponsorBrandSiteUrlOf(family: string): string | null {
  return sponsorBrandMetaOf(family)?.siteUrl ?? null;
}

export function sponsorBrandColorOf(family: string, fallback = '#8b5cf6'): string {
  return sponsorBrandMetaOf(family)?.brandColor ?? fallback;
}

export function sponsorBrandTileOf(family: string): SponsorTileTone {
  return sponsorBrandMetaOf(family)?.tile ?? 'light';
}
