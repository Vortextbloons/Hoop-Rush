import { z } from 'zod';
const codeSchema = z.string().regex(/^\d{4}$/);
export function multiplayerInviteLink(code: string): `/multiplayer?code=${string}` {
  return `/multiplayer?code=${codeSchema.parse(code)}`;
}
