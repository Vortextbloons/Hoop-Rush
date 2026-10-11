import {
  checkGameResult,
  createEngineContext,
  draftDuelGameResultDigest,
  draftDuelGameTapeDigest,
  draftDuelSimulationInputDigest,
  simulateRecordedGame,
} from '@hoop-rush/engine';
import {
  DRAFT_DUEL_TAPE_VERSION,
  DRAFT_DUEL_WORKER_WIRE_VERSION,
  draftDuelGameOutputSchema,
  draftDuelSimulationInputSchema,
  draftDuelWorkerRequestSchema,
  draftDuelWorkerResponseSchema,
  type DraftDuelGameOutput,
  type DraftDuelParticipantId,
  type DraftDuelWorkerResponse,
} from '@hoop-rush/data-contracts';
let currentRequestId: string | null = null;
let requestToken = 0;
function post(message: DraftDuelWorkerResponse): void {
  draftDuelWorkerResponseSchema.parse(message);
  self.postMessage(message);
}
function postError(requestId: string, code: string, message: string): void {
  post({
    schemaVersion: DRAFT_DUEL_WORKER_WIRE_VERSION,
    kind: 'draft-duel-error',
    requestId,
    code,
    message: message.slice(0, 512),
  });
}
function normalizeSimulationError(message: string): string {
  return message.replace(/ failed invariants: [\s\S]*$/, ' failed invariants');
}
function participantIdFromTeamId(teamId: string): DraftDuelParticipantId {
  const match = /(?:^|[:._-])(p[12])$/.exec(teamId);
  const participantId = match?.[1];
  if (participantId === 'p1' || participantId === 'p2') return participantId;
  throw new Error(`draft-duel worker: cannot derive a participant id from team id ${teamId}`);
}
self.onmessage = (event: MessageEvent<unknown>): void => {
  const parsed = draftDuelWorkerRequestSchema.safeParse(event.data);
  if (!parsed.success) {
    postError(
      currentRequestId ?? 'unknown',
      'invalid-request',
      'draft-duel worker received an invalid request',
    );
    return;
  }
  const request = parsed.data;
  currentRequestId = request.requestId;
  requestToken += 1;
  const token = requestToken;
  (() => {
    try {
      const homeParticipantId = participantIdFromTeamId(request.input.home.teamId);
      const awayParticipantId = participantIdFromTeamId(request.input.away.teamId);
      const context = createEngineContext();
      const recorded = simulateRecordedGame(request.input, context);
      const failures = checkGameResult(recorded.result);
      if (failures.length > 0) {
        throw new Error(
          `draft duel game ${String(request.input.gameNumber)} failed invariants: ${failures.join('; ')}`,
        );
      }
      const simulationInput = draftDuelSimulationInputSchema.parse({
        schemaVersion: 1,
        roomId: request.roomId,
        gameNumber: request.input.gameNumber,
        homeParticipantId,
        awayParticipantId,
        seed: request.input.seed,
        dataVersion: request.input.dataVersion,
        home: request.input.home,
        away: request.input.away,
      });
      const output: DraftDuelGameOutput = draftDuelGameOutputSchema.parse({
        schemaVersion: DRAFT_DUEL_TAPE_VERSION,
        roomId: request.roomId,
        gameNumber: request.input.gameNumber,
        homeParticipantId,
        awayParticipantId,
        seed: request.input.seed,
        result: recorded.result,
        tape: recorded.tape,
        inputDigest: draftDuelSimulationInputDigest(simulationInput),
        resultDigest: draftDuelGameResultDigest(recorded.result),
        tapeDigest: draftDuelGameTapeDigest(recorded.tape),
      });
      if (token !== requestToken) return;
      post({
        schemaVersion: DRAFT_DUEL_WORKER_WIRE_VERSION,
        kind: 'draft-duel-game',
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
