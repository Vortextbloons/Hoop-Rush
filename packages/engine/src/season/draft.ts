import {
  SEASON_DRAFT_VERSION,
  seasonDraftCatalogSchema,
  seasonDraftStateSchema,
  seasonLeagueSchema,
  seasonNamespaceSeed,
  seasonDigestHex,
  type SeasonDraftCatalog,
  type SeasonDraftCommand,
  type SeasonDraftCommandRecord,
  type SeasonDraftErrorCode,
  type SeasonDraftParticipant,
  type SeasonDraftPick,
  type SeasonDraftReveal,
  type SeasonDraftRollAttempt,
  type SeasonDraftState,
} from '@hoop-rush/data-contracts';
import { createRng } from '../sim/rng.js';
import {
  completionTargetsMet,
  legalFiveAfterAnyRemoval,
  rosterFeasible,
  type SeasonRosterMemberInput,
} from './roster-rules.js';
import {
  SeasonAiGenerationError,
  type SeasonAiGenerationInput,
  type SeasonLeagueGenerationResult,
} from './ai.js';

export type { SeasonAiGenerationInput, SeasonLeagueGenerationResult };

/**
 * Authoritative Season Run human draft commands (spec/2.0/03, season-draft-v1,
 * M2.1). One typed command path covers creating a one- or two-human draft,
 * revealing the current participant's roll, claiming the revealed exact
 * franchise-era pair, selecting one legal player version, finalizing human
 * rosters, and generating the remaining AI league. Commands are pure: every
 * roll derives from stable seeds keyed by participant, round, pick ordinal,
 * and recovery attempt, and the state is a pure function of (create inputs,
 * seed, command sequence). Duplicate command ids are idempotent; stale
 * revisions are rejected; every result is an accepted or rejected record.
 */

/** Named seed keys for the draft namespace (spec/2.0/07 seed tree). */
const DRAFT_SEED_KEYS = {
  franchiseAssignment: 'franchise-assignment',
  firstPick: 'first-pick',
  roll: 'roll',
} as const;

const MAX_PICKS_PER_PARTICIPANT = 10;
const ROUND_COUNT = 10;

function pairKey(franchiseId: string, eraId: string): string {
  return `${franchiseId}/${eraId}`;
}

function canonicalPoolSort<T extends { franchiseId: string; eraId: string }>(
  pools: readonly T[],
): T[] {
  return [...pools].sort(
    (a, b) => a.franchiseId.localeCompare(b.franchiseId) || a.eraId.localeCompare(b.eraId),
  );
}

function participantIdsOf(state: SeasonDraftState): string[] {
  return [...state.participants.map((p) => p.participantId)].sort();
}

/** Snake order for a round: first pick participant first on odd rounds. */
function participantOrder(state: SeasonDraftState, round: number): string[] {
  const sorted = participantIdsOf(state);
  const base = [
    state.firstPickParticipantId,
    ...sorted.filter((id) => id !== state.firstPickParticipantId),
  ];
  return round % 2 === 1 ? base : [...base].reverse();
}

function pickCount(state: SeasonDraftState, participantId: string): number {
  return state.picks.filter((p) => p.participantId === participantId).length;
}

function ownedVersionIds(state: SeasonDraftState): Set<string> {
  return new Set(state.picks.map((p) => p.playerVersionId));
}

function claimedPairKeys(state: SeasonDraftState): Set<string> {
  return new Set(state.claims.map((c) => pairKey(c.franchiseId, c.eraId)));
}

/** All candidates the participant could still roll: not owned, not in a claimed pool. */
function availableCandidates(
  state: SeasonDraftState,
  catalog: SeasonDraftCatalog,
): SeasonDraftCatalog['candidates'] {
  const owned = ownedVersionIds(state);
  const claimed = claimedPairKeys(state);
  return catalog.candidates.filter(
    (candidate) =>
      !owned.has(candidate.playerVersionId) &&
      !claimed.has(pairKey(candidate.franchiseId, candidate.eraId)),
  );
}

/** Feasibility-search members for the participant's remaining pool. */
function availableMembers(
  state: SeasonDraftState,
  catalog: SeasonDraftCatalog,
): SeasonRosterMemberInput[] {
  return availableCandidates(state, catalog).map((candidate) => ({
    playerVersionId: candidate.playerVersionId,
    playable: candidate.positions.playable,
  }));
}

