import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import {
  COLLECTION_CATALOG_VERSION,
  COLLECTION_GAME_RULES_VERSION,
  collectionGameRulesSchema,
  collectionPreparedGameSchema,
  eraSimulationProfileSchema,
  type CollectionCatalog,
  type CollectionGameRules,
  type CollectionRarity,
  type EraSimulationProfile,
} from '@hoop-rush/data-contracts';
import {
  checkCollectionGameResult,
  collectionGameRewardFor,
  cpuPerCardWeights,
  initializeCollectionActiveTeam,
  prepareCollectionBasicGame,
  reproduceCollectionGame,
  simulateCollectionGame,
} from '@hoop-rush/engine';
import { makeReport, type CliReport } from '../report.ts';
import {
  collectionGameAuditReportSchema,
  collectionGameReproduceReportSchema,
} from '../report-schemas.ts';
import { DEFAULT_MANIFEST, readJsonFile, sha256Hex } from './season-data.ts';
import { loadCollectionCatalog } from './collection.ts';

export const COLLECTION_GAME_AUDIT_OPTIONS: Record<string, boolean> = {
  manifest: true,
  games: true,
  format: true,
};

export const COLLECTION_GAME_REPRODUCE_OPTIONS: Record<string, boolean> = {
  input: true,
  manifest: true,
  format: true,
};

const FIXED_ROOT_SEED = 'c04c3c71061eca4c71061eca4c71061e';
const HELD_OUT_ROOT_SEED = '9a9e3e771061eca4c71061eca4c71061e';
const ROSTER_SIZE_CYCLE = [5, 6, 7, 8, 9, 10, 11, 12];

function loadGameRules(manifestPath: string): { rules: CollectionGameRules; rulesHash: string } {
  const manifest = readJsonFile(manifestPath) as {
    collection?: { gameRules?: { url?: string; contentHash?: string } };
  };
  const ref = manifest.collection?.gameRules;
  if (ref?.url === undefined || ref.contentHash === undefined) {
    throw new Error(
      'manifest is missing collection.gameRules; run gen-collection-game-rules first',
    );
  }
  const resolved = resolve(dirname(manifestPath), ref.url);
  const content = readFileSync(resolved);
  const actual = sha256Hex(content);
  if (actual !== ref.contentHash) {
    throw new Error(
      `collection game rules content hash mismatch: expected ${ref.contentHash}, got ${actual}`,
    );
  }
  const parsed = collectionGameRulesSchema.safeParse(
    JSON.parse(content.toString('utf8')) as unknown,
  );
  if (!parsed.success) {
    throw new Error(
      `collection game rules fail the schema: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
    );
  }
  return { rules: parsed.data, rulesHash: actual };
}

function loadGameProfile(manifestPath: string): {
  profile: EraSimulationProfile;
  profileHash: string;
} {
  const manifest = readJsonFile(manifestPath) as {
    eraSimulationProfiles?: Array<{ eraId?: string; url?: string; contentHash?: string }>;
  };
  const ref = manifest.eraSimulationProfiles?.find((entry) => entry.eraId === '2020s');
  if (ref?.url === undefined || ref.contentHash === undefined) {
    throw new Error('manifest is missing the 2020s era simulation profile');
  }
  const resolved = resolve(dirname(manifestPath), ref.url);
  const content = readFileSync(resolved);
  const actual = sha256Hex(content);
  if (actual !== ref.contentHash) {
    throw new Error(
      `2020s profile content hash mismatch: expected ${ref.contentHash}, got ${actual}`,
    );
  }
  const parsed = eraSimulationProfileSchema.safeParse(
    JSON.parse(content.toString('utf8')) as unknown,
  );
  if (!parsed.success) {
    throw new Error(
      `2020s profile fails the schema: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
    );
  }
  return { profile: parsed.data, profileHash: actual };
}

function spreadOwned(catalog: CollectionCatalog, size: number, offset: number): string[] {
  const ids = catalog.cards.map((card) => card.cardId);
  const picked: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < ids.length && picked.length < size; i += 1) {
    const id = ids[(offset + i * 3797) % ids.length];
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    picked.push(id);
  }
  return picked;
}

interface AuditedGame {
  failures: string[];
  winner: 'home' | 'away' | null;
  overtimePeriods: number;
  exceptions: number;
  shortHanded: boolean;
  cpuRarities: CollectionRarity[];
  rewardAmount: number | null;
  rewardTransactionId: string | null;
}

