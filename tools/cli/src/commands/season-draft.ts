import { z } from 'zod';
import {
  seasonDraftCommandSchema,
  seasonDraftStateSchema,
  seedSchema,
  type SeasonDraftCommand,
  type SeasonDraftState,
} from '@hoop-rush/data-contracts';
import {
  applySeasonDraftCommand,
  generateAiLeague,
  seasonDraftStateDigest,
} from '@hoop-rush/engine';
import { makeReport, type CliReport } from '../report.js';
import { seasonDraftReproduceReportSchema } from '../report-schemas.js';
import { loadSeasonDraftCatalog, readJsonFile } from './season-data.js';

/**
 * `season draft reproduce` (spec/2.0 M2.1): replays a committed command
 * sequence against the initial draft state through the authoritative engine
 * and reports every roll, claim, pick, rejection, the final digest, and any
 * divergence from the expected digest.
 */

export const SEASON_DRAFT_REPRODUCE_OPTIONS: Record<string, boolean> = {
  input: true,
  manifest: true,
  format: true,
};

export const seasonDraftReproduceInputSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('season draft reproduce'),
  seed: seedSchema,
  catalogVersion: z.literal('season-draft-v1'),
  initialState: seasonDraftStateSchema.nullable(),
  commands: z.array(seasonDraftCommandSchema),
  expected: z
    .object({
      finalDigest: z.string().regex(/^[0-9a-f]{32}$/),
      finalRevision: z.number().int().nonnegative(),
    })
    .optional(),
});
export type SeasonDraftReproduceInput = z.infer<typeof seasonDraftReproduceInputSchema>;

/**
 * Associates every recorded roll attempt with its participant by walking the
 * accepted reveal commands in order: each reveal's attempts form the next
 * contiguous group of the state's rolls array.
 */
function rollsWithParticipants(state: SeasonDraftState): Array<{
  participantId: string;
  franchiseId: string;
  eraId: string;
  attemptIndex: number;
  usable: boolean;
}> {
  const reveals = state.commandLog
    .filter((record) => record.status === 'accepted')
    .map((record) => record.command)
    .filter(
      (command): command is SeasonDraftCommand & { payload: { kind: 'reveal-draft-roll' } } =>
        command.payload.kind === 'reveal-draft-roll',
    );
  const rows: Array<{
    participantId: string;
    franchiseId: string;
    eraId: string;
    attemptIndex: number;
    usable: boolean;
  }> = [];
  let rollIndex = 0;
  for (const reveal of reveals) {
    // Group the contiguous attempts belonging to this reveal by walking until
    // the group's usable attempt (the reveal's final attempt).
    const participantId = reveal.payload.participantId;
    for (;;) {
      const attempt = state.rolls[rollIndex];
      if (attempt === undefined) break;
      rows.push({
        participantId,
        franchiseId: attempt.franchiseId,
        eraId: attempt.eraId,
        attemptIndex: attempt.attemptIndex,
        usable: attempt.usable,
      });
      rollIndex += 1;
      if (attempt.usable) break;
    }
  }
  for (; rollIndex < state.rolls.length; rollIndex += 1) {
    const attempt = state.rolls[rollIndex];
    if (attempt !== undefined) {
      rows.push({
        participantId: 'unknown',
        franchiseId: attempt.franchiseId,
        eraId: attempt.eraId,
        attemptIndex: attempt.attemptIndex,
        usable: attempt.usable,
      });
    }
  }
  return rows;
}

export function seasonDraftReproduce(args: {
  input: string | null;
  manifest: string | null;
}): CliReport {
  const inputPath = args.input;
  if (inputPath === null) {
    throw new Error('season draft reproduce requires --input <commands.json>');
  }
  const parsedInput = seasonDraftReproduceInputSchema.safeParse(readJsonFile(inputPath));
  if (!parsedInput.success) {
    return makeReport(
      'season draft reproduce',
      { input: inputPath },
      {
        failures: [
          `commands input fails the schema: ${parsedInput.error.issues[0]?.message ?? 'unknown'}`,
        ],
        exitCode: 2,
      },
    );
  }
  const input = parsedInput.data;
  const catalog = loadSeasonDraftCatalog(args.manifest ?? undefined);

  let state: SeasonDraftState | null = input.initialState;
  const rejections: Array<{ commandId: string; errorCode: string; message: string }> = [];
  const divergences: string[] = [];
  for (const command of input.commands) {
    const result = applySeasonDraftCommand(state, catalog, command, {
      generate: (generationInput) =>
        generateAiLeague({
          seed: generationInput.seed,
          catalog: generationInput.catalog,
          league: generationInput.league,
          humanFranchiseIds: generationInput.humanFranchiseIds,
          humanRosters: generationInput.humanRosters,
          targets: null,
        }),
    });
    state = result.state;
    if (result.record.status === 'rejected') {
      rejections.push({
        commandId: result.record.commandId,
        errorCode: result.record.errorCode,
        message: result.record.message,
      });
    }
  }

  if (state === null) {
    return makeReport(
      'season draft reproduce',
      { input: inputPath },
      {
        failures: ['replay produced no draft state'],
        exitCode: 1,
      },
    );
  }
  const finalDigest = seasonDraftStateDigest(state);
  const acceptedCount = input.commands.length - rejections.length;
  const expectedDigest = input.expected?.finalDigest ?? null;
  const identical =
    expectedDigest === null
      ? true
      : finalDigest === expectedDigest && state.revision === input.expected?.finalRevision;
  if (expectedDigest !== null && finalDigest !== expectedDigest) {
    divergences.push(`final digest ${finalDigest} does not match expected ${expectedDigest}`);
  }
  if (input.expected !== undefined && state.revision !== input.expected.finalRevision) {
    divergences.push(
      `final revision ${String(state.revision)} does not match expected ${String(input.expected.finalRevision)}`,
    );
  }

  const payload = seasonDraftReproduceReportSchema.parse({
    schemaVersion: 1,
    command: 'season draft reproduce',
    seed: input.seed,
    catalogVersion: input.catalogVersion,
    commandCount: input.commands.length,
    acceptedCount,
    rejectedCount: rejections.length,
    finalRevision: state.revision,
    finalStatus: state.status,
    finalDigest,
    expectedDigest,
    identical,
    rolls: rollsWithParticipants(state),
    claims: state.claims.map((claim) => ({
      participantId: claim.participantId,
      franchiseId: claim.franchiseId,
      eraId: claim.eraId,
    })),
    picks: state.picks.map((pick) => ({
      participantId: pick.participantId,
      round: pick.round,
      playerVersionId: pick.playerVersionId,
    })),
    rejections,
    divergences,
    pass: identical && divergences.length === 0,
  });

  const details = [
    `seed ${input.seed} · ${String(input.commands.length)} commands (${String(acceptedCount)} accepted, ${String(rejections.length)} rejected)`,
    `final revision ${String(state.revision)} · status ${state.status}`,
    `final digest ${finalDigest}${expectedDigest === null ? '' : ` · expected ${expectedDigest}`}`,
    `rolls ${String(state.rolls.length)} · claims ${String(state.claims.length)} · picks ${String(state.picks.length)}`,
  ];
  for (const rejection of rejections) {
    details.push(`rejected ${rejection.commandId}: ${rejection.errorCode} (${rejection.message})`);
  }
  return makeReport(
    'season draft reproduce',
    { input: inputPath },
    {
      details,
      failures: divergences,
      payload,
    },
  );
}
