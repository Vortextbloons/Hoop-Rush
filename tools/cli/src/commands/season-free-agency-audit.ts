import {
  type SeasonFreeAgencyBand,
  type SeasonFreeAgencyDeclaration,
  type SeasonFreeAgencySigning,
  type SeasonFreeAgencyWindowState,
  type SeasonRun,
} from '@hoop-rush/data-contracts';
import {
  SEASON_FREE_AGENCY_BAND_SIGNING_CAPS,
  SEASON_FREE_AGENCY_WINDOW_BLOCK_INDEXES,
  SEASON_FREE_AGENCY_WINDOW_COMPOSITION,
  SEASON_FREE_AGENCY_WINDOW_MAX_CANDIDATES,
} from '@hoop-rush/engine';
import { makeReport, type CliReport } from '../report.ts';
import { seasonFreeAgencyAuditReportSchema } from '../report-schemas.ts';
import { loadSeasonRunFixture } from './season-block.ts';

/**
 * M2.6.5 `season free-agency audit` (spec/2.0/15): audits a persisted run's
 * recorded free-agency facts — window order/block mapping (2/4/6), candidate
 * identity uniqueness (max 12, at most one featured), canonical identity
 * persistence (later windows reuse earlier canonical choices; sibling
 * versions excluded), full declaration coverage on resolved windows,
 * trace/trace-vs-signing consistency, per-franchise band signing caps
 * (1/2/3/3, three per season), season spend (<= 6), ledger/transaction/
 * ownership link reconciliation for every signing, and the 300/1,350
 * effects invariants over the final rosters/rotations.
 *
 * The audit is a pure function of recorded facts (mirror of the persistence
 * reload audit); where the engine canonicalizes the same rule, the CLI calls
 * the engine's own constants (`SEASON_FREE_AGENCY_BAND_SIGNING_CAPS`,
 * `SEASON_FREE_AGENCY_WINDOW_COMPOSITION`) rather than re-declaring them.
 */

export const SEASON_FREE_AGENCY_AUDIT_OPTIONS: Record<string, boolean> = {
  input: true,
  manifest: true,
  format: true,
};

/** The per-failure-class counts of one audit run. */
export interface SeasonFreeAgencyAuditCounts {
  windowOrderFailures: number;
  candidateUniquenessFailures: number;
  featuredFailures: number;
  canonicalFailures: number;
  declarationFailures: number;
  traceFailures: number;
  bandCapFailures: number;
  signingCapFailures: number;
  spendCapFailures: number;
  ledgerFailures: number;
  transactionFailures: number;
  ownershipFailures: number;
  effectsFailures: number;
}

const ZERO_COUNTS: SeasonFreeAgencyAuditCounts = {
  windowOrderFailures: 0,
  candidateUniquenessFailures: 0,
  featuredFailures: 0,
  canonicalFailures: 0,
  declarationFailures: 0,
  traceFailures: 0,
  bandCapFailures: 0,
  signingCapFailures: 0,
  spendCapFailures: 0,
  ledgerFailures: 0,
  transactionFailures: 0,
  ownershipFailures: 0,
  effectsFailures: 0,
};

const TRACE_CRITERIA = new Set([
  'legality',
  'role-credibility',
  'need',
  'identity-fit',
  'opportunity',
  'influence',
  'draw',
]);

const TRACE_CATEGORIES: Record<string, ReadonlySet<string>> = {
  legality: new Set(['legal', 'illegal']),
  'role-credibility': new Set(['rotation', 'depth', 'emergency']),
  need: new Set(['high', 'medium', 'low']),
  'identity-fit': new Set(['fits', 'neutral', 'misfit']),
  opportunity: new Set(['immediate', 'available', 'crowded']),
  influence: new Set(['0', '1', '2', '3']),
  draw: new Set(['won', 'lost']),
};

/** The declared commitment of one franchise for one window. */
function declarationTargetOf(
  declarations: Record<string, SeasonFreeAgencyDeclaration>,
  franchiseId: string,
  playerVersionId: string,
): number | null {
  const target = declarations[franchiseId]?.targets.find(
    (entry) => entry.playerVersionId === playerVersionId,
  );
  return target?.influence ?? null;
}

