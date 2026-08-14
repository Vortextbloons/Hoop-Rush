/**
 * Season Run (2.0) version boundaries (spec/2.0/02, spec/2.0/07). Every run
 * freezes these versions so a saved run reproduces and a bump cannot silently
 * fork one layer from another; version strings are opaque and never inferred.
 */

/**
 * Season Run persistence snapshot schema layout. Bumped to 9 by the M2.6
 * postseason-foundations milestone: the run carries an explicit `stage`, the
 * postseason state is the validated v2 state machine (stable `pi-`/`po-`
 * game ids, tie-resolution records, saved Finals home-court draw), and the
 * mutable-state digest covers stage, postseason, awards, and completion;
 * schema 8 runs cannot continue. Bumped to 8 by the projection milestone
 * minute-policy contract (each rotation freezes its versioned
 * `minutePolicy`); schema 7 runs cannot continue (their rotations carry no
 * policy). Bumped to 7 by M2.5 (health, transactions, influence, checkpoint
 * state, state revision/digest fields); schema 6 runs cannot continue. Bumped
 * to 6 by M2.4 roster-generation-v2 (`aiPools`, one 20-player pool per AI
 * franchise); schema 5 runs cannot continue. Bumped to 5 by M2.4 (effects
 * state); schema 4 runs cannot continue. Bumped to 4 by M2.3 (season-game-v2
 * home court), 3 by M2.2 (rotation planner), 2 by M2.1 (draft facts, AI
 * assignments, rotations, audit). The M2.0 schema v1 data is development
 * scaffolding, not a migration target.
 *
 * Layout 5 remained the read schema after the M2.3.5 draft overhaul: the
 * `draft` facts and `versions.draftVersion` widened to a discriminated union
 * so legacy M2.3 runs (`season-draft-v1`) and new runs (`season-draft-v2`)
 * both validate; the change recorded itself through draft versions, never a
 * layout bump. Schema 7 continued to accept both draft-fact variants, and
 * schema 9 continues to.
 *
 * Bumped to 10 by the M2.6.5 roster-depth milestone: rosters carry 10-15
 * distinct versions (ownership rows 300-450), each run carries the versioned
 * free-agency state (`SeasonFreeAgencyState`), rotations stay exactly ten
 * (`SEASON_ROTATION_SIZE`), and the run freezes the free-agency and
 * roster-v2 material versions. Schema 9 runs (including the
 * still-readable both-draft-fact union) are incompatible and load only
 * through the explicit discard-and-restart recovery flow; they are never
 * migrated, rewritten, or deleted.
 */
export const SEASON_RUN_SCHEMA_VERSION = 10;

/**
 * Stored Season Run draft record save-schema version (v3, M2.4): the single
 * current storage wrapper around a `season-draft-v2` state and the schema-2
 * generation result. The v1/v2 development wrappers are never read or
 * migrated; persistence auto-clears a row whose value differs.
 */
export const SEASON_DRAFT_SAVE_SCHEMA_VERSION = 3;

/**
 * Stored Season Run checkpoint row save-schema version (v7, M2.6.5
 * roster-depth): the current storage wrapper around a schema-10 run
 * snapshot (expanded rosters, free-agency state, the extended version set)
 * plus the row-level mutable state. v6 (M2.6 postseason-foundations) and
 * earlier development rows surface through the typed incompatibility flow;
 * they are never read or migrated.
 */
export const SEASON_RUN_SAVE_SCHEMA_VERSION = 7;

/** Frozen 30-franchise league manifest version (conference/division alignment). */
export const SEASON_LEAGUE_VERSION = 'league-v1';

/** Authored schedule artifact version (82 synchronized rounds of 15 games). */
export const SEASON_SCHEDULE_VERSION = 'schedule-v1';

/**
 * Selected modern NBA opponent-frequency formula: four games against each
 * division opponent, four games against six and three games against four of
 * the other same-conference opponents, and two games against every
 * opposite-conference opponent, with 41 home and 41 away games each.
 */
export const SEASON_SCHEDULE_FORMULA_VERSION = 'schedule-formula-v1';

/** Pure standings reduction rule set (derived facts only, no mutable table). */
export const SEASON_STANDINGS_VERSION = 'standings-v1';

