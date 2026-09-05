import { describe, expect, it } from 'vitest';
import { derivePlayerRecord } from './v2.ts';
import { DEFAULT_RATINGS_MODEL_ARTIFACT } from './artifact.ts';
import { getEra } from './era.ts';
import { PEAKS } from './peak-cases.ts';
function rawFor(key: string): number {
  const c = PEAKS[key];
  if (!c) throw new Error(`unknown peak case ${key}`);
  const record = derivePlayerRecord({
    season: c.season,
    position: c.position,
    heightInches: c.height,
    stats: c.stats,
    era: getEra(c.season),
    artifact: DEFAULT_RATINGS_MODEL_ARTIFACT,
    teamWinPct: c.winPct,
  });
  return record.ratingProfile.rawOverallScore;
}
function expectRawAtLeast(key: string, a: string): void {
  expect(rawFor(key), `${key} raw >= ${a} raw`).toBeGreaterThanOrEqual(rawFor(a));
}
describe('peak-season overall calibration', () => {
  it('ranks canonical peaks ahead of higher-volume adjacent seasons', () => {
    expectRawAtLeast('jordan9091', 'jordan8889');
    expectRawAtLeast('lebron1213', 'lebron0910');
  });
  it('keeps two-way title peaks ahead of high-usage non-contender peaks', () => {
    expectRawAtLeast('shaq9900', 'embiid2122');
    expectRawAtLeast('shaq9900', 'davis1718');
    expectRawAtLeast('hakeem9394', 'embiid2122');
    expectRawAtLeast('hakeem9394', 'davis1718');
    expectRawAtLeast('jordan9091', 'luka2324');
    expectRawAtLeast('lebron1213', 'luka2324');
    expectRawAtLeast('jordan9091', 'embiid2122');
    expectRawAtLeast('lebron1213', 'embiid2122');
    expectRawAtLeast('kareem7172', 'embiid2122');
    expectRawAtLeast('bird8687', 'luka2324');
    expectRawAtLeast('shaq9900', 'lillard1920');
    expectRawAtLeast('duncan0203', 'lillard1920');
  });
  it('ranks historic efficiency and all-around peaks above modern MVP runners', () => {
    expectRawAtLeast('curry1516', 'sga2425');
    expectRawAtLeast('curry1516', 'luka2324');
    expectRawAtLeast('magic8687', 'paul0708');
    expectRawAtLeast('duncan0203', 'davis1718');
    expectRawAtLeast('kobe0506', 'lillard1920');
    expectRawAtLeast('wade0809', 'lillard1920');
    expectRawAtLeast('garnett0304', 'davis1718');
    expectRawAtLeast('jokic2425', 'embiid2122');
  });
  it('keeps the money ordering: 1990-91 Jordan and 2012-13 LeBron clear of 2024-25 SGA', () => {
    expectRawAtLeast('jordan9091', 'sga2425');
    expectRawAtLeast('lebron1213', 'sga2425');
  });
  it('keeps unquestioned historic seasons at the very top of the raw scale', () => {
    expect(rawFor('curry1516')).toBeGreaterThanOrEqual(88);
    expect(rawFor('wilt6263')).toBeGreaterThanOrEqual(85);
  });
});
