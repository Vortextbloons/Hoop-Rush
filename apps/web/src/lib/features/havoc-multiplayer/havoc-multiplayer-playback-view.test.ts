import { describe, expect, it } from 'vitest';
import {
  havocBattleEventSchema,
  havocBattleResultSchema,
  havocBattleScoringEntrySchema,
  seedFromString,
  type HavocBattleResult,
  type Position,
} from '@hoop-rush/data-contracts';
import { buildHavocParticipantLine, buildHavocStatLine } from '@hoop-rush/test-fixtures';
import type { HavocMultiplayerVisibleState } from './havoc-multiplayer-playback';
import {
  havocMultiplayerFinalBoxes,
  havocMultiplayerLiveBoxes,
} from './havoc-multiplayer-playback-view';

const DIGEST = 'a'.repeat(32);

function instanceId(index: number): string {
  return `hvi-${(index + 16).toString(16).padStart(32, '0')}`;
}

const POSITIONS: readonly Position[] = ['PG', 'SG', 'SF', 'PF', 'C'];

interface FixtureParticipant {
  instanceId: string;
  kind: 'starter' | 'replacement' | 'clone';
  slot: Position;
  ownerInstanceId: string | null;
  displayName: string;
  points: number;
}

function fixtureParticipants(prefix: string, offset: number): FixtureParticipant[] {
  const starters: FixtureParticipant[] = POSITIONS.map((slot, index) => ({
    instanceId: instanceId(offset + index),
    kind: 'starter',
    slot,
    ownerInstanceId: null,
    displayName: `${prefix} Starter ${String(index + 1)}`,
    points: 10 - index,
  }));
  return [
    ...starters,
    {
      instanceId: instanceId(offset + 10),
      kind: 'replacement',
      slot: 'SF',
      ownerInstanceId: starters[2]?.instanceId ?? null,
      displayName: `${prefix} Replacement`,
      points: 4,
    },
    {
      instanceId: instanceId(offset + 11),
      kind: 'clone',
      slot: 'PG',
      ownerInstanceId: starters[0]?.instanceId ?? null,
      displayName: `${prefix} Clone`,
      points: 7,
    },
  ];
}

function teamOf(
  side: 'home' | 'away',
  prefix: string,
  offset: number,
  points: number,
  teamBonusPoints: number,
) {
  const participants = fixtureParticipants(prefix, offset).map((participant) =>
    buildHavocParticipantLine({
      ...buildHavocStatLine({
        points: participant.points,
        adjustments: participant.kind === 'replacement' ? -2 : 0,
      }),
      instanceId: participant.instanceId,
      kind: participant.kind,
      slot: participant.slot,
      ownerInstanceId: participant.ownerInstanceId,
      displayName: participant.displayName,
    }),
  );
  return {
    side,
    teamId: `${side}-team`,
    displayName: `${prefix} Five`,
    points,
    fieldGoals: { made: 30, attempted: 70 },
    threes: { made: 8, attempted: 24 },
    freeThrows: { made: 10, attempted: 12 },
    rebounds: { total: 40, offensive: 8, defensive: 30, team: 2 },
    assists: 20,
    steals: 6,
    blocks: 3,
    turnovers: 11,
    fouls: 18,
    adjustments: -2,
    teamBonusPoints,
    periods: [points, 0, 0, 0],
    courtSeconds: 2400,
    participants,
  };
}

function buildResult(): HavocBattleResult {
  return havocBattleResultSchema.parse({
    schemaVersion: 1,
    gameNumber: 1,
    variant: 'havoc',
    seed: seedFromString('havoc-multiplayer-playback-view'),
    engineVersion: 'm3-engine-v24',
    rulesVersion: 'havoc-rules-v5',
    mutationCatalogVersion: 'havoc-mutations-v5',
    profileVersion: 'profile-v1',
    dataVersion: 'data-v1',
    home: teamOf('home', 'Home', 0, -3, 4),
    away: teamOf('away', 'Away', 32, 41, 2),
    winner: 'away',
    overtimePeriods: 0,
    inputDigest: DIGEST,
    rollups: [],
    highlights: [],
  });
}

function scoringEntry(overrides: Record<string, unknown>) {
  return havocBattleScoringEntrySchema.parse({
    sequence: 0,
    gameNumber: 1,
    period: 1,
    clockSeconds: 700,
    possessionId: 1,
    side: 'home',
    kind: 'field-goal',
    actorInstanceId: instanceId(0),
    beneficiaryInstanceId: null,
    nominalPoints: 2,
    addends: [],
    multipliers: [],
    points: 2,
    owners: [],
    originalEventSequence: null,
    ...overrides,
  });
}

function emptyVisible(): HavocMultiplayerVisibleState {
  return { homeScore: 0, awayScore: 0, period: 1, clockSeconds: 720, events: [], scoring: [] };
}