/**
 * Play-In and best-of-seven playoff state machine rules. M2.6
 * postseason-foundations replaces postseason-v1 with the validated
 * postseason-v2 contract: stable `pi-{conference}-{matchup}` and
 * `po-{seriesId}-g{gameNumber}` game ids, the explicit season `stage`,
 * deterministic tie-resolution records, a saved Finals home-court draw seed,
 * and the run digest covering stage, postseason state, awards, and
 * completion. Old runs (postseason-v1) are incompatible and restart.
 */
export const SEASON_POSTSEASON_VERSION = 'postseason-v2';

/**
 * Legacy Play-In and best-of-seven state machine rules (`postseason-v1`,
 * M2.0-M2.5). Kept readable for frozen v1 artifacts and the frozen engine
 * state machine (`season/postseason-legacy.ts`); new runs never use it.
 */
export const SEASON_POSTSEASON_LEGACY_VERSION = 'postseason-v1';

/**
 * Authoritative regular-season tiebreak rules (M2.6): the versioned
 * published NBA tiebreak sequence that resolves Play-In qualification
 * (seeds 7-10), playoff seeding (1-8), and the Finals home-court decision.
 * Resolutions are recorded as deterministic tie-resolution facts on the
 * postseason state; a required random draw derives from the saved league
 * seed namespace and is recorded with its draw seed.
 */
export const SEASON_TIEBREAK_VERSION = 'tiebreaker-v1';

/**
 * Compact postseason game summaries (M2.6): one summary per Play-In and
 * playoff game, kept separate from regular-season summaries so
 * regular-season statistics remain frozen for awards. Carries matchup
 * identity, phase, round, series, game number, winner, score, forfeit
 * status, player statistics, rotation evidence, injury results, and a
 * deterministic result digest.
 */
export const SEASON_POSTSEASON_SUMMARY_VERSION = 'postseason-summary-v1';

/**
 * Season awards contract (M2.6): MVP, Defensive Player of the Year, Sixth
 * Man of the Year, and All-League First Team, derived from recorded
 * regular-season facts after postseason qualification, with a deterministic
 * digest.
 */
export const SEASON_AWARDS_VERSION = 'awards-v1';

/** Trade-grade contract (M2.6): bounded per-window grades for accepted trades. */
export const SEASON_TRADE_GRADE_VERSION = 'trade-grade-v1';

/**
 * Accepted-command log contract (M2.6): the append-only authoritative log
 * of every accepted run command with ordinal, payload, pre/post state
 * revision and digest, result digest, and related game/transaction ids.
 * Rejected commands never enter it.
 */
export const SEASON_COMMAND_LOG_VERSION = 'command-log-v1';

/**
 * Completed-season almanac contract (M2.6): the champion-history record
 * created atomically at promotion (final result, almanac, champion,
 * finalized command log, completed-history registration, active-run
 * removal).
 */
export const SEASON_ALMANAC_VERSION = 'almanac-v1';

/** Replay-export contract (M2.6): self-contained postseason game exports. */
export const SEASON_REPLAY_EXPORT_VERSION = 'replay-export-v1';

/**
 * Frozen postseason calibration cohort and envelope targets (M2.6,
 * postseason-targets-v1): the later postseason simulation phases calibrate
 * against these targets; the artifact is committed through the CLI.
 */
export const SEASON_POSTSEASON_TARGETS_VERSION = 'postseason-targets-v1';

/** Named seed derivation tree version (spec/2.0/07 deterministic seed tree). */
export const SEASON_SEED_DERIVATION_VERSION = 'season-seeds-v1';

/** Deterministic playerVersionId derivation version. */
export const PLAYER_VERSION_ID_VERSION = 'player-version-id-v1';

/**
 * M2.3.5 ten-round human Season Run draft state machine and commands:
 * ten deterministic global eight-card offers per participant, feasibility-safe
 * selections (4/4/3 completion targets), and typed recovery failures. See
 * `season-draft-v1` (below) for the legacy franchise-era roll contract.
 */
export const SEASON_DRAFT_VERSION = 'season-draft-v2';

