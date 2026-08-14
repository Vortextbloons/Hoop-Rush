import { z } from 'zod';
import {
  seasonDraftCommandSchema,
  seasonDraftStateSchema,
  seedSchema,
  type SeasonDraftState,
  type SeasonRosterTargets,
} from '@hoop-rush/data-contracts';
import {
  applySeasonDraftCommand,
  generateAiLeague,
  seasonDraftStateDigest,
} from '@hoop-rush/engine';
import { makeReport, type CliReport } from '../report.ts';
import { seasonDraftReproduceReportSchema } from '../report-schemas.ts';
import {
  DEFAULT_MANIFEST,
  loadSeasonDraftCatalog,
  loadSeasonRosterTargets,
  readJsonFile,
} from './season-data.ts';

export const SEASON_DRAFT_REPRODUCE_OPTIONS: Record<string, boolean> = {
  input: true,
  manifest: true,
  format: true,
};

export const seasonDraftReproduceInputSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('season draft reproduce'),
  seed: seedSchema,
  catalogVersion: z.literal('season-draft-v2'),
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
  const manifestPath = args.manifest ?? DEFAULT_MANIFEST;
  const catalog = loadSeasonDraftCatalog(manifestPath);
  let targets: SeasonRosterTargets;
  try {
    targets = loadSeasonRosterTargets(manifestPath);
  } catch (error) {
    return makeReport(
      'season draft reproduce',
      { input: inputPath },
      { failures: [(error as Error).message], exitCode: 2 },
    );
  }

  let state: SeasonDraftState | null = input.initialState;
  const rejections: Array<{ commandId: string; errorCode: string; message: string }> = [];
  const divergences: string[] = [];
  for (const command of input.commands) {
    const result = applySeasonDraftCommand(state, catalog, command, {
      generate: (generationInput) =>
        generateAiLeague({
          ...generationInput,
          targets,
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
    offers: state.offers.map((offer) => ({
      participantId: offer.participantId,
      round: offer.round,
      pickOrdinal: offer.pickOrdinal,
      seedPath: offer.seedPath,
      cards: offer.cards.map((card) => ({
        playerVersionId: card.playerVersionId,
        selectable: card.selectable,
        coverageReason: card.coverageReason,
      })),
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
    `offers ${String(state.offers.length)} · picks ${String(state.picks.length)}`,
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
