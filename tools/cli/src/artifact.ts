import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { z } from 'zod';
import { sha256Hex, readJson } from './io.ts';
import { makeReport, type CliReport } from './report.ts';
function atomicWriteFileSync(target: string, content: string): void {
    const tmp = `${target}.tmp-${String(Date.now())}-${String(Math.random()).slice(2)}`;
    writeFileSync(tmp, content);
    renameSync(tmp, target);
}
export function commitTargetsArtifact(args: {
    outPath: string;
    defaultTargetsPath: string;
    manifestPath: string;
    manifestKey: string;
    manifestUrl: string;
    content: unknown;
}): {
    written: boolean;
    path: string | null;
    error: string | null;
} {
    try {
        const target = resolve(args.outPath);
        mkdirSync(dirname(target), { recursive: true });
        atomicWriteFileSync(target, `${JSON.stringify(args.content, null, 2)}\n`);
        if (resolve(args.outPath) === resolve(args.defaultTargetsPath)) {
            const manifestPathResolved = resolve(args.manifestPath);
            const manifest = JSON.parse(readFileSync(manifestPathResolved, 'utf8')) as {
                season?: Record<string, {
                    url?: string;
                    contentHash?: string;
                }>;
            };
            if (manifest.season !== undefined) {
                manifest.season[args.manifestKey] = {
                    url: args.manifestUrl,
                    contentHash: sha256Hex(readFileSync(target)),
                };
                atomicWriteFileSync(manifestPathResolved, `${JSON.stringify(manifest, null, 2)}\n`);
            }
        }
        return { written: true, path: target, error: null };
    }
    catch (error) {
        return {
            written: false,
            path: null,
            error: `cannot write targets: ${(error as Error).message}`,
        };
    }
}
export function validateTargetsArtifact<T>(args: {
    outPath: string;
    schema: z.ZodType<T>;
    command: string;
    extraChecks?: (parsed: T) => {
        details: string[];
        failures: string[];
    };
}): CliReport {
    const failuresList: string[] = [];
    const details: string[] = [];
    let parsed: T | null = null;
    try {
        parsed = args.schema.parse(readJson(args.outPath));
        details.push(`artifact ${args.outPath} validates against the schema`);
    }
    catch (error) {
        failuresList.push(`artifact fails validation: ${(error as Error).message}`);
    }
    if (parsed !== null) {
        const extra = args.extraChecks?.(parsed) ?? { details: [], failures: [] };
        details.push(...extra.details);
        failuresList.push(...extra.failures);
        const gates = (parsed as {
            gates?: Record<string, unknown>;
        }).gates;
        if (gates !== undefined) {
            const gatePass = Object.values(gates).every(Boolean);
            if (!gatePass)
                failuresList.push('artifact records failed calibration gates');
            else
                details.push('artifact records all-passing gates');
        }
    }
    return makeReport(args.command, {}, { details, failures: failuresList });
}
export function runWorkerChunk<TResult>(args: {
    workerUrl: URL;
    workerData: unknown;
    payloadKey: string;
}): Promise<TResult> {
    return new Promise<TResult>((resolvePromise, rejectPromise) => {
        let settled = false;
        const worker = new Worker(args.workerUrl, { workerData: args.workerData });
        worker.on('message', (message: unknown) => {
            if (settled)
                return;
            settled = true;
            resolvePromise((message as Record<string, TResult>)[args.payloadKey] as TResult);
            void worker.terminate().catch(() => { });
        });
        worker.on('error', (error) => {
            if (settled)
                return;
            settled = true;
            rejectPromise(error);
        });
        worker.on('exit', (code) => {
            if (settled)
                return;
            if (code !== 0)
                rejectPromise(new Error(`worker exited ${String(code)}`));
        });
    });
}
export function runWorkerChunks<TItem, TResult>(args: {
    workerUrl: URL;
    workerData: (chunk: TItem[]) => unknown;
    items: readonly TItem[];
    workers: number;
    payloadKey: string;
}): Promise<TResult[]> {
    const safeWorkers = Math.max(1, Math.floor(args.workers));
    const chunkSize = Math.max(1, Math.ceil(args.items.length / safeWorkers));
    const chunks: TItem[][] = [];
    for (let i = 0; i < args.items.length; i += chunkSize) {
        chunks.push(args.items.slice(i, i + chunkSize));
    }
    return Promise.all(chunks.map((chunk) => runWorkerChunk<TResult[]>({
        workerUrl: args.workerUrl,
        workerData: args.workerData(chunk),
        payloadKey: args.payloadKey,
    }))).then((results) => results.flat());
}
