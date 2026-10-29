import type {
  CapRushCard,
  CapRushDraftState,
  CapRushPayrollStatus,
  CapRushSourcePlayer,
  CapRushSpinPurchaseId,
  CapRushSpinState,
  CapRushVariant,
  Position,
} from '@hoop-rush/data-contracts';
import type { CapRushSigningAssessment } from '@hoop-rush/engine';

export type CapRushServiceErrorCode =
  'invalid-phase' | 'unsupported-version' | 'storage' | 'catalog' | 'command';

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

export interface CapRushDraftView {
  readonly draft: CapRushDraftState;
  readonly payrollDollars: number;
  readonly hardLimitDollars: number;
  readonly remainingRoomDollars: number;
  readonly status: CapRushPayrollStatus;
  readonly cards: readonly CapRushCardView[];
  readonly slots: readonly CapRushSlotView[];
  readonly spin: CapRushSpinView | null;
}

export interface CapRushSnapshot {
  readonly draft: CapRushDraftView | null;
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
  abandonDraft(): Promise<void>;
}
