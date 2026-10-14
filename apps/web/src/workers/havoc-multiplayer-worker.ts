import {
  HAVOC_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION,
  havocMultiplayerWorkerRequestSchema,
  havocMultiplayerWorkerResponseSchema,
  type HavocMultiplayerWorkerGameOutput,
  type HavocMultiplayerWorkerResponse,
} from '@hoop-rush/data-contracts';
import {
  auditHavocBattleGame,
  createEngineContext,
  havocBattleGameInputDigest,
  havocBattleGameResultDigest,
  havocBattleGameTapeDigest,
  simulateHavocBattleGame,
} from '@hoop-rush/engine';

let currentRequestId: string | null = null;
let requestToken = 0;

function post(message: HavocMultiplayerWorkerResponse): void {
  havocMultiplayerWorkerResponseSchema.parse(message);
  self.postMessage(message);
}

function postError(requestId: string, code: string, message: string): void {
  post({
    schemaVersion: HAVOC_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION,
    kind: 'havoc-multiplayer-error',
    requestId,
    code,
    message: message.slice(0, 512),
  });
}

function normalizeSimulationError(message: string): string {
  return message.replace(/ failed invariants: [\s\S]*$/, ' failed invariants');
}

self.onmessage = (event: MessageEvent<unknown>): void => {
  const parsed = havocMultiplayerWorkerRequestSchema.safeParse(event.data);
  if (!parsed.success) {
    postError(
      currentRequestId ?? 'unknown',
      'invalid-request',
      'havoc multiplayer worker received an invalid request',
    );
    return;
  }
  const request = parsed.data;
  currentRequestId = request.requestId;
  requestToken += 1;
  const token = requestToken;
  (() => {
    try {
      const context = createEngineContext();
      const { result, tape } = simulateHavocBattleGame(request.input, context);
      const audit = auditHavocBattleGame(request.input, result, tape);
      if (!audit.ok) {
        if (token !== requestToken) return;
        postError(
          request.requestId,
          'audit-failure',
          audit.findings.map((finding) => `${finding.code}: ${finding.message}`).join('; '),
        );
        return;
      }
      const output: HavocMultiplayerWorkerGameOutput = {
        result,
        tape,
        inputDigest: havocBattleGameInputDigest(request.input),
        resultDigest: havocBattleGameResultDigest(result),
        tapeDigest: havocBattleGameTapeDigest(tape),
      };
      if (token !== requestToken) return;
      post({
        schemaVersion: HAVOC_MULTIPLAYER_WORKER_WIRE_SCHEMA_VERSION,
        kind: 'havoc-multiplayer-game',
        requestId: request.requestId,
        output,
      });
    } catch (error) {
      if (token !== requestToken) return;
      const message = error instanceof Error ? error.message : String(error);
      postError(request.requestId, 'simulation-failed', normalizeSimulationError(message));
    }
  })();
};

export {};
