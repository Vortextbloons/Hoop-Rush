export class CoalescedTask {
  private running = false;
  private queued = false;
  private readonly task: () => Promise<void>;

  constructor(task: () => Promise<void>) {
    this.task = task;
  }

  request(): Promise<void> {
    if (this.running) {
      this.queued = true;
      return Promise.resolve();
    }
    this.running = true;
    return this.task().finally(() => {
      this.running = false;
      if (this.queued) {
        this.queued = false;
        void this.request();
      }
    });
  }
}
