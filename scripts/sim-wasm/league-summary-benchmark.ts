import { deepStrictEqual } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type {
  CapRushLeagueGame,
  CapRushLeagueScheduleEntry,
  CapRushLockedInputs,
  HavocBattleInput,
  HavocGameAudit,
  HavocGameInput,
} from '../../packages/data-contracts/src/index.ts';
import {
  CAP_RUSH_GAME_COUNT,
  HAVOC_MUTATION_CATALOG_VERSION,
  HAVOC_RULES_VERSION,
  HAVOC_SCHEMA_VERSION,
  POSITIONS,
  capRushCardSchema,
  capRushLeagueGameSchema,
  capRushLeagueGameSeed,
  canonicalJsonDataDigest,
  havocGameInputSchema,
  seasonDigestHex,
  seedSchema,
} from '../../packages/data-contracts/src/index.ts';
import { buildHavocGameInput, seedFromString } from '../../packages/test-fixtures/src/index.ts';
import { createEngineContext } from '../../packages/engine/src/sim/kernel.ts';
import { capRushTestSetup } from '../../packages/engine/src/modes/cap-rush/cap-rush-test-support.ts';
import {
  buildCapRushLeagueSchedule,
  capRushAssignFranchise,
  capRushLeagueFieldOf,
} from '../../packages/engine/src/modes/cap-rush/league-schedule.ts';
import { buildCapRushLockedInputs } from '../../packages/engine/src/modes/cap-rush/lock.ts';
import { capRushBattleVersionSet } from '../../packages/engine/src/modes/cap-rush/input.ts';
import {
  capRushBoxOf,
  capRushLeagueSlotGames,
  capRushTeamById,
  simulateCapRushLeagueSlot,
} from '../../packages/engine/src/modes/cap-rush/league-simulation.ts';
import {
  simulateAuditedHavocBattleGame,
  simulateAuditedHavocBattleSummary,
} from '../../packages/engine/src/modes/havoc/core/battle-game.ts';
import {
  havocBattleGameInputDigest,
  havocBattleGameResultDigest,
} from '../../packages/engine/src/modes/havoc/core/battle-digests.ts';
import {
  battleToSoloResult,
  soloToBattleInputValidated,
} from '../../packages/engine/src/modes/havoc/core/battle-adapters.ts';
import { havocGameInputDigest } from '../../packages/engine/src/modes/havoc/digests.ts';
import { auditHavocSoloIdentity } from '../../packages/engine/src/modes/havoc/solo/audit.ts';
import { simulateAuditedHavocSummaryGame } from '../../packages/engine/src/modes/havoc/solo/simulate.ts';

/**
 * Compares the tape-backed audited battle runtime with the playback-free compact
 * ledger audit on a complete 82-slot Cap Rush AI league (1,148 games) and on
 * audited Havoc summaries.
 *
 * Parity is asserted in this process before any timing. Timings then run in
 * isolated child processes so one variant's JIT state cannot bias the other;
 * each child warms once, then reports one timed workload. Medians are desktop
 * Bun measurements, not browser or phone claims.
 */

type Mode =
  | 'league-full'
  | 'league-compact'
  | 'havoc-full'
  | 'havoc-compact'
  | 'digest-reference'
  | 'digest-cached';

const LEAGUE_REPETITIONS = 1;
const HAVOC_REPETITIONS = 400;
const DIGEST_REPETITIONS = 3;

function lockedWithLeague(): CapRushLockedInputs {
  const setup = capRushTestSetup();
  const picks = POSITIONS.map((slot, index) => {
    const player = setup.index.bySlot.get(slot)?.[0];
    if (player === undefined) throw new Error(`missing ${slot}`);
    return {
      pickOrdinal: index,
      slot,
      card: capRushCardSchema.parse({
        cardId: `crc-${String(index).repeat(32)}`,
        offerId: `cro-${'0'.repeat(32)}`,
        cardIndex: index,
        slot,
        bucket: 'budget',
        source: player,
        salaryDollars: 10_000_000,
      }),
    };
  });
  const field = capRushLeagueFieldOf(setup.lockSources.bracket);
  const takeover = {
    franchise: capRushAssignFranchise({ runSeed: setup.state.runSeed, field }),
    games: buildCapRushLeagueSchedule({ runSeed: setup.state.runSeed, field }).games,
  };
  return buildCapRushLockedInputs({
    runId: setup.state.runId,
    runSeed: setup.state.runSeed,
    variant: setup.state.variant,
    versionSet: setup.state.versionSet,
    catalog: setup.state.catalog,
    picks,
    spin: null,
    bracket: setup.lockSources.bracket,
    profile: setup.lockSources.profile,
    takeover,
  });
}