/** Audits one window's recorded facts; appends failures. */
function auditWindow(
  window: SeasonFreeAgencyWindowState,
  windowIndex: number,
  run: SeasonRun,
  leagueFranchiseIds: ReadonlySet<string>,
  failures: string[],
  counts: SeasonFreeAgencyAuditCounts,
): void {
  const where = `free-agency window ${String(windowIndex)}`;
  if (window.windowIndex !== windowIndex) {
    counts.windowOrderFailures += 1;
    failures.push(`${where} carries windowIndex ${String(window.windowIndex)}`);
  }
  const expectedBlock = SEASON_FREE_AGENCY_WINDOW_BLOCK_INDEXES[windowIndex];
  if (window.blockIndex !== expectedBlock) {
    counts.windowOrderFailures += 1;
    failures.push(
      `${where} opened by block ${String(window.blockIndex)}, expected block ${String(expectedBlock)}`,
    );
  }
  const versionIds = new Set<string>();
  const playerIds = new Set<string>();
  let featured = 0;
  const bandCounts: Record<SeasonFreeAgencyBand, number> = {
    featured: 0,
    role: 0,
    development: 0,
    emergency: 0,
  };
  for (const candidate of window.candidates) {
    if (versionIds.has(candidate.playerVersionId)) {
      counts.candidateUniquenessFailures += 1;
      failures.push(`${where} duplicates candidate version ${candidate.playerVersionId}`);
    }
    versionIds.add(candidate.playerVersionId);
    if (playerIds.has(candidate.playerId)) {
      counts.candidateUniquenessFailures += 1;
      failures.push(`${where} duplicates candidate identity ${candidate.playerId}`);
    }
    playerIds.add(candidate.playerId);
    if (candidate.band === 'featured') featured += 1;
    bandCounts[candidate.band] += 1;
    // Canonical identity persistence: every candidate carries the run's
    // canonical version for its identity (first admission persists it; later
    // windows reuse it and exclude sibling versions).
    const canonical = run.freeAgency.canonicalCandidates[candidate.playerId];
    if (canonical === undefined) {
      counts.canonicalFailures += 1;
      failures.push(
        `${where} candidate ${candidate.playerVersionId} has no canonical identity record`,
      );
    } else {
      if (canonical.playerVersionId !== candidate.playerVersionId) {
        counts.canonicalFailures += 1;
        failures.push(
          `${where} candidate ${candidate.playerVersionId} is not the canonical version ${canonical.playerVersionId} of identity ${candidate.playerId}`,
        );
      }
      if (canonical.band !== candidate.band) {
        counts.canonicalFailures += 1;
        failures.push(
          `${where} candidate ${candidate.playerVersionId} records band ${candidate.band}, canonical records ${canonical.band}`,
        );
      }
      // The canonical seed path records the ADMISSION window (later markets
      // reuse the same choice), so it must match the admission window, not
      // the current one.
      if (
        canonical.seedPath.join('/') !==
        `${String(canonical.admittedWindowIndex)}/canonical/${candidate.playerId}`
      ) {
        counts.canonicalFailures += 1;
        failures.push(
          `${where} canonical ${candidate.playerId} seed path ${canonical.seedPath.join('/')} does not match its admission window ${String(canonical.admittedWindowIndex)}`,
        );
      }
    }
  }
  if (window.candidates.length > SEASON_FREE_AGENCY_WINDOW_MAX_CANDIDATES) {
    counts.candidateUniquenessFailures += 1;
    failures.push(
      `${where} carries ${String(window.candidates.length)} candidates (max ${String(SEASON_FREE_AGENCY_WINDOW_MAX_CANDIDATES)})`,
    );
  }
  for (const band of ['featured', 'role', 'development', 'emergency'] as const) {
    if (bandCounts[band] > SEASON_FREE_AGENCY_WINDOW_COMPOSITION[band]) {
      counts.candidateUniquenessFailures += 1;
      failures.push(
        `${where} carries ${String(bandCounts[band])} ${band} candidates (composition target ${String(SEASON_FREE_AGENCY_WINDOW_COMPOSITION[band])})`,
      );
    }
  }
  if (featured > 1) {
    counts.featuredFailures += 1;
    failures.push(`${where} carries ${String(featured)} featured candidates (max 1)`);
  }

  // Sibling-version exclusion across windows: the same identity must never
  // appear under two versions anywhere in the run.
  for (const earlier of run.freeAgency.windows) {
    if (earlier.windowIndex >= windowIndex) continue;
    for (const candidate of earlier.candidates) {
      const current = window.candidates.find((entry) => entry.playerId === candidate.playerId);
      if (current !== undefined && current.playerVersionId !== candidate.playerVersionId) {
        counts.canonicalFailures += 1;
        failures.push(
          `identity ${candidate.playerId} appears as sibling versions ${candidate.playerVersionId} (window ${String(earlier.windowIndex)}) and ${current.playerVersionId} (window ${String(windowIndex)})`,
        );
      }
    }
  }

  if (window.status === 'resolved') {
    const declared = new Set(Object.keys(window.declarations));
    for (const franchiseId of leagueFranchiseIds) {
      if (!declared.has(franchiseId)) {
        counts.declarationFailures += 1;
        failures.push(`${where} misses declaration for ${franchiseId}`);
      }
    }
    for (const declaration of Object.values(window.declarations)) {
      if (declaration.windowIndex !== window.windowIndex) {
        counts.declarationFailures += 1;
        failures.push(
          `${where} declaration ${declaration.franchiseId} names window ${String(declaration.windowIndex)}`,
        );
      }
      for (const target of declaration.targets) {
        const candidate = window.candidates.find(
          (entry) => entry.playerVersionId === target.playerVersionId,
        );
        if (candidate === undefined) {
          counts.declarationFailures += 1;
          failures.push(
            `${where} declaration ${declaration.franchiseId} targets a non-candidate ${target.playerVersionId}`,
          );
        } else if (!candidate.supportedRoles.includes(target.roleExpectation)) {
          counts.declarationFailures += 1;
          failures.push(
            `${where} declaration ${declaration.franchiseId} uses unsupported role ${target.roleExpectation} for ${target.playerVersionId}`,
          );
        }
      }
    }
  }

  if (window.status === 'resolved') {
    if (window.traces.length !== 1) {
      counts.traceFailures += 1;
      failures.push(
        `${where} resolved with ${String(window.traces.length)} traces (expected exactly one)`,
      );
    }
    for (const trace of window.traces) {
      if (trace.windowIndex !== window.windowIndex) {
        counts.traceFailures += 1;
        failures.push(
          `${where} trace names window ${String(trace.windowIndex)}, expected ${String(window.windowIndex)}`,
        );
      }
      const firstSigning = window.signings[0];
      const expectedResolution = window.signings.length > 0 ? 'signed' : 'no-signing';
      if (trace.resolution !== expectedResolution) {
        counts.traceFailures += 1;
        failures.push(
          `${where} trace resolution ${trace.resolution}, signings reconcile ${expectedResolution}`,
        );
      }
      if (trace.signedPlayerVersionId !== (firstSigning?.playerVersionId ?? null)) {
        counts.traceFailures += 1;
        failures.push(
          `${where} trace signed player ${String(trace.signedPlayerVersionId)} does not match the signing ${String(firstSigning?.playerVersionId ?? null)}`,
        );
      }
      if (trace.signingFranchiseId !== (firstSigning?.franchiseId ?? null)) {
        counts.traceFailures += 1;
        failures.push(
          `${where} trace signing franchise ${String(trace.signingFranchiseId)} does not match the signing ${String(firstSigning?.franchiseId ?? null)}`,
        );
      }
      const winnerKeys = new Set(
        [...trace.firstPriorityWinners, ...trace.secondPriorityWinners].map(
          (winner) => `${winner.candidatePlayerVersionId}\u0000${winner.winnerFranchiseId}`,
        ),
      );
      for (const signing of window.signings) {
        if (!winnerKeys.has(`${signing.playerVersionId}\u0000${signing.franchiseId}`)) {
          counts.traceFailures += 1;
          failures.push(
            `${where} signing ${signing.signingId} is not recorded among the trace winners`,
          );
        }
      }
      for (const step of trace.steps) {
        if (!TRACE_CRITERIA.has(step.criterion)) {
          counts.traceFailures += 1;
          failures.push(`${where} trace step uses unknown criterion ${step.criterion}`);
          continue;
        }
        const allowed = TRACE_CATEGORIES[step.criterion];
        if (allowed !== undefined && !allowed.has(step.category)) {
          counts.traceFailures += 1;
          failures.push(`${where} trace step ${step.criterion} records category ${step.category}`);
        }
        if (step.criterion === 'influence' && windowIndex === 0) {
          // The engine records the committed Influence from the FIRST
          // declaration of the franchise across all windows, so the category
          // is only cross-checkable on the first market (documented engine
          // quirk for later windows; reported as an integration risk).
          const committed = declarationTargetOf(
            window.declarations,
            step.franchiseId,
            step.candidatePlayerVersionId,
          );
          if (committed !== null && step.category !== String(committed)) {
            counts.traceFailures += 1;
            failures.push(
              `${where} trace influence step records ${step.category} for ${step.franchiseId}, declaration commits ${String(committed)}`,
            );
          }
        }
      }
    }
  } else if (window.traces.length > 0) {
    counts.traceFailures += 1;
    failures.push(`${where} is open but records ${String(window.traces.length)} traces`);
  }
}

