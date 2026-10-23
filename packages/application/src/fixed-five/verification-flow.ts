import {
  contentHashSchema,
  type ContentHash,
  type FixedFiveCommandPayload,
  type FixedFiveVerificationReceipt,
} from '@hoop-rush/data-contracts';
import { buildFixedFiveVerificationInput, type RoomLogFacts } from '@hoop-rush/engine';
import { z } from 'zod';
import type {
  FixedFiveFlowContext,
  FixedFiveLocalResult,
  FixedFiveRoomSessionDeps,
  FixedFiveRoomSessionSnapshot,
  FixedFiveRunnerPort,
} from './session.ts';

const VERIFY_GUARD_PREFIX = 'hoop-rush:fixed-five:verify:';

interface VerificationHost {
  context(): FixedFiveFlowContext & {
    facts: RoomLogFacts;
    localResult: FixedFiveLocalResult | null;
  };
  isDisposed(): boolean;
  publish(): void;
  runAutoFlows(): void;
  sync(): Promise<void>;
  rerunSimulation(): Promise<void>;
  setBusyAction(action: string | null): void;
  setError(message: string): void;
  setNotice(message: string): void;
  advanceRevision(revision: number): void;
  sendCommand(payload: FixedFiveCommandPayload): Promise<boolean>;
}

type VerificationOutcome =
  | { kind: 'verified'; receipt: FixedFiveVerificationReceipt }
  | { kind: 'failed'; failures: string[] };

type ReceiptState =
  | { kind: 'empty' }
  | { kind: 'ready'; receipt: FixedFiveVerificationReceipt }
  | { kind: 'failed'; message: string; receipt: FixedFiveVerificationReceipt | null };

const verifyGuardSchema = z.object({
  submittedPropose: contentHashSchema.nullable().optional(),
  confirmedFor: contentHashSchema.nullable().optional(),
  reranMismatch: z.boolean().optional(),
  mismatchReported: z.boolean().optional(),
  receiptsUnsupported: z.boolean().optional(),
});

export function isMissingFunctionError(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e);
  if (/schema cache|PGRST202|404/.test(message)) return true;
  const code = typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : null;
  return code === 'PGRST202';
}

export class FixedFiveVerificationFlow {
  private verificationRunner: FixedFiveRunnerPort | null = null;
  private submittedPropose: ContentHash | null = null;
  private confirmedFor: ContentHash | null = null;
  private reranMismatch = false;
  private mismatchReported = false;
  private completedPairKey: string | null = null;
  private completeNotReady = false;
  private completeInFlight = false;
  private failSent = false;
  private receiptState: ReceiptState = { kind: 'empty' };
  private verificationInFlight = false;
  private submittedReceipt: string | null = null;
  private receiptSubmitInFlight = false;
  private receiptRebuilds = 0;
  private receiptsUnsupported = false;

  private readonly deps: Pick<
    FixedFiveRoomSessionDeps,
    'roomId' | 'transport' | 'createRunner' | 'guardStorage' | 'friendlyError'
  >;
  private readonly host: VerificationHost;

  constructor(
    deps: Pick<
      FixedFiveRoomSessionDeps,
      'roomId' | 'transport' | 'createRunner' | 'guardStorage' | 'friendlyError'
    >,
    host: VerificationHost,
  ) {
    this.deps = deps;
    this.host = host;
  }

  private get roomId() {
    return this.deps.roomId;
  }
  private get room() {
    return this.host.context().room;
  }
  private get assets() {
    return this.host.context().assets;
  }
  private get commands() {
    return this.host.context().commands;
  }
  private get selfId() {
    return this.host.context().selfId;
  }
  private get phase() {
    return this.host.context().phase;
  }
  private get facts() {
    return this.host.context().facts;
  }
  private get localResult() {
    return this.host.context().localResult;
  }

  private get verificationReceipt(): FixedFiveVerificationReceipt | null {
    return this.receiptState.kind === 'empty' ? null : this.receiptState.receipt;
  }

  private get verificationError(): string | null {
    return this.receiptState.kind === 'failed' ? this.receiptState.message : null;
  }

  private clearVerificationError(): void {
    const receipt = this.verificationReceipt;
    this.receiptState = receipt ? { kind: 'ready', receipt } : { kind: 'empty' };
  }

  private failVerification(message: string): void {
    this.receiptState = { kind: 'failed', message, receipt: this.verificationReceipt };
  }

