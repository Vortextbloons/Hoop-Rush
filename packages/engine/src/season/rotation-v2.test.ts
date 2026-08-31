import { describe, expect, it } from 'vitest';
import {
  SEASON_MINUTE_POLICY_VERSION,
  SEASON_ROTATION_PRESET_TARGETS,
  SEASON_ROTATION_VERSION,
  seasonRotationCommandResultSchema,
  type Position,
  type SeasonRotation,
  type SeasonRotationPreset,
  type SetSeasonRotationCommand,
} from '@hoop-rush/data-contracts';
import type { SeasonRosterMemberInput } from './roster-rules.ts';
import {
  applySeasonRotationPreset,
  buildMinimalRotation,
  handleSetSeasonRotationCommand,
  rotationTargetMinutes,
  validateSeasonRotation,
} from './rotation.ts';
const pv = (n: number): string => `pv-${n.toString(16).padStart(32, '0')}`;
const g = (id: string, ...positions: Position[]): SeasonRosterMemberInput => ({
  playerVersionId: id,
  playable: positions,
});
const MEMBERS = [
  g(pv(1), 'PG'),
  g(pv(2), 'SG'),
  g(pv(3), 'SF'),
  g(pv(4), 'PF'),
  g(pv(5), 'C'),
  g(pv(6), 'PG', 'SG'),
  g(pv(7), 'SF', 'PF'),
  g(pv(8), 'PF', 'C'),
  g(pv(9), 'SF'),
  g(pv(10), 'C'),
];
const MEMBER_PLAYABLE = new Map(MEMBERS.map((member) => [member.playerVersionId, member.playable]));
const STARTERS = [pv(1), pv(2), pv(3), pv(4), pv(5)];
const BENCH = [pv(6), pv(7), pv(8), pv(9), pv(10)];
const BALANCED_TARGET_MINUTES = [33, 33, 33, 33, 33, 21, 18, 15, 12, 9] as const;
function buildRotation(overrides: Partial<SeasonRotation> = {}): SeasonRotation {
  return {
    franchiseId: 'lakers',
    starters: [...STARTERS],
    benchOrder: [...BENCH],
    targetMinutes: [
      ...STARTERS.map((playerVersionId) => ({ playerVersionId, minutes: 32 })),
      ...BENCH.map((playerVersionId) => ({ playerVersionId, minutes: 16 })),
    ],
    closingFive: [...STARTERS],
    minutePolicy: { policyVersion: SEASON_MINUTE_POLICY_VERSION, strategy: 'balanced' },
    rotationVersion: SEASON_ROTATION_VERSION,
    ...overrides,
  };
}
function presetCommand(
  preset: SeasonRotationPreset,
  franchiseId = 'lakers',
): SetSeasonRotationCommand {
  return {
    schemaVersion: 1,
    commandType: 'set-season-rotation',
    commandId: 'cmd-rotation-1',
    franchiseId,
    preset,
    rotation: null,
  };
}
function rotationCommand(rotation: SeasonRotation): SetSeasonRotationCommand {
  return {
    schemaVersion: 1,
    commandType: 'set-season-rotation',
    commandId: 'cmd-rotation-1',
    franchiseId: rotation.franchiseId,
    preset: null,
    rotation,
  };
}
describe('applySeasonRotationPreset (season-rotation-v2)', () => {
  it('applies the balanced table and preserves everything else', () => {
    const input = buildRotation();
    const result = applySeasonRotationPreset(input, 'balanced');
    expect(result.targetMinutes).toEqual(
      BALANCED_TARGET_MINUTES.map((minutes, index) => ({
        playerVersionId: pv(index + 1),
        minutes,
      })),
    );
    expect(rotationTargetMinutes(result)).toBe(240);
    expect(result.starters).toEqual(input.starters);
    expect(result.benchOrder).toEqual(input.benchOrder);
    expect(result.closingFive).toEqual(input.closingFive);
    expect(result.franchiseId).toBe(input.franchiseId);
    expect(result.rotationVersion).toBe(SEASON_ROTATION_VERSION);
    expect(input.targetMinutes).toEqual([
      ...STARTERS.map((playerVersionId) => ({ playerVersionId, minutes: 32 })),
      ...BENCH.map((playerVersionId) => ({ playerVersionId, minutes: 16 })),
    ]);
  });
  it('applies the tight and bench-heavy tables', () => {
    const tight = applySeasonRotationPreset(buildRotation(), 'tight');
    expect(tight.targetMinutes.map((entry) => entry.minutes)).toEqual([
      37, 37, 37, 37, 37, 20, 14, 9, 7, 5,
    ]);
    const heavy = applySeasonRotationPreset(buildRotation(), 'bench-heavy');
    expect(heavy.targetMinutes.map((entry) => entry.minutes)).toEqual([
      29, 29, 29, 29, 29, 23, 21, 19, 17, 15,
    ]);
  });
  it('every preset totals exactly 240 and matches the frozen tables', () => {
    for (const preset of ['balanced', 'tight', 'bench-heavy'] as const) {
      const result = applySeasonRotationPreset(buildRotation(), preset);
      expect(rotationTargetMinutes(result)).toBe(240);
      const table = SEASON_ROTATION_PRESET_TARGETS[preset];
      if (preset === 'balanced') {
        expect([...STARTERS.map(() => table.starters), ...table.bench]).toEqual(
          BALANCED_TARGET_MINUTES,
        );
      }
      for (const starter of STARTERS) {
        expect(
          result.targetMinutes.find((entry) => entry.playerVersionId === starter)?.minutes,
        ).toBe(table.starters);
      }
      BENCH.forEach((playerVersionId, index) => {
        expect(
          result.targetMinutes.find((entry) => entry.playerVersionId === playerVersionId)?.minutes,
        ).toBe(table.bench[index]);
      });
    }
  });
  it('preserves an independent closing five under preset application', () => {
    const closing = [pv(1), pv(2), pv(8), pv(4), pv(10)];
    const input = buildRotation({ closingFive: closing });
    const result = applySeasonRotationPreset(input, 'balanced');
    expect(result.closingFive).toEqual(closing);
  });
});
describe('validateSeasonRotation (season-rotation-v2)', () => {
  it('accepts a legal v2 rotation', () => {
    expect(validateSeasonRotation(buildRotation(), MEMBER_PLAYABLE)).toEqual([]);
  });
  it('accepts an independent closing five that includes bench players', () => {
    const rotation = buildRotation({ closingFive: [pv(1), pv(2), pv(8), pv(4), pv(10)] });
    expect(validateSeasonRotation(rotation, MEMBER_PLAYABLE)).toEqual([]);
  });
  it('rejects duplicate ids in the partition and in target minutes', () => {
    const duplicatePartition = buildRotation({
      starters: [pv(1), pv(1), pv(3), pv(4), pv(5)],
    });
    const failures = validateSeasonRotation(duplicatePartition, MEMBER_PLAYABLE);
    expect(failures.some((failure) => failure.includes('duplicate players'))).toBe(true);
    const duplicateMinutes = buildRotation();
    duplicateMinutes.targetMinutes = [
      ...STARTERS.map((playerVersionId) => ({ playerVersionId, minutes: 32 })),
      ...BENCH.map((playerVersionId) => ({ playerVersionId, minutes: 16 })),
    ];
    duplicateMinutes.targetMinutes[5] = { playerVersionId: pv(5), minutes: 16 };
    const minuteFailures = validateSeasonRotation(duplicateMinutes, MEMBER_PLAYABLE);
    expect(minuteFailures.some((failure) => failure.includes('duplicate players'))).toBe(true);
  });
  it('rejects foreign ids and missing roster coverage', () => {
    const foreign = buildRotation({ starters: [pv(1), pv(2), pv(3), pv(4), pv(99)] });
    const foreignFailures = validateSeasonRotation(foreign, MEMBER_PLAYABLE);
    expect(foreignFailures.some((failure) => failure.includes(`unrostered player ${pv(99)}`))).toBe(
      true,
    );
    const missing = buildRotation();
    missing.targetMinutes = [
      ...STARTERS.slice(0, 4).map((playerVersionId) => ({ playerVersionId, minutes: 32 })),
      ...BENCH.map((playerVersionId) => ({ playerVersionId, minutes: 16 })),
    ];
    const missingFailures = validateSeasonRotation(missing, MEMBER_PLAYABLE);
    expect(
      missingFailures.some((failure) =>
        failure.includes(`no target minutes for rostered player ${pv(5)}`),
      ),
    ).toBe(true);
    expect(missingFailures.some((failure) => failure.includes('must total 240'))).toBe(true);
    const foreignMinutes = buildRotation();
    foreignMinutes.targetMinutes = [
      ...STARTERS.map((playerVersionId) => ({ playerVersionId, minutes: 32 })),
      ...BENCH.slice(0, 4).map((playerVersionId) => ({ playerVersionId, minutes: 16 })),
      { playerVersionId: pv(98), minutes: 16 },
    ];
    const foreignMinuteFailures = validateSeasonRotation(foreignMinutes, MEMBER_PLAYABLE);
    expect(
      foreignMinuteFailures.some((failure) => failure.includes(`unrostered player ${pv(98)}`)),
    ).toBe(true);
    expect(
      foreignMinuteFailures.some((failure) =>
        failure.includes(`no target minutes for rostered player ${pv(10)}`),
      ),
    ).toBe(true);
  });
  it.each([
    [15.5, 'integer from 0-48'],
    [49, '0-48'],
    [-1, '0-48'],
    [15, 'must total 240'],
  ] as const)('rejects target minutes of %s', (minutes, expectedMessage) => {
    const rotation = buildRotation();
    rotation.targetMinutes = [
      ...STARTERS.map((playerVersionId) => ({ playerVersionId, minutes: 32 })),
      ...BENCH.slice(0, 4).map((playerVersionId) => ({ playerVersionId, minutes: 16 })),
      { playerVersionId: pv(10), minutes },
    ];
    expect(
      validateSeasonRotation(rotation, MEMBER_PLAYABLE).some((failure) =>
        failure.includes(expectedMessage),
      ),
    ).toBe(true);
  });
  it('rejects illegal starter slots', () => {
    const rotation = buildRotation({ starters: [pv(1), pv(2), pv(3), pv(5), pv(4)] });
    const failures = validateSeasonRotation(rotation, MEMBER_PLAYABLE);
    expect(
      failures.some((failure) => failure.includes(`starter ${pv(5)} cannot play slot 3`)),
    ).toBe(true);
  });
  it('rejects an illegal closing five, including one equal to illegal starters', () => {
    const illegal = [pv(1), pv(2), pv(3), pv(5), pv(4)];
    const rotation = buildRotation({ starters: illegal, closingFive: illegal });
    const failures = validateSeasonRotation(rotation, MEMBER_PLAYABLE);
    expect(
      failures.some((failure) => failure.includes(`starter ${pv(5)} cannot play slot 3`)),
    ).toBe(true);
    expect(
      failures.some((failure) =>
        failure.includes(`closing-five player ${pv(5)} cannot play slot 3`),
      ),
    ).toBe(true);
  });
  it('rejects closing-five slot violations and foreign closing members', () => {
    const wrongSlot = buildRotation({ closingFive: [pv(1), pv(2), pv(3), pv(4), pv(6)] });
    const slotFailures = validateSeasonRotation(wrongSlot, MEMBER_PLAYABLE);
    expect(
      slotFailures.some((failure) =>
        failure.includes(`closing-five player ${pv(6)} cannot play slot 4`),
      ),
    ).toBe(true);
    const foreign = buildRotation({ closingFive: [pv(1), pv(2), pv(3), pv(4), pv(97)] });
    const foreignFailures = validateSeasonRotation(foreign, MEMBER_PLAYABLE);
    expect(foreignFailures.some((failure) => failure.includes(`unrostered player ${pv(97)}`))).toBe(
      true,
    );
  });
  it('rejects duplicate closing-five members', () => {
    const rotation = buildRotation({ closingFive: [pv(1), pv(2), pv(3), pv(4), pv(1)] });
    const failures = validateSeasonRotation(rotation, MEMBER_PLAYABLE);
    expect(failures.some((failure) => failure.includes('five distinct players'))).toBe(true);
  });
});
describe('handleSetSeasonRotationCommand (season-rotation-v2)', () => {
  it('accepts preset commands with the exact preset table and a derived base rotation', () => {
    const result = handleSetSeasonRotationCommand(presetCommand('balanced'), MEMBER_PLAYABLE);
    expect(result.status).toBe('accepted');
    if (result.status !== 'accepted') throw new Error('expected accepted');
    expect(result.franchiseId).toBe('lakers');
    expect(result.rotation.starters).toEqual(STARTERS);
    expect(result.rotation.benchOrder).toEqual(BENCH);
    expect(result.rotation.closingFive).toEqual(STARTERS);
    expect(result.rotation.targetMinutes).toEqual(
      BALANCED_TARGET_MINUTES.map((minutes, index) => ({
        playerVersionId: pv(index + 1),
        minutes,
      })),
    );
    expect(rotationTargetMinutes(result.rotation)).toBe(240);
    expect(seasonRotationCommandResultSchema.safeParse(result).success).toBe(true);
  });
  it('accepts tight and bench-heavy presets with 240-minute tables', () => {
    for (const preset of ['tight', 'bench-heavy'] as const) {
      const result = handleSetSeasonRotationCommand(presetCommand(preset), MEMBER_PLAYABLE);
      expect(result.status).toBe('accepted');
      if (result.status !== 'accepted') throw new Error('expected accepted');
      expect(rotationTargetMinutes(result.rotation)).toBe(240);
      const table = SEASON_ROTATION_PRESET_TARGETS[preset];
      result.rotation.starters.forEach((playerVersionId) => {
        expect(
          result.rotation.targetMinutes.find((entry) => entry.playerVersionId === playerVersionId)
            ?.minutes,
        ).toBe(table.starters);
      });
      expect(seasonRotationCommandResultSchema.safeParse(result).success).toBe(true);
    }
  });
  it('accepts explicit rotations wholesale', () => {
    const rotation = buildRotation({ closingFive: [pv(1), pv(2), pv(8), pv(4), pv(10)] });
    const result = handleSetSeasonRotationCommand(rotationCommand(rotation), MEMBER_PLAYABLE);
    expect(result).toEqual({
      status: 'accepted',
      commandId: 'cmd-rotation-1',
      franchiseId: 'lakers',
      rotation,
    });
    expect(seasonRotationCommandResultSchema.safeParse(result).success).toBe(true);
  });
  it('rejects schema-invalid commands before handling', () => {
    const neither: SetSeasonRotationCommand = {
      ...presetCommand('balanced'),
      preset: null,
    };
    const resultNeither = handleSetSeasonRotationCommand(neither, MEMBER_PLAYABLE);
    expect(resultNeither).toMatchObject({
      status: 'rejected',
      errorCode: 'INVALID_TARGETS',
      message: 'set-season-rotation needs a preset or rotation',
    });
    const both: SetSeasonRotationCommand = {
      ...presetCommand('balanced'),
      rotation: buildRotation(),
    };
    const resultBoth = handleSetSeasonRotationCommand(both, MEMBER_PLAYABLE);
    expect(resultBoth).toMatchObject({
      status: 'rejected',
      errorCode: 'INVALID_TARGETS',
      message: 'set-season-rotation takes preset or rotation, not both',
    });
  });
  it('maps duplicate ids to DUPLICATE_PLAYER_VERSION', () => {
    const duplicate = buildRotation({ starters: [pv(1), pv(1), pv(3), pv(4), pv(5)] });
    const result = handleSetSeasonRotationCommand(rotationCommand(duplicate), MEMBER_PLAYABLE);
    expect(result).toMatchObject({ status: 'rejected', errorCode: 'DUPLICATE_PLAYER_VERSION' });
    const duplicateMinutes = buildRotation();
    duplicateMinutes.targetMinutes[5] = { playerVersionId: pv(5), minutes: 16 };
    const minuteResult = handleSetSeasonRotationCommand(
      rotationCommand(duplicateMinutes),
      MEMBER_PLAYABLE,
    );
    expect(minuteResult).toMatchObject({
      status: 'rejected',
      errorCode: 'DUPLICATE_PLAYER_VERSION',
    });
  });
  it('maps roster correspondence failures to ROSTER_MISMATCH', () => {
    const foreign = buildRotation({ starters: [pv(1), pv(2), pv(3), pv(4), pv(99)] });
    expect(handleSetSeasonRotationCommand(rotationCommand(foreign), MEMBER_PLAYABLE)).toMatchObject(
      {
        status: 'rejected',
        errorCode: 'ROSTER_MISMATCH',
      },
    );
    const missingMinutes = buildRotation();
    missingMinutes.targetMinutes = [
      ...STARTERS.slice(0, 4).map((playerVersionId) => ({ playerVersionId, minutes: 32 })),
      ...BENCH.map((playerVersionId) => ({ playerVersionId, minutes: 16 })),
    ];
    expect(
      handleSetSeasonRotationCommand(rotationCommand(missingMinutes), MEMBER_PLAYABLE),
    ).toMatchObject({
      status: 'rejected',
      errorCode: 'ROSTER_MISMATCH',
    });
  });
  it('maps target value failures to INVALID_TARGETS', () => {
    const short = buildRotation();
    short.targetMinutes[9] = { playerVersionId: pv(10), minutes: 15 };
    expect(handleSetSeasonRotationCommand(rotationCommand(short), MEMBER_PLAYABLE)).toMatchObject({
      status: 'rejected',
      errorCode: 'INVALID_TARGETS',
    });
    const tooHigh = buildRotation();
    tooHigh.targetMinutes[9] = { playerVersionId: pv(10), minutes: 49 };
    expect(handleSetSeasonRotationCommand(rotationCommand(tooHigh), MEMBER_PLAYABLE)).toMatchObject(
      {
        status: 'rejected',
        errorCode: 'INVALID_TARGETS',
      },
    );
    const nonInteger = buildRotation();
    nonInteger.targetMinutes[9] = { playerVersionId: pv(10), minutes: 15.5 };
    expect(
      handleSetSeasonRotationCommand(rotationCommand(nonInteger), MEMBER_PLAYABLE),
    ).toMatchObject({
      status: 'rejected',
      errorCode: 'INVALID_TARGETS',
    });
  });
  it('maps starter slot violations to ILLEGAL_STARTERS (before closing-five checks)', () => {
    const illegalStarters = [pv(1), pv(2), pv(3), pv(5), pv(4)];
    const rotation = buildRotation({ starters: illegalStarters, closingFive: illegalStarters });
    const result = handleSetSeasonRotationCommand(rotationCommand(rotation), MEMBER_PLAYABLE);
    expect(result).toMatchObject({ status: 'rejected', errorCode: 'ILLEGAL_STARTERS' });
  });
  it('maps closing-five violations to ILLEGAL_CLOSING_FIVE', () => {
    const rotation = buildRotation({ closingFive: [pv(1), pv(2), pv(3), pv(4), pv(6)] });
    expect(
      handleSetSeasonRotationCommand(rotationCommand(rotation), MEMBER_PLAYABLE),
    ).toMatchObject({
      status: 'rejected',
      errorCode: 'ILLEGAL_CLOSING_FIVE',
    });
  });
  it('rejects presets against rosters that cannot field a legal five', () => {
    const noFive = new Map<string, readonly Position[]>();
    for (let i = 1; i <= 10; i += 1) noFive.set(pv(i), ['C']);
    const result = handleSetSeasonRotationCommand(presetCommand('balanced'), noFive);
    expect(result).toMatchObject({ status: 'rejected', errorCode: 'ILLEGAL_STARTERS' });
  });
  it('rejects presets against rosters of the wrong size', () => {
    const nine = new Map(
      MEMBERS.slice(0, 9).map((member) => [member.playerVersionId, member.playable]),
    );
    const result = handleSetSeasonRotationCommand(presetCommand('balanced'), nine);
    expect(result).toMatchObject({ status: 'rejected', errorCode: 'ROSTER_MISMATCH' });
  });
  it('reports stable messages and schema-valid results on every rejection path', () => {
    const badRotations: SeasonRotation[] = [
      buildRotation({ starters: [pv(1), pv(1), pv(3), pv(4), pv(5)] }),
      buildRotation({ starters: [pv(1), pv(2), pv(3), pv(4), pv(99)] }),
      buildRotation({ closingFive: [pv(1), pv(2), pv(3), pv(4), pv(6)] }),
    ];
    for (const rotation of badRotations) {
      const first = handleSetSeasonRotationCommand(rotationCommand(rotation), MEMBER_PLAYABLE);
      const second = handleSetSeasonRotationCommand(rotationCommand(rotation), MEMBER_PLAYABLE);
      expect(first).toEqual(second);
      if (first.status === 'rejected') {
        expect(first.message.length).toBeGreaterThan(0);
        expect(first.message.length).toBeLessThanOrEqual(512);
        expect(seasonRotationCommandResultSchema.safeParse(first).success).toBe(true);
      }
    }
  });
});
describe('buildMinimalRotation under season-rotation-v2', () => {
  it('still produces a legal v2 rotation with the starters as the closing five', () => {
    const rotation = buildMinimalRotation({ franchiseId: 'lakers', members: MEMBERS });
    expect(rotation.rotationVersion).toBe(SEASON_ROTATION_VERSION);
    expect(rotation.closingFive).toEqual(rotation.starters);
    expect(rotationTargetMinutes(rotation)).toBe(240);
    expect(validateSeasonRotation(rotation, MEMBER_PLAYABLE)).toEqual([]);
    expect(applySeasonRotationPreset(rotation, 'balanced').targetMinutes).toHaveLength(10);
  });
});
