import { opponentBracketSchema } from './bracket.ts';
import { seasonDraftCatalogSchema } from './season-draft-catalog.ts';
import { eraSimulationProfileSchema } from './era-sim-profile.ts';
import { capRushCatalogSourceSchema } from './cap-rush-versions.ts';
import { capRushMultiplayerVersionLocksSchema } from './cap-rush-multiplayer-versions.ts';
import {
  capRushMultiplayerCommandSchema,
  capRushMultiplayerCommandRejectionCodeSchema,
  capRushMultiplayerStateSchema,
} from './cap-rush-multiplayer.ts';
import { z } from 'zod';
import { idSchema } from './ids.ts';
import { capRushLeagueGameSchema, capRushLeagueScheduleEntrySchema } from './cap-rush-league.ts';
import {
  capRushPlayoffGamePlanSchema,
  capRushPlayoffGameSummarySchema,
} from './cap-rush-postseason.ts';
import { capRushMultiplayerLockedInputsSchema } from './cap-rush-multiplayer-league.ts';
import {
  havocBattleInputSchema,
  havocBattleResultSchema,
  havocBattleTapeSchema,
} from './havoc-battle.ts';
import { CAP_RUSH_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION } from './cap-rush-multiplayer-versions.ts';

const base = z.object({
  schemaVersion: z.literal(CAP_RUSH_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION),
  requestId: idSchema,
});

const capRushMultiplayerWorkerEnvironmentSchema = z.object({
  variant: z.enum(['clash', 'roulette']),
  bracket: opponentBracketSchema,
  seasonCatalog: seasonDraftCatalogSchema,
  profile: eraSimulationProfileSchema,
  catalogSource: capRushCatalogSourceSchema,
  versionLocks: capRushMultiplayerVersionLocksSchema,
});

export const capRushMultiplayerWorkerRequestSchema = z.discriminatedUnion('kind', [
  base.extend({
    kind: z.literal('cap-rush-multiplayer-hydrate'),
    environment: capRushMultiplayerWorkerEnvironmentSchema,
  }),
  base
    .extend({
      kind: z.literal('cap-rush-multiplayer-project'),
      verifyLog: z.boolean().optional(),
      // A warm projector can send only `baseDigest` and commands; a cold or restarted worker
      // receives the full state. Verification always carries the root state.
      state: capRushMultiplayerStateSchema.optional(),
      baseDigest: z.string().min(1).max(64).optional(),
      commands: z.array(capRushMultiplayerCommandSchema),
      // The environment is sent once per worker through `hydrate`; keep it optional so the
      // worker can reuse the adapted catalog across projections.
      environment: capRushMultiplayerWorkerEnvironmentSchema.optional(),
      variant: z.enum(['clash', 'roulette']),
    })
    .refine((value) => value.state !== undefined || value.baseDigest !== undefined, {
      message: 'a projection needs a state or a base digest',
    })
    .refine((value) => value.verifyLog !== true || value.state !== undefined, {
      message: 'a verification projection needs the root state',
    }),
  base.extend({
    kind: z.literal('cap-rush-multiplayer-slot'),
    roomId: idSchema,
    locked: capRushMultiplayerLockedInputsSchema,
    slot: z.number().int().min(1).max(82),
    throughSlot: z.number().int().min(1).max(82).optional(),
    partition: z.union([z.literal(0), z.literal(1)]).optional(),
    tapeGameIds: z.array(z.string().min(1).max(80)).max(2),
  }),
  base.extend({
    kind: z.literal('cap-rush-multiplayer-playoff-games'),
    roomId: idSchema,
    locked: capRushMultiplayerLockedInputsSchema,
    plans: z.array(capRushPlayoffGamePlanSchema).min(1).max(8),
    tapeGameIds: z.array(z.string().min(1).max(80)).max(8),
  }),
  base
    .extend({
      kind: z.literal('cap-rush-multiplayer-tape'),
      roomId: idSchema,
      locked: capRushMultiplayerLockedInputsSchema,
      entry: capRushLeagueScheduleEntrySchema.optional(),
      plan: capRushPlayoffGamePlanSchema.optional(),
    })
    .refine((value) => (value.entry === undefined) !== (value.plan === undefined), {
      message: 'a tape request needs exactly one schedule entry or playoff plan',
    }),
  base.extend({
    kind: z.literal('cap-rush-multiplayer-cancel'),
  }),
]);
export type CapRushMultiplayerWorkerRequest = z.infer<typeof capRushMultiplayerWorkerRequestSchema>;

export const capRushMultiplayerWorkerSlotMessageSchema = z.object({
  schemaVersion: z.literal(CAP_RUSH_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION),
  kind: z.literal('cap-rush-multiplayer-slot'),
  requestId: idSchema,
  slot: z.number().int().min(1).max(82),
  games: z.array(capRushLeagueGameSchema).min(1).max(75),
  tapes: z.array(z.object({ gameId: z.string().min(1).max(80), tape: z.unknown() })).max(2),
});

export const capRushMultiplayerWorkerPlayoffMessageSchema = z.object({
  schemaVersion: z.literal(CAP_RUSH_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION),
  kind: z.literal('cap-rush-multiplayer-playoff-games'),
  requestId: idSchema,
  games: z.array(capRushPlayoffGameSummarySchema).min(1).max(8),
  tapes: z.array(z.object({ gameId: z.string().min(1).max(80), tape: z.unknown() })).max(8),
});

export const capRushMultiplayerWorkerTapeMessageSchema = z.object({
  schemaVersion: z.literal(CAP_RUSH_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION),
  kind: z.literal('cap-rush-multiplayer-tape'),
  requestId: idSchema,
  gameId: z.string().min(1).max(80),
  input: havocBattleInputSchema,
  result: havocBattleResultSchema,
  tape: havocBattleTapeSchema,
});

export const capRushMultiplayerWorkerErrorMessageSchema = z.object({
  schemaVersion: z.literal(CAP_RUSH_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION),
  kind: z.literal('cap-rush-multiplayer-error'),
  requestId: idSchema,
  code: z.enum(['audit-failure', 'stale-job', 'cancelled', 'internal']),
  message: z.string().min(1).max(400),
});

export const capRushMultiplayerWorkerMessageSchema = z.union([
  base.extend({
    kind: z.literal('cap-rush-multiplayer-hydrated'),
  }),
  base.extend({
    kind: z.literal('cap-rush-multiplayer-rejection'),
    code: capRushMultiplayerCommandRejectionCodeSchema,
    message: z.string().min(1),
  }),
  base.extend({
    kind: z.literal('cap-rush-multiplayer-projection'),
    state: capRushMultiplayerStateSchema,
    stateDigest: z.string().min(1).max(64),
  }),
  capRushMultiplayerWorkerSlotMessageSchema,
  capRushMultiplayerWorkerPlayoffMessageSchema,
  capRushMultiplayerWorkerTapeMessageSchema,
  capRushMultiplayerWorkerErrorMessageSchema,
]);
export type CapRushMultiplayerWorkerMessage = z.infer<typeof capRushMultiplayerWorkerMessageSchema>;
