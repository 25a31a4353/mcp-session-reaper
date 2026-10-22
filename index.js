/**
 * mcp-session-reaper
 * Lightweight session lifecycle manager and socket reaper for Model Context Protocol (MCP) Streamable HTTP servers.
 * 
 * Prevents memory leaks and orphaned connections when clients disconnect during long-lived SSE streams.
 */

export class McpSessionRegistry {
  /**
   * @param {Object} options
   * @param {number} [options.idleTimeoutMs=1800000] Inactivity threshold before session eviction (default 30 min)
   * @param {number} [options.reapIntervalMs=60000] Interval for reap cycle (default 1 min)
   * @param {function} [options.onSessionEvicted] Optional callback when session is evicted
   */
  constructor(options = {}) {
    this.idleTimeoutMs = options.idleTimeoutMs || 30 * 60 * 1000;
    this.reapIntervalMs = options.reapIntervalMs || 60 * 1000;
    this.onSessionEvicted = options.onSessionEvicted || null;
    this.sessions = new Map();

    // Start background reaper timer
    this.reaperTimer = setInterval(() => this.reapStaleSessions(), this.reapIntervalMs);
    if (this.reaperTimer.unref) {
      this.reaperTimer.unref();
    }
  }

  /**
   * Registers a new initialized MCP transport session
   * @param {string} sessionId
   * @param {any} transport StreamableHTTPServerTransport instance
   * @param {any} server McpServer instance
   */
  register(sessionId, transport, server) {
    if (!sessionId) return;
    this.sessions.set(sessionId, {
      transport,
      server,
      openSockets: 0,
      createdAt: Date.now(),
      lastActiveAt: Date.now()
    });
  }

  /**
   * Returns session record
   * @param {string} sessionId
   * @returns {Object|undefined}
   */
  get(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActiveAt = Date.now();
    }
    return session;
  }

  /**
   * Express middleware to attach to incoming responses for open socket tracking
   * @param {string} sessionId
   * @param {import('express').Response} res
   */
  trackResponse(sessionId, res) {
    const session = this.sessions.get(sessionId);
    if (!session || !res || !res.socket || res.destroyed) return;

    session.openSockets++;
    session.lastActiveAt = Date.now();

    res.on('close', () => {
      session.openSockets = Math.max(0, session.openSockets - 1);
      session.lastActiveAt = Date.now();
    });
  }

  /**
   * Evicts a session explicitly
   * @param {string} sessionId
   */
  async closeSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    try {
      if (session.transport && typeof session.transport.close === 'function') {
        await session.transport.close();
      }
    } catch (err) {
      // Ignore close errors during teardown
    } finally {
      this.sessions.delete(sessionId);
      if (this.onSessionEvicted) {
        this.onSessionEvicted(sessionId);
      }
    }
  }

  /**
   * Reaps sessions that exceed idleTimeoutMs with zero open sockets
   */
  async reapStaleSessions() {
    const now = Date.now();
    const cutoff = now - this.idleTimeoutMs;

    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.openSockets === 0 && session.lastActiveAt < cutoff) {
        await this.closeSession(sessionId);
      }
    }
  }

  /**
   * Stops the reaper background timer and clears registry
   */
  destroy() {
    if (this.reaperTimer) {
      clearInterval(this.reaperTimer);
      this.reaperTimer = null;
    }
    this.sessions.clear();
  }

  /**
   * Active session count
   */
  get size() {
    return this.sessions.size;
  }
}

/**
 * Creates Express middleware to automatically track MCP Streamable HTTP session lifecycles
 * @param {McpSessionRegistry} registry
 * @returns {import('express').RequestHandler}
 */
export function mcpSessionTracker(registry) {
  return (req, res, next) => {
    const sessionId = req.headers['mcp-session-id'] || req.query?.sessionId;
    if (sessionId && registry.get(sessionId)) {
      registry.trackResponse(sessionId, res);
    }
    next();
  };
}
