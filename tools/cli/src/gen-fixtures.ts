/**
 * Generates the committed CLI fixture files under `src/fixtures/`. Run with
 * `pnpm --filter @hoop-rush/cli gen-fixtures`. Fixture teams use the shared
 * test-fixture builders so engine tests and CLI fixtures stay in sync.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SimulationPlayer, SimulationTeam } from '@hoop-rush/data-contracts';
import {
  buildEqualFixture,
  buildLegalSimulationTeam,
  buildRolesTeam,
  buildSimulationPlayer,
  buildStrongMediumFixture,
  buildStrongWeakFixture,
} from '@hoop-rush/test-fixtures';
import type { SimFixture } from './fixture-schema.js';

const FIXTURES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function mutateAll(
  team: SimulationTeam,
  mutate: (player: SimulationPlayer) => SimulationPlayer,
): SimulationTeam {
  return { ...team, players: team.players.map(mutate) };
}

function ratingDelta(
  team: SimulationTeam,
  key: keyof SimulationPlayer['ratings'],
  delta: number,
): SimulationTeam {
  return mutateAll(team, (p) => ({
    ...p,
    ratings: { ...p.ratings, [key]: Math.min(98, Math.max(20, p.ratings[key] + delta)) },
  }));
}

function tendencyDelta(
  team: SimulationTeam,
  key: keyof SimulationPlayer['tendencies'],
  delta: number,
): SimulationTeam {
  return mutateAll(team, (p) => ({
    ...p,
    tendencies: { ...p.tendencies, [key]: Math.min(100, Math.max(0, p.tendencies[key] + delta)) },
  }));
}

function write(name: string, fixture: SimFixture): void {
  const path = resolve(FIXTURES_DIR, name);
  writeFileSync(path, JSON.stringify(fixture, null, 2) + '\n');
  console.log(`wrote ${path}`);
}

const base = buildLegalSimulationTeam({ teamId: 'fixture-base', displayName: 'Fixture Base' });

function main(): void {
  mkdirSync(FIXTURES_DIR, { recursive: true });

  write('equal.json', {
    schemaVersion: 1,
    fixtureId: 'equal',
    description: 'Two identical legal lineups; determinism, home-rate, and distribution baseline.',
    ...buildEqualFixture(),
  });

  const { strong: sStrong, medium } = buildStrongMediumFixture();
  write('strong-medium.json', {
    schemaVersion: 1,
    fixtureId: 'strong-medium',
    description: 'Strong lineup versus medium lineup.',
    home: sStrong,
    away: medium,
  });

  const { strong, weak } = buildStrongWeakFixture();
  write('strong-weak.json', {
    schemaVersion: 1,
    fixtureId: 'strong-weak',
    description: 'Strong lineup versus weak lineup; calibration win-rate gate.',
    home: strong,
    away: weak,
  });

  write('sens-shooting.json', {
    schemaVersion: 1,
    fixtureId: 'sens-shooting',
    description: 'Single dimension: three-point and inside-scoring skill +15 on every player.',
    home: base,
    away: base,
    variantHome: ratingDelta(ratingDelta(base, 'threePoint', 15), 'insideScoring', 15),
  });

  write('sens-creation.json', {
    schemaVersion: 1,
    fixtureId: 'sens-creation',
    description: 'Single dimension: usage rate +35 for the initiator.',
    home: base,
    away: base,
    variantHome: mutateAll(base, (p) =>
      p.playerId === 'p-fixture-1'
        ? { ...p, tendencies: { ...p.tendencies, usageRate: p.tendencies.usageRate + 35 } }
        : p,
    ),
  });

  write('sens-passing.json', {
    schemaVersion: 1,
    fixtureId: 'sens-passing',
    description: 'Single dimension: passing +15 on every player.',
    home: base,
    away: base,
    variantHome: ratingDelta(base, 'passing', 15),
  });

  write('sens-turnovers.json', {
    schemaVersion: 1,
    fixtureId: 'sens-turnovers',
    description: 'Single dimension: ball handling +15 (fewer turnovers).',
    home: base,
    away: base,
    variantHome: ratingDelta(base, 'ballHandling', 15),
  });

  write('sens-defense.json', {
    schemaVersion: 1,
    fixtureId: 'sens-defense',
    description: 'Single dimension: perimeter and interior defense +15 on every player.',
    home: base,
    away: base,
    variantHome: ratingDelta(ratingDelta(base, 'perimeterDefense', 15), 'interiorDefense', 15),
  });

  write('sens-rebounding.json', {
    schemaVersion: 1,
    fixtureId: 'sens-rebounding',
    description: 'Single dimension: offensive rebounding +15 on every player.',
    home: base,
    away: base,
    variantHome: ratingDelta(base, 'offensiveRebound', 15),
  });

  write('sens-fouls.json', {
    schemaVersion: 1,
    fixtureId: 'sens-fouls',
    description: 'Single dimension: foul-drawing freeThrowRate tendency +15 on every player.',
    home: base,
    away: base,
    variantHome: tendencyDelta(base, 'freeThrowRate', 15),
  });

  write('sens-pace.json', {
    schemaVersion: 1,
    fixtureId: 'sens-pace',
    description: 'Single dimension: era pace 115 versus 80 (variant profile).',
    home: base,
    away: base,
    variantParameters: { pace: 115 },
  });

  write('sens-shot-mix.json', {
    schemaVersion: 1,
    fixtureId: 'sens-shot-mix',
    description: 'Single dimension: league three-point rate 0.35 versus the packaged rate.',
    home: base,
    away: base,
    variantParameters: { league3PARate: 0.35 },
  });

  // Role-differentiated lineup for the player-role calibration gates
  // (spec/06): one primary creator, one floor spacer, one secondary
  // creator, one post presence, and one rim runner.
  const roleTeam = buildRolesTeam();

  write('roles.json', {
    schemaVersion: 1,
    fixtureId: 'roles',
    description:
      'Role-differentiated lineup (creator, spacer, secondary, post, rim runner) against itself; player-role calibration gates.',
    home: roleTeam,
    away: { ...roleTeam, teamId: 'roles-away', displayName: 'Roles Lineup Away' },
  });
}

void buildSimulationPlayer;
void buildLegalSimulationTeam;
void buildEqualFixture;
main();
