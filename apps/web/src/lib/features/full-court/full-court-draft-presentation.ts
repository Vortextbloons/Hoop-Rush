import type {
  CapRushPayrollStatus,
  CapRushSourcePlayer,
  FullCourtDraftState,
  FullCourtMoneyConfig,
  PlayersIndex,
  PlayersIndexEntry,
  Position,
} from '@hoop-rush/data-contracts';
import {
  FULL_COURT_MAX_ROSTER_SIZE,
  FULL_COURT_MIN_ROSTER_SIZE,
  fullCourtCrAmount,
} from '@hoop-rush/data-contracts';
import {
  fullCourtAbsenceTolerance,
  fullCourtAssessPick,
  fullCourtDepthForecast,
  fullCourtPayrollDollars,
  fullCourtPayrollStatus,
  fullCourtSalaryDollarsOf,
  fullCourtWarChestDollars,
  type FullCourtCatalogIndex,
} from '@hoop-rush/engine';
import { formatMillions } from '#lib/features/cap-rush/cap-rush-presentation.js';
import { capRushProfileSamples } from '#lib/features/cap-rush/cap-rush-player-profile.js';
import {
  buildPlayerProfileReferences,
  type PlayerProfileReferences,
} from '#lib/players/player-profile.js';

export const FULL_COURT_CATALOG_PAGE_SIZE = 24;

const profileReferencesCache = new WeakMap<FullCourtCatalogIndex, PlayerProfileReferences>();

type FullCourtPickAssessment = ReturnType<typeof fullCourtAssessPick>;

export interface FullCourtDraftSummary {
  readonly rosterCount: number;
  readonly minimumRosterSize: number;
  readonly maximumRosterSize: number;
  readonly payrollDollars: number;
  readonly payrollRoomDollars: number;
  readonly status: CapRushPayrollStatus;
  readonly spentDollars: number;
  readonly warChestDollars: number;
  readonly canPick: boolean;
  readonly canFinish: boolean;
  readonly absenceTolerance: number;
  readonly depthForecastDollars: number | null;
}

export function fullCourtDraftSummary(
  draft: FullCourtDraftState,
  index: FullCourtCatalogIndex,
): FullCourtDraftSummary {
  const rosterCount = draft.picks.length;
  const payrollDollars = fullCourtPayrollDollars(draft.picks);
  const warChestDollars = fullCourtWarChestDollars(draft);
  const depthForecast = fullCourtDepthForecast({ index, state: draft });
  return {
    rosterCount,
    minimumRosterSize: FULL_COURT_MIN_ROSTER_SIZE,
    maximumRosterSize: FULL_COURT_MAX_ROSTER_SIZE,
    payrollDollars,
    payrollRoomDollars: draft.money.hardLimitDollars - payrollDollars,
    status: fullCourtPayrollStatus(payrollDollars, draft.money),
    spentDollars: draft.money.startingWarChestDollars - warChestDollars,
    warChestDollars,
    canPick: draft.stage === 'drafting' && rosterCount < FULL_COURT_MAX_ROSTER_SIZE,
    canFinish: draft.stage === 'drafting' && rosterCount >= FULL_COURT_MIN_ROSTER_SIZE,
    absenceTolerance: fullCourtAbsenceTolerance(rosterCount),
    depthForecastDollars: depthForecast.costDollars,
  };
}

export function fullCourtVariantLabel(draft: FullCourtDraftState): string {
  return draft.variant === 'roulette' ? 'Full Court Roulette' : 'Full Court Standard';
}

export interface FullCourtCatalogRow {
  readonly player: CapRushSourcePlayer;
  readonly salaryDollars: number;
  readonly assessment: FullCourtPickAssessment;
  readonly statusAfterPick: CapRushPayrollStatus;
  readonly onRoster: boolean;
  readonly playerRostered: boolean;
}

export interface FullCourtCatalogQuery {
  readonly search?: string;
  readonly position?: Position | null;
  readonly limit?: number;
  readonly offset?: number;
}

