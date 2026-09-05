import { usageOf } from './recorder.ts';
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
export interface AccountingPlayerInput {
  points: number;
  fieldGoals: {
    made: number;
    attempted: number;
  };
  threes: {
    made: number;
    attempted: number;
  };
  freeThrows: {
    made: number;
    attempted: number;
  };
  rebounds: {
    offensive: number;
    defensive: number;
  };
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fouls: number;
  diagnostics?: AccountingPlayerDiagnostics | null;
  deepFours?: { made: number; attempted: number } | null;
}
export interface AccountingBoxInput {
  points: number;
  fieldGoals: {
    made: number;
    attempted: number;
  };
  threes: {
    made: number;
    attempted: number;
  };
  freeThrows: {
    made: number;
    attempted: number;
  };
  rebounds: {
    offensive: number;
    defensive: number;
    team: number;
    total: number;
  };
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fouls: number;
  deepFours?: { made: number; attempted: number } | null;
  diagnostics?: AccountingTeamDiagnostics | null;
}
export interface SideAccountingViolations {
  playerPointsTotal: number;
  makesExceed: Array<'fieldGoal' | 'three' | 'freeThrow' | 'deepFour'>;
  pointsIdentity: number;
  pointsIdentityOk: boolean;
  assistsExceedMade: boolean;
  reboundBucketsOk: boolean;
  reconciliations: Array<{
    label: string;
    playerTotal: number;
    teamValue: number;
  }>;
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
  usageViolations: Array<{
    playerKey: string;
    usage: number;
    identity: number;
  }>;
  assistOpportunityViolations: Array<{
    playerKey: string;
    assistOpportunities: number;
    assists: number;
  }>;
}
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
  const d4m = box.deepFours?.made ?? 0;
  const d4a = box.deepFours?.attempted ?? 0;
  const pointsIdentity = (fgm - tpm - d4m) * 2 + tpm * 3 + d4m * 4 + ftm;
  const makesExceed: SideAccountingViolations['makesExceed'] = [];
  if (fgm > fga) makesExceed.push('fieldGoal');
  if (tpm > tpa) makesExceed.push('three');
  if (ftm > fta) makesExceed.push('freeThrow');
  if (d4m > d4a) makesExceed.push('deepFour');
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
  reconcile('deepFourMakes', (p) => p.deepFours?.made ?? 0, d4m);
  reconcile('deepFourAttempts', (p) => p.deepFours?.attempted ?? 0, d4a);
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
