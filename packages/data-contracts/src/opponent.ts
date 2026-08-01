import { z } from 'zod';
import { franchiseIdSchema, seasonKeySchema } from './ids.js';
import { lineupSchema } from './lineup.js';
import { simulationPlayerSchema } from './simulation.js';

/**
 * A fixed, versioned opponent-team artifact (spec/01 bracket content). The
 * opening opponent authored for M2 is permanent M3 bracket material; it is
 * never regenerated per challenge.
 */

export const difficultyBandSchema = z.enum(['medium']);
export type DifficultyBand = z.infer<typeof difficultyBandSchema>;

export const opponentTeamSchema = z.object({
  schemaVersion: z.literal(1),
  /** Stable artifact identity, referenced by the manifest. */
  opponentId: z.string().min(1).max(64),
  /** Version of the fixed bracket this entry belongs to. */
  bracketVersion: z.string().min(1).max(64),
  difficultyBand: difficultyBandSchema,
  /** Franchise identity the opponent represents. */
  teamId: franchiseIdSchema,
  displayName: z.string().min(1).max(96),
  /** Representative season key for the authored lineup. */
  seasonKey: seasonKeySchema,
  /** Legal G,G,F,F,C assignment, validated at authoring and load time. */
  lineup: lineupSchema,
  /** Five simulation-ready players matching the lineup assignments. */
  players: z.array(simulationPlayerSchema).length(5),
});
export type OpponentTeam = z.infer<typeof opponentTeamSchema>;
