import { it, expect } from 'vitest';
import * as schedule from './schedule.js';
import * as league from './league.js';

it('imports load', () => {
  expect(typeof schedule.generateSeasonSchedule).toBe('function');
  expect(typeof league.conferenceOf).toBe('function');
  console.log('IMPORT_OK');
}, 10_000);
