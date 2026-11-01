/** The message a thrown value should show to a player. */
export function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
