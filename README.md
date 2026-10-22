# mcp-session-reaper
### Lightweight Session Lifecycle Manager & Socket Reaper for Model Context Protocol (MCP) Streamable HTTP Servers

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![MCP Spec: 2025-11-25+](https://img.shields.io/badge/MCP%20Spec-2025--11--25%2B-green.svg)](https://modelcontextprotocol.io/)

When hosting a **Model Context Protocol (MCP)** server over **Streamable HTTP** (`@modelcontextprotocol/sdk/server/streamableHttp.js`) in Node.js or Express, managing SSE connections and HTTP session longevity is challenging. Network drops, browser refreshes, and ungraceful client terminations often result in abandoned session objects and memory leaks.

`mcp-session-reaper` is an open-source, zero-dependency middleware and registry that monitors socket lifecycles, tracks active responses, and automatically reaps stale MCP transport sessions.

---

## Features

- 🧹 **Automatic Idle Session Reaping:** Background timer evicts inactive sessions exceeding configurable inactivity thresholds.
- 🔌 **Socket-Aware Tracking:** Hooks into Node.js HTTP response `close` events to track active SSE streams accurately.
- ⚡ **Zero External Dependencies:** Built with pure Node.js primitives.
- 🛡️ **Graceful Teardown:** Calls the SDK's `transport.close()` hook before garbage collection to release OS descriptors.
- 🧩 **Drop-in Express Middleware:** Easily plugs into standard Express or native `http` server routes.

---

## Installation

```bash
npm install mcp-session-reaper
```

---

## Quick Start (with `@modelcontextprotocol/sdk`)

```javascript
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { McpSessionRegistry, mcpSessionTracker } from 'mcp-session-reaper';

const app = express();
app.use(express.json());

// 1. Initialize session registry with a 15-minute idle cutoff
const registry = new McpSessionRegistry({
  idleTimeoutMs: 15 * 60 * 1000,
  reapIntervalMs: 60 * 1000,
  onSessionEvicted: (sessionId) => {
    console.log(`[MCP Reaper] Evicted stale session: ${sessionId}`);
  }
});

// 2. Attach middleware to track response sockets
app.use('/mcp', mcpSessionTracker(registry));

// 3. Mount MCP Streamable HTTP endpoint
app.post('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];

  if (sessionId && registry.get(sessionId)) {
    const { transport } = registry.get(sessionId);
    await transport.handleRequest(req, res, req.body);
    return;
  }

  if (isInitializeRequest(req.body)) {
    const server = new McpServer({ name: 'my-mcp-server', version: '1.0.0' });

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (sid) => {
        // Register in session reaper
        registry.register(sid, transport, server);
      }
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    return;
  }

  res.status(404).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Session expired' }, id: null });
});

app.listen(3001, () => console.log('MCP Server listening on port 3001'));
```

---

## Configuration Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `idleTimeoutMs` | `number` | `1800000` (30 min) | Duration of socket inactivity before session is marked for eviction. |
| `reapIntervalMs` | `number` | `60000` (1 min) | How often the background scavenger loop executes. |
| `onSessionEvicted` | `function` | `null` | Optional hook called when a stale session is reaped. |

---

## Running Tests

```bash
node test.js
```

---

## License

[MIT](LICENSE) © 2026 Shanmukheswar
