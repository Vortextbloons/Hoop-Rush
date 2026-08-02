import { classifyArchetype, createEngineContext } from '@hoop-rush/engine';
import type { GameResult, SimulationPlayer } from '@hoop-rush/data-contracts';
import { makeReport, type CliReport } from '../report.js';
import { simDiagnoseReportSchema, simSeasonReportSchema } from '../report-schemas.js';
import { buildInput, fixtureSeed, loadFixture, runSingleGame, UsageError } from './sim.js';
import { loadPackagedData, PackagedData } from './data-loader.js';

/**
 * `sim diagnose` and `sim season` (spec/09). Opportunity-level diagnostics for
 * player-role behavior: `sim diagnose` aggregates per-player usage, shot-mix,
 * assist, rebound, and contest data across a seeded batch; `sim season`
 * simulates 82-game seasons and checks that per-game shooting variance is
 * consistent with independent per-shot binomial draws (a regression toward
 * player skill instead of excessive per-game randomness). Both commands call
 * the authoritative engine; neither re-implements basketball rules.
 */

export const DIAGNOSE_OPTIONS: Record<string, boolean> = {
  fixture: true,
  samples: true,
  profile: true,
  format: true,
  verbose: false,
};

export const SEASON_OPTIONS: Record<string, boolean> = {
  fixture: true,
  samples: true,
  profile: true,
  format: true,
  verbose: false,
};

function parseCount(value: string | undefined, option: string, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new UsageError(`${option} must be a nonnegative integer (got "${value}")`);
  }
  return parsed;
}

function loadProfile(): {
  profile: ReturnType<PackagedData['eraProfile']>;
  packaged: ReturnType<typeof loadPackagedData>;
} {
  const packaged = loadPackagedData();
  return { profile: new PackagedData(packaged.manifest, packaged.dir).eraProfile(), packaged };
}

interface PlayerAccumulator {
  playerId: string;
  displayName: string;
  archetype: string;
  games: number;
  points: number;
  fieldGoalMakes: number;
  fieldGoalAttempts: number;
  threeMakes: number;
  threeAttempts: number;
  freeThrowMakes: number;
  freeThrowAttempts: number;
  offensiveRebounds: number;
  defensiveRebounds: number;
  assists: number;
  turnovers: number;
  steals: number;
  assistOpportunities: number;
  offensiveReboundChances: number;
  defensiveReboundChances: number;
  contestedShots: number;
  /** Misses by this player's team while they played (OReb denominator). */
  teamMisses: number;
  /** Misses by the opponent while this player played (DREb denominator). */
  opponentMisses: number;
  zoneAttempts: Record<string, number>;
  zoneMakes: Record<string, number>;
}

function newPlayerAccumulator(player: SimulationPlayer): PlayerAccumulator {
  return {
    playerId: player.playerId,
    displayName: player.displayName,
    archetype: classifyArchetype(player),
    games: 0,
    points: 0,
    fieldGoalMakes: 0,
    fieldGoalAttempts: 0,
    threeMakes: 0,
    threeAttempts: 0,
    freeThrowMakes: 0,
    freeThrowAttempts: 0,
    offensiveRebounds: 0,
    defensiveRebounds: 0,
    assists: 0,
    turnovers: 0,
    steals: 0,
    assistOpportunities: 0,
    offensiveReboundChances: 0,
    defensiveReboundChances: 0,
    contestedShots: 0,
    teamMisses: 0,
    opponentMisses: 0,
    zoneAttempts: { rim: 0, shortMid: 0, longMid: 0, cornerThree: 0, aboveBreakThree: 0 },
    zoneMakes: { rim: 0, shortMid: 0, longMid: 0, cornerThree: 0, aboveBreakThree: 0 },
  };
}

function sideMisses(team: GameResult['home']): number {
  return (
    team.box.fieldGoals.attempted -
    team.box.fieldGoals.made +
    (team.box.freeThrows.attempted - team.box.freeThrows.made)
  );
}

