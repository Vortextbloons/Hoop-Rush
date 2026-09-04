import { hasOption, parseArgs, parseOption, UsageError, getOptionString } from './args.ts';
import { EXIT_OK, EXIT_USAGE_OR_DATA_ERROR, makeReport, renderJson, renderText, type CliReport, } from './report.ts';
import { DEFAULT_MANIFEST } from './commands/data-loader.ts';
import { helpCommand } from './commands/help.ts';
import { bracketAudit, BRACKET_AUDIT_OPTIONS } from './commands/bracket-audit.ts';
import { bracketGenerate, BRACKET_GENERATE_OPTIONS } from './commands/bracket-generate.ts';
import { benchmark, BENCHMARK_OPTIONS } from './commands/benchmark.ts';
import { calibrateRun, calibrateSensitivity, CALIBRATE_OPTIONS } from './commands/calibrate.ts';
import { calibrateRatings, CALIBRATE_RATINGS_OPTIONS } from './commands/calibrate-ratings.ts';
import { calibrateThreePoint, CALIBRATE_THREE_POINT_OPTIONS, } from './commands/calibrate-three-point.ts';
import { simChallenge, SIM_CHALLENGE_OPTIONS } from './commands/challenge.ts';
import { dataCoverage, DATA_COVERAGE_OPTIONS } from './commands/data-coverage.ts';
import { defenseBpmCorrelation, DATA_DEFENSE_BPM_CORRELATION_OPTIONS, } from './commands/data-defense-bpm-correlation.ts';
import { dataDerive, DATA_DERIVE_OPTIONS } from './commands/data-derive.ts';
import { dataLineageAudit, DATA_LINEAGE_AUDIT_OPTIONS } from './commands/data-lineage-audit.ts';
import { dataOveralls, DATA_OVERALLS_OPTIONS } from './commands/data-overalls.ts';
import { dataOverallsDistribution, DATA_OVERALLS_DISTRIBUTION_OPTIONS, } from './commands/data-overalls-distribution.ts';
import { dataValidate, DATA_VALIDATE_OPTIONS } from './commands/data-validate.ts';
import { DIAGNOSE_OPTIONS, SEASON_OPTIONS, simDiagnose, simSeason } from './commands/diagnose.ts';
import { combineDocs, COMBINE_DOCS_OPTIONS } from './commands/docs-combine.ts';
import { IMPORT_ERA_PROFILE_OPTIONS, IMPORT_FREEZE_OPTIONS, IMPORT_MANIFEST_OPTIONS, IMPORT_OPPONENT_OPTIONS, IMPORT_POOLS_OPTIONS, IMPORT_RATINGS_OPTIONS, IMPORT_RUN_ALL_OPTIONS, importEraProfile, importFreeze, importManifest, importOpponent, importPools, importRatings, importRunAll, } from './commands/import.ts';
import { PROJECTION_AI_SHADOW_OPTIONS, PROJECTION_BASE_OPTIONS, PROJECTION_BENCHMARK_OPTIONS, PROJECTION_BUILD_OPTIONS, PROJECTION_CALIBRATE_OPTIONS, PROJECTION_SEASON_OPTIONS, projectionAiShadow, projectionBase, projectionBenchmark, projectionBuild, projectionCalibrateBase, projectionSeason, } from './commands/projection.ts';
import { replay, REPLAY_OPTIONS } from './commands/replay.ts';
import { seasonBenchmarkBlock, seasonBenchmarkDeterminism, seasonBenchmarkFull, seasonBenchmarkPersistence, SEASON_BENCHMARK_OPTIONS, } from './commands/season-benchmark.ts';
import { seasonBlockAudit, SEASON_BLOCK_AUDIT_OPTIONS, seasonBlockSimulate, SEASON_BLOCK_SIMULATE_OPTIONS, seasonFullSimulate, SEASON_FULL_SIMULATE_OPTIONS, } from './commands/season-block.ts';
import { seasonCampaignAudit, SEASON_CAMPAIGN_AUDIT_OPTIONS, seasonCampaignCalibrate, SEASON_CAMPAIGN_CALIBRATE_OPTIONS, } from './commands/season-campaign.ts';
import { seasonDraftCalibrate, SEASON_DRAFT_CALIBRATE_OPTIONS, } from './commands/season-draft-calibrate.ts';
import { seasonDraftReproduce, SEASON_DRAFT_REPRODUCE_OPTIONS } from './commands/season-draft.ts';
import { SEASON_EFFECTS_OPTIONS, seasonEffectsCalibrate, seasonEffectsDistribution, seasonEffectsRoles, seasonEffectsSensitivity, } from './commands/season-effects.ts';
import { seasonFreeAgencyAudit, SEASON_FREE_AGENCY_AUDIT_OPTIONS, } from './commands/season-free-agency-audit.ts';
import { seasonFreeAgencyCalibrate, SEASON_FREE_AGENCY_CALIBRATE_OPTIONS, } from './commands/season-free-agency-calibrate.ts';
import { SEASON_GAME_CALIBRATE_OPTIONS, SEASON_GAME_SIMULATE_OPTIONS, seasonGameCalibrate, seasonGameSimulate, } from './commands/season-game.ts';
import { seasonHealthCalibrate, SEASON_HEALTH_CALIBRATE_OPTIONS, } from './commands/season-health.ts';
import { seasonHomeCourtCalibrate, SEASON_HOME_COURT_CALIBRATE_OPTIONS, } from './commands/season-home-court.ts';
import { seasonInfluenceCalibrate, SEASON_INFLUENCE_CALIBRATE_OPTIONS, } from './commands/season-influence.ts';
import { seasonPostseasonAudit, SEASON_POSTSEASON_AUDIT_OPTIONS, } from './commands/season-postseason-audit.ts';
import { seasonPostseasonCalibrate, SEASON_POSTSEASON_CALIBRATE_OPTIONS, } from './commands/season-postseason-calibrate.ts';
import { seasonRunReproduce, SEASON_RUN_REPRODUCE_OPTIONS } from './commands/season-reproduce.ts';
import { SEASON_ROSTERS_AUDIT_OPTIONS, SEASON_ROSTERS_CALIBRATE_OPTIONS, SEASON_ROSTERS_GENERATE_OPTIONS, seasonRostersAudit, seasonRostersCalibrate, seasonRostersGenerate, } from './commands/season-rosters.ts';
import { SEASON_SCHEDULE_AUDIT_OPTIONS, SEASON_SCHEDULE_GENERATE_OPTIONS, seasonScheduleAudit, seasonScheduleGenerate, } from './commands/season-schedule.ts';
import { SEASON_TRADE_AUDIT_OPTIONS, SEASON_TRADE_CALIBRATE_OPTIONS, seasonTradeAudit, seasonTradeCalibrate, } from './commands/season-trade.ts';
import { SIM_OPTIONS, simBatch, simGame } from './commands/sim.ts';
type ParsedArgs = ReturnType<typeof parseArgs>;
interface CommandDef {
    options: Record<string, boolean>;
    run: (args: ParsedArgs) => CliReport | Promise<CliReport>;
}
const COMMANDS: Record<string, CommandDef> = {
    help: { options: {}, run: () => helpCommand() },
    'data validate': {
        options: DATA_VALIDATE_OPTIONS,
        run: (args) => {
            const input = parseOption(args, 'input', DEFAULT_MANIFEST);
            return dataValidate(input, hasOption(args, 'verbose'));
        },
    },
    'data overalls': {
        options: DATA_OVERALLS_OPTIONS,
        run: (args) => dataOveralls({
            input: parseOption(args, 'input', DEFAULT_MANIFEST),
            franchise: getOptionString(args, 'franchise') ?? undefined,
            era: getOptionString(args, 'era') ?? undefined,
            player: getOptionString(args, 'player') ?? undefined,
            limit: getOptionString(args, 'limit') ?? undefined,
        }),
    },
    'data overalls-distribution': {
        options: DATA_OVERALLS_DISTRIBUTION_OPTIONS,
        run: (args) => dataOverallsDistribution({ input: parseOption(args, 'input', DEFAULT_MANIFEST) }),
    },
    'data defense-bpm-correlation': {
        options: DATA_DEFENSE_BPM_CORRELATION_OPTIONS,
        run: (args) => defenseBpmCorrelation({ input: parseOption(args, 'input', DEFAULT_MANIFEST) }),
    },
    'data coverage': {
        options: DATA_COVERAGE_OPTIONS,
        run: (args) => dataCoverage({
            input: parseOption(args, 'input', DEFAULT_MANIFEST),
            franchise: getOptionString(args, 'franchise') ?? undefined,
            era: getOptionString(args, 'era') ?? undefined,
            status: getOptionString(args, 'status') ?? undefined,
        }),
    },
    'data lineage-audit': {
        options: DATA_LINEAGE_AUDIT_OPTIONS,
        run: (args) => dataLineageAudit({
            input: parseOption(args, 'input', DEFAULT_MANIFEST),
            verifyLogos: hasOption(args, 'verify-logos'),
        }),
    },
    'data derive': {
        options: DATA_DERIVE_OPTIONS,
        run: (args) => dataDerive({
            player: getOptionString(args, 'player') ?? undefined,
            season: getOptionString(args, 'season') ?? undefined,
            franchise: getOptionString(args, 'franchise') ?? undefined,
        }),
    },
    'sim game': {
        options: SIM_OPTIONS,
        run: (args) => simGame({
            input: getOptionString(args, 'input') ?? undefined,
            seed: getOptionString(args, 'seed') ?? undefined,
            profile: getOptionString(args, 'profile') ?? undefined,
        }),
    },
    'sim batch': {
        options: SIM_OPTIONS,
        run: (args) => simBatch({
            fixture: getOptionString(args, 'fixture') ?? undefined,
            'seed-from': getOptionString(args, 'seed-from') ?? undefined,
            'seed-to': getOptionString(args, 'seed-to') ?? undefined,
            samples: getOptionString(args, 'samples') ?? undefined,
            workers: getOptionString(args, 'workers') ?? undefined,
            profile: getOptionString(args, 'profile') ?? undefined,
        }),
    },
    'sim diagnose': {
        options: DIAGNOSE_OPTIONS,
        run: (args) => simDiagnose({
            fixture: getOptionString(args, 'fixture') ?? undefined,
            samples: getOptionString(args, 'samples') ?? undefined,
            profile: getOptionString(args, 'profile') ?? undefined,
        }),
    },
    'sim season': {
        options: SEASON_OPTIONS,
        run: (args) => simSeason({
            fixture: getOptionString(args, 'fixture') ?? undefined,
            samples: getOptionString(args, 'samples') ?? undefined,
            profile: getOptionString(args, 'profile') ?? undefined,
        }),
    },
    'sim challenge': {
        options: SIM_CHALLENGE_OPTIONS,
        run: (args) => simChallenge({
            lineup: getOptionString(args, 'lineup') ?? undefined,
            seed: getOptionString(args, 'seed') ?? undefined,
            reruns: getOptionString(args, 'reruns') ?? undefined,
            era: getOptionString(args, 'era') ?? undefined,
            profile: getOptionString(args, 'profile') ?? undefined,
            bracket: getOptionString(args, 'bracket') ?? undefined,
        }),
    },
    'bracket audit': {
        options: BRACKET_AUDIT_OPTIONS,
        run: (args) => bracketAudit(parseOption(args, 'input', DEFAULT_MANIFEST), hasOption(args, 'verbose')),
    },
    'bracket generate': {
        options: BRACKET_GENERATE_OPTIONS,
        run: (args) => bracketGenerate({
            seed: getOptionString(args, 'seed') ?? undefined,
            proposals: getOptionString(args, 'proposals') ?? undefined,
            samples: getOptionString(args, 'samples') ?? undefined,
            'min-score': getOptionString(args, 'min-score') ?? undefined,
            'data-version': getOptionString(args, 'data-version') ?? undefined,
            verbose: hasOption(args, 'verbose'),
        }),
    },
    benchmark: {
        options: BENCHMARK_OPTIONS,
        run: (args) => benchmark({
            fixture: getOptionString(args, 'fixture') ?? undefined,
            samples: getOptionString(args, 'samples') ?? undefined,
            'seed-from': getOptionString(args, 'seed-from') ?? undefined,
            'seed-to': getOptionString(args, 'seed-to') ?? undefined,
            workers: getOptionString(args, 'workers') ?? undefined,
            profile: getOptionString(args, 'profile') ?? undefined,
            baseline: getOptionString(args, 'baseline') ?? undefined,
            'write-baseline': getOptionString(args, 'write-baseline') ?? undefined,
        }),
    },
    replay: {
        options: REPLAY_OPTIONS,
        run: (args) => replay({
            input: getOptionString(args, 'input') ?? undefined,
            expected: getOptionString(args, 'expected') ?? undefined,
        }),
    },
    'calibrate run': {
        options: CALIBRATE_OPTIONS,
        run: (args) => calibrateRun({
            samples: getOptionString(args, 'samples') ?? undefined,
            'seed-from': getOptionString(args, 'seed-from') ?? undefined,
            workers: getOptionString(args, 'workers') ?? undefined,
            profile: getOptionString(args, 'profile') ?? undefined,
            era: getOptionString(args, 'era') ?? undefined,
            'challenge-samples': getOptionString(args, 'challenge-samples') ?? undefined,
            'opponent-games': getOptionString(args, 'opponent-games') ?? undefined,
            'allow-skipped': hasOption(args, 'allow-skipped'),
        }),
    },
    'calibrate sensitivity': {
        options: CALIBRATE_OPTIONS,
        run: (args) => calibrateSensitivity({
            samples: getOptionString(args, 'samples') ?? undefined,
            profile: getOptionString(args, 'profile') ?? undefined,
            era: getOptionString(args, 'era') ?? undefined,
        }),
    },
    'calibrate ratings': {
        options: CALIBRATE_RATINGS_OPTIONS,
        run: (args) => calibrateRatings({
            samples: getOptionString(args, 'samples') ?? undefined,
            workers: getOptionString(args, 'workers') ?? undefined,
            output: getOptionString(args, 'output') ?? undefined,
            manifest: getOptionString(args, 'manifest') ?? undefined,
        }),
    },
    'calibrate three-point': {
        options: CALIBRATE_THREE_POINT_OPTIONS,
        run: (args) => calibrateThreePoint({
            write: hasOption(args, 'write'),
            format: getOptionString(args, 'format') ?? undefined,
            manifest: getOptionString(args, 'manifest') ?? undefined,
            output: getOptionString(args, 'output') ?? undefined,
        }),
    },
    'combine docs': {
        options: COMBINE_DOCS_OPTIONS,
        run: (args) => combineDocs({
            input: getOptionString(args, 'input') ?? undefined,
            output: getOptionString(args, 'output') ?? undefined,
            exceptions: getOptionString(args, 'exceptions') ?? undefined,
        }),
    },
    'season schedule generate': {
        options: SEASON_SCHEDULE_GENERATE_OPTIONS,
        run: (args) => seasonScheduleGenerate({
            out: getOptionString(args, 'out'),
            league: getOptionString(args, 'league'),
            seed: getOptionString(args, 'seed'),
        }),
    },
    'season schedule audit': {
        options: SEASON_SCHEDULE_AUDIT_OPTIONS,
        run: (args) => seasonScheduleAudit({
            schedule: getOptionString(args, 'schedule'),
            league: getOptionString(args, 'league'),
            manifest: getOptionString(args, 'manifest'),
            verbose: hasOption(args, 'verbose'),
        }),
    },
    'season draft reproduce': {
        options: SEASON_DRAFT_REPRODUCE_OPTIONS,
        run: (args) => seasonDraftReproduce({
            input: getOptionString(args, 'input') ?? null,
            manifest: getOptionString(args, 'manifest'),
        }),
    },
    'season rosters generate': {
        options: SEASON_ROSTERS_GENERATE_OPTIONS,
        run: (args) => seasonRostersGenerate({
            seed: getOptionString(args, 'seed') ?? null,
            draft: getOptionString(args, 'draft') ?? null,
            out: getOptionString(args, 'out'),
            manifest: getOptionString(args, 'manifest'),
        }),
    },
    'season rosters audit': {
        options: SEASON_ROSTERS_AUDIT_OPTIONS,
        run: (args) => seasonRostersAudit({
            input: getOptionString(args, 'input') ?? null,
            manifest: getOptionString(args, 'manifest') ?? null,
            'human-franchises': getOptionString(args, 'human-franchises') ?? null,
        }),
    },
    'season rosters calibrate': {
        options: SEASON_ROSTERS_CALIBRATE_OPTIONS,
        run: (args) => seasonRostersCalibrate({
            workers: getOptionString(args, 'workers') ?? undefined,
            'calibration-seeds': getOptionString(args, 'calibration-seeds') ?? undefined,
            'validation-seeds': getOptionString(args, 'validation-seeds') ?? undefined,
            out: getOptionString(args, 'out') ?? undefined,
            manifest: getOptionString(args, 'manifest') ?? undefined,
            targets: getOptionString(args, 'targets') ?? undefined,
            validate: hasOption(args, 'validate'),
        }),
    },
    'season draft calibrate': {
        options: SEASON_DRAFT_CALIBRATE_OPTIONS,
        run: (args) => seasonDraftCalibrate({
            workers: getOptionString(args, 'workers') ?? undefined,
            'calibration-seeds': getOptionString(args, 'calibration-seeds') ?? undefined,
            'validation-seeds': getOptionString(args, 'validation-seeds') ?? undefined,
            out: getOptionString(args, 'out') ?? undefined,
            manifest: getOptionString(args, 'manifest') ?? undefined,
        }),
    },
    'season game simulate': {
        options: SEASON_GAME_SIMULATE_OPTIONS,
        run: (args) => seasonGameSimulate({
            input: getOptionString(args, 'input') ?? null,
            seed: getOptionString(args, 'seed') ?? null,
        }),
    },
    'season game calibrate': {
        options: { ...SEASON_GAME_CALIBRATE_OPTIONS, effects: true },
        run: (args) => seasonGameCalibrate({
            fixture: getOptionString(args, 'fixture') ?? null,
            'seed-from': getOptionString(args, 'seed-from') ?? null,
            'seed-to': getOptionString(args, 'seed-to') ?? null,
            workers: getOptionString(args, 'workers') ?? null,
            out: getOptionString(args, 'out') ?? null,
            manifest: getOptionString(args, 'manifest') ?? null,
            effects: getOptionString(args, 'effects') ?? null,
        }),
    },
    'season block simulate': {
        options: SEASON_BLOCK_SIMULATE_OPTIONS,
        run: (args) => seasonBlockSimulate({
            input: getOptionString(args, 'input') ?? null,
            block: getOptionString(args, 'block') ?? null,
            manifest: getOptionString(args, 'manifest') ?? null,
            profile: getOptionString(args, 'profile') ?? null,
        }),
    },
    'season block audit': {
        options: SEASON_BLOCK_AUDIT_OPTIONS,
        run: (args) => seasonBlockAudit({
            input: getOptionString(args, 'input') ?? null,
            run: getOptionString(args, 'run') ?? null,
            manifest: getOptionString(args, 'manifest') ?? null,
            profile: getOptionString(args, 'profile') ?? null,
        }),
    },
    'season full simulate': {
        options: SEASON_FULL_SIMULATE_OPTIONS,
        run: (args) => seasonFullSimulate({
            input: getOptionString(args, 'input') ?? null,
            manifest: getOptionString(args, 'manifest') ?? null,
            profile: getOptionString(args, 'profile') ?? null,
        }),
    },
    'season home-court calibrate': {
        options: SEASON_HOME_COURT_CALIBRATE_OPTIONS,
        run: (args) => seasonHomeCourtCalibrate({
            fixture: getOptionString(args, 'fixture') ?? null,
            'seed-from': getOptionString(args, 'seed-from') ?? null,
            'seed-to': getOptionString(args, 'seed-to') ?? null,
            workers: getOptionString(args, 'workers') ?? null,
            constants: getOptionString(args, 'constants') ?? null,
            out: getOptionString(args, 'out') ?? null,
            manifest: getOptionString(args, 'manifest') ?? null,
            validate: getOptionString(args, 'validate') ?? null,
        }),
    },
    'season effects sensitivity': {
        options: SEASON_EFFECTS_OPTIONS,
        run: (args) => seasonEffectsSensitivity({
            fixture: getOptionString(args, 'fixture') ?? null,
            'seed-from': getOptionString(args, 'seed-from') ?? null,
            'seed-to': getOptionString(args, 'seed-to') ?? null,
            workers: getOptionString(args, 'workers') ?? null,
            out: getOptionString(args, 'out') ?? null,
            manifest: getOptionString(args, 'manifest') ?? null,
            validate: getOptionString(args, 'validate') ?? null,
        }),
    },
    'season effects distribution': {
        options: SEASON_EFFECTS_OPTIONS,
        run: (args) => seasonEffectsDistribution({
            fixture: getOptionString(args, 'fixture') ?? null,
            'seed-from': getOptionString(args, 'seed-from') ?? null,
            'seed-to': getOptionString(args, 'seed-to') ?? null,
            workers: getOptionString(args, 'workers') ?? null,
            out: getOptionString(args, 'out') ?? null,
            manifest: getOptionString(args, 'manifest') ?? null,
            validate: getOptionString(args, 'validate') ?? null,
        }),
    },
    'season effects roles': {
        options: SEASON_EFFECTS_OPTIONS,
        run: (args) => seasonEffectsRoles({
            fixture: getOptionString(args, 'fixture') ?? null,
            'seed-from': getOptionString(args, 'seed-from') ?? null,
            'seed-to': getOptionString(args, 'seed-to') ?? null,
            workers: getOptionString(args, 'workers') ?? null,
            out: getOptionString(args, 'out') ?? null,
            manifest: getOptionString(args, 'manifest') ?? null,
            validate: getOptionString(args, 'validate') ?? null,
        }),
    },
    'season effects calibrate': {
        options: SEASON_EFFECTS_OPTIONS,
        run: (args) => seasonEffectsCalibrate({
            fixture: getOptionString(args, 'fixture') ?? null,
            'seed-from': getOptionString(args, 'seed-from') ?? null,
            'seed-to': getOptionString(args, 'seed-to') ?? null,
            workers: getOptionString(args, 'workers') ?? null,
            out: getOptionString(args, 'out') ?? null,
            manifest: getOptionString(args, 'manifest') ?? null,
            validate: getOptionString(args, 'validate') ?? null,
        }),
    },
    'season health calibrate': {
        options: SEASON_HEALTH_CALIBRATE_OPTIONS,
        run: (args) => seasonHealthCalibrate({
            input: getOptionString(args, 'input') ?? null,
            'seed-from': getOptionString(args, 'seed-from') ?? null,
            'seed-to': getOptionString(args, 'seed-to') ?? null,
            workers: getOptionString(args, 'workers') ?? null,
            out: getOptionString(args, 'out') ?? null,
            manifest: getOptionString(args, 'manifest') ?? null,
            validate: getOptionString(args, 'validate') ?? null,
        }),
    },
    'season campaign audit': {
        options: SEASON_CAMPAIGN_AUDIT_OPTIONS,
        run: (args) => seasonCampaignAudit({
            input: getOptionString(args, 'input') ?? null,
            manifest: getOptionString(args, 'manifest') ?? null,
        }),
    },
    'season campaign calibrate': {
        options: SEASON_CAMPAIGN_CALIBRATE_OPTIONS,
        run: (args) => seasonCampaignCalibrate({
            input: getOptionString(args, 'input') ?? null,
            'seed-from': getOptionString(args, 'seed-from') ?? null,
            'seed-to': getOptionString(args, 'seed-to') ?? null,
            workers: getOptionString(args, 'workers') ?? null,
            out: getOptionString(args, 'out') ?? null,
            manifest: getOptionString(args, 'manifest') ?? null,
            validate: getOptionString(args, 'validate') ?? null,
            write: hasOption(args, 'write'),
        }),
    },
    'season trade audit': {
        options: SEASON_TRADE_AUDIT_OPTIONS,
        run: (args) => seasonTradeAudit({
            input: getOptionString(args, 'input') ?? null,
            manifest: getOptionString(args, 'manifest') ?? null,
        }),
    },
    'season trade calibrate': {
        options: { ...SEASON_TRADE_CALIBRATE_OPTIONS, write: false },
        run: (args) => seasonTradeCalibrate({
            input: getOptionString(args, 'input') ?? null,
            'seed-from': getOptionString(args, 'seed-from') ?? null,
            'seed-to': getOptionString(args, 'seed-to') ?? null,
            workers: getOptionString(args, 'workers') ?? null,
            out: getOptionString(args, 'out') ?? null,
            manifest: getOptionString(args, 'manifest') ?? null,
            validate: getOptionString(args, 'validate') ?? null,
        }),
    },
    'season influence calibrate': {
        options: { ...SEASON_INFLUENCE_CALIBRATE_OPTIONS, write: false },
        run: (args) => seasonInfluenceCalibrate({
            input: getOptionString(args, 'input') ?? null,
            'seed-from': getOptionString(args, 'seed-from') ?? null,
            'seed-to': getOptionString(args, 'seed-to') ?? null,
            workers: getOptionString(args, 'workers') ?? null,
            out: getOptionString(args, 'out') ?? null,
            manifest: getOptionString(args, 'manifest') ?? null,
            validate: getOptionString(args, 'validate') ?? null,
        }),
    },
    'season free-agency audit': {
        options: SEASON_FREE_AGENCY_AUDIT_OPTIONS,
        run: (args) => seasonFreeAgencyAudit({
            input: getOptionString(args, 'input') ?? null,
            manifest: getOptionString(args, 'manifest') ?? null,
        }),
    },
    'season free-agency calibrate': {
        options: SEASON_FREE_AGENCY_CALIBRATE_OPTIONS,
        run: (args) => seasonFreeAgencyCalibrate({
            input: getOptionString(args, 'input') ?? null,
            'seed-from': getOptionString(args, 'seed-from') ?? null,
            'seed-to': getOptionString(args, 'seed-to') ?? null,
            workers: getOptionString(args, 'workers') ?? null,
            out: getOptionString(args, 'out') ?? null,
            manifest: getOptionString(args, 'manifest') ?? null,
            validate: getOptionString(args, 'validate') ?? null,
        }),
    },
    'season run reproduce': {
        options: SEASON_RUN_REPRODUCE_OPTIONS,
        run: (args) => seasonRunReproduce({
            input: getOptionString(args, 'input') ?? null,
            manifest: getOptionString(args, 'manifest') ?? null,
            profile: getOptionString(args, 'profile') ?? null,
        }),
    },
    'season postseason audit': {
        options: SEASON_POSTSEASON_AUDIT_OPTIONS,
        run: (args) => seasonPostseasonAudit({
            input: getOptionString(args, 'input') ?? null,
        }),
    },
    'season postseason calibrate': {
        options: SEASON_POSTSEASON_CALIBRATE_OPTIONS,
        run: (args) => seasonPostseasonCalibrate({
            input: getOptionString(args, 'input') ?? null,
            'seed-from': getOptionString(args, 'seed-from') ?? null,
            'seed-to': getOptionString(args, 'seed-to') ?? null,
            workers: getOptionString(args, 'workers') ?? null,
            out: getOptionString(args, 'out') ?? null,
            manifest: getOptionString(args, 'manifest') ?? null,
            validate: getOptionString(args, 'validate') ?? null,
            write: hasOption(args, 'write'),
        }),
    },
    'season benchmark block': {
        options: SEASON_BENCHMARK_OPTIONS,
        run: (args) => seasonBenchmarkBlock({
            input: getOptionString(args, 'input') ?? null,
            manifest: getOptionString(args, 'manifest') ?? null,
            profile: getOptionString(args, 'profile') ?? null,
            out: getOptionString(args, 'out') ?? null,
        }),
    },
    'season benchmark full': {
        options: SEASON_BENCHMARK_OPTIONS,
        run: (args) => seasonBenchmarkFull({
            input: getOptionString(args, 'input') ?? null,
            manifest: getOptionString(args, 'manifest') ?? null,
            profile: getOptionString(args, 'profile') ?? null,
            out: getOptionString(args, 'out') ?? null,
        }),
    },
    'season benchmark determinism': {
        options: SEASON_BENCHMARK_OPTIONS,
        run: (args) => seasonBenchmarkDeterminism({
            input: getOptionString(args, 'input') ?? null,
            manifest: getOptionString(args, 'manifest') ?? null,
            profile: getOptionString(args, 'profile') ?? null,
            out: getOptionString(args, 'out') ?? null,
        }),
    },
    'season benchmark persistence': {
        options: SEASON_BENCHMARK_OPTIONS,
        run: (args) => seasonBenchmarkPersistence({
            samples: getOptionString(args, 'samples') ?? null,
            out: getOptionString(args, 'out') ?? null,
        }),
    },
    'projection base': {
        options: PROJECTION_BASE_OPTIONS,
        run: (args) => projectionBase({
            fixture: getOptionString(args, 'fixture'),
            manifest: getOptionString(args, 'manifest'),
            model: getOptionString(args, 'model'),
            era: getOptionString(args, 'era'),
            reference: getOptionString(args, 'reference'),
            verbose: hasOption(args, 'verbose'),
        }),
    },
    'projection season': {
        options: PROJECTION_SEASON_OPTIONS,
        run: (args) => projectionSeason({
            fixture: getOptionString(args, 'fixture'),
            manifest: getOptionString(args, 'manifest'),
            model: getOptionString(args, 'model'),
            era: getOptionString(args, 'era'),
            verbose: hasOption(args, 'verbose'),
        }),
    },
    'projection build': {
        options: PROJECTION_BUILD_OPTIONS,
        run: (args) => projectionBuild({
            manifest: getOptionString(args, 'manifest'),
            out: getOptionString(args, 'out'),
            write: hasOption(args, 'write'),
            verbose: hasOption(args, 'verbose'),
        }),
    },
    'projection calibrate-base': {
        options: PROJECTION_CALIBRATE_OPTIONS,
        run: (args) => projectionCalibrateBase({
            manifest: getOptionString(args, 'manifest'),
            model: getOptionString(args, 'model'),
            targets: getOptionString(args, 'targets'),
            'seed-from': getOptionString(args, 'seed-from'),
            'seed-to': getOptionString(args, 'seed-to'),
            samples: getOptionString(args, 'samples'),
            workers: getOptionString(args, 'workers'),
            era: getOptionString(args, 'era'),
            out: getOptionString(args, 'out'),
            validate: hasOption(args, 'validate'),
            'write-model': hasOption(args, 'write-model'),
            verbose: hasOption(args, 'verbose'),
        }),
    },
    'projection validate': {
        options: PROJECTION_CALIBRATE_OPTIONS,
        run: (args) => projectionCalibrateBase({
            manifest: getOptionString(args, 'manifest'),
            model: getOptionString(args, 'model'),
            targets: getOptionString(args, 'targets'),
            'seed-from': getOptionString(args, 'seed-from'),
            'seed-to': getOptionString(args, 'seed-to'),
            samples: getOptionString(args, 'samples'),
            workers: getOptionString(args, 'workers'),
            era: getOptionString(args, 'era'),
            out: getOptionString(args, 'out'),
            validate: true,
            'write-model': false,
            verbose: hasOption(args, 'verbose'),
        }),
    },
    'projection benchmark': {
        options: PROJECTION_BENCHMARK_OPTIONS,
        run: (args) => projectionBenchmark({
            manifest: getOptionString(args, 'manifest'),
            model: getOptionString(args, 'model'),
            era: getOptionString(args, 'era'),
            samples: getOptionString(args, 'samples'),
            verbose: hasOption(args, 'verbose'),
        }),
    },
    'projection ai-shadow': {
        options: PROJECTION_AI_SHADOW_OPTIONS,
        run: (args) => projectionAiShadow({
            manifest: getOptionString(args, 'manifest'),
            model: getOptionString(args, 'model'),
            era: getOptionString(args, 'era'),
            seed: getOptionString(args, 'seed'),
            verbose: hasOption(args, 'verbose'),
        }),
    },
    'import ratings': {
        options: IMPORT_RATINGS_OPTIONS,
        run: (args) => importRatings({
            seasons: getOptionString(args, 'seasons'),
            forceRatings: hasOption(args, 'force-ratings'),
            workers: getOptionString(args, 'workers'),
        }),
    },
    'import pools': {
        options: IMPORT_POOLS_OPTIONS,
        run: (args) => importPools({
            pools: getOptionString(args, 'pools'),
            all: hasOption(args, 'all'),
            noAssets: hasOption(args, 'no-assets'),
            workers: getOptionString(args, 'workers'),
        }),
    },
    'import era-profile': {
        options: IMPORT_ERA_PROFILE_OPTIONS,
        run: (args) => importEraProfile({ era: getOptionString(args, 'era') }),
    },
    'import manifest': {
        options: IMPORT_MANIFEST_OPTIONS,
        run: () => importManifest(),
    },
    'import opponent': {
        options: IMPORT_OPPONENT_OPTIONS,
        run: () => importOpponent(),
    },
    'import freeze': {
        options: IMPORT_FREEZE_OPTIONS,
        run: (args) => importFreeze({
            report: getOptionString(args, 'report'),
            era: getOptionString(args, 'era'),
        }),
    },
    'import run-all': {
        options: IMPORT_RUN_ALL_OPTIONS,
        run: (args) => importRunAll({
            seasons: getOptionString(args, 'seasons'),
            includeSchedule: hasOption(args, 'include-schedule'),
            forceStints: hasOption(args, 'force-stints'),
            forceRatings: hasOption(args, 'force-ratings'),
            workers: getOptionString(args, 'workers'),
            skipBbref: hasOption(args, 'skip-bbref'),
            pools: getOptionString(args, 'pools'),
        }),
    },
};
function usageError(message: string): CliReport {
    return makeReport('usage', { message }, { failures: [message], exitCode: EXIT_USAGE_OR_DATA_ERROR });
}
async function main(argv: string[]): Promise<{
    report: CliReport;
    format: 'text' | 'json';
}> {
    if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
        const def = COMMANDS['help'];
        if (def === undefined) {
            return { report: usageError('missing command'), format: 'text' };
        }
        return {
            report: await def.run({ command: [], positional: [], options: new Map() }),
            format: 'text',
        };
    }
    let parsed: ParsedArgs;
    let commandKey: string;
    let def: CommandDef;
    try {
        commandKey = argv.slice(0, 3).join(' ');
        let entry = COMMANDS[commandKey];
        if (!entry) {
            commandKey = argv.slice(0, 2).join(' ');
            entry = COMMANDS[commandKey];
        }
        if (!entry) {
            const candidate = argv[0];
            if (candidate !== undefined && COMMANDS[candidate]) {
                commandKey = candidate;
                entry = COMMANDS[candidate];
            }
        }
        if (!entry) {
            const candidate = argv[0];
            if (candidate === undefined) {
                return { report: usageError('missing command'), format: 'text' };
            }
            return { report: usageError(`unknown command "${candidate}"`), format: 'text' };
        }
        def = entry;
        parsed = parseArgs(argv, def.options);
    }
    catch (error) {
        if (error instanceof UsageError) {
            return { report: usageError(error.message), format: 'text' };
        }
        throw error;
    }
    const format = getOptionString(parsed, 'format') ?? 'text';
    if (format !== 'text' && format !== 'json') {
        return {
            report: usageError(`--format must be text or json (got "${format}")`),
            format: 'text',
        };
    }
    if (parsed.positional.length > 0) {
        return {
            report: usageError(`unexpected positional arguments: ${parsed.positional.join(' ')}`),
            format: 'text',
        };
    }
    try {
        const report = await def.run(parsed);
        return { report, format };
    }
    catch (error) {
        if (error instanceof UsageError) {
            return { report: usageError(error.message), format: 'text' };
        }
        throw error;
    }
}
const { report, format } = await main(process.argv.slice(2));
const output = format === 'json' ? renderJson(report) : renderText(report);
if (report.exitCode === EXIT_OK) {
    process.stdout.write(`${output}\n`);
}
else {
    process.stderr.write(`${output}\n`);
}
process.exitCode = report.exitCode;
