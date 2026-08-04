/**
 * Season Run (2.0) version boundaries (spec/2.0/02, spec/2.0/07). Every
 * Season Run freezes these versions so a saved run can be reproduced and a
 * version bump cannot silently fork one layer from another.
 *
 * Version strings are opaque and change only when the corresponding contract
 * or method changes. Runtime boundaries never infer a version from content.
 */

/**
 * Season Run persistence snapshot schema layout. Bumped to 2 by M2.1: the
 * run now freezes completed draft facts, AI assignments, generated rotations,
 * the generation audit summary, and the new material versions below. The
 * M2.0 schema v1 data is development scaffolding, not a migration target.
 */
export const SEASON_RUN_SCHEMA_VERSION = 2;

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

/** M2.1 ten-round human Season Run draft state machine and commands. */
export const SEASON_DRAFT_VERSION = 'season-draft-v1';

/** Pure ten-player Season Run roster legality rule set (game minimums). */
export const SEASON_ROSTER_RULES_VERSION = 'season-roster-v1';

/** Deterministic AI league roster generation and repair/backtracking rules. */
export const SEASON_ROSTER_GENERATION_VERSION = 'roster-generation-v1';

/** AI decision identities, strength bands, and roster evaluation weights. */
export const SEASON_AI_VERSION = 'season-ai-v1';

/** M2.1 initial rotation contract (32/16 minute targets, closing five). */
export const SEASON_ROTATION_VERSION = 'season-rotation-v1';

/** Frozen calibration cohort targets for AI roster strength and coverage. */
export const SEASON_ROSTER_TARGETS_VERSION = 'roster-targets-v1';

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
