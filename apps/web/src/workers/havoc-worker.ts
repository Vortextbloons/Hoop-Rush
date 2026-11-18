import {
  HAVOC_WORKER_WIRE_SCHEMA_VERSION,
  havocLockedInputDigest,
  havocNextGameBatchSize,
  havocWorkerMessageSchema,
  havocWorkerRequestSchema,
  type HavocWorkerErrorCode,
  type HavocWorkerGameResult,
  type HavocWorkerSimulateRequest,
  type HavocWorkerTapeRequest,
} from '@hoop-rush/data-contracts';
import {
  buildHavocGameInput,
  createEngineContext,
  havocGameResultDigest,
  havocGameSummaryOf,
  havocGameTapeDigest,
  simulateAuditedHavocGame,
  simulateAuditedHavocSummaryGame,
} from '@hoop-rush/engine';
import { sleep } from '../lib/sleep';

const engineContext = createEngineContext();
const cancelledRequests = new Set<string>();
const PROGRESS_INTERVAL_MS = 250;
const YIELD_INTERVAL_MS = 8;

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

function assertRequestDigest(
  request: HavocWorkerTapeRequest | HavocWorkerSimulateRequest,
): boolean {
  if (havocLockedInputDigest(request.locked) === request.inputDigest) return true;
  postError(
    request.requestId,
    'invariant-failure',
    'the locked inputs do not match the request digest',
    request.type === 'havoc-tape' ? request.gameNumber : null,
  );
  return false;
}

// eslint-disable-next-line @typescript-eslint/require-await -- the body is synchronous engine work with promise-returning callers
async function runTape(request: HavocWorkerTapeRequest): Promise<void> {
  if (!assertRequestDigest(request)) return;
  try {
    const input = buildHavocGameInput({
      locked: request.locked,
      gameNumber: request.gameNumber,
      variant: request.variant,
    });
    const { result, tape, audit } = simulateAuditedHavocGame(input, engineContext);
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
  if (!assertRequestDigest(request)) return;
  let delivered = 0;
  let lastProgressAt = 0;
  let lastYieldAt = Date.now();
  try {
    let offset = 0;
    while (offset < request.count) {
      if (cancelledRequests.has(request.requestId)) break;
      const target = havocNextGameBatchSize(request.count - offset);
      const batch: HavocWorkerGameResult[] = [];
      while (batch.length < target) {
        if (cancelledRequests.has(request.requestId)) break;
        const gameNumber = request.cursor + offset + 1;
        const input = buildHavocGameInput({
          locked: request.locked,
          gameNumber,
          variant: request.variant,
        });
        const { result, audit } = simulateAuditedHavocSummaryGame(input, engineContext);
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
        batch.push({
          variant: request.variant,
          cursor: gameNumber,
          inputDigest: result.inputDigest,
          resultDigest,
          summary: havocGameSummaryOf(result, resultDigest),
          result,
        });
        offset += 1;
        const now = Date.now();
        if (now - lastYieldAt >= YIELD_INTERVAL_MS) {
          lastYieldAt = now;
          await sleep(0);
        }
      }
      if (batch.length !== target || cancelledRequests.has(request.requestId)) break;
      post({
        schemaVersion: HAVOC_WORKER_WIRE_SCHEMA_VERSION,
        type: 'havoc-game-batch',
        requestId: request.requestId,
        variant: request.variant,
        games: batch,
      });
      delivered += batch.length;
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