/**
 * Legacy M2.1-M2.3 franchise-era roll draft (`season-draft-v1`). New drafts
 * never use it; unfinished v1 drafts are not convertible and receive an
 * explicit recovery screen. Runs created under v1 remain playable through
 * their frozen draft facts.
 */
export const SEASON_DRAFT_LEGACY_VERSION = 'season-draft-v1';

/**
 * M2.3.5 draft offer contract (spec/2.0/03): exactly this many distinct
 * player-version cards are drawn for each round, and at least
 * `SEASON_DRAFT_SAFE_MINIMUM` of them must be feasibility-safe selections.
 */
export const SEASON_DRAFT_OFFER_SIZE = 8;

/**
 * M2.3.5: minimum feasibility-safe (4/4/3 completion-safe) cards an offer
 * must contain. Fewer returns the typed `NO_FEASIBLE_GLOBAL_OFFER` error;
 * rules are never relaxed.
 */
export const SEASON_DRAFT_SAFE_MINIMUM = 3;

/**
 * Frozen calibration cohort targets for global offer variety, safe-choice
 * availability, positional coverage, exact-version uniqueness, AI generation
 * success, and roster strength distributions (`offer-targets-v1`).
 */
export const SEASON_OFFER_TARGETS_VERSION = 'offer-targets-v1';

/**
 * M2.6.5 roster rules (spec/2.0/15, season-roster-v2): a Season Run roster
 * contains 10-15 distinct player-season versions (same-person versions may
 * coexist); coverage, legal-five, contingency, minutes, closing-five,
 * availability, and game validation apply to its exactly-ten-member
 * rotation (`SEASON_ROTATION_SIZE`). Drafts and AI generation still produce
 * exactly `SEASON_DRAFT_SIZE` ten players. v1 (`season-roster-v1`, M2.1)
 * stays the draft/generation compatibility authority; runtime
 * roster-capacity validation uses the v2 bounds, never
 * `SEASON_ROSTER_SIZE`.
 */
export const SEASON_ROSTER_RULES_VERSION = 'season-roster-v2';

/**
 * M2.6.5 free-agency market state machine (spec/2.0/15,
 * season-free-agency-v1): deterministic shared markets after accepted
 * checkpoints for blocks 2, 4, and 6, canonical identity selection,
 * Declare/Skip/Resolve commands, the seven-step recorded resolution vector,
 * per-franchise signing/spend caps, and atomic signing application.
 */
export const SEASON_FREE_AGENCY_VERSION = 'season-free-agency-v1';

/**
 * M2.6.5 packaged free-agent eligibility index artifact contract
 * (free-agency-index-v1): a manifest-hashed compact index derived from the
 * validated draft catalog, grouping eligible versions by real `playerId`
 * with identity, positions, band, supported roles, minimum Influence cost,
 * factual strengths/limitations, durability/availability facts, compact
 * player-slice facts, catalog reference, derivation evidence, and exclusion
 * evidence.
 */
export const SEASON_FREE_AGENCY_INDEX_VERSION = 'free-agency-index-v1';

/**
 * M2.6.5 frozen free-agency calibration targets (free-agency-targets-v1):
 * market composition, universe exhaustion, identity stability, costs,
 * signing/win/skip rates, roster sizes, spend, rationale accuracy, and
 * quality exclusion; the artifact is committed through the CLI.
 */
export const SEASON_FREE_AGENCY_TARGETS_VERSION = 'free-agency-targets-v1';

/**
 * M2.4 roster-generation-v2 (replaces roster-generation-v1): deterministic
 * AI league generation through per-franchise 20-player pools — band-scoped
 * strength caps, anchor matching from canonical percentile thresholds, pool
 * repair, and constrained ten-player roster selection with
 * repair/backtracking diagnostics. See `season-ai.ts` for the recorded
 * pool/selection facts and `seasonRosterTargetsSchema` (roster-targets-v2).
 */
export const SEASON_ROSTER_GENERATION_V2 = 'roster-generation-v2';

/**
 * Projection milestone roster-generation-v3 (replaces v2): identical
 * selection phases and constraints; the persisted AI rotations are now
 * talent-ordered (mean detailed ratings; Overall is never a rotation
 * authority) so the strongest legal five starts and the bench hierarchy is
 * talent-ranked. v2 output stays frozen under its own version.
 */