  getSnapshot(): Pick<
    FixedFiveRoomSessionSnapshot,
    | 'receiptsUnsupported'
    | 'verificationReceipt'
    | 'verificationError'
    | 'verificationInFlight'
    | 'submittedReceipt'
    | 'submittedPropose'
    | 'confirmedFor'
    | 'reranMismatch'
    | 'mismatchReported'
    | 'completeNotReady'
  > {
    return {
      receiptsUnsupported: this.receiptsUnsupported,
      verificationReceipt: this.verificationReceipt,
      verificationError: this.verificationError,
      verificationInFlight: this.verificationInFlight,
      submittedReceipt: this.submittedReceipt,
      submittedPropose: this.submittedPropose,
      confirmedFor: this.confirmedFor,
      reranMismatch: this.reranMismatch,
      mismatchReported: this.mismatchReported,
      completeNotReady: this.completeNotReady,
    };
  }

  dispose(): void {
    this.verificationRunner?.dispose();
    this.verificationRunner = null;
  }

  resetResult(): void {
    this.receiptState = { kind: 'empty' };
    this.submittedReceipt = null;
    this.receiptRebuilds = 0;
  }

  tick(): void {
    this.maybeAutoVerify();
    this.maybeReportMismatch();
    this.maybePrepareReceipt();
    this.maybeStoreReceipt();
    this.maybeComplete();
    this.maybeFail();
  }

  canRetry(payload: FixedFiveCommandPayload): boolean {
    if (payload.kind === 'propose-result') {
      return this.localResult?.digest === payload.resultDigest;
    }
    const currentResult = this.localResult;
    if (payload.kind !== 'confirm-result' || !currentResult) return false;
    const freshForeign = this.facts.proposals.filter((proposal) => proposal.actor !== this.selfId);
    if (payload.verified) {
      return (
        currentResult.digest === payload.resultDigest &&
        freshForeign.some((proposal) => proposal.digest === payload.resultDigest)
      );
    }
    return (
      this.reranMismatch &&
      currentResult.digest !== payload.resultDigest &&
      freshForeign.some((proposal) => proposal.digest === payload.resultDigest) &&
      !freshForeign.some((proposal) => proposal.digest === currentResult.digest)
    );
  }

  enableReceipts(): void {
    this.receiptsUnsupported = false;
    this.completedPairKey = null;
    this.completeNotReady = false;
    this.saveVerifyGuards();
    this.host.setNotice('Server verification is available — continuing with receipt flow.');
  }

  retry(): void {
    if (this.host.isDisposed()) return;
    this.clearVerificationError();
    this.host.publish();
    this.maybePrepareReceipt();
  }

  async retryFinishing(): Promise<void> {
    if (this.host.isDisposed()) return;
    try {
      await this.deps.transport.verificationChallenge(this.roomId);
      if (this.host.isDisposed()) return;
      this.enableReceipts();
    } catch (e) {
      if (!isMissingFunctionError(e) && !this.host.isDisposed()) {
        this.host.setError(this.deps.friendlyError(e));
      }
      this.completedPairKey = null;
      this.completeNotReady = false;
    }
    if (this.host.isDisposed()) return;
    this.host.publish();
    this.host.runAutoFlows();
    await this.host.sync();
  }

  private maybeAutoVerify(): void {
    if (this.host.isDisposed() || !this.localResult || !this.room) return;
    if (this.phase !== 'awaiting-confirmation') return;
    const myDigest = this.localResult.digest;
    const proposals = this.facts.proposals;
    const foreign = proposals.filter((p) => p.actor !== this.selfId);
    const iProposed = proposals.some((p) => p.actor === this.selfId && p.digest === myDigest);
    const matchingProposal = proposals.some((p) => p.digest === myDigest);
    const iConfirmed = this.facts.confirms.some(
      (c) => c.actor === this.selfId && c.digest === myDigest && c.verified,
    );
    if (iProposed && this.submittedPropose !== myDigest) {
      this.submittedPropose = myDigest;
      this.saveVerifyGuards();
    }
    if (iConfirmed && this.confirmedFor !== myDigest) {
      this.confirmedFor = myDigest;
      this.saveVerifyGuards();
    }
    this.host.publish();
    if (iConfirmed) return;
    if (foreign.length === 0) {
      if (!matchingProposal && this.submittedPropose !== myDigest) {
        void this.proposeDigest(myDigest);
      } else if (matchingProposal && this.confirmedFor !== myDigest) {
        void this.confirmDigest(myDigest, true);
      }
      return;
    }
    const match = foreign.some((p) => p.digest === myDigest);
    if (match) {
      if (this.confirmedFor !== myDigest) void this.confirmDigest(myDigest, true);
      return;
    }
    if (!this.reranMismatch) {
      this.reranMismatch = true;
      this.saveVerifyGuards();
      void this.host.rerunSimulation();
    }
  }

