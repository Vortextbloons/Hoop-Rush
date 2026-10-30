import { z } from 'zod';
import { capRushApronFactSchema } from './cap-rush-apron.ts';
import { havocBattleInputSchema, havocBattleTapeSchema } from './havoc-battle.ts';

export const capRushPlaybackSchema = z
  .object({
    input: havocBattleInputSchema,
    tape: havocBattleTapeSchema,
    facts: z.array(capRushApronFactSchema),
    cursor: z.number().int().nonnegative(),
  })
  .superRefine((playback, ctx) => {
    if (playback.cursor > playback.tape.events.length + playback.tape.scoring.length) {
      ctx.addIssue({ code: 'custom', message: 'playback cursor exceeds the recorded tape' });
    }
    if (
      playback.input.seed !== playback.tape.seed ||
      playback.input.gameNumber !== playback.tape.gameNumber
    ) {
      ctx.addIssue({ code: 'custom', message: 'playback input and tape do not match' });
    }
  });
export type CapRushPlayback = z.infer<typeof capRushPlaybackSchema>;
