import { errorMessageOf } from '#lib/errors.js';

export function postWorkerMessage<Output>(
  schema: { parse: (value: unknown) => Output },
  message: Output,
): void {
  schema.parse(message);
  self.postMessage(message);
}

export function workerErrorMessage(error: unknown): string {
  return errorMessageOf(error);
}

export function normalizeSimulationError(message: string): string {
  return message.replace(/ failed invariants: [\s\S]*$/, ' failed invariants');
}

export function normalizeShared82SimulationError(message: string): string {
  return normalizeSimulationError(message).replace(
    /^shared82 (?:p1|p2) game (\d+) failed invariants$/,
    'shared82 game $1 failed invariants',
  );
}

export function listenForWorkerReplies<T extends { requestId: string }>(
  worker: Worker,
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  requestId: string,
  receive: (message: T) => void,
  invalid: () => void,
  crashed: () => void,
): void {
  const onmessage = (event: MessageEvent<unknown>) => {
    if (worker.onmessage !== onmessage) return;
    const parsed = schema.safeParse(event.data);
    if (!parsed.success) invalid();
    else if (parsed.data.requestId === requestId) receive(parsed.data);
  };
  worker.onmessage = onmessage;
  worker.onerror = () => {
    if (worker.onmessage === onmessage) crashed();
  };
}

export function stopWorker(worker: Worker | null): void {
  if (worker === null) return;
  worker.onmessage = null;
  worker.onerror = null;
  worker.terminate();
}
