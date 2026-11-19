import { expect, test } from 'bun:test';
import {
  SEASON_STAMINA_VERSION,
  eraIdSchema,
  playerVersionId,
  seasonKeySchema,
} from '@hoop-rush/data-contracts';
import { deriveFullCourtHealthProfiles } from './index.ts';

test('fits covered player seasons once and applies population priors to sparse seasons', () => {
  const coveredSeason = seasonKeySchema.parse('2023-24');
  const sparseSeason = seasonKeySchema.parse('2021-22');
  const eraId = eraIdSchema.parse('2020s');
  const playerEvidence = Array.from({ length: 25 }, (_, index) => ({
    externalId: String(index + 1),
    playedGames: 30,
    knownExposureGames: 75,
    unknownAbsenceGames: 4,
    injuryEpisodesByDuration: [1, 0, 0, 0],
  }));
  const cards = playerEvidence.map(({ externalId }) => ({
    playerVersionId: playerVersionId(`player-${externalId}`, 'lakers', eraId, coveredSeason),
    playerExternalId: externalId,
    eraId,
    seasonKey: coveredSeason,
    stamina: { rating: 80, historicalMpg: 32, derivationVersion: SEASON_STAMINA_VERSION } as const,
  }));
  const [first] = cards;
  if (first === undefined) throw new Error('Missing fixture card');
  const alternate = {
    ...first,
    playerVersionId: playerVersionId('player-1', 'celtics', eraId, coveredSeason),
  };
  const sparseCard = {
    ...first,
    playerVersionId: playerVersionId('player-1', 'lakers', eraId, sparseSeason),
    seasonKey: sparseSeason,
  };
  const candidates = [...cards, alternate, sparseCard];
  const evidence = {
    schemaVersion: 1,
    seasons: [
      { seasonKey: coveredSeason, players: playerEvidence },
      { seasonKey: sparseSeason, players: playerEvidence.slice(0, 1) },
    ],
  };
  const hashes = { catalogHash: 'a'.repeat(64), evidenceHash: 'b'.repeat(64) };
  const profiles = deriveFullCourtHealthProfiles({ candidates }, evidence, hashes);
  expect(profiles.cohorts['2020s:starter']?.observedAppearances).toBe(25 * 30);
  expect(profiles.players[first.playerVersionId]?.playerEvidence).toEqual({
    source: 'player-season',
    observedAppearances: 30,
  });
  expect(profiles.players[alternate.playerVersionId]).toEqual(
    profiles.players[first.playerVersionId],
  );
  expect(profiles.players[sparseCard.playerVersionId]?.playerEvidence).toEqual({
    source: 'population',
  });
  expect(
    deriveFullCourtHealthProfiles({ candidates: [...candidates].reverse() }, evidence, hashes),
  ).toEqual(profiles);
});
