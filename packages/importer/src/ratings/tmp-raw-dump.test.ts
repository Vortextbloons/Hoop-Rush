import { describe, expect, it } from 'vitest';
import { derivePlayerRecord } from './v2.ts';
import { DEFAULT_RATINGS_MODEL_ARTIFACT } from './artifact.ts';
import { getEra } from './era.ts';
import { PEAKS } from './peak-cases.ts';
describe('raw dump', () => {
  it('dumps rawOverallScore per case', () => {
    for (const c of Object.values(PEAKS)) {
      const record = derivePlayerRecord({
        season: c.season,
        position: c.position,
        heightInches: c.height,
        stats: c.stats,
        era: getEra(c.season),
        artifact: DEFAULT_RATINGS_MODEL_ARTIFACT,
        teamWinPct: c.winPct,
      });
      console.log(`${c.key}: raw=${record.ratingProfile.rawOverallScore.toFixed(2)}`);
    }
    expect(true).toBe(true);
  });
});