export const SEASON_ROSTER_GENERATION_VERSION = 'roster-generation-v3';

/**
 * M2.4 season-ai-v2 (replaces season-ai-v1): AI decision identities,
 * strength bands, and roster evaluation weights under roster-generation-v2.
 * Decision identities alter documented scoring weights only; franchise
 * identity never changes ratings, odds, or player eligibility, and Overall
 * has no pick authority (it appears only as a report field).
 */
export const SEASON_AI_V2 = 'season-ai-v2';

/**
 * Projection milestone season-ai-v3 (replaces v2): identical decision
 * identities, bands, and evaluation weights; generation records the
 * talent-ordered rotations of roster-generation-v3. v2 output stays frozen
 * under its own version.
 */
export const SEASON_AI_VERSION = 'season-ai-v3';

/**
 * M2.2 rotation contract (spec/2.0/04, season-rotation-v2). Same structural
 * shape as v1, but the closing five is now an independent, ordered legal five
 * (G, G, F, F, C) that may include bench players and may differ from the
 * starters, and validation requires both the starter and closing lineups to
 * be individually legal against the roster.
 *
 * season-rotation-v3 (projection milestone) adds the versioned per-rotation
 * `minutePolicy` (minute-policy-v1). The policy records which strategy
 * produced the target minutes (`starter-heavy`, `balanced`, `bench-heavy`);
 * the preset value `tight` is preserved for compatibility and labeled
 * Starter-Heavy. v2 rotations cannot continue (no policy exists for them).
 */
export const SEASON_ROTATION_VERSION = 'season-rotation-v3';

/**
 * Legacy M2.2-M2.5 rotation contract value (`season-rotation-v2`), accepted
 * only where a frozen calibration cohort records the version it was measured
 * under. Live rotation state never accepts it.
 */
export const SEASON_ROTATION_V2 = 'season-rotation-v2';

/**
 * Versioned minute-policy contract (projection milestone, minute-policy-v1):
 * the risk-adjusted minute-plan optimizer allocates per-player integer
 * target minutes from player projection, stamina, durability, and current
 * fatigue, under the Starter-Heavy / Balanced / Bench-Heavy strategy
 * envelopes. Every rotation freezes the policy that produced its minutes;
 * saved runs stay frozen under their recorded policy.
 */
export const SEASON_MINUTE_POLICY_VERSION = 'minute-policy-v1';

/**
 * Deterministic substitution planner rules (spec/2.0/04, rotation-planner-v1,
 * M2.2): legal-five enumeration, projected target-minute deviation scoring,
 * tie-breaks (current-player retention, bench hierarchy, canonical
 * playerVersionId order), the closing-window preference, and overtime
 * behavior. Planner decisions consume no RNG.
 */
export const SEASON_ROTATION_PLANNER_VERSION = 'rotation-planner-v1';

/**
 * Season Run single-game controller (spec/2.0/04, season-game-v4, M2.5).
 * v4 adds the M2.5 injury seam: the removal reason `injury`, the returns
 * seam (`seasonReturnSchema` / `seasonReturnEventSchema`, reason
 * `injury-return`) on the game input and side results, and the
 * `human-interruption-forfeit` trigger. v3 (M2.4) added the optional
 * per-player `stamina` profile; absence means the zero profile, so neutral
 * Classic adapters stay byte-identical to the M2.3 path. A zero-injury input
 * must reproduce the v3 result byte-for-byte.
 */
export const SEASON_GAME_VERSION = 'season-game-v4';

/**
 * Frozen Season game calibration cohort and envelopes
 * (season-game-targets-v4, M2.5): regenerated because the game contract
 * changed; zero-injury cohorts must reproduce the v3 results byte-for-byte.
 * v3 (M2.4) recalibrated with the stamina/chemistry effects seam available,
 * seeds 0-1023 calibration with 1024-1279 held out, preset-minute ordering
 * gates, and 95% held-out envelope coverage.
 */
export const SEASON_GAME_TARGETS_VERSION = 'season-game-targets-v4';

