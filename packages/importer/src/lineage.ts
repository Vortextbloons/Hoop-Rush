/**
 * Authoritative modern franchise slots and historical NBA lineage (spec/12).
 *
 * Every NBA team-season resolves to exactly one modern franchise slot and one
 * historical identity. The lineage table, never a name or abbreviation,
 * determines ownership. Segments are NBA-valid only: ABA and other
 * predecessor-league rows are excluded (Nets/Pacers/Nuggets/Spurs begin at
 * the 1976-77 merger; Hornets at 1988-89; Pelicans at 2002-03).
 *
 * Source identity note: NBA.com statistics endpoints publish historical
 * seasons under the modern franchise team ID (Seattle SuperSonics games are
 * returned under 1610612760, original Charlotte Hornets games under
 * 1610612766), and the source's own continuity matches the NBA's reassigned
 * Charlotte/New Orleans history. Source IDs are retained as metadata; the
 * game's lineage table still resolves ownership explicitly.
 */

export interface LineageSegment {
  /** Modern franchise slot that owns this segment. */
  modernFranchiseId: string;
  /** Source team identity for the segment (NBA team ID). */
  historicalTeamId: string;
  /** First NBA season of this identity, inclusive. */
  validFromSeasonKey: string;
  /** Last NBA season of this identity, inclusive; absent when current. */
  validThroughSeasonKey?: string;
  /** Historical display name. */
  displayName: string;
  /** Historical city. */
  city: string;
  /** Historical source abbreviation. */
  abbreviation?: string;
}

export interface ModernSlot {
  franchiseId: string;
  displayName: string;
  teamExternalId: string;
}

/** Exactly 30 modern franchise slots, ordered by NBA team ID. */
export const MODERN_SLOTS: readonly ModernSlot[] = [
  { franchiseId: 'hawks', displayName: 'Atlanta Hawks', teamExternalId: '1610612737' },
  { franchiseId: 'celtics', displayName: 'Boston Celtics', teamExternalId: '1610612738' },
  { franchiseId: 'nets', displayName: 'Brooklyn Nets', teamExternalId: '1610612751' },
  { franchiseId: 'hornets', displayName: 'Charlotte Hornets', teamExternalId: '1610612766' },
  { franchiseId: 'bulls', displayName: 'Chicago Bulls', teamExternalId: '1610612741' },
  { franchiseId: 'cavaliers', displayName: 'Cleveland Cavaliers', teamExternalId: '1610612739' },
  { franchiseId: 'mavericks', displayName: 'Dallas Mavericks', teamExternalId: '1610612742' },
  { franchiseId: 'nuggets', displayName: 'Denver Nuggets', teamExternalId: '1610612743' },
  { franchiseId: 'pistons', displayName: 'Detroit Pistons', teamExternalId: '1610612765' },
  { franchiseId: 'warriors', displayName: 'Golden State Warriors', teamExternalId: '1610612744' },
  { franchiseId: 'rockets', displayName: 'Houston Rockets', teamExternalId: '1610612745' },
  { franchiseId: 'pacers', displayName: 'Indiana Pacers', teamExternalId: '1610612754' },
  { franchiseId: 'clippers', displayName: 'Los Angeles Clippers', teamExternalId: '1610612746' },
  { franchiseId: 'lakers', displayName: 'Los Angeles Lakers', teamExternalId: '1610612747' },
  { franchiseId: 'grizzlies', displayName: 'Memphis Grizzlies', teamExternalId: '1610612763' },
  { franchiseId: 'heat', displayName: 'Miami Heat', teamExternalId: '1610612748' },
  { franchiseId: 'bucks', displayName: 'Milwaukee Bucks', teamExternalId: '1610612749' },
  {
    franchiseId: 'timberwolves',
    displayName: 'Minnesota Timberwolves',
    teamExternalId: '1610612750',
  },
  { franchiseId: 'pelicans', displayName: 'New Orleans Pelicans', teamExternalId: '1610612740' },
  { franchiseId: 'knicks', displayName: 'New York Knicks', teamExternalId: '1610612752' },
  { franchiseId: 'thunder', displayName: 'Oklahoma City Thunder', teamExternalId: '1610612760' },
  { franchiseId: 'magic', displayName: 'Orlando Magic', teamExternalId: '1610612753' },
  { franchiseId: 'sixers', displayName: 'Philadelphia 76ers', teamExternalId: '1610612755' },
  { franchiseId: 'suns', displayName: 'Phoenix Suns', teamExternalId: '1610612756' },
  { franchiseId: 'blazers', displayName: 'Portland Trail Blazers', teamExternalId: '1610612757' },
  { franchiseId: 'kings', displayName: 'Sacramento Kings', teamExternalId: '1610612758' },
  { franchiseId: 'spurs', displayName: 'San Antonio Spurs', teamExternalId: '1610612759' },
  { franchiseId: 'raptors', displayName: 'Toronto Raptors', teamExternalId: '1610612761' },
  { franchiseId: 'jazz', displayName: 'Utah Jazz', teamExternalId: '1610612762' },
  { franchiseId: 'wizards', displayName: 'Washington Wizards', teamExternalId: '1610612764' },
];

