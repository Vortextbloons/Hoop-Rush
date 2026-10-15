import { z } from 'zod';

export const modeIdSchema = z.enum(['classic', 'sandbox', 'havoc', 'ultimate-run', 'draft-duel']);
export type ModeId = z.infer<typeof modeIdSchema>;
export const multiplayerFormatIdSchema = z.enum(['season', 'duel', 'draft-duel', 'havoc']);
export type MultiplayerFormatId = z.infer<typeof multiplayerFormatIdSchema>;
export const fixedFiveSetupSchema = z.object({
  sourceMode: z.enum(['classic', 'sandbox']),
  variant: z.enum(['ratings', 'ball-knowledge']),
});
export const draftDuelSetupSchema = z.object({
  fairness: z.enum(['fair', 'unfair']),
  variant: z.enum(['ratings', 'ball-knowledge']),
});
export const havocSetupSchema = z.object({ variant: z.enum(['standard', 'curated']) });
export type MultiplayerSetup = Record<string, string>;
