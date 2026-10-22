import { z } from 'zod';
import { playerIdSchema, seedSchema } from './ids.ts';
import { POSITIONS, positionSchema } from './positions.ts';
import { eraSimulationProfileSchema } from './era-sim-profile.ts';
import { madeAttemptedSchema, shotZoneSchema } from './result.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import {
  HAVOC_MUTATION_CATALOG_VERSION,
  HAVOC_RULES_VERSION,
  HAVOC_SCHEMA_VERSION,
  havocDigestSchema,
  havocVersionSetSchema,
} from './havoc-versions.ts';
import {
  havocEffectiveProfileSchema,
  havocInstanceIdSchema,
  havocSourcePlayerSchema,
} from './havoc-profile.ts';
import {
  HAVOC_TEAM_EXCLUSIVE_MUTATION_IDS,
  havocMutationIdSchema,
  havocMutationPackageSchema,
} from './havoc-mutations.ts';

export const havocSideSchema = z.enum(['human', 'opponent']);
export type HavocSide = z.infer<typeof havocSideSchema>;
export const havocHomeAwaySchema = z.enum(['home', 'away']);
export type HavocHomeAway = z.infer<typeof havocHomeAwaySchema>;
export const havocVariantSchema = z.enum(['havoc', 'normal']);
export type HavocVariant = z.infer<typeof havocVariantSchema>;
export const havocParticipantKindSchema = z.enum(['starter', 'replacement', 'clone']);
export type HavocParticipantKind = z.infer<typeof havocParticipantKindSchema>;
export const havocShotKindSchema = z.enum(['layup', 'dunk', 'jumper']);
export type HavocShotKind = z.infer<typeof havocShotKindSchema>;

export const havocParticipantSchema = z.object({
  instanceId: havocInstanceIdSchema,
  kind: havocParticipantKindSchema,
  slot: positionSchema,
  ownerInstanceId: havocInstanceIdSchema.nullable(),
  mutationPackage: havocMutationPackageSchema,
  source: havocSourcePlayerSchema,
  effective: havocEffectiveProfileSchema,
});
export type HavocParticipant = z.infer<typeof havocParticipantSchema>;

export function buildHavocTeamInputSchema<TSide extends string>(sideSchema: z.ZodType<TSide>) {
  return z
    .object({
      side: sideSchema,
      teamId: z.string().min(1).max(64),
      displayName: z.string().min(1).max(96),
      starters: z.array(havocParticipantSchema).length(5),
      replacements: z.array(havocParticipantSchema).length(5),
      clones: z.array(havocParticipantSchema).max(5),
    })
    .superRefine((team, ctx) => {
      team.starters.forEach((participant, index) => {
        const expected = POSITIONS[index];
        if (participant.kind !== 'starter') {
          ctx.addIssue({
            code: 'custom',
            message: 'starter list contains a non-starter participant',
          });
        }
        if (expected !== undefined && participant.slot !== expected) {
          ctx.addIssue({
            code: 'custom',
            message: `starter ${String(index)} must fill ${expected}`,
          });
        }
        if (participant.ownerInstanceId !== null) {
          ctx.addIssue({ code: 'custom', message: 'starters cannot have an owner instance' });
        }
      });
      team.replacements.forEach((participant, index) => {
        const owner = team.starters[index];
        if (participant.kind !== 'replacement') {
          ctx.addIssue({
            code: 'custom',
            message: 'replacement list contains a non-replacement participant',
          });
        }
        if (owner !== undefined) {
          if (participant.ownerInstanceId !== owner.instanceId) {
            ctx.addIssue({ code: 'custom', message: 'replacement owner must be its starter' });
          }
          if (participant.slot !== owner.slot) {
            ctx.addIssue({ code: 'custom', message: 'replacement slot must match its starter' });
          }
          if (
            participant.source.playerId !== owner.source.playerId ||
            participant.source.playerVersionId !== owner.source.playerVersionId
          ) {
            ctx.addIssue({
              code: 'custom',
              message: 'replacement must come from its starter source',
            });
          }
        }
      });
      for (const clone of team.clones) {
        const owner = team.starters.find((starter) => starter.instanceId === clone.ownerInstanceId);
        if (clone.kind !== 'clone') {
          ctx.addIssue({ code: 'custom', message: 'clone list contains a non-clone participant' });
        }
        if (owner === undefined) {
          ctx.addIssue({ code: 'custom', message: 'clone owner must be a starter' });
        } else if (clone.slot !== owner.slot) {
          ctx.addIssue({ code: 'custom', message: 'clone slot must match its owner' });
        }
      }
      const seen = new Set<string>();
      for (const participant of [...team.starters, ...team.replacements, ...team.clones]) {
        if (seen.has(participant.instanceId)) {
          ctx.addIssue({ code: 'custom', message: `duplicate instance ${participant.instanceId}` });
        }
        seen.add(participant.instanceId);
      }
      const teamExclusiveOwners = new Map<string, Set<string>>();
      for (const participant of team.starters) {
        for (const entry of participant.mutationPackage) {
          if (!HAVOC_TEAM_EXCLUSIVE_MUTATION_IDS.includes(entry.mutationId)) continue;
          const owners = teamExclusiveOwners.get(entry.mutationId) ?? new Set<string>();
          owners.add(participant.instanceId);
          teamExclusiveOwners.set(entry.mutationId, owners);
        }
      }
      for (const [mutationId, owners] of teamExclusiveOwners) {
        if (owners.size > 1) {
          ctx.addIssue({
            code: 'custom',
            message: `team-exclusive mutation ${mutationId} has ${String(owners.size)} owners`,
          });
        }
      }
    });
}

