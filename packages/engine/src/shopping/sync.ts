import { applyCommand } from './commands';
import { type Command, type CommandResult, type ShoppingState, emptyState } from './model';
import type { EngineContext } from './units';

/**
 * Server model (reference implementation of what the DB function does).
 * Every first-seen command is appended to an ordered log with a monotonically increasing seq —
 * including rejected ones, so that replaying the log reproduces identical outcomes everywhere.
 * Duplicate commandIds are NOT appended (idempotent retry).
 */
export interface LogEntry { seq: number; command: Command; result: CommandResult }
export interface Snapshot { cursor: number; state: ShoppingState }
export interface ServerState { state: ShoppingState; log: LogEntry[] }

export const createServer = (initial: ShoppingState = emptyState()): ServerState => ({ state: initial, log: [] });

export function serverSubmit(server: ServerState, cmd: Command, ctx: EngineContext): {
  server: ServerState; result: CommandResult; duplicate: boolean; entry?: LogEntry;
} {
  const { state, result } = applyCommand(server.state, cmd, ctx);
  if (result.duplicate) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { duplicate: _d, ...original } = result;
    return { server, result: original, duplicate: true };
  }
  const entry: LogEntry = { seq: server.log.length + 1, command: cmd, result };
  return { server: { state, log: [...server.log, entry] }, result, duplicate: false, entry };
}

export const serverSnapshot = (server: ServerState): Snapshot => ({ cursor: server.log.length, state: server.state });

export const serverEntriesSince = (server: ServerState, cursor: number): LogEntry[] => server.log.slice(cursor);

/** Rebuild state by replaying entries on top of a snapshot (used by tests and by clients). */
export function replay(snapshot: Snapshot, entries: LogEntry[], ctx: EngineContext): Snapshot {
  let { state, cursor } = snapshot;
  for (const e of entries) {
    if (e.seq <= cursor) continue;
    if (e.seq !== cursor + 1) throw new Error(`log gap: expected seq ${cursor + 1}, got ${e.seq}`);
    state = applyCommand(state, e.command, ctx).state;
    cursor = e.seq;
  }
  return { cursor, state };
}

/**
 * Client model with an offline queue.
 *  - `confirmed` = server state as of `cursor` (built only from snapshot + server log).
 *  - `pending`   = locally issued commands not yet seen in the server log, in issue order.
 *  - optimistic view = pending replayed on top of confirmed (rejections simply no-op locally).
 * Reconnect: send `pending` in order (any number of retries is safe), then ingest the log since
 * `cursor`. If the log has a gap (missed realtime events), set needsResync and fetch a snapshot.
 */
export interface ClientState {
  confirmed: ShoppingState;
  cursor: number;
  pending: Command[];
  /** Server rejections of this client's own commands, for the UI to surface. */
  conflicts: CommandResult[];
  needsResync: boolean;
}

export const createClient = (snapshot: Snapshot): ClientState => ({
  confirmed: snapshot.state, cursor: snapshot.cursor, pending: [], conflicts: [], needsResync: false,
});

export function clientEnqueue(client: ClientState, cmd: Command): ClientState {
  if (client.pending.some((c) => c.commandId === cmd.commandId) || client.confirmed.outcomes[cmd.commandId]) return client;
  return { ...client, pending: [...client.pending, cmd] };
}

export function clientView(client: ClientState, ctx: EngineContext): ShoppingState {
  let s = client.confirmed;
  for (const c of client.pending) s = applyCommand(s, c, ctx).state;
  return s;
}

/** Commands to (re)send, in order. */
export const clientOutbox = (client: ClientState): Command[] => client.pending;

function prune(client: ClientState): ClientState {
  const conflicts = [...client.conflicts];
  const pending = client.pending.filter((c) => {
    const o = client.confirmed.outcomes[c.commandId];
    if (!o) return true;
    if (o.status === 'rejected') conflicts.push(o);
    return false;
  });
  return { ...client, pending, conflicts };
}

/** Ingest server log entries (realtime push or catch-up). Detects gaps. */
export function clientIngest(client: ClientState, entries: LogEntry[], ctx: EngineContext): ClientState {
  let state = client.confirmed;
  let cursor = client.cursor;
  for (const e of [...entries].sort((a, b) => a.seq - b.seq)) {
    if (e.seq <= cursor) continue;
    if (e.seq !== cursor + 1) {
      return prune({ ...client, confirmed: state, cursor, needsResync: true });
    }
    state = applyCommand(state, e.command, ctx).state;
    cursor = e.seq;
  }
  return prune({ ...client, confirmed: state, cursor });
}

/** Reconnect resync: fresh snapshot + log entries after its cursor. Pending commands are kept. */
export function clientResync(client: ClientState, snapshot: Snapshot, since: LogEntry[], ctx: EngineContext): ClientState {
  return clientIngest({ ...client, confirmed: snapshot.state, cursor: snapshot.cursor, needsResync: false }, since, ctx);
}

export const clientTakeConflicts = (client: ClientState): [ClientState, CommandResult[]] =>
  [{ ...client, conflicts: [] }, client.conflicts];
