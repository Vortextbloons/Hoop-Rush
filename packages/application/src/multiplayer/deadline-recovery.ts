export class DeadlineRecovery {
  private state = { resolving: false, resolvedCursor: null as string | null, retryAtMs: 0 };

  reset(): void {
    this.state = { resolving: false, resolvedCursor: null, retryAtMs: 0 };
  }

  due(cursor: string, now: number): boolean {
    return (
      !this.state.resolving && this.state.resolvedCursor !== cursor && now >= this.state.retryAtMs
    );
  }

  async resolve(input: {
    cursor: string;
    current(): boolean;
    now(): number;
    retryMs: number;
    commit(): Promise<unknown>;
    resolveTimeout(): Promise<{ accepted?: boolean } | null>;
    sync(): Promise<void>;
  }): Promise<void> {
    if (!input.current() || !this.due(input.cursor, input.now())) return;
    const state = this.state;
    const current = (): boolean => input.current() && this.state === state;
    state.resolving = true;
    try {
      await input.commit();
      if (!current()) return;
      const receipt = await input.resolveTimeout();
      if (!current()) return;
      if (receipt?.accepted === true) state.resolvedCursor = input.cursor;
      else state.retryAtMs = input.now() + input.retryMs;
      await input.sync();
    } catch {
      if (current()) state.retryAtMs = input.now() + input.retryMs;
    } finally {
      state.resolving = false;
    }
  }
}