/**
 * Complete NBA-valid lineage segments, oldest first. Non-NBA play (ABA,
 * NBL, BAA predecessor history that never joined the NBA) is excluded; the
 * NBA-valid start is the BAA/NBA membership season.
 */
export const LINEAGE_SEGMENTS: readonly LineageSegment[] = [
  // Hawks: Buffalo Bisons/Tri-Cities (1946-47), Tri-Cities, Milwaukee, St. Louis, Atlanta
  {
    modernFranchiseId: 'hawks',
    historicalTeamId: '1610612737',
    validFromSeasonKey: '1946-47',
    validThroughSeasonKey: '1950-51',
    displayName: 'Tri-Cities Blackhawks',
    city: 'Tri-Cities',
    abbreviation: 'TRI',
  },
  {
    modernFranchiseId: 'hawks',
    historicalTeamId: '1610612737',
    validFromSeasonKey: '1951-52',
    validThroughSeasonKey: '1954-55',
    displayName: 'Milwaukee Hawks',
    city: 'Milwaukee',
    abbreviation: 'MIL',
  },
  {
    modernFranchiseId: 'hawks',
    historicalTeamId: '1610612737',
    validFromSeasonKey: '1955-56',
    validThroughSeasonKey: '1967-68',
    displayName: 'St. Louis Hawks',
    city: 'St. Louis',
    abbreviation: 'STL',
  },
  {
    modernFranchiseId: 'hawks',
    historicalTeamId: '1610612737',
    validFromSeasonKey: '1968-69',
    displayName: 'Atlanta Hawks',
    city: 'Atlanta',
    abbreviation: 'ATL',
  },
  // Celtics
  {
    modernFranchiseId: 'celtics',
    historicalTeamId: '1610612738',
    validFromSeasonKey: '1946-47',
    displayName: 'Boston Celtics',
    city: 'Boston',
    abbreviation: 'BOS',
  },
  // Nets: NBA from the 1976-77 merger
  {
    modernFranchiseId: 'nets',
    historicalTeamId: '1610612751',
    validFromSeasonKey: '1976-77',
    validThroughSeasonKey: '1977-78',
    displayName: 'New York Nets',
    city: 'New York',
    abbreviation: 'NYN',
  },
  {
    modernFranchiseId: 'nets',
    historicalTeamId: '1610612751',
    validFromSeasonKey: '1978-79',
    validThroughSeasonKey: '2011-12',
    displayName: 'New Jersey Nets',
    city: 'New Jersey',
    abbreviation: 'NJN',
  },
  {
    modernFranchiseId: 'nets',
    historicalTeamId: '1610612751',
    validFromSeasonKey: '2012-13',
    displayName: 'Brooklyn Nets',
    city: 'Brooklyn',
    abbreviation: 'BKN',
  },
  // Hornets: original Charlotte Hornets + Bobcats/Hornets; 2002-03/2003-04 gap
  {
    modernFranchiseId: 'hornets',
    historicalTeamId: '1610612766',
    validFromSeasonKey: '1988-89',
    validThroughSeasonKey: '2001-02',
    displayName: 'Charlotte Hornets',
    city: 'Charlotte',
    abbreviation: 'CHH',
  },
  {
    modernFranchiseId: 'hornets',
    historicalTeamId: '1610612766',
    validFromSeasonKey: '2004-05',
    validThroughSeasonKey: '2013-14',
    displayName: 'Charlotte Bobcats',
    city: 'Charlotte',
    abbreviation: 'CHA',
  },
  {
    modernFranchiseId: 'hornets',
    historicalTeamId: '1610612766',
    validFromSeasonKey: '2014-15',
    displayName: 'Charlotte Hornets',
    city: 'Charlotte',
    abbreviation: 'CHA',
  },
  // Bulls
  {
    modernFranchiseId: 'bulls',
    historicalTeamId: '1610612741',
    validFromSeasonKey: '1966-67',
    displayName: 'Chicago Bulls',
    city: 'Chicago',
    abbreviation: 'CHI',
  },
  // Cavaliers
  {
    modernFranchiseId: 'cavaliers',
    historicalTeamId: '1610612739',
    validFromSeasonKey: '1970-71',
    displayName: 'Cleveland Cavaliers',
    city: 'Cleveland',
    abbreviation: 'CLE',
  },
  // Mavericks
  {
    modernFranchiseId: 'mavericks',
    historicalTeamId: '1610612742',
    validFromSeasonKey: '1980-81',
    displayName: 'Dallas Mavericks',
    city: 'Dallas',
    abbreviation: 'DAL',
  },
  // Nuggets: NBA from the 1976-77 merger
  {
    modernFranchiseId: 'nuggets',
    historicalTeamId: '1610612743',
    validFromSeasonKey: '1976-77',
    displayName: 'Denver Nuggets',
    city: 'Denver',
    abbreviation: 'DEN',
  },
  // Pistons: Fort Wayne Zollner Pistons joined the BAA for 1948-49
  {
    modernFranchiseId: 'pistons',
    historicalTeamId: '1610612765',
    validFromSeasonKey: '1948-49',
    validThroughSeasonKey: '1956-57',
    displayName: 'Fort Wayne Pistons',
    city: 'Fort Wayne',
    abbreviation: 'FWP',
  },
  {
    modernFranchiseId: 'pistons',
    historicalTeamId: '1610612765',
    validFromSeasonKey: '1957-58',
    displayName: 'Detroit Pistons',
    city: 'Detroit',
    abbreviation: 'DET',
  },
  // Warriors
  {
    modernFranchiseId: 'warriors',
    historicalTeamId: '1610612744',
    validFromSeasonKey: '1946-47',
    validThroughSeasonKey: '1961-62',
    displayName: 'Philadelphia Warriors',
    city: 'Philadelphia',
    abbreviation: 'PHW',
  },
  {
    modernFranchiseId: 'warriors',
    historicalTeamId: '1610612744',
    validFromSeasonKey: '1962-63',
    validThroughSeasonKey: '1970-71',
    displayName: 'San Francisco Warriors',
    city: 'San Francisco',
    abbreviation: 'SFW',
  },
  {
    modernFranchiseId: 'warriors',
    historicalTeamId: '1610612744',
    validFromSeasonKey: '1971-72',
    displayName: 'Golden State Warriors',
    city: 'Golden State',
    abbreviation: 'GSW',
  },
  // Rockets
  {
    modernFranchiseId: 'rockets',
    historicalTeamId: '1610612745',
    validFromSeasonKey: '1967-68',
    validThroughSeasonKey: '1970-71',
    displayName: 'San Diego Rockets',
    city: 'San Diego',
    abbreviation: 'SDR',
  },
  {
    modernFranchiseId: 'rockets',
    historicalTeamId: '1610612745',
    validFromSeasonKey: '1971-72',
    displayName: 'Houston Rockets',
    city: 'Houston',
    abbreviation: 'HOU',
  },
  // Pacers: NBA from the 1976-77 merger
  {
    modernFranchiseId: 'pacers',
    historicalTeamId: '1610612754',
    validFromSeasonKey: '1976-77',
    displayName: 'Indiana Pacers',
    city: 'Indiana',
    abbreviation: 'IND',
  },
  // Clippers
  {
    modernFranchiseId: 'clippers',
    historicalTeamId: '1610612746',
    validFromSeasonKey: '1970-71',
    validThroughSeasonKey: '1977-78',
    displayName: 'Buffalo Braves',
    city: 'Buffalo',
    abbreviation: 'BUF',
  },
  {
    modernFranchiseId: 'clippers',
    historicalTeamId: '1610612746',
    validFromSeasonKey: '1978-79',
    validThroughSeasonKey: '1983-84',
    displayName: 'San Diego Clippers',
    city: 'San Diego',
    abbreviation: 'SDC',
  },
  {
    modernFranchiseId: 'clippers',
    historicalTeamId: '1610612746',
    validFromSeasonKey: '1984-85',
    displayName: 'Los Angeles Clippers',
    city: 'Los Angeles',
    abbreviation: 'LAC',
  },
  // Lakers: Minneapolis Lakers joined the BAA for 1948-49
  {
    modernFranchiseId: 'lakers',
    historicalTeamId: '1610612747',
    validFromSeasonKey: '1948-49',
    validThroughSeasonKey: '1959-60',
    displayName: 'Minneapolis Lakers',
    city: 'Minneapolis',
    abbreviation: 'MNL',
  },
  {
    modernFranchiseId: 'lakers',
    historicalTeamId: '1610612747',
    validFromSeasonKey: '1960-61',
    displayName: 'Los Angeles Lakers',
    city: 'Los Angeles',
    abbreviation: 'LAL',
  },
  // Grizzlies: Vancouver expansion 1995-96
  {
    modernFranchiseId: 'grizzlies',
    historicalTeamId: '1610612763',
    validFromSeasonKey: '1995-96',
    validThroughSeasonKey: '2000-01',
    displayName: 'Vancouver Grizzlies',
    city: 'Vancouver',
    abbreviation: 'VAN',
  },
  {
    modernFranchiseId: 'grizzlies',
    historicalTeamId: '1610612763',
    validFromSeasonKey: '2001-02',
    displayName: 'Memphis Grizzlies',
    city: 'Memphis',
    abbreviation: 'MEM',
  },
  // Heat
  {
    modernFranchiseId: 'heat',
    historicalTeamId: '1610612748',
    validFromSeasonKey: '1988-89',
    displayName: 'Miami Heat',
    city: 'Miami',
    abbreviation: 'MIA',
  },
  // Bucks
  {
    modernFranchiseId: 'bucks',
    historicalTeamId: '1610612749',
    validFromSeasonKey: '1968-69',
    displayName: 'Milwaukee Bucks',
    city: 'Milwaukee',
    abbreviation: 'MIL',
  },
  // Timberwolves
  {
    modernFranchiseId: 'timberwolves',
    historicalTeamId: '1610612750',
    validFromSeasonKey: '1989-90',
    displayName: 'Minnesota Timberwolves',
    city: 'Minneapolis',
    abbreviation: 'MIN',
  },
  // Pelicans: New Orleans franchise began 2002-03 (Hornets name; OKC relocation 2005-07)
  {
    modernFranchiseId: 'pelicans',
    historicalTeamId: '1610612740',
    validFromSeasonKey: '2002-03',
    validThroughSeasonKey: '2012-13',
    displayName: 'New Orleans Hornets',
    city: 'New Orleans',
    abbreviation: 'NOH',
  },
  {
    modernFranchiseId: 'pelicans',
    historicalTeamId: '1610612740',
    validFromSeasonKey: '2013-14',
    displayName: 'New Orleans Pelicans',
    city: 'New Orleans',
    abbreviation: 'NOP',
  },
  // Knicks
  {
    modernFranchiseId: 'knicks',
    historicalTeamId: '1610612752',
    validFromSeasonKey: '1946-47',
    displayName: 'New York Knicks',
    city: 'New York',
    abbreviation: 'NYK',
  },
  // Thunder: Seattle SuperSonics 1967-68 through 2007-08
  {
    modernFranchiseId: 'thunder',
    historicalTeamId: '1610612760',
    validFromSeasonKey: '1967-68',
    validThroughSeasonKey: '2007-08',
    displayName: 'Seattle SuperSonics',
    city: 'Seattle',
    abbreviation: 'SEA',
  },
  {
    modernFranchiseId: 'thunder',
    historicalTeamId: '1610612760',
    validFromSeasonKey: '2008-09',
    displayName: 'Oklahoma City Thunder',
    city: 'Oklahoma City',
    abbreviation: 'OKC',
  },
  // Magic
  {
    modernFranchiseId: 'magic',
    historicalTeamId: '1610612753',
    validFromSeasonKey: '1989-90',
    displayName: 'Orlando Magic',
    city: 'Orlando',
    abbreviation: 'ORL',
  },
  // 76ers: Syracuse Nationals joined the NBA for 1949-50
  {
    modernFranchiseId: 'sixers',
    historicalTeamId: '1610612755',
    validFromSeasonKey: '1949-50',
    validThroughSeasonKey: '1962-63',
    displayName: 'Syracuse Nationals',
    city: 'Syracuse',
    abbreviation: 'SYR',
  },
  {
    modernFranchiseId: 'sixers',
    historicalTeamId: '1610612755',
    validFromSeasonKey: '1963-64',
    displayName: 'Philadelphia 76ers',
    city: 'Philadelphia',
    abbreviation: 'PHI',
  },
  // Suns
  {
    modernFranchiseId: 'suns',
    historicalTeamId: '1610612756',
    validFromSeasonKey: '1968-69',
    displayName: 'Phoenix Suns',
    city: 'Phoenix',
    abbreviation: 'PHX',
  },
  // Trail Blazers
  {
    modernFranchiseId: 'blazers',
    historicalTeamId: '1610612757',
    validFromSeasonKey: '1970-71',
    displayName: 'Portland Trail Blazers',
    city: 'Portland',
    abbreviation: 'POR',
  },
  // Kings: Rochester Royals joined the NBA for 1948-49
  {
    modernFranchiseId: 'kings',
    historicalTeamId: '1610612758',
    validFromSeasonKey: '1948-49',
    validThroughSeasonKey: '1956-57',
    displayName: 'Rochester Royals',
    city: 'Rochester',
    abbreviation: 'ROC',
  },
  {
    modernFranchiseId: 'kings',
    historicalTeamId: '1610612758',
    validFromSeasonKey: '1957-58',
    validThroughSeasonKey: '1971-72',
    displayName: 'Cincinnati Royals',
    city: 'Cincinnati',
    abbreviation: 'CIN',
  },
  {
    modernFranchiseId: 'kings',
    historicalTeamId: '1610612758',
    validFromSeasonKey: '1972-73',
    validThroughSeasonKey: '1974-75',
    displayName: 'Kansas City-Omaha Kings',
    city: 'Kansas City-Omaha',
    abbreviation: 'KCO',
  },
  {
    modernFranchiseId: 'kings',
    historicalTeamId: '1610612758',
    validFromSeasonKey: '1975-76',
    validThroughSeasonKey: '1984-85',
    displayName: 'Kansas City Kings',
    city: 'Kansas City',
    abbreviation: 'KCK',
  },
  {
    modernFranchiseId: 'kings',
    historicalTeamId: '1610612758',
    validFromSeasonKey: '1985-86',
    displayName: 'Sacramento Kings',
    city: 'Sacramento',
    abbreviation: 'SAC',
  },
  // Spurs: NBA from the 1976-77 merger
  {
    modernFranchiseId: 'spurs',
    historicalTeamId: '1610612759',
    validFromSeasonKey: '1976-77',
    displayName: 'San Antonio Spurs',
    city: 'San Antonio',
    abbreviation: 'SAS',
  },
  // Raptors
  {
    modernFranchiseId: 'raptors',
    historicalTeamId: '1610612761',
    validFromSeasonKey: '1995-96',
    displayName: 'Toronto Raptors',
    city: 'Toronto',
    abbreviation: 'TOR',
  },
  // Jazz: New Orleans Jazz expansion 1974-75
  {
    modernFranchiseId: 'jazz',
    historicalTeamId: '1610612762',
    validFromSeasonKey: '1974-75',
    validThroughSeasonKey: '1978-79',
    displayName: 'New Orleans Jazz',
    city: 'New Orleans',
    abbreviation: 'NOJ',
  },
  {
    modernFranchiseId: 'jazz',
    historicalTeamId: '1610612762',
    validFromSeasonKey: '1979-80',
    displayName: 'Utah Jazz',
    city: 'Utah',
    abbreviation: 'UTA',
  },
  // Wizards: Chicago Packers expansion 1961-62
  {
    modernFranchiseId: 'wizards',
    historicalTeamId: '1610612764',
    validFromSeasonKey: '1961-62',
    validThroughSeasonKey: '1961-62',
    displayName: 'Chicago Packers',
    city: 'Chicago',
    abbreviation: 'CHP',
  },
  {
    modernFranchiseId: 'wizards',
    historicalTeamId: '1610612764',
    validFromSeasonKey: '1962-63',
    validThroughSeasonKey: '1962-63',
    displayName: 'Chicago Zephyrs',
    city: 'Chicago',
    abbreviation: 'CHZ',
  },
  {
    modernFranchiseId: 'wizards',
    historicalTeamId: '1610612764',
    validFromSeasonKey: '1963-64',
    validThroughSeasonKey: '1972-73',
    displayName: 'Baltimore Bullets',
    city: 'Baltimore',
    abbreviation: 'BAL',
  },
  {
    modernFranchiseId: 'wizards',
    historicalTeamId: '1610612764',
    validFromSeasonKey: '1973-74',
    validThroughSeasonKey: '1973-74',
    displayName: 'Capital Bullets',
    city: 'Washington',
    abbreviation: 'CAP',
  },
  {
    modernFranchiseId: 'wizards',
    historicalTeamId: '1610612764',
    validFromSeasonKey: '1974-75',
    validThroughSeasonKey: '1996-97',
    displayName: 'Washington Bullets',
    city: 'Washington',
    abbreviation: 'WSB',
  },
  {
    modernFranchiseId: 'wizards',
    historicalTeamId: '1610612764',
    validFromSeasonKey: '1997-98',
    displayName: 'Washington Wizards',
    city: 'Washington',
    abbreviation: 'WAS',
  },
];

