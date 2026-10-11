import {
  HAVOC_WORKER_WIRE_SCHEMA_VERSION,
  havocWorkerMessageSchema,
  havocWorkerRequestSchema,
  type HavocWorkerErrorCode,
  type HavocWorkerSimulateRequest,
  type HavocWorkerTapeRequest,
} from '@hoop-rush/data-contracts';
import {
  auditHavocGame,
  buildHavocGameInput,
  createEngineContext,
  havocGameResultDigest,
  havocGameSummaryOf,
  havocGameTapeDigest,
  simulateHavocGame,
} from '@hoop-rush/engine';
import { sleep } from '../lib/sleep';

const engineContext = createEngineContext();
const cancelledRequests = new Set<string>();
const PROGRESS_INTERVAL_MS = 250;

function post(message: unknown): void {
  self.postMessage(havocWorkerMessageSchema.parse(message));
}

function postError(
  requestId: string,
  code: HavocWorkerErrorCode,
  message: string,
  gameNumber: number | null,
): void {
  post({
    schemaVersion: HAVOC_WORKER_WIRE_SCHEMA_VERSION,
    type: 'havoc-error',
    requestId,
    code,
    message: message.slice(0, 512),
    gameNumber,
  });
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown havoc worker failure';
}

// eslint-disable-next-line @typescript-eslint/require-await -- the body is synchronous engine work with promise-returning callers
async function runTape(request: HavocWorkerTapeRequest): Promise<void> {
  try {
    const input = buildHavocGameInput({
      locked: request.locked,
      gameNumber: request.gameNumber,
      variant: request.variant,
    });
    const { result, tape } = simulateHavocGame(input, engineContext);
    const audit = auditHavocGame(input, result, tape);
    if (!audit.ok) {
      postError(
        request.requestId,
        'audit-failure',
        audit.findings.map((finding) => `${finding.code}: ${finding.message}`).join('; '),
        request.gameNumber,
      );
      return;
    }
    const resultDigest = havocGameResultDigest(result);
    post({
      schemaVersion: HAVOC_WORKER_WIRE_SCHEMA_VERSION,
      type: 'havoc-tape',
      requestId: request.requestId,
      variant: request.variant,
      gameNumber: request.gameNumber,
      inputDigest: result.inputDigest,
      resultDigest,
      tapeDigest: havocGameTapeDigest(tape),
      summary: havocGameSummaryOf(result, resultDigest),
      result,
      tape,
    });
  } catch (error) {
    postError(request.requestId, 'internal', failureMessage(error), request.gameNumber);
  }
}

async function runSimulation(request: HavocWorkerSimulateRequest): Promise<void> {
  let delivered = 0;
  let lastProgressAt = 0;
  try {
    for (let offset = 0; offset < request.count; offset += 1) {
      if (cancelledRequests.has(request.requestId)) break;
      const gameNumber = request.cursor + offset + 1;
      const input = buildHavocGameInput({
        locked: request.locked,
        gameNumber,
        variant: request.variant,
      });
      const { result, tape } = simulateHavocGame(input, engineContext);
      const audit = auditHavocGame(input, result, tape);
      if (!audit.ok) {
        postError(
          request.requestId,
          'audit-failure',
          audit.findings.map((finding) => `${finding.code}: ${finding.message}`).join('; '),
          gameNumber,
        );
        return;
      }
      const resultDigest = havocGameResultDigest(result);
      post({
        schemaVersion: HAVOC_WORKER_WIRE_SCHEMA_VERSION,
        type: 'havoc-game',
        requestId: request.requestId,
        variant: request.variant,
        cursor: gameNumber,
        inputDigest: result.inputDigest,
        resultDigest,
        summary: havocGameSummaryOf(result, resultDigest),
        result,
      });
      delivered += 1;
      const now = Date.now();
      if (now - lastProgressAt >= PROGRESS_INTERVAL_MS) {
        lastProgressAt = now;
        post({
          schemaVersion: HAVOC_WORKER_WIRE_SCHEMA_VERSION,
          type: 'havoc-progress',
          requestId: request.requestId,
          variant: request.variant,
          gamesCompleted: delivered,
          gamesTotal: request.count,
        });
      }
      await sleep(0);
    }
    post({
      schemaVersion: HAVOC_WORKER_WIRE_SCHEMA_VERSION,
      type: 'havoc-complete',
      requestId: request.requestId,
      variant: request.variant,
      gamesDelivered: delivered,
      cancelled: cancelledRequests.has(request.requestId),
      lastCursor: request.cursor + delivered,
    });
  } catch (error) {
    postError(request.requestId, 'internal', failureMessage(error), null);
  } finally {
    cancelledRequests.delete(request.requestId);
  }
}

self.onmessage = (event: MessageEvent<unknown>): void => {
  const parsed = havocWorkerRequestSchema.safeParse(event.data);
  if (!parsed.success) return;
  const request = parsed.data;
  switch (request.type) {
    case 'havoc-cancel':
      cancelledRequests.add(request.requestId);
      return;
    case 'havoc-tape':
      void runTape(request);
      return;
    case 'havoc-simulate':
      void runSimulation(request);
      return;
  }
};
