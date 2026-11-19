import {
  FULL_COURT_HEALTH_PROFILE_VERSION,
  fullCourtHealthProfileSetSchema,
  playerExternalIdSchema,
  seasonDraftCatalogSchema,
  seasonKeySchema,
  type FullCourtHealthProfileSet,
  type SeasonDraftCandidate,
} from '@hoop-rush/data-contracts';
import { z } from 'zod';
import { readJson, sha256File, writeJson } from '../json.ts';

const count = z.number().int().nonnegative();
const playerEvidenceSchema = z
  .object({
    externalId: playerExternalIdSchema,
    playedGames: count,
    knownExposureGames: count,
    unknownAbsenceGames: count,
    injuryEpisodesByDuration: z.tuple([count, count, count, count]),
  })
  .refine((row) => {
    const minimumInjuryGames = row.injuryEpisodesByDuration.reduce(
      (sum, episodes, index) => sum + episodes * ([1, 2, 4, 14][index] ?? 0),
      0,
    );
    return row.knownExposureGames - row.playedGames >= minimumInjuryGames;
  }, 'Documented absences cannot support these episodes');
const evidenceSchema = z.object({
  schemaVersion: z.literal(1),
  seasons: z.array(
    z.object({ seasonKey: seasonKeySchema, players: z.array(playerEvidenceSchema) }),
  ),
});

type PlayerEvidence = z.infer<typeof playerEvidenceSchema>;
type Cohort = FullCourtHealthProfileSet['cohorts'][string];
type ProfileCard = Pick<
  SeasonDraftCandidate,
  'playerVersionId' | 'playerExternalId' | 'eraId' | 'seasonKey' | 'stamina' | 'anchors'
>;

const MIN_SEASON_CODED_ABSENCES = 1000;
const MIN_SEASON_REASON_COVERAGE = 0.4;
const MIN_PLAYER_APPEARANCES = 20;
const MIN_COHORT_EPISODES = 20;
const PRIOR_APPEARANCES = 160;

function playerSeasonKey(seasonKey: string, externalId: string): string {
  return `${seasonKey}:${externalId}`;
}

function cohortIds(card: ProfileCard): [string, string, string] {
  const minutes = card.stamina.historicalMpg;
  const band = minutes >= 30 ? 'starter' : minutes >= 18 ? 'rotation' : 'reserve';
  return [`${card.eraId}:${band}`, `all-eras:${band}`, 'all-players'];
}

function episodesOf(cohort: Cohort): number {
  return cohort.durationCounts.reduce((total, value) => total + value, 0);
}

export function deriveFullCourtHealthProfiles(
  catalog: { readonly candidates: readonly ProfileCard[] },
  rawEvidence: unknown,
  hashes: { catalogHash: string; evidenceHash: string },
): FullCourtHealthProfileSet {
  const evidence = evidenceSchema.parse(rawEvidence);
  const usable = new Map<string, PlayerEvidence>();
  const matchedSeasons = new Set<string>();
  for (const season of evidence.seasons) {
    if (matchedSeasons.has(season.seasonKey))
      throw new Error(`Duplicate evidence season ${season.seasonKey}`);
    matchedSeasons.add(season.seasonKey);
    if (new Set(season.players.map((player) => player.externalId)).size !== season.players.length) {
      throw new Error(`Duplicate health evidence player in ${season.seasonKey}`);
    }
    let coded = 0;
    let unknown = 0;
    for (const player of season.players) {
      coded += player.knownExposureGames - player.playedGames;
      unknown += player.unknownAbsenceGames;
    }
    if (coded < MIN_SEASON_CODED_ABSENCES || coded < (coded + unknown) * MIN_SEASON_REASON_COVERAGE)
      continue;
    for (const player of season.players) {
      const playerCoded = player.knownExposureGames - player.playedGames;
      if (
        player.playedGames < MIN_PLAYER_APPEARANCES ||
        player.unknownAbsenceGames > Math.max(2, playerCoded)
      )
        continue;
      usable.set(playerSeasonKey(season.seasonKey, player.externalId), player);
    }
  }

  const cards = [...catalog.candidates].sort((left, right) =>
    left.playerVersionId.localeCompare(right.playerVersionId),
  );
  const longestStint = new Map<string, ProfileCard>();
  for (const card of cards) {
    const key = playerSeasonKey(card.seasonKey, card.playerExternalId);
    const current = longestStint.get(key);
    if (
      current === undefined ||
      (card.anchors?.gamesPlayed ?? 0) > (current.anchors?.gamesPlayed ?? 0)
    ) {
      longestStint.set(key, card);
    }
  }

  const cohorts: Record<string, Cohort> = {};
  for (const [key, card] of longestStint) {
    const player = usable.get(key);
    if (player === undefined) continue;
    for (const cohortId of cohortIds(card)) {
      const totals = cohorts[cohortId] ?? { observedAppearances: 0, durationCounts: [0, 0, 0, 0] };
      totals.observedAppearances += player.playedGames;
      player.injuryEpisodesByDuration.forEach((episodes, index) => {
        totals.durationCounts[index] = (totals.durationCounts[index] ?? 0) + episodes;
      });
      cohorts[cohortId] = totals;
    }
  }

  const eligibleCohorts = Object.fromEntries(
    Object.entries(cohorts).filter(([, cohort]) => episodesOf(cohort) >= MIN_COHORT_EPISODES),
  );
  if (eligibleCohorts['all-players'] === undefined) {
    throw new Error('Full Court health evidence has too few documented episodes to fit a prior');
  }
  const players = Object.fromEntries(
    cards.map((card) => {
      const cohortId =
        cohortIds(card).find((id) => eligibleCohorts[id] !== undefined) ?? 'all-players';
      const cohort = eligibleCohorts[cohortId];
      if (cohort === undefined) throw new Error(`Missing health cohort ${cohortId}`);
      const row = usable.get(playerSeasonKey(card.seasonKey, card.playerExternalId));
      const count = row?.injuryEpisodesByDuration.reduce((sum, value) => sum + value, 0) ?? 0;
      const priorRate = episodesOf(cohort) / cohort.observedAppearances;
      const rate =
        (count + PRIOR_APPEARANCES * priorRate) / (PRIOR_APPEARANCES + (row?.playedGames ?? 0));
      return [
        card.playerVersionId,
        {
          cohortId,
          episodesPer10kAppearances: Math.round(rate * 100_000) / 10,
          playerEvidence:
            row === undefined
              ? { source: 'population' }
              : { source: 'player-season', observedAppearances: row.playedGames },
        },
      ];
    }),
  );
  return fullCourtHealthProfileSetSchema.parse({
    version: FULL_COURT_HEALTH_PROFILE_VERSION,
    ...hashes,
    cohorts: eligibleCohorts,
    players,
  });
}

if (import.meta.main) {
  const [catalogPath, evidencePath, outputPath] = process.argv.slice(2);
  if (catalogPath === undefined || evidencePath === undefined || outputPath === undefined) {
    throw new Error(
      'Usage: bun packages/importer/src/full-court-health/index.ts <catalog> <evidence> <output>',
    );
  }
  const profiles = deriveFullCourtHealthProfiles(
    seasonDraftCatalogSchema.parse(readJson(catalogPath)),
    readJson(evidencePath),
    {
      catalogHash: sha256File(catalogPath),
      evidenceHash: sha256File(evidencePath),
    },
  );
  writeJson(outputPath, profiles, true);
}
