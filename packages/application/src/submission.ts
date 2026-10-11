export type SubmissionIntent =
  | 'fixed-five-command'
  | 'season-command'
  | 'season-block'
  | 'collection-command'
  | 'collection-pack-purchase';

export type SubmissionDisposition = 'accepted' | 'stale' | 'rejected';

export interface SubmissionPolicy {
  readonly intent: SubmissionIntent;
  /** How a stale submission is handled: retry after a resync, or surface it. */
  readonly conflict: 'resync-retry' | 'surface';
  /** Total attempts, including the first. Must be at least 1. */
  readonly maxAttempts: number;
  /** Whether the command carries state digests that gate the commit. */
  readonly requiresDigest: boolean;
}

export interface SubmissionAttempt<TCommand, TReceipt> {
  submit(command: TCommand): Promise<TReceipt>;
  classify(receipt: TReceipt): SubmissionDisposition;
  /** Classify a thrown error. Return null to rethrow it unchanged. */
  classifyError?(error: unknown): SubmissionDisposition | null;
  /** Dynamic gate evaluated after a resync, before a retry is issued. */
  canRetry?(receipt: TReceipt): boolean;
  /** Rebuild the command against fresh state. Return null to stop retrying. */
  revise?(command: TCommand, receipt: TReceipt): TCommand | null;
  resync?(): Promise<void>;
}

export interface SubmissionReport<TReceipt> {
  disposition: SubmissionDisposition;
  receipt: TReceipt | null;
  error: unknown;
  attempts: number;
  retried: boolean;
}

export async function runSubmission<TCommand, TReceipt>(
  policy: SubmissionPolicy,
  command: TCommand,
  attempt: SubmissionAttempt<TCommand, TReceipt>,
): Promise<SubmissionReport<TReceipt>> {
  let current = command;
  let attempts = 0;
  let retried = false;
  for (;;) {
    attempts += 1;
    let receipt: TReceipt;
    try {
      receipt = await attempt.submit(current);
    } catch (error) {
      const disposition = attempt.classifyError?.(error) ?? null;
      if (disposition === null) throw error;
      return { disposition, receipt: null, error, attempts, retried };
    }
    const disposition = attempt.classify(receipt);
    if (disposition !== 'stale' || policy.conflict !== 'resync-retry') {
      return { disposition, receipt, error: null, attempts, retried };
    }
    if (attempts >= policy.maxAttempts) {
      return { disposition, receipt, error: null, attempts, retried };
    }
    if (attempt.resync !== undefined) await attempt.resync();
    if (attempt.canRetry !== undefined && !attempt.canRetry(receipt)) {
      return { disposition, receipt, error: null, attempts, retried };
    }
    const revised = attempt.revise?.(current, receipt) ?? null;
    if (revised === null) {
      return { disposition, receipt, error: null, attempts, retried };
    }
    current = revised;
    retried = true;
  }
}
