import { fieldPublished, derivePlayerRecord } from './src/ratings/v2.js';
import { FIELD_AVAILABILITY } from './src/config.js';

console.log('FIELD_AVAILABILITY', FIELD_AVAILABILITY);
console.log('steals 1972-73', fieldPublished('steals', '1972-73'));
console.log('steals 1975-76', fieldPublished('steals', '1975-76'));

const stats = {
  gamesPlayed: 78, minutes: 2850, points: 1680, rebounds: 420,
  offensiveRebounds: null, defensiveRebounds: null, assists: 310,
  steals: 95, blocks: 30, turnovers: null, fouls: 180,
  fgm: 630, fga: 1350, tpm: null, tpa: null, ftm: 260, fta: 310,
  per: null, boxPlusMinus: null, usageRate: null, tsPct: null, efgPct: null,
};
const derived = derivePlayerRecord({
  season: '1975-76', position: 'SG', heightInches: 79, stats, era: { leaguePpg: 110, league3PARate: 0.36, pace: 99 },
});
console.log('steal kind', derived.provenance['steal']);
console.log('defReb kind', derived.provenance['defensiveRebound']);
