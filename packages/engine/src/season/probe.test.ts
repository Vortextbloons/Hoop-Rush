import { it } from 'vitest';
import { buildSeasonLeague } from '@hoop-rush/test-fixtures';
import { SEASON_COMMITTED_SCHEDULE_SEED } from '@hoop-rush/data-contracts';
import { generateSeasonSchedule } from './schedule.js';

it('probe: stage timing', () => {
  const league = buildSeasonLeague();
  console.log('PROBE start');
  const t0 = Date.now();
  const s = generateSeasonSchedule({ league, seed: SEASON_COMMITTED_SCHEDULE_SEED });
  console.log(`PROBE done ms=${String(Date.now() - t0)} games=${String(s.games.length)}`);
}, 120_000);