function membersOf(
  versionIds: readonly string[],
  catalog: SeasonDraftCatalog,
): SeasonRosterMemberInput[] {
  const byId = new Map(catalog.candidates.map((c) => [c.playerVersionId, c]));
  const members: SeasonRosterMemberInput[] = [];
  for (const versionId of versionIds) {
    const candidate = byId.get(versionId);
    if (candidate === undefined) {
      throw new Error(`catalog is missing owned version ${versionId}`);
    }
    members.push({ playerVersionId: versionId, playable: candidate.positions.playable });
  }
  return members;
}

/**
 * True when selecting any unowned member of the pool keeps the participant's
 * completion targets feasible. Candidate fungibility: only the coarse group
 * mask of the added candidate matters, so the check probes at most one
 * candidate per mask.
 */
function poolKeepsFeasibility(
  pool: SeasonDraftCatalog['pools'][number],
  state: SeasonDraftState,
  catalog: SeasonDraftCatalog,
  participantId: string,
): boolean {
  const owned = ownedVersionIds(state);
  const ownedMembers = membersOf(
    state.picks.filter((p) => p.participantId === participantId).map((p) => p.playerVersionId),
    catalog,
  );
  const remaining = MAX_PICKS_PER_PARTICIPANT - ownedMembers.length;
  if (remaining <= 0) return false;
  const seenMasks = new Set<number>();
  for (const versionId of pool.playerVersionIds) {
    if (owned.has(versionId)) continue;
    const candidate = catalog.candidates.find((c) => c.playerVersionId === versionId);
    if (candidate === undefined) continue;
    const mask = candidate.positions.playable.reduce<number>(
      (acc, position) =>
        acc |
        (position === 'PG' || position === 'SG'
          ? 1
          : position === 'SF' || position === 'PF'
            ? 2
            : 4),
      0,
    );
    if (seenMasks.has(mask)) continue;
    seenMasks.add(mask);
    const probe: SeasonRosterMemberInput[] = [
      ...ownedMembers,
      { playerVersionId: versionId, playable: candidate.positions.playable },
    ];
    // The probed candidate itself is no longer available for future picks.
    const available = availableMembers(state, catalog).filter(
      (member) => member.playerVersionId !== versionId,
    );
    if (rosterFeasible(probe, available, remaining - 1)) return true;
  }
  return false;
}

/**
 * Canonical digest of the full draft state (deterministic facts only: turn,
 * rolls, claims, picks, status, revision, and the command log). Two states
 * are replay-identical exactly when their digests match.
 */
export function seasonDraftStateDigest(state: SeasonDraftState): string {
  return seasonDigestHex(seasonDraftStateCanonical(state));
}

/** Canonical byte-for-byte serialization of a draft state. */
export function seasonDraftStateCanonical(state: SeasonDraftState): string {
  return JSON.stringify({
    draftVersion: state.draftVersion,
    runId: state.runId,
    rootSeed: state.rootSeed,
    league: state.league,
    participants: [...state.participants].sort((a, b) =>
      a.participantId < b.participantId ? -1 : 1,
    ),
    firstPickParticipantId: state.firstPickParticipantId,
    round: state.round,
    currentTurnParticipantId: state.currentTurnParticipantId,
    status: state.status,
    revision: state.revision,
    currentReveal: state.currentReveal,
    rolls: state.rolls,
    claims: [...state.claims].sort((a, b) =>
      `${a.participantId}:${a.franchiseId}:${a.eraId}` <
      `${b.participantId}:${b.franchiseId}:${b.eraId}`
        ? -1
        : 1,
    ),
    picks: [...state.picks].sort((a, b) =>
      `${a.participantId}:${String(a.round)}` < `${b.participantId}:${String(b.round)}` ? -1 : 1,
    ),
    commandLog: state.commandLog,
  });
}

function rejectedRecord(
  state: SeasonDraftState | null,
  command: SeasonDraftCommand,
  errorCode: SeasonDraftErrorCode,
  message: string,
): SeasonDraftCommandRecord {
  return {
    status: 'rejected',
    commandId: command.commandId,
    revision: state?.revision ?? 0,
    errorCode,
    message,
    command,
  };
}

function withLog(state: SeasonDraftState, record: SeasonDraftCommandRecord): SeasonDraftState {
  return { ...state, commandLog: [...state.commandLog, record] };
}