export const havocTeamInputSchema = buildHavocTeamInputSchema(havocSideSchema);
export type HavocTeamInput = z.infer<typeof havocTeamInputSchema>;

export const havocGameInputSchema = z
  .object({
    schemaVersion: z.literal(HAVOC_SCHEMA_VERSION),
    rulesVersion: z.literal(HAVOC_RULES_VERSION),
    mutationCatalogVersion: z.literal(HAVOC_MUTATION_CATALOG_VERSION),
    gameNumber: z.number().int().min(1).max(82),
    variant: havocVariantSchema,
    seed: seedSchema,
    profile: eraSimulationProfileSchema,
    humanSide: havocHomeAwaySchema,
    home: havocTeamInputSchema,
    away: havocTeamInputSchema,
    versionSet: havocVersionSetSchema,
  })
  .superRefine((input, ctx) => {
    if (input.home.side === input.away.side) {
      ctx.addIssue({ code: 'custom', message: 'home and away sides must differ' });
    }
    const human = input.humanSide === 'home' ? input.home : input.away;
    const opponent = input.humanSide === 'home' ? input.away : input.home;
    if (human.side !== 'human') {
      ctx.addIssue({ code: 'custom', message: 'human side does not carry the human team' });
    }
    if (opponent.side !== 'opponent') {
      ctx.addIssue({ code: 'custom', message: 'opponent side cannot carry the human team' });
    }
    if (opponent.clones.length !== 0) {
      ctx.addIssue({ code: 'custom', message: 'opponents never field clones' });
    }
    if (opponent.starters.some((participant) => participant.mutationPackage.length !== 0)) {
      ctx.addIssue({ code: 'custom', message: 'opponents never own mutations' });
    }
    if (input.variant === 'normal') {
      if (human.clones.length !== 0) {
        ctx.addIssue({ code: 'custom', message: 'the normal variant fields no clones' });
      }
      if (human.starters.some((participant) => participant.mutationPackage.length !== 0)) {
        ctx.addIssue({ code: 'custom', message: 'the normal variant owns no mutations' });
      }
    }
  });
export type HavocGameInput = z.infer<typeof havocGameInputSchema>;

export const havocScoringSourceSchema = z.enum([
  'roulette',
  'four-point-dunk',
  'reverse-basketball',
  'golden-assist',
  'double-or-nothing',
  'heat-check',
  'second-chance-jackpot',
  'the-bounty',
  'buzzer-bandit',
  'charity-casino',
]);
export type HavocScoringSource = z.infer<typeof havocScoringSourceSchema>;

