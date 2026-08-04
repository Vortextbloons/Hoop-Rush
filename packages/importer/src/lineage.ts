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
  /** Verified historical logo candidates, best first. */
  logoCandidates?: Array<{
    url: string;
    source: string;
    attribution?: string;
  }>;
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
    logoCandidates: [
      {
        url: 'https://content.sportslogos.net/logos/6/1124/full/5658.gif',
        source: 'sportslogos',
        attribution: 'SportsLogos.net',
      },
      {
        url: 'https://cdn.nba.com/logos/nba/1610612737/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
  },
  {
    modernFranchiseId: 'hawks',
    historicalTeamId: '1610612737',
    validFromSeasonKey: '1951-52',
    validThroughSeasonKey: '1954-55',
    displayName: 'Milwaukee Hawks',
    city: 'Milwaukee',
    abbreviation: 'MIL',
    logoCandidates: [
      {
        url: 'https://content.sportslogos.net/logos/6/242/full/5659.gif',
        source: 'sportslogos',
        attribution: 'SportsLogos.net',
      },
      {
        url: 'https://cdn.nba.com/logos/nba/1610612737/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
  },
  {
    modernFranchiseId: 'hawks',
    historicalTeamId: '1610612737',
    validFromSeasonKey: '1955-56',
    validThroughSeasonKey: '1967-68',
    displayName: 'St. Louis Hawks',
    city: 'St. Louis',
    abbreviation: 'STL',
    logoCandidates: [
      {
        url: 'https://content.sportslogos.net/logos/6/243/full/lbr7pmgzcio7uqdwkwxch8l30.gif',
        source: 'sportslogos',
        attribution: 'SportsLogos.net',
      },
      {
        url: 'https://cdn.nba.com/logos/nba/1610612737/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
  },
  {
    modernFranchiseId: 'hawks',
    historicalTeamId: '1610612737',
    validFromSeasonKey: '1968-69',
    displayName: 'Atlanta Hawks',
    city: 'Atlanta',
    abbreviation: 'ATL',
    logoCandidates: [
      {
        url: 'https://cdn.nba.com/logos/nba/1610612737/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
  },
  // Celtics
  {
    modernFranchiseId: 'celtics',
    historicalTeamId: '1610612738',
    validFromSeasonKey: '1946-47',
    displayName: 'Boston Celtics',
    city: 'Boston',
    abbreviation: 'BOS',
    logoCandidates: [
      {
        url: 'https://cdn.nba.com/logos/nba/1610612738/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
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
    logoCandidates: [
      {
        url: 'https://content.sportslogos.net/logos/6/1428/full/5975.gif',
        source: 'sportslogos',
        attribution: 'SportsLogos.net',
      },
      {
        url: 'https://cdn.nba.com/logos/nba/1610612751/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
  },
  {
    modernFranchiseId: 'nets',
    historicalTeamId: '1610612751',
    validFromSeasonKey: '1978-79',
    validThroughSeasonKey: '2011-12',
    displayName: 'New Jersey Nets',
    city: 'New Jersey',
    abbreviation: 'NJN',
    logoCandidates: [
      {
        url: 'https://content.sportslogos.net/logos/6/215/full/hvkhsaffs9x9zre7gku4vmnte.gif',
        source: 'sportslogos',
        attribution: 'SportsLogos.net',
      },
      {
        url: 'https://cdn.nba.com/logos/nba/1610612751/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
  },
  {
    modernFranchiseId: 'nets',
    historicalTeamId: '1610612751',
    validFromSeasonKey: '2012-13',
    displayName: 'Brooklyn Nets',
    city: 'Brooklyn',
    abbreviation: 'BKN',
    logoCandidates: [
      {
        url: 'https://cdn.nba.com/logos/nba/1610612751/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
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
    logoCandidates: [
      {
        url: 'https://content.sportslogos.net/logos/6/256/full/3097.gif',
        source: 'sportslogos',
        attribution: 'SportsLogos.net',
      },
      {
        url: 'https://cdn.nba.com/logos/nba/1610612766/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
  },
  {
    modernFranchiseId: 'hornets',
    historicalTeamId: '1610612766',
    validFromSeasonKey: '2004-05',
    validThroughSeasonKey: '2013-14',
    displayName: 'Charlotte Bobcats',
    city: 'Charlotte',
    abbreviation: 'CHA',
    logoCandidates: [
      {
        url: 'https://content.sportslogos.net/logos/6/258/full/tytgxvgwe3r0hwqaehb3lxef7.gif',
        source: 'sportslogos',
        attribution: 'SportsLogos.net',
      },
      {
        url: 'https://cdn.nba.com/logos/nba/1610612766/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
  },
  {
    modernFranchiseId: 'hornets',
    historicalTeamId: '1610612766',
    validFromSeasonKey: '2014-15',
    displayName: 'Charlotte Hornets',
    city: 'Charlotte',
    abbreviation: 'CHA',
    logoCandidates: [
      {
        url: 'https://cdn.nba.com/logos/nba/1610612766/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
  },
  // Bulls
  {
    modernFranchiseId: 'bulls',
    historicalTeamId: '1610612741',
    validFromSeasonKey: '1966-67',
    displayName: 'Chicago Bulls',
    city: 'Chicago',
    abbreviation: 'CHI',
    logoCandidates: [
      {
        url: 'https://cdn.nba.com/logos/nba/1610612741/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
  },
  // Cavaliers
  {
    modernFranchiseId: 'cavaliers',
    historicalTeamId: '1610612739',
    validFromSeasonKey: '1970-71',
    displayName: 'Cleveland Cavaliers',
    city: 'Cleveland',
    abbreviation: 'CLE',
    logoCandidates: [
      {
        url: 'https://cdn.nba.com/logos/nba/1610612739/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
  },
  // Mavericks
  {
    modernFranchiseId: 'mavericks',
    historicalTeamId: '1610612742',
    validFromSeasonKey: '1980-81',
    displayName: 'Dallas Mavericks',
    city: 'Dallas',
    abbreviation: 'DAL',
    logoCandidates: [
      {
        url: 'https://cdn.nba.com/logos/nba/1610612742/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
  },
  // Nuggets: NBA from the 1976-77 merger
  {
    modernFranchiseId: 'nuggets',
    historicalTeamId: '1610612743',
    validFromSeasonKey: '1976-77',
    displayName: 'Denver Nuggets',
    city: 'Denver',
    abbreviation: 'DEN',
    logoCandidates: [
      {
        url: 'https://cdn.nba.com/logos/nba/1610612743/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
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
    logoCandidates: [
      {
        url: 'https://content.sportslogos.net/logos/6/244/full/4953.gif',
        source: 'sportslogos',
        attribution: 'SportsLogos.net',
      },
      {
        url: 'https://cdn.nba.com/logos/nba/1610612765/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
  },
  {
    modernFranchiseId: 'pistons',
    historicalTeamId: '1610612765',
    validFromSeasonKey: '1957-58',
    displayName: 'Detroit Pistons',
    city: 'Detroit',
    abbreviation: 'DET',
    logoCandidates: [
      {
        url: 'https://cdn.nba.com/logos/nba/1610612765/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
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
    logoCandidates: [
      {
        url: 'https://content.sportslogos.net/logos/6/249/full/5509.gif',
        source: 'sportslogos',
        attribution: 'SportsLogos.net',
      },
      {
        url: 'https://cdn.nba.com/logos/nba/1610612744/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
  },
  {
    modernFranchiseId: 'warriors',
    historicalTeamId: '1610612744',
    validFromSeasonKey: '1962-63',
    validThroughSeasonKey: '1970-71',
    displayName: 'San Francisco Warriors',
    city: 'San Francisco',
    abbreviation: 'SFW',
    logoCandidates: [
      {
        url: 'https://content.sportslogos.net/logos/6/1429/full/5972.gif',
        source: 'sportslogos',
        attribution: 'SportsLogos.net',
      },
      {
        url: 'https://cdn.nba.com/logos/nba/1610612744/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
  },
  {
    modernFranchiseId: 'warriors',
    historicalTeamId: '1610612744',
    validFromSeasonKey: '1971-72',
    displayName: 'Golden State Warriors',
    city: 'Golden State',
    abbreviation: 'GSW',
    logoCandidates: [
      {
        url: 'https://cdn.nba.com/logos/nba/1610612744/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
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
    logoCandidates: [
      {
        url: 'https://content.sportslogos.net/logos/6/252/full/4788.gif',
        source: 'sportslogos',
        attribution: 'SportsLogos.net',
      },
      {
        url: 'https://cdn.nba.com/logos/nba/1610612745/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
  },
  {
    modernFranchiseId: 'rockets',
    historicalTeamId: '1610612745',
    validFromSeasonKey: '1971-72',
    displayName: 'Houston Rockets',
    city: 'Houston',
    abbreviation: 'HOU',
    logoCandidates: [
      {
        url: 'https://cdn.nba.com/logos/nba/1610612745/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
  },
  // Pacers: NBA from the 1976-77 merger
  {
    modernFranchiseId: 'pacers',
    historicalTeamId: '1610612754',
    validFromSeasonKey: '1976-77',
    displayName: 'Indiana Pacers',
    city: 'Indiana',
    abbreviation: 'IND',
    logoCandidates: [
      {
        url: 'https://cdn.nba.com/logos/nba/1610612754/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
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
    logoCandidates: [
      {
        url: 'https://content.sportslogos.net/logos/6/253/full/5451.gif',
        source: 'sportslogos',
        attribution: 'SportsLogos.net',
      },
      {
        url: 'https://cdn.nba.com/logos/nba/1610612746/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
  },
  {
    modernFranchiseId: 'clippers',
    historicalTeamId: '1610612746',
    validFromSeasonKey: '1978-79',
    validThroughSeasonKey: '1983-84',
    displayName: 'San Diego Clippers',
    city: 'San Diego',
    abbreviation: 'SDC',
    logoCandidates: [
      {
        url: 'https://content.sportslogos.net/logos/6/254/full/5452.gif',
        source: 'sportslogos',
        attribution: 'SportsLogos.net',
      },
      {
        url: 'https://cdn.nba.com/logos/nba/1610612746/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
  },
  {
    modernFranchiseId: 'clippers',
    historicalTeamId: '1610612746',
    validFromSeasonKey: '1984-85',
    displayName: 'Los Angeles Clippers',
    city: 'Los Angeles',
    abbreviation: 'LAC',
    logoCandidates: [
      {
        url: 'https://cdn.nba.com/logos/nba/1610612746/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
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
    logoCandidates: [
      {
        url: 'https://content.sportslogos.net/logos/6/245/full/ehdguza6e3dn3h2ay4cbulnpn.gif',
        source: 'sportslogos',
        attribution: 'SportsLogos.net',
      },
      {
        url: 'https://cdn.nba.com/logos/nba/1610612747/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
  },
  {
    modernFranchiseId: 'lakers',
    historicalTeamId: '1610612747',
    validFromSeasonKey: '1960-61',
    displayName: 'Los Angeles Lakers',
    city: 'Los Angeles',
    abbreviation: 'LAL',
    logoCandidates: [
      {
        url: 'https://cdn.nba.com/logos/nba/1610612747/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
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
    logoCandidates: [
      {
        url: 'https://content.sportslogos.net/logos/6/257/full/7hc558rh9vls8j6fam4hly46n.gif',
        source: 'sportslogos',
        attribution: 'SportsLogos.net',
      },
      {
        url: 'https://cdn.nba.com/logos/nba/1610612763/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
  },
  {
    modernFranchiseId: 'grizzlies',
    historicalTeamId: '1610612763',
    validFromSeasonKey: '2001-02',
    displayName: 'Memphis Grizzlies',
    city: 'Memphis',
    abbreviation: 'MEM',
    logoCandidates: [
      {
        url: 'https://cdn.nba.com/logos/nba/1610612763/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
  },
  // Heat
  {
    modernFranchiseId: 'heat',
    historicalTeamId: '1610612748',
    validFromSeasonKey: '1988-89',
    displayName: 'Miami Heat',
    city: 'Miami',
    abbreviation: 'MIA',
    logoCandidates: [
      {
        url: 'https://cdn.nba.com/logos/nba/1610612748/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
  },
  // Bucks
  {
    modernFranchiseId: 'bucks',
    historicalTeamId: '1610612749',
    validFromSeasonKey: '1968-69',
    displayName: 'Milwaukee Bucks',
    city: 'Milwaukee',
    abbreviation: 'MIL',
    logoCandidates: [
      {
        url: 'https://cdn.nba.com/logos/nba/1610612749/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
  },
  // Timberwolves
  {
    modernFranchiseId: 'timberwolves',
    historicalTeamId: '1610612750',
    validFromSeasonKey: '1989-90',
    displayName: 'Minnesota Timberwolves',
    city: 'Minneapolis',
    abbreviation: 'MIN',
    logoCandidates: [
      {
        url: 'https://cdn.nba.com/logos/nba/1610612750/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
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
    logoCandidates: [
      {
        url: 'https://content.sportslogos.net/logos/6/226/full/q8cgr5dizhfukxvgzk5zf3dt6.gif',
        source: 'sportslogos',
        attribution: 'SportsLogos.net',
      },
      {
        url: 'https://cdn.nba.com/logos/nba/1610612740/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
  },
  {
    modernFranchiseId: 'pelicans',
    historicalTeamId: '1610612740',
    validFromSeasonKey: '2013-14',
    displayName: 'New Orleans Pelicans',
    city: 'New Orleans',
    abbreviation: 'NOP',
    logoCandidates: [
      {
        url: 'https://cdn.nba.com/logos/nba/1610612740/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
  },
  // Knicks
  {
    modernFranchiseId: 'knicks',
    historicalTeamId: '1610612752',
    validFromSeasonKey: '1946-47',
    displayName: 'New York Knicks',
    city: 'New York',
    abbreviation: 'NYK',
    logoCandidates: [
      {
        url: 'https://cdn.nba.com/logos/nba/1610612752/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
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
    logoCandidates: [
      {
        url: 'https://content.sportslogos.net/logos/6/241/full/cxe7hh6lwjtpdhcoyiuc064sp.gif',
        source: 'sportslogos',
        attribution: 'SportsLogos.net',
      },
      {
        url: 'https://cdn.nba.com/logos/nba/1610612760/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
  },
  {
    modernFranchiseId: 'thunder',
    historicalTeamId: '1610612760',
    validFromSeasonKey: '2008-09',
    displayName: 'Oklahoma City Thunder',
    city: 'Oklahoma City',
    abbreviation: 'OKC',
    logoCandidates: [
      {
        url: 'https://cdn.nba.com/logos/nba/1610612760/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
  },
  // Magic
  {
    modernFranchiseId: 'magic',
    historicalTeamId: '1610612753',
    validFromSeasonKey: '1989-90',
    displayName: 'Orlando Magic',
    city: 'Orlando',
    abbreviation: 'ORL',
    logoCandidates: [
      {
        url: 'https://cdn.nba.com/logos/nba/1610612753/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
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
    logoCandidates: [
      {
        url: 'https://content.sportslogos.net/logos/6/250/full/4600.gif',
        source: 'sportslogos',
        attribution: 'SportsLogos.net',
      },
      {
        url: 'https://cdn.nba.com/logos/nba/1610612755/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
  },
  {
    modernFranchiseId: 'sixers',
    historicalTeamId: '1610612755',
    validFromSeasonKey: '1963-64',
    displayName: 'Philadelphia 76ers',
    city: 'Philadelphia',
    abbreviation: 'PHI',
    logoCandidates: [
      {
        url: 'https://cdn.nba.com/logos/nba/1610612755/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
  },
  // Suns
  {
    modernFranchiseId: 'suns',
    historicalTeamId: '1610612756',
    validFromSeasonKey: '1968-69',
    displayName: 'Phoenix Suns',
    city: 'Phoenix',
    abbreviation: 'PHX',
    logoCandidates: [
      {
        url: 'https://cdn.nba.com/logos/nba/1610612756/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
  },
  // Trail Blazers
  {
    modernFranchiseId: 'blazers',
    historicalTeamId: '1610612757',
    validFromSeasonKey: '1970-71',
    displayName: 'Portland Trail Blazers',
    city: 'Portland',
    abbreviation: 'POR',
    logoCandidates: [
      {
        url: 'https://cdn.nba.com/logos/nba/1610612757/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
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
    logoCandidates: [
      {
        url: 'https://content.sportslogos.net/logos/6/246/full/5377.gif',
        source: 'sportslogos',
        attribution: 'SportsLogos.net',
      },
      {
        url: 'https://cdn.nba.com/logos/nba/1610612758/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
  },
  {
    modernFranchiseId: 'kings',
    historicalTeamId: '1610612758',
    validFromSeasonKey: '1957-58',
    validThroughSeasonKey: '1971-72',
    displayName: 'Cincinnati Royals',
    city: 'Cincinnati',
    abbreviation: 'CIN',
    logoCandidates: [
      {
        url: 'https://content.sportslogos.net/logos/6/247/full/5379.gif',
        source: 'sportslogos',
        attribution: 'SportsLogos.net',
      },
      {
        url: 'https://cdn.nba.com/logos/nba/1610612758/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
  },
  {
    modernFranchiseId: 'kings',
    historicalTeamId: '1610612758',
    validFromSeasonKey: '1972-73',
    validThroughSeasonKey: '1974-75',
    displayName: 'Kansas City-Omaha Kings',
    city: 'Kansas City-Omaha',
    abbreviation: 'KCO',
    logoCandidates: [
      {
        url: 'https://content.sportslogos.net/logos/6/2688/full/5382.gif',
        source: 'sportslogos',
        attribution: 'SportsLogos.net',
      },
      {
        url: 'https://cdn.nba.com/logos/nba/1610612758/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
  },
  {
    modernFranchiseId: 'kings',
    historicalTeamId: '1610612758',
    validFromSeasonKey: '1975-76',
    validThroughSeasonKey: '1984-85',
    displayName: 'Kansas City Kings',
    city: 'Kansas City',
    abbreviation: 'KCK',
    logoCandidates: [
      {
        url: 'https://content.sportslogos.net/logos/6/248/full/5383.gif',
        source: 'sportslogos',
        attribution: 'SportsLogos.net',
      },
      {
        url: 'https://cdn.nba.com/logos/nba/1610612758/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
  },
  {
    modernFranchiseId: 'kings',
    historicalTeamId: '1610612758',
    validFromSeasonKey: '1985-86',
    displayName: 'Sacramento Kings',
    city: 'Sacramento',
    abbreviation: 'SAC',
    logoCandidates: [
      {
        url: 'https://cdn.nba.com/logos/nba/1610612758/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
  },
  // Spurs: NBA from the 1976-77 merger
  {
    modernFranchiseId: 'spurs',
    historicalTeamId: '1610612759',
    validFromSeasonKey: '1976-77',
    displayName: 'San Antonio Spurs',
    city: 'San Antonio',
    abbreviation: 'SAS',
    logoCandidates: [
      {
        url: 'https://cdn.nba.com/logos/nba/1610612759/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
  },
  // Raptors
  {
    modernFranchiseId: 'raptors',
    historicalTeamId: '1610612761',
    validFromSeasonKey: '1995-96',
    displayName: 'Toronto Raptors',
    city: 'Toronto',
    abbreviation: 'TOR',
    logoCandidates: [
      {
        url: 'https://cdn.nba.com/logos/nba/1610612761/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
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
    logoCandidates: [
      {
        url: 'https://content.sportslogos.net/logos/6/255/full/5776.gif',
        source: 'sportslogos',
        attribution: 'SportsLogos.net',
      },
      {
        url: 'https://cdn.nba.com/logos/nba/1610612762/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
  },
  {
    modernFranchiseId: 'jazz',
    historicalTeamId: '1610612762',
    validFromSeasonKey: '1979-80',
    displayName: 'Utah Jazz',
    city: 'Utah',
    abbreviation: 'UTA',
    logoCandidates: [
      {
        url: 'https://cdn.nba.com/logos/nba/1610612762/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
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
    logoCandidates: [
      {
        url: 'https://cdn.nba.com/logos/nba/1610612764/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
  },
  {
    modernFranchiseId: 'wizards',
    historicalTeamId: '1610612764',
    validFromSeasonKey: '1962-63',
    validThroughSeasonKey: '1962-63',
    displayName: 'Chicago Zephyrs',
    city: 'Chicago',
    abbreviation: 'CHZ',
    logoCandidates: [
      {
        url: 'https://cdn.nba.com/logos/nba/1610612764/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
  },
  {
    modernFranchiseId: 'wizards',
    historicalTeamId: '1610612764',
    validFromSeasonKey: '1963-64',
    validThroughSeasonKey: '1972-73',
    displayName: 'Baltimore Bullets',
    city: 'Baltimore',
    abbreviation: 'BAL',
    logoCandidates: [
      {
        url: 'https://cdn.nba.com/logos/nba/1610612764/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
  },
  {
    modernFranchiseId: 'wizards',
    historicalTeamId: '1610612764',
    validFromSeasonKey: '1973-74',
    validThroughSeasonKey: '1973-74',
    displayName: 'Capital Bullets',
    city: 'Washington',
    abbreviation: 'CAP',
    logoCandidates: [
      {
        url: 'https://content.sportslogos.net/logos/6/588/full/capital-bullets-logo-primary-1974-3670.png',
        source: 'sportslogos',
        attribution: 'SportsLogos.net',
      },
      {
        url: 'https://cdn.nba.com/logos/nba/1610612764/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
  },
  {
    modernFranchiseId: 'wizards',
    historicalTeamId: '1610612764',
    validFromSeasonKey: '1974-75',
    validThroughSeasonKey: '1996-97',
    displayName: 'Washington Bullets',
    city: 'Washington',
    abbreviation: 'WSB',
    logoCandidates: [
      {
        url: 'https://content.sportslogos.net/logos/6/587/full/washington-bullets-logo-primary-1975-3194.png',
        source: 'sportslogos',
        attribution: 'SportsLogos.net',
      },
      {
        url: 'https://cdn.nba.com/logos/nba/1610612764/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
  },
  {
    modernFranchiseId: 'wizards',
    historicalTeamId: '1610612764',
    validFromSeasonKey: '1997-98',
    displayName: 'Washington Wizards',
    city: 'Washington',
    abbreviation: 'WAS',
    logoCandidates: [
      {
        url: 'https://cdn.nba.com/logos/nba/1610612764/global/L/logo.svg',
        source: 'nba-cdn',
        attribution: 'NBA.com',
      },
    ],
  },
];

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
