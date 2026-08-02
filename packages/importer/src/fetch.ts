/**
 * Spawn the Python fetch layer from the TS pipeline.
 *
 * Python remains the import layer: it talks to nba_api and the asset CDNs and
 * writes raw-data JSON. The TS orchestrator (`import run-all`) spawns it and
 * performs all compute natively.
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { REPO_ROOT } from './config.js';

export interface RunPythonOptions {
  /** Python interpreter; defaults to HOOP_RUSH_PYTHON env or "python". */
  python?: string;
  /** Extra environment variables to merge into the child process env. */
  env?: NodeJS.ProcessEnv;
}

export function pythonInterpreter(options: RunPythonOptions = {}): string {
  return options.python ?? process.env.HOOP_RUSH_PYTHON ?? 'python';
}

/**
 * Run the fetch-only entry point. Streams child stdout/stderr to the parent and
 * resolves the child's exit code; rejects with a descriptive error on failure.
 */
export function runPythonFetch(args: string[], options: RunPythonOptions = {}): Promise<number> {
  const script = join(REPO_ROOT, 'scripts', 'import-nba', 'fetch_all.py');
  return new Promise((resolvePromise, reject) => {
    const child = spawn(pythonInterpreter(options), [script, ...args], {
      cwd: REPO_ROOT,
      env: { ...process.env, ...options.env },
      stdio: 'inherit',
    });
    child.on('error', (error) => {
      reject(
        new Error(
          `failed to spawn python (${pythonInterpreter(options)}): ${error.message}. ` +
            'Install Python and nba_api, or set HOOP_RUSH_PYTHON to the interpreter path.',
        ),
      );
    });
    child.on('close', (code, signal) => {
      if (code === 0) {
        resolvePromise(code);
      } else if (signal !== null) {
        reject(new Error(`python fetch layer terminated by signal ${signal}`));
      } else {
        reject(
          new Error(
            `python fetch layer exited with code ${code === null ? 'unknown' : String(code)}`,
          ),
        );
      }
    });
  });
}
