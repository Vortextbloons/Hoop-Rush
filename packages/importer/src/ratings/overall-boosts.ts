const OVERALL_FLOORS: Readonly<Record<string, number>> = {
  'p-893|1988-89': 99,
  'p-893|1990-91': 99,
  'p-2544|2009-10': 98,
  'p-2544|2012-13': 99,
  'p-2544|2017-18': 98,
};

export function overallWithBoost(playerId: string, season: string, overall: number): number {
  return Math.max(overall, OVERALL_FLOORS[`${playerId}|${season}`] ?? overall);
}