function foldPlayer(
  acc: PlayerAccumulator,
  box: GameResult['home']['players'][number],
  team: GameResult['home'],
  opponent: GameResult['away'],
): void {
  acc.games += 1;
  acc.points += box.points;
  acc.fieldGoalMakes += box.fieldGoals.made;
  acc.fieldGoalAttempts += box.fieldGoals.attempted;
  acc.threeMakes += box.threes.made;
  acc.threeAttempts += box.threes.attempted;
  acc.freeThrowMakes += box.freeThrows.made;
  acc.freeThrowAttempts += box.freeThrows.attempted;
  acc.offensiveRebounds += box.rebounds.offensive;
  acc.defensiveRebounds += box.rebounds.defensive;
  acc.assists += box.assists;
  acc.turnovers += box.turnovers;
  acc.steals += box.steals;
  acc.teamMisses += sideMisses(team);
  acc.opponentMisses += sideMisses(opponent);
  if (box.diagnostics) {
    acc.assistOpportunities += box.diagnostics.assistOpportunities;
    acc.offensiveReboundChances += box.diagnostics.offensiveReboundChances;
    acc.defensiveReboundChances += box.diagnostics.defensiveReboundChances;
    acc.contestedShots += box.diagnostics.contestedShots;
    for (const zone of box.diagnostics.shotZones) {
      acc.zoneAttempts[zone.zone] = (acc.zoneAttempts[zone.zone] ?? 0) + zone.attempts;
      acc.zoneMakes[zone.zone] = (acc.zoneMakes[zone.zone] ?? 0) + zone.makes;
    }
  }
}