export function buildHavocScoringEntrySchema<TSide extends string>(sideSchema: z.ZodType<TSide>) {
  return z.object({
    sequence: z.number().int().nonnegative(),
    gameNumber: z.number().int().min(1).max(82),
    period: z.number().int().min(1).max(40),
    clockSeconds: z.number().int().min(0).max(3600),
    possessionId: z.number().int().nonnegative(),
    side: sideSchema,
    kind: z.enum(['field-goal', 'free-throw', 'adjustment', 'bonus']),
    actorInstanceId: havocInstanceIdSchema,
    beneficiaryInstanceId: havocInstanceIdSchema.nullable(),
    nominalPoints: z.number().int().min(-3).max(3),
    addends: z
      .array(
        z.object({
          source: havocScoringSourceSchema,
          points: z.number().int().min(-6).max(6),
        }),
      )
      .max(4),
    multipliers: z
      .array(
        z.object({
          source: havocScoringSourceSchema,
          factor: z.union([z.literal(2), z.literal(3)]),
        }),
      )
      .max(4),
    points: z.number().int(),
    owners: z.array(havocInstanceIdSchema).max(5),
    originalEventSequence: z.number().int().nonnegative().nullable(),
  });
}

export const havocScoringEntrySchema = buildHavocScoringEntrySchema(havocSideSchema);
export type HavocScoringEntry = z.infer<typeof havocScoringEntrySchema>;

const havocEventBase = z.object({
  sequence: z.number().int().nonnegative(),
  gameNumber: z.number().int().min(1).max(82),
  period: z.number().int().min(1).max(40),
  clockSeconds: z.number().int().min(0).max(3600),
});

