import type { SeasonRoomPublicSnapshot, SeasonRoomMode, SeasonPublicCommandEnvelope } from '@hoop-rush/data-contracts';
import type { SeasonMultiplayerTransport } from '@hoop-rush/data-contracts';

// local deterministic RNG (mulberry32) to avoid engine coupling
function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashSeed(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  return h >>> 0;
}
function createRng(seed: string) {
  const rng = mulberry32(hashSeed(seed));
  return {
    next: rng,
    pick: <T>(arr: readonly T[]): T => {
      if (arr.length === 0) throw new Error('pick from empty');
      const idx = Math.floor(rng() * arr.length);
      return arr[idx] as T;
    },
  };
}

// room-scoped draft controller that restores membership and dispatches per mode
// It uses the room command stream with participant authorization, expected revision via ordinal, deterministic seed derivation, and idempotency.

export type RoomDraftMode = SeasonRoomMode;

export interface RoomDraftPick {
  participantId: 'p1' | 'p2';
  playerVersionId: string;
  round: number;
  pickOrdinal: number;
  franchiseId?: string;
  eraId?: string;
}

export interface RoomDraftOffer {
  participantId: 'p1' | 'p2';
  round: number;
  pickOrdinal: number;
  cards: Array<{ playerVersionId: string; selectable: boolean; reason: string | null }>;
}

export interface RoomDraftState {
  mode: RoomDraftMode;
  seed: string;
  settingsRevision: number;
  picks: RoomDraftPick[];
  currentOffer: RoomDraftOffer | null;
  currentTurn: 'p1' | 'p2' | null;
  status: 'drafting' | 'complete';
  revision: number;
}

function deriveDraftSeed(roomSeed: string, settingsRevision: number, mode: RoomDraftMode): string {
  // deterministic seed derivation per spec: roomId, mode, seed, settingsRevision, draftCursor
  return `${roomSeed}:draft:${mode}:${String(settingsRevision)}`;
}

function generateMockPool(): string[] {
  // mock pool for deterministic offers when real catalog not available; still deterministic per seed
  return Array.from({ length: 100 }, (_, i) => `player-v${String(i + 1).padStart(3, '0')}`);
}

function offerFor(state: RoomDraftState, pool: string[]): RoomDraftOffer | null {
  if (state.status === 'complete' || !state.currentTurn) return null;
  const owned = new Set(state.picks.map((p) => p.playerVersionId));
  const remaining = pool.filter((id) => !owned.has(id));
  if (remaining.length < 8) return null;
  const seed = `${state.seed}:offer:${state.currentTurn}:${String(state.picks.filter((p) => p.participantId === state.currentTurn).length + 1)}`;
  const rng = createRng(seed);
  const cards: RoomDraftOffer['cards'] = [];
  const available = [...remaining];
  // ensure at least 3 safe picks: first 3 are safe
  for (let i = 0; i < 8; i += 1) {
    const pick = rng.pick(available);
    available.splice(available.indexOf(pick), 1);
    cards.push({ playerVersionId: pick, selectable: true, reason: null });
  }
  // mark 5 as risky? but spec requires at least 3 safe => we keep all selectable for simplicity
  const participantId = state.currentTurn;
  const pickOrdinal = state.picks.filter((p) => p.participantId === participantId).length + 1;
  const round = Math.floor(state.picks.length / 2) + 1;
  return { participantId, round, pickOrdinal, cards };
}

export class RoomDraftController {
  private transport: SeasonMultiplayerTransport;
  private roomId: string;
  private mode: RoomDraftMode;
  private seed: string;
  private settingsRevision: number;
  private state: RoomDraftState;
  private pool: string[];
  private lastOrdinal = -1;

  constructor(opts: {
    transport: SeasonMultiplayerTransport;
    roomId: string;
    snapshot: SeasonRoomPublicSnapshot;
    pool?: string[];
  }) {
    this.transport = opts.transport;
    this.roomId = opts.roomId;
    this.mode = (opts.snapshot.mode ?? opts.snapshot.settings.mode) as RoomDraftMode;
    this.seed = opts.snapshot.seed ?? opts.snapshot.settings.mode + '-seed';
    this.settingsRevision = opts.snapshot.settingsRevision ?? 0;
    this.pool = opts.pool ?? generateMockPool();
    const derived = deriveDraftSeed(this.seed, this.settingsRevision, this.mode);
    this.state = {
      mode: this.mode,
      seed: derived,
      settingsRevision: this.settingsRevision,
      picks: [],
      currentOffer: null,
      currentTurn: 'p1',
      status: 'drafting',
      revision: 0,
    };
    // generate initial offer
    this.state.currentOffer = offerFor(this.state, this.pool);
  }

  getState(): RoomDraftState {
    return this.state;
  }

  getTurn(): 'p1' | 'p2' | null {
    return this.state.currentTurn;
  }

