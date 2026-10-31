import { readFileSync, writeFileSync } from 'node:fs';
import { parseSeasonDraftCatalog } from './packages/data-contracts/src/loaders/draft-catalog.ts';
import {
  eraSimulationProfileSchema,
  opponentBracketSchema,
} from './packages/data-contracts/src/index.ts';
import {
  adaptCapRushCatalog,
  buildCapRushCatalogIndex,
} from './packages/engine/src/modes/cap-rush/catalog.ts';
import { buildCapRushLockedInputs } from './packages/engine/src/modes/cap-rush/lock.ts';
import { capRushPayrollStatus } from './packages/engine/src/modes/cap-rush/salary.ts';

const catalog = parseSeasonDraftCatalog(
  JSON.parse(readFileSync('apps/web/static/data/draft-catalog.json', 'utf8')),
);
const source = {
  catalogVersion: catalog.catalogVersion,
  catalogHash: 'a'.repeat(64),
  dataVersion: catalog.dataVersion,
  ratingsVersion: catalog.ratingsVersion,
  playerVersionIdVersion: catalog.playerVersionIdVersion,
  positionNormalizationVersion: catalog.positionNormalizationVersion,
};
const index = buildCapRushCatalogIndex(adaptCapRushCatalog(catalog, source));
const profile = eraSimulationProfileSchema.parse(
  JSON.parse(readFileSync('apps/web/static/data/era-sim/2010s.json', 'utf8')),
);
const bracket = opponentBracketSchema.parse(
  JSON.parse(readFileSync('apps/web/static/data/opponents/bracket.json', 'utf8')),
);

// A 2010s-flavoured human five: the best available version per slot under a soft budget.
const slots = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
const used = new Set<string>();
const picks = slots.map((slot, ordinal) => {
  const pool = index.bySlot.get(slot)!;
  const candidate = [...pool]
    .filter((p) => p.eraId === '2010s' && !used.has(p.playerVersionId))
    .sort((a, b) => b.originalOverall - a.originalOverall)[0];
  if (candidate === undefined) throw new Error(`no ${slot}`);
  used.add(candidate.playerVersionId);
  return {
    pickOrdinal: ordinal,
    slot,
    card: {
      cardId: `crc-${String(ordinal).padStart(32, '0')}`,
      offerId: 'cro-00000000000000000000000000000000',
      cardIndex: ordinal,
      slot,
      bucket: 'elite' as const,
      source: candidate,
      salaryDollars: 1_000_000,
    },
  };
});

const profiles = new Map(
  catalog.candidates.flatMap((c) =>
    c.playoffPerformance === undefined ? [] : ([[c.playerVersionId, c.playoffPerformance]] as const),
  ),
);

const locked = buildCapRushLockedInputs({
  runId: 'run-sens-0001',
  runSeed: 'abc123def4567890',
  variant: 'clash',
  versionSet: {
    schemaVersion: 1,
    rulesVersion: 'cap-rush-rules-v3',
    salaryCurveVersion: 'cap-rush-salary-v3',
    seedDerivationVersion: 'cap-rush-seeds-v1',
    engineVersion: 'm3-engine-v25',
    profileVersion: profile.profileVersion,
    dataVersion: catalog.dataVersion,
    catalogVersion: catalog.catalogVersion,
    catalogHash: source.catalogHash,
    bracketHash: 'b'.repeat(64),
    profileHash: 'c'.repeat(64),
  },
  catalog: source,
  picks: picks as never,
  spin: null,
  bracket,
  profile,
  playoffProfiles: profiles,
});

console.log('human', locked.human.displayName);
console.log('pinned rows', locked.playoffPerformance?.players.length);
console.log('starters with rows', locked.human.starters.filter((s) =>
  locked.playoffPerformance?.players.some((p) => p.playerVersionId === s.source.playerVersionId),
).length);
console.log(
  'payroll',
  locked.payrollDollars,
  capRushPayrollStatus(locked.payrollDollars),
);
writeFileSync('.scratch-locked-fixture.json', JSON.stringify(locked));
