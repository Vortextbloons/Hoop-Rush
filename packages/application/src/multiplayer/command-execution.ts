import {
  runSubmission,
  type SubmissionAttempt,
  type SubmissionPolicy,
  type SubmissionReport,
} from '../submission.ts';
import { canonicalJson } from '@hoop-rush/data-contracts';

export class CommandRecovery {
  private readonly pending = new Map<string, string>();

  id(payload: unknown, create: () => string): string {
    const key = canonicalJson(payload);
    const existing = this.pending.get(key);
    if (existing !== undefined) return existing;
    const id = create();
    this.pending.set(key, id);
    return id;
  }

  settled(payload: unknown): void {
    this.pending.delete(canonicalJson(payload));
  }

  reset(): void {
    this.pending.clear();
  }
}

export const MULTIPLAYER_SINGLE_ATTEMPT_POLICY = {
  intent: 'multiplayer-command',
  conflict: 'surface',
  maxAttempts: 1,
  requiresDigest: false,
} as const satisfies SubmissionPolicy;

export async function executeMultiplayerCommand<
  const TCommand extends { commandId: string },
  TReceipt,
>(
  command: TCommand,
  attempt: SubmissionAttempt<TCommand, TReceipt>,
  policy: SubmissionPolicy = MULTIPLAYER_SINGLE_ATTEMPT_POLICY,
): Promise<SubmissionReport<TReceipt>> {
  const revise = attempt.revise?.bind(attempt);
  return runSubmission(policy, command, {
    ...attempt,
    revise:
      revise === undefined
        ? undefined
        : (current, receipt) => {
            const revised = revise(current, receipt);
            if (revised !== null && revised.commandId !== command.commandId) {
              throw new Error('A multiplayer retry must retain its command ID.');
            }
            return revised;
          },
  });
}
