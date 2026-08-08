import { usageOf } from './recorder.ts';

/**
 * Shared scoring/accounting audit core for game results. Classic
 * (`sim/invariants.ts checkGameResult`) and Season Run
 * (`season/season-game-audit.ts checkSeasonGameResult`) audit the same
 * identities against structurally identical box-score records, so the
 * arithmetic lives here once: points identity, makes/attempts bounds,
 * rebound buckets, player/team reconciliation, opportunity diagnostics
 * (rebound chances, contested shots, usage identity, assist opportunities),
 * and per-zone splits.
 *
 * The core returns violation FACTS; each auditor formats its own failure
 * messages (the two audits' message wording differs and is preserved
 * verbatim at each site). Divergent checks stay at the sites: the classic
 * audit's defensive-rebound-chances check reads the opponent's recorded
 * rebound opportunities while the Season audit recomputes opponent misses,
 * so that check is NOT shared.
 */

export interface AccountingShotZones {
  zone: string;
  attempts: number;
  makes: number;
}

export interface AccountingPlayerDiagnostics {
  usage: number;
  assistOpportunities: number;
  offensiveReboundChances: number;
  contestedShots: number;
  shotZones: readonly AccountingShotZones[];
}

export interface AccountingTeamDiagnostics {
  assistedFieldGoals: number;
  unassistedFieldGoals: number;
  reboundOpportunities: number;
  contestedShots: number;
}

/** Structural player box-score subset shared by PlayerBoxScore and SeasonGamePlayerResult. */
export interface AccountingPlayerInput {
  points: number;
  fieldGoals: { made: number; attempted: number };
  threes: { made: number; attempted: number };
  freeThrows: { made: number; attempted: number };
  rebounds: { offensive: number; defensive: number };
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fouls: number;
  diagnostics?: AccountingPlayerDiagnostics | null;
}

/** Structural team box-score subset shared by TeamBoxScore and the Season side box. */
export interface AccountingBoxInput {
  points: number;
  fieldGoals: { made: number; attempted: number };
  threes: { made: number; attempted: number };
  freeThrows: { made: number; attempted: number };
  rebounds: { offensive: number; defensive: number; team: number; total: number };
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fouls: number;
  diagnostics?: AccountingTeamDiagnostics | null;
}

export interface SideAccountingViolations {
  playerPointsTotal: number;
  /** (fgm - tpm) * 2 + tpm * 3 + ftm for the box. */
  pointsIdentity: number;
  pointsIdentityOk: boolean;
  makesExceed: Array<'fieldGoal' | 'three' | 'freeThrow'>;
  assistsExceedMade: boolean;
  reboundBucketsOk: boolean;
  reconciliations: Array<{ label: string; playerTotal: number; teamValue: number }>;
  reboundOpportunitiesOk: boolean;
  assistedUnassistedOk: boolean;
  contestedShotsOk: boolean;
  offensiveReboundChancesOk: boolean;
  zoneSplits: Array<{
    zone: string;
    playerAttempts: number;
    teamAttempts: number;
    playerMakes: number;
    teamMakes: number;
  }>;
  usageViolations: Array<{ playerKey: string; usage: number; identity: number }>;
  assistOpportunityViolations: Array<{
    playerKey: string;
    assistOpportunities: number;
    assists: number;
  }>;
}

/**
 * Audits one side's scoring/accounting identities against the box and team
 * zone summary. Players without diagnostics contribute nothing to the
 * per-player diagnostics checks, and a box without team diagnostics skips
 * the team-level diagnostic checks, matching both callers' guards.
 */