/** Builds the accepted record against the already-finalized next state. */
function acceptedAgainst(
  nextState: SeasonDraftState,
  command: SeasonDraftCommand,
  revisionBefore: number,
): SeasonDraftCommandRecord {
  return {
    status: 'accepted',
    commandId: command.commandId,
    revisionBefore,
    revisionAfter: nextState.revision,
    stateDigest: seasonDraftStateDigest(nextState),
    command,
  };
}

interface CommandResult {
  state: SeasonDraftState | null;
  record: SeasonDraftCommandRecord;
  generation: SeasonLeagueGenerationResult | null;
}

function createDraft(command: SeasonDraftCommand, catalog: SeasonDraftCatalog): CommandResult {
  const payload = command.payload;
  if (payload.kind !== 'create-season-draft') {
    throw new Error('createDraft requires a create-season-draft payload');
  }
  const reject = (code: SeasonDraftErrorCode, message: string): CommandResult => ({
    state: null,
    record: rejectedRecord(null, command, code, message),
    generation: null,
  });
  const leagueParse = seasonLeagueSchema.safeParse(payload.league);
  if (!leagueParse.success) {
    return reject('INVALID_CATALOG', 'create-season-draft league fails the league schema');
  }
  const league = leagueParse.data;
  const humanIds = payload.humanParticipantIds;
  if (new Set(humanIds).size !== humanIds.length) {
    return reject('INVALID_CATALOG', 'human participant ids must be distinct');
  }
  if (catalog.pools.length < ROUND_COUNT * humanIds.length) {
    return reject(
      'UNCOMPLETABLE_ROSTER',
      `catalog has ${String(catalog.pools.length)} claimable pools; need at least ${String(ROUND_COUNT * humanIds.length)} for ${String(humanIds.length)} participant(s) over ${String(ROUND_COUNT)} rounds`,
    );
  }
  // Distinct seeded franchise assignments for the human participants.
  const assignmentRng = createRng(
    seasonNamespaceSeed(payload.rootSeed, 'draft', DRAFT_SEED_KEYS.franchiseAssignment),
  );
  const remainingFranchises = league.teams.map((team) => team.franchiseId).sort();
  const participants: SeasonDraftParticipant[] = [];
  for (const participantId of [...humanIds].sort()) {
    if (remainingFranchises.length === 0) {
      return reject('INVALID_CATALOG', 'no distinct franchise remains for a participant');
    }
    const franchiseId = assignmentRng.pick(remainingFranchises);
    participants.push({ participantId, franchiseId });
    remainingFranchises.splice(remainingFranchises.indexOf(franchiseId), 1);
  }
  const firstPickParticipantId = createRng(
    seasonNamespaceSeed(payload.rootSeed, 'draft', DRAFT_SEED_KEYS.firstPick),
  ).pick([...humanIds].sort());
  const bareState: SeasonDraftState = {
    schemaVersion: 1,
    draftVersion: SEASON_DRAFT_VERSION,
    runId: payload.runId,
    rootSeed: payload.rootSeed,
    league,
    catalogVersion: 'season-draft-v1',
    participants,
    firstPickParticipantId,
    round: 1,
    currentTurnParticipantId: firstPickParticipantId,
    status: 'drafting',
    revision: 1,
    currentReveal: null,
    rolls: [],
    claims: [],
    picks: [],
    commandLog: [],
  };
  const record = acceptedAgainst(bareState, command, 0);
  const state = withLog(bareState, record);
  return { state, record, generation: null };
}

/** Next turn after a successful pick; null current turn when everyone is full. */
function advanceTurn(state: SeasonDraftState): {
  round: number;
  currentTurnParticipantId: string | null;
} {
  const allFull = state.participants.every(
    (p) => pickCount(state, p.participantId) >= MAX_PICKS_PER_PARTICIPANT,
  );
  if (allFull) {
    return { round: ROUND_COUNT, currentTurnParticipantId: null };
  }
  const order = participantOrder(state, state.round);
  const currentIndex = order.indexOf(state.currentTurnParticipantId ?? '');
  for (let i = currentIndex + 1; i < order.length; i += 1) {
    const id = order[i];
    if (id !== undefined && pickCount(state, id) < MAX_PICKS_PER_PARTICIPANT) {
      return { round: state.round, currentTurnParticipantId: id };
    }
  }
  const nextRound = state.round + 1;
  if (nextRound > ROUND_COUNT) {
    return { round: ROUND_COUNT, currentTurnParticipantId: null };
  }
  const nextOrder = participantOrder(state, nextRound);
  const nextPicker = nextOrder.find((id) => pickCount(state, id) < MAX_PICKS_PER_PARTICIPANT);
  if (nextPicker === undefined) {
    return { round: ROUND_COUNT, currentTurnParticipantId: null };
  }
  return { round: nextRound, currentTurnParticipantId: nextPicker };
}

