import { parseBidDollars } from './cap-rush-multiplayer-presentation.js';

export type BidDraftMode = 'minimum' | 'custom';

export class CapRushBidDraft {
  minimumDollars = $state(0);
  mode = $state<BidDraftMode>('minimum');
  text = $state('');

  constructor(minimumDollars = 0) {
    this.minimumDollars = minimumDollars;
  }

  get followsMinimum(): boolean {
    return this.mode === 'minimum';
  }

  get proposedTotal(): number | null {
    return this.mode === 'minimum' ? this.minimumDollars : parseBidDollars(this.text);
  }

  get empty(): boolean {
    return this.mode === 'custom' && this.text.trim() === '';
  }

  get malformed(): boolean {
    return this.mode === 'custom' && this.text.trim() !== '' && this.proposedTotal === null;
  }

  get stale(): boolean {
    const total = this.proposedTotal;
    return this.mode === 'custom' && total !== null && total < this.minimumDollars;
  }

  get valid(): boolean {
    const total = this.proposedTotal;
    return total !== null && total >= this.minimumDollars && total > 0;
  }

  reset(minimumDollars: number): void {
    this.minimumDollars = minimumDollars;
    this.mode = 'minimum';
    this.text = '';
  }

  adoptMinimum(minimumDollars: number): void {
    this.minimumDollars = minimumDollars;
  }

  useMinimum(): void {
    this.mode = 'minimum';
    this.text = '';
  }

  adjust(deltaDollars: number): void {
    this.setTotal(
      Math.max(this.minimumDollars, (this.proposedTotal ?? this.minimumDollars) + deltaDollars),
    );
  }

  setTotal(totalDollars: number): void {
    this.mode = 'custom';
    this.text = String(totalDollars);
  }

  setText(text: string): void {
    this.mode = 'custom';
    this.text = text;
  }
}