export function simDiagnose(args: {
  fixture?: string;
  samples?: string;
  profile?: string;
}): CliReport {
  const fixtureId = args.fixture ?? 'equal';
  const samples = parseCount(args.samples, '--samples', 200);
  if (args.profile !== undefined) {
    throw new UsageError('--profile is not supported for sim diagnose (packaged profile is used)');
  }
  const { profile } = loadProfile();
  const fixture = loadFixture(fixtureId);

  const players = new Map<string, PlayerAccumulator>();
  const fixturePlayers = new Map<string, SimulationPlayer>();
  for (const p of [...fixture.home.players, ...fixture.away.players]) {
    fixturePlayers.set(p.playerId, p);
  }
  let teamUsage = 0;
  let teamPossessions = 0;
  let teamPoints = 0;
  let teamMisses = 0;

  for (let i = 0; i < samples; i += 1) {
    const input = buildInput(fixture, profile, fixtureSeed(fixtureId, i), false);
    const { result } = runSingleGame(input);
    for (const side of ['home', 'away'] as const) {
      const team = result[side];
      const opponent = result[side === 'home' ? 'away' : 'home'];
      for (const box of team.players) {
        const source = fixturePlayers.get(box.playerId);
        if (!source) continue;
        const acc = players.get(box.playerId) ?? newPlayerAccumulator(source);
        foldPlayer(acc, box, team, opponent);
        players.set(box.playerId, acc);
      }
      teamPossessions += team.box.possessions;
      teamPoints += team.box.points;
      teamMisses += sideMisses(team);
      for (const box of team.players) {
        if (box.diagnostics) teamUsage += box.diagnostics.usage;
      }
    }
  }

  const rows = [...players.values()]
    .map((acc) => {
      const games = Math.max(1, acc.games);
      const usage = acc.fieldGoalAttempts + acc.freeThrowAttempts * 0.44 + acc.turnovers;
      return {
        playerId: acc.playerId,
        displayName: acc.displayName,
        archetype: acc.archetype,
        games: acc.games,
        pointsPerGame: round1(acc.points / games),
        usagePerGame: round1(usage / games),
        usageShare: round3(usage / Math.max(1, teamUsage)),
        fieldGoalPct: round3(acc.fieldGoalMakes / Math.max(1, acc.fieldGoalAttempts)),
        threePointRate: round3(acc.threeAttempts / Math.max(1, acc.fieldGoalAttempts)),
        freeThrowRate: round3(acc.freeThrowAttempts / Math.max(1, acc.fieldGoalAttempts)),
        assistsPerGame: round1(acc.assists / games),
        assistConversion: round3(acc.assists / Math.max(1, acc.assistOpportunities)),
        assistOpportunitiesPerGame: round1(acc.assistOpportunities / games),
        offensiveReboundPct: round3(acc.offensiveRebounds / Math.max(1, acc.teamMisses)),
        defensiveReboundPct: round3(acc.defensiveRebounds / Math.max(1, acc.opponentMisses)),
        contestedPerGame: round1(acc.contestedShots / games),
        stealsPerGame: round1(acc.steals / games),
        turnoversPerGame: round1(acc.turnovers / games),
        topZone: topZone(acc),
        zoneMix: zoneMixRows(acc),
      };
    })
    .sort((a, b) => b.usageShare - a.usageShare);

  const usagePerGame = rows.map((r) => r.usagePerGame);
  const top = usagePerGame[0];
  const last = usagePerGame[usagePerGame.length - 1];
  const spread =
    usagePerGame.length >= 2 && top !== undefined && last !== undefined
      ? top / Math.max(0.5, last)
      : 0;

  const payload = simDiagnoseReportSchema.parse({
    schemaVersion: 1,
    command: 'sim diagnose',
    fixture: fixtureId,
    samples,
    engineVersion: createEngineContext().engineVersion,
    profileVersion: profile.profileVersion,
    players: rows,
    team: {
      averagePointsPerGame: round1(teamPoints / Math.max(1, samples)),
      averagePossessionsPerGame: round1(teamPossessions / Math.max(1, samples * 2)),
      averageTeamMissesPerGame: round1(teamMisses / Math.max(1, samples * 2)),
    },
    spread: { topToLastUsageRatio: round2(spread) },
  });

  const details = [
    `fixture ${fixtureId} · ${String(samples)} games · engine ${payload.engineVersion} · profile ${payload.profileVersion}`,
    `team per game: ${payload.team.averagePointsPerGame.toFixed(1)} pts · ${payload.team.averagePossessionsPerGame.toFixed(1)} poss · ${payload.team.averageTeamMissesPerGame.toFixed(1)} misses`,
    `usage spread (top:last usage ratio) ${payload.spread.topToLastUsageRatio.toFixed(2)}`,
    ...payload.players.map(
      (p) =>
        `  ${p.playerId} [${p.archetype}]: usg ${(p.usageShare * 100).toFixed(1)}% · ${String(p.pointsPerGame)} ppg · 3P ${p.threePointRate.toFixed(3)} · FTR ${p.freeThrowRate.toFixed(3)} · ast conv ${p.assistConversion.toFixed(3)} (${String(p.assistOpportunitiesPerGame)} opp/g) · OReb% ${p.offensiveReboundPct.toFixed(3)} · DReb% ${p.defensiveReboundPct.toFixed(3)} · ${String(p.contestedPerGame)} contest/g · top zone ${p.topZone}`,
    ),
  ];
  return makeReport('sim diagnose', { fixture: fixtureId, samples }, { details, payload });
}

interface SeasonPlayer {
  playerId: string;
  displayName: string;
  games: number;
  points: number;
  fieldGoalMakes: number;
  fieldGoalAttempts: number;
  threeMakes: number;
  threeAttempts: number;
  freeThrowMakes: number;
  freeThrowAttempts: number;
  assists: number;
  rebounds: number;
  turnovers: number;
  usage: number;
  perGameFieldGoalPct: number[];
  perGameFreeThrowPct: number[];
  perGameFieldGoalAttempts: number[];
  perGameFreeThrowAttempts: number[];
}

