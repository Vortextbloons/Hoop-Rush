export type SubmissionIntent =
  'fixed-five-command' | 'multiplayer-command' | 'collection-command' | 'collection-pack-purchase';

export type SubmissionDisposition = 'accepted' | 'stale' | 'rejected';

export interface SubmissionPolicy {
  readonly intent: SubmissionIntent;
  readonly conflict: 'resync-retry' | 'surface';
  readonly maxAttempts: number;
  readonly requiresDigest: boolean;
}

export interface SubmissionAttempt<TCommand, TReceipt> {
  submit(command: TCommand): Promise<TReceipt>;
  classify(receipt: TReceipt): SubmissionDisposition;
  classifyError?(error: unknown): SubmissionDisposition | null;
  canRetry?(receipt: TReceipt): boolean;
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
