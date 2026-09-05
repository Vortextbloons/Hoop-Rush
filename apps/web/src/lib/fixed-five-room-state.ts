import {
  canonicalJson,
  contentHashSchema,
  fixedFiveTimeoutMsForMode,
  idSchema,
  playerIdSchema,
  playerVersionId,
  type ClassicDraftCatalog,
  type ClassicDraftState,
  type ContentHash,
  type EraSimulationProfile,
  type FixedFiveCommand,
  type FixedFiveCommandPayload,
  type FixedFiveCompetitionResult,
  type FixedFiveCompetitionRun,
  type FixedFiveLineupEntry,
  type FixedFiveParticipantId,
  type FixedFiveRoomMode,
  type FixedFiveRoomPhase,
  type FixedFiveRoomSettings,
  type FixedFiveRoomSnapshot,
  type FixedFiveWorkerResultEntry,
  type FixedFiveWorkerTeam,
  type HoopRushManifest,
  type OpponentBracket,
  type PeakPlayerSeason,
  type PlayersIndex,
  type Seed,
  type SimulationPlayer,
  type SlotIndex,
} from '@hoop-rush/data-contracts';
import {
  FIXED_FIVE_TIEBREAK_PATH,
  applyClassicBuilderCommand,
  applySandboxBuilderCommand,
  chooseAutopick,
  claimDuelPlayer,
  claimSandboxDuelPlayer,
  createDuelDraft,
  createEngineContext,
  createParticipantClassicDraft,
  createSandboxDuelDraft,
  duelCurrentPicker,
  createSandboxBuilder,
  enumerateClassicSafeMoves,
  enumerateDuelSafeMoves,
  enumerateSandboxDuelSafeMoves,
  enumerateSandboxSafeMoves,
  sandboxDuelPicker,
  fixedFiveDraftSeed,
  fixedFiveResultDigest,
  fixedFiveTiebreakWinner,
  rerollDuel,
  summarizeDuelGames,
  summarizeShared82Games,
  toSimulationPlayer,
  type AutopickSelection,
  type ClassicBuilderCommand,
  type DuelDraftState,
  type EngineContext,
  type FixedFiveCandidate,
  type SandboxBuilderState,
  type SandboxDuelState,
} from '@hoop-rush/engine';
import { buildClassicCatalog } from '$lib/classic-draft';
import { getPlayersIndex } from '$lib/data';
import { resolvePlayerRefs, type PlayerRef } from '$lib/player-refs';
import { FIXED_SANDBOX_ERA, loadRunPreamble } from '$lib/run-preamble';
export interface FixedFiveAssets {
  manifest: HoopRushManifest;
  profile: EraSimulationProfile;
  bracket: OpponentBracket;
  index: PlayersIndex;
  catalog: ClassicDraftCatalog;
  pool: FixedFiveCandidate[];
  poolById: Map<string, FixedFiveCandidate>;
  context: EngineContext;
}
let assetsPromise: Promise<FixedFiveAssets> | null = null;
export function loadFixedFiveAssets(): Promise<FixedFiveAssets> {
  assetsPromise ??= (async () => {
    const [{ manifest, profile, bracket }, index] = await Promise.all([
      loadRunPreamble(),
      getPlayersIndex(),
    ]);
    const catalog = buildClassicCatalog(manifest, index);
    const pool: FixedFiveCandidate[] = index.players.map((entry) => ({
      playerId: entry.playerId,
      playerVersionId: playerVersionId(
        entry.playerId,
        entry.franchiseId,
        entry.eraId,
        entry.seasonKey,
      ),
      positions: [...entry.positionsPlayable],
      selectionScore: entry.selectionScore,
      franchiseId: entry.franchiseId,
      eraId: entry.eraId,
    }));
    return {
      manifest,
      profile,
      bracket,
      index,
      catalog,
      pool,
      poolById: new Map(pool.map((c) => [c.playerId, c])),
      context: createEngineContext(),
    };
  })();
  return assetsPromise;
}
export interface ClassicDraftReplay {
  hasStart: boolean;
  p1: ClassicDraftState;
  p2: ClassicDraftState;
  skipped: number;
}
export interface SandboxDraftReplay {
  hasStart: boolean;
  p1: SandboxBuilderState;
  p2: SandboxBuilderState;
  skipped: number;
}
export interface DuelDraftReplay {
  hasStart: boolean;
  state: DuelDraftState;
  skipped: number;
}
export interface SandboxDuelDraftReplay {
  hasStart: boolean;
  state: SandboxDuelState;
  skipped: number;
}
export type DraftReplay =
  | ({
      mode: 'classic-shared-82';
    } & ClassicDraftReplay)
  | ({
      mode: 'sandbox-shared-82';
    } & SandboxDraftReplay)
  | ({
      mode: 'duel';
    } & DuelDraftReplay)
  | ({
      mode: 'sandbox-duel';
    } & SandboxDuelDraftReplay);