function revealRoll(
  state: SeasonDraftState,
  catalog: SeasonDraftCatalog,
  command: SeasonDraftCommand,
): CommandResult {
  const payload = command.payload;
  if (payload.kind !== 'reveal-draft-roll') throw new Error('revealRoll requires a reveal payload');
  const pid = payload.participantId;
  if (state.status !== 'drafting' || state.currentTurnParticipantId === null) {
    return {
      state,
      record: rejectedRecord(state, command, 'WRONG_TURN', 'no turn is active for a reveal'),
      generation: null,
    };
  }
  if (pid !== state.currentTurnParticipantId) {
    return {
      state,
      record: rejectedRecord(
        state,
        command,
        'WRONG_TURN',
        `it is ${state.currentTurnParticipantId}'s turn, not ${pid}'s`,
      ),
      generation: null,
    };
  }
  const round = state.round;
  const pickOrdinal = pickCount(state, pid) + 1;
  if (state.currentReveal !== null) {
    // The current turn already has a revealed pool; reveal is an accepted no-op.
    const nextState: SeasonDraftState = { ...state, revision: state.revision + 1 };
    const record = acceptedAgainst(nextState, command, state.revision);
    return { state: withLog(nextState, record), record, generation: null };
  }
  const claimed = claimedPairKeys(state);
  const attempts: SeasonDraftRollAttempt[] = [];
  const attemptedThisReveal = new Set<string>();
  let revealedPair: { franchiseId: string; eraId: string } | null = null;
  for (let attemptIndex = 0; ; attemptIndex += 1) {
    const candidates = canonicalPoolSort(
      catalog.pools.filter(
        (pool) =>
          !claimed.has(pairKey(pool.franchiseId, pool.eraId)) &&
          !attemptedThisReveal.has(pairKey(pool.franchiseId, pool.eraId)),
      ),
    );
    if (candidates.length === 0) {
      return {
        state,
        record: rejectedRecord(
          state,
          command,
          'UNCOMPLETABLE_ROSTER',
          'no unclaimed pool with a feasible selection remains',
        ),
        generation: null,
      };
    }
    const rollSeed = seasonNamespaceSeed(
      state.rootSeed,
      'draft',
      DRAFT_SEED_KEYS.roll,
      pid,
      String(round),
      String(pickOrdinal),
      String(attemptIndex),
    );
    const pool = createRng(rollSeed).pick(candidates);
    attemptedThisReveal.add(pairKey(pool.franchiseId, pool.eraId));
    const usable = poolKeepsFeasibility(pool, state, catalog, pid);
    attempts.push({
      franchiseId: pool.franchiseId,
      eraId: pool.eraId,
      attemptIndex,
      usable,
    });
    if (usable) {
      revealedPair = { franchiseId: pool.franchiseId, eraId: pool.eraId };
      break;
    }
  }
  void revealedPair;
  const reveal: SeasonDraftReveal = {
    participantId: pid,
    round,
    pickOrdinal,
    attempts,
  };
  const nextState: SeasonDraftState = {
    ...state,
    rolls: [...state.rolls, ...attempts],
    currentReveal: reveal,
    revision: state.revision + 1,
  };
  const record = acceptedAgainst(nextState, command, state.revision);
  return { state: withLog(nextState, record), record, generation: null };
}

