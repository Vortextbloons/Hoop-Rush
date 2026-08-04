import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const host = '127.0.0.1';
const port = 4173;
const baseURL = `http://${host}:${String(port)}`;
const viteCli = resolve(webRoot, 'node_modules/vite/bin/vite.js');
const playwrightCli = resolve(webRoot, 'node_modules/@playwright/test/cli.js');

async function isReady() {
  try {
    const response = await fetch(baseURL, { signal: AbortSignal.timeout(750) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitUntilReady(server) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(
        `Vite preview exited before becoming ready (code ${String(server.exitCode)})`,
      );
    }
    if (await isReady()) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Vite preview did not become ready at ${baseURL}`);
}

function run(command, args, env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: webRoot,
      env,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      resolvePromise(code ?? (signal ? 1 : 0));
    });
  });
}

let server = null;
try {
  if (!(await isReady())) {
    server = spawn(
      process.execPath,
      [viteCli, 'preview', '--host', host, '--port', String(port), '--strictPort'],
      {
        cwd: webRoot,
        stdio: 'inherit',
        windowsHide: true,
      },
    );
    await waitUntilReady(server);
  }

  const exitCode = await run(process.execPath, [playwrightCli, 'test', ...process.argv.slice(2)], {
    ...process.env,
    HOOP_RUSH_E2E_BASE_URL: baseURL,
    HOOP_RUSH_E2E_EXTERNAL_SERVER: '1',
  });
  process.exitCode = exitCode;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  server?.kill();
}
