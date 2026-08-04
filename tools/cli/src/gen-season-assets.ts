/**
 * Generates the committed Season Run assets (spec/2.0 M2.0): the frozen
 * league artifact, the complete 30-team fixture under `src/fixtures/`, and
 * the manifest `season` hash references. Run with
 * `pnpm --filter @hoop-rush/cli gen-season-assets` AFTER the schedule
 * artifact exists (`hoop-rush season schedule generate --out
 * apps/web/static/data/season/schedule.json`); the script refuses to touch
 * the manifest when the schedule artifact is missing so hashes always match
 * the committed bytes.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SEASON_COMMITTED_SCHEDULE_SEED,
  seasonLeagueSchema,
  seasonScheduleSchema,
} from '@hoop-rush/data-contracts';
import { buildSeasonLeague, buildSeasonRunFixture } from '@hoop-rush/test-fixtures';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../');
const STATIC_DATA = resolve(REPO_ROOT, 'apps/web/static/data');
const SEASON_DIR = resolve(STATIC_DATA, 'season');
const FIXTURES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const MANIFEST_PATH = resolve(STATIC_DATA, 'manifest.json');

function sha256Hex(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

const league = buildSeasonLeague();
const leagueJson = JSON.stringify(league, null, 2);
mkdirSync(SEASON_DIR, { recursive: true });
writeFileSync(resolve(SEASON_DIR, 'league.json'), `${leagueJson}\n`);
console.log(`wrote ${resolve(SEASON_DIR, 'league.json')}`);

const schedulePath = resolve(SEASON_DIR, 'schedule.json');
if (!existsSync(schedulePath)) {
  console.log(`SKIP manifest update: ${schedulePath} missing (run season schedule generate first)`);
} else {
  const scheduleBytes = readFileSync(schedulePath);
  const schedule = seasonScheduleSchema.parse(JSON.parse(scheduleBytes.toString('utf8')));
  const fixture = buildSeasonRunFixture({
    schedule,
    scheduleContentHash: sha256Hex(scheduleBytes),
  });
  mkdirSync(FIXTURES_DIR, { recursive: true });
  writeFileSync(resolve(FIXTURES_DIR, 'season-run.json'), `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`wrote ${resolve(FIXTURES_DIR, 'season-run.json')}`);

  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as {
    season?: {
      league?: { url?: string; contentHash?: string };
      schedule?: { url?: string; contentHash?: string };
    };
  };
  const leagueHash = sha256Hex(`${leagueJson}\n`);
  const scheduleHash = sha256Hex(scheduleBytes);
  manifest.season = {
    league: { url: 'season/league.json', contentHash: leagueHash },
    schedule: { url: 'season/schedule.json', contentHash: scheduleHash },
  };
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`wrote ${MANIFEST_PATH} (league ${leagueHash}, schedule ${scheduleHash})`);

  console.log(`schedule schema check: ok; seed ${SEASON_COMMITTED_SCHEDULE_SEED}`);
}
console.log(
  `league schema check: ${seasonLeagueSchema.safeParse(league).success ? 'ok' : 'FAILED'}`,
);