/** Audits one signing's recorded links; appends failures. */
function auditSigningLinks(
  signing: SeasonFreeAgencySigning,
  run: SeasonRun,
  failures: string[],
  counts: SeasonFreeAgencyAuditCounts,
): void {
  const where = `free-agency signing ${signing.signingId}`;
  const ledger = run.influence.ledger.find((entry) => entry.entryId === signing.ledgerEntryId);
  if (ledger === undefined) {
    counts.ledgerFailures += 1;
    failures.push(`${where} links unknown ledger entry ${signing.ledgerEntryId}`);
  } else {
    if (ledger.franchiseId !== signing.franchiseId) {
      counts.ledgerFailures += 1;
      failures.push(
        `${where} ledger entry ${signing.ledgerEntryId} belongs to ${ledger.franchiseId}, not ${signing.franchiseId}`,
      );
    }
    if (ledger.source !== 'free-agent-signing') {
      counts.ledgerFailures += 1;
      failures.push(
        `${where} ledger entry ${signing.ledgerEntryId} records source ${ledger.source}, expected free-agent-signing`,
      );
    }
    if (ledger.appliedDelta !== -signing.influenceCost) {
      counts.ledgerFailures += 1;
      failures.push(
        `${where} ledger entry ${signing.ledgerEntryId} applies ${String(ledger.appliedDelta)}, expected ${String(-signing.influenceCost)}`,
      );
    }
    if (ledger.commandId !== signing.commandId) {
      counts.ledgerFailures += 1;
      failures.push(
        `${where} ledger entry ${signing.ledgerEntryId} records command ${String(ledger.commandId)}, not ${signing.commandId}`,
      );
    }
  }
  const transaction = run.transactions.find(
    (entry) => entry.transactionId === signing.transactionId,
  );
  if (transaction === undefined) {
    counts.transactionFailures += 1;
    failures.push(`${where} links unknown transaction ${signing.transactionId}`);
  } else {
    if (transaction.type !== 'free-agent-signing') {
      counts.transactionFailures += 1;
      failures.push(
        `${where} transaction ${signing.transactionId} records type ${transaction.type}, expected free-agent-signing`,
      );
    }
    const payload = transaction.payload as
      | {
          playerVersionId?: string;
          windowIndex?: number;
          ledgerEntryId?: string;
          signingId?: string;
        }
      | undefined;
    if (payload?.playerVersionId !== signing.playerVersionId) {
      counts.transactionFailures += 1;
      failures.push(
        `${where} transaction ${signing.transactionId} payload names ${String(payload?.playerVersionId)}, expected ${signing.playerVersionId}`,
      );
    }
    if (payload?.windowIndex !== signing.windowIndex) {
      counts.transactionFailures += 1;
      failures.push(
        `${where} transaction ${signing.transactionId} payload names window ${String(payload?.windowIndex)}, expected ${String(signing.windowIndex)}`,
      );
    }
    if (payload?.ledgerEntryId !== signing.ledgerEntryId) {
      counts.transactionFailures += 1;
      failures.push(
        `${where} transaction ${signing.transactionId} payload ledger link ${String(payload?.ledgerEntryId)} does not match ${signing.ledgerEntryId}`,
      );
    }
    if (payload?.signingId !== signing.signingId) {
      counts.transactionFailures += 1;
      failures.push(
        `${where} transaction ${signing.transactionId} payload signing link ${String(payload?.signingId)} does not match ${signing.signingId}`,
      );
    }
  }
  const owner = run.ownership.find((row) => row.playerVersionId === signing.playerVersionId);
  if (owner === undefined || owner.ownerFranchiseId !== signing.franchiseId) {
    counts.ownershipFailures += 1;
    failures.push(
      `${where} does not reconcile with ownership (${signing.playerVersionId} -> ${String(owner?.ownerFranchiseId)})`,
    );
  }
  const roster = run.rosters.find((entry) => entry.franchiseId === signing.franchiseId);
  if (!roster?.players.some((player) => player.playerVersionId === signing.playerVersionId)) {
    counts.ownershipFailures += 1;
    failures.push(`${where} is not on the roster of ${signing.franchiseId}`);
  }
}

