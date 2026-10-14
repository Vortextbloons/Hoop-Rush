export class SessionEvents<TEvent> {
  private readonly snapshotListeners = new Set<() => void>();
  private readonly transientListeners = new Set<(event: TEvent) => void>();
  private subscriptions: Array<{ unsubscribe: () => void }> = [];

  subscribe(listener: () => void): () => void {
    this.snapshotListeners.add(listener);
    return () => {
      this.snapshotListeners.delete(listener);
    };
  }

  subscribeTransient(listener: (event: TEvent) => void): () => void {
    this.transientListeners.add(listener);
    return () => {
      this.transientListeners.delete(listener);
    };
  }

  track(subscription: { unsubscribe: () => void }): void {
    this.subscriptions.push(subscription);
  }

  publish(): void {
    for (const listener of this.snapshotListeners) listener();
  }

  emitTransient(event: TEvent): void {
    for (const listener of this.transientListeners) listener(event);
  }

  dispose(): void {
    for (const subscription of this.subscriptions) {
      subscription.unsubscribe();
    }
    this.subscriptions = [];
    this.snapshotListeners.clear();
    this.transientListeners.clear();
  }
}