export function buildHavocEventSchema<TSide extends string>(sideSchema: z.ZodType<TSide>) {
  return z.discriminatedUnion('kind', [
    havocEventBase.extend({ kind: z.literal('period-start') }),
    havocEventBase.extend({
      kind: z.literal('period-end'),
      homeScore: z.number().int(),
      awayScore: z.number().int(),
    }),
    havocEventBase.extend({
      kind: z.literal('possession-start'),
      possessionId: z.number().int().nonnegative(),
      offenseSide: sideSchema,
    }),
    havocEventBase.extend({
      kind: z.literal('shot-attempt'),
      possessionId: z.number().int().nonnegative(),
      shooterInstanceId: havocInstanceIdSchema,
      side: sideSchema,
      zone: shotZoneSchema,
      shotKind: havocShotKindSchema,
      made: z.boolean(),
      nominalPoints: z.union([z.literal(2), z.literal(3)]),
    }),
    havocEventBase.extend({
      kind: z.literal('free-throw-attempt'),
      possessionId: z.number().int().nonnegative(),
      shooterInstanceId: havocInstanceIdSchema,
      side: sideSchema,
      made: z.boolean(),
      bonus: z.boolean(),
    }),
    havocEventBase.extend({
      kind: z.literal('rebound'),
      possessionId: z.number().int().nonnegative(),
      playerInstanceId: havocInstanceIdSchema,
      side: sideSchema,
      offensive: z.boolean(),
    }),
    havocEventBase.extend({
      kind: z.literal('assist'),
      possessionId: z.number().int().nonnegative(),
      assisterInstanceId: havocInstanceIdSchema,
      scorerInstanceId: havocInstanceIdSchema,
      side: sideSchema,
    }),
    havocEventBase.extend({
      kind: z.literal('steal'),
      possessionId: z.number().int().nonnegative(),
      stealerInstanceId: havocInstanceIdSchema,
      side: sideSchema,
    }),
    havocEventBase.extend({
      kind: z.literal('block'),
      possessionId: z.number().int().nonnegative(),
      blockerInstanceId: havocInstanceIdSchema,
      shooterInstanceId: havocInstanceIdSchema,
      side: sideSchema,
    }),
    havocEventBase.extend({
      kind: z.literal('turnover'),
      possessionId: z.number().int().nonnegative(),
      playerInstanceId: havocInstanceIdSchema,
      side: sideSchema,
    }),
    havocEventBase.extend({
      kind: z.literal('turnover-cancelled'),
      possessionId: z.number().int().nonnegative(),
      playerInstanceId: havocInstanceIdSchema,
      side: sideSchema,
      originalSequence: z.number().int().nonnegative(),
    }),
    havocEventBase.extend({
      kind: z.literal('foul'),
      possessionId: z.number().int().nonnegative(),
      foulerInstanceId: havocInstanceIdSchema,
      side: sideSchema,
      shooting: z.boolean(),
      shooterInstanceId: havocInstanceIdSchema.nullable(),
      freeThrowsAwarded: z.number().int().min(0).max(3),
      technicalFreeThrows: z.number().int().min(0).max(1),
    }),
    havocEventBase.extend({
      kind: z.literal('substitution'),
      outInstanceId: havocInstanceIdSchema,
      inInstanceId: havocInstanceIdSchema,
      reason: z.enum(['foul-out', 'clone-removed', 'owner-exit']),
    }),
    havocEventBase.extend({
      kind: z.literal('shot-clock-violation'),
      possessionId: z.number().int().nonnegative(),
      offenseSide: sideSchema,
      limitSeconds: z.number().int().min(1).max(60),
    }),
    havocEventBase.extend({
      kind: z.literal('extra-possession'),
      outcome: z.enum(['queued', 'started', 'expired']),
      ownerInstanceId: havocInstanceIdSchema,
      side: sideSchema,
      possessionId: z.number().int().nonnegative().nullable(),
    }),
    havocEventBase.extend({
      kind: z.literal('clone'),
      outcome: z.enum(['entered', 'exited']),
      ownerInstanceId: havocInstanceIdSchema,
      cloneInstanceId: havocInstanceIdSchema,
      side: sideSchema,
      reason: z.enum(['owner-exited', 'fouled-out']).nullable(),
    }),
    havocEventBase.extend({
      kind: z.literal('time-lord'),
      side: sideSchema,
      fullSeconds: z.number().int().min(1).max(60),
      reboundSeconds: z.number().int().min(1).max(60),
      source: z.enum(['tipoff', 'owner-exit']),
    }),
    havocEventBase.extend({
      kind: z.literal('body-snatcher'),
      outcome: z.enum(['applied', 'ended']),
      ownerInstanceId: havocInstanceIdSchema,
      targetInstanceId: havocInstanceIdSchema,
      side: sideSchema,
    }),
    havocEventBase.extend({
      kind: z.literal('great-equalizer'),
      outcome: z.enum(['applied', 'updated']),
      ownerInstanceId: havocInstanceIdSchema,
      cappedInstanceIds: z.array(havocInstanceIdSchema).max(10),
    }),
    havocEventBase.extend({
      kind: z.literal('four-point-dunk'),
      shooterInstanceId: havocInstanceIdSchema,
      side: sideSchema,
      scoringSequence: z.number().int().nonnegative(),
    }),
    havocEventBase.extend({
      kind: z.literal('golden-assist'),
      assisterInstanceId: havocInstanceIdSchema,
      side: sideSchema,
      scoringSequence: z.number().int().nonnegative(),
    }),
    havocEventBase.extend({
      kind: z.literal('heat-check'),
      outcome: z.enum(['armed', 'consumed', 'expired']),
      ownerInstanceId: havocInstanceIdSchema,
      side: sideSchema,
      scoringSequence: z.number().int().nonnegative().nullable(),
    }),
    havocEventBase.extend({
      kind: z.literal('putback'),
      outcome: z.enum(['armed', 'consumed', 'lost']),
      ownerInstanceId: havocInstanceIdSchema,
      side: sideSchema,
      reboundSequence: z.number().int().nonnegative().nullable(),
      scoringSequence: z.number().int().nonnegative().nullable(),
    }),
    havocEventBase.extend({
      kind: z.literal('and-one-bonus'),
      shooterInstanceId: havocInstanceIdSchema,
      side: sideSchema,
      foulSequence: z.number().int().nonnegative(),
      bonusFreeThrows: z.number().int().min(1).max(2),
    }),
    havocEventBase.extend({
      kind: z.literal('double-or-nothing-foul'),
      ownerInstanceId: havocInstanceIdSchema,
      side: sideSchema,
      foulSequence: z.number().int().nonnegative(),
      freeThrowsGranted: z.number().int().min(1).max(1),
    }),
    havocEventBase.extend({
      kind: z.literal('possession-refund'),
      ownerInstanceId: havocInstanceIdSchema,
      side: sideSchema,
      turnoverSequence: z.number().int().nonnegative(),
    }),
    havocEventBase.extend({
      kind: z.literal('rebound-loop'),
      ownerInstanceId: havocInstanceIdSchema,
      side: sideSchema,
      reboundOrdinal: z.number().int().positive(),
      granted: z.number().int().positive(),
    }),
    havocEventBase.extend({
      kind: z.literal('bounty'),
      outcome: z.enum(['armed', 'consumed', 'expired']),
      ownerInstanceId: havocInstanceIdSchema,
      side: sideSchema,
      blockedInstanceId: havocInstanceIdSchema.nullable(),
      scoringSequence: z.number().int().nonnegative().nullable(),
    }),
    havocEventBase.extend({
      kind: z.literal('foul-relief'),
      ownerInstanceId: havocInstanceIdSchema,
      side: sideSchema,
      foulSequence: z.number().int().nonnegative(),
      chargedFoulsAfter: z.number().int().min(0).max(6),
    }),
    havocEventBase.extend({
      kind: z.literal('roulette'),
      ownerInstanceId: havocInstanceIdSchema,
      side: sideSchema,
      attemptOrdinal: z.number().int().positive(),
      rolled: z.number().int().min(1).max(4),
      nominal: z.union([z.literal(2), z.literal(3)]),
      scoringSequence: z.number().int().nonnegative().nullable(),
    }),
    havocEventBase.extend({
      kind: z.literal('buzzer-bandit'),
      outcome: z.enum(['doubled', 'penalized']),
      ownerInstanceId: havocInstanceIdSchema,
      shooterInstanceId: havocInstanceIdSchema,
      side: sideSchema,
      shotClockTenths: z.number().int().min(0).max(2400),
      scoringSequence: z.number().int().nonnegative().nullable(),
    }),
    havocEventBase.extend({
      kind: z.literal('charity-casino'),
      outcome: z.enum(['made', 'missed']),
      ownerInstanceId: havocInstanceIdSchema,
      side: sideSchema,
      scoringSequence: z.number().int().nonnegative().nullable(),
      bonusSequence: z.number().int().nonnegative().nullable(),
    }),
    havocEventBase.extend({
      kind: z.literal('fusion-dance'),
      outcome: z.enum(['applied', 'ended']),
      ownerInstanceId: havocInstanceIdSchema,
      donorInstanceId: havocInstanceIdSchema,
      side: sideSchema,
    }),
    havocEventBase.extend({
      kind: z.literal('darwinism'),
      ownerInstanceId: havocInstanceIdSchema,
      side: sideSchema,
      shooterInstanceId: havocInstanceIdSchema,
      shooterDecayAfter: z.number().int().positive(),
    }),
    havocEventBase.extend({
      kind: z.literal('game-end'),
      homeScore: z.number().int(),
      awayScore: z.number().int(),
      winner: z.enum(['home', 'away']),
    }),
  ]);
}

