import { calibrateCommands } from './calibrate.ts';
import { dataCommands } from './data.ts';
import { havocCommands } from './havoc.ts';
import { simCommands } from './sim.ts';
import { docsCommands } from './docs.ts';
import { projectionCommands } from './projection.ts';
import { importCommands } from './import.ts';
import { helpReport, type CommandSpec } from './core.ts';

export { buildHelpText, declaredOptions, helpReport, makeCommandArgs, usageError } from './core.ts';
export type { CommandSpec } from './core.ts';

const AREA_COMMANDS: Record<string, CommandSpec> = {};
for (const commands of [
  calibrateCommands,
  dataCommands,
  havocCommands,
  simCommands,
  docsCommands,
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
projection base
projection build
projection calibrate-base
projection validate
projection benchmark
import ratings
import pools
import era-profile
import manifest
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
