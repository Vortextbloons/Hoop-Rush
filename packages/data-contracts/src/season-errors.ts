export class SeasonRunCommandStaleStateError extends Error {
  readonly commandId: string;
  readonly expectedStateRevision: number;
  readonly storedStateRevision: number;
  constructor(commandId: string, expectedStateRevision: number, storedStateRevision: number) {
    super(
      `season run command ${commandId} asserts stale state (expected revision ` +
        `${String(expectedStateRevision)}, stored ${String(storedStateRevision)})`,
    );
    this.name = 'SeasonRunCommandStaleStateError';
    this.commandId = commandId;
    this.expectedStateRevision = expectedStateRevision;
    this.storedStateRevision = storedStateRevision;
  }
}
export class SeasonRunCommandDuplicateError extends Error {
  readonly commandId: string;
  constructor(commandId: string) {
    super(`season run command ${commandId} was already applied`);
    this.name = 'SeasonRunCommandDuplicateError';
    this.commandId = commandId;
  }
}
export class SeasonRunCommandRunMismatchError extends Error {
  readonly runId: string;
  constructor(runId: string) {
    super(`season run command targets run ${runId}, not the active run`);
    this.name = 'SeasonRunCommandRunMismatchError';
    this.runId = runId;
  }
}
export class SeasonPendingBlockRejectedError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`pending block rejected: ${reason}`);
    this.name = 'SeasonPendingBlockRejectedError';
    this.reason = reason;
  }
}
export class SeasonRunLoadError extends Error {
  readonly code: string;
  readonly failures: readonly string[];
  constructor(failures: readonly string[], message?: string, code = 'SEASON_RUN_LOAD_FAILED') {
    super(
      message ??
        `Season Run reload validation failed (${String(failures.length)} failure(s)): ` +
          failures.join('; '),
    );
    this.name = 'SeasonRunLoadError';
    this.code = code;
    this.failures = failures;
  }
}
export class SeasonPostseasonIntegrityError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`season postseason integrity failure: ${reason}`);
    this.name = 'SeasonPostseasonIntegrityError';
    this.reason = reason;
  }
}
