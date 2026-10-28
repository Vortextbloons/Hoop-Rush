import type {
  CapRushCard,
  CapRushDraftState,
  CapRushPayrollStatus,
  CapRushSourcePlayer,
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

export interface CapRushDraftView {
  readonly draft: CapRushDraftState;
  readonly payrollDollars: number;
  readonly hardLimitDollars: number;
  readonly remainingRoomDollars: number;
  readonly status: CapRushPayrollStatus;
  readonly cards: readonly CapRushCardView[];
  readonly slots: readonly CapRushSlotView[];
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
  abandonDraft(): Promise<void>;
}