export function simSeason(args: {
  fixture?: string;
  samples?: string;
  profile?: string;
}): CliReport {
  const fixtureId = args.fixture ?? 'equal';
  const seasonSamples = parseCount(args.samples, '--samples', 1);
  if (seasonSamples < 1 || seasonSamples > 10) {
    throw new UsageError('--samples must be between 1 and 10 (each sample is an 82-game season)');
  }
  if (args.profile !== undefined) {
    throw new UsageError('--profile is not supported for sim season (packaged profile is used)');
  }
  const { profile } = loadProfile();
  const fixture = loadFixture(fixtureId);

  const allSeasons: Array<{ season: number; players: SeasonPlayer[] }> = [];
  const varianceFailures: string[] = [];

  for (let s = 0; s < seasonSamples; s += 1) {
    const players = new Map<string, SeasonPlayer>();
    for (let g = 0; g < 82; g += 1) {
      const input = buildInput(fixture, profile, fixtureSeed(fixtureId, s * 1000 + g), false);
      const { result } = runSingleGame(input);
      for (const box of result.home.players) {
        const acc = players.get(box.playerId) ?? {
          playerId: box.playerId,
          displayName:
            fixture.home.players.find((p) => p.playerId === box.playerId)?.displayName ??
            box.playerId,
          games: 0,
          points: 0,
          fieldGoalMakes: 0,
          fieldGoalAttempts: 0,
          threeMakes: 0,
          threeAttempts: 0,
          freeThrowMakes: 0,
          freeThrowAttempts: 0,
          assists: 0,
          rebounds: 0,
          turnovers: 0,
          usage: 0,
          perGameFieldGoalPct: [],
          perGameFreeThrowPct: [],
          perGameFieldGoalAttempts: [],
          perGameFreeThrowAttempts: [],
        };
        acc.games += 1;
        acc.points += box.points;
        acc.fieldGoalMakes += box.fieldGoals.made;
        acc.fieldGoalAttempts += box.fieldGoals.attempted;
        acc.threeMakes += box.threes.made;
        acc.threeAttempts += box.threes.attempted;
        acc.freeThrowMakes += box.freeThrows.made;
        acc.freeThrowAttempts += box.freeThrows.attempted;
        acc.assists += box.assists;
        acc.rebounds += box.rebounds.total;
        acc.turnovers += box.turnovers;
        if (box.diagnostics) acc.usage += box.diagnostics.usage;
        acc.perGameFieldGoalPct.push(
          box.fieldGoals.attempted > 0 ? box.fieldGoals.made / box.fieldGoals.attempted : 0,
        );
        acc.perGameFreeThrowPct.push(
          box.freeThrows.attempted > 0 ? box.freeThrows.made / box.freeThrows.attempted : 0,
        );
        acc.perGameFieldGoalAttempts.push(box.fieldGoals.attempted);
        acc.perGameFreeThrowAttempts.push(box.freeThrows.attempted);
        players.set(box.playerId, acc);
      }
    }
    allSeasons.push({ season: s + 1, players: [...players.values()] });
  }

  const rows = allSeasons.map(({ season, players }) => ({
    season,
    players: players
      .map((p) => {
        const games = Math.max(1, p.games);
        return {
          playerId: p.playerId,
          displayName: p.displayName,
          games: p.games,
          pointsPerGame: round1(p.points / games),
          fieldGoalPct: round3(p.fieldGoalMakes / Math.max(1, p.fieldGoalAttempts)),
          threePointPct: round3(p.threeMakes / Math.max(1, p.threeAttempts)),
          freeThrowPct: round3(p.freeThrowMakes / Math.max(1, p.freeThrowAttempts)),
          assistsPerGame: round1(p.assists / games),
          reboundsPerGame: round1(p.rebounds / games),
          turnoversPerGame: round1(p.turnovers / games),
          usagePerGame: round1(p.usage / games),
          variance: {
            fieldGoalRatio: round2(
              varianceRatio(
                p.perGameFieldGoalPct,
                p.perGameFieldGoalAttempts,
                p.fieldGoalMakes / Math.max(1, p.fieldGoalAttempts),
              ),
            ),
            freeThrowRatio: round2(
              varianceRatio(
                p.perGameFreeThrowPct,
                p.perGameFreeThrowAttempts,
                p.freeThrowMakes / Math.max(1, p.freeThrowAttempts),
              ),
            ),
          },
        };
      })
      .sort((a, b) => b.usagePerGame - a.usagePerGame),
  }));

  // Variance-consistency gate: per-game shooting variance should match
  // independent per-shot draws within a plausible band (1.0 = exact match).
  const RATIO_BAND: [number, number] = [0.5, 2.0];
  for (const { season, players } of allSeasons) {
    for (const p of players) {
      const games = p.games;
      for (const [label, ratio] of [
        [
          'fieldGoal',
          varianceRatio(
            p.perGameFieldGoalPct,
            p.perGameFieldGoalAttempts,
            p.fieldGoalMakes / Math.max(1, p.fieldGoalAttempts),
          ),
        ],
        [
          'freeThrow',
          varianceRatio(
            p.perGameFreeThrowPct,
            p.perGameFreeThrowAttempts,
            p.freeThrowMakes / Math.max(1, p.freeThrowAttempts),
          ),
        ],
      ] as const) {
        if (games < 20 || ratio < RATIO_BAND[0] || ratio > RATIO_BAND[1]) {
          varianceFailures.push(
            `${p.playerId} season ${String(season)} ${label} variance ratio ${ratio.toFixed(2)} outside ${String(RATIO_BAND[0])}..${String(RATIO_BAND[1])}`,
          );
        }
      }
    }
  }

  const payload = simSeasonReportSchema.parse({
    schemaVersion: 1,
    command: 'sim season',
    fixture: fixtureId,
    seasons: seasonSamples,
    engineVersion: createEngineContext().engineVersion,
    profileVersion: profile.profileVersion,
    varianceRatioBand: [...RATIO_BAND],
    rows,
  });

  const details = [
    `fixture ${fixtureId} · ${String(seasonSamples)} season(s) of 82 games · engine ${payload.engineVersion} · profile ${payload.profileVersion}`,
    `variance ratio band ${String(RATIO_BAND[0])}..${String(RATIO_BAND[1])} (1.0 = per-game variance matches binomial)`,
    ...rows.flatMap(({ season, players }) => [
      `season ${String(season)}:`,
      ...players.map(
        (p) =>
          `  ${p.playerId}: ${String(p.pointsPerGame)} ppg · FG ${p.fieldGoalPct.toFixed(3)} · 3P ${p.threePointPct.toFixed(3)} · FT ${p.freeThrowPct.toFixed(3)} · var ${p.variance.fieldGoalRatio.toFixed(2)}/${p.variance.freeThrowRatio.toFixed(2)}`,
      ),
    ]),
  ];
  return makeReport(
    'sim season',
    { fixture: fixtureId, seasons: seasonSamples },
    { details, failures: varianceFailures, payload },
  );
}

