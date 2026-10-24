import { describe, expect, it, vi } from 'bun:test';
import { runSubmission, type SubmissionPolicy } from './index.ts';

const RETRY_POLICY: SubmissionPolicy = {
  intent: 'fixed-five-command',
  conflict: 'resync-retry',
  maxAttempts: 3,
};

const SURFACE_POLICY: SubmissionPolicy = {
  intent: 'multiplayer-command',
  conflict: 'surface',
  maxAttempts: 1,
};

const SURFACE_ERROR_POLICY: SubmissionPolicy = {
  intent: 'multiplayer-command',
  conflict: 'surface',
  maxAttempts: 1,
};

interface FakeReceipt {
  accepted: boolean;
  rejectionCode: string | null;
  revision: number;
}

function classifyReceipt(receipt: FakeReceipt) {
  if (receipt.accepted) return 'accepted' as const;
  return receipt.rejectionCode === 'stale-revision' ? ('stale' as const) : ('rejected' as const);
}

const noopResync = (): Promise<void> => Promise.resolve();
const staleReceipt = (revision: number): FakeReceipt => ({
  accepted: false,
  rejectionCode: 'stale-revision',
  revision,
});

describe('runSubmission', () => {
  it('returns an accepted receipt without resyncing', async () => {
    const submit = vi.fn((): Promise<FakeReceipt> =>
      Promise.resolve({ accepted: true, rejectionCode: null, revision: 1 }),
    );
    const resync = vi.fn(noopResync);
    const report = await runSubmission(
      RETRY_POLICY,
      { expectedRevision: 0 },
      {
        submit,
        classify: classifyReceipt,
        resync,
      },
    );
    expect(report.disposition).toBe('accepted');
    expect(report.attempts).toBe(1);
    expect(report.retried).toBe(false);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(resync).not.toHaveBeenCalled();
  });

  it('never retries a stale receipt under a surface policy', async () => {
    const submit = vi.fn((): Promise<FakeReceipt> => Promise.resolve(staleReceipt(2)));
    const resync = vi.fn(noopResync);
    const report = await runSubmission(
      SURFACE_POLICY,
      {},
      {
        submit,
        classify: classifyReceipt,
        resync,
      },
    );
    expect(report.disposition).toBe('stale');
    expect(report.receipt?.revision).toBe(2);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(resync).not.toHaveBeenCalled();
  });

  it('resyncs, gates, then retries with a revised command', async () => {
    const revisions = [5, 6];
    const submit = vi.fn((): Promise<FakeReceipt> => {
      const revision = revisions.shift() ?? 6;
      const accepted = revision === 6;
      return Promise.resolve({
        accepted,
        rejectionCode: accepted ? null : 'stale-revision',
        revision,
      });
    });
    const resync = vi.fn(noopResync);
    const report = await runSubmission(
      RETRY_POLICY,
      { expectedRevision: 4 },
      {
        submit,
        classify: classifyReceipt,
        resync,
        canRetry: () => true,
        revise: (command, receipt) => ({ ...command, expectedRevision: receipt.revision }),
      },
    );
    expect(report.disposition).toBe('accepted');
    expect(report.retried).toBe(true);
    expect(resync).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit).toHaveBeenLastCalledWith({ expectedRevision: 5 });
  });

  it('resyncs before evaluating the dynamic retry gate', async () => {
    const order: string[] = [];
    const report = await runSubmission(
      RETRY_POLICY,
      {},
      {
        submit: (): Promise<FakeReceipt> => {
          order.push('submit');
          return Promise.resolve(staleReceipt(3));
        },
        classify: classifyReceipt,
        resync: (): Promise<void> => {
          order.push('resync');
          return Promise.resolve();
        },
        canRetry: () => {
          order.push('gate');
          return false;
        },
        revise: () => ({}),
      },
    );
    expect(order).toEqual(['submit', 'resync', 'gate']);
    expect(report.disposition).toBe('stale');
    expect(report.retried).toBe(false);
  });

  it('stops after maxAttempts', async () => {
    const submit = vi.fn((): Promise<FakeReceipt> => Promise.resolve(staleReceipt(9)));
    const report = await runSubmission(
      RETRY_POLICY,
      {},
      {
        submit,
        classify: classifyReceipt,
        resync: noopResync,
        canRetry: () => true,
        revise: () => ({}),
      },
    );
    expect(report.disposition).toBe('stale');
    expect(report.retried).toBe(true);
    expect(report.attempts).toBe(RETRY_POLICY.maxAttempts);
    expect(submit).toHaveBeenCalledTimes(RETRY_POLICY.maxAttempts);
  });

  it('classifies thrown stale errors via classifyError', async () => {
    const stale = new Error('stale multiplayer state');
    const report = await runSubmission(
      SURFACE_ERROR_POLICY,
      {},
      {
        submit: () => Promise.reject(stale),
        classify: () => 'accepted',
        classifyError: (error) => (error === stale ? 'stale' : null),
      },
    );
    expect(report.disposition).toBe('stale');
    expect(report.receipt).toBeNull();
    expect(report.error).toBe(stale);
  });

  it('rethrows when classifyError returns null', async () => {
    const fatal = new Error('boom');
    await expect(
      runSubmission(
        SURFACE_ERROR_POLICY,
        {},
        {
          submit: () => Promise.reject(fatal),
          classify: () => 'accepted',
          classifyError: () => null,
        },
      ),
    ).rejects.toBe(fatal);
  });
});