  private maybeReportMismatch(): void {
    if (this.host.isDisposed() || !this.localResult || !this.room) return;
    if (!this.reranMismatch || this.mismatchReported) return;
    if (this.phase !== 'awaiting-confirmation') return;
    const myDigest = this.localResult.digest;
    const foreign = this.facts.proposals.filter((p) => p.actor !== this.selfId);
    if (foreign.some((p) => p.digest === myDigest)) return;
    if (foreign.length === 0) return;
    this.mismatchReported = true;
    this.saveVerifyGuards();
    this.host.publish();
    const first = foreign[0];
    const iDenied = first
      ? this.facts.confirms.some(
          (c) => c.actor === this.selfId && c.digest === first.digest && !c.verified,
        )
      : true;
    void (async () => {
      if (this.submittedPropose !== myDigest) await this.proposeDigest(myDigest);
      if (first && !iDenied) await this.confirmDigest(first.digest, false);
    })();
  }

  private maybePrepareReceipt(): void {
    if (
      this.host.isDisposed() ||
      !this.room ||
      !this.assets ||
      !this.localResult ||
      !this.room.rootSeed
    ) {
      return;
    }
    if (this.phase !== 'awaiting-confirmation') return;
    if (this.receiptsUnsupported) return;
    if (this.verificationReceipt || this.verificationError || this.verificationInFlight) return;
    const myDigest = this.localResult.digest;
    const ownConfirmed = this.facts.confirms.some(
      (c) => c.actor === this.selfId && c.digest === myDigest && c.verified,
    );
    const foreignConfirmed = this.facts.confirms.some(
      (c) => c.actor !== this.selfId && c.digest === myDigest && c.verified,
    );
    if (!ownConfirmed || !foreignConfirmed) return;
    void this.prepareReceipt();
  }

  private maybeStoreReceipt(): void {
    if (!this.verificationReceipt) return;
    if (this.submittedReceipt === this.verificationReceipt.receiptDigest) return;
    void this.storeReceipt(this.verificationReceipt);
  }

  private maybeComplete(): void {
    if (this.host.isDisposed() || !this.room || !this.localResult) return;
    if (this.phase !== 'awaiting-confirmation') return;
    if (!this.receiptsUnsupported) {
      const receipt = this.verificationReceipt;
      if (!receipt || receipt.resultDigest !== this.localResult.digest) return;
      if (this.submittedReceipt !== receipt.receiptDigest) return;
      if (this.confirmedFor !== receipt.resultDigest) return;
      const foreignVerified = this.facts.confirms.filter(
        (c) => c.actor !== this.selfId && c.digest === receipt.resultDigest && c.verified,
      );
      if (foreignVerified.length === 0) return;
      const pairKey = `receipt:${receipt.resultDigest}:${String(foreignVerified.length)}`;
      if (this.completedPairKey === pairKey) return;
      void this.runCompleteOnce(receipt.receiptDigest, pairKey);
      return;
    }
    if (!this.confirmedFor) return;
    const foreignVerified = this.facts.confirms.filter(
      (c) => c.actor !== this.selfId && c.digest === this.confirmedFor && c.verified,
    );
    if (foreignVerified.length === 0) return;
    const pairKey = `${this.confirmedFor}:${String(foreignVerified.length)}`;
    if (this.completedPairKey === pairKey) return;
    void this.runCompleteOnce(this.confirmedFor, pairKey);
  }

  private maybeFail(): void {
    if (this.host.isDisposed() || !this.room || this.failSent) return;
    if (
      this.phase === 'completed' ||
      this.phase === 'integrity-failed' ||
      this.phase === 'expired'
    ) {
      return;
    }
    const digests = new Set(this.facts.proposals.map((p) => p.digest));
    const denied = this.facts.confirms.some((c) => !c.verified);
    if (digests.size >= 2 && denied) {
      this.failSent = true;
      void this.attemptFail().then((failed) => {
        if (this.host.isDisposed()) return;
        if (!failed) {
          this.failSent = false;
          this.host.setNotice('Mismatch recorded — will retry marking the room once synced.');
          this.host.publish();
        }
      });
    }
  }

