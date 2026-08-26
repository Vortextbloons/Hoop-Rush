import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { REPO_ROOT } from './config.ts';
export interface RunPythonOptions {
    python?: string;
    env?: NodeJS.ProcessEnv;
}
export function pythonInterpreter(options: RunPythonOptions = {}): string {
    return options.python ?? process.env.HOOP_RUSH_PYTHON ?? 'python';
}
export function runPythonFetch(args: string[], options: RunPythonOptions = {}): Promise<number> {
    const script = join(REPO_ROOT, 'scripts', 'import-nba', 'fetch_all.py');
    return new Promise((resolvePromise, reject) => {
        const child = spawn(pythonInterpreter(options), [script, ...args], {
            cwd: REPO_ROOT,
            env: { ...process.env, ...options.env },
            stdio: 'inherit',
        });
        child.on('error', (error) => {
            reject(new Error(`failed to spawn python (${pythonInterpreter(options)}): ${error.message}. ` +
                'Install Python and nba_api, or set HOOP_RUSH_PYTHON to the interpreter path.'));
        });
        child.on('close', (code, signal) => {
            if (code === 0) {
                resolvePromise(code);
            }
            else if (signal !== null) {
                reject(new Error(`python fetch layer terminated by signal ${signal}`));
            }
            else {
                reject(new Error(`python fetch layer exited with code ${code === null ? 'unknown' : String(code)}`));
            }
        });
    });
}