function auditOneGame(
  catalog: CollectionCatalog,
  rules: CollectionGameRules,
  profile: EraSimulationProfile,
  catalogHash: string,
  rulesHash: string,
  profileHash: string,
  rootSeed: string,
  gameSequence: number,
  rosterSize: number,
): AuditedGame {
  const failures: string[] = [];
  const byId = new Map(catalog.cards.map((card) => [card.cardId, card]));
  let owned: string[] = [];
  let team: ReturnType<typeof initializeCollectionActiveTeam> | null = null;
  for (let attempt = 0; attempt < 8 && team === null; attempt += 1) {
    owned = spreadOwned(catalog, rosterSize, gameSequence * 131 + attempt * 17);
    try {
      team = initializeCollectionActiveTeam(owned, (cardId) => byId.get(cardId));
    } catch {
      team = null;
    }
  }
  if (team === null) {
    return {
      failures: [`no feasible ${String(rosterSize)}-card team from catalog spreads`],
      winner: null,
      overtimePeriods: 0,
      exceptions: 0,
      shortHanded: rosterSize === 5,
      cpuRarities: [],
      rewardAmount: null,
      rewardTransactionId: null,
    };
  }
  let prepared: ReturnType<typeof prepareCollectionBasicGame>;
  try {
    prepared = prepareCollectionBasicGame({
      collectionId: 'collection-game-audit',
      rootSeed,
      gameSequence,
      ownedCardIds: new Set(owned),
      team,
      catalog,
      cpuWeights: { ...rules.cpuRarityWeights },
      profileVersion: profile.profileVersion,
      profileHash,
      catalogHash,
      rulesHash,
    });
  } catch (error) {
    return {
      failures: [`prepare failed: ${(error as Error).message}`],
      winner: null,
      overtimePeriods: 0,
      exceptions: 0,
      shortHanded: rosterSize === 5,
      cpuRarities: [],
      rewardAmount: null,
      rewardTransactionId: null,
    };
  }
  const cpuRoster = [...prepared.cpuTeam.starters, ...prepared.cpuTeam.bench];
  if (cpuRoster.length !== 12) {
    failures.push(`cpu roster has ${String(cpuRoster.length)} cards, want 12`);
  }
  if (new Set(cpuRoster).size !== cpuRoster.length) {
    failures.push('cpu roster has duplicate exact cards');
  }
  const cpuPlayers = cpuRoster.map((cardId) => byId.get(cardId)?.playerId ?? 'missing');
  if (new Set(cpuPlayers).size !== cpuPlayers.length) {
    failures.push('cpu roster has duplicate canonical players');
  }
  const cpuRarities: CollectionRarity[] = [];
  for (const cardId of cpuRoster) {
    const card = byId.get(cardId);
    if (card === undefined) {
      failures.push(`cpu references unknown card ${cardId}`);
      continue;
    }
    cpuRarities.push(card.rarity);
  }
  let simulated: ReturnType<typeof simulateCollectionGame>;
  try {
    simulated = simulateCollectionGame(prepared, catalog, profile);
  } catch (error) {
    failures.push(`simulate failed: ${(error as Error).message}`);
    return {
      failures,
      winner: null,
      overtimePeriods: 0,
      exceptions: 0,
      shortHanded: rosterSize === 5,
      cpuRarities,
      rewardAmount: null,
      rewardTransactionId: null,
    };
  }
  for (const failure of checkCollectionGameResult(
    simulated.result,
    simulated.events,
    prepared,
    catalog,
    profile,
  )) {
    failures.push(`audit: ${failure}`);
  }
  const reward = collectionGameRewardFor(simulated.result, prepared.gameId);
  const expected = simulated.result.winner === 'home' ? 100 : 10;
  if (reward.amount !== expected) {
    failures.push(`reward ${String(reward.amount)} != ${String(expected)}`);
  }
  const rewardCurrency: string = reward.currency;
  if (rewardCurrency !== 'Coins') failures.push('game reward must be Coins');
  const again = collectionGameRewardFor(simulated.result, prepared.gameId);
  if (again.transactionId !== reward.transactionId) {
    failures.push('reward transaction id is not deterministic');
  }
  let overtimePeriods = 0;
  let exceptions = 0;
  if (simulated.result.outcome === 'completed') {
    overtimePeriods = simulated.result.overtimePeriods;
    exceptions =
      simulated.result.home.foulLimitExceptions.length +
      simulated.result.away.foulLimitExceptions.length;
  }
  return {
    failures,
    winner: simulated.result.winner,
    overtimePeriods,
    exceptions,
    shortHanded: rosterSize === 5,
    cpuRarities,
    rewardAmount: reward.amount,
    rewardTransactionId: reward.transactionId,
  };
}

