import {
  idSchema,
  playerVersionId,
  type EraSimulationProfile,
  type FixedFiveParticipantId,
  type FixedFiveRoomSnapshot,
  type FixedFiveWorkerTeam,
  type HoopRushManifest,
  type OpponentBracket,
  type PeakPlayerSeason,
  type PlayersIndex,
} from '@hoop-rush/data-contracts';
import {
  createEngineContext,
  lockedOf,
  picksCommittedOf,
  toSimulationPlayer,
  verifyFixedFiveCompetition,
  type DraftReplay,
  type FixedFiveCandidate,
  type FixedFiveDraftLogInputs,
  type FixedFivePickRef,
  type FixedFiveVerificationInput,
  type FixedFiveVerificationResult,
  type RoomLogFacts,
} from '@hoop-rush/engine';
import { z } from 'zod';
import { buildClassicCatalog } from '$lib/classic-draft';
import { getPlayersIndex } from '$lib/data';
import { resolvePlayerRefs } from '$lib/player-refs';
import { FIXED_SANDBOX_ERA, loadRunPreamble } from '$lib/run-preamble';

export interface FixedFiveAssets extends FixedFiveDraftLogInputs {
  manifest: HoopRushManifest;
  profile: EraSimulationProfile;
  bracket: OpponentBracket;
  index: PlayersIndex;
}

export type PickRef = FixedFivePickRef;

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

function sandboxCandidateForPick(
  assets: FixedFiveAssets,
  playerId: string,
  versionId?: string,
): FixedFiveCandidate {
  const candidate =
    (versionId ? assets.pool.find((entry) => entry.playerVersionId === versionId) : null) ??
    assets.poolById.get(playerId);
  if (!candidate || candidate.playerId !== playerId)
    throw new Error(`sandbox pick ${playerId} has no matching pool record`);
  return candidate;
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
        const candidate = sandboxCandidateForPick(assets, pick.playerId, pick.playerVersionId);
        return {
          playerId: pick.playerId,
          franchiseId: candidate.franchiseId,
          eraId: candidate.eraId,
          slotIndex: pick.slotIndex,
          playerVersionId: candidate.playerVersionId,
        };
      });
  }
  if (replay.mode === 'sandbox-shared-82') {
    if (replay.draftStyle === 'snake') {
      return replay.state.picks
        .filter((p) => p.participantId === participant)
        .map((pick) => {
          const candidate = sandboxCandidateForPick(assets, pick.playerId, pick.playerVersionId);
          return {
            playerId: pick.playerId,
            franchiseId: candidate.franchiseId,
            eraId: candidate.eraId,
            slotIndex: pick.slotIndex,
            playerVersionId: candidate.playerVersionId,
          };
        });
    }
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

const ACTIVITY_PREFIX = 'hoop-rush:fixed-five:activity:';
const activityTimestampSchema = z.number().int().nonnegative();

export function loadActivityAt(roomId: string, now = Date.now()): number | null {
  try {
    if (!idSchema.safeParse(roomId).success) return null;
    const raw = localStorage.getItem(`${ACTIVITY_PREFIX}${roomId}`);
    if (!raw) return null;
    const parsed = activityTimestampSchema.safeParse(Number(raw));
    if (!parsed.success) return null;
    if (parsed.data > now + 5 * 60 * 1000) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export function saveActivityNow(roomId: string): void {
  try {
    localStorage.setItem(`${ACTIVITY_PREFIX}${roomId}`, String(Date.now()));
  } catch {}
}

export function verifyFixedFiveResult(
  input: FixedFiveVerificationInput,
  assets: FixedFiveAssets,
): FixedFiveVerificationResult {
  return verifyFixedFiveCompetition(input, assets.context);
}

export { FIXED_SANDBOX_ERA };
export type { FixedFiveCandidate };
export {
  assembleCompetitionRun,
  buildFixedFiveVerificationInput,
  computeCompetitionDigest,
  computeDueAutopick,
  deriveEffectivePhase,
  isDraftComplete,
  isFixedFiveDraftTurn,
  lineupEntryFor,
  mergeFixedFiveCommands,
  pickOrdinalOf,
  replayFixedFiveLog,
  restoreFixedFiveCommandSyncState,
  roomLogFacts,
  summarizeWorkerEntries,
  timeoutMsFor,
  type CompetitionAssembleInput,
  type CompetitionDigestInput,
  type DraftReplay,
  type RoomLogFacts,
  type VerificationInputBuild,
  type WorkerSummaryInput,
} from '@hoop-rush/engine';