/** Season key ordering helper: '1960-61' < '1969-70' compares directly. */
export function seasonKeyAtLeast(season: string, bound: string): boolean {
  return season >= bound;
}

export function seasonKeyAtMost(season: string, bound: string): boolean {
  return season <= bound;
}

/** First NBA season of a modern slot (for unavailable-combination display). */
export function firstSupportedSeason(franchiseId: string): string | null {
  const first = LINEAGE_SEGMENTS.find((s) => s.modernFranchiseId === franchiseId);
  return first?.validFromSeasonKey ?? null;
}

/** Resolves a season to the historical identity that owned it, if any. */
export function resolveHistoricalIdentity(
  franchiseId: string,
  season: string,
): LineageSegment | null {
  const segments = LINEAGE_SEGMENTS.filter((s) => s.modernFranchiseId === franchiseId);
  for (const segment of segments) {
    if (
      season >= segment.validFromSeasonKey &&
      (segment.validThroughSeasonKey === undefined || season <= segment.validThroughSeasonKey)
    ) {
      return segment;
    }
  }
  return null;
}

/** Resolves a source team-season row to exactly one modern slot, or null. */
export function resolveModernFranchise(teamExternalId: string, season: string): string | null {
  const segment = LINEAGE_SEGMENTS.find(
    (s) =>
      s.historicalTeamId === teamExternalId &&
      season >= s.validFromSeasonKey &&
      (s.validThroughSeasonKey === undefined || season <= s.validThroughSeasonKey),
  );
  return segment?.modernFranchiseId ?? null;
}