export function auditSideAccounting<P extends AccountingPlayerInput>(
  players: readonly P[],
  box: AccountingBoxInput,
  teamShotZones: readonly AccountingShotZones[],
  keyOf: (player: P) => string,
): SideAccountingViolations {
  const sumOf = (select: (p: P) => number): number =>
    players.reduce((acc, p) => acc + select(p), 0);
  const playerPointsTotal = sumOf((p) => p.points);

  const fgm = box.fieldGoals.made;
  const fga = box.fieldGoals.attempted;
  const tpm = box.threes.made;
  const tpa = box.threes.attempted;
  const ftm = box.freeThrows.made;
  const fta = box.freeThrows.attempted;
  const pointsIdentity = (fgm - tpm) * 2 + tpm * 3 + ftm;

  const makesExceed: SideAccountingViolations['makesExceed'] = [];
  if (fgm > fga) makesExceed.push('fieldGoal');
  if (tpm > tpa) makesExceed.push('three');
  if (ftm > fta) makesExceed.push('freeThrow');

  const reconciliations: SideAccountingViolations['reconciliations'] = [];
  const reconcile = (label: string, select: (p: P) => number, teamValue: number): void => {
    reconciliations.push({ label, playerTotal: sumOf(select), teamValue });
  };
  reconcile('fieldGoalMakes', (p) => p.fieldGoals.made, fgm);
  reconcile('fieldGoalAttempts', (p) => p.fieldGoals.attempted, fga);
  reconcile('threeMakes', (p) => p.threes.made, tpm);
  reconcile('threeAttempts', (p) => p.threes.attempted, tpa);
  reconcile('freeThrowMakes', (p) => p.freeThrows.made, ftm);
  reconcile('freeThrowAttempts', (p) => p.freeThrows.attempted, fta);
  reconcile('assists', (p) => p.assists, box.assists);
  reconcile('steals', (p) => p.steals, box.steals);
  reconcile('blocks', (p) => p.blocks, box.blocks);
  reconcile('turnovers', (p) => p.turnovers, box.turnovers);
  reconcile('fouls', (p) => p.fouls, box.fouls);
  reconcile('offensiveRebounds', (p) => p.rebounds.offensive, box.rebounds.offensive);
  reconcile('defensiveRebounds', (p) => p.rebounds.defensive, box.rebounds.defensive);

  const playerDiag = (select: (d: AccountingPlayerDiagnostics) => number): number =>
    players.reduce((acc, p) => acc + (p.diagnostics ? select(p.diagnostics) : 0), 0);

  const d = box.diagnostics;
  const misses = fga - fgm + (fta - ftm);
  let reboundOpportunitiesOk = true;
  let assistedUnassistedOk = true;
  let contestedShotsOk = true;
  let offensiveReboundChancesOk = true;
  if (d) {
    reboundOpportunitiesOk = d.reboundOpportunities === misses;
    assistedUnassistedOk = d.assistedFieldGoals + d.unassistedFieldGoals === fgm;
    contestedShotsOk = playerDiag((p) => p.contestedShots) === d.contestedShots;
    offensiveReboundChancesOk =
      playerDiag((p) => p.offensiveReboundChances) === d.reboundOpportunities * 5;
  }

  // Opportunity-level checks run only when at least one diagnostic exists
  // (the classic audit's guard; Season results always carry diagnostics).
  const hasAnyDiagnostics = Boolean(d) || players.some((p) => p.diagnostics);
  const zoneSplits: SideAccountingViolations['zoneSplits'] = [];
  const usageViolations: SideAccountingViolations['usageViolations'] = [];
  const assistOpportunityViolations: SideAccountingViolations['assistOpportunityViolations'] = [];
  if (hasAnyDiagnostics) {
    for (const zone of teamShotZones) {
      zoneSplits.push({
        zone: zone.zone,
        playerAttempts: playerDiag(
          (p) => p.shotZones.find((z) => z.zone === zone.zone)?.attempts ?? 0,
        ),
        teamAttempts: zone.attempts,
        playerMakes: playerDiag((p) => p.shotZones.find((z) => z.zone === zone.zone)?.makes ?? 0),
        teamMakes: zone.makes,
      });
    }
    for (const p of players) {
      if (!p.diagnostics) continue;
      const pd = p.diagnostics;
      const usageIdentity = usageOf(p.fieldGoals.attempted, p.freeThrows.attempted, p.turnovers);
      if (Math.abs(pd.usage - usageIdentity) > 0.6) {
        usageViolations.push({ playerKey: keyOf(p), usage: pd.usage, identity: usageIdentity });
      }
      if (pd.assistOpportunities < p.assists) {
        assistOpportunityViolations.push({
          playerKey: keyOf(p),
          assistOpportunities: pd.assistOpportunities,
          assists: p.assists,
        });
      }
    }
  }

  return {
    playerPointsTotal,
    pointsIdentity,
    pointsIdentityOk: box.points === pointsIdentity,
    makesExceed,
    assistsExceedMade: box.assists > fgm,
    reboundBucketsOk:
      box.rebounds.offensive + box.rebounds.defensive + box.rebounds.team === box.rebounds.total,
    reconciliations,
    reboundOpportunitiesOk,
    assistedUnassistedOk,
    contestedShotsOk,
    offensiveReboundChancesOk,
    zoneSplits,
    usageViolations,
    assistOpportunityViolations,
  };
}
