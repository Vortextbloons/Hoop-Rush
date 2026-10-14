export class DataThrottle<T> {
  #last = Number.NEGATIVE_INFINITY;
  #pending: T | undefined;
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly apply: (value: T) => void,
    private readonly intervalMs = 150,
  ) {}

  push(value: T): void {
    this.#pending = value;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - this.#last >= this.intervalMs) {
      this.#flush();
      return;
    }
    if (this.#timer === null) {
      const wait = Math.max(0, this.intervalMs - (now - this.#last));
      this.#timer = setTimeout(() => {
        this.#timer = null;
        this.#flush();
      }, wait);
    }
  }

  #flush(): void {
    if (this.#pending === undefined) return;
    const value = this.#pending;
    this.#pending = undefined;
    this.#last = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.apply(value);
  }

  cancel(): void {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    this.#pending = undefined;
  }
}

export function progressTickIntervalMs(lite: boolean): number {
  return lite ? 400 : 120;
}
