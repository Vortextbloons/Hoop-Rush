export interface FakeSupabaseError {
  message: string;
}

export interface FakeSupabaseResponse<T> {
  data: T | null;
  error: FakeSupabaseError | null;
}

export interface RecordedRpcCall {
  name: string;
  args: Record<string, unknown>;
}

export interface RecordedSelectQuery {
  table: string;
  columns: string;
  filters: Array<{ op: 'eq' | 'gt'; column: string; value: unknown }>;
  order: { column: string; ascending: boolean } | null;
  single: boolean;
}

export interface RecordedBroadcastSend {
  topic: string;
  message: unknown;
}

export interface FakePostgresHandler {
  event: string;
  schema: string;
  table: string;
  filter: string;
  callback: () => void;
}

export interface FakeBroadcastHandler {
  event: string;
  callback: (message: { payload: unknown }) => void;
}

export interface FakeRealtimeChannel {
  topic: string;
  options: unknown;
  subscribed: boolean;
  unsubscribed: boolean;
  postgresHandlers: FakePostgresHandler[];
  broadcastHandlers: FakeBroadcastHandler[];
  on(...args: unknown[]): FakeRealtimeChannel;
  subscribe(callback?: (status: string) => void): FakeRealtimeChannel;
  send(message: unknown): Promise<'ok' | 'error'>;
  unsubscribe(): Promise<void>;
  triggerPostgresChange(): void;
  triggerStatus(status: string): void;
  triggerBroadcast(payload: unknown): void;
}

export interface FakeSupabaseHarness {
  createClient(url: string, key: string, options?: unknown): unknown;
  setRows(table: string, rows: Record<string, unknown>[]): void;
  setRpc(name: string, handler: (args: Record<string, unknown>) => unknown): void;
  rpcCalls: RecordedRpcCall[];
  selectQueries: RecordedSelectQuery[];
  channels: FakeRealtimeChannel[];
  removedChannels: string[];
  broadcastSends: RecordedBroadcastSend[];
  authCalls: string[];
  userId: string;
}

function compareValues(left: unknown, right: unknown): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left) < String(right) ? -1 : 1;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