  private async proposeDigest(digest: ContentHash): Promise<void> {
    this.host.setBusyAction('propose');
    this.host.publish();
    try {
      const ok = await this.host.sendCommand({ kind: 'propose-result', resultDigest: digest });
      if (ok && !this.host.isDisposed()) {
        this.submittedPropose = digest;
        this.saveVerifyGuards();
        this.host.publish();
        this.host.runAutoFlows();
      }
    } finally {
      if (!this.host.isDisposed()) {
        this.host.setBusyAction(null);
        this.host.publish();
      }
    }
  }

  private async confirmDigest(digest: ContentHash, verified: boolean): Promise<void> {
    this.host.setBusyAction('confirm');
    this.host.publish();
    try {
      const ok = await this.host.sendCommand({
        kind: 'confirm-result',
        resultDigest: digest,
        verified,
      });
      if (ok && verified && !this.host.isDisposed()) {
        this.confirmedFor = digest;
        this.saveVerifyGuards();
        this.host.publish();
        this.host.runAutoFlows();
      }
    } finally {
      if (!this.host.isDisposed()) {
        this.host.setBusyAction(null);
        this.host.publish();
      }
    }
  }

  private async attemptComplete(receiptId: string): Promise<boolean> {
    this.host.setBusyAction('complete');
    this.host.publish();
    try {
      const out = await this.deps.transport.complete(this.roomId, receiptId);
      if (this.host.isDisposed()) return false;
      if (!out.completed) {
        this.host.setNotice('Completion not ready yet — waiting for the matching confirmation.');
        this.host.publish();
      }
      await this.host.sync();
      return out.completed;
    } catch (e) {
      if (!this.host.isDisposed()) this.host.setError(this.deps.friendlyError(e));
      return false;
    } finally {
      if (!this.host.isDisposed()) {
        this.host.setBusyAction(null);
        this.host.publish();
      }
    }
  }

  private async runCompleteOnce(receiptId: string, pairKey: string | null): Promise<void> {
    if (this.completeInFlight || this.host.isDisposed()) return;
    this.completeInFlight = true;
    if (pairKey) this.completedPairKey = pairKey;
    this.completeNotReady = false;
    this.host.publish();
    try {
      const done = await this.attemptComplete(receiptId);
      if (this.host.isDisposed()) return;
      this.completeNotReady = !done;
      this.host.publish();
    } finally {
      this.completeInFlight = false;
    }
  }

  private async attemptFail(): Promise<boolean> {
    this.host.setBusyAction('fail');
    this.host.publish();
    try {
      const out = await this.deps.transport.fail(this.roomId);
      await this.host.sync();
      return out.failed;
    } catch (e) {
      if (!this.host.isDisposed()) this.host.setError(this.deps.friendlyError(e));
      return false;
    } finally {
      if (!this.host.isDisposed()) {
        this.host.setBusyAction(null);
        this.host.publish();
      }
    }
  }

  private async prepareReceipt(): Promise<void> {
    if (this.verificationInFlight || !this.room || !this.assets || !this.localResult) return;
    if (!this.room.rootSeed) return;
    this.verificationInFlight = true;
    this.clearVerificationError();
    this.host.publish();
    try {
      const challenge = await this.deps.transport.verificationChallenge(this.roomId);
      if (this.host.isDisposed()) return;
      const current = this.host.context().localResult;
      if (!current) return;
      const input = buildFixedFiveVerificationInput({
        roomId: this.roomId,
        competition: this.room.settings.mode === 'duel' ? 'duel' : 'shared-82',
        rootSeed: this.room.rootSeed,
        versions: this.room.settings.versions,
        challenge,
        commands: this.commands,
        bracket: this.assets.bracket,
        profile: this.assets.profile,
        result: current.result,
        resultDigest: current.digest,
        p1: current.p1,
        p2: current.p2,
      });
      const outcome = await this.runVerification(input);
      if (this.host.isDisposed()) return;
      if (outcome.kind === 'failed') {
        this.failVerification(outcome.failures.join('; '));
        this.host.publish();
        return;
      }
      this.receiptState = { kind: 'ready', receipt: outcome.receipt };
      this.host.publish();
      void this.storeReceipt(outcome.receipt);
    } catch (e) {
      if (isMissingFunctionError(e)) {
        this.markReceiptsUnsupported();
      } else if (!this.host.isDisposed()) {
        this.failVerification(e instanceof Error ? e.message : String(e));
      }
    } finally {
      this.verificationInFlight = false;
      if (!this.host.isDisposed()) this.host.publish();
    }
  }

