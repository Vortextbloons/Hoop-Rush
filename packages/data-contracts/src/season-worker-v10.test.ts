import { describe, expect, it } from 'vitest';
import {
  SEASON_WORKER_WIRE_SCHEMA_VERSION,
  seasonWorkerMessageSchema,
  seasonWorkerProgressMessageSchema,
} from './season-worker.ts';

function scoreline(
  gameId: string,
  home: string,
  away: string,
  homeScore: number,
  awayScore: number,
) {
  return { gameId, homeFranchiseId: home, homeScore, awayScore, awayFranchiseId: away };
}

function validProgress(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: SEASON_WORKER_WIRE_SCHEMA_VERSION,
    type: 'season-block-progress',
    requestId: 'req-1',
    blockIndex: 0,
    gamesCompleted: 3,
    gamesTotal: 150,
    latestGameId: 's000003',
    latestResult: scoreline('s000003', 'lakers', 'celtics', 112, 108),
    isHumanGame: true,
    humanRecordInBlock: { wins: 2, losses: 1 },
    humanResults: [
      scoreline('s000001', 'lakers', 'celtics', 110, 100),
      scoreline('s000002', 'bulls', 'lakers', 105, 100),
      scoreline('s000003', 'lakers', 'celtics', 112, 108),
    ],
    leaguePulse: {
      closest: scoreline('s000003', 'lakers', 'celtics', 112, 108),
      blowout: scoreline('s000001', 'lakers', 'celtics', 110, 100),
      highestScoring: scoreline('s000003', 'lakers', 'celtics', 112, 108),
    },
    ...overrides,
  };
}

describe('season worker wire v10', () => {
  it('pins the wire version to 10', () => {
    expect(SEASON_WORKER_WIRE_SCHEMA_VERSION).toBe(10);
  });

  it('parses a valid v10 progress message with human results and league pulse', () => {
    const parsed = seasonWorkerProgressMessageSchema.parse(validProgress());
    expect(parsed.isHumanGame).toBe(true);
    expect(parsed.humanRecordInBlock).toEqual({ wins: 2, losses: 1 });
    expect(parsed.humanResults).toHaveLength(3);
    expect(parsed.leaguePulse.closest?.gameId).toBe('s000003');
    expect(parsed.leaguePulse.blowout?.gameId).toBe('s000001');
    const routed = seasonWorkerMessageSchema.parse(validProgress());
    expect(routed.type).toBe('season-block-progress');
  });

  it('accepts empty pulse and empty human results before any final', () => {
    const parsed = seasonWorkerProgressMessageSchema.parse(
      validProgress({
        gamesCompleted: 0,
        latestGameId: null,
        latestResult: null,
        isHumanGame: false,
        humanRecordInBlock: { wins: 0, losses: 0 },
        humanResults: [],
        leaguePulse: { closest: null, blowout: null, highestScoring: null },
      }),
    );
    expect(parsed.humanResults).toEqual([]);
    expect(parsed.leaguePulse.closest).toBeNull();
  });

  it('rejects malformed v10 progress messages', () => {
    expect(() =>
      seasonWorkerProgressMessageSchema.parse(validProgress({ isHumanGame: undefined })),
    ).toThrow();
    expect(() =>
      seasonWorkerProgressMessageSchema.parse(
        validProgress({ humanRecordInBlock: { wins: -1, losses: 0 } }),
      ),
    ).toThrow();
    expect(() =>
      seasonWorkerProgressMessageSchema.parse(
        validProgress({
          humanResults: Array.from({ length: 11 }, (_, i) =>
            scoreline(`s0000${String(i + 10)}`, 'lakers', 'celtics', 100 + i, 90),
          ),
        }),
      ),
    ).toThrow();
    expect(() =>
      seasonWorkerProgressMessageSchema.parse(validProgress({ leaguePulse: { closest: null } })),
    ).toThrow();
    expect(() =>
      seasonWorkerProgressMessageSchema.parse(validProgress({ schemaVersion: 9 })),
    ).toThrow();
    expect(seasonWorkerMessageSchema.safeParse(validProgress({ schemaVersion: 9 })).success).toBe(
      false,
    );
  });
});