export const havocEventSchema = buildHavocEventSchema(havocSideSchema);
export type HavocEvent = z.infer<typeof havocEventSchema>;
export type HavocEventKind = HavocEvent['kind'];

export function buildHavocGameTapeSchema<TSide extends string>(sideSchema: z.ZodType<TSide>) {
  const eventSchema = buildHavocEventSchema(sideSchema);
  const scoringEntrySchema = buildHavocScoringEntrySchema(sideSchema);
  return z
    .object({
      schemaVersion: z.literal(HAVOC_SCHEMA_VERSION),
      gameNumber: z.number().int().min(1).max(82),
      variant: havocVariantSchema,
      seed: seedSchema,
      events: z.array(eventSchema),
      scoring: z.array(scoringEntrySchema),
    })
    .superRefine((tape, ctx) => {
      let lastEvent = -1;
      for (const event of tape.events) {
        if (event.sequence <= lastEvent) {
          ctx.addIssue({ code: 'custom', message: 'event sequences must increase' });
        }
        lastEvent = event.sequence;
      }
      let lastScore = -1;
      for (const entry of tape.scoring) {
        if (entry.sequence <= lastScore) {
          ctx.addIssue({ code: 'custom', message: 'scoring sequences must increase' });
        }
        lastScore = entry.sequence;
      }
    });
}

