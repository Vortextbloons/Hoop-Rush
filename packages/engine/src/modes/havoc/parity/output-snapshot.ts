import { canonicalJson, seasonDigestHex } from '@hoop-rush/data-contracts';

/**
 * Test-only serialization for parity fixtures and benchmarks. Uses the slow
 * reference canonical JSON implementation so a Wasm serializer change cannot
 * mask (or manufacture) a simulation parity difference.
 */

export interface SimulatedOutput {
  readonly result: unknown;
  readonly tape: unknown;
  readonly audit: unknown;
  readonly facts?: readonly unknown[];
}

export interface OutputHashes {
  readonly resultHash: string;
  readonly tapeHash: string;
  readonly auditHash: string;
  readonly factsHash: string;
}

export interface OutputSummary {
  readonly homePoints: number;
  readonly awayPoints: number;
  readonly overtimePeriods: number;
  readonly tapeEvents: number;
  readonly tapeScoring: number;
  readonly auditOk: boolean;
  readonly findingCodes: readonly string[];
  readonly facts: number;
}

export function referenceHash(value: unknown): string {
  return seasonDigestHex(canonicalJson(value));
}

export function outputHashes(output: SimulatedOutput): OutputHashes {
  return {
    resultHash: referenceHash(output.result),
    tapeHash: referenceHash(output.tape),
    auditHash: referenceHash(output.audit),
    factsHash: referenceHash(output.facts ?? []),
  };
}

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function outputSummary(output: SimulatedOutput): OutputSummary {
  const result = recordOf(output.result);
  const home = recordOf(result.home);
  const away = recordOf(result.away);
  const tape = recordOf(output.tape);
  const audit = recordOf(output.audit);
  const findings = arrayOf(audit.findings);
  return {
    homePoints: Number(home.points ?? 0),
    awayPoints: Number(away.points ?? 0),
    overtimePeriods: Number(result.overtimePeriods ?? 0),
    tapeEvents: arrayOf(tape.events).length,
    tapeScoring: arrayOf(tape.scoring).length,
    auditOk: audit.ok === true,
    findingCodes: findings.map((finding) => {
      const code = recordOf(finding).code;
      return typeof code === 'string' ? code : '';
    }),
    facts: arrayOf(output.facts).length,
  };
}

/** Derives the observable features a fixture is meant to exercise. */
export function outputFeatures(output: SimulatedOutput): Set<string> {
  const found = new Set<string>();
  const result = recordOf(output.result);
  if (Number(result.overtimePeriods ?? 0) > 0) found.add('overtime');
  const events = arrayOf(recordOf(output.tape).events);
  for (const raw of events) {
    const event = recordOf(raw);
    if (event.kind === 'substitution' && event.reason === 'foul-out') found.add('foul-out');
    if (event.kind === 'clone' && event.outcome === 'entered') found.add('clone-entered');
    if (event.kind === 'clone' && event.outcome === 'exited') found.add('clone-exited');
    if (event.kind === 'fusion-dance') found.add('fusion');
  }
  return found;
}
