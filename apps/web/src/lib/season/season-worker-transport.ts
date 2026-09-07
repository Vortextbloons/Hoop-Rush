export function createWorkerListeners<TEvent>() {
  const listeners = new Set<(event: TEvent) => void>();
  const emit = (event: TEvent): void => {
    for (const listener of [...listeners]) listener(event);
  };
  const subscribe = (listener: (event: TEvent) => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const clear = (): void => {
    listeners.clear();
  };
  return { emit, subscribe, clear };
}
export interface WorkerWarmState {
  warmRequestId: string | null;
  warmed: boolean;
}
export function createWorkerWarmState(): WorkerWarmState & {
  beginWarm: (requestId: string) => boolean;
  finishWarm: (requestId: string) => void;
  reset: () => void;
} {
  const state: WorkerWarmState = { warmRequestId: null, warmed: false };
  return {
    ...state,
    beginWarm(requestId: string): boolean {
      if (state.warmRequestId !== null || state.warmed) return false;
      state.warmRequestId = requestId;
      return true;
    },
    finishWarm(requestId: string): void {
      if (state.warmRequestId === requestId) state.warmRequestId = null;
      state.warmed = true;
    },
    reset(): void {
      state.warmRequestId = null;
      state.warmed = false;
    },
  };
}
export function createWorkerHolder(getFallbackUrl: () => URL, workerUrl?: string) {
  let worker: Worker | null = null;
  const create = (): Worker => {
    if (worker !== null) return worker;
    worker =
      workerUrl !== undefined
        ? new Worker(workerUrl, { type: 'module' })
        : new Worker(getFallbackUrl(), { type: 'module' });
    return worker;
  };
  const terminate = (): void => {
    worker?.terminate();
    worker = null;
  };
  const get = (): Worker | null => worker;
  return { create, terminate, get };
}