export const havocGameTapeSchema = buildHavocGameTapeSchema(havocSideSchema);
export type HavocGameTape = z.infer<typeof havocGameTapeSchema>;

export const havocStatLineSchema = z.object({
  secondsPlayed: z.number().int().nonnegative(),
  minutes: z.number().int().nonnegative(),
  points: z.number().int(),
  fieldGoals: madeAttemptedSchema,
  threes: madeAttemptedSchema,
  freeThrows: madeAttemptedSchema,
  rebounds: z.object({
    total: z.number().int().nonnegative(),
    offensive: z.number().int().nonnegative(),
    defensive: z.number().int().nonnegative(),
  }),
  assists: z.number().int().nonnegative(),
  steals: z.number().int().nonnegative(),
  blocks: z.number().int().nonnegative(),
  turnovers: z.number().int().nonnegative(),
  fouls: z.number().int().nonnegative(),
  chargedFouls: z.number().int().nonnegative(),
  adjustments: z.number().int(),
});
export type HavocStatLine = z.infer<typeof havocStatLineSchema>;

export const havocParticipantLineSchema = havocStatLineSchema.extend({
  instanceId: havocInstanceIdSchema,
  kind: havocParticipantKindSchema,
  slot: positionSchema,
  ownerInstanceId: havocInstanceIdSchema.nullable(),
  sourcePlayerId: playerIdSchema,
  sourcePlayerVersionId: playerVersionIdSchema.nullable(),
  displayName: z.string().min(1).max(96),
});
export type HavocParticipantLine = z.infer<typeof havocParticipantLineSchema>;

export const havocTeamResultSchema = z.object({
  side: havocHomeAwaySchema,
  teamId: z.string().min(1).max(64),
  displayName: z.string().min(1).max(96),
  points: z.number().int(),
  fieldGoals: madeAttemptedSchema,
  threes: madeAttemptedSchema,
  freeThrows: madeAttemptedSchema,
  rebounds: z.object({
    total: z.number().int().nonnegative(),
    offensive: z.number().int().nonnegative(),
    defensive: z.number().int().nonnegative(),
    team: z.number().int().nonnegative(),
  }),
  assists: z.number().int().nonnegative(),
  steals: z.number().int().nonnegative(),
  blocks: z.number().int().nonnegative(),
  turnovers: z.number().int().nonnegative(),
  fouls: z.number().int().nonnegative(),
  adjustments: z.number().int(),
  teamBonusPoints: z.number().int(),
  periods: z.array(z.number().int()).min(4).max(30),
  courtSeconds: z.number().int().nonnegative(),
  participants: z.array(havocParticipantLineSchema).min(5).max(15),
});
export type HavocTeamResult = z.infer<typeof havocTeamResultSchema>;

export function buildHavocMutationRollupSchema<TSide extends string>(sideSchema: z.ZodType<TSide>) {
  return z.object({
    ownerInstanceId: havocInstanceIdSchema,
    mutationId: havocMutationIdSchema,
    side: sideSchema,
    triggers: z.number().int().nonnegative(),
    pointsDelta: z.number().int(),
    freeThrowsGranted: z.number().int().nonnegative(),
    turnoversCancelled: z.number().int().nonnegative(),
    extraPossessionsEarned: z.number().int().nonnegative(),
    extraPossessionsUsed: z.number().int().nonnegative(),
    extraPossessionsExpired: z.number().int().nonnegative(),
    swapPoints: z.number().int(),
    swapSeconds: z.number().int().nonnegative(),
    capSeconds: z.number().int().nonnegative(),
    activeSeconds: z.number().int().nonnegative(),
    ratingChanges: z.number().int().nonnegative(),
  });
}