export function collectionGameAudit(args: {
  manifest: string | null;
  games: string | null;
}): CliReport {
  const manifestPath = args.manifest ?? DEFAULT_MANIFEST;
  const perRange = Math.max(8, Number.parseInt(args.games ?? '24', 10) || 24);
  let loaded: { catalog: CollectionCatalog; catalogHash: string };
  try {
    loaded = loadCollectionCatalog(manifestPath);
  } catch (error) {
    return makeReport(
      'collection game-audit',
      { manifest: manifestPath },
      {
        failures: [(error as Error).message],
        exitCode: 2,
      },
    );
  }
  let rules: CollectionGameRules;
  let rulesHash: string;
  let profile: EraSimulationProfile;
  let profileHash: string;
  try {
    ({ rules, rulesHash } = loadGameRules(manifestPath));
    ({ profile, profileHash } = loadGameProfile(manifestPath));
  } catch (error) {
    return makeReport(
      'collection game-audit',
      { manifest: manifestPath },
      {
        failures: [(error as Error).message],
        exitCode: 2,
      },
    );
  }
  const { catalog, catalogHash } = loaded;
  const failures: string[] = [];
  const details: string[] = [];
  const rulesVersion: string = rules.rulesVersion;
  if (rulesVersion !== COLLECTION_GAME_RULES_VERSION) {
    failures.push(`rules version ${rulesVersion} unexpected`);
  }
  try {
    const perCard = cpuPerCardWeights(catalog, { ...rules.cpuRarityWeights });
    const specials = catalog.cards.filter((card) => card.family !== 'Base');
    if (specials.length !== 12) {
      failures.push(`catalog has ${String(specials.length)} specials, want 12`);
    }
    for (const special of specials) {
      if (!((perCard.get(special.cardId) ?? 0) > 0)) {
        failures.push(`special ${special.cardId} has no positive cpu weight`);
        break;
      }
    }
  } catch (error) {
    failures.push(`cpu weights invalid: ${(error as Error).message}`);
  }

  const ranges = [
    { label: 'fixed', rootSeed: FIXED_ROOT_SEED },
    { label: 'held-out', rootSeed: HELD_OUT_ROOT_SEED },
  ];
  let wins = 0;
  let losses = 0;
  let shortHandedGames = 0;
  let overtimeGames = 0;
  let foulLimitExceptions = 0;
  const rarityCounts: Record<string, number> = {};
  const seenTransactions = new Set<string>();
  for (const range of ranges) {
    let rangeGames = 0;
    let rangeShortHanded = 0;
    const rangeRarities: CollectionRarity[] = [];
    for (let game = 0; game < perRange; game += 1) {
      const rosterSize = ROSTER_SIZE_CYCLE[game % ROSTER_SIZE_CYCLE.length] ?? 5;
      const audited = auditOneGame(
        catalog,
        rules,
        profile,
        catalogHash,
        rulesHash,
        profileHash,
        range.rootSeed,
        game,
        rosterSize,
      );
      for (const failure of audited.failures) {
        failures.push(`${range.label} game ${String(game)}: ${failure}`);
      }
      rangeGames += 1;
      if (audited.winner === 'home') wins += 1;
      if (audited.winner === 'away') losses += 1;
      if (audited.overtimePeriods > 0) overtimeGames += 1;
      foulLimitExceptions += audited.exceptions;
      if (audited.shortHanded) {
        shortHandedGames += 1;
        rangeShortHanded += 1;
      }
      for (const rarity of audited.cpuRarities) {
        rangeRarities.push(rarity);
        rarityCounts[rarity] = (rarityCounts[rarity] ?? 0) + 1;
      }
      if (audited.rewardTransactionId !== null) {
        if (seenTransactions.has(audited.rewardTransactionId)) {
          failures.push(`${range.label} game ${String(game)}: duplicate reward transaction id`);
        }
        seenTransactions.add(audited.rewardTransactionId);
      }
    }
    if (rangeShortHanded === 0) {
      failures.push(`${range.label}: no short-handed games completed`);
    }
    const picks = rangeRarities.length;
    const share = (rarity: CollectionRarity): number =>
      picks === 0 ? 0 : rangeRarities.filter((entry) => entry === rarity).length / picks;
    if (picks > 0) {
      if (share('Ember') < 0.55 || share('Ember') > 0.85) {
        failures.push(
          `${range.label}: Ember share ${share('Ember').toFixed(3)} outside [0.55, 0.85]`,
        );
      }
      if (share('Eruption') < 0.12 || share('Eruption') > 0.34) {
        failures.push(
          `${range.label}: Eruption share ${share('Eruption').toFixed(3)} outside [0.12, 0.34]`,
        );
      }
      if (rangeRarities.filter((entry) => entry === 'Apex').length < 1) {
        failures.push(`${range.label}: no Apex cpu cards sampled`);
      }
      if (share('Titan') > 0.12) {
        failures.push(`${range.label}: Titan share ${share('Titan').toFixed(3)} above 0.12`);
      }
      if (rangeRarities.filter((entry) => entry === 'Eclipse').length > 8) {
        failures.push(`${range.label}: too many Eclipse cpu cards`);
      }
      if (rangeRarities.filter((entry) => entry === 'Immortal').length > 3) {
        failures.push(`${range.label}: too many Immortal cpu cards`);
      }
    }
    details.push(
      `${range.label}: ${String(rangeGames)} games · short-handed ${String(rangeShortHanded)} · Ember ${share('Ember').toFixed(3)} / Eruption ${share('Eruption').toFixed(3)}`,
    );
  }
  details.push(
    `rewards: ${String(wins)} wins / ${String(losses)} losses · overtime ${String(overtimeGames)} · foul-limit exceptions ${String(foulLimitExceptions)}`,
  );
  const payload = collectionGameAuditReportSchema.parse({
    schemaVersion: 1,
    command: 'collection game-audit',
    catalogVersion: COLLECTION_CATALOG_VERSION,
    catalogHash,
    rulesVersion: rules.rulesVersion,
    rulesHash,
    profileVersion: profile.profileVersion,
    fixedGames: perRange,
    heldOutGames: perRange,
    wins,
    losses,
    rarityCounts,
    shortHandedGames,
    overtimeGames,
    foulLimitExceptions,
  });
  return makeReport(
    'collection game-audit',
    { manifest: manifestPath },
    {
      details,
      failures,
      payload,
    },
  );
}

