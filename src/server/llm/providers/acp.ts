// A minimal Agent Client Protocol (ACP) client: newline-delimited JSON-RPC 2.0 over an agent's stdio.
// https://agentclientprotocol.com/protocol/overview

export const ACP_PROTOCOL_VERSION = 1;
export const ACP_AUTH_REQUIRED = -32000;
const METHOD_NOT_FOUND = -32601;
const AGENT_GONE = -32099;
const MAX_LINE_CHARS = 64 * 1024 * 1024;

export type AcpTransport = { lines: AsyncIterable<string>; send: (line: string) => void; close: () => void };
export type AcpReply = { result: unknown } | { error: { code: number; message: string } };
export type AcpHandlers = {
  notification: (method: string, params: unknown) => void;
  request: (method: string, params: unknown) => AcpReply;
};
export type AcpConnection = {
  request: (method: string, params: unknown) => Promise<unknown>;
  notify: (method: string, params: unknown) => void;
  close: () => void;
};

export class AcpError extends Error {
  constructor(readonly code: number, message: string, readonly data: unknown) {
    super(message);
  }
}

type Pending = { resolve: (value: unknown) => void; reject: (error: AcpError) => void };

// O(1)
function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

// O(1)
function errorOf(raw: unknown): AcpError {
  const rec = recordOf(raw);
  const code = typeof rec?.code === "number" ? rec.code : -32603;
  const message = typeof rec?.message === "string" ? rec.message : "";
  return new AcpError(code, message, rec?.data);
}

// O(n) in the stream
// INV: when the agent's stdout ends, every unanswered request rejects, so no caller waits forever on a dead agent
export function openAcpConnection(transport: AcpTransport, handlers: AcpHandlers): AcpConnection {
  const pending = new Map<number, Pending>();
  let nextId = 0;
  let closed = false;
  const write = (message: Record<string, unknown>): void => {
    if (!closed) transport.send(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  };
  const failAll = (): void => {
    for (const waiter of pending.values()) waiter.reject(new AcpError(AGENT_GONE, "agent exited", undefined));
    pending.clear();
  };
  const dispatch = (line: string): void => {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_LINE_CHARS) return;
    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      return;
    }
    const msg = recordOf(raw);
    if (msg === null) return;
    const id = msg.id;
    const method = typeof msg.method === "string" ? msg.method : null;
    if (method === null) {
      if (typeof id !== "number") return;
      const waiter = pending.get(id);
      if (waiter === undefined) return;
      pending.delete(id);
      if ("error" in msg) waiter.reject(errorOf(msg.error));
      else waiter.resolve(msg.result);
      return;
    }
    if (id === undefined || id === null) {
      handlers.notification(method, msg.params);
      return;
    }
    write({ id, ...handlers.request(method, msg.params) });
  };
  void (async () => {
    try {
      for await (const line of transport.lines) dispatch(line);
    } catch {
      // the agent's stdout broke; treat it as an exit
    } finally {
      closed = true;
      failAll();
    }
  })();
  return {
    request(method, params) {
      if (closed) return Promise.reject(new AcpError(AGENT_GONE, "agent exited", undefined));
      nextId += 1;
      const id = nextId;
      const answer = new Promise<unknown>((resolve, reject) => pending.set(id, { resolve, reject }));
      write({ id, method, params });
      return answer;
    },
    notify(method, params) {
      write({ method, params });
    },
    close() {
      if (closed) return;
      closed = true;
      failAll();
      transport.close();
    },
  };
}

// O(1)
// INV: an agent request this client does not implement is refused, never left unanswered
export function refuseAcpRequest(): AcpReply {
  return { error: { code: METHOD_NOT_FOUND, message: "not supported by this client" } };
}

// O(n) in stdout
async function* readLines(stream: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buf += decoder.decode(chunk.value, { stream: true });
      let nl = buf.indexOf("\n");
      while (nl >= 0) {
        yield buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        nl = buf.indexOf("\n");
      }
    }
    if (buf.trim().length > 0) yield buf;
  } finally {
    reader.releaseLock();
  }
}

// O(1)
// INV: closing stdin is the agent's cue to end its sessions and exit; a still-running agent is killed after a grace period so its own child processes get the same cue first
export function spawnAcpAgent(argv: readonly string[], env: Record<string, string>, cwd: string): AcpTransport {
  const proc = Bun.spawn([...argv], { cwd, env, stdin: "pipe", stdout: "pipe", stderr: "ignore" });
  let closed = false;
  return {
    lines: readLines(proc.stdout),
    send(line) {
      if (closed) return;
      try {
        proc.stdin.write(line);
        void proc.stdin.flush();
      } catch {
        closed = true;
      }
    },
    close() {
      if (closed) return;
      closed = true;
      try {
        void proc.stdin.end();
      } catch {
        // already closed
      }
      const timer = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {
          // already exited
        }
      }, 3000);
      timer.unref();
      void proc.exited.then(() => clearTimeout(timer));
    },
  };
}
