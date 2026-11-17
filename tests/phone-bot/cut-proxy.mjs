// A TCP proxy in front of the local relay that a test can break (steady design, section 3): cut() closes both ends
// of every link and refuses new ones; hold() stops passing bytes and closes nothing, a half-open link as after a
// network switch; heal() passes again (bytes held meanwhile go on, as TCP would resend them).
//   const proxy = await startCutProxy({ port: relayPort }); new WebSocket(`${proxy.url.replace("http", "ws")}/ws`)
import net from "node:net";

// opts.port: the relay's port on 127.0.0.1. Returns { url, port, cut(), hold(), heal(), close() }.
export async function startCutProxy(opts) {
  if (!Number.isSafeInteger(opts.port) || opts.port <= 0)
    throw new Error(`cut proxy: needs the relay's port, got ${opts.port}`);
  let mode = "pass"; // "pass" | "hold" | "cut"
  const links = new Set();

  // One direction of a link: bytes go on in "pass", wait in "hold"; an end waits too, since a half-open link
  // tells neither side.
  function pipe(from, to, link) {
    const held = [];
    let ended = false;
    from.on("data", (chunk) => {
      if (mode === "pass") to.write(chunk);
      else held.push(chunk);
    });
    from.on("end", () => {
      ended = true;
      if (mode === "pass") to.end();
    });
    from.on("error", () => link.drop());
    from.on("close", () => {
      if (mode === "pass") link.drop();
    });
    return () => {
      for (const chunk of held.splice(0)) to.write(chunk);
      if (ended) to.end();
      if (from.destroyed) link.drop();
    };
  }

  const server = net.createServer((client) => {
    if (mode === "cut") return client.destroy();
    const relay = net.connect(opts.port, "127.0.0.1");
    const link = {
      drop: () => {
        client.destroy();
        relay.destroy();
        links.delete(link);
      },
    };
    link.flush = [pipe(client, relay, link), pipe(relay, client, link)];
    links.add(link);
  });

  await new Promise((done, failed) => {
    server.once("error", failed);
    server.listen(0, "127.0.0.1", done);
  });
  const port = server.address().port;

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    cut() {
      mode = "cut";
      for (const link of [...links]) link.drop();
    },
    hold() {
      mode = "hold";
    },
    heal() {
      mode = "pass";
      for (const link of [...links]) for (const flush of link.flush) flush();
    },
    async close() {
      mode = "cut";
      for (const link of [...links]) link.drop();
      await new Promise((done) => server.close(done));
    },
  };
}
