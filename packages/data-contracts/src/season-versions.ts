/**
 * Season Run (2.0) version boundaries (spec/2.0/02, spec/2.0/07). Every
 * Season Run freezes these versions so a saved run can be reproduced and a
 * version bump cannot silently fork one layer from another.
 *
 * Version strings are opaque and change only when the corresponding contract
 * or method changes. Runtime boundaries never infer a version from content.
 */

/**
 * Season Run persistence snapshot schema layout. Bumped to 5 by M2.4: the
 * run freezes the stamina, chemistry, and effect-targets material versions
 * and the candidate checkpoint carries the 300-player / 1,350-pair effects
 * state; schema 4 runs cannot continue (no effects state exists for them).
 * Bumped to 4 by M2.3: the run now freezes the block, game-summary,
 * aggregates, recap, leaders, home-court, and checkpoint material versions;
 * the Season game contract moved to season-game-v2 (home court) with
 * recalibrated season-game-targets-v2. Bumped to 3 by M2.2 (rotation-planner,
 * Season-game, and Season-game-targets material versions). Bumped to 2 by
 * M2.1 (draft facts, AI assignments, rotations, audit, new material
 * versions). The M2.0 schema v1 data is development scaffolding, not a
 * migration target.
 *
 * Schema layout 5 remains the read schema after the M2.3.5 draft overhaul:
 * the `draft` facts and the `versions.draftVersion` field widened to a
 * discriminated union so legacy M2.3 runs (franchise-era draft facts,
 * `season-draft-v1`) and new runs (global eight-card offer facts,
 * `season-draft-v2`) both validate as schema 5. The M2.3.5 change records
 * itself through the draft versions, never through a snapshot layout bump.
 */
export const SEASON_RUN_SCHEMA_VERSION = 5;

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

/** Deterministic AI league roster generation and repair/backtracking rules. */
export const SEASON_ROSTER_GENERATION_VERSION = 'roster-generation-v1';

/** AI decision identities, strength bands, and roster evaluation weights. */
export const SEASON_AI_VERSION = 'season-ai-v1';

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
 * Season Run single-game controller (spec/2.0/04, season-game-v3, M2.4).
 * v3 adds the stamina/chemistry effects seam on the player input (the
 * optional per-player `stamina` profile; absence means the zero profile,
 * so neutral adapters used by Classic stay byte-identical to the M2.3
 * path). v2 applied the versioned home-court profile through named
 * mechanisms only; the neutral adapter remains byte-identical to the M2.2
 * fixed-five path.
 */
export const SEASON_GAME_VERSION = 'season-game-v3';

/**
 * Frozen Season game calibration cohort and envelopes
 * (season-game-targets-v3, M2.4): recalibrated with the stamina/chemistry
 * effects seam available; seeds 0-1023 calibration with 1024-1279 held out,
 * preset-minute ordering gates, and 95% held-out envelope coverage.
 */
export const SEASON_GAME_TARGETS_VERSION = 'season-game-targets-v3';

/** Frozen calibration cohort targets for AI roster strength and coverage. */
export const SEASON_ROSTER_TARGETS_VERSION = 'roster-targets-v1';

/**
 * M2.4 pure block simulation pipeline (spec/2.0/02 ten-game blocks,
 * season-block-v2): validate cursor and locked rotations, expand the 300
 * drafted versions, carry the effects state (load + pair chemistry) across
 * the block, simulate in stable game-id order, convert to compact summaries
 * with effects rollups, fold standings and aggregates, audit, build the
 * recap with block-level effects evidence, and produce one candidate
 * checkpoint.
 */
export const SEASON_BLOCK_VERSION = 'season-block-v2';

/** Compact completed-game summary conversion (season-game-summary-v2). */
export const SEASON_GAME_SUMMARY_VERSION = 'season-game-summary-v2';

/** Team/player aggregate folding and leaders (season-aggregates-v1). */
export const SEASON_AGGREGATES_VERSION = 'season-aggregates-v1';

/** Block recap construction from saved game, aggregate, and effects facts. */
export const SEASON_RECAP_VERSION = 'season-recap-v2';

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
 * Canonical candidate-checkpoint contract and digest (season-checkpoint-v2).
 * v2 adds the effects state (player load + pair chemistry) to the candidate
 * checkpoint and freezes the stamina, chemistry, and effect-targets material
 * versions. The digest is a pure function of the checkpoint's recorded
 * facts, so uninterrupted, cancelled/retried, terminated/reloaded,
 * single-worker, and CLI executions must agree byte-for-byte.
 */
export const SEASON_CHECKPOINT_VERSION = 'season-checkpoint-v2';

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
 * (season-draft-catalog-v2, M2.4): the catalog now carries the build-time
 * stamina profile on every candidate and records the stamina derivation
 * version; the draft rules version (`season-draft-v2`) is unchanged.
 */
export const SEASON_DRAFT_CATALOG_VERSION = 'season-draft-catalog-v2';

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
