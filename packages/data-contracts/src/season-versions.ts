/**
 * Season Run (2.0) version boundaries (spec/2.0/02, spec/2.0/07). Every
 * Season Run freezes these versions so a saved run can be reproduced and a
 * version bump cannot silently fork one layer from another.
 *
 * Version strings are opaque and change only when the corresponding contract
 * or method changes. Runtime boundaries never infer a version from content.
 */

/**
 * Season Run persistence snapshot schema layout. Bumped to 7 by M2.5
 * (injuries, transactions, influence, objectives): the run gains the
 * `health` (season-health-v1), `transactions`, `influence`
 * (season-influence-v1), `checkpointState`, `stateRevision`, and
 * `stateDigest` fields and freezes the seven new M2.5 material versions
 * (health, trade, influence, objective, injury-targets, trade-targets,
 * influence-targets); schema 6 runs cannot continue (no health, influence,
 * or state chain exists for them). Bumped to 6 by M2.4
 * roster-generation-v2: the run freezes the roster-generation-v2,
 * season-ai-v2, and roster-targets-v2 material versions and carries the
 * generated `aiPools` (one 20-player pool per AI franchise: 29 solo, 28
 * duo); schema 5 runs cannot continue (their pools and targets do not
 * exist). Bumped to 5 by M2.4: the run froze the stamina, chemistry, and
 * effect-targets material versions and the candidate checkpoint carried
 * the 300-player / 1,350-pair effects state; schema 4 runs cannot continue
 * (no effects state exists for them). Bumped to 4 by M2.3: the run froze
 * the block, game-summary, aggregates, recap, leaders, home-court, and
 * checkpoint material versions; the Season game contract moved to
 * season-game-v2 (home court) with recalibrated season-game-targets-v2.
 * Bumped to 3 by M2.2 (rotation-planner, Season-game, and Season-game-
 * targets material versions). Bumped to 2 by M2.1 (draft facts, AI
 * assignments, rotations, audit, new material versions). The M2.0 schema
 * v1 data is development scaffolding, not a migration target.
 *
 * Schema layout 5 remained the read schema after the M2.3.5 draft overhaul:
 * the `draft` facts and the `versions.draftVersion` field widened to a
 * discriminated union so legacy M2.3 runs (franchise-era draft facts,
 * `season-draft-v1`) and new runs (global eight-card offer facts,
 * `season-draft-v2`) both validated as schema 5. The M2.3.5 change recorded
 * itself through the draft versions, never through a snapshot layout bump.
 * Schema 7 continues to accept both draft-fact variants.
 */
export const SEASON_RUN_SCHEMA_VERSION = 7;

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

/** Play-In and best-of-seven playoff state machine rules. */
export const SEASON_POSTSEASON_VERSION = 'postseason-v1';

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

/** Pure ten-player Season Run roster legality rule set (game minimums). */
export const SEASON_ROSTER_RULES_VERSION = 'season-roster-v1';

/**
 * M2.4 roster-generation-v2 (replaces roster-generation-v1): deterministic
 * AI league generation through per-franchise 20-player pools — band-scoped
 * strength caps, anchor matching from canonical percentile thresholds,
 * pool repair, and constrained ten-player roster selection with
 * repair/backtracking diagnostics. See `season-ai.ts` for the recorded
 * pool/selection facts and `seasonRosterTargetsSchema` (roster-targets-v2)
 * for the frozen calibration policy and gates.
 */
export const SEASON_ROSTER_GENERATION_VERSION = 'roster-generation-v2';

/**
 * M2.4 season-ai-v2 (replaces season-ai-v1): AI decision identities,
 * strength bands, and roster evaluation weights under roster-generation-v2.
 * Decision identities alter documented scoring weights only; franchise
 * identity never changes ratings, odds, or player eligibility, and Overall
 * has no pick authority (it appears only as a report field).
 */
export const SEASON_AI_VERSION = 'season-ai-v2';

/**
 * M2.2 rotation contract (spec/2.0/04, season-rotation-v2). Same structural
 * shape as v1, but the closing five is now an independent, ordered legal five
 * (G, G, F, F, C) that may include bench players and may differ from the
 * starters, and validation requires both the starter and closing lineups to
 * be individually legal against the roster.
 */
export const SEASON_ROTATION_VERSION = 'season-rotation-v2';

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
 * v4 adds the M2.5 injury seam on both sides of the contract: the removal
 * reason `injury` (alongside the injected fixture reason) and the returns
 * seam (`seasonReturnSchema` / `seasonReturnEventSchema`, reason
 * `injury-return`) on the game input and side results, plus the
 * `human-interruption-forfeit` trigger. v3 (M2.4) added the optional
 * per-player `stamina` profile (the effects seam); absence means the zero
 * profile, so neutral adapters used by Classic stay byte-identical to the
 * M2.3 path. A zero-injury input (no removals, no returns) must reproduce
 * the v3 result byte-for-byte.
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
export const SEASON_ROSTER_TARGETS_VERSION = 'roster-targets-v2';