export interface FullCourtCatalogPage {
  readonly rows: readonly FullCourtCatalogRow[];
  readonly total: number;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function matchesCatalogQuery(
  player: CapRushSourcePlayer,
  search: string,
  position: Position | null,
): boolean {
  if (position !== null && !player.positions.includes(position)) return false;
  return search === '' || player.displayName.toLowerCase().includes(search);
}

/**
 * Filters and sorts the catalog, then prices only the rows that will render. Completion
 * affordability is evaluated with the engine's assessment, not re-derived here.
 */
export function fullCourtCatalogPage(
  index: FullCourtCatalogIndex,
  draft: FullCourtDraftState,
  query: FullCourtCatalogQuery = {},
): FullCourtCatalogPage {
  const search = (query.search ?? '').trim().toLowerCase();
  const position = query.position ?? null;
  const limit = Math.max(0, Math.trunc(query.limit ?? FULL_COURT_CATALOG_PAGE_SIZE));
  const offset = Math.max(0, Math.trunc(query.offset ?? 0));
  const matched = index.catalog.candidates
    .filter((player) => matchesCatalogQuery(player, search, position))
    .sort(
      (left, right) =>
        right.originalOverall - left.originalOverall ||
        compareText(left.displayName, right.displayName) ||
        compareText(left.seasonKey, right.seasonKey) ||
        compareText(left.playerVersionId, right.playerVersionId),
    );
  const rosterPlayerIds = new Set(draft.picks.map((pick) => pick.player.playerId));
  const rosterVersionIds = new Set(draft.picks.map((pick) => pick.player.playerVersionId));
  const rows = matched.slice(offset, offset + limit).map((player): FullCourtCatalogRow => {
    const salaryDollars = fullCourtSalaryDollarsOf(player);
    const assessment = fullCourtAssessPick({
      index,
      state: draft,
      playerId: player.playerId,
      salaryDollars,
    });
    return {
      player,
      salaryDollars,
      assessment,
      statusAfterPick: fullCourtPayrollStatus(assessment.payrollAfterPick, draft.money),
      onRoster: rosterVersionIds.has(player.playerVersionId),
      playerRostered: rosterPlayerIds.has(player.playerId),
    };
  });
  return { rows, total: matched.length };
}

const APRON_SHIFT_LABELS: Readonly<Record<CapRushPayrollStatus, string>> = {
  'under-cap': 'the cap line',
  'first-apron': 'the first apron',
  'second-apron': 'the second apron',
  illegal: 'the hard limit',
};

export interface FullCourtSigningImpact {
  /** Payroll after this signing, formatted like every other money figure. */
  readonly payrollAfter: string;
  /** Hard-limit payroll room left after this signing. */
  readonly roomAfter: string;
  /** War Chest left after paying this salary. */
  readonly warChestAfter: string;
  /** Apron line this signing crosses, or null when the roster's tier holds. */
  readonly apronShift: string | null;
}

/**
 * The cost of one signing, priced entirely by the engine's assessment so the card,
 * the roster panel, and the season's apron reductions can never disagree.
 */
export function fullCourtSigningImpact(
  row: FullCourtCatalogRow,
  money: FullCourtMoneyConfig,
): FullCourtSigningImpact {
  const payrollBefore = row.assessment.payrollAfterPick - row.salaryDollars;
  const statusBefore = fullCourtPayrollStatus(payrollBefore, money);
  const statusAfter = fullCourtPayrollStatus(row.assessment.payrollAfterPick, money);
  return {
    payrollAfter: formatMillions(row.assessment.payrollAfterPick),
    roomAfter: formatMillions(money.hardLimitDollars - row.assessment.payrollAfterPick),
    warChestAfter: formatWarChestCr(row.assessment.warChestAfterPick),
    apronShift: statusAfter === statusBefore ? null : `Crosses ${APRON_SHIFT_LABELS[statusAfter]}`,
  };
}

export function fullCourtPickReasonLabel(
  assessment: FullCourtPickAssessment,
  money: FullCourtMoneyConfig,
): string | null {
  if (assessment.legal) return null;
  switch (assessment.reason) {
    case 'phase-mismatch':
      return 'Roster locked';
    case 'roster-full':
      return 'Roster full';
    case 'duplicate-player':
      return 'Already rostered';
    case 'hard-limit':
      return `Over the ${formatMillions(money.hardLimitDollars)} hard limit`;
    case 'cash':
      return assessment.warChestAfterPick < 0
        ? 'War Chest short'
        : 'Leaves too little War Chest to finish';
    case 'completion':
      return assessment.projectedPayroll === null
        ? 'No legal finish'
        : `Cheapest finish ${formatMillions(assessment.projectedPayroll)}`;
  }
}

export function formatWarChestCr(dollars: number): string {
  const amount = Math.round(fullCourtCrAmount(dollars) * 10) / 10;
  return `${String(amount)} CR`;
}

export interface FullCourtLockCopy {
  /** Seal shown once the roster is locked; null before that. */
  readonly stamp: string | null;
  readonly headline: string;
  readonly detail: string;
}

/**
 * The lock step is the last decision of draft night, so its copy states the
 * exact payroll, room, and War Chest that freeze on confirm.
 */
export function fullCourtLockCopy(
  draft: FullCourtDraftState,
  summary: FullCourtDraftSummary,
): FullCourtLockCopy {
  if (draft.stage === 'complete') {
    return {
      stamp: 'Locked',
      headline: 'Draft complete',
      detail: `${String(summary.rosterCount)} players on ${formatMillions(summary.payrollDollars)} payroll, ${formatWarChestCr(summary.warChestDollars)} War Chest left. Every salary is fixed for the run.`,
    };
  }
  if (!summary.canFinish) {
    const remaining = summary.minimumRosterSize - summary.rosterCount;
    return {
      stamp: null,
      headline: 'Add before locking',
      detail: `${String(remaining)} more ${remaining === 1 ? 'signing' : 'signings'} reaches the ${String(summary.minimumRosterSize)}-player minimum.`,
    };
  }
  const filled = summary.rosterCount >= summary.maximumRosterSize;
  return {
    stamp: null,
    headline: filled ? 'Roster is full' : 'Lock the roster',
    detail: `${String(summary.rosterCount)} players, ${formatMillions(summary.payrollDollars)} payroll, ${formatWarChestCr(summary.warChestDollars)} War Chest left. ${filled ? 'Lock to freeze every salary.' : 'Unused places are skipped and every salary freezes.'}`,
  };
}

/**
 * Percentile cohorts for the panel, built from the same packaged draft catalog
 * and sample shape Cap Rush uses, so both modes rank a player against the same
 * pool. `buildPlayerProfileReferences` still enforces its own minimum cohort
 * size, so a thin position falls back to an unranked profile.
 */
export function fullCourtProfileReferences(index: FullCourtCatalogIndex): PlayerProfileReferences {
  const cached = profileReferencesCache.get(index);
  if (cached !== undefined) return cached;
  const references = buildPlayerProfileReferences(capRushProfileSamples(index.catalog.candidates));
  profileReferencesCache.set(index, references);
  return references;
}

export function fullCourtFaceKey(
  player: Pick<CapRushSourcePlayer, 'playerId' | 'franchiseId' | 'eraId' | 'seasonKey'>,
): string {
  return `${player.playerId}\u0000${player.franchiseId}\u0000${player.eraId}\u0000${player.seasonKey}`;
}

export function fullCourtFaceIndex(
  playersIndex: PlayersIndex,
): ReadonlyMap<string, PlayersIndexEntry> {
  const faces = new Map<string, PlayersIndexEntry>();
  for (const entry of playersIndex.players) {
    const key = fullCourtFaceKey(entry);
    if (!faces.has(key)) faces.set(key, entry);
  }
  return faces;
}
