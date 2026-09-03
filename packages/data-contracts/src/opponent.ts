import { z } from 'zod';
import { franchiseIdSchema, seasonKeySchema } from './ids.ts';
import { lineupSchema } from './lineup.ts';
import { simulationPlayerSchema } from './simulation.ts';
export const difficultyBandSchema = z.enum(['medium']);
export type DifficultyBand = z.infer<typeof difficultyBandSchema>;
export const opponentTeamSchema = z.object({
  schemaVersion: z.literal(2),
  opponentId: z.string().min(1).max(64),
  bracketVersion: z.string().min(1).max(64),
  difficultyBand: difficultyBandSchema,
  teamId: franchiseIdSchema,
  displayName: z.string().min(1).max(96),
  seasonKey: seasonKeySchema,
  lineup: lineupSchema,
  players: z.array(simulationPlayerSchema).length(5),
});
export type OpponentTeam = z.infer<typeof opponentTeamSchema>;
