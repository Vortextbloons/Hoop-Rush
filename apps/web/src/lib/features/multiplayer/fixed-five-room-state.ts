import {
  idSchema,
  playerVersionId,
  type FixedFiveRoomSnapshot,
  type FixedFiveWorkerTeam,
  type HoopRushManifest,
  type PeakPlayerSeason,
} from '@hoop-rush/data-contracts';
import {
  createEngineContext,
  lockedOf,
  picksCommittedOf,
  toSimulationPlayer,
  type DraftReplay,
  type FixedFiveCandidate,
  type FixedFivePickRef,
  type RoomLogFacts,
} from '@hoop-rush/engine';
import type { FixedFiveSessionAssets } from '@hoop-rush/application/fixed-five';
import { z } from 'zod';
import { buildClassicCatalog } from '#lib/classic-draft.js';
import { getPlayersIndex } from '#lib/data.js';
import { resolvePlayerRefs } from '#lib/player-refs.js';
import { FIXED_SANDBOX_ERA, loadRunPreamble } from '#lib/run-preamble.js';

export type FixedFiveAssets = FixedFiveSessionAssets;

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

export { FIXED_SANDBOX_ERA };
export type { FixedFiveCandidate };
export {
  deriveEffectivePhase,
  isFixedFiveDraftTurn,
  roomLogFacts,
  timeoutMsFor,
  type DraftReplay,
  type RoomLogFacts,
} from '@hoop-rush/engine';
