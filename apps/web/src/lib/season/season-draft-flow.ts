import type {
  EraId,
  FranchiseId,
  PlayerVersionId,
  SeasonDraftCatalog,
  SeasonDraftCommandPayload,
  SeasonDraftCommandRecord,
  SeasonDraftPick,
  SeasonDraftState,
  SeasonLeague,
  Seed,
  SeasonLeagueGenerationResult,
} from '@hoop-rush/data-contracts';
import {
  applySeasonDraftCommand,
  generateAiLeague,
  type SeasonAiGenerationDeps,
} from '@hoop-rush/engine';
import { recordFromState, type SeasonDraftRepository } from '@hoop-rush/persistence';
import { newSeasonId } from './season-ids';

/**
 * Season Run solo draft flow (spec/2.0/03, M2.1): the UI-side state machine
 * that wraps the authoritative engine commands (`applySeasonDraftCommand`) and
 * the persisted Season draft record. Business rules stay in the engine; this
 * module only issues typed commands against the live revision, persists each
 * accepted record, and exposes the presentation facts the board needs.
 *
 * The AI league generation is synchronous and bounded by
 * `AI_GENERATION_NODE_BUDGET`; `generate()` yields to the event loop first so
 * the "Generating league…" state can paint before the (bounded) computation
 * runs on the main thread. Moving generation into the worker is a noted
 * integration option for the lead.
 */

/** Solo Season Run participant id (one human franchise). */
export const SOLO_PARTICIPANT_ID = 'human';

/** The frozen completion targets every human roster must satisfy (4G/4F/3C). */
export const COVERAGE_TARGETS = { guards: 4, forwards: 4, centers: 3 } as const;

export type SeasonDraftFlowPhase = 'idle' | 'drafting' | 'finalized' | 'generating' | 'complete';

export interface SeasonDraftFlowState {
  /** Authoritative draft snapshot (null until a draft is created/loaded). */
  draft: SeasonDraftState | null;
  /** Completed league generation, once a generate command was accepted. */
  generation: SeasonLeagueGenerationResult | null;
  /** Last executed command record (accepted or rejected), for inline errors. */
  lastRecord: SeasonDraftCommandRecord | null;
  phase: SeasonDraftFlowPhase;
}

/** Counts of guard/forward/center-capable picks against the 4/4/3 targets. */
export function coverageNeeds(
  picks: readonly SeasonDraftPick[],
  catalog: SeasonDraftCatalog,
): { guards: number; forwards: number; centers: number } {
  const byId = new Map(catalog.candidates.map((c) => [c.playerVersionId, c]));
  let guards = 0;
  let forwards = 0;
  let centers = 0;
  for (const pick of picks) {
    const candidate = byId.get(pick.playerVersionId);
    if (!candidate) continue;
    const playable = new Set(candidate.positions.playable);
    if (playable.has('PG') || playable.has('SG')) guards += 1;
    if (playable.has('SF') || playable.has('PF')) forwards += 1;
    if (playable.has('C')) centers += 1;
  }
  return { guards, forwards, centers };
}

/** The claimable candidates of the currently revealed pool, in catalog order. */
export function revealPoolRows(
  state: SeasonDraftState,
  catalog: SeasonDraftCatalog,
): SeasonDraftCatalog['candidates'] {
  const reveal = state.currentReveal;
  const lastAttempt = reveal?.attempts[reveal.attempts.length - 1];
  if (!reveal || !lastAttempt || !lastAttempt.usable) return [];
  const pool = catalog.pools.find(
    (p) => p.franchiseId === lastAttempt.franchiseId && p.eraId === lastAttempt.eraId,
  );
  if (!pool) return [];
  const byId = new Map(catalog.candidates.map((c) => [c.playerVersionId, c]));
  return pool.playerVersionIds
    .map((id) => byId.get(id))
    .filter((c): c is NonNullable<typeof c> => c !== undefined);
}

/** Roll attempts of the current reveal (deterministic invalid-roll recovery). */
export function currentRevealAttempts(state: SeasonDraftState): SeasonDraftState['currentReveal'] {
  return state.currentReveal;
}

export class SeasonDraftFlow {
  private readonly repo: SeasonDraftRepository;
  private readonly catalogRef: SeasonDraftCatalog;
  private readonly deps: SeasonAiGenerationDeps;

  draft: SeasonDraftState | null = null;
  generation: SeasonLeagueGenerationResult | null = null;
  lastRecord: SeasonDraftCommandRecord | null = null;
  phase: SeasonDraftFlowPhase = 'idle';
  error: string | null = null;

