export class CoalescedTask {
  private running: Promise<void> | null = null;
  private queued = false;
  private readonly task: () => Promise<void>;

  constructor(task: () => Promise<void>) {
    this.task = task;
  }

  private hasQueued(): boolean {
    return this.queued;
  }

  request(): Promise<void> {
    if (this.running !== null) {
      this.queued = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.queued = false;
        await this.task();
      } while (this.hasQueued());
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }
}