export const collectionGameReproduceInputSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('collection game-reproduce'),
  prepared: collectionPreparedGameSchema,
});
export type CollectionGameReproduceInput = z.infer<typeof collectionGameReproduceInputSchema>;

export function collectionGameReproduce(args: {
  input: string | null;
  manifest: string | null;
}): CliReport {
  if (args.input === null) {
    return makeReport(
      'collection game-reproduce',
      {},
      {
        failures: ['collection game-reproduce requires --input <game.json>'],
        exitCode: 2,
      },
    );
  }
  const parsedInput = collectionGameReproduceInputSchema.safeParse(readJsonFile(args.input));
  if (!parsedInput.success) {
    return makeReport(
      'collection game-reproduce',
      { input: args.input },
      {
        failures: [
          `game input fails the schema: ${parsedInput.error.issues[0]?.message ?? 'unknown'}`,
        ],
        exitCode: 2,
      },
    );
  }
  const manifestPath = args.manifest ?? DEFAULT_MANIFEST;
  let loaded: { catalog: CollectionCatalog; catalogHash: string };
  try {
    loaded = loadCollectionCatalog(manifestPath);
  } catch (error) {
    return makeReport(
      'collection game-reproduce',
      { input: args.input },
      {
        failures: [(error as Error).message],
        exitCode: 2,
      },
    );
  }
  let profile: EraSimulationProfile;
  try {
    ({ profile } = loadGameProfile(manifestPath));
  } catch (error) {
    return makeReport(
      'collection game-reproduce',
      { input: args.input },
      {
        failures: [(error as Error).message],
        exitCode: 2,
      },
    );
  }
  const { prepared } = parsedInput.data;
  if (prepared.catalogHash !== loaded.catalogHash) {
    return makeReport(
      'collection game-reproduce',
      { input: args.input },
      {
        failures: ['prepared catalog hash does not match the packaged catalog'],
        exitCode: 2,
      },
    );
  }
  if (prepared.profileHash !== loadGameProfile(manifestPath).profileHash) {
    return makeReport(
      'collection game-reproduce',
      { input: args.input },
      {
        failures: ['prepared profile hash does not match the packaged 2020s profile'],
        exitCode: 2,
      },
    );
  }
  let reproduced: ReturnType<typeof reproduceCollectionGame>;
  try {
    reproduced = reproduceCollectionGame(prepared, loaded.catalog, profile);
  } catch (error) {
    return makeReport(
      'collection game-reproduce',
      { input: args.input },
      {
        failures: [`reproduction failed: ${(error as Error).message}`],
        exitCode: 2,
      },
    );
  }
  const failures = checkCollectionGameResult(
    reproduced.result,
    reproduced.events,
    prepared,
    loaded.catalog,
    profile,
  );
  const reward = collectionGameRewardFor(reproduced.result, prepared.gameId);
  const payload = collectionGameReproduceReportSchema.parse({
    schemaVersion: 1,
    command: 'collection game-reproduce',
    gameId: prepared.gameId,
    gameSequence: prepared.gameSequence,
    ok: failures.length === 0,
    eventDigest: reproduced.eventDigest,
    resultDigest: reproduced.resultDigest,
    rewardReason: reward.reason,
    rewardAmount: reward.amount,
    rewardTransactionId: reward.transactionId,
    failures,
  });
  return makeReport(
    'collection game-reproduce',
    { input: args.input },
    {
      details:
        failures.length === 0
          ? [
              `game ${prepared.gameId} reproduces byte-identically · event ${reproduced.eventDigest} · result ${reproduced.resultDigest} · ${reward.reason} +${String(reward.amount)}`,
            ]
          : [],
      failures,
      payload,
    },
  );
}