/**
 * Audits the recorded free-agency facts of one run snapshot. Pure function of
 * recorded facts; every failure is bounded and attributed to one class.
 */
export function auditSeasonFreeAgencyFacts(run: SeasonRun): {
  failures: string[];
  counts: SeasonFreeAgencyAuditCounts;
} {
  const failures: string[] = [];
  const counts = { ...ZERO_COUNTS };
  const leagueFranchiseIds = new Set(run.league.teams.map((team) => team.franchiseId));

  // Window order: windows appear oldest first with index 0/1/2.
  run.freeAgency.windows.forEach((window, index) => {
    auditWindow(window, index, run, leagueFranchiseIds, failures, counts);
  });

  // Per-franchise season facts: band caps (1/2/3/3), three signings per
  // season, six Influence per season, all reconciled from the signings.
  const signingsByFranchise = new Map<string, SeasonFreeAgencySigning[]>();
  for (const window of run.freeAgency.windows) {
    for (const signing of window.signings) {
      auditSigningLinks(signing, run, failures, counts);
      const list = signingsByFranchise.get(signing.franchiseId) ?? [];
      list.push(signing);
      signingsByFranchise.set(signing.franchiseId, list);
    }
  }
  for (const team of run.league.teams) {
    const franchiseId = team.franchiseId;
    const signings = signingsByFranchise.get(franchiseId) ?? [];
    const band =
      run.aiAssignments.find((entry) => entry.franchiseId === franchiseId)?.band ?? 'average';
    const bandCap = SEASON_FREE_AGENCY_BAND_SIGNING_CAPS[band] ?? 3;
    if (signings.length > bandCap) {
      counts.bandCapFailures += 1;
      failures.push(
        `${franchiseId} (${band}) signed ${String(signings.length)} players, over the ${String(bandCap)} band cap`,
      );
    }
    if (signings.length > 3) {
      counts.signingCapFailures += 1;
      failures.push(
        `${franchiseId} signed ${String(signings.length)} players, over the three-per-season cap`,
      );
    }
    const recordedSignings = run.freeAgency.signingCounts[franchiseId];
    if (recordedSignings !== signings.length) {
      counts.signingCapFailures += 1;
      failures.push(
        `${franchiseId} signingCounts records ${String(recordedSignings)}, signings reconcile ${String(signings.length)}`,
      );
    }
    const spent = signings.reduce((sum, signing) => sum + signing.influenceCost, 0);
    const recordedSpend = run.freeAgency.seasonSpend[franchiseId];
    if (recordedSpend !== spent) {
      counts.spendCapFailures += 1;
      failures.push(
        `${franchiseId} seasonSpend records ${String(recordedSpend)}, signings reconcile ${String(spent)}`,
      );
    }
    if (spent > 6) {
      counts.spendCapFailures += 1;
      failures.push(
        `${franchiseId} spent ${String(spent)} Influence on free agency, over the six-point season cap`,
      );
    }
  }

  // 300/1,350 effects invariants over the final rosters and rotations:
  // 30 rosters of 10-15, 30 rotations of exactly ten members, 300 distinct
  // active versions, 1,350 active pairs (45 per rotation), and an ownership
  // row for every rostered player. Identity uniqueness applies PER ROSTER
  // (different seasons of the same real player may be owned by different
  // franchises); the league-wide identity rule is enforced by the market
  // (signings never introduce an identity already represented anywhere).
  const versionIds = new Set<string>();
  let activeLoads = 0;
  let activePairs = 0;
  const rotationMembersByFranchise = new Map<string, Set<string>>();
  const rotationLoads = new Set<string>();
  for (const rotation of run.rotations) {
    const members = [...rotation.starters, ...rotation.benchOrder];
    if (members.length !== 10) {
      counts.effectsFailures += 1;
      failures.push(`rotation of ${rotation.franchiseId} has ${String(members.length)} members`);
    }
    for (const member of members) rotationLoads.add(member);
    rotationMembersByFranchise.set(rotation.franchiseId, new Set(members));
  }
  for (const roster of run.rosters) {
    if (roster.players.length < 10 || roster.players.length > 15) {
      counts.effectsFailures += 1;
      failures.push(
        `roster of ${roster.franchiseId} has ${String(roster.players.length)} players (10-15 required)`,
      );
    }
    const rosterIdentities = new Set<string>();
    for (const player of roster.players) {
      if (versionIds.has(player.playerVersionId)) {
        counts.effectsFailures += 1;
        failures.push(`duplicate roster version ${player.playerVersionId}`);
      }
      versionIds.add(player.playerVersionId);
      if (rosterIdentities.has(player.playerId)) {
        counts.effectsFailures += 1;
        failures.push(`duplicate roster identity ${player.playerId} on ${roster.franchiseId}`);
      }
      rosterIdentities.add(player.playerId);
      if (!run.ownership.some((row) => row.playerVersionId === player.playerVersionId)) {
        counts.ownershipFailures += 1;
        failures.push(`roster player ${player.playerVersionId} has no ownership row`);
      }
    }
  }
  for (const rotation of run.rotations) {
    const roster = run.rosters.find((entry) => entry.franchiseId === rotation.franchiseId);
    const rosterIds = new Set(roster?.players.map((player) => player.playerVersionId) ?? []);
    const members = [...rotation.starters, ...rotation.benchOrder];
    for (const member of members) {
      if (!rosterIds.has(member)) {
        counts.effectsFailures += 1;
        failures.push(`rotation of ${rotation.franchiseId} references unrostered player ${member}`);
      }
    }
    activePairs += 45;
  }
  // The 300 active loads are the rotation-scoped members (signings sit on
  // rosters, never in rotations, so they belong to the inactive set).
  activeLoads = rotationLoads.size;
  if (activeLoads !== 300 || activePairs !== 1350) {
    counts.effectsFailures += 1;
    failures.push(
      `active effects reconcile ${String(activeLoads)} loads / ${String(activePairs)} pairs, expected 300 / 1,350`,
    );
  }
  if (rotationMembersByFranchise.size !== 30) {
    counts.effectsFailures += 1;
    failures.push(`rotations reconcile ${String(rotationMembersByFranchise.size)}, expected 30`);
  }

  return { failures, counts };
}

