import { describe, expect, it } from 'vitest';
import type { SeasonInjuryRollInput, SeasonInjuryRollResult } from '../index.ts';
import {
  rollPostseasonInjuryForPlayer,
  rollPostseasonRehabOutcome,
  rollSeasonInjuryForPlayer,
  rollSeasonRehabOutcome,
} from '../index.ts';

const TEST_SEED = 'a1b2c3d4e5f60718293a4b5c6d7e8f9a';

const BASE = {
  rootSeed: TEST_SEED,
  gameId: 's000123',
  franchiseId: 'lakers',
};

const LOW = {
  ...BASE,
  durabilityRating: 90,
  fatigueBasisPoints: 0,
  recentLoadBasisPoints: 0,
  targetMinutes: 8,
  recurrenceWindowRoundsRemaining: 0,
};

const HIGH = {
  ...BASE,
  durabilityRating: 20,
  fatigueBasisPoints: 20000,
  recentLoadBasisPoints: 5000,
  targetMinutes: 40,
  recurrenceWindowRoundsRemaining: 1,
};

type Case = readonly [label: string, input: SeasonInjuryRollInput];

const SEASON_CASES: readonly Case[] = [
  ['low exposure miss', { ...LOW, playerVersionId: 'pv-00000001' }],
  ['high exposure miss', { ...HIGH, playerVersionId: 'pv-00000001' }],
  ['minor same-game return', { ...HIGH, playerVersionId: 'pv-00000222' }],
  ['moderate recovery', { ...HIGH, playerVersionId: 'pv-00000278' }],
  ['major recovery', { ...HIGH, playerVersionId: 'pv-00000668' }],
  ['season ending', { ...HIGH, playerVersionId: 'pv-00004845' }],
];

const POSTSEASON_CASES: readonly Case[] = [
  ['low exposure miss', { ...LOW, playerVersionId: 'pv-00000001' }],
  ['high exposure miss', { ...HIGH, playerVersionId: 'pv-00000001' }],
  ['minor same-game return', { ...HIGH, playerVersionId: 'pv-00000352' }],
  ['moderate recovery', { ...HIGH, playerVersionId: 'pv-00000428' }],
  ['major recovery', { ...HIGH, playerVersionId: 'pv-00000739' }],
  ['season ending', { ...HIGH, playerVersionId: 'pv-00003215' }],
];

function summarize(result: SeasonInjuryRollResult): {
  riskBasisPoints: number;
  occurred: boolean;
  removalClock: { period: number; seconds: number } | null;
  returnClock: { period: number; seconds: number } | null;
  injuryId: string | null;
  severity: string | null;
  type: string | null;
  sameGameReturn: boolean | null;
  missedGamesTotal: number | null;
} {
  return {
    riskBasisPoints: result.riskBasisPoints,
    occurred: result.occurred,
    removalClock: result.removalClock,
    returnClock: result.returnClock,
    injuryId: result.injury?.injuryId ?? null,
    severity: result.injury?.severity ?? null,
    type: result.injury?.type ?? null,
    sameGameReturn: result.injury?.sameGameReturn ?? null,
    missedGamesTotal: result.injury?.missedGamesTotal ?? null,
  };
}