/**
 * M2.5 pure block simulation pipeline (spec/2.0/02 ten-game blocks,
 * season-block-v3): v3 threads the health state (availability, injury
 * rolls, returns, post-game recovery ticks), carries the locked block
 * objective, stops with a typed `invalid-roster` interruption when the
 * human cannot field five at a tipoff, supports resume from a pending
 * candidate, and folds the post-block influence/transactions state into
 * the candidate. v2 (M2.4) carried the effects state (load + pair
 * chemistry) across the block and simulated in stable game-id order,
 * converting to compact summaries with effects rollups and folding
 * standings and aggregates.
 */
export const SEASON_BLOCK_VERSION = 'season-block-v3';

/**
 * Compact completed-game summary conversion (season-game-summary-v3,
 * M2.5): every summary carries the compact per-game injury events
 * (`injuryEvents`), and retained human-game details roll up the same
 * events for display.
 */
export const SEASON_GAME_SUMMARY_VERSION = 'season-game-summary-v3';

/** Team/player aggregate folding and leaders (season-aggregates-v1). */
export const SEASON_AGGREGATES_VERSION = 'season-aggregates-v1';

/**
 * Block recap construction from saved game, aggregate, and effects facts
 * (season-recap-v3, M2.5). v3 adds the block-level injury, objective,
 * trade, and influence evidence (`injuryEvidence`, `objectiveEvidence`,
 * `tradeEvidence`, `influenceBalance`). v2 (M2.4) added the block-level
 * effects evidence.
 */
export const SEASON_RECAP_VERSION = 'season-recap-v3';

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
 * transaction facts plus the locked objective evaluation to the candidate,
 * and ties the checkpoint to the mutable run-state chain through
 * `expectedStateRevision`/`expectedStateDigest` (asserted pre-block) and
 * `stateRevision`/`stateDigest` (computed post-assembly). v2 (M2.4) added
 * the effects state (player load + pair chemistry) to the candidate and
 * froze the stamina, chemistry, and effect-targets material versions. The
 * digest is a pure function of the checkpoint's recorded facts, so
 * uninterrupted, cancelled/retried, terminated/reloaded, single-worker,
 * and CLI executions must agree byte-for-byte.
 */
export const SEASON_CHECKPOINT_VERSION = 'season-checkpoint-v3';

/**
 * M2.4 stamina profile derivation (season-stamina-v1): the historical
 * minutes-per-game formula that maps a pool player-season's recorded
 * `stats.minutes` and `stats.gamesPlayed` to the catalog stamina rating and
 * historical MPG the game controller consumes per player.
 */
export const SEASON_STAMINA_VERSION = 'season-stamina-v1';

/**
 * M2.4 pair chemistry state rules (season-chemistry-v1): 45 canonical
 * playerVersionId pairs per ten-player roster (1,350 per league) that accrue
 * shared possessions only through recorded on-court play.
 */
export const SEASON_CHEMISTRY_VERSION = 'season-chemistry-v1';

/**
 * M2.4 frozen effect-size calibration targets (season-effect-targets-v1):
 * bounds and envelopes for the six named possession mechanisms under
 * fatigue and chemistry inputs (shooter/handler/defensive-unit fatigue and
 * turnover-security, assist-conversion, help-defense chemistry).
 */
export const SEASON_EFFECT_TARGETS_VERSION = 'season-effect-targets-v1';

/**
 * Packaged Season Run draft catalog artifact contract
 * (season-draft-catalog-v4, projection milestone): every candidate carries
 * the validated observed `anchors` and an optional `reconstructedThreePoint`
 * profile from its packaged pool record, so roster builders can run the
 * deterministic possession-level projection without scanning historical
 * datasets. v3 (M2.5) added the build-time `durability` field; v2 (M2.4)
 * added the build-time stamina profile. The draft rules version
 * (`season-draft-v2`) is unchanged, and the projection fields never thread
 * into the Season game adapter (Season game inputs are unchanged until a
 * separate Season game version says otherwise).
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
 */
export const SEASON_TRADE_VERSION = 'season-trade-v1';

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
 */
export const SEASON_TRADE_TARGETS_VERSION = 'trade-targets-v1';

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

/** Ten-player fantasy roster size. */
export const SEASON_ROSTER_SIZE = 10;

/**
 * Committed authoring seed of the packaged `season/schedule.json` artifact.
 * Regenerating the schedule with this seed must be byte-identical.
 */
export const SEASON_COMMITTED_SCHEDULE_SEED = 'c0ffee2026a1b2c3d4e5f60718293a4b';
