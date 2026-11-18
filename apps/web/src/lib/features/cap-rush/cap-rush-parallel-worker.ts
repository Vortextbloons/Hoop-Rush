import {
  CAP_RUSH_WORKER_WIRE_SCHEMA_VERSION,
  capRushWorkerMessageSchema,
  capRushWorkerRequestSchema,
  type CapRushLeagueGame,
  type CapRushWorkerGameMessage,
  type CapRushWorkerMessage,
  type CapRushWorkerPlayoffGameMessage,
  type CapRushWorkerRequest,
  type CapRushLockedInputs,
} from '@hoop-rush/data-contracts';

type Job = Extract<CapRushWorkerRequest, { type: 'cap-rush-simulate' | 'cap-rush-playoffs' }>;

export class CapRushParallelWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  private workers: Worker[] = [];
  private job: Job | null = null;
  private delivered = 0;
  private cursor = 0;
  private next = 0;
  private done = 0;
  private generation = 0;
  private readonly games = new Map<number, CapRushWorkerGameMessage>();
  private readonly league = new Map<number, Map<number, CapRushLeagueGame[]>>();
  private readonly playoffs = new Map<string, CapRushWorkerPlayoffGameMessage>();
  /**
   * The wrapper forwards one validated lock per lane worker. Later jobs only
   * carry `runId`; a lane recreated after a cancel/error is hydrated again from
   * the cached copy instead of asking the main thread to clone another 1 MB.
   */
  private locked: CapRushLockedInputs | null = null;
  private readonly hydratedLanes = new Set<number>();
  private singleRequestId: string | null = null;

  constructor(private readonly createWorker: () => Worker) {}

  postMessage(value: unknown): void {
    const request = capRushWorkerRequestSchema.parse(value);
    if (request.type === 'cap-rush-cancel') {
      if (request.requestId === this.job?.requestId) {
        this.finish(true);
        this.stopWorkers();
      } else if (request.requestId === this.singleRequestId) {
        this.workers[0]?.postMessage(request);
      }
      return;
    }
    const runId = request.runId ?? request.locked?.runId;
    if (request.locked !== undefined) {
      if (request.locked.runId !== this.locked?.runId) this.hydratedLanes.clear();
      this.locked = request.locked;
    }
    const locked = this.locked?.runId === runId ? this.locked : null;
    this.games.clear();
    this.league.clear();
    this.playoffs.clear();
    this.delivered = 0;
    this.done = 0;
    this.singleRequestId = null;
    const parallelSeason =
      request.type === 'cap-rush-simulate' &&
      locked?.leagueSchedule !== undefined &&
      request.includeTape !== true &&
      request.backfillLeagueFrom === undefined &&
      request.backfillLeagueTo === undefined;
    const series =
      request.type === 'cap-rush-playoffs'
        ? [...new Set(request.games.map((game) => game.seriesId))]
        : [];
    const parallelPlayoffs = request.type === 'cap-rush-playoffs' && series.length > 1;
    if (!parallelSeason && !parallelPlayoffs) {
      this.job = null;
      this.singleRequestId = request.requestId;
      this.start([request], (message) => {
        if (
          message.type === 'cap-rush-complete' ||
          message.type === 'cap-rush-playoffs-complete' ||
          message.type === 'cap-rush-error'
        ) {
          this.singleRequestId = null;
        }
        this.emit(message);
      });
      return;
    }
    if (request.type === 'cap-rush-simulate') {
      this.job = request;
      this.next = request.startGame;
      this.cursor = request.startGame - 1;
      this.start(
        [
          { ...request, partition: 0 },
          { ...request, partition: 1, leagueOnly: true },
        ],
        (message, lane) => {
          this.accept(message, lane);
        },
      );
    } else {
      this.job = request;
      this.next = 0;
      this.start(
        [0, 1].map((lane) => ({
          ...request,
          games: request.games.filter((game) => series.indexOf(game.seriesId) % 2 === lane),
        })),
        (message, lane) => {
          this.accept(message, lane);
        },
      );
    }
  }

  private start(
    requests: Job[],
    accept: (message: CapRushWorkerMessage, lane: number) => void,
  ): void {
    const generation = ++this.generation;
    requests.forEach((request, lane) => {
      let worker = this.workers[lane];
      if (worker === undefined) {
        worker = this.createWorker();
        this.workers[lane] = worker;
        this.hydratedLanes.delete(lane);
      }
      worker.onmessage = (event: MessageEvent<unknown>) => {
        if (generation !== this.generation) return;
        const parsed = capRushWorkerMessageSchema.safeParse(event.data);
        if (!parsed.success) {
          this.emit({
            schemaVersion: CAP_RUSH_WORKER_WIRE_SCHEMA_VERSION,
            type: 'cap-rush-error',
            requestId: request.requestId,
            code: 'internal',
            message: 'cap rush worker sent an unrecognised message',
            gameNumber: null,
          });
          this.stopWorkers();
        } else if (parsed.data.requestId === request.requestId) {
          accept(parsed.data, lane);
        }
      };
      worker.onerror = (event) => {
        if (generation !== this.generation) return;
        this.onerror?.(event);
        this.stopWorkers();
      };
      worker.postMessage(this.laneRequest(request, lane));
    });
  }

  private laneRequest(request: Job, lane: number): Job {
    const { locked: supplied, ...reference } = request;
    const runId = reference.runId ?? supplied?.runId;
    if (runId === undefined || this.locked?.runId !== runId) return request;
    if (!this.hydratedLanes.has(lane)) {
      this.hydratedLanes.add(lane);
      return { ...reference, runId, locked: this.locked };
    }
    return { ...reference, runId };
  }

  private accept(message: CapRushWorkerMessage, lane: number): void {
    const job = this.job;
    if (job === null) return;
    if (message.type === 'cap-rush-error') {
      this.emit(message);
      this.stopWorkers();
      return;
    }
    if (message.type === 'cap-rush-game') {
      this.games.set(message.cursor, message);
      if (message.leagueGames !== undefined)
        this.addLeague(message.cursor, lane, message.leagueGames);
    } else if (message.type === 'cap-rush-league-games') {
      this.addLeague(message.slot, lane, message.leagueGames);
    } else if (message.type === 'cap-rush-playoff-game') {
      this.playoffs.set(
        `${message.game.summary.seriesId}:${String(message.game.summary.gameOrdinal)}`,
        message,
      );
    } else if (
      message.type === 'cap-rush-complete' ||
      message.type === 'cap-rush-playoffs-complete'
    ) {
      this.done += 1;
      if (message.cancelled) {
        this.finish(true);
        this.stopWorkers();
        return;
      }
    }
    this.drain();
    if (this.done === 2) {
      const expected =
        job.type === 'cap-rush-playoffs'
          ? job.games.length
          : Math.max(0, Math.min(job.count, 83 - job.startGame));
      if (this.delivered !== expected) {
        this.emit({
          schemaVersion: CAP_RUSH_WORKER_WIRE_SCHEMA_VERSION,
          type: 'cap-rush-error',
          requestId: job.requestId,
          code: 'internal',
          message: 'parallel cap rush job completed with missing games',
          gameNumber: null,
        });
        this.stopWorkers();
      } else this.finish(false);
    }
  }

  private addLeague(slot: number, lane: number, games: CapRushLeagueGame[]): void {
    const parts = this.league.get(slot) ?? new Map<number, CapRushLeagueGame[]>();
    parts.set(lane, games);
    this.league.set(slot, parts);
  }

  private drain(): void {
    const job = this.job;
    if (job === null) return;
    if (job.type === 'cap-rush-playoffs') {
      for (;;) {
        const plan = job.games[this.next];
        if (plan === undefined) break;
        const key = `${plan.seriesId}:${String(plan.gameOrdinal)}`;
        const message = this.playoffs.get(key);
        if (message === undefined) break;
        this.playoffs.delete(key);
        this.next += 1;
        this.delivered += 1;
        this.emit(message);
      }
      return;
    }
    for (;;) {
      const parts = this.league.get(this.next);
      const first = parts?.get(0);
      const second = parts?.get(1);
      const game = this.games.get(this.next);
      if (first === undefined || second === undefined || (!job.leagueOnly && game === undefined))
        break;
      const leagueGames = [...first, ...second];
      this.league.delete(this.next);
      this.games.delete(this.next);
      this.cursor = this.next;
      this.next += 1;
      this.delivered += 1;
      if (game !== undefined && !job.leagueOnly) this.emit({ ...game, leagueGames });
      else
        this.emit({
          schemaVersion: CAP_RUSH_WORKER_WIRE_SCHEMA_VERSION,
          type: 'cap-rush-league-games',
          requestId: job.requestId,
          slot: this.cursor,
          leagueGames,
        });
      this.emit({
        schemaVersion: CAP_RUSH_WORKER_WIRE_SCHEMA_VERSION,
        type: 'cap-rush-progress',
        requestId: job.requestId,
        gamesCompleted: this.delivered,
        gamesTotal: job.count,
      });
    }
  }

  private finish(cancelled: boolean): void {
    const job = this.job;
    if (job === null) return;
    this.job = null;
    this.games.clear();
    this.league.clear();
    this.playoffs.clear();
    const base = {
      schemaVersion: CAP_RUSH_WORKER_WIRE_SCHEMA_VERSION,
      requestId: job.requestId,
      gamesDelivered: this.delivered,
      cancelled,
    } as const;
    if (job.type === 'cap-rush-simulate')
      this.emit({ ...base, type: 'cap-rush-complete', lastCursor: this.cursor });
    else this.emit({ ...base, type: 'cap-rush-playoffs-complete' });
  }

  private emit(message: CapRushWorkerMessage): void {
    this.onmessage?.({ data: message } as MessageEvent<unknown>);
  }

  private stopWorkers(): void {
    this.generation += 1;
    for (const worker of this.workers) worker.terminate();
    this.workers = [];
    this.hydratedLanes.clear();
    this.singleRequestId = null;
  }

  terminate(): void {
    this.job = null;
    this.stopWorkers();
    this.locked = null;
    this.games.clear();
    this.league.clear();
    this.playoffs.clear();
  }
}