  private runVerification(
    input: Parameters<FixedFiveRunnerPort['verify']>[0],
  ): Promise<VerificationOutcome> {
    return new Promise((resolve) => {
      const active = this.deps.createRunner((event) => {
        if (
          event.kind === 'progress' ||
          event.kind === 'results' ||
          event.kind === 'duel-game' ||
          event.kind === 'shared82-h2h-game' ||
          event.kind === 'complete'
        ) {
          return;
        }
        active.dispose();
        if (this.verificationRunner === active) this.verificationRunner = null;
        if (event.kind === 'verified') {
          resolve({ kind: 'verified', receipt: event.receipt });
        } else if (event.kind === 'verification-failed') {
          resolve({ kind: 'failed', failures: event.failures });
        } else {
          resolve({ kind: 'failed', failures: [event.message] });
        }
      });
      this.verificationRunner = active;
      active.verify(input);
    });
  }

  private async storeReceipt(receipt: FixedFiveVerificationReceipt): Promise<void> {
    if (this.receiptSubmitInFlight || this.submittedReceipt === receipt.receiptDigest) return;
    this.receiptSubmitInFlight = true;
    try {
      const out = await this.deps.transport.submitVerification(
        this.roomId,
        receipt,
        this.room?.revision,
      );
      if (this.host.isDisposed()) return;
      this.submittedReceipt = out.receiptId;
      if (this.room && out.revision > this.room.revision) {
        this.host.advanceRevision(out.revision);
      }
      this.host.publish();
      this.host.runAutoFlows();
    } catch (e) {
      const rejection = e as {
        rejectionCode?: unknown;
        revision?: unknown;
      };
      if (
        typeof rejection.revision === 'number' &&
        this.room &&
        rejection.revision > this.room.revision
      ) {
        this.host.advanceRevision(rejection.revision);
      }
      if (rejection.rejectionCode === 'invalid-receipt' && this.receiptRebuilds < 2) {
        this.receiptRebuilds += 1;
        this.receiptState = { kind: 'empty' };
        if (!this.host.isDisposed()) {
          this.host.setNotice(
            'Verification receipt was rejected — rebuilding it from the accepted log.',
          );
        }
      } else if (rejection.rejectionCode === 'invalid-receipt') {
        if (!this.host.isDisposed()) {
          this.failVerification(
            'The server rejected the verification receipt for this accepted command log.',
          );
        }
      } else if (isMissingFunctionError(e)) {
        this.markReceiptsUnsupported();
      } else if (!this.host.isDisposed()) {
        this.host.setNotice(
          'Verification receipt is ready but not stored yet — retrying after the next sync.',
        );
      }
      this.host.publish();
      if (!this.host.isDisposed()) void this.host.sync();
    } finally {
      this.receiptSubmitInFlight = false;
    }
  }

  markReceiptsUnsupported(): void {
    if (this.receiptsUnsupported) return;
    this.receiptsUnsupported = true;
    this.clearVerificationError();
    this.saveVerifyGuards();
    if (!this.host.isDisposed()) {
      this.host.setNotice('Checking that both players have the same result.');
      this.host.publish();
      this.host.runAutoFlows();
    }
  }

  private verifyGuardStorageKey(): string {
    return `${VERIFY_GUARD_PREFIX}${this.roomId}`;
  }

  private saveVerifyGuards(): void {
    try {
      this.deps.guardStorage.save(
        this.verifyGuardStorageKey(),
        JSON.stringify({
          submittedPropose: this.submittedPropose,
          confirmedFor: this.confirmedFor,
          reranMismatch: this.reranMismatch,
          mismatchReported: this.mismatchReported,
          receiptsUnsupported: this.receiptsUnsupported,
        }),
      );
    } catch {}
  }

  restore(): void {
    try {
      const raw = this.deps.guardStorage.load(this.verifyGuardStorageKey());
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      const result = verifyGuardSchema.safeParse(parsed);
      if (!result.success) return;
      if (result.data.submittedPropose) this.submittedPropose = result.data.submittedPropose;
      if (result.data.confirmedFor) this.confirmedFor = result.data.confirmedFor;
      if (result.data.reranMismatch === true) this.reranMismatch = true;
      if (result.data.mismatchReported === true) this.mismatchReported = true;
    } catch {}
  }
}