/**
 * M2.4 frozen `roster-targets-v2` calibration artifact (replaces
 * roster-targets-v1): the band quotas, guaranteed anchors, extra-elite roll
 * probabilities, tier ranges, identity priority roles, coverage threshold,
 * completion targets, pool/roster sizes, percentile tiers, pool score caps,
 * strength-outlier caps, node budgets, verification gates, and measured
 * band/identity/incidence facts of roster-generation-v2. See
 * `seasonRosterTargetsSchema` in season-ai.ts.
 */
export const SEASON_ROSTER_TARGETS_V2 = 'roster-targets-v2';

/**
 * Projection milestone `roster-targets-v3`: the same frozen policy and
 * measured facts as v2 (the talent-ordered rotation change does not alter
 * selection-level strength, band, or incidence facts), re-versioned for
 * roster-generation-v3 / season-ai-v3. The v2 artifact stays valid under its
 * own version.
 */
export const SEASON_ROSTER_TARGETS_VERSION = 'roster-targets-v3';

/**
 * M2.5 pure block simulation pipeline (spec/2.0/02 ten-game blocks,
 * season-block-v3): v3 threads the health state (availability, injury rolls,
 * returns, post-game recovery ticks), carries the locked block objective,
 * stops with a typed `invalid-roster` interruption when the human cannot
 * field five at a tipoff, supports resume from a pending candidate, and
 * folds the post-block influence/transactions state into the candidate.
 * v2 (M2.4) carried the effects state across the block in stable game-id
 * order, converting to compact summaries with effects rollups and folding
 * standings and aggregates.
 *
 * season-block-v4 (M2.6.5) carries the free-agency state across the block
 * (windows open after accepted blocks 2, 4, 6; AI signings resolve
 * deterministically at open), validates roster-v2 capacity/identity bounds,
 * and rejects submission with `free-agency-unresolved` while a market
 * window remains open. Game inputs stay exactly ten rotation players, so
 * zero-signing game results are byte-identical to v3.
 */
export const SEASON_BLOCK_VERSION = 'season-block-v4';

/**
 * Compact completed-game summary conversion (season-game-summary-v3,
 * M2.5): every summary carries the compact per-game injury events
 * (`injuryEvents`), and retained human-game details roll up the same
 * events for display.
 */
export const SEASON_GAME_SUMMARY_VERSION = 'season-game-summary-v3';

/** Team/player aggregate folding and leaders (season-aggregates-v1). */
export const SEASON_AGGREGATES_VERSION = 'season-aggregates-v2';

/**
 * Block recap construction from saved game, aggregate, and effects facts
 * (season-recap-v3, M2.5). v3 adds the block-level injury, objective,
 * trade, and influence evidence (`injuryEvidence`, `objectiveEvidence`,
 * `tradeEvidence`, `influenceBalance`). v2 (M2.4) added the block-level
 * effects evidence.
 *
 * season-recap-v4 (M2.6.5) adds the block-level free-agency evidence:
 * signings by window/band, human Influence delta from free agency, and the
 * human franchise's season signing/spend counts.
 */
export const SEASON_RECAP_VERSION = 'season-recap-v4';

/** League leaders derivation, eligibility, and tie-breaking. */
export const SEASON_LEADERS_VERSION = 'season-leaders-v1';

/**
 * Home-court profile (season-home-court-v1): two named bounded mechanisms
 * (home defensive communication, away turnover pressure) calibrated against
 * a frozen held-out home-win-rate target. The neutral adapter is the zero
 * profile and never changes Classic results.
 */
export const SEASON_HOME_COURT_VERSION = 'season-home-court-v1';

/**
 * Canonical candidate-checkpoint contract and digest (season-checkpoint-v3,
 * M2.5). v3 adds the authoritative post-block health, influence, and
 * transaction facts plus the locked objective evaluation, and ties the
 * checkpoint to the mutable run-state chain through
 * `expectedStateRevision`/`expectedStateDigest` (pre-block) and
 * `stateRevision`/`stateDigest` (post-assembly). v2 (M2.4) added the effects
 * state. The digest is a pure function of the checkpoint's recorded facts, so
 * uninterrupted, cancelled/retried, terminated/reloaded, single-worker, and
 * CLI executions agree byte-for-byte.
 *
 * season-checkpoint-v4 (M2.6.5) adds the post-block free-agency state (open
 * windows, canonical candidates, declarations, traces, signings, signing
 * counts, season spend) to the candidate and the version set; rosters carry
 * 10-15 players and player aggregates 300-450 rows.
 */
