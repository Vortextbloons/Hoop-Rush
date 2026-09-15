import { describe, expect, it } from 'vitest';
import {
  commandIdSchema,
  contentHashSchema,
  createInMemoryFixedFiveTransport,
  defaultFixedFiveVersionLocks,
  playerIdSchema,
  seedSchema,
  type FixedFiveMultiplayerTransport,
  type FixedFiveParticipantId,
  type FixedFiveVerificationReceipt,
  type Id,
  type SimulationTeam,
} from '@hoop-rush/data-contracts';
import {
  createEngineContext,
  simulateDuelSeries,
  verifyFixedFiveCompetition,
} from '@hoop-rush/engine';
import {
  DEFAULT_ERA_SIM_PROFILE,
  buildFixtureBracket,
  buildLegalSimulationTeam,
} from '@hoop-rush/test-fixtures';
import {
  buildFixedFiveVerificationInput,
  computeCompetitionDigest,
  type PickRef,
} from './fixed-five-room-state';

const CONTEXT = createEngineContext();
const VERSIONS = defaultFixedFiveVersionLocks({
  dataVersion: 'data-v1',
  engineVersion: 'engine-v1',
  bracketVersion: 'bracket-v1',
  profileVersion: 'profile-v1',
});
const BRACKET = buildFixtureBracket();
function teamWithIds(teamId: string, displayName: string, prefix: string): SimulationTeam {
  const base = buildLegalSimulationTeam({ teamId, displayName });
  return {
    ...base,
    players: base.players.map((player, index) => ({
      ...player,
      playerId: playerIdSchema.parse(`${prefix}-${String(index + 1)}`),
    })),
  };
}
const P1_TEAM = teamWithIds('p1', 'Player 1', 'receipt-p1');
const P2_TEAM = teamWithIds('p2', 'Player 2', 'receipt-p2');

function refsFor(team: SimulationTeam): PickRef[] {
  return team.players.map((player, index) => ({
    playerId: player.playerId,
    franchiseId: 'fixture-franchise',
    eraId: '2010s',
    slotIndex: index,
  }));
}

const P1_REFS = refsFor(P1_TEAM);
const P2_REFS = refsFor(P2_TEAM);

function buildInput(roomId: string, challenge: string, rootSeedText: string) {
  const rootSeed = seedSchema.parse(rootSeedText);
  const series = simulateDuelSeries(
    {
      p1Team: P1_TEAM,
      p2Team: P2_TEAM,
      profile: DEFAULT_ERA_SIM_PROFILE,
      rootSeed,
      dataVersion: 'data-v1',
    },
    CONTEXT,
  );
  const resultDigest = computeCompetitionDigest({
    rootSeed,
    versions: VERSIONS,
    p1: { refs: P1_REFS, players: [...P1_TEAM.players] },
    p2: { refs: P2_REFS, players: [...P2_TEAM.players] },
    commands: [],
    result: series.result,
  });
  const input = buildFixedFiveVerificationInput({
    roomId,
    competition: 'duel',
    rootSeed,
    versions: VERSIONS,
    challenge,
    commands: [],
    bracket: BRACKET,
    profile: DEFAULT_ERA_SIM_PROFILE,
    result: series.result,
    resultDigest,
    p1: { refs: P1_REFS, players: [...P1_TEAM.players] },
    p2: { refs: P2_REFS, players: [...P2_TEAM.players] },
  });
  return { input, resultDigest };
}

function validReceipt(roomId: string, challenge: string, rootSeedText: string) {
  const { input, resultDigest } = buildInput(roomId, challenge, rootSeedText);
  const outcome = verifyFixedFiveCompetition(input, CONTEXT);
  if (!outcome.ok) throw new Error(`fixture failed verification: ${outcome.failures.join('; ')}`);
  return { receipt: outcome.receipt, input, resultDigest };
}