function draftIdFor(roomId: string, participant: FixedFiveParticipantId): string {
  return `${roomId.slice(0, 48)}:${participant}`;
}
function applyClassicPayload(
  state: ClassicDraftState,
  assets: FixedFiveAssets,
  payload: FixedFiveCommandPayload,
): ClassicDraftState {
  if (payload.kind === 'reroll') {
    const command: ClassicBuilderCommand = { kind: 'reroll', axis: payload.axis };
    return applyClassicBuilderCommand(state, assets.catalog, command, assets.context);
  }
  if (payload.kind === 'classic-pick' || payload.kind === 'timeout-autopick') {
    const command: ClassicBuilderCommand = {
      kind: 'classic-pick',
      playerId: payload.playerId,
      slotIndex: payload.slotIndex,
    };
    return applyClassicBuilderCommand(state, assets.catalog, command, assets.context);
  }
  return state;
}
function applySandboxPayload(
  state: SandboxBuilderState,
  assets: FixedFiveAssets,
  payload: FixedFiveCommandPayload,
): SandboxBuilderState {
  if (payload.kind === 'sandbox-place' || payload.kind === 'timeout-autopick') {
    return applySandboxBuilderCommand(state, assets.pool, {
      kind: 'sandbox-place',
      playerId: payload.playerId,
      slotIndex: payload.slotIndex,
    });
  }
  if (payload.kind === 'sandbox-remove') {
    return applySandboxBuilderCommand(state, assets.pool, {
      kind: 'sandbox-remove',
      slotIndex: payload.slotIndex,
    });
  }
  if (payload.kind === 'sandbox-lock') {
    return applySandboxBuilderCommand(state, assets.pool, { kind: 'sandbox-lock' });
  }
  return state;
}
function applyDuelPayload(
  state: DuelDraftState,
  assets: FixedFiveAssets,
  actor: FixedFiveParticipantId,
  payload: FixedFiveCommandPayload,
): DuelDraftState {
  if (payload.kind === 'reroll') {
    return rerollDuel(state, assets.catalog, assets.poolById, payload.axis, actor, assets.context);
  }
  if (
    payload.kind === 'duel-claim' ||
    payload.kind === 'classic-pick' ||
    payload.kind === 'timeout-autopick'
  ) {
    return claimDuelPlayer(
      state,
      assets.catalog,
      assets.poolById,
      { playerId: payload.playerId, slotIndex: payload.slotIndex, actor },
      assets.context,
    );
  }
  return state;
}
function applySandboxDuelPayload(
  state: SandboxDuelState,
  assets: FixedFiveAssets,
  command: FixedFiveCommand,
): SandboxDuelState {
  const payload = command.payload;
  if (payload.kind === 'sandbox-place' || payload.kind === 'timeout-autopick') {
    return claimSandboxDuelPlayer(state, assets.pool, {
      playerId: payload.playerId,
      slotIndex: payload.slotIndex,
      actor: command.actorParticipantId,
    });
  }
  return state;
}
function isDraftPayload(
  mode: FixedFiveRoomMode,
  kind: FixedFiveCommandPayload['kind'],
  sandboxDuel = false,
): boolean {
  if (mode === 'duel') {
    if (sandboxDuel) {
      return kind === 'sandbox-place' || kind === 'timeout-autopick';
    }
    return (
      kind === 'reroll' ||
      kind === 'duel-claim' ||
      kind === 'classic-pick' ||
      kind === 'timeout-autopick'
    );
  }
  if (mode === 'sandbox-shared-82') {
    return (
      kind === 'sandbox-place' ||
      kind === 'sandbox-remove' ||
      kind === 'sandbox-lock' ||
      kind === 'timeout-autopick'
    );
  }
  return kind === 'reroll' || kind === 'classic-pick' || kind === 'timeout-autopick';
}
export function replayFixedFiveLog(
  mode: FixedFiveRoomMode,
  roomId: string,
  rootSeed: Seed,
  dataVersion: string,
  variant: FixedFiveRoomSettings['variant'],
  assets: FixedFiveAssets,
  commands: FixedFiveCommand[],
  sourceMode: FixedFiveRoomSettings['sourceMode'] = 'classic',
): DraftReplay {
  const ordered = [...commands].sort((a, b) => a.ordinal - b.ordinal);
  const hasStart = ordered.some((c) => c.payload.kind === 'start');
  if (mode === 'duel' && sourceMode === 'sandbox') {
    let state = createSandboxDuelDraft(rootSeed);
    let skipped = 0;
    for (const command of ordered) {
      if (!isDraftPayload(mode, command.payload.kind, true)) continue;
      try {
        state = applySandboxDuelPayload(state, assets, command);
      } catch {
        skipped += 1;
      }
    }
    return { mode: 'sandbox-duel', hasStart, state, skipped };
  }
  if (mode === 'duel') {
    let state = createDuelDraft(rootSeed, assets.catalog, assets.poolById, assets.context);
    let skipped = 0;
    for (const command of ordered) {
      if (!isDraftPayload(mode, command.payload.kind)) continue;
      try {
        state = applyDuelPayload(state, assets, command.actorParticipantId, command.payload);
      } catch {
        skipped += 1;
      }
    }
    return { mode, hasStart, state, skipped };
  }
  if (mode === 'sandbox-shared-82') {
    let p1 = createSandboxBuilder();
    let p2 = createSandboxBuilder();
    let skipped = 0;
    for (const command of ordered) {
      if (!isDraftPayload(mode, command.payload.kind)) continue;
      try {
        if (command.actorParticipantId === 'p1') {
          p1 = applySandboxPayload(p1, assets, command.payload);
        } else {
          p2 = applySandboxPayload(p2, assets, command.payload);
        }
      } catch {
        skipped += 1;
      }
    }
    return { mode, hasStart, p1, p2, skipped };
  }
  let p1 = createParticipantClassicDraft(
    draftIdFor(roomId, 'p1'),
    variant,
    fixedFiveDraftSeed(rootSeed, 'p1'),
    dataVersion,
    assets.catalog,
    assets.context,
  );
  let p2 = createParticipantClassicDraft(
    draftIdFor(roomId, 'p2'),
    variant,
    fixedFiveDraftSeed(rootSeed, 'p2'),
    dataVersion,
    assets.catalog,
    assets.context,
  );
  let skipped = 0;
  for (const command of ordered) {
    if (!isDraftPayload(mode, command.payload.kind)) continue;
    try {
      if (command.actorParticipantId === 'p1') {
        p1 = applyClassicPayload(p1, assets, command.payload);
      } else {
        p2 = applyClassicPayload(p2, assets, command.payload);
      }
    } catch {
      skipped += 1;
    }
  }
  return { mode, hasStart, p1, p2, skipped };
}
export function isDraftComplete(replay: DraftReplay): boolean {
  if (replay.mode === 'duel') return replay.state.status === 'complete';
  if (replay.mode === 'sandbox-duel') return replay.state.status === 'complete';
  if (replay.mode === 'sandbox-shared-82') return replay.p1.locked && replay.p2.locked;
  return replay.p1.status === 'complete' && replay.p2.status === 'complete';
}
export function isFixedFiveDraftTurn(
  replay: DraftReplay,
  participant: FixedFiveParticipantId,
): boolean {
  if (replay.mode === 'duel') {
    return (
      replay.state.status === 'drafting' &&
      replay.state.currentRoll !== null &&
      duelCurrentPicker(replay.state) === participant
    );
  }
  if (replay.mode === 'sandbox-duel') {
    return replay.state.status === 'drafting' && sandboxDuelPicker(replay.state) === participant;
  }
  if (replay.mode === 'sandbox-shared-82') {
    return !(participant === 'p1' ? replay.p1 : replay.p2).locked;
  }
  return (participant === 'p1' ? replay.p1 : replay.p2).status === 'drafting';
}
export function picksCommittedOf(replay: DraftReplay, participant: FixedFiveParticipantId): number {
  if (replay.mode === 'duel') {
    return replay.state.picks.filter((p) => p.participantId === participant).length;
  }
  if (replay.mode === 'sandbox-duel') {
    return replay.state.picks.filter((p) => p.participantId === participant).length;
  }
  if (replay.mode === 'sandbox-shared-82') {
    const builder = participant === 'p1' ? replay.p1 : replay.p2;
    return builder.placements.length;
  }
  const draft = participant === 'p1' ? replay.p1 : replay.p2;
  return draft.picks.length;
}
export function lockedOf(replay: DraftReplay, participant: FixedFiveParticipantId): boolean {
  if (replay.mode === 'duel') return replay.state.status === 'complete';
  if (replay.mode === 'sandbox-duel') return replay.state.status === 'complete';
  if (replay.mode === 'sandbox-shared-82') {
    return (participant === 'p1' ? replay.p1 : replay.p2).locked;
  }
  return (participant === 'p1' ? replay.p1 : replay.p2).status === 'complete';
}
export interface RoomLogFacts {
  ready: Record<FixedFiveParticipantId, boolean>;
  rematchRequested: Record<FixedFiveParticipantId, boolean>;
  rematchConfirmed: Record<FixedFiveParticipantId, boolean>;
  proposals: Array<{
    actor: FixedFiveParticipantId;
    digest: ContentHash;
  }>;
  confirms: Array<{
    actor: FixedFiveParticipantId;
    digest: ContentHash;
    verified: boolean;
  }>;
}
export function mergeFixedFiveCommands(
  existing: FixedFiveCommand[],
  incoming: FixedFiveCommand[],
): FixedFiveCommand[] {
  const byOrdinal = new Map<number, FixedFiveCommand>();
  const ordinalByCommandId = new Map<string, number>();
  for (const command of [...existing, ...incoming]) {
    const knownOrdinal = ordinalByCommandId.get(command.commandId);
    if (knownOrdinal !== undefined && knownOrdinal !== command.ordinal) {
      throw new Error(`fixed-five command ${command.commandId} changed ordinal`);
    }
    const atOrdinal = byOrdinal.get(command.ordinal);
    if (atOrdinal) {
      if (
        atOrdinal.commandId !== command.commandId ||
        canonicalJson(atOrdinal) !== canonicalJson(command)
      ) {
        throw new Error(`fixed-five command log conflicts at ordinal ${String(command.ordinal)}`);
      }
      continue;
    }
    ordinalByCommandId.set(command.commandId, command.ordinal);
    byOrdinal.set(command.ordinal, command);
  }
  return [...byOrdinal.values()].sort((a, b) => a.ordinal - b.ordinal);
}
export function restoreFixedFiveCommandSyncState(storedCommands: FixedFiveCommand[]): {
  commands: FixedFiveCommand[];
  lastOrdinal: number;
} {
  const merged = mergeFixedFiveCommands([], storedCommands);
  const commands: FixedFiveCommand[] = [];
  let lastOrdinal = -1;
  for (const command of merged) {
    if (command.ordinal !== lastOrdinal + 1) break;
    commands.push(command);
    lastOrdinal = command.ordinal;
  }
  return { commands, lastOrdinal };
}
export function roomLogFacts(commands: FixedFiveCommand[]): RoomLogFacts {
  const facts: RoomLogFacts = {
    ready: { p1: false, p2: false },
    rematchRequested: { p1: false, p2: false },
    rematchConfirmed: { p1: false, p2: false },
    proposals: [],
    confirms: [],
  };
  for (const command of [...commands].sort((a, b) => a.ordinal - b.ordinal)) {
    const payload = command.payload;
    if (payload.kind === 'ready') facts.ready[command.actorParticipantId] = payload.ready;
    if (payload.kind === 'rematch-request')
      facts.rematchRequested[command.actorParticipantId] = true;
    if (payload.kind === 'rematch-confirm')
      facts.rematchConfirmed[command.actorParticipantId] = true;
    if (payload.kind === 'propose-result')
      facts.proposals.push({ actor: command.actorParticipantId, digest: payload.resultDigest });
    if (payload.kind === 'confirm-result')
      facts.confirms.push({
        actor: command.actorParticipantId,
        digest: payload.resultDigest,
        verified: payload.verified,
      });
  }
  return facts;
}
export function deriveEffectivePhase(
  serverPhase: FixedFiveRoomPhase,
  replay: DraftReplay,
  localSimDone: boolean,
): FixedFiveRoomPhase {
  if (serverPhase !== 'lobby') return serverPhase;
  if (!replay.hasStart) return 'lobby';
  if (!isDraftComplete(replay)) return 'drafting';
  if (!localSimDone) return 'simulating';
  return 'awaiting-confirmation';
}
export function overlaySnapshotProgress(
  snapshot: FixedFiveRoomSnapshot,
  replay: DraftReplay,
  facts: RoomLogFacts,
): FixedFiveRoomSnapshot {
  return {
    ...snapshot,
    members: snapshot.members.map((member) => ({
      ...member,
      ready: facts.ready[member.participantId] || member.ready,
      picksCommitted: picksCommittedOf(replay, member.participantId),
      locked: lockedOf(replay, member.participantId),
    })),
  };
}
export interface PickRef extends PlayerRef {
  slotIndex: SlotIndex;
}
export function refsForParticipant(
  replay: DraftReplay,
  assets: FixedFiveAssets,
  participant: FixedFiveParticipantId,
): PickRef[] {
  if (replay.mode === 'duel') {
    return replay.state.picks
      .filter((p) => p.participantId === participant)
      .map((p) => ({
        playerId: p.playerId,
        franchiseId: p.franchiseId,
        eraId: p.eraId,
        slotIndex: p.slotIndex,
      }));
  }
  if (replay.mode === 'sandbox-duel') {
    return replay.state.picks
      .filter((p) => p.participantId === participant)
      .map((pick) => {
        const candidate = assets.poolById.get(pick.playerId);
        if (!candidate) throw new Error(`sandbox duel pick ${pick.playerId} has no pool record`);
        return {
          playerId: pick.playerId,
          franchiseId: candidate.franchiseId,
          eraId: candidate.eraId,
          slotIndex: pick.slotIndex,
        };
      });
  }
  if (replay.mode === 'sandbox-shared-82') {
    const builder = participant === 'p1' ? replay.p1 : replay.p2;
    return builder.placements.map((placement) => {
      const candidate = assets.poolById.get(placement.playerId);
      if (!candidate) throw new Error(`sandbox pick ${placement.playerId} has no pool record`);
      return {
        playerId: placement.playerId,
        franchiseId: candidate.franchiseId,
        eraId: candidate.eraId,
        slotIndex: placement.slotIndex,
      };
    });
  }
  const draft = participant === 'p1' ? replay.p1 : replay.p2;
  return draft.picks.map((pick) => ({
    playerId: pick.playerId,
    franchiseId: pick.franchiseId,
    eraId: pick.eraId,
    slotIndex: pick.slotIndex,
  }));
}
export async function buildSimulationTeam(
  manifest: HoopRushManifest,
  teamId: string,
  displayName: string,
  refs: PickRef[],
): Promise<FixedFiveWorkerTeam> {
  const ordered = [...refs].sort((a, b) => a.slotIndex - b.slotIndex);
  const peaks: PeakPlayerSeason[] = await resolvePlayerRefs(ordered, manifest);
  const players = peaks.map((peak) => toSimulationPlayer(peak));
  const [a, b, c, d, e] = players;
  if (!a || !b || !c || !d || !e || players.length !== 5) {
    throw new Error('a fixed-five team needs exactly five players');
  }
  return { teamId, displayName, players: [a, b, c, d, e] };
}
export function lineupEntryFor(refs: PickRef[], players: SimulationPlayer[]): FixedFiveLineupEntry {
  const byId = new Map(players.map((p) => [p.playerId, p]));
  return {
    lineup: {
      structure: ['G', 'G', 'F', 'F', 'C'],
      assignments: refs.map((ref) => {
        const playerId = playerIdSchema.parse(ref.playerId);
        const player = byId.get(playerId);
        if (!player) throw new Error(`lineup is missing snapshot for ${ref.playerId}`);
        return { slotIndex: ref.slotIndex, playerId, positions: player.positions };
      }),
    },
    players,
  };
}
export interface CompetitionAssembleInput {
  roomId: string;
  sourceMode: FixedFiveRoomSettings['sourceMode'];
  competition: FixedFiveCompetitionRun['competition'];
  rootSeed: Seed;
  versions: FixedFiveRoomSettings['versions'];
  commands: FixedFiveCommand[];
  p1: {
    refs: PickRef[];
    players: SimulationPlayer[];
  };
  p2: {
    refs: PickRef[];
    players: SimulationPlayer[];
  };
  result: FixedFiveCompetitionRun['result'];
  resultDigest: string;
  weakestReplacedOpponentId: string | null;
}
export function assembleCompetitionRun(input: CompetitionAssembleInput): FixedFiveCompetitionRun {
  const tiebreakWinner = fixedFiveTiebreakWinner(input.rootSeed);
  return {
    schemaVersion: 1,
    runId: idSchema.parse(input.roomId),
    roomId: idSchema.parse(input.roomId),
    mode: input.sourceMode,
    competition: input.competition,
    lineups: {
      p1: lineupEntryFor(input.p1.refs, input.p1.players),
      p2: lineupEntryFor(input.p2.refs, input.p2.players),
    },
    rootSeed: input.rootSeed,
    versions: input.versions,
    acceptedCommands: [...input.commands].sort((a, b) => a.ordinal - b.ordinal),
    authorityFacts: {
      tiebreakPath: FIXED_FIVE_TIEBREAK_PATH,
      tiebreakWinner,
      weakestReplacedOpponentId: input.weakestReplacedOpponentId,
    },
    resultDigest: contentHashSchema.parse(input.resultDigest),
    result: input.result,
  };
}
const ACTIVITY_PREFIX = 'hoop-rush:fixed-five:activity:';
export function loadActivityAt(roomId: string): number | null {
  try {
    const raw = localStorage.getItem(`${ACTIVITY_PREFIX}${roomId}`);
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}
export function saveActivityNow(roomId: string): void {
  try {
    localStorage.setItem(`${ACTIVITY_PREFIX}${roomId}`, String(Date.now()));
  } catch {}
}
export function pickOrdinalOf(replay: DraftReplay, participant: FixedFiveParticipantId): number {
  if (replay.mode === 'duel') return replay.state.pickOrdinal;
  if (replay.mode === 'sandbox-duel') return replay.state.pickOrdinal;
  if (replay.mode === 'sandbox-shared-82') {
    return (participant === 'p1' ? replay.p1 : replay.p2).placements.length;
  }
  return (participant === 'p1' ? replay.p1 : replay.p2).picks.length;
}
export function timeoutMsFor(mode: FixedFiveRoomMode): number {
  return fixedFiveTimeoutMsForMode(mode);
}
export function computeDueAutopick(
  mode: FixedFiveRoomMode,
  rootSeed: Seed,
  replay: DraftReplay,
  assets: FixedFiveAssets,
  participant: FixedFiveParticipantId,
): AutopickSelection | null {
  if (!replay.hasStart || isDraftComplete(replay)) return null;
  const ordinal = pickOrdinalOf(replay, participant);
  if (mode === 'sandbox-shared-82') {
    if (replay.mode !== 'sandbox-shared-82') return null;
    const builder = participant === 'p1' ? replay.p1 : replay.p2;
    if (builder.locked) return null;
    const safe = enumerateSandboxSafeMoves(assets.pool, builder);
    if (safe.length === 0) return null;
    return chooseAutopick(rootSeed, mode, participant, ordinal, safe);
  }
  if (mode === 'duel') {
    if (replay.mode === 'sandbox-duel') {
      if (!isFixedFiveDraftTurn(replay, participant)) return null;
      const safe = enumerateSandboxDuelSafeMoves(assets.pool, replay.state);
      if (safe.length === 0) return null;
      return chooseAutopick(rootSeed, mode, participant, ordinal, safe);
    }
    if (replay.mode !== 'duel') return null;
    if (!isFixedFiveDraftTurn(replay, participant)) return null;
    const safe = enumerateDuelSafeMoves(assets.catalog, assets.poolById, replay.state);
    if (safe.length === 0) return null;
    return chooseAutopick(rootSeed, mode, participant, ordinal, safe);
  }
  if (replay.mode !== 'classic-shared-82') return null;
  const draft = participant === 'p1' ? replay.p1 : replay.p2;
  if (draft.status !== 'drafting') return null;
  const safe = enumerateClassicSafeMoves(assets.catalog, assets.poolById, draft);
  if (safe.length === 0) return null;
  return chooseAutopick(rootSeed, mode, participant, ordinal, safe);
}
export { FIXED_SANDBOX_ERA };
export type { FixedFiveCandidate };
export interface WorkerSummaryInput {
  mode: FixedFiveRoomMode;
  bracket: OpponentBracket;
  rootSeed: Seed;
  p1TeamId: string;
  p2TeamId: string;
  entries: FixedFiveWorkerResultEntry[];
}
export function summarizeWorkerEntries(input: WorkerSummaryInput): {
  result: FixedFiveCompetitionResult;
  weakestReplacedOpponentId: string | null;
} {
  if (input.mode === 'duel') {
    const { result } = summarizeDuelGames({
      games: input.entries.map((entry) => entry.game),
      p1TeamId: input.p1TeamId,
      p2TeamId: input.p2TeamId,
      rootSeed: input.rootSeed,
    });
    return { result, weakestReplacedOpponentId: null };
  }
  const h2h = input.entries.filter((entry) => entry.tag === 'h2h').map((entry) => entry.game);
  const p1NonH2h = input.entries.filter((entry) => entry.tag === 'p1').map((entry) => entry.game);
  const p2NonH2h = input.entries.filter((entry) => entry.tag === 'p2').map((entry) => entry.game);
  const { result } = summarizeShared82Games({
    bracket: input.bracket,
    rootSeed: input.rootSeed,
    h2h,
    p1NonH2h,
    p2NonH2h,
  });
  return { result, weakestReplacedOpponentId: result.weakestReplacedOpponentId };
}
export interface DigestInput {
  rootSeed: Seed;
  versions: FixedFiveRoomSettings['versions'];
  p1: {
    refs: PickRef[];
    players: SimulationPlayer[];
  };
  p2: {
    refs: PickRef[];
    players: SimulationPlayer[];
  };
  commands: FixedFiveCommand[];
  result: FixedFiveCompetitionResult;
}
export function computeCompetitionDigest(input: DigestInput): ContentHash {
  return fixedFiveResultDigest({
    rootSeed: input.rootSeed,
    versions: input.versions,
    lineups: {
      p1: lineupEntryFor(input.p1.refs, input.p1.players),
      p2: lineupEntryFor(input.p2.refs, input.p2.players),
    },
    acceptedCommands: [...input.commands].sort((a, b) => a.ordinal - b.ordinal),
    result: input.result,
  });
}
