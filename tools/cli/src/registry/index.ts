import { calibrateCommands } from './calibrate.ts';
import { dataCommands } from './data.ts';
import { havocCommands } from './havoc.ts';
import { simCommands } from './sim.ts';
import { docsCommands } from './docs.ts';
import { seasonCommands } from './season.ts';
import { collectionCommands } from './collection.ts';
import { projectionCommands } from './projection.ts';
import { importCommands } from './import.ts';
import { helpReport, type CommandSpec } from './core.ts';

export {
  COMMON_OPTIONS,
  buildHelpText,
  declaredOptions,
  helpReport,
  makeCommandArgs,
  usageError,
} from './core.ts';
export type { CommandArgs, CommandSpec, OptionKind } from './core.ts';

const AREA_COMMANDS: Record<string, CommandSpec> = {};
for (const commands of [
  calibrateCommands,
  dataCommands,
  havocCommands,
  simCommands,
  docsCommands,
  seasonCommands,
  collectionCommands,
  projectionCommands,
  importCommands,
]) {
  for (const command of commands) {
    if (AREA_COMMANDS[command.name] !== undefined) {
      throw new Error(`duplicate CLI command: ${command.name}`);
    }
    AREA_COMMANDS[command.name] = command;
  }
}

export const COMMAND_ORDER: readonly string[] = `calibrate overall
data validate
data overalls-compare
data overalls
data overalls-distribution
data overalls-audit
data positions-coverage
data defense-bpm-correlation
data coverage
data lineage-audit
data derive
havoc simulate
havoc audit
havoc calibrate
sim game
sim batch
sim diagnose
sim season
sim challenge
sim challenge-average
bracket audit
bracket generate
benchmark
benchmark draft-fit
replay
calibrate run
calibrate sensitivity
calibrate ratings
calibrate three-point
combine docs
season schedule generate
season schedule audit
season draft reproduce
collection pack-audit
collection pull-reproduce
collection pack-calibrate
collection game-audit
collection game-reproduce
collection game-calibrate
collection progression-audit
collection progression-calibrate
season rosters generate
season rosters audit
season rosters calibrate
season draft calibrate
season game simulate
season game calibrate
season block simulate
season block audit
season full simulate
season home-court calibrate
season effects sensitivity
season effects distribution
season effects roles
season effects calibrate
season health calibrate
season trade audit
season trade calibrate
season influence calibrate
season challenges calibrate
season evolution calibrate
season evolution validate
season evolution benchmark
season free-agency audit
season free-agency calibrate
season run reproduce
season postseason audit
season postseason calibrate
season benchmark block
season benchmark full
season benchmark determinism
season benchmark persistence
projection base
projection season
projection build
projection calibrate-base
projection validate
projection benchmark
projection ai-shadow
import ratings
import pools
import era-profile
import manifest
import opponent
import freeze
import run-all`.split('\n');

export const COMMANDS: readonly CommandSpec[] = [
  {
    name: 'help',
    options: {},
    help: '  help                   Show this help',
    run: () => helpReport(COMMANDS),
  },
  ...COMMAND_ORDER.map((name) => {
    const command = AREA_COMMANDS[name];
    if (command === undefined) throw new Error(`unknown CLI command: ${name}`);
    return command;
  }),
];
