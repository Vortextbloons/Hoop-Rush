/**
 * Stable source-name corrections keyed by the NBA external player ID.
 *
 * The source snapshot has Joe Barry Carroll split as `Joe Barry` / `Barry
 * Carroll`. IDs are authoritative; correcting the display fields here keeps
 * every downstream artifact consistent without guessing from arbitrary names.
 */
const PLAYER_NAME_CORRECTIONS: Readonly<Record<string, readonly [string, string]>> = {
  '76353': ['Joe Barry', 'Carroll'],
};

export function canonicalPlayerName(
  externalId: string,
  firstName: string,
  lastName: string,
): readonly [string, string] {
  return PLAYER_NAME_CORRECTIONS[externalId] ?? [firstName, lastName];
}
