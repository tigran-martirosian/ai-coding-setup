// A fake Nimbalyst door for the phone app's PC program tests: a local HTTP server that answers MCP
// `initialize`, `tools/list` and `tools/call`, records every tool call, and writes the endpoint file the PC
// program reads. `handle(name, args, call)` answers a tool call: a string or object is the answer's text (an
// object as JSON); throwing { rpc: "message" } answers a JSON-RPC error with that message.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

export async function startFakeDoor({
  endpointFile,
  workspaces,
  tools,
  handle,
}) {
  const token = `fake-token-${process.pid}-${Date.now()}`;
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", async () => {
      const send = (status, obj) => {
        res.writeHead(status, {
          "Content-Type": "application/json",
          "mcp-session-id": "fake",
        });
        res.end(obj === undefined ? "" : JSON.stringify(obj));
      };
      if (req.headers.authorization !== `Bearer ${token}`)
        return send(401, { error: "no token" });
      const url = new URL(req.url, "http://127.0.0.1");
      const msg = JSON.parse(body);
      if (msg.method === "notifications/initialized") return send(202);
      if (msg.method === "initialize")
        return send(200, {
          jsonrpc: "2.0",
          id: msg.id,
          result: { protocolVersion: "2024-11-05", capabilities: {} },
        });
      if (msg.method === "tools/list")
        return send(200, {
          jsonrpc: "2.0",
          id: msg.id,
          result: { tools: tools.map((name) => ({ name })) },
        });
      if (msg.method !== "tools/call")
        return send(200, {
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32601, message: "unknown method" },
        });
      const call = {
        name: msg.params.name,
        args: msg.params.arguments,
        workspacePath: url.searchParams.get("workspacePath"),
        caller: url.searchParams.get("sessionId"),
      };
      calls.push(call);
      try {
        const out = await handle(call.name, call.args, call);
        const text = typeof out === "string" ? out : JSON.stringify(out);
        send(200, {
          jsonrpc: "2.0",
          id: msg.id,
          result: { content: [{ type: "text", text }], isError: false },
        });
      } catch (e) {
        if (!e.rpc) throw e;
        send(200, {
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32603, message: e.rpc },
        });
      }
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  fs.mkdirSync(path.dirname(endpointFile), { recursive: true });
  fs.writeFileSync(
    endpointFile,
    JSON.stringify({ port, token, pid: process.pid, workspaces }),
  );
  return {
    calls,
    port,
    close: () => new Promise((r) => server.close(r)),
  };
}