export function createFakeSupabaseHarness(options: { userId?: string } = {}): FakeSupabaseHarness {
  const tables = new Map<string, Record<string, unknown>[]>();
  const rpcHandlers = new Map<string, (args: Record<string, unknown>) => unknown>();
  const channels: FakeRealtimeChannel[] = [];
  const rpcCalls: RecordedRpcCall[] = [];
  const selectQueries: RecordedSelectQuery[] = [];
  const removedChannels: string[] = [];
  const broadcastSends: RecordedBroadcastSend[] = [];
  const authCalls: string[] = [];
  const userId = options.userId ?? 'user-1';

  function resolveRows(query: RecordedSelectQuery): Record<string, unknown>[] {
    let rows = [...(tables.get(query.table) ?? [])];
    for (const filter of query.filters) {
      rows = rows.filter((row) =>
        filter.op === 'eq'
          ? row[filter.column] === filter.value
          : compareValues(row[filter.column], filter.value) > 0,
      );
    }
    if (query.order) {
      const { column, ascending } = query.order;
      rows.sort((a, b) => (ascending ? 1 : -1) * compareValues(a[column], b[column]));
    }
    return rows;
  }

  function queryBuilder(table: string): unknown {
    const query: RecordedSelectQuery = {
      table,
      columns: '*',
      filters: [],
      order: null,
      single: false,
    };
    const resolve = (): FakeSupabaseResponse<unknown> => {
      selectQueries.push(query);
      const rows = resolveRows(query);
      if (query.single) {
        if (rows.length !== 1) {
          return { data: null, error: { message: 'expected exactly one row' } };
        }
        return { data: rows[0], error: null };
      }
      return { data: rows, error: null };
    };
    const builder = {
      select(columns?: string) {
        if (columns !== undefined) query.columns = columns;
        return builder;
      },
      eq(column: string, value: unknown) {
        query.filters.push({ op: 'eq', column, value });
        return builder;
      },
      gt(column: string, value: unknown) {
        query.filters.push({ op: 'gt', column, value });
        return builder;
      },
      order(column: string, opts?: { ascending?: boolean }) {
        query.order = { column, ascending: opts?.ascending ?? true };
        return builder;
      },
      single() {
        query.single = true;
        return Promise.resolve(resolve());
      },
      then(
        onFulfilled?: (value: FakeSupabaseResponse<unknown>) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) {
        return Promise.resolve(resolve()).then(onFulfilled, onRejected);
      },
    };
    return builder;
  }

  function createChannel(topic: string, channelOptions?: unknown): FakeRealtimeChannel {
    let statusHandler: ((status: string) => void) | undefined;
    const channel: FakeRealtimeChannel = {
      topic,
      options: channelOptions ?? null,
      subscribed: false,
      unsubscribed: false,
      postgresHandlers: [],
      broadcastHandlers: [],
      on(...args: unknown[]) {
        const [kind, filter, callback] = args;
        if (kind === 'postgres_changes' && typeof filter === 'object' && filter !== null) {
          const record = filter as Record<string, unknown>;
          channel.postgresHandlers.push({
            event: stringOr(record['event'], ''),
            schema: stringOr(record['schema'], ''),
            table: stringOr(record['table'], ''),
            filter: stringOr(record['filter'], ''),
            callback: typeof callback === 'function' ? (callback as () => void) : () => {},
          });
        }
        if (kind === 'broadcast' && typeof filter === 'object' && filter !== null) {
          const record = filter as Record<string, unknown>;
          channel.broadcastHandlers.push({
            event: stringOr(record['event'], ''),
            callback:
              typeof callback === 'function'
                ? (callback as (message: { payload: unknown }) => void)
                : () => {},
          });
        }
        return channel;
      },
      subscribe(callback?: (status: string) => void) {
        channel.subscribed = true;
        statusHandler = callback;
        if (callback) callback('SUBSCRIBED');
        return channel;
      },
      send(message: unknown) {
        broadcastSends.push({ topic, message });
        return Promise.resolve('ok');
      },
      unsubscribe() {
        channel.unsubscribed = true;
        return Promise.resolve();
      },
      triggerStatus(status) {
        statusHandler?.(status);
      },
      triggerPostgresChange() {
        for (const handler of channel.postgresHandlers) handler.callback();
      },
      triggerBroadcast(payload: unknown) {
        for (const handler of channel.broadcastHandlers) {
          handler.callback({ payload });
        }
      },
    };
    channels.push(channel);
    return channel;
  }

  const client = {
    auth: {
      getSession() {
        authCalls.push('getSession');
        return Promise.resolve({ data: { session: { user: { id: userId } } }, error: null });
      },
      signInAnonymously() {
        authCalls.push('signInAnonymously');
        return Promise.resolve({ data: { user: { id: userId } }, error: null });
      },
      getUser() {
        authCalls.push('getUser');
        return Promise.resolve({ data: { user: { id: userId } }, error: null });
      },
    },
    realtime: {
      setAuth() {
        authCalls.push('setAuth');
        return Promise.resolve();
      },
    },
    from(table: string) {
      return queryBuilder(table);
    },
    rpc(name: string, args: Record<string, unknown> = {}) {
      rpcCalls.push({ name, args });
      const handler = rpcHandlers.get(name);
      if (!handler) {
        return Promise.resolve({ data: null, error: { message: `rpc not stubbed: ${name}` } });
      }
      try {
        return Promise.resolve({ data: handler(args), error: null });
      } catch (error) {
        return Promise.resolve({
          data: null,
          error: { message: error instanceof Error ? error.message : String(error) },
        });
      }
    },
    channel(topic: string, channelOptions?: unknown) {
      return createChannel(topic, channelOptions);
    },
    removeChannel(channel: FakeRealtimeChannel) {
      removedChannels.push(channel.topic);
      return Promise.resolve('ok');
    },
  };

  return {
    createClient: () => client,
    setRows: (table, rows) => {
      tables.set(table, rows);
    },
    setRpc: (name, handler) => {
      rpcHandlers.set(name, handler);
    },
    rpcCalls,
    selectQueries,
    channels,
    removedChannels,
    broadcastSends,
    authCalls,
    userId,
  };
}