export const SEASON_CHECKPOINT_VERSION = 'season-checkpoint-v4';

/**
 * Season Run stamina model (season-stamina-v2): the historical
 * minutes-per-game derivation formula (unchanged from v1) plus the fatigue
 * model constants — on-court accumulation, consecutive-stint ramp, halftime
 * recovery, the between-game recovery tick, and the recent-load factor.
 * v2 raises accumulation and mechanism caps so fatigue is a meaningful
 * game-to-game force; v1 saves, checkpoints, and catalogs stay readable
 * through SEASON_STAMINA_LEGACY_VERSION.
 */
export const SEASON_STAMINA_VERSION = 'season-stamina-v2';

/** Stamina model v1 (legacy): kept readable for old saves and artifacts. */
export const SEASON_STAMINA_LEGACY_VERSION = 'season-stamina-v1';

/**
 * M2.4 pair chemistry state rules (season-chemistry-v1): 45 canonical
 * playerVersionId pairs per ten-player roster (1,350 per league) that accrue
 * shared possessions only through recorded on-court play.
 *
 * season-chemistry-v2 (M2.6.5): chemistry stays rotation-scoped — exactly
 * 1,350 ACTIVE canonical pairs (45 per locked ten-player rotation). Demotion
 * freezes the player's recorded pair history into archived records that
 * carry `franchiseId` and never count as active pairs; promotion restores
 * prior same-franchise records with current rotation teammates, and
 * never-paired relationships begin at zero. Inactive players own no active
 * pairs; inactivity never decays or invents chemistry; trading or signing
 * inactive depth does not change active pair state until the player enters
 * a locked rotation.
 */
export const SEASON_CHEMISTRY_VERSION = 'season-chemistry-v2';

/**
 * Season Run effect-size calibration targets (season-effect-targets-v2):
 * bounds and envelopes for the six named possession mechanisms under
 * fatigue and chemistry inputs (shooter/handler/defensive-unit fatigue and
 * turnover-security, assist-conversion, help-defense chemistry). v2 widens
 * the three fatigue mechanism caps to 5.0/3.5/2.5 percentage points; v1
 * artifacts stay readable through SEASON_EFFECT_TARGETS_LEGACY_VERSION.
 */
export const SEASON_EFFECT_TARGETS_VERSION = 'season-effect-targets-v2';

/** Effect-size calibration targets v1 (legacy): kept readable for old artifacts. */
export const SEASON_EFFECT_TARGETS_LEGACY_VERSION = 'season-effect-targets-v1';

/**
 * Packaged Season Run draft catalog artifact contract
 * (season-draft-catalog-v4, projection milestone): every candidate carries
 * the validated observed `anchors` and an optional `reconstructedThreePoint`
 * profile from its packaged pool record, so roster builders run the
 * deterministic possession-level projection without scanning historical
 * datasets. v3 (M2.5) added `durability`; v2 (M2.4) added the stamina
 * profile. The draft rules version is unchanged, and projection fields never
 * thread into the Season game adapter.
 */
export const SEASON_DRAFT_CATALOG_VERSION = 'season-draft-catalog-v4';

/**
 * Frozen projection model artifact contract (projection-model-v1): the
 * versioned neutral and archetype reference lineups per era, normalization
 * baselines, ranking group weights, weakness thresholds and penalties, the
 * bounded candidate-search policy, cohort definitions, and monotonic gates
 * the projection layer reads. The artifact is derived at build time from
 * packaged pool aggregates; the engine never recomputes or tunes it.
 */
export const PROJECTION_MODEL_VERSION = 'projection-model-v1';

/**
 * Frozen base projection calibration cohort and envelope artifact
 * (projection-targets-v1): cohort definitions, error envelopes, rank and
 * ordering gates, monotonic sanity gates, and measured facts for base-five
 * projections validated against the authoritative fixed-five simulator.
 */
export const PROJECTION_TARGETS_VERSION = 'projection-targets-v1';

