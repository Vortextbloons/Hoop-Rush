import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PUBLIC_DATA } from '../config.ts';
import { fileExists, readJson, writeJson } from '../json.ts';
export const ERA_SIM_DIR = join(PUBLIC_DATA, 'era-sim');
export const MINIMUM_SAMPLES: Readonly<Record<string, number>> = {
    closeGameRate: 2000,
    blowoutRate: 2000,
    overtimeRate: 2000,
    strongVsWeakWinRate: 2000,
    equalLineupHomeWinRate: 2000,
};
export interface CalibrationMetric {
    key: string;
    observed: number;
}
export interface CalibrationPayload {
    command: string;
    eraId: string;
    samples: number;
    engineVersion: string;
    metrics: CalibrationMetric[];
}
const round4 = (value: number): number => Math.round(value * 10000) / 10000;
export function extractCalibrationPayload(raw: string): CalibrationPayload {
    const start = raw.indexOf('{');
    if (start < 0) {
        throw new Error('report contains no JSON payload');
    }
    let depth = 0;
    let end = -1;
    for (let i = start; i < raw.length; i += 1) {
        if (raw[i] === '{') {
            depth += 1;
        }
        else if (raw[i] === '}') {
            depth -= 1;
            if (depth === 0) {
                end = i + 1;
                break;
            }
        }
    }
    if (end < 0) {
        throw new Error('report JSON payload is not closed');
    }
    const report = JSON.parse(raw.slice(start, end)) as {
        payload?: CalibrationPayload;
    };
    const payload = report.payload;
    if (payload === undefined || payload.command !== 'calibrate run') {
        throw new Error(`expected a calibrate run report, got ${payload?.command ?? '(missing payload)'}`);
    }
    return payload;
}
export interface FrozenProfile {
    profileVersion: string;
    baselineReport: string;
    targets: Record<string, unknown>;
}
export function freezeTargets(reportPath: string, eraId = '1990s', profilePath?: string): void {
    const raw = readFileSync(reportPath, 'utf8').replace(/^\uFEFF/, '');
    const payload = extractCalibrationPayload(raw);
    const resolved = profilePath ?? join(ERA_SIM_DIR, `${eraId}.json`);
    if (!fileExists(resolved)) {
        throw new Error(`no era profile at ${resolved}`);
    }
    if (payload.eraId !== eraId) {
        throw new Error(`report is for era ${payload.eraId}, not ${eraId}`);
    }
    const observed = new Map<string, number>();
    for (const metric of payload.metrics)
        observed.set(metric.key, metric.observed);
    const profile = readJson(resolved) as FrozenProfile;
    const newVersion = `m3-${eraId}-v2`;
    profile.profileVersion = newVersion;
    profile.baselineReport = `calibrate run --samples ${String(payload.samples)} (engine ${payload.engineVersion})`;
    const targets = profile.targets;
    const setTarget = (path: string, value: number): void => {
        let node: unknown = targets;
        for (const part of path.split('.')) {
            if (typeof node !== 'object' || node === null || !(part in node)) {
                throw new Error(`profile has no target ${path}`);
            }
            node = (node as Record<string, unknown>)[part];
        }
        if (typeof node !== 'object' || node === null) {
            throw new Error(`profile has no target ${path}`);
        }
        const targetObj = node as Record<string, unknown>;
        targetObj['value'] = round4(value);
        const existingSample = targetObj['minimumSample'];
        targetObj['minimumSample'] =
            MINIMUM_SAMPLES[path] ?? (typeof existingSample === 'number' ? existingSample : 200);
    };
    for (const [key, value] of observed)
        setTarget(key, value);
    writeJson(resolved, profile, true);
    console.log(`froze ${String(observed.size)} targets into ${resolved} (${newVersion})`);
}
export function run(reportPath: string, eraId = '1990s'): void {
    freezeTargets(reportPath, eraId);
}