function battleInputOf(
  locked: CapRushLockedInputs,
  entry: CapRushLeagueScheduleEntry,
): HavocBattleInput {
  const home = capRushTeamById(locked, entry.homeTeamId);
  const away = capRushTeamById(locked, entry.awayTeamId);
  return {
    schemaVersion: HAVOC_SCHEMA_VERSION,
    rulesVersion: HAVOC_RULES_VERSION,
    mutationCatalogVersion: HAVOC_MUTATION_CATALOG_VERSION,
    gameNumber: entry.slot,
    variant: 'havoc',
    seed: capRushLeagueGameSeed(locked.runSeed, entry.gameId),
    profile: locked.profile,
    home: { ...home, side: 'home' },
    away: { ...away, side: 'away' },
    versionSet: capRushBattleVersionSet(locked),
  };
}

function leagueInputsOf(locked: CapRushLockedInputs): HavocBattleInput[] {
  return Array.from({ length: CAP_RUSH_GAME_COUNT }, (_value, index) =>
    capRushLeagueSlotGames(locked, index + 1).map((entry) => battleInputOf(locked, entry)),
  ).flat();
}

/** The pre-compact league caller, kept here as the timing and parity reference. */
function fullLeagueGame(
  locked: CapRushLockedInputs,
  entry: CapRushLeagueScheduleEntry,
  context: ReturnType<typeof createEngineContext>,
): CapRushLeagueGame {
  const battle = simulateAuditedHavocBattleGame(battleInputOf(locked, entry), context);
  const audit = battle.audit;
  if (!audit.ok) {
    throw new Error(
      `cap rush league: game ${entry.gameId} failed accounting: ${audit.findings.map((finding) => finding.message).join('; ')}`,
    );
  }
  return capRushLeagueGameSchema.parse({
    gameId: entry.gameId,
    slot: entry.slot,
    homeTeamId: entry.homeTeamId,
    awayTeamId: entry.awayTeamId,
    homePoints: battle.result.home.points,
    awayPoints: battle.result.away.points,
    winnerTeamId:
      battle.result.home.points > battle.result.away.points ? entry.homeTeamId : entry.awayTeamId,
    box: capRushBoxOf(battle.result.home, battle.result.away, battle.result.overtimePeriods),
    inputDigest: battle.result.inputDigest,
    resultDigest: havocBattleGameResultDigest(battle.result),
  });
}

function fullLeagueSlot(
  locked: CapRushLockedInputs,
  slot: number,
  context: ReturnType<typeof createEngineContext>,
): CapRushLeagueGame[] {
  return capRushLeagueSlotGames(locked, slot).map((entry) =>
    fullLeagueGame(locked, entry, context),
  );
}

/** The production Havoc summary caller: tape-backed battle, no playback. */
function fullHavocSummary(
  input: HavocGameInput,
  context: ReturnType<typeof createEngineContext>,
): { result: ReturnType<typeof battleToSoloResult>; audit: HavocGameAudit } {
  const parsed = havocGameInputSchema.parse(input);
  const soloInputDigest = havocGameInputDigest(parsed);
  const battleInput = soloToBattleInputValidated(parsed);
  const battle = simulateAuditedHavocBattleGame(battleInput, context);
  const result = battleToSoloResult(battle.result, parsed.humanSide, soloInputDigest);
  const findings = [
    ...auditHavocSoloIdentity(parsed, result, { inputDigest: soloInputDigest }),
    ...battle.audit.findings,
  ];
  return { result, audit: { ok: findings.length === 0, findings } };
}