/**
 * Projection normalization and digest contract (projection-schema-v1): the
 * canonical component normalization, digest material ordering, and audit
 * format for base-five and Season projections.
 */
export const PROJECTION_SCHEMA_VERSION = 'projection-schema-v1';

/**
 * Season projection composition contract (season-projection-v1): named
 * representative units, rotation-trace weights, continuity, contingency,
 * matchup, and redundancy metrics produced by composing the base projector
 * over a ten-player roster and rotation.
 */
export const SEASON_PROJECTION_VERSION = 'season-projection-v1';

/**
 * Frozen Season projection calibration cohort and envelope artifact
 * (season-projection-targets-v1): error envelopes, ordering and continuity
 * gates, cohort splits, and monotonic sanity gates for Season projections.
 */
export const SEASON_PROJECTION_TARGETS_VERSION = 'season-projection-targets-v1';

/**
 * Human roster autofill contract (season-roster-autofill-v1): the typed
 * engine command that completes a Season roster with projection-ranked
 * candidates while preserving locks, ownership, legality, and feasibility
 * rules; it never relaxes a constraint.
 */
export const SEASON_ROSTER_AUTOFILL_VERSION = 'season-roster-autofill-v1';

/**
 * M2.5 injury and health state contract (season-health-v1): the seeded
 * injury occurrence/recovery model — injury records, severity, recovery
 * ranges, same-game returns, recurrence windows, and risky-rehab outcomes.
 * Availability is derived from the recorded injuries, never stored
 * separately.
 */
export const SEASON_HEALTH_VERSION = 'season-health-v1';

/**
 * M2.5 trade contract (season-trade-v1): deterministic trade-window
 * offers (windows open after accepted checkpoints for blocks 2, 4, 5),
 * value-band and legality evaluation, and the atomically applied ownership
 * transfer with chemistry reset.
 *
 * season-trade-v2 (M2.6.5): 1-for-1, 2-for-2, 1-for-2, and 2-for-1 offers
 * are legal when both resulting rosters stay within 10-15 and retain a
 * legal ten-player rotation subset. Value bands: 85-115% for 1-for-1,
 * 80-120% for every multi-player or uneven package. Moving only inactive
 * players leaves rotations and active effects unchanged; moving rotation
 * players rebuilds affected rotations deterministically while preserving
 * retained assignments/minutes where possible. Open free-agent targets are
 * revalidated after every ownership change.
 */
export const SEASON_TRADE_VERSION = 'season-trade-v2';

/**
 * M2.5 Influence economy contract (season-influence-v1): the +2 initial
 * grant, +1 block grants, +8 cap / -3 floor, the ledger of every recorded
 * delta, and the two spend purposes (extra-trade-offer, risky-rehab).
 * Balance and debt never modify gameplay mechanics; no hook exists.
 */
export const SEASON_INFLUENCE_VERSION = 'season-influence-v1';

/**
 * M2.5 block objectives contract (season-objective-v1): the six fixed
 * objectives, the deterministic three-choice offers per ten-game block,
 * selection commands, and evaluation from saved facts only.
 */
export const SEASON_OBJECTIVE_VERSION = 'season-objective-v1';

/**
 * M2.5 frozen injury calibration targets (injury-targets-v1): incidence
 * envelope around the 80 bp base risk, severity distribution, recovery
 * duration means, same-game-return rate, recurrence lift, season-ending
 * rate, and risk-input monotonicity gates.
 */
export const SEASON_INJURY_TARGETS_VERSION = 'injury-targets-v1';

/**
 * M2.5 frozen trade calibration targets (trade-targets-v1): 8-15 AI trades
 * per season, zero illegal or duplicate-ownership trades, value-band
 * compliance, deterministic offers, and chemistry invariants.
 *
 * trade-targets-v2 (M2.6.5): recalibrated for season-trade-v2 package mix
 * (1-for-1, 2-for-2, 1-for-2, 2-for-1), the frozen 85-115 / 80-120 value
 * bands, 10-15 roster legality, and rotation-subset retention.
 */
export const SEASON_TRADE_TARGETS_VERSION = 'trade-targets-v2';

/**
 * M2.5 frozen Influence calibration targets (influence-targets-v1):
 * ledger reconciliation everywhere, income = 2 + acceptedBlocks per
 * franchise, debt frequency, zero cap violations, objective success rate,
 * and spend-rate envelopes.
 */