/**
 * Observed per-game rate variance divided by the binomial variance implied
 * by the player's season rate and per-game attempt count (1.0 = per-game
 * shooting behaves like independent per-shot draws).
 */
function varianceRatio(
  perGameRates: readonly number[],
  perGameAttempts: readonly number[],
  seasonRate: number,
): number {
  const games = perGameRates.length;
  if (games === 0) return 0;
  const mean = perGameRates.reduce((a, b) => a + b, 0) / games;
  const variance = perGameRates.reduce((a, b) => a + (b - mean) ** 2, 0) / games;
  const meanAttempts = perGameAttempts.reduce((a, b) => a + b, 0) / games;
  const binomial = (seasonRate * (1 - seasonRate)) / Math.max(1, meanAttempts);
  return binomial <= 0 ? 0 : Math.sqrt(variance / binomial);
}

function topZone(acc: PlayerAccumulator): string {
  const sorted = Object.entries(acc.zoneAttempts).sort((a, b) => b[1] - a[1]);
  const top = sorted[0];
  if (!top || top[1] === 0) return 'none';
  return `${top[0]} (${String(top[1])})`;
}

function zoneMixRows(acc: PlayerAccumulator): Array<{
  zone: string;
  attempts: number;
  makes: number;
  pct: number;
}> {
  return Object.entries(acc.zoneAttempts)
    .map(([zone, attempts]) => ({
      zone,
      attempts,
      makes: acc.zoneMakes[zone] ?? 0,
      pct: round3((acc.zoneMakes[zone] ?? 0) / Math.max(1, attempts)),
    }))
    .sort((a, b) => b.attempts - a.attempts);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
