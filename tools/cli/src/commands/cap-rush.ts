import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  CAP_RUSH_GAME_COUNT,
  capRushLockedInputsSchema,
  seasonDraftCatalogSchema,
  type CapRushStoredGame,
} from '@hoop-rush/data-contracts';
import {
  adaptCapRushCatalog,
  buildCapRushCatalogIndex,
  capRushCatalogCoverageIssues,
  capRushEmptyAggregate,
  capRushFoldAggregate,
  capRushReport,
  capRushStoredGameOf,
  createEngineContext,
  simulateCapRushGame,
} from '@hoop-rush/engine';
import { makeReport, type CliReport } from '../report.ts';

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(path), 'utf8'));
}

export interface CapRushSeasonInput {
  readonly locked: string;
  readonly out: string | null;
}

export async function capRushSeason(input: CapRushSeasonInput): Promise<CliReport> {
  const locked = capRushLockedInputsSchema.parse(await readJson(input.locked));
  const context = createEngineContext();
  const games: CapRushStoredGame[] = [];
  const failures: string[] = [];
  let aggregate = capRushEmptyAggregate();
  let isolations = 0;
  let strikes = 0;

  for (let gameNumber = 1; gameNumber <= CAP_RUSH_GAME_COUNT; gameNumber += 1) {
    const simulation = simulateCapRushGame({ locked, gameNumber, context });
    if (!simulation.audit.ok) {
      const first = simulation.audit.findings[0];
      failures.push(
        `game ${String(gameNumber)}: ${first?.code ?? 'unknown'} ${first?.message ?? ''}`.trim(),
      );
      break;
    }
    games.push(capRushStoredGameOf(simulation));
    aggregate = capRushFoldAggregate(aggregate, simulation.summary);
    isolations += simulation.facts.filter((fact) => fact.kind === 'isolation').length;
    strikes += simulation.facts.filter((fact) => fact.kind === 'strike').length;
  }

  const reportInput = { locked: input.locked, out: input.out };
  if (failures.length > 0) {
    return makeReport('cap-rush season', reportInput, { failures });
  }

  const report = capRushReport({
    locked,
    games,
    aggregate,
    apronTriggers: { isolations, strikes },
  });
  if (input.out !== null) {
    await writeFile(resolve(input.out), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  return makeReport('cap-rush season', reportInput, {
    payload: {
      variant: report.variant,
      wins: report.aggregate.wins,
      losses: report.aggregate.losses,
      payrollStatus: report.payrollStatus,
      payrollDollars: report.payrollDollars,
      spinSpendDollars: report.spinSpendDollars,
      winsPerMillion: report.winsPerMillion,
      apronTriggers: report.apronTriggers,
    },
  });
}

export interface CapRushCoverageInput {
  readonly catalog: string;
}

export async function capRushCoverage(input: CapRushCoverageInput): Promise<CliReport> {
  const catalog = seasonDraftCatalogSchema.parse(await readJson(input.catalog));
  const index = buildCapRushCatalogIndex(
    adaptCapRushCatalog(catalog, {
      catalogVersion: catalog.catalogVersion,
      catalogHash: '0'.repeat(64),
      dataVersion: catalog.dataVersion,
      ratingsVersion: catalog.ratingsVersion,
      playerVersionIdVersion: catalog.playerVersionIdVersion,
      positionNormalizationVersion: catalog.positionNormalizationVersion,
    }),
  );
  const issues = capRushCatalogCoverageIssues(index);
  return makeReport(
    'cap-rush coverage',
    { catalog: input.catalog },
    {
      failures: issues.map((issue) => `${issue.slot ?? 'lineup'}: ${issue.message}`),
    },
  );
}