async function openRoom(): Promise<{
  transport: FixedFiveMultiplayerTransport;
  roomId: Id;
  challenge: string;
}> {
  const transport = createInMemoryFixedFiveTransport({ seed: 'fixed-five-verification-test' });
  const created = await transport.create({
    mode: 'duel',
    sourceMode: 'classic',
    variant: 'ratings',
    versions: VERSIONS,
  });
  const roomId = created.snapshot.roomId;
  const challenge = await transport.verificationChallenge(roomId);
  return { transport, roomId, challenge };
}

async function confirmSeat(
  transport: FixedFiveMultiplayerTransport,
  roomId: Id,
  actor: FixedFiveParticipantId,
  resultDigest: string,
  commandId: string,
): Promise<void> {
  const receipt = await transport.submitCommand({
    schemaVersion: 1,
    roomId,
    commandId: commandIdSchema.parse(commandId),
    actorParticipantId: actor,
    payload: {
      kind: 'confirm-result',
      resultDigest: contentHashSchema.parse(resultDigest),
      verified: true,
    },
  });
  expect(receipt.accepted).toBe(true);
}

describe('fixed-five verification receipts', () => {
  it('rejects a tampered digest, refuses receipt storage, and blocks completion', async () => {
    const { transport, roomId, challenge } = await openRoom();
    const { input } = buildInput(roomId, challenge, 'a'.repeat(32));
    const forgedDigest = contentHashSchema.parse('f'.repeat(64));
    const outcome = verifyFixedFiveCompetition({ ...input, resultDigest: forgedDigest }, CONTEXT);
    expect(outcome.ok).toBe(false);

    const blocked = await transport.complete(roomId, forgedDigest);
    expect(blocked.completed).toBe(false);

    const { receipt } = validReceipt(roomId, challenge, 'a'.repeat(32));
    const wrongChallenge: FixedFiveVerificationReceipt = {
      ...receipt,
      challenge: 'attacker-supplied-challenge',
    };
    await expect(transport.submitVerification(roomId, wrongChallenge)).rejects.toThrow(/challenge/);
    expect((await transport.complete(roomId, wrongChallenge.receiptDigest)).completed).toBe(false);
  });

  it('cannot complete when the two seats confirmed different results', async () => {
    const { transport, roomId, challenge } = await openRoom();
    const seatA = validReceipt(roomId, challenge, 'a'.repeat(32));
    const seatB = validReceipt(roomId, challenge, 'b'.repeat(32));
    expect(seatA.receipt.resultDigest).not.toBe(seatB.receipt.resultDigest);
    await transport.submitVerification(roomId, seatA.receipt);
    await transport.submitVerification(roomId, seatB.receipt);
    await confirmSeat(transport, roomId, 'p1', seatA.receipt.resultDigest, 'confirm-a');
    await confirmSeat(transport, roomId, 'p2', seatB.receipt.resultDigest, 'confirm-b');

    const first = await transport.complete(roomId, seatA.receipt.receiptDigest);
    expect(first.completed).toBe(false);
    const second = await transport.complete(roomId, seatB.receipt.receiptDigest);
    expect(second.completed).toBe(false);
  });

  it('submits a valid deterministic receipt and completes once both seats confirm', async () => {
    const { transport, roomId, challenge } = await openRoom();
    const { receipt } = validReceipt(roomId, challenge, 'a'.repeat(32));
    const stored = await transport.submitVerification(roomId, receipt);
    expect(stored.receiptId).toBe(receipt.receiptDigest);

    const beforeConfirms = await transport.complete(roomId, receipt.receiptDigest);
    expect(beforeConfirms.completed).toBe(false);
    await confirmSeat(transport, roomId, 'p1', receipt.resultDigest, 'confirm-p1');
    const oneSeat = await transport.complete(roomId, receipt.receiptDigest);
    expect(oneSeat.completed).toBe(false);
    await confirmSeat(transport, roomId, 'p2', receipt.resultDigest, 'confirm-p2');

    const done = await transport.complete(roomId, receipt.receiptDigest);
    expect(done.completed).toBe(true);
    expect(done.phase).toBe('completed');
  });
});