  constructor(
    repo: SeasonDraftRepository,
    catalog: SeasonDraftCatalog,
    deps: SeasonAiGenerationDeps,
  ) {
    this.repo = repo;
    this.catalogRef = catalog;
    this.deps = deps;
  }

  /** The packaged catalog the flow validates commands against. */
  get catalog(): SeasonDraftCatalog {
    return this.catalogRef;
  }

  /** Loads a persisted draft; returns true when one exists. */
  async load(): Promise<boolean> {
    const stored = await this.repo.loadSeasonDraft();
    if (stored) {
      this.draft = stored.draft;
      this.generation = stored.generation;
      this.phase =
        stored.draft.status === 'complete'
          ? 'complete'
          : stored.draft.status === 'finalized'
            ? 'finalized'
            : 'drafting';
      return true;
    }
    return false;
  }

  /** Clears the persisted draft (leave-and-discard). */
  async clear(): Promise<void> {
    await this.repo.clearSeasonDraft();
    this.draft = null;
    this.generation = null;
    this.lastRecord = null;
    this.phase = 'idle';
    this.error = null;
  }

  /** Snapshot of the flow for the board. */
  state(): SeasonDraftFlowState {
    return {
      draft: this.draft,
      generation: this.generation,
      lastRecord: this.lastRecord,
      phase: this.phase,
    };
  }

  /** Starts a fresh solo draft against the frozen league + catalog. */
  async create(input: { rootSeed: Seed; league: SeasonLeague }): Promise<SeasonDraftCommandRecord> {
    this.error = null;
    const record = await this.apply(
      {
        kind: 'create-season-draft',
        runId: newSeasonId('run'),
        rootSeed: input.rootSeed,
        league: input.league,
        humanParticipantIds: [SOLO_PARTICIPANT_ID],
        catalogVersion: this.catalogRef.catalogVersion,
      },
      0,
    );
    return record;
  }

  async reveal(participantId: string = SOLO_PARTICIPANT_ID): Promise<SeasonDraftCommandRecord> {
    this.error = null;
    return this.apply({ kind: 'reveal-draft-roll', participantId }, this.revision());
  }

  async claim(
    participantId: string,
    franchiseId: FranchiseId,
    eraId: EraId,
  ): Promise<SeasonDraftCommandRecord> {
    this.error = null;
    return this.apply(
      { kind: 'claim-draft-pool', participantId, franchiseId, eraId },
      this.revision(),
    );
  }

  async pick(
    participantId: string,
    playerVersionId: PlayerVersionId,
  ): Promise<SeasonDraftCommandRecord> {
    this.error = null;
    return this.apply(
      { kind: 'select-draft-player', participantId, playerVersionId },
      this.revision(),
    );
  }

  async finalize(): Promise<SeasonDraftCommandRecord> {
    this.error = null;
    return this.apply({ kind: 'finalize-human-rosters' }, this.revision());
  }

  /**
   * Runs the bounded AI league generation. Yields to the event loop first so
   * the pending state paints, then runs the synchronous engine generator and
   * persists the stored record atomically.
   */
  async generate(): Promise<SeasonLeagueGenerationResult | null> {
    if (this.draft?.status !== 'finalized') {
      throw new Error('generate requires finalized human rosters');
    }
    this.error = null;
    this.phase = 'generating';
    await new Promise((resolve) => setTimeout(resolve, 0));
    const record = await this.apply({ kind: 'generate-ai-league' }, this.revision());
    this.phase = record.status === 'accepted' ? 'complete' : 'generating';
    return this.generation;
  }

  private revision(): number {
    return this.draft?.revision ?? 0;
  }

  private async apply(
    payload: SeasonDraftCommandPayload,
    expectedRevision: number,
  ): Promise<SeasonDraftCommandRecord> {
    const command = { commandId: newSeasonId('cmd'), expectedRevision, payload };
    const result = applySeasonDraftCommand(this.draft, this.catalogRef, command, this.deps);
    this.lastRecord = result.record;
    if (result.state === null || result.record.status === 'rejected') {
      if (result.record.status === 'rejected') {
        this.error = result.record.message;
      }
      return result.record;
    }
    this.draft = result.state;
    this.generation = result.generation;
    await this.repo.saveSeasonDraft(
      recordFromState(result.state, result.generation ?? this.generation),
    );
    if (result.generation) {
      this.phase = 'complete';
    } else if (this.draft.status === 'finalized') {
      this.phase = 'finalized';
    } else {
      this.phase = 'drafting';
    }
    return result.record;
  }
}

/** Production AI generation deps: the authoritative engine generator. */
export function engineGenerationDeps(): SeasonAiGenerationDeps {
  return { generate: generateAiLeague };
}
