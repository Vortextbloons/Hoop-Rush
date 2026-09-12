import { describe, expect, it } from 'vitest';
import { buildCollectionGameRulesFixture } from '@hoop-rush/test-fixtures';
import {
  difficultyOptionViews,
  difficultyRatingShiftLabel,
  formatBasisPointPercent,
  formatMultiplier,
  objectiveConditionLabel,
  objectiveOptionViews,
  rarityBandLabel,
  ratingLabel,
  rewardPreview,
} from './collection-setup.ts';

const rules = buildCollectionGameRulesFixture();

describe('collection setup formatting', () => {
  it('formats multipliers and basis-point percentages exactly', () => {
    expect(formatMultiplier(10_000)).toBe('1.00×');
    expect(formatMultiplier(13_500)).toBe('1.35×');
    expect(formatMultiplier(17_500)).toBe('1.75×');
    expect(formatMultiplier(5_000)).toBe('0.50×');
    expect(formatBasisPointPercent(7_600)).toBe('76%');
    expect(formatBasisPointPercent(1_250)).toBe('12.5%');
    expect(formatBasisPointPercent(170)).toBe('1.7%');
    expect(formatBasisPointPercent(29)).toBe('0.29%');
  });

  it('labels rarity bands, rating shifts, and ratings', () => {
    const street = rules.difficulties[0];
    expect(street).toBeDefined();
    expect(rarityBandLabel({ floor: 'Ember', ceiling: 'Apex' })).toBe('Ember–Apex');
    expect(difficultyRatingShiftLabel(-2)).toContain('-2');
    expect(difficultyRatingShiftLabel(2)).toContain('+2');
    expect(difficultyRatingShiftLabel(0)).toBe('No CPU rating change');
    expect(ratingLabel('threePoint')).toBe('Three Point');
    expect(ratingLabel('offensiveIq')).toBe('Offensive IQ');
    expect(ratingLabel('insideScoring')).toBe('Inside Scoring');
  });

  it('states every objective condition exactly', () => {
    expect(
      objectiveConditionLabel({ kind: 'player-team-three-pointers-made', threshold: 12 }),
    ).toBe('Make at least 12 three-pointers as a team');
    expect(objectiveConditionLabel({ kind: 'cpu-team-points-at-most', threshold: 105 })).toBe(
      'Hold the CPU to 105 points or fewer',
    );
    expect(objectiveConditionLabel({ kind: 'player-bench-points-at-least', threshold: 25 })).toBe(
      'Bench scores at least 25 points',
    );
    expect(objectiveConditionLabel({ kind: 'cpu-team-turnovers-at-least', threshold: 14 })).toBe(
      'Force at least 14 CPU turnovers',
    );
    expect(objectiveConditionLabel({ kind: 'player-rebound-margin-at-least', threshold: 10 })).toBe(
      'Out-rebound the CPU by 10 or more',
    );
    expect(
      objectiveConditionLabel({ kind: 'player-double-stat', threshold: 10, categories: 2 }),
    ).toBe('One player records 10+ in any 2 of points, rebounds, assists, steals, blocks');
  });
});

describe('difficulty option views', () => {
  it('reads band, construction, shift, multiplier, and first-clear state from the rules', () => {
    const options = difficultyOptionViews(rules, []);
    expect(options.map((option) => option.difficultyId)).toEqual(['street', 'pro', 'legend']);
    const [street, pro, legend] = options;
    expect(street?.bandLabel).toBe('Ember–Apex');
    expect(street?.weightsLabel).toBe('Ember 76% · Eruption 22% · Apex 2%');
    expect(street?.ratingShiftLabel).toContain('-2');
    expect(street?.rewardMultiplierLabel).toBe('1.00×');
    expect(street?.firstClearLabel).toBe('First clear available: +200 Coins');
    expect(pro?.firstClearLabel).toBe('First clear available: +350 Coins');
    expect(legend?.firstClearLabel).toBe('First clear available: +500 Coins');
    expect(pro?.constructionLabel).toContain('4 candidate teams');
    expect(legend?.constructionLabel).toContain('8 candidate teams');
    expect(street?.constructionLabel).toContain('specials 0.50×');
  });

  it('marks a cleared difficulty first clear as claimed', () => {
    const options = difficultyOptionViews(rules, ['pro']);
    const pro = options.find((option) => option.difficultyId === 'pro');
    expect(pro?.firstClearClaimed).toBe(true);
    expect(pro?.firstClearLabel).toBe('First clear claimed');
  });
});

