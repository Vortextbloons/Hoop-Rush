import { it } from 'vitest';
import { buildSeasonLeague } from '@hoop-rush/test-fixtures';
import { SEASON_COMMITTED_SCHEDULE_SEED } from '@hoop-rush/data-contracts';
import { generateSeasonSchedule } from './schedule.js';

it('probe: stage timing', () => {
  const league = buildSeasonLeague();
  // eslint-disable-next-line no-console
  console.log('PROBE start');
  const t0 = Date.now();
  const s = generateSeasonSchedule({ league, seed: SEASON_COMMITTED_SCHEDULE_SEED });
  // eslint-disable-next-line no-console
  console.log(`PROBE done ms=${Date.now() - t0} games=${s.games.length}`);
}, 120_000);
