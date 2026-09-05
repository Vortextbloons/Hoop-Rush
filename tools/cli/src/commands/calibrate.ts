import type { z } from 'zod';
import {
  checkGameResult,
  createChallenge,
  createEngineContext,
  evaluateLineupStrength,
  simulateChallenge,
  toSimulationPlayer,
} from '@hoop-rush/engine';
import type { SimulationPlayer } from '@hoop-rush/data-contracts';
import {
  DEFAULT_ERA_ID,
  POSITION_SLOTS,
  franchiseIdSchema,
  idSchema,
  playerIdSchema,
  type EraSimulationProfile,
  type FranchiseEraPool,
  type GameResult,
  type GameSimulationInput,
  type SimulationTeam,
  playableSlotGroups,
  slotGroupOf,
} from '@hoop-rush/data-contracts';
import { makeReport, type CliReport } from '../report.ts';
import {
  calibrationMetricSchema,
  calibrateRunReportSchema,
  calibrateSensitivityReportSchema,
} from '../report-schemas.ts';
import { buildInput, fixtureSeed, loadFixture, runSingleGame, UsageError } from './sim.ts';
import { lineupForTeam } from './challenge.ts';
import { loadPackagedData, PackagedData, loadProfileFile } from './data-loader.ts';
import { parseCount } from '../args.ts';
export const CALIBRATE_OPTIONS: Record<string, boolean> = {
  samples: true,
  'seed-from': true,
  workers: true,
  fixture: true,
  profile: true,
  era: true,
  'challenge-samples': true,
  'opponent-games': true,
  'allow-skipped': false,
  format: true,
  verbose: false,
};
export function leagueAverageTeam(pool: FranchiseEraPool): SimulationTeam {
  const usage = pool.players.map((p) => Math.max(0.01, p.tendencies.usageRate));
  const totalUsage = usage.reduce((a, b) => a + b, 0);
  const meanRatings: Record<string, number> = {};
  const meanTendencies: Record<string, number> = {};
  const meanAnchors: Record<string, number> = {};
  pool.players.forEach((player, i) => {
    const usageAt = usage[i];
    if (usageAt === undefined) return;
    const weight = usageAt / totalUsage;
    for (const [key, value] of Object.entries(player.detailedRatings)) {
      const numeric = typeof value === 'number' ? value : 0;
      meanRatings[key] = (meanRatings[key] ?? 0) + numeric * weight;
    }
    for (const [key, value] of Object.entries(player.tendencies)) {
      const numeric = typeof value === 'number' ? value : 0;
      meanTendencies[key] = (meanTendencies[key] ?? 0) + numeric * weight;
    }
    for (const [key, value] of Object.entries(player.anchors)) {
      const numeric = typeof value === 'number' ? value : 0;
      meanAnchors[key] = (meanAnchors[key] ?? 0) + numeric * weight;
    }
  });
  const firstPlayer = pool.players[0];
  if (!firstPlayer) throw new UsageError('pool is empty');
  const sample = toSimulationPlayer(firstPlayer);
  const ratings = { ...sample.ratings };
  const tendencies = { ...sample.tendencies };
  for (const key of Object.keys(ratings) as Array<keyof typeof ratings>) {
    ratings[key] = Math.min(100, Math.max(0, Math.round(meanRatings[key] ?? ratings[key])));
  }
  for (const key of Object.keys(tendencies) as Array<keyof typeof tendencies>) {
    tendencies[key] = meanTendencies[key] ?? tendencies[key];
  }
  const reconstructedPlayers = pool.players.filter((p) => p.reconstructedThreePoint !== undefined);
  const allReconstructed = reconstructedPlayers.length === pool.players.length;
  let averageProfile: SimulationPlayer['reconstructedThreePoint'] | undefined;
  if (allReconstructed) {
    const sums = {
      accuracyConservative: 0,
      accuracyMean: 0,
      accuracyStdDev: 0,
      attemptRateConservative: 0,
      attemptRateMean: 0,
      attemptRateStdDev: 0,
    };
    reconstructedPlayers.forEach((player, i) => {
      const profile = player.reconstructedThreePoint;
      const usageAt = usage[i];
      if (profile === undefined || usageAt === undefined) return;
      const weight = usageAt / totalUsage;
      sums.accuracyConservative += profile.accuracyConservative * weight;
      sums.accuracyMean += profile.accuracyMean * weight;
      sums.accuracyStdDev += profile.accuracyStdDev * weight;
      sums.attemptRateConservative += profile.attemptRateConservative * weight;
      sums.attemptRateMean += profile.attemptRateMean * weight;
      sums.attemptRateStdDev += profile.attemptRateStdDev * weight;
    });
    const source = reconstructedPlayers[0]?.reconstructedThreePoint;
    if (source !== undefined) {
      averageProfile = {
        modelVersion: source.modelVersion,
        accuracyConservative: sums.accuracyConservative,
        accuracyMean: sums.accuracyMean,
        accuracyStdDev: sums.accuracyStdDev,
        attemptRateConservative: sums.attemptRateConservative,
        attemptRateMean: sums.attemptRateMean,
        attemptRateStdDev: sums.attemptRateStdDev,
        confidence: source.confidence,
        floor: source.floor,
        zoneFloors: source.zoneFloors,
        evidence: source.evidence,
      };
    }
  }
  const slots: SimulationPlayer['positions'][] = POSITION_SLOTS.map((position) => [position]);
  const averagedAnchors =
    averageProfile !== undefined
      ? ({
          ...Object.fromEntries(
            Object.entries(meanAnchors).map(([key, value]) => [key, Number(value.toFixed(4))]),
          ),
          threePointPct: null,
          threePointAttemptRate: null,
        } as SimulationPlayer['anchors'])
      : undefined;
  return {
    teamId: 'league-average',
    displayName: 'League Average',
    players: slots.map((positions, i) => ({
      playerId: playerIdSchema.parse(`avg-${String(i)}`),
      displayName: 'League Average',
      positions,
      heightInches: sample.heightInches,
      weightLbs: sample.weightLbs,
      ratings,
      tendencies,
      ...(averagedAnchors !== undefined
        ? { anchors: averagedAnchors, reconstructedThreePoint: averageProfile }
        : {}),
    })),
  };
}
export function poolStrengthLineups(pool: FranchiseEraPool): {
  strong: SimulationTeam;
  weak: SimulationTeam;
} {
  const SLOTS: SimulationPlayer['positions'][] = POSITION_SLOTS.map((position) => [position]);
  const pick = (players: typeof pool.players): SimulationTeam => {
    const remaining = [...players];
    const chosen: Array<{
      player: (typeof pool.players)[number];
      positions: SimulationPlayer['positions'];
    }> = [];
    for (const slot of SLOTS) {
      const requirement = slot[0];
      if (!requirement) throw new UsageError('pool cannot form a legal lineup');
      const index = remaining.findIndex((p) =>
        playableSlotGroups(p.positions.playable).includes(slotGroupOf(requirement)),
      );
      if (index < 0) throw new UsageError('pool cannot form a legal lineup');
      const player = remaining[index];
      if (!player) throw new UsageError('pool cannot form a legal lineup');
      remaining.splice(index, 1);
      chosen.push({ player, positions: slot });
    }
    return {
      teamId: 'pool-lineup',
      displayName: 'Pool Lineup',
      players: chosen.map(({ player, positions }) => ({
        ...toSimulationPlayer(player),
        positions,
      })),
    };
  };
  const byScoreDesc = [...pool.players].sort(
    (a, b) => b.selectionScore - a.selectionScore || a.playerId.localeCompare(b.playerId),
  );
  const n = byScoreDesc.length;
  const strongBand = byScoreDesc.slice(0, Math.max(10, Math.ceil(n * 0.25)));
  const weakStart = Math.floor(n * 0.35);
  const weakEnd = Math.ceil(n * 0.65);
  const weakBand = byScoreDesc.slice(weakStart, Math.max(weakStart + 10, weakEnd));
  try {
    return { strong: pick(strongBand), weak: pick(weakBand) };
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    return { strong: pick(byScoreDesc), weak: pick([...byScoreDesc].reverse()) };
  }
}
interface MetricAccumulator {
  points: number;
  fga: number;
  fgm: number;
  tpa: number;
  tpm: number;
  fta: number;
  ftm: number;
  oreb: number;
  dreb: number;
  ast: number;
  tov: number;
  pf: number;
  possessions: number;
  closeGames: number;
  blowouts: number;
  overtime: number;
  homeWins: number;
  zoneAttempts: Record<string, number>;
}
function newAccumulator(): MetricAccumulator {
  return {
    points: 0,
    fga: 0,
    fgm: 0,
    tpa: 0,
    tpm: 0,
    fta: 0,
    ftm: 0,
    oreb: 0,
    dreb: 0,
    ast: 0,
    tov: 0,
    pf: 0,
    possessions: 0,
    closeGames: 0,
    blowouts: 0,
    overtime: 0,
    homeWins: 0,
    zoneAttempts: { rim: 0, shortMid: 0, longMid: 0, cornerThree: 0, aboveBreakThree: 0 },
  };
}
function accumulate(
  acc: MetricAccumulator,
  input: GameSimulationInput,
  trackHomeWin: boolean,
): number {
  const result = runSingleGame(input).result;
  const b = result.home.box;
  const other = result.away.box;
  acc.points += b.points;
  acc.fga += b.fieldGoals.attempted;
  acc.fgm += b.fieldGoals.made;
  acc.tpa += b.threes.attempted;
  acc.tpm += b.threes.made;
  acc.fta += b.freeThrows.attempted;
  acc.ftm += b.freeThrows.made;
  acc.oreb += b.rebounds.offensive;
  acc.dreb += b.rebounds.defensive;
  acc.ast += b.assists;
  acc.tov += b.turnovers;
  acc.pf += b.fouls;
  acc.possessions += b.possessions;
  const margin = Math.abs(b.points - other.points);
  if (margin <= 5) acc.closeGames += 1;
  if (margin >= 20) acc.blowouts += 1;
  if (result.overtimePeriods > 0) acc.overtime += 1;
  if (trackHomeWin && result.winner === 'home') acc.homeWins += 1;
  for (const zone of result.home.shotZones) {
    acc.zoneAttempts[zone.zone] = (acc.zoneAttempts[zone.zone] ?? 0) + zone.attempts;
  }
  return checkGameResult(result).length;
}
export function calibrateRun(args: {
  samples?: string;
  'seed-from'?: string;
  workers?: string;
  profile?: string;
  era?: string;
  'challenge-samples'?: string;
  'opponent-games'?: string;
  'allow-skipped'?: boolean;
}): CliReport {
  const samples = parseCount(args.samples, '--samples', 2000);
  const seedFrom = parseCount(args['seed-from'], '--seed-from', 0);
  const challengeSamples = parseCount(args['challenge-samples'], '--challenge-samples', 25);
  const opponentGames = parseCount(args['opponent-games'], '--opponent-games', 60);
  const allowSkipped = args['allow-skipped'] === true;
  const packaged = loadPackagedData();
  const data = new PackagedData(packaged.manifest, packaged.dir);
  const profile = args.profile
    ? loadProfileFile(args.profile)
    : data.eraProfile(args.era ?? DEFAULT_ERA_ID);
  const pool = data.pool('lakers', profile.eraId);
  const average = leagueAverageTeam(pool);
  const { strong, weak } = poolStrengthLineups(pool);
  const bracket = data.bracket();
  const context = createEngineContext();
  const equalAcc = newAccumulator();
  const strongWeakAcc = newAccumulator();
  let invariantFailures = 0;
  for (let i = seedFrom; i < seedFrom + samples; i += 1) {
    const seed = fixtureSeed('calibrate', i);
    const equalInput: GameSimulationInput = {
      schemaVersion: 2,
      gameNumber: 1,
      seed,
      dataVersion: profile.dataVersion,
      profile,
      home: average,
      away: average,
    };
    const swInput: GameSimulationInput = {
      schemaVersion: 2,
      gameNumber: 1,
      seed,
      dataVersion: profile.dataVersion,
      profile,
      home: strong,
      away: weak,
    };
    invariantFailures += accumulate(equalAcc, equalInput, true);
    invariantFailures += accumulate(strongWeakAcc, swInput, true);
  }
  const openingOpponent = bracket.opponents.find(
    (o) => o.opponentId === `lakers-${profile.eraId}-opening`,
  );
  let openingWinRateVsStrongUser: number | null = null;
  if (openingOpponent) {
    let wins = 0;
    const games = Math.min(opponentGames, 400);
    for (let i = 0; i < games; i += 1) {
      const oppInput: GameSimulationInput = {
        schemaVersion: 2,
        gameNumber: 1,
        seed: fixtureSeed('user-opponent', i),
        dataVersion: profile.dataVersion,
        profile,
        home: { ...strong, teamId: 'user', displayName: 'User Lineup' },
        away: {
          teamId: openingOpponent.teamId,
          displayName: openingOpponent.displayName,
          players: openingOpponent.players,
        },
      };
      const oppResult = runSingleGame(oppInput).result;
      if (oppResult.winner === 'home') wins += 1;
    }
    openingWinRateVsStrongUser = games === 0 ? null : 1 - wins / games;
  }
  const bracketDistribution: Array<{
    opponentId: string;
    recordedWinRate: number;
    observedWinRate: number;
    recordedPercentile: number;
  }> = [];
  for (const opponent of bracket.opponents) {
    const team: SimulationTeam = {
      teamId: opponent.teamId,
      displayName: opponent.displayName,
      players: opponent.players,
    };
    const measurement = evaluateLineupStrength(team, context, profile, {
      samplesPerBenchmark: Math.max(3, Math.floor(opponentGames / 3)),
      seedBase: `calibrate-opp-${opponent.opponentId}`,
    });
    bracketDistribution.push({
      opponentId: opponent.opponentId,
      recordedWinRate: opponent.strength.winRate,
      observedWinRate: Math.round(measurement.winRate * 1000) / 1000,
      recordedPercentile: opponent.strength.percentile,
    });
  }
  const observedRates = bracketDistribution.map((d) => d.observedWinRate).sort((a, b) => a - b);
  const medianObserved = observedRates[Math.floor(observedRates.length / 2)] ?? null;
  const userLineup = lineupForTeam(strong);
  const samplePlayer = pool.players[0];
  let perfectRuns = 0;
  const calibrateFranchiseId = franchiseIdSchema.parse('lakers');
  for (let i = 0; i < challengeSamples; i += 1) {
    const run = createChallenge({
      runId: idSchema.parse(`calibrate-run-${String(i)}`),
      mode: 'sandbox',
      franchiseId: calibrateFranchiseId,
      eraId: profile.eraId,
      homeDisplayName: 'User Lineup',
      lineup: userLineup.lineup,
      players: userLineup.players,
      selections: userLineup.players.map((player) => ({
        playerId: player.playerId,
        franchiseId: calibrateFranchiseId,
        eraId: profile.eraId,
      })),
      runSeed: fixtureSeed('calibrate-run82', i),
      dataVersion: profile.dataVersion,
      ratingVersion: samplePlayer?.source.ratingsVersion ?? 'unknown',
      positionNormalizationVersion: samplePlayer?.positions.normalizationVersion ?? 'position-v1',
      engineVersion: context.engineVersion,
      profile,
      bracket,
    });
    const finished = simulateChallenge(run, profile, context);
    if (finished.outcome === 'perfect') perfectRuns += 1;
  }
  const metrics = buildMetrics(equalAcc, strongWeakAcc, samples, profile);
  const roleMetrics = buildRoleMetrics(samples, profile);
  const allMetrics = [...metrics, ...roleMetrics];
  const skipped = allMetrics.filter((m) => m.status === 'skippedInsufficientSample');
  const anyFailed = allMetrics.some((m) => m.status === 'fail');
  const pass = !anyFailed && (allowSkipped || skipped.length === 0);
  const payload = calibrateRunReportSchema.parse({
    schemaVersion: 2,
    command: 'calibrate run',
    profileVersion: profile.profileVersion,
    eraId: profile.eraId,
    samples,
    engineVersion: context.engineVersion,
    pass,
    metrics: allMetrics,
    openingOpponentWinRateVsStrongUser: openingWinRateVsStrongUser,
    bracketDistribution,
    bracketMedianObservedWinRate: medianObserved,
    perfectRunRate: challengeSamples === 0 ? null : perfectRuns / challengeSamples,
    challengeRuns: challengeSamples,
    invariantFailures,
  });
  const failures: string[] = [];
  if (!pass) {
    for (const m of allMetrics) {
      if (m.status === 'fail') {
        failures.push(
          `${m.key}: observed ${m.observed.toFixed(4)} outside ${(m.target - m.tolerance).toFixed(4)}..${(m.target + m.tolerance).toFixed(4)}`,
        );
      } else if (m.status === 'skippedInsufficientSample' && !allowSkipped) {
        failures.push(
          `${m.key}: skipped (sample ${String(m.sample)} below minimum ${String(m.minimumSample)})`,
        );
      }
    }
  }
  if (invariantFailures > 0) failures.push(`${String(invariantFailures)} invariant failures`);
  const details = [
    `profile ${profile.profileVersion} · era ${profile.eraId} · ${String(samples)} samples · engine ${payload.engineVersion}`,
    ...metrics.map(
      (m) =>
        `${m.status === 'pass' ? 'pass' : m.status === 'fail' ? 'FAIL' : 'SKIPPED'} ${m.key}: ${m.observed.toFixed(4)} (target ${m.target.toFixed(4)} ± ${m.tolerance.toFixed(4)}, sample ${String(m.sample)}/${String(m.minimumSample)})`,
    ),
    payload.openingOpponentWinRateVsStrongUser === null
      ? 'opening opponent vs strong user: not measured'
      : `opening opponent win rate vs strong user: ${(payload.openingOpponentWinRateVsStrongUser * 100).toFixed(1)}% (informational)`,
    `bracket remeasurement: median observed win rate ${payload.bracketMedianObservedWinRate === null ? 'n/a' : `${(payload.bracketMedianObservedWinRate * 100).toFixed(1)}%`} (${String(payload.bracketDistribution?.length ?? 0)} opponents)`,
    `82-0 completion rate: ${payload.perfectRunRate === null ? 'n/a' : `${(payload.perfectRunRate * 100).toFixed(1)}%`} over ${String(payload.challengeRuns)} runs (informational)`,
  ];
  return makeReport(
    'calibrate run',
    { profile: profile.profileVersion, samples },
    { details, failures, payload },
  );
}
function buildMetrics(
  equal: MetricAccumulator,
  strongWeak: MetricAccumulator,
  n: number,
  profile: EraSimulationProfile,
): Array<z.infer<typeof calibrationMetricSchema>> {
  const t = profile.targets;
  const perGame = (value: number) => value / n;
  const fga = Math.max(1, equal.fga);
  const possEst = Math.max(1, equal.fga + 0.44 * equal.fta - equal.oreb + equal.tov);
  const orebTotal = Math.max(1, equal.oreb + equal.dreb);
  return [
    metric('possessionsPerGame', perGame(equal.possessions), t.possessionsPerGame, n),
    metric('pointsPerGame', perGame(equal.points), t.pointsPerGame, n),
    metric('offensiveRating', (equal.points / possEst) * 100, t.offensiveRating, n),
    metric('fieldGoalPct', equal.fgm / fga, t.fieldGoalPct, n),
    metric('efgPct', (equal.fgm + 0.5 * equal.tpm) / fga, t.efgPct, n),
    metric('tsPct', equal.points / (2 * possEst), t.tsPct, n),
    metric('threePointRate', equal.tpa / fga, t.threePointRate, n),
    metric('threePointPct', equal.tpm / Math.max(1, equal.tpa), t.threePointPct, n),
    metric('freeThrowsAttemptedPerGame', perGame(equal.fta), t.freeThrowsAttemptedPerGame, n),
    metric('freeThrowPct', equal.ftm / Math.max(1, equal.fta), t.freeThrowPct, n),
    metric('turnoversPerGame', perGame(equal.tov), t.turnoversPerGame, n),
    metric('turnoversPerPossession', equal.tov / possEst, t.turnoversPerPossession, n),
    metric('offensiveReboundsPerGame', perGame(equal.oreb), t.offensiveReboundsPerGame, n),
    metric('offensiveReboundRate', equal.oreb / orebTotal, t.offensiveReboundRate, n),
    metric('assistsPerGame', perGame(equal.ast), t.assistsPerGame, n),
    metric('assistRate', equal.ast / Math.max(1, equal.fgm), t.assistRate, n),
    metric('personalFoulsPerGame', perGame(equal.pf), t.personalFoulsPerGame, n),
    metric('zoneMix.rim', (equal.zoneAttempts.rim ?? 0) / fga, t.zoneMix.rim, n),
    metric('zoneMix.shortMid', (equal.zoneAttempts.shortMid ?? 0) / fga, t.zoneMix.shortMid, n),
    metric('zoneMix.longMid', (equal.zoneAttempts.longMid ?? 0) / fga, t.zoneMix.longMid, n),
    metric(
      'zoneMix.cornerThree',
      (equal.zoneAttempts.cornerThree ?? 0) / fga,
      t.zoneMix.cornerThree,
      n,
    ),
    metric(
      'zoneMix.aboveBreakThree',
      (equal.zoneAttempts.aboveBreakThree ?? 0) / fga,
      t.zoneMix.aboveBreakThree,
      n,
    ),
    metric('closeGameRate', equal.closeGames / n, t.closeGameRate, n),
    metric('blowoutRate', equal.blowouts / n, t.blowoutRate, n),
    metric('overtimeRate', equal.overtime / n, t.overtimeRate, n),
    metric('strongVsWeakWinRate', strongWeak.homeWins / Math.max(1, n), t.strongVsWeakWinRate, n),
    metric('equalLineupHomeWinRate', equal.homeWins / Math.max(1, n), t.equalLineupHomeWinRate, n),
  ];
}
function metric(
  key: string,
  observed: number,
  target: {
    value: number;
    tolerance: number;
    minimumSample: number;
  },
  sample: number,
): z.infer<typeof calibrationMetricSchema> {
  if (sample < target.minimumSample) {
    return {
      key,
      target: target.value,
      tolerance: target.tolerance,
      observed,
      status: 'skippedInsufficientSample',
      pass: false,
      sample,
      minimumSample: target.minimumSample,
    };
  }
  const inRange =
    observed >= target.value - target.tolerance && observed <= target.value + target.tolerance;
  return {
    key,
    target: target.value,
    tolerance: target.tolerance,
    observed,
    status: inRange ? 'pass' : 'fail',
    pass: inRange,
    sample,
    minimumSample: target.minimumSample,
  };
}
interface RoleAccumulator {
  games: number;
  usage: number;
  fieldGoalAttempts: number;
  threeAttempts: number;
  freeThrowAttempts: number;
  assists: number;
  assistOpportunities: number;
  offensiveRebounds: number;
  defensiveRebounds: number;
  teamMisses: number;
  opponentMisses: number;
}
function buildRoleMetrics(
  samples: number,
  profile: EraSimulationProfile,
): Array<z.infer<typeof calibrationMetricSchema>> {
  const roleTargets = profile.targets.playerRoles;
  if (roleTargets.length === 0) return [];
  const fixture = loadFixture('roles');
  const roleSamples = Math.min(samples, 500);
  const slots = Array.from({ length: 5 }, () => ({
    games: 0,
    usage: 0,
    fieldGoalAttempts: 0,
    threeAttempts: 0,
    freeThrowAttempts: 0,
    assists: 0,
    assistOpportunities: 0,
    offensiveRebounds: 0,
    defensiveRebounds: 0,
    teamMisses: 0,
    opponentMisses: 0,
  })) as RoleAccumulator[];
  for (let i = 0; i < roleSamples; i += 1) {
    const input = buildInput({ fixture, profile, seed: fixtureSeed('roles', i), variant: false });
    const { result } = runSingleGame(input);
    for (const side of [result.home, result.away] as const) {
      const opponent = side === result.home ? result.away : result.home;
      const misses = (team: GameResult['home']) =>
        team.box.fieldGoals.attempted -
        team.box.fieldGoals.made +
        (team.box.freeThrows.attempted - team.box.freeThrows.made);
      side.players.forEach((box, slotIndex) => {
        const acc = slots[slotIndex];
        if (!acc) return;
        acc.games += 1;
        acc.fieldGoalAttempts += box.fieldGoals.attempted;
        acc.threeAttempts += box.threes.attempted;
        acc.freeThrowAttempts += box.freeThrows.attempted;
        acc.assists += box.assists;
        acc.offensiveRebounds += box.rebounds.offensive;
        acc.defensiveRebounds += box.rebounds.defensive;
        acc.teamMisses += misses(side);
        acc.opponentMisses += misses(opponent);
        if (box.diagnostics) {
          acc.usage += box.diagnostics.usage;
          acc.assistOpportunities += box.diagnostics.assistOpportunities;
        }
      });
    }
  }
  const teamUsage = slots.reduce((sum, s) => sum + s.usage, 0);
  const observed: Record<string, number> = {};
  slots.forEach((acc, i) => {
    const key = (name: string) => `${name}.${String(i)}`;
    observed[key('usageShare')] = acc.usage / Math.max(1e-9, teamUsage);
    observed[key('threePointRate')] = acc.threeAttempts / Math.max(1, acc.fieldGoalAttempts);
    observed[key('freeThrowRate')] = acc.freeThrowAttempts / Math.max(1, acc.fieldGoalAttempts);
    observed[key('assistConversion')] = acc.assists / Math.max(1, acc.assistOpportunities);
    observed[key('offensiveReboundPct')] = acc.offensiveRebounds / Math.max(1, acc.teamMisses);
    observed[key('defensiveReboundPct')] = acc.defensiveRebounds / Math.max(1, acc.opponentMisses);
  });
  return roleTargets.map(({ key, target }) => metric(key, observed[key] ?? 0, target, roleSamples));
}
const SENSITIVITY_FAMILIES: Array<{
  id: string;
  direction: string;
  pass: (base: number, changed: number) => boolean;
}> = [
  { id: 'sens-shooting', direction: 'points up', pass: (b, c) => c > b * 1.02 },
  { id: 'sens-creation', direction: 'initiator usage share up', pass: (b, c) => c > b * 1.05 },
  { id: 'sens-passing', direction: 'assists up', pass: (b, c) => c > b * 1.02 },
  { id: 'sens-turnovers', direction: 'turnovers down', pass: (b, c) => c < b * 0.97 },
  { id: 'sens-defense', direction: 'opponent points down', pass: (b, c) => c < b * 0.975 },
  { id: 'sens-rebounding', direction: 'offensive rebounds up', pass: (b, c) => c > b * 1.03 },
  { id: 'sens-fouls', direction: 'free throws attempted up', pass: (b, c) => c > b * 1.02 },
  { id: 'sens-pace', direction: 'possessions up', pass: (b, c) => c > b * 1.1 },
  { id: 'sens-shot-mix', direction: 'three-point share up', pass: (b, c) => c > b * 1.1 },
];
export function calibrateSensitivity(args: {
  samples?: string;
  profile?: string;
  era?: string;
}): CliReport {
  const samples = parseCount(args.samples, '--samples', 200);
  const packaged = loadPackagedData();
  const data = new PackagedData(packaged.manifest, packaged.dir);
  const profile = args.profile
    ? loadProfileFile(args.profile)
    : data.eraProfile(args.era ?? DEFAULT_ERA_ID);
  const metrics = SENSITIVITY_FAMILIES.map((family) => {
    const fixture = loadFixture(family.id);
    const base = sampleMetric(family.id, profile, fixture, false, samples);
    const changed = sampleMetric(family.id, profile, fixture, true, samples);
    const pass = family.pass(base, changed);
    return {
      family: family.id,
      direction: family.direction,
      baseValue: base,
      changedValue: changed,
      relativeShift: base === 0 ? 0 : (changed - base) / Math.abs(base),
      pass,
    };
  });
  const payload = calibrateSensitivityReportSchema.parse({
    schemaVersion: 1,
    command: 'calibrate sensitivity',
    samples,
    engineVersion: createEngineContext().engineVersion,
    pass: metrics.every((m) => m.pass),
    metrics,
  });
  const failures = payload.pass
    ? []
    : metrics
        .filter((m) => !m.pass)
        .map(
          (m) =>
            `${m.family}: expected ${m.direction}, got base ${m.baseValue.toFixed(2)} -> changed ${m.changedValue.toFixed(2)}`,
        );
  const details = [
    `engine ${payload.engineVersion} · ${String(samples)} samples per family`,
    ...metrics.map(
      (m) =>
        `${m.pass ? 'pass' : 'FAIL'} ${m.family}: ${m.baseValue.toFixed(2)} -> ${m.changedValue.toFixed(2)} (${(m.relativeShift * 100).toFixed(1)}%, expected ${m.direction})`,
    ),
  ];
  return makeReport('calibrate sensitivity', { samples }, { details, failures, payload });
}
function sampleMetric(
  fixtureId: string,
  profile: EraSimulationProfile,
  fixture: ReturnType<typeof loadFixture>,
  variant: boolean,
  samples: number,
): number {
  let total = 0;
  for (let i = 0; i < samples; i += 1) {
    const input = buildInput({ fixture, profile, seed: fixtureSeed(fixtureId, i), variant });
    const { result } = runSingleGame(input);
    total += metricValue(fixtureId, result.home, result.away);
  }
  return total / Math.max(1, samples);
}
function metricValue(
  fixtureId: string,
  home: GameResult['home'],
  away: GameResult['away'],
): number {
  switch (fixtureId) {
    case 'sens-creation': {
      const player = home.players.find((p) => p.playerId === 'p-fixture-1');
      if (!player) return 0;
      return player.fieldGoals.attempted / Math.max(1, home.box.fieldGoals.attempted);
    }
    case 'sens-passing':
      return home.box.assists;
    case 'sens-turnovers':
      return home.box.turnovers;
    case 'sens-defense':
      return away.box.points;
    case 'sens-rebounding':
      return home.box.rebounds.offensive;
    case 'sens-fouls':
      return home.box.freeThrows.attempted;
    case 'sens-pace':
      return home.box.possessions;
    case 'sens-shot-mix':
      return home.box.threes.attempted / Math.max(1, home.box.fieldGoals.attempted);
    default:
      return home.box.points;
  }
}
