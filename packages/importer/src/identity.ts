const PLAYER_NAME_CORRECTIONS: Readonly<Record<string, readonly [string, string]>> = {
  '2397': ['Yao', 'Ming'],
  '201146': ['Yi', 'Jianlian'],
  '2403': ['Nene', 'Hilario'],
  '1642905': ['Hansen', 'Yang'],
  '76353': ['Joe Barry', 'Carroll'],
};
export function canonicalPlayerName(
  externalId: string,
  firstName: string,
  lastName: string,
): readonly [string, string] {
  return PLAYER_NAME_CORRECTIONS[externalId] ?? [firstName, lastName];
}