describe('havoc multiplayer playback view', () => {
  it('folds visible scoring into participant lines with adjustments, bonuses, and negative totals', () => {
    const result = buildResult();
    const visible: HavocMultiplayerVisibleState = {
      ...emptyVisible(),
      homeScore: -3,
      awayScore: 3,
      scoring: [
        scoringEntry({ sequence: 0, points: 2, actorInstanceId: instanceId(0) }),
        scoringEntry({
          sequence: 1,
          side: 'away',
          actorInstanceId: instanceId(32),
          points: 3,
          nominalPoints: 3,
        }),
        scoringEntry({
          sequence: 2,
          kind: 'adjustment',
          actorInstanceId: instanceId(1),
          points: -5,
          nominalPoints: -1,
        }),
        scoringEntry({
          sequence: 3,
          kind: 'bonus',
          actorInstanceId: instanceId(0),
          points: 4,
          nominalPoints: 0,
        }),
        scoringEntry({
          sequence: 4,
          kind: 'bonus',
          side: 'away',
          actorInstanceId: instanceId(32),
          points: 2,
          nominalPoints: 0,
        }),
      ],
    };

    const boxes = havocMultiplayerLiveBoxes(result, visible);
    const home = boxes.find((box) => box.side === 'home');
    const away = boxes.find((box) => box.side === 'away');
    expect(home?.score).toBe(1);
    expect(home?.bonusPoints).toBe(4);
    expect(away?.score).toBe(5);
    expect(away?.bonusPoints).toBe(2);

    const homeStarter = home?.lines.find((line) => line.instanceId === instanceId(0));
    expect(homeStarter?.points).toBe(2);
    const homeAdjustment = home?.lines.find((line) => line.instanceId === instanceId(1));
    expect(homeAdjustment?.points).toBe(-5);
    expect(homeAdjustment?.adjustments).toBe(-5);
    const awayStarter = away?.lines.find((line) => line.instanceId === instanceId(32));
    expect(awayStarter?.points).toBe(3);
  });

  it('folds visible events into starter, replacement, and clone lines', () => {
    const result = buildResult();
    const visible: HavocMultiplayerVisibleState = {
      ...emptyVisible(),
      events: [
        havocBattleEventSchema.parse({
          kind: 'shot-attempt',
          sequence: 0,
          gameNumber: 1,
          period: 1,
          clockSeconds: 700,
          possessionId: 1,
          shooterInstanceId: instanceId(0),
          side: 'home',
          zone: 'rim',
          shotKind: 'layup',
          made: true,
          nominalPoints: 2,
        }),
        havocBattleEventSchema.parse({
          kind: 'free-throw-attempt',
          sequence: 1,
          gameNumber: 1,
          period: 1,
          clockSeconds: 680,
          possessionId: 2,
          shooterInstanceId: instanceId(11),
          side: 'home',
          made: true,
          bonus: false,
        }),
        havocBattleEventSchema.parse({
          kind: 'rebound',
          sequence: 2,
          gameNumber: 1,
          period: 1,
          clockSeconds: 660,
          possessionId: 3,
          playerInstanceId: instanceId(10),
          side: 'home',
          offensive: true,
        }),
        havocBattleEventSchema.parse({
          kind: 'turnover',
          sequence: 3,
          gameNumber: 1,
          period: 1,
          clockSeconds: 640,
          possessionId: 4,
          playerInstanceId: instanceId(2),
          side: 'home',
        }),
        havocBattleEventSchema.parse({
          kind: 'turnover-cancelled',
          sequence: 4,
          gameNumber: 1,
          period: 1,
          clockSeconds: 640,
          possessionId: 4,
          playerInstanceId: instanceId(2),
          side: 'home',
          originalSequence: 3,
        }),
        havocBattleEventSchema.parse({
          kind: 'foul',
          sequence: 5,
          gameNumber: 1,
          period: 1,
          clockSeconds: 600,
          possessionId: 5,
          foulerInstanceId: instanceId(11),
          side: 'home',
          shooting: false,
          shooterInstanceId: null,
          freeThrowsAwarded: 0,
          technicalFreeThrows: 0,
        }),
      ],
    };

    const home = havocMultiplayerLiveBoxes(result, visible).find((box) => box.side === 'home');
    const starter = home?.lines.find((line) => line.instanceId === instanceId(0));
    expect(starter?.fieldGoalsMade).toBe(1);
    expect(starter?.fieldGoalsAttempted).toBe(1);
    const replacement = home?.lines.find((line) => line.instanceId === instanceId(10));
    expect(replacement?.kind).toBe('replacement');
    expect(replacement?.rebounds).toBe(1);
    const clone = home?.lines.find((line) => line.instanceId === instanceId(11));
    expect(clone?.kind).toBe('clone');
    expect(clone?.freeThrowsMade).toBe(1);
    expect(clone?.fouls).toBe(1);
    const cancelled = home?.lines.find((line) => line.instanceId === instanceId(2));
    expect(cancelled?.turnovers).toBe(0);
  });

  it('creates a fallback line for scoring actors missing from the result roster', () => {
    const result = buildResult();
    const visible: HavocMultiplayerVisibleState = {
      ...emptyVisible(),
      scoring: [scoringEntry({ sequence: 0, actorInstanceId: instanceId(99), points: -1 })],
    };
    const home = havocMultiplayerLiveBoxes(result, visible).find((box) => box.side === 'home');
    const fallback = home?.lines.find((line) => line.instanceId === instanceId(99));
    expect(fallback?.points).toBe(-1);
    expect(fallback?.displayName).toContain('Instance');
  });

  it('copies final result lines, preserving negative totals and team bonuses', () => {
    const result = buildResult();
    const boxes = havocMultiplayerFinalBoxes(result);
    const home = boxes.find((box) => box.side === 'home');
    expect(home?.score).toBe(-3);
    expect(home?.bonusPoints).toBe(4);
    expect(home?.lines).toHaveLength(7);
    expect(home?.lines.find((line) => line.instanceId === instanceId(1))?.points).toBe(9);
    const replacement = home?.lines.find((line) => line.instanceId === instanceId(10));
    expect(replacement?.adjustments).toBe(-2);
    expect(replacement?.kind).toBe('replacement');
    const clone = home?.lines.find((line) => line.instanceId === instanceId(11));
    expect(clone?.kind).toBe('clone');
    expect(clone?.ownerInstanceId).toBe(instanceId(0));
  });
});