function claimPool(state: SeasonDraftState, command: SeasonDraftCommand): CommandResult {
  const payload = command.payload;
  if (payload.kind !== 'claim-draft-pool') throw new Error('claimPool requires a claim payload');
  const pid = payload.participantId;
  if (state.status !== 'drafting' || state.currentTurnParticipantId === null) {
    return {
      state,
      record: rejectedRecord(state, command, 'WRONG_TURN', 'no turn is active for a claim'),
      generation: null,
    };
  }
  if (pid !== state.currentTurnParticipantId) {
    return {
      state,
      record: rejectedRecord(
        state,
        command,
        'WRONG_TURN',
        `it is ${state.currentTurnParticipantId}'s turn, not ${pid}'s`,
      ),
      generation: null,
    };
  }
  if (state.currentReveal === null) {
    return {
      state,
      record: rejectedRecord(
        state,
        command,
        'UNAVAILABLE_POOL',
        'no pool is revealed for this turn',
      ),
      generation: null,
    };
  }
  const reveal = state.currentReveal;
  const lastAttempt = reveal.attempts[reveal.attempts.length - 1];
  if (lastAttempt === undefined || !lastAttempt.usable) {
    return {
      state,
      record: rejectedRecord(state, command, 'UNAVAILABLE_POOL', 'the revealed pool is not usable'),
      generation: null,
    };
  }
  if (payload.franchiseId !== lastAttempt.franchiseId || payload.eraId !== lastAttempt.eraId) {
    return {
      state,
      record: rejectedRecord(
        state,
        command,
        'UNAVAILABLE_POOL',
        `claim ${payload.franchiseId}/${payload.eraId} does not match the revealed pool ${lastAttempt.franchiseId}/${lastAttempt.eraId}`,
      ),
      generation: null,
    };
  }
  if (
    state.claims.some(
      (c) =>
        c.participantId === pid &&
        c.franchiseId === payload.franchiseId &&
        c.eraId === payload.eraId,
    )
  ) {
    // Already claimed: accepted no-op.
    const nextState: SeasonDraftState = { ...state, revision: state.revision + 1 };
    const record = acceptedAgainst(nextState, command, state.revision);
    return { state: withLog(nextState, record), record, generation: null };
  }
  const nextState: SeasonDraftState = {
    ...state,
    claims: [
      ...state.claims,
      { participantId: pid, franchiseId: payload.franchiseId, eraId: payload.eraId },
    ],
    revision: state.revision + 1,
  };
  const record = acceptedAgainst(nextState, command, state.revision);
  return { state: withLog(nextState, record), record, generation: null };
}

function selectPlayer(
  state: SeasonDraftState,
  catalog: SeasonDraftCatalog,
  command: SeasonDraftCommand,
): CommandResult {
  const payload = command.payload;
  if (payload.kind !== 'select-draft-player') {
    throw new Error('selectPlayer requires a select payload');
  }
  const pid = payload.participantId;
  if (state.status !== 'drafting' || state.currentTurnParticipantId === null) {
    return {
      state,
      record: rejectedRecord(
        state,
        command,
        'ILLEGAL_PICK',
        'the draft is not in a pickable state',
      ),
      generation: null,
    };
  }
  if (pid !== state.currentTurnParticipantId) {
    return {
      state,
      record: rejectedRecord(
        state,
        command,
        'WRONG_TURN',
        `it is ${state.currentTurnParticipantId}'s turn, not ${pid}'s`,
      ),
      generation: null,
    };
  }
  if (state.currentReveal === null) {
    return {
      state,
      record: rejectedRecord(
        state,
        command,
        'UNAVAILABLE_POOL',
        'no pool is revealed for this turn',
      ),
      generation: null,
    };
  }
  const reveal = state.currentReveal;
  const lastAttempt = reveal.attempts[reveal.attempts.length - 1];
  if (lastAttempt === undefined || !lastAttempt.usable) {
    return {
      state,
      record: rejectedRecord(state, command, 'UNAVAILABLE_POOL', 'the revealed pool is not usable'),
      generation: null,
    };
  }
  const candidate = catalog.candidates.find((c) => c.playerVersionId === payload.playerVersionId);
  if (candidate === undefined) {
    return {
      state,
      record: rejectedRecord(
        state,
        command,
        'UNAVAILABLE_POOL',
        'the selected version is not in the catalog',
      ),
      generation: null,
    };
  }
  if (candidate.franchiseId !== lastAttempt.franchiseId || candidate.eraId !== lastAttempt.eraId) {
    return {
      state,
      record: rejectedRecord(
        state,
        command,
        'UNAVAILABLE_POOL',
        `version ${payload.playerVersionId} is not in the revealed pool ${lastAttempt.franchiseId}/${lastAttempt.eraId}`,
      ),
      generation: null,
    };
  }
  if (state.picks.some((p) => p.playerVersionId === payload.playerVersionId)) {
    return {
      state,
      record: rejectedRecord(
        state,
        command,
        'OWNED_VERSION',
        'that player version is already owned',
      ),
      generation: null,
    };
  }
  if (pickCount(state, pid) >= MAX_PICKS_PER_PARTICIPANT) {
    return {
      state,
      record: rejectedRecord(state, command, 'ILLEGAL_PICK', 'the roster is already full'),
      generation: null,
    };
  }
  const ownedMembers = membersOf(
    state.picks.filter((p) => p.participantId === pid).map((p) => p.playerVersionId),
    catalog,
  );
  const probe: SeasonRosterMemberInput[] = [
    ...ownedMembers,
    { playerVersionId: candidate.playerVersionId, playable: candidate.positions.playable },
  ];
  // The candidate itself is no longer available for future picks.
  const available = availableMembers(state, catalog).filter(
    (member) => member.playerVersionId !== candidate.playerVersionId,
  );
  const remaining = MAX_PICKS_PER_PARTICIPANT - ownedMembers.length - 1;
  if (!rosterFeasible(probe, available, remaining)) {
    return {
      state,
      record: rejectedRecord(
        state,
        command,
        'UNCOMPLETABLE_ROSTER',
        'this pick would make the final roster constraints impossible',
      ),
      generation: null,
    };
  }
  const pick: SeasonDraftPick = {
    participantId: pid,
    round: reveal.round,
    pickOrdinal: reveal.pickOrdinal,
    playerVersionId: payload.playerVersionId,
    franchiseId: candidate.franchiseId,
    eraId: candidate.eraId,
    rollAttempts: reveal.attempts.length,
  };
  const withPick = { ...state, picks: [...state.picks, pick] };
  const { round, currentTurnParticipantId } = advanceTurn(withPick);
  const nextState: SeasonDraftState = {
    ...withPick,
    currentReveal: null,
    round,
    currentTurnParticipantId,
    revision: state.revision + 1,
  };
  const record = acceptedAgainst(nextState, command, state.revision);
  return { state: withLog(nextState, record), record, generation: null };
}