export const havocMutationRollupSchema = buildHavocMutationRollupSchema(havocSideSchema);
export type HavocMutationRollup = z.infer<typeof havocMutationRollupSchema>;

export const havocHighlightSchema = z.object({
  kind: z.enum(['mutation', 'foul-out', 'negative-score']),
  period: z.number().int().min(1).max(40),
  clockSeconds: z.number().int().min(0).max(3600),
  instanceId: havocInstanceIdSchema.nullable(),
  mutationId: havocMutationIdSchema.nullable(),
  pointsDelta: z.number().int(),
});
export type HavocHighlight = z.infer<typeof havocHighlightSchema>;

export function buildHavocResultSchema<TSide extends string>(sideSchema: z.ZodType<TSide>) {
  const rollupSchema = buildHavocMutationRollupSchema(sideSchema);
  return z
    .object({
      schemaVersion: z.literal(HAVOC_SCHEMA_VERSION),
      gameNumber: z.number().int().min(1).max(82),
      variant: havocVariantSchema,
      seed: seedSchema,
      engineVersion: z.string().min(1).max(64),
      rulesVersion: z.literal(HAVOC_RULES_VERSION),
      mutationCatalogVersion: z.literal(HAVOC_MUTATION_CATALOG_VERSION),
      profileVersion: z.string().min(1).max(64),
      dataVersion: z.string().min(1).max(64),
      home: havocTeamResultSchema,
      away: havocTeamResultSchema,
      winner: z.enum(['home', 'away']),
      overtimePeriods: z.number().int().nonnegative(),
      inputDigest: havocDigestSchema,
      rollups: z.array(rollupSchema).max(40),
      highlights: z.array(havocHighlightSchema).max(16),
    })
    .superRefine((result, ctx) => {
      if (result.home.side !== 'home' || result.away.side !== 'away') {
        ctx.addIssue({ code: 'custom', message: 'result sides do not match home/away' });
      }
      const homeScore = result.home.points;
      const awayScore = result.away.points;
      if (homeScore === awayScore) {
        ctx.addIssue({ code: 'custom', message: 'havoc games never end tied' });
      }
      const expectedWinner = homeScore > awayScore ? 'home' : 'away';
      if (result.winner !== expectedWinner) {
        ctx.addIssue({ code: 'custom', message: 'result winner disagrees with the scoreline' });
      }
      if (result.home.periods.length !== result.away.periods.length) {
        ctx.addIssue({ code: 'custom', message: 'team period counts must match' });
      }
    });
}

export const havocGameResultSchema = buildHavocResultSchema(havocSideSchema).extend({
  humanSide: havocHomeAwaySchema,
});
export type HavocGameResult = z.infer<typeof havocGameResultSchema>;

export const havocGameSummarySchema = z.object({
  schemaVersion: z.literal(HAVOC_SCHEMA_VERSION),
  gameNumber: z.number().int().min(1).max(82),
  variant: havocVariantSchema,
  seed: seedSchema,
  humanSide: havocHomeAwaySchema,
  humanScore: z.number().int(),
  opponentScore: z.number().int(),
  outcome: z.enum(['win', 'loss']),
  periods: z.object({
    human: z.array(z.number().int()).min(4).max(30),
    opponent: z.array(z.number().int()).min(4).max(30),
  }),
  overtimePeriods: z.number().int().nonnegative(),
  adjustments: z.number().int(),
  resultDigest: havocDigestSchema,
  inputDigest: havocDigestSchema,
});
export type HavocGameSummary = z.infer<typeof havocGameSummarySchema>;

export const havocAuditFindingSchema = z.object({
  code: z.string().min(1).max(64),
  message: z.string().min(1).max(512),
});
export type HavocAuditFinding = z.infer<typeof havocAuditFindingSchema>;

export const havocGameAuditSchema = z.object({
  ok: z.boolean(),
  findings: z.array(havocAuditFindingSchema),
});
export type HavocGameAudit = z.infer<typeof havocGameAuditSchema>;
