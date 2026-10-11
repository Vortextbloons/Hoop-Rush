import { describe, expect, it } from 'vitest';
import {
  generateAiLeague,
  legalFiveAfterAnyRemoval,
  validateSeasonRoster,
} from '@hoop-rush/engine';
import {
  seasonLeagueSchema,
  seasonLeagueGenerationResultSchema,
  seedSchema,
} from '@hoop-rush/data-contracts';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DEFAULT_MANIFEST,
  fixtureHumanRoster,
  loadSeasonDraftCatalog,
  loadSeasonRosterTargets,
} from './commands/season-data.ts';

describe('shipped Season Run league generation', () => {
  it.each([
    'a1b2c3d4e5f60718293a4b5c6d7e8f9a',
    '11111111111111111111111111111111',
    '22222222222222222222222222222222',
  ])(
    'generates legal rosters and replays identically for seed %s',
    (seed) => {
      const catalog = loadSeasonDraftCatalog();
      const targets = loadSeasonRosterTargets();
      const league = seasonLeagueSchema.parse(
        JSON.parse(readFileSync(resolve(DEFAULT_MANIFEST, '../season/league.json'), 'utf8')),
      );
      const franchiseId = league.teams[0]?.franchiseId;
      if (franchiseId === undefined) throw new Error('Missing human franchise');
      const input = {
        seed: seedSchema.parse(seed),
        catalog,
        targets,
        league,
        humanFranchiseIds: [franchiseId],
        humanRosters: [{ franchiseId, playerVersionIds: fixtureHumanRoster(catalog) }],
      };
      const generation = generateAiLeague(input);
      expect(seasonLeagueGenerationResultSchema.safeParse(generation).success).toBe(true);
      expect(generation.rosters).toHaveLength(30);
      const byId = new Map(
        catalog.candidates.map((candidate) => [candidate.playerVersionId, candidate]),
      );
      for (const roster of generation.rosters) {
        const members = roster.players.map((player) => {
          const candidate = byId.get(player.playerVersionId);
          if (candidate === undefined) throw new Error('Unknown roster player');
          return {
            playerVersionId: player.playerVersionId,
            playable: candidate.positions.playable,
          };
        });
        expect(validateSeasonRoster(members)).toEqual([]);
        expect(legalFiveAfterAnyRemoval(members)).toBe(true);
      }
      expect(new Set(generation.ownership.map((row) => row.playerVersionId)).size).toBe(300);
      const replay = generateAiLeague({
        ...input,
        catalog: { ...catalog, candidates: [...catalog.candidates].reverse() },
      });
      expect(replay).toEqual(generation);
    },
    120_000,
  );
});