/** True when the modern slot had an NBA team in the season. */
export function slotExistsInSeason(franchiseId: string, season: string): boolean {
  return resolveHistoricalIdentity(franchiseId, season) !== null;
}

/** Map of teamExternalId -> first NBA season (fetch-layer planning). */
export function foundingSeasonByTeamExternalId(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const segment of LINEAGE_SEGMENTS) {
    const existing = map[segment.historicalTeamId];
    if (existing === undefined || segment.validFromSeasonKey < existing) {
      map[segment.historicalTeamId] = segment.validFromSeasonKey;
    }
  }
  return map;
}

/** Validates the lineage table: 30 slots, no overlaps, no gaps inside ranges. */
export function auditLineageTable(): string[] {
  const failures: string[] = [];
  const slots = new Set(MODERN_SLOTS.map((s) => s.franchiseId));
  if (slots.size !== 30) failures.push('modern slots must be exactly 30');
  const slotIds = new Set<string>();
  for (const slot of MODERN_SLOTS) {
    if (slotIds.has(slot.franchiseId)) failures.push(`duplicate modern slot ${slot.franchiseId}`);
    slotIds.add(slot.franchiseId);
  }
  const bySlot = new Map<string, LineageSegment[]>();
  for (const segment of LINEAGE_SEGMENTS) {
    if (!slotIds.has(segment.modernFranchiseId)) {
      failures.push(`lineage references unknown slot ${segment.modernFranchiseId}`);
    }
    const list = bySlot.get(segment.modernFranchiseId) ?? [];
    list.push(segment);
    bySlot.set(segment.modernFranchiseId, list);
  }
  for (const [franchiseId, segments] of bySlot) {
    const sorted = [...segments].sort((a, b) =>
      a.validFromSeasonKey.localeCompare(b.validFromSeasonKey),
    );
    for (let i = 0; i < sorted.length; i += 1) {
      const current = sorted[i]!;
      if (current.validFromSeasonKey > (current.validThroughSeasonKey ?? '9999-99')) {
        failures.push(`${franchiseId}: inverted range ${current.validFromSeasonKey}`);
      }
      const next = sorted[i + 1];
      if (!next) continue;
      if (
        current.validThroughSeasonKey !== undefined &&
        current.validThroughSeasonKey >= next.validFromSeasonKey
      ) {
        failures.push(
          `${franchiseId}: overlapping ranges ${current.validThroughSeasonKey} vs ${next.validFromSeasonKey}`,
        );
      }
    }
  }
  return failures;
}
