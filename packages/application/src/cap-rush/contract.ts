import type {
  CapRushApronTriggerTotals,
  CapRushCard,
  CapRushConferenceStandings,
  CapRushDraftState,
  CapRushFranchiseAssignment,
  CapRushGameSummary,
  CapRushHistoryEntry,
  CapRushLeagueGame,
  CapRushLeagueResult,
  CapRushPayrollStatus,
  CapRushPlayoffGameSummary,
  CapRushPostseason,
  CapRushReport,
  CapRushSeasonAggregate,
  CapRushSourcePlayer,
  CapRushSpinPurchaseId,
  CapRushSpinState,
  CapRushStoredGame,
  CapRushStoredPlayoffGame,
  CapRushVariant,
  OpponentBracket,
  Position,
} from '@hoop-rush/data-contracts';
import type {
  CapRushConferencePostseasonStep,
  CapRushPostseasonStep,
  CapRushSigningAssessment,
} from '@hoop-rush/engine';

export type CapRushAnyPostseasonStep = CapRushPostseasonStep | CapRushConferencePostseasonStep;

export type CapRushServiceErrorCode =
  'invalid-phase' | 'unsupported-version' | 'storage' | 'catalog' | 'command' | 'audit-failure';

export class CapRushServiceError extends Error {
  readonly code: CapRushServiceErrorCode;
  constructor(code: CapRushServiceErrorCode, message: string) {
    super(message);
    this.name = 'CapRushServiceError';
    this.code = code;
  }
}

export interface CapRushCardView {
  readonly card: CapRushCard;
  readonly signing: CapRushSigningAssessment;
}

export interface CapRushSlotView {
  readonly slot: Position;
  readonly player: CapRushSourcePlayer | null;
  readonly salaryDollars: number;
  readonly highestPaid: boolean;
}

export interface CapRushSpinTargetView {
  readonly pickOrdinal: number;
  readonly cardId: string;
  readonly slot: Position;
  readonly player: CapRushSourcePlayer;
  readonly salaryDollars: number;
}

export interface CapRushSpinPurchaseView {
  readonly purchase: CapRushSpinPurchaseId;
  readonly priceDollars: number;
  readonly maxEligiblePayrollDollars: number;
  readonly eligible: boolean;
  readonly tierOdds: Readonly<Record<1 | 2 | 3, number>>;
}

export interface CapRushSpinView {
  readonly state: CapRushSpinState;
  readonly targets: readonly CapRushSpinTargetView[];
  readonly purchases: readonly CapRushSpinPurchaseView[];
}

export interface CapRushSeasonView {
  readonly games: readonly CapRushGameSummary[];
  readonly aggregate: CapRushSeasonAggregate;
  readonly apronTriggers: CapRushApronTriggerTotals;
  readonly completedAt: string | null;
  readonly nextGameNumber: number;
  readonly leagueGamesAccepted: number;
  readonly leagueGamesTotal: number;
}

export interface CapRushDraftView {
  readonly draft: CapRushDraftState;
  readonly franchise: CapRushFranchiseAssignment | null;
  readonly payrollDollars: number;
  readonly hardLimitDollars: number;
  readonly remainingRoomDollars: number;
  readonly status: CapRushPayrollStatus;
  readonly cards: readonly CapRushCardView[];
  readonly slots: readonly CapRushSlotView[];
  readonly spin: CapRushSpinView | null;
  readonly canLock: boolean;
  readonly season: CapRushSeasonView | null;
  readonly postseason: CapRushPostseason | null;
}

export interface CapRushSnapshot {
  readonly draft: CapRushDraftView | null;
}

export interface CapRushAcceptedGame {
  readonly cursor: number;
  readonly inputDigest: string;
  readonly resultDigest: string;
  readonly isolations: number;
  readonly strikes: number;
  readonly summary: CapRushGameSummary;
  readonly stored: CapRushStoredGame;
  readonly leagueGames?: readonly CapRushLeagueGame[];
}

export interface CapRushAcceptedPlayoffGame {
  readonly summary: CapRushPlayoffGameSummary;
  readonly stored: CapRushStoredPlayoffGame;
}

export interface CapRushService {
  loadActive(): Promise<CapRushSnapshot>;
  getSnapshot(): CapRushSnapshot;
  createDraft(variant: CapRushVariant): Promise<void>;
  choosePosition(slot: Position): Promise<void>;
  rerollOffer(protectedCardId: string): Promise<void>;
  signCard(cardId: string): Promise<void>;
  purchaseSpin(purchase: CapRushSpinPurchaseId, targetCardId: string): Promise<void>;
  skipSpin(): Promise<void>;
  lockLineup(): Promise<void>;
  updatePlayback(game: number | string, cursor: number, resolved: boolean): Promise<void>;
  acceptGame(game: CapRushAcceptedGame): Promise<void>;
  acceptLeagueGames(slot: number, leagueGames: readonly CapRushLeagueGame[]): Promise<void>;
  finalizeSeason(): Promise<CapRushReport | null>;
  acceptStandings(league: CapRushLeagueResult): Promise<void>;
  acceptConferenceStandings(standings: CapRushConferenceStandings): Promise<void>;
  acceptPlayoffGame(game: CapRushAcceptedPlayoffGame): Promise<void>;
  finalizePostseason(): Promise<CapRushReport>;
  postseasonStep(): CapRushAnyPostseasonStep;
  loadBracket(): Promise<OpponentBracket>;
  loadReport(runId: string): Promise<CapRushReport | null>;
  listHistory(): Promise<readonly CapRushHistoryEntry[]>;
  listRunGames(runId: string): Promise<readonly CapRushStoredGame[]>;
  listPlayoffGames(runId: string): Promise<readonly CapRushStoredPlayoffGame[]>;
  listLeagueGames(runId: string): Promise<readonly CapRushLeagueGame[]>;
  abandonDraft(): Promise<void>;
}