export const SEASON_INFLUENCE_TARGETS_VERSION = 'influence-targets-v1';

/**
 * M2.5 durability profile derivation (durability-v1): the build-time
 * durability rating `round(clamp(45, 95, 45 + 50 * gamesPlayed / max(1,
 * teamGames)))` derived from recorded games played and eligibility team
 * games; it feeds the seeded injury-risk formula, never Overall.
 */
export const SEASON_DURABILITY_VERSION = 'durability-v1';

/**
 * Frozen held-out home-win-rate calibration target for the season-home-court
 * profile (M2.3). The bounded constants are tuned against this target, never
 * against a general ratings multiplier.
 */
export const SEASON_HOME_WIN_RATE_TARGET = 0.575;

/**
 * League-leader eligibility: a player-version qualifies for per-game rate
 * leader categories after playing at least this share of the team's games
 * played at the time of derivation.
 */
export const SEASON_LEADER_MIN_GAME_SHARE = 0.7;

/** Per-category leader table depth. */
export const SEASON_LEADER_DEPTH = 5;

/**
 * Committed authoring seed of the packaged `season/draft-catalog.json`-driven
 * M2.1 draft fixture. Replaying the committed draft commands with this root
 * seed must reproduce the committed `season-run.json` and every command record
 * byte-for-byte.
 */
export const SEASON_COMMITTED_DRAFT_SEED = 'd00d2026a1b2c3d4e5f60718293a4b5c6';

/** Exactly 30 franchises in a Season Run league. */
export const SEASON_TEAM_COUNT = 30;

/** Regular season rounds; each round groups 15 games. */
export const SEASON_ROUND_COUNT = 82;

/** Total regular-season league games: 82 rounds of 15 games. */
export const SEASON_GAME_COUNT = 1230;

/** Games per round: 30 teams form 15 simultaneous games. */
export const SEASON_GAMES_PER_ROUND = 15;

/** Nine regular-season checkpoints (spec/2.0/02 ten-game blocks). */
export const SEASON_BLOCK_COUNT = 9;

/** Team games in each of the first eight blocks. */
export const SEASON_BLOCK_TEAM_GAMES = 10;

/** Team games in the final block (rounds 81-82). */
export const SEASON_FINAL_BLOCK_TEAM_GAMES = 2;

/**
 * Draft and AI-generation roster size: every Season Run draft produces
 * exactly this many players and every AI-generated roster starts at this
 * size (M2.6.5, spec/2.0/15). Drafts never grow with free agency.
 */
export const SEASON_DRAFT_SIZE = 10;

/**
 * Locked rotation size: every rotation contains exactly this many rostered
 * players (five slot-assigned starters, five ordered reserves, target
 * minutes totaling 240, and an ordered closing five). Coverage,
 * legal-five, contingency, minutes, availability, and game validation apply
 * to the rotation, never to inactive depth (M2.6.5, spec/2.0/15).
 */
export const SEASON_ROTATION_SIZE = 10;

/** Minimum roster capacity: 10 distinct player-season versions (M2.6.5). */
export const SEASON_ROSTER_MIN_SIZE = 10;

/** Maximum roster capacity: 15 distinct player-season versions (M2.6.5). */
export const SEASON_ROSTER_MAX_SIZE = 15;

/**
 * Deprecated ten-player roster size alias (M2.1-M2.6 draft and
 * AI-generation compatibility). Retained so draft/AI-generation code keeps
 * its historical constant, but it is REMOVED from runtime
 * roster-capacity validation: capacity checks must use
 * `SEASON_ROSTER_MIN_SIZE`/`SEASON_ROSTER_MAX_SIZE` (v2 bounds) and
 * rotation checks `SEASON_ROTATION_SIZE`.
 */
export const SEASON_ROSTER_SIZE = 10;

/**
 * Committed authoring seed of the packaged `season/schedule.json` artifact.
 * Regenerating the schedule with this seed must be byte-identical.
 */
export const SEASON_COMMITTED_SCHEDULE_SEED = 'c0ffee2026a1b2c3d4e5f60718293a4b';