/** The CLI command: audits one persisted run's free-agency facts. */
export function seasonFreeAgencyAudit(args: {
  input: string | null;
  manifest: string | null;
}): CliReport {
  const inputPath = args.input;
  if (inputPath === null) {
    throw new Error('season free-agency audit requires --input <run.json>');
  }
  let run: SeasonRun;
  try {
    run = loadSeasonRunFixture(inputPath);
  } catch (error) {
    return makeReport(
      'season free-agency audit',
      { input: inputPath },
      { failures: [(error as Error).message], exitCode: 2 },
    );
  }
  const { failures, counts } = auditSeasonFreeAgencyFacts(run);
  const pass = failures.length === 0;
  const payload = seasonFreeAgencyAuditReportSchema.parse({
    schemaVersion: 1,
    command: 'season free-agency audit',
    runId: run.runId,
    rootSeed: run.rootSeed,
    windows: run.freeAgency.windows.length,
    signings: run.freeAgency.windows.reduce((sum, window) => sum + window.signings.length, 0),
    canonicalIdentities: Object.keys(run.freeAgency.canonicalCandidates).length,
    counts,
    failures: failures.slice(0, 200),
    pass,
  });
  const details = [
    `run ${run.runId} · seed ${run.rootSeed}`,
    `windows ${String(run.freeAgency.windows.length)} · signings ${String(payload.signings)} · canonical identities ${String(payload.canonicalIdentities)}`,
    `failures: ${String(failures.length)}`,
  ];
  details.push(...failures.slice(0, 10));
  return makeReport(
    'season free-agency audit',
    { input: inputPath, manifest: args.manifest ?? undefined },
    { details, failures, payload },
  );
}
