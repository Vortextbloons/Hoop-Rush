export type HavocLoadFailureCode = 'corrupt' | 'unsupported';

export class HavocLoadError extends Error {
  readonly code: HavocLoadFailureCode;
  readonly diagnostics: readonly string[];
  constructor(code: HavocLoadFailureCode, diagnostics: readonly string[]) {
    super(`havoc load ${code}: ${diagnostics.join('; ')}`);
    this.name = 'HavocLoadError';
    this.code = code;
    this.diagnostics = diagnostics;
  }
}