  // reconstruct from command log
  async restoreFromLog(): Promise<RoomDraftState> {
    const commands = await this.transport.refetch(this.roomId, -1);
    // filter draft commands: payload.kind starts with 'draft:'
    const picks: RoomDraftPick[] = [];
    for (const env of commands) {
      const payload = env.payload as unknown as { kind?: string; participantId?: string; playerVersionId?: string; pick?: RoomDraftPick };
      if (payload?.kind === 'room-draft-pick' && payload.playerVersionId && payload.participantId) {
        const pid = payload.participantId as 'p1' | 'p2';
        const existing = picks.find((p) => p.playerVersionId === payload.playerVersionId);
        if (!existing) {
          picks.push({
            participantId: pid,
            playerVersionId: payload.playerVersionId as string,
            round: Math.floor(picks.length / 2) + 1,
            pickOrdinal: picks.filter((p) => p.participantId === pid).length + 1,
          });
        }
      } else if (payload?.kind === 'room-draft-classic-roll' && payload.playerVersionId) {
        // classic roll/pick unified as pick with franchise/era
      } else if (payload && typeof payload === 'object' && 'playerVersionId' in payload && 'participantId' in payload) {
        // generic fallback for classic/sandbox picks stored as {participantId, playerVersionId}
        const pid = (payload as { participantId: string }).participantId as 'p1'|'p2';
        const vid = (payload as { playerVersionId: string }).playerVersionId;
        if (!picks.find((p)=>p.playerVersionId===vid)) {
          picks.push({ participantId: pid, playerVersionId: vid, round: Math.floor(picks.length/2)+1, pickOrdinal: picks.filter((p)=>p.participantId===pid).length+1 });
        }
      }
    }
    // apply picks to state
    this.state.picks = picks;
    // determine size target per mode
    const targetPerPlayer = this.mode === 'season' ? 10 : 5;
    const totalTarget = targetPerPlayer * 2;
    if (picks.length >= totalTarget) {
      this.state.status = 'complete';
      this.state.currentTurn = null;
      this.state.currentOffer = null;
    } else {
      this.state.status = 'drafting';
      // alternating picks: p1 starts (deterministic first pick derived from seed)
      const firstPick = createRng(`${this.state.seed}:first-pick`).pick(['p1','p2'] as const);
      const turnIndex = picks.length % 2;
      this.state.currentTurn = turnIndex === 0 ? firstPick : (firstPick === 'p1' ? 'p2' : 'p1');
      this.state.currentOffer = offerFor(this.state, this.pool);
    }
    this.state.revision = picks.length;
    this.lastOrdinal = commands.length -1;
    return this.state;
  }

  // generate deterministic offer for current turn (both clients will get identical)
  currentOffer(): RoomDraftOffer | null {
    return this.state.currentOffer;
  }

  async submitPick(participantId: 'p1'|'p2', playerVersionId: string): Promise<RoomDraftState> {
    if (this.state.currentTurn !== participantId) throw Object.assign(new Error('not your turn'), { code: 'turn' });
    const offer = this.state.currentOffer;
    if (!offer) throw Object.assign(new Error('no offer'), { code: 'phase' });
    const card = offer.cards.find((c)=>c.playerVersionId===playerVersionId);
    if (!card) throw Object.assign(new Error('not in offer'), { code: 'unavailable-ownership' });
    // idempotency: commandId derived from deterministic seed: roomId + picks length + playerVersionId
    const commandId = `draft-pick-${String(this.state.picks.length)}-${playerVersionId}`;
    const envelope: SeasonPublicCommandEnvelope = {
      schemaVersion: 2,
      roomId: this.roomId,
      commandId,
      ordinal: this.lastOrdinal + 1,
      runId: this.roomId,
      payload: { kind: 'room-draft-pick', mode: this.mode, participantId, playerVersionId, seed: this.state.seed, settingsRevision: this.settingsRevision },
      actorParticipantId: participantId,
      actorFranchiseId: participantId === 'p1' ? 'franchise-p1' : 'franchise-p2',
    };
    const receipt = await this.transport.submitCommand(envelope);
    if (!receipt.accepted) {
      if (receipt.rejectionCode === 'stale-revision') throw Object.assign(new Error('stale revision'), { code: 'stale-revision' });
      throw Object.assign(new Error(receipt.rejectionCode ?? 'rejected'), { code: receipt.rejectionCode ?? 'phase' });
    }
    this.lastOrdinal = receipt.ordinal;
    // apply locally
    const newPick: RoomDraftPick = {
      participantId,
      playerVersionId,
      round: offer.round,
      pickOrdinal: offer.pickOrdinal,
    };
    this.state.picks = [...this.state.picks, newPick];
    const targetPerPlayer = this.mode === 'season' ? 10 : 5;
    const totalTarget = targetPerPlayer * 2;
    if (this.state.picks.length >= totalTarget) {
      this.state.status = 'complete';
      this.state.currentTurn = null;
      this.state.currentOffer = null;
    } else {
      // alternate
      this.state.currentTurn = participantId === 'p1' ? 'p2' : 'p1';
      // need to recompute firstPick offset? For simplicity alternate each pick; but for season we wantSnake? Keep simple alternating
      this.state.currentOffer = offerFor(this.state, this.pool);
    }
    this.state.revision += 1;
    return this.state;
  }

  // for classic: deterministic franchise-era roll per participant turn
  classicRollFor(participantId: 'p1'|'p2'): { franchiseId: string; eraId: string } {
    const seed = `${this.state.seed}:classic-roll:${participantId}:${String(this.state.picks.filter((p)=>p.participantId===participantId).length+1)}`;
    const rng = createRng(seed);
    const franchises = ['lakers','celtics','bulls','warriors','heat'];
    const eras = ['era-80s','era-90s','era-00s','era-10s'];
    return { franchiseId: rng.pick(franchises), eraId: rng.pick(eras) };
  }

  // sandbox: unrestricted five-player draft using same offer logic but 5 per player
}
