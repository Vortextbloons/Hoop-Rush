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