function finalizeRosters(
  state: SeasonDraftState,
  catalog: SeasonDraftCatalog,
  command: SeasonDraftCommand,
): CommandResult {
  if (state.status !== 'drafting') {
    return {
      state,
      record: rejectedRecord(state, command, 'ILLEGAL_PICK', 'finalize requires a drafting state'),
      generation: null,
    };
  }
  for (const participant of state.participants) {
    const picks = state.picks.filter((p) => p.participantId === participant.participantId);
    if (picks.length !== MAX_PICKS_PER_PARTICIPANT) {
      return {
        state,
        record: rejectedRecord(
          state,
          command,
          'UNCOMPLETABLE_ROSTER',
          `${participant.participantId} has ${String(picks.length)} picks; need ${String(MAX_PICKS_PER_PARTICIPANT)}`,
        ),
        generation: null,
      };
    }
    const members = membersOf(
      picks.map((p) => p.playerVersionId),
      catalog,
    );
    if (!completionTargetsMet(members)) {
      return {
        state,
        record: rejectedRecord(
          state,
          command,
          'UNCOMPLETABLE_ROSTER',
          `${participant.participantId}'s roster misses the 4/4/3 completion target`,
        ),
        generation: null,
      };
    }
    if (!legalFiveAfterAnyRemoval(members)) {
      return {
        state,
        record: rejectedRecord(
          state,
          command,
          'UNCOMPLETABLE_ROSTER',
          `${participant.participantId}'s roster has no legal five after every single absence`,
        ),
        generation: null,
      };
    }
  }
  const nextState: SeasonDraftState = {
    ...state,
    status: 'finalized',
    currentTurnParticipantId: null,
    revision: state.revision + 1,
  };
  const record = acceptedAgainst(nextState, command, state.revision);
  return { state: withLog(nextState, record), record, generation: null };
}

