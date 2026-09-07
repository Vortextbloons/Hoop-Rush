import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SEASON_SPONSOR_GEAR_CATALOG,
  SEASON_SPONSOR_GEAR_VERSION,
  seasonSponsorsIndexSchema,
  type SeasonSponsorTier,
} from '@hoop-rush/data-contracts';
import { sha256Hex } from './io.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../');
const STATIC_DATA = resolve(REPO_ROOT, 'apps/web/static/data');
const SPONSORS_DIR = resolve(STATIC_DATA, 'sponsors');
const SEASON_DIR = resolve(STATIC_DATA, 'season');
const INDEX_PATH = resolve(SEASON_DIR, 'sponsors-index.json');
const MANIFEST_PATH = resolve(STATIC_DATA, 'manifest.json');

const TIER_RING: Record<SeasonSponsorTier, string> = {
  BUZZ: '#93a4b8',
  PRIME: '#8b5cf6',
  ICON: '#eab308',
};

function initialsOf(displayName: string): string {
  const words = displayName.split(/[^A-Za-z0-9]+/).filter((word) => word.length > 0);
  const picked = words.slice(0, 2).map((word) => word[0]?.toUpperCase() ?? '');
  return picked.join('') || '?';
}

function monogramSvg(displayName: string, tier: SeasonSponsorTier): string {
  const ring = TIER_RING[tier];
  const initials = initialsOf(displayName);
  const fontSize = initials.length > 1 ? 34 : 44;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" role="img" aria-label="${displayName} placeholder mark"><rect x="2" y="2" width="92" height="92" rx="20" fill="#141a24" stroke="${ring}" stroke-width="5"/><text x="48" y="60" text-anchor="middle" font-family="system-ui, sans-serif" font-weight="700" font-size="${String(fontSize)}" fill="${ring}">${initials}</text></svg>\n`;
}

const LOGO_EXTENSIONS = ['svg', 'png', 'webp', 'jpg'] as const;

function existingLogoFile(family: string): string | null {
  for (const ext of LOGO_EXTENSIONS) {
    if (existsSync(resolve(SPONSORS_DIR, `${family}.${ext}`))) return `sponsors/${family}.${ext}`;
  }
  return null;
}

function main(): void {
  mkdirSync(SPONSORS_DIR, { recursive: true });
  const logos = [...SEASON_SPONSOR_GEAR_CATALOG]
    .sort((a, b) => (a.brandFamily < b.brandFamily ? -1 : 1))
    .map((entry) => {
      const kept = existingLogoFile(entry.brandFamily);
      if (kept !== null) {
        const bytes = readFileSync(resolve(STATIC_DATA, kept));
        return { family: entry.brandFamily, file: kept, contentHash: sha256Hex(bytes) };
      }
      const file = `sponsors/${entry.brandFamily}.svg`;
      const bytes = monogramSvg(entry.displayName, entry.tier);
      writeFileSync(resolve(STATIC_DATA, file), bytes);
      return {
        family: entry.brandFamily,
        file,
        contentHash: sha256Hex(bytes),
      };
    });
  const index = seasonSponsorsIndexSchema.parse({
    schemaVersion: 1,
    gearVersion: SEASON_SPONSOR_GEAR_VERSION,
    logos,
  });
  const indexJson = `${JSON.stringify(index, null, 2)}\n`;
  mkdirSync(SEASON_DIR, { recursive: true });
  writeFileSync(INDEX_PATH, indexJson);
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as {
    season?: Record<string, { url?: string; contentHash?: string }>;
  };
  if (manifest.season === undefined) {
    throw new Error('manifest has no season section');
  }
  manifest.season.sponsorsIndex = {
    url: 'season/sponsors-index.json',
    contentHash: sha256Hex(indexJson),
  };
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`wrote ${String(logos.length)} sponsor marks to ${SPONSORS_DIR}`);
  console.log(`wrote ${INDEX_PATH} and pinned manifest season.sponsorsIndex`);
}

main();