describe('season injury rolls', () => {
  it('pins the regular-season roll outcomes', () => {
    expect(
      SEASON_CASES.map(([label, input]) => [label, summarize(rollSeasonInjuryForPlayer(input))]),
    ).toMatchInlineSnapshot(`
      [
        [
          "low exposure miss",
          {
            "injuryId": null,
            "missedGamesTotal": null,
            "occurred": false,
            "removalClock": null,
            "returnClock": null,
            "riskBasisPoints": 70,
            "sameGameReturn": null,
            "severity": null,
            "type": null,
          },
        ],
        [
          "high exposure miss",
          {
            "injuryId": null,
            "missedGamesTotal": null,
            "occurred": false,
            "removalClock": null,
            "returnClock": null,
            "riskBasisPoints": 217,
            "sameGameReturn": null,
            "severity": null,
            "type": null,
          },
        ],
        [
          "minor same-game return",
          {
            "injuryId": "inj-f5bff7f5105f69f1347b38a76e90dd65",
            "missedGamesTotal": 0,
            "occurred": true,
            "removalClock": {
              "period": 2,
              "seconds": 101,
            },
            "returnClock": {
              "period": 4,
              "seconds": 601,
            },
            "riskBasisPoints": 217,
            "sameGameReturn": true,
            "severity": "minor",
            "type": "soft-tissue",
          },
        ],
        [
          "moderate recovery",
          {
            "injuryId": "inj-937edc0c555d5cf0b9b6fac254306afc",
            "missedGamesTotal": 5,
            "occurred": true,
            "removalClock": {
              "period": 3,
              "seconds": 444,
            },
            "returnClock": null,
            "riskBasisPoints": 217,
            "sameGameReturn": false,
            "severity": "moderate",
            "type": "lower-body",
          },
        ],
        [
          "major recovery",
          {
            "injuryId": "inj-c20425f3400b7b3fa601a0517df269a3",
            "missedGamesTotal": 16,
            "occurred": true,
            "removalClock": {
              "period": 1,
              "seconds": 375,
            },
            "returnClock": null,
            "riskBasisPoints": 217,
            "sameGameReturn": false,
            "severity": "major",
            "type": "illness",
          },
        ],
        [
          "season ending",
          {
            "injuryId": "inj-18a711caede4995e538b87c0df5725ba",
            "missedGamesTotal": 10000,
            "occurred": true,
            "removalClock": {
              "period": 1,
              "seconds": 368,
            },
            "returnClock": null,
            "riskBasisPoints": 217,
            "sameGameReturn": false,
            "severity": "season-ending",
            "type": "upper-body",
          },
        ],
      ]
    `);
  });

  it('pins the postseason roll outcomes', () => {
    expect(
      POSTSEASON_CASES.map(([label, input]) => [
        label,
        summarize(rollPostseasonInjuryForPlayer(input)),
      ]),
    ).toMatchInlineSnapshot(`
      [
        [
          "low exposure miss",
          {
            "injuryId": null,
            "missedGamesTotal": null,
            "occurred": false,
            "removalClock": null,
            "returnClock": null,
            "riskBasisPoints": 70,
            "sameGameReturn": null,
            "severity": null,
            "type": null,
          },
        ],
        [
          "high exposure miss",
          {
            "injuryId": null,
            "missedGamesTotal": null,
            "occurred": false,
            "removalClock": null,
            "returnClock": null,
            "riskBasisPoints": 217,
            "sameGameReturn": null,
            "severity": null,
            "type": null,
          },
        ],
        [
          "minor same-game return",
          {
            "injuryId": "inj-5f986d29aba5d5b56884a3ab0e45b499",
            "missedGamesTotal": 0,
            "occurred": true,
            "removalClock": {
              "period": 1,
              "seconds": 361,
            },
            "returnClock": {
              "period": 4,
              "seconds": 598,
            },
            "riskBasisPoints": 217,
            "sameGameReturn": true,
            "severity": "minor",
            "type": "illness",
          },
        ],
        [
          "moderate recovery",
          {
            "injuryId": "inj-a2f12951b4d634dd2b7e8b2f9b087601",
            "missedGamesTotal": 4,
            "occurred": true,
            "removalClock": {
              "period": 1,
              "seconds": 616,
            },
            "returnClock": null,
            "riskBasisPoints": 217,
            "sameGameReturn": false,
            "severity": "moderate",
            "type": "illness",
          },
        ],
        [
          "major recovery",
          {
            "injuryId": "inj-5175bf54d7443a403fbbc03ecb13d704",
            "missedGamesTotal": 11,
            "occurred": true,
            "removalClock": {
              "period": 3,
              "seconds": 233,
            },
            "returnClock": null,
            "riskBasisPoints": 217,
            "sameGameReturn": false,
            "severity": "major",
            "type": "upper-body",
          },
        ],
        [
          "season ending",
          {
            "injuryId": "inj-cf9ee44aef7a52b6c67658c4f24a1efa",
            "missedGamesTotal": 10000,
            "occurred": true,
            "removalClock": {
              "period": 2,
              "seconds": 19,
            },
            "returnClock": null,
            "riskBasisPoints": 217,
            "sameGameReturn": false,
            "severity": "season-ending",
            "type": "lower-body",
          },
        ],
      ]
    `);
  });

  it('pins the rehab rolls', () => {
    expect([
      rollSeasonRehabOutcome(TEST_SEED, 'inj-alpha'),
      rollSeasonRehabOutcome(TEST_SEED, 'inj-beta'),
      rollSeasonRehabOutcome(TEST_SEED, 'inj-gamma'),
      rollPostseasonRehabOutcome(TEST_SEED, 'inj-alpha'),
      rollPostseasonRehabOutcome(TEST_SEED, 'inj-beta'),
      rollPostseasonRehabOutcome(TEST_SEED, 'inj-gamma'),
    ]).toMatchInlineSnapshot(`
      [
        "success",
        "failure",
        "failure",
        "success",
        "success",
        "success",
      ]
    `);
  });

  it('applies the rehab premium only to the regular-season roll', () => {
    const base = rollSeasonInjuryForPlayer({ ...LOW, playerVersionId: 'pv-00000001' });
    const premium = rollSeasonInjuryForPlayer({
      ...LOW,
      playerVersionId: 'pv-00000001',
      rehabPremiumBasisPoints: 60,
    });
    expect(premium.riskBasisPoints - base.riskBasisPoints).toBe(60);
  });

  it('derives the same risk basis points for both namespaces', () => {
    for (const [, input] of [...SEASON_CASES, ...POSTSEASON_CASES]) {
      expect(rollPostseasonInjuryForPlayer(input).riskBasisPoints).toBe(
        rollSeasonInjuryForPlayer(input).riskBasisPoints,
      );
    }
  });
});
