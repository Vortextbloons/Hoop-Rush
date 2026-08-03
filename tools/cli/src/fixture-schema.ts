import { z } from 'zod';
import { simulationTeamSchema } from '@hoop-rush/data-contracts';

/**
 * CLI simulation fixtures (spec/09): equal-lineup, strong-versus-medium,
 * strong-versus-weak, and single-dimension sensitivity pairs. Fixtures are
 * static JSON beside the CLI; the engine and profile are the authoritative
 * rules, never duplicated here.
 */

export const simFixtureSchema = z.object({
  schemaVersion: z.literal(2),
  fixtureId: z.string().min(1).max(64),
  description: z.string().min(1).max(256),
  home: simulationTeamSchema,
  away: simulationTeamSchema,
  /** Changed side for single-dimension sensitivity fixtures. */
  variantHome: simulationTeamSchema.optional(),
  variantAway: simulationTeamSchema.optional(),
  /** Profile parameter overrides applied only to the variant run. */
  variantParameters: z.record(z.string(), z.number()).optional(),
});
export type SimFixture = z.infer<typeof simFixtureSchema>;