function havocInputsOf(): HavocGameInput[] {
  const base = buildHavocGameInput();
  return Array.from({ length: 24 }, (_value, index) => ({
    ...base,
    seed: seedSchema.parse(seedFromString(`league-compact-havoc-${String(index)}`)),
    gameNumber: (index % 82) + 1,
  }));
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

interface TimedRun {
  readonly wallMs: number;
  readonly cpuMs: number;
}

function runMode(mode: Mode): TimedRun {
  const context = createEngineContext();
  const locked = lockedWithLeague();
  const leagueInputs = leagueInputsOf(locked);
  const havocInputs = havocInputsOf();
  const leaguePass = (): void => {
    if (mode === 'league-full') {
      for (let slot = 1; slot <= CAP_RUSH_GAME_COUNT; slot += 1) {
        fullLeagueSlot(locked, slot, context);
      }
    } else {
      for (let slot = 1; slot <= CAP_RUSH_GAME_COUNT; slot += 1) {
        simulateCapRushLeagueSlot({ locked, slot, context });
      }
    }
  };
  const havocPass = (): void => {
    for (const input of havocInputs) {
      if (mode === 'havoc-full') fullHavocSummary(input, context);
      else simulateAuditedHavocSummaryGame(input, context);
    }
  };
  const digestPass = (): void => {
    for (const input of leagueInputs) {
      if (mode === 'digest-reference') {
        canonicalJsonDataDigest('havoc-battle-input-v1:', input as never);
      } else {
        havocBattleGameInputDigest(input);
      }
    }
  };

  // Warm once outside the timed section.
  if (mode === 'league-full' || mode === 'league-compact') leaguePass();
  else if (mode === 'havoc-full' || mode === 'havoc-compact') havocPass();
  else digestPass();

  const cpuBefore = process.cpuUsage();
  const start = performance.now();
  if (mode === 'league-full' || mode === 'league-compact') {
    for (let repeat = 0; repeat < LEAGUE_REPETITIONS; repeat += 1) leaguePass();
  } else if (mode === 'havoc-full' || mode === 'havoc-compact') {
    for (let repeat = 0; repeat < HAVOC_REPETITIONS; repeat += 1) havocPass();
  } else {
    for (let repeat = 0; repeat < DIGEST_REPETITIONS; repeat += 1) digestPass();
  }
  const wallMs = performance.now() - start;
  const cpu = process.cpuUsage(cpuBefore);
  return { wallMs, cpuMs: (cpu.user + cpu.system) / 1000 };
}

const mode = process.argv[2] as Mode | undefined;
if (
  mode === 'league-full' ||
  mode === 'league-compact' ||
  mode === 'havoc-full' ||
  mode === 'havoc-compact' ||
  mode === 'digest-reference' ||
  mode === 'digest-cached'
) {
  console.log(JSON.stringify(runMode(mode)));
  process.exit(0);
}

// Parity: results, audits, apron facts, input/result digests, and every
// derived league field.
const context = createEngineContext();
const locked = lockedWithLeague();
const entries = Array.from({ length: CAP_RUSH_GAME_COUNT }, (_value, index) =>
  capRushLeagueSlotGames(locked, index + 1),
).flat();
if (entries.length !== 1148) {
  throw new Error(`expected 1,148 AI league games, found ${String(entries.length)}`);
}
let ledgerDigest = '';
for (const entry of entries) {
  const battleInput = battleInputOf(locked, entry);
  const full = simulateAuditedHavocBattleGame(battleInput, context);
  const compact = simulateAuditedHavocBattleSummary(battleInput, context);
  deepStrictEqual(compact.result, full.result);
  deepStrictEqual(compact.audit, full.audit);
  const resultDigest = havocBattleGameResultDigest(compact.result);
  if (resultDigest !== havocBattleGameResultDigest(full.result)) {
    throw new Error(`${entry.gameId}: result digest mismatch`);
  }
  const referenceInputDigest = canonicalJsonDataDigest(
    'havoc-battle-input-v1:',
    battleInput as never,
  );
  if (compact.result.inputDigest !== referenceInputDigest) {
    throw new Error(`${entry.gameId}: input digest mismatch`);
  }
  ledgerDigest = seasonDigestHex(`${ledgerDigest}:${entry.gameId}:${resultDigest}`);
}
console.log(`parity ok for ${String(entries.length)} AI league games`);

for (const input of havocInputsOf()) {
  deepStrictEqual(
    simulateAuditedHavocSummaryGame(input, context),
    fullHavocSummary(input, context),
  );
}
console.log('parity ok for 24 Havoc summaries');

const SAMPLES = Number(process.env.HOOP_BENCH_SAMPLES ?? 7);
if (!Number.isInteger(SAMPLES) || SAMPLES < 3) {
  throw new Error('HOOP_BENCH_SAMPLES must be an integer >= 3');
}
const modes: Mode[] = [
  'league-full',
  'league-compact',
  'havoc-full',
  'havoc-compact',
  'digest-reference',
  'digest-cached',
];
const timings = new Map<Mode, TimedRun[]>(modes.map((entry) => [entry, []]));
for (let sample = 0; sample < SAMPLES; sample += 1) {
  for (const entry of modes) {
    const output = execFileSync(process.execPath, [fileURLToPath(import.meta.url), entry], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    });
    const line = output.trim().split(/\r?\n/).at(-1) ?? '{}';
    const parsed = JSON.parse(line) as Partial<TimedRun>;
    if (
      typeof parsed.wallMs !== 'number' ||
      !Number.isFinite(parsed.wallMs) ||
      typeof parsed.cpuMs !== 'number' ||
      !Number.isFinite(parsed.cpuMs)
    ) {
      throw new Error(`${entry}: invalid child timing ${line}`);
    }
    timings.get(entry)?.push({ wallMs: parsed.wallMs, cpuMs: parsed.cpuMs });
  }
}

