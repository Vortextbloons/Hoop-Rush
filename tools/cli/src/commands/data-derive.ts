import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  DERIVATION_METHOD_VERSION,
  LINEAGE_RULE_VERSION,
  POSITION_NORMALIZATION_VERSION,
  RATINGS_VERSION,
  SELECTION_SCORE_VERSION,
  SOURCE_VERSION,
} from '@hoop-rush/data-contracts';
import { NBA_ROOT, ratings, resolveHistoricalIdentity } from '@hoop-rush/importer';
import { makeReport, EXIT_USAGE_OR_DATA_ERROR, type CliReport } from '../report.ts';
export const DATA_DERIVE_OPTIONS: Record<string, boolean> = {
  player: true,
  season: true,
  franchise: true,
  format: true,
  verbose: false,
};
const stintRowSchema = z.looseObject({
  playerExternalId: z.unknown().optional(),
  teamExternalId: z.unknown().optional(),
  gamesPlayed: z.unknown().optional(),
  minutes: z.unknown().optional(),
});
type StintRow = z.infer<typeof stintRowSchema>;
const seasonStatsRowSchema = z.looseObject({
  playerExternalId: z.unknown().optional(),
});
type SeasonStatsRow = z.infer<typeof seasonStatsRowSchema>;
const rosterRowSchema = z.looseObject({
  externalId: z.unknown().optional(),
  position: z.unknown().optional(),
  heightInches: z.unknown().optional(),
});
type RosterRow = z.infer<typeof rosterRowSchema>;
type DeriveTracePayload = {
  playerExternalId: string;
  season: string;
  franchiseId: string;
  historicalTeamIdentity: {
    teamId: string;
    displayName: string;
    city: string;
  };
  versions: {
    derivationMethodVersion: string;
    sourceVersion: string;
    ratingsVersion: string;
    selectionScoreVersion: string;
    positionNormalizationVersion: string;
    lineageRuleVersion: string;
  };
  seasonContext: ratings.SeasonContext;
  inputs: {
    stint: Pick<StintRow, 'gamesPlayed' | 'minutes' | 'teamExternalId'>;
    seasonStats: SeasonStatsRow;
  };
  methods: ratings.DerivedRecord['methods'];
  unclamped: ratings.DerivedRecord['unclamped'];
  final: Pick<ratings.DerivedRecord, 'ratings' | 'tendencies' | 'anchors' | 'summaryRatings'>;
  provenance: ratings.DerivedRecord['provenance'];
};
export function dataDerive(args: {
  player?: string | null;
  season?: string | null;
  franchise?: string | null;
}): CliReport {
  const player = args.player ?? null;
  const season = args.season ?? null;
  const franchise = args.franchise ?? null;
  if (!player || !season || !franchise) {
    return makeReport(
      'data derive',
      { player, season, franchise },
      {
        failures: ['--player, --season, and --franchise are all required'],
        exitCode: EXIT_USAGE_OR_DATA_ERROR,
      },
    );
  }
  const identity = resolveHistoricalIdentity(franchise, season);
  if (!identity) {
    return makeReport(
      'data derive',
      { player, season, franchise },
      {
        failures: [`no NBA lineage for ${franchise} in ${season}`],
        exitCode: EXIT_USAGE_OR_DATA_ERROR,
      },
    );
  }
  const seasonDir = join(NBA_ROOT, season);
  let stints: StintRow[] = [];
  let statsRows: SeasonStatsRow[] = [];
  try {
    const stintsRaw = JSON.parse(readFileSync(join(seasonDir, 'stints.json'), 'utf8')) as unknown;
    const stintsParsed = z.array(stintRowSchema).safeParse(stintsRaw);
    if (!stintsParsed.success) {
      throw new Error(stintsParsed.error.issues[0]?.message ?? 'invalid stints');
    }
    stints = stintsParsed.data;
    const statsRaw = JSON.parse(
      readFileSync(join(seasonDir, 'season-stats.json'), 'utf8'),
    ) as unknown;
    const statsParsed = z.array(seasonStatsRowSchema).safeParse(statsRaw);
    if (!statsParsed.success) {
      throw new Error(statsParsed.error.issues[0]?.message ?? 'invalid season-stats');
    }
    statsRows = statsParsed.data;
  } catch (error) {
    return makeReport(
      'data derive',
      { player, season, franchise },
      {
        failures: [`cached source data unreadable for ${season}: ${(error as Error).message}`],
        exitCode: EXIT_USAGE_OR_DATA_ERROR,
      },
    );
  }
  const rosterRaw = JSON.parse(readFileSync(join(seasonDir, 'roster.json'), 'utf8')) as unknown;
  const rosterParsed = z.array(rosterRowSchema).safeParse(rosterRaw);
  if (!rosterParsed.success) {
    return makeReport(
      'data derive',
      { player, season, franchise },
      {
        failures: [`cached source data unreadable for ${season}: roster invalid`],
        exitCode: EXIT_USAGE_OR_DATA_ERROR,
      },
    );
  }
  const rosterRows: RosterRow[] = rosterParsed.data;
  const roster = rosterRows.find((row) => String(row.externalId) === player);
  const stint = stints.find(
    (row) =>
      String(row.playerExternalId) === player &&
      String(row.teamExternalId) === identity.historicalTeamId,
  );
  const statsRow = statsRows.find((row) => String(row.playerExternalId) === player);
  if (!roster || !stint || !statsRow) {
    const missing = [
      !roster ? 'roster row' : null,
      !stint ? 'team stint' : null,
      !statsRow ? 'season-stats row' : null,
    ]
      .filter(Boolean)
      .join(', ');
    return makeReport(
      'data derive',
      { player, season, franchise },
      {
        failures: [`cached inputs incomplete for ${player} ${season}: missing ${missing}`],
        exitCode: EXIT_USAGE_OR_DATA_ERROR,
      },
    );
  }
  const era = ratings.getEra(season);
  const context: ratings.SeasonContext = {
    leaguePpg: era.leaguePpg,
    league3PARate: era.league3PARate,
    pace: era.pace,
  };
  const position = typeof roster.position === 'string' ? roster.position : 'SF';
  const derived = ratings.derivePlayerRecord({
    season,
    position,
    heightInches: typeof roster.heightInches === 'number' ? roster.heightInches : null,
    stats: statsRow,
    era: context,
  });
  const payload: DeriveTracePayload = {
    playerExternalId: player,
    season,
    franchiseId: franchise,
    historicalTeamIdentity: {
      teamId: identity.historicalTeamId,
      displayName: identity.displayName,
      city: identity.city,
    },
    versions: {
      derivationMethodVersion: DERIVATION_METHOD_VERSION,
      sourceVersion: SOURCE_VERSION,
      ratingsVersion: RATINGS_VERSION,
      selectionScoreVersion: SELECTION_SCORE_VERSION,
      positionNormalizationVersion: POSITION_NORMALIZATION_VERSION,
      lineageRuleVersion: LINEAGE_RULE_VERSION,
    },
    seasonContext: context,
    inputs: {
      stint: {
        gamesPlayed: stint.gamesPlayed,
        minutes: stint.minutes,
        teamExternalId: stint.teamExternalId,
      },
      seasonStats: statsRow,
    },
    methods: derived.methods,
    unclamped: derived.unclamped,
    final: {
      ratings: derived.ratings,
      tendencies: derived.tendencies,
      anchors: derived.anchors,
      summaryRatings: derived.summaryRatings,
    },
    provenance: derived.provenance,
  };
  const estimatedCount = Object.values(derived.methods).filter((m) => m === 'estimated').length;
  const details = [
    `${player} ${season} (${identity.displayName}): ${String(derived.ratings.threePoint)} 3PT, ${String(derived.ratings.passing)} PAS, ${String(derived.ratings.interiorDefense)} IDEF`,
    `methods: ${String(Object.values(derived.methods).length)} fields, ${String(estimatedCount)} estimated`,
    `summary OVR ${String(derived.summaryRatings.overallRating)} · OFF ${String(derived.summaryRatings.offenseRating)} · DEF ${String(derived.summaryRatings.defenseRating)}`,
  ];
  return makeReport('data derive', { player, season, franchise }, { details, payload });
}