describe('objective option views', () => {
  it('offers No objective first with no bonus and scales each offer bonus', () => {
    const offers = [
      {
        objectiveVersion: 'collection-objectives-v1' as const,
        objectiveId: 'obj-three-barrage-v1' as const,
        title: 'Three barrage',
        condition: { kind: 'player-team-three-pointers-made' as const, threshold: 12 },
      },
      {
        objectiveVersion: 'collection-objectives-v1' as const,
        objectiveId: 'obj-lock-score-v1' as const,
        title: 'Lock the score',
        condition: { kind: 'cpu-team-points-at-most' as const, threshold: 105 },
      },
      {
        objectiveVersion: 'collection-objectives-v1' as const,
        objectiveId: 'obj-ball-pressure-v1' as const,
        title: 'Ball pressure',
        condition: { kind: 'cpu-team-turnovers-at-least' as const, threshold: 14 },
      },
    ];
    const street = objectiveOptionViews({ offers, rules, difficultyId: 'street' });
    expect(street).toHaveLength(4);
    expect(street[0]).toMatchObject({ objectiveId: null, coinBonus: null });
    expect(street[1]?.coinBonus).toBe(30);
    expect(street[1]?.conditionLabel).toBe('Make at least 12 three-pointers as a team');
    const legend = objectiveOptionViews({ offers, rules, difficultyId: 'legend' });
    expect(legend[1]?.coinBonus).toBe(53);
  });
});

describe('reward preview', () => {
  it('matches the frozen launch maximums with half-up scaling', () => {
    const street = rewardPreview({
      rules,
      difficultyId: 'street',
      selectedObjectiveId: 'obj-three-barrage-v1',
      clearedDifficultyIds: [],
    });
    expect(street.winCoins).toBe(100);
    expect(street.lossCoins).toBe(10);
    expect(street.objectiveCoins).toBe(30);
    expect(street.marginMaxCoins).toBe(20);
    expect(street.firstClearCoins).toBe(200);
    expect(street.maxRepeatCoins).toBe(150);
    expect(street.maxTotalCoins).toBe(350);

    const pro = rewardPreview({
      rules,
      difficultyId: 'pro',
      selectedObjectiveId: 'obj-three-barrage-v1',
      clearedDifficultyIds: [],
    });
    expect(pro.winCoins).toBe(135);
    expect(pro.lossCoins).toBe(14);
    expect(pro.objectiveCoins).toBe(41);
    expect(pro.marginMaxCoins).toBe(27);
    expect(pro.firstClearCoins).toBe(350);
    expect(pro.maxRepeatCoins).toBe(203);
    expect(pro.maxTotalCoins).toBe(553);

    const legend = rewardPreview({
      rules,
      difficultyId: 'legend',
      selectedObjectiveId: 'obj-three-barrage-v1',
      clearedDifficultyIds: [],
    });
    expect(legend.winCoins).toBe(175);
    expect(legend.objectiveCoins).toBe(53);
    expect(legend.marginMaxCoins).toBe(35);
    expect(legend.maxRepeatCoins).toBe(263);
    expect(legend.maxTotalCoins).toBe(763);
  });

  it('drops the objective row when nothing is selected and zeroes a claimed first clear', () => {
    const preview = rewardPreview({
      rules,
      difficultyId: 'pro',
      selectedObjectiveId: null,
      clearedDifficultyIds: ['pro'],
    });
    expect(preview.objectiveCoins).toBeNull();
    expect(preview.rows.some((row) => row.kind === 'objective')).toBe(false);
    expect(preview.firstClearClaimed).toBe(true);
    expect(preview.firstClearCoins).toBe(0);
    expect(preview.maxTotalCoins).toBe(preview.maxRepeatCoins);
  });

  it('rejects unknown difficulties', () => {
    expect(() =>
      rewardPreview({
        rules,
        difficultyId: 'nightmare' as never,
        selectedObjectiveId: null,
        clearedDifficultyIds: [],
      }),
    ).toThrow('unknown difficulty');
  });
});