function generateAiLeague(
  state: SeasonDraftState,
  catalog: SeasonDraftCatalog,
  command: SeasonDraftCommand,
  deps: SeasonAiGenerationDeps,
): CommandResult {
  if (state.status !== 'finalized') {
    return {
      state,
      record: rejectedRecord(
        state,
        command,
        'ILLEGAL_PICK',
        'generate-ai-league requires finalized human rosters',
      ),
      generation: null,
    };
  }
  const input: SeasonAiGenerationInput = {
    seed: state.rootSeed,
    catalog,
    league: state.league,
    humanFranchiseIds: state.participants.map((p) => p.franchiseId),
    humanRosters: state.participants.map((p) => ({
      franchiseId: p.franchiseId,
      playerVersionIds: state.picks
        .filter((pick) => pick.participantId === p.participantId)
        .map((pick) => pick.playerVersionId),
    })),
    targets: null,
  };
  let generation: SeasonLeagueGenerationResult;
  try {
    generation = deps.generate(input);
  } catch (error) {
    if (error instanceof SeasonAiGenerationError) {
      return {
        state,
        record: rejectedRecord(
          state,
          command,
          'GENERATION_EXHAUSTED',
          `${error.message}: ${String(error.diagnostics.failedTeams.length)} failed teams, ${String(error.diagnostics.unmetConstraints.length)} unmet constraints, ${String(error.diagnostics.nodesVisited)} nodes visited`,
        ),
        generation: null,
      };
    }
    throw error;
  }
  const nextState: SeasonDraftState = {
    ...state,
    status: 'complete',
    revision: state.revision + 1,
  };
  const record = acceptedAgainst(nextState, command, state.revision);
  return { state: withLog(nextState, record), record, generation };
}

export interface SeasonAiGenerationDeps {
  /**
   * Deterministic AI league generation. Throws `SeasonAiGenerationError`
   * (code GENERATION_EXHAUSTED) with full diagnostics on budget exhaustion;
   * it never relaxes a constraint. Wired to the authoritative engine
   * implementation (season/ai.ts) at the application boundary.
   */
  generate: (input: SeasonAiGenerationInput) => SeasonLeagueGenerationResult;
}

/**
 * Applies one command to the draft state (null state only accepts the create
 * command) and returns the resulting state (null while nothing has been
 * created), its accepted or rejected record, and the completed generation
 * result when an accepted generate-ai-league command produced one. The
 * generation deps are injected so tests can substitute a fake generator;
 * production callers wire the authoritative AI seam.
 */
export function applySeasonDraftCommand(
  state: SeasonDraftState | null,
  catalog: SeasonDraftCatalog,
  command: SeasonDraftCommand,
  deps: SeasonAiGenerationDeps,
): {
  state: SeasonDraftState | null;
  record: SeasonDraftCommandRecord;
  generation: SeasonLeagueGenerationResult | null;
} {
  const catalogParse = seasonDraftCatalogSchema.safeParse(catalog);
  if (!catalogParse.success) {
    return {
      state,
      record: rejectedRecord(state, command, 'INVALID_CATALOG', 'draft catalog is invalid'),
      generation: null,
    };
  }
  const validatedCatalog = catalogParse.data;

  if (state === null) {
    if (command.payload.kind !== 'create-season-draft') {
      return {
        state: null,
        record: rejectedRecord(
          null,
          command,
          'INVALID_CATALOG',
          'no draft exists; only create-season-draft is accepted',
        ),
        generation: null,
      };
    }
    return createDraft(command, validatedCatalog);
  }

  const parsedState = seasonDraftStateSchema.safeParse(state);
  if (!parsedState.success) {
    throw new Error('draft state fails the schema; refusing to continue');
  }
  const validatedState = parsedState.data;

  // Idempotency: a previously executed commandId returns its stored record.
  const prior = validatedState.commandLog.find((record) => record.commandId === command.commandId);
  if (prior !== undefined) {
    return { state: validatedState, record: prior, generation: null };
  }

  if (command.expectedRevision !== validatedState.revision) {
    const record = rejectedRecord(
      validatedState,
      command,
      'STALE_REVISION',
      `expected revision ${String(validatedState.revision)}, got ${String(command.expectedRevision)}`,
    );
    return { state: withLog(validatedState, record), record, generation: null };
  }

  switch (command.payload.kind) {
    case 'create-season-draft': {
      const record = rejectedRecord(
        validatedState,
        command,
        'STALE_REVISION',
        'a draft already exists',
      );
      return { state: withLog(validatedState, record), record, generation: null };
    }
    case 'reveal-draft-roll':
      return revealRoll(validatedState, validatedCatalog, command);
    case 'claim-draft-pool':
      return claimPool(validatedState, command);
    case 'select-draft-player':
      return selectPlayer(validatedState, validatedCatalog, command);
    case 'finalize-human-rosters':
      return finalizeRosters(validatedState, validatedCatalog, command);
    case 'generate-ai-league':
      return generateAiLeague(validatedState, validatedCatalog, command, deps);
  }
}