const resultOf = (mode: Mode, metric: keyof TimedRun): number =>
  median((timings.get(mode) ?? []).map((entry) => entry[metric]));
const leagueFullWall = resultOf('league-full', 'wallMs');
const leagueCompactWall = resultOf('league-compact', 'wallMs');
const leagueFullCpu = resultOf('league-full', 'cpuMs');
const leagueCompactCpu = resultOf('league-compact', 'cpuMs');
const digestReferenceWall = resultOf('digest-reference', 'wallMs');
const digestCachedWall = resultOf('digest-cached', 'wallMs');
const digestReferenceCpu = resultOf('digest-reference', 'cpuMs');
const digestCachedCpu = resultOf('digest-cached', 'cpuMs');
const summaryFullWall = resultOf('havoc-full', 'wallMs');
const summaryCompactWall = resultOf('havoc-compact', 'wallMs');
const summaryFullCpu = resultOf('havoc-full', 'cpuMs');
const summaryCompactCpu = resultOf('havoc-compact', 'cpuMs');
const report = {
  note: 'Full = tape-backed audited battle. Compact = kernel numeric-ledger audit without a playback tape. inputDigest reference = canonical JSON plus Wasm canonicalization; cached = immutable-fragment composition with the same FNV offsets. Havoc summary compares the production compact caller with the previous tape-backed summary caller. Isolated child-process timings after in-process parity over all 1,148 AI league games. Desktop Bun timings only.',
  capturedAt: new Date().toISOString(),
  bun: Bun.version,
  parity: true,
  games: entries.length,
  ledgerDigest,
  samples: SAMPLES,
  league: {
    fullWallMs: leagueFullWall,
    compactWallMs: leagueCompactWall,
    wallSpeedup: leagueFullWall / leagueCompactWall,
    wallReductionPercent: (1 - leagueCompactWall / leagueFullWall) * 100,
    fullCpuMs: leagueFullCpu,
    compactCpuMs: leagueCompactCpu,
    cpuSpeedup: leagueFullCpu / leagueCompactCpu,
    cpuReductionPercent: (1 - leagueCompactCpu / leagueFullCpu) * 100,
  },
  inputDigest: {
    referenceWallMs: digestReferenceWall,
    cachedWallMs: digestCachedWall,
    wallSpeedup: digestReferenceWall / digestCachedWall,
    wallReductionPercent: (1 - digestCachedWall / digestReferenceWall) * 100,
    referenceCpuMs: digestReferenceCpu,
    cachedCpuMs: digestCachedCpu,
    cpuSpeedup: digestReferenceCpu / digestCachedCpu,
    cpuReductionPercent: (1 - digestCachedCpu / digestReferenceCpu) * 100,
  },
  havocSummary: {
    fullWallMs: summaryFullWall,
    compactWallMs: summaryCompactWall,
    wallSpeedup: summaryFullWall / summaryCompactWall,
    wallReductionPercent: (1 - summaryCompactWall / summaryFullWall) * 100,
    fullCpuMs: summaryFullCpu,
    compactCpuMs: summaryCompactCpu,
    cpuSpeedup: summaryFullCpu / summaryCompactCpu,
    cpuReductionPercent: (1 - summaryCompactCpu / summaryFullCpu) * 100,
  },
};
const out = process.argv[2] ?? 'sim-wasm-league-compact-results.json';
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(report);
