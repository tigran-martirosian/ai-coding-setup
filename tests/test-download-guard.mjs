// Tests for hooks/download-guard.mjs against a HEAD server on 127.0.0.1 started here. Run: node test-download-guard.mjs
process.env.HOOK_ERRORS_LOG = "off"; // junk input must not leave lines in the hooks' crash log

import { spawn } from "node:child_process";
import http from "node:http";
import { fileURLToPath } from "node:url";

const hook = fileURLToPath(
  new URL("../hooks/download-guard.mjs", import.meta.url),
);
const worker = fileURLToPath(
  new URL("../workers/download.mjs", import.meta.url),
).replace(/\\/g, "/");

// HEAD only: /big.bin 60 MB, /small.bin 1 KB, /unknown.bin no Content-Length
const server = http.createServer((req, res) => {
  const name = req.url.split("?")[0];
  if (name === "/big.bin")
    res.writeHead(200, { "Content-Length": 60e6, "Accept-Ranges": "bytes" });
  else if (name === "/small.bin")
    res.writeHead(200, { "Content-Length": 1000 });
  else if (name === "/unknown.bin")
    res.writeHead(200, { "Transfer-Encoding": "chunked" });
  else res.writeHead(404);
  res.end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

// spawn, not spawnSync: the server in this process has to answer the hook's HEAD request
const run = (input, env = {}) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [hook], {
      env: { ...process.env, DOWNLOAD_GUARD: "", COMMAND_EXPLAIN: "", ...env },
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("close", () => resolve(out));
    child.stdin.end(
      typeof input === "string"
        ? input
        : JSON.stringify({ session_id: "t", cwd: ".", ...input }),
    );
  });
const NOTE = "\n\n# WHAT THIS DOES: fetches the model file";
const bash = (command) => ({
  tool_name: "Bash",
  tool_input: { command, description: "d" },
});
const ps = (command) => ({ tool_name: "PowerShell", tool_input: { command } });
const newCommand = (out) => {
  try {
    return JSON.parse(out).hookSpecificOutput.updatedInput.command;
  } catch {
    return null;
  }
};

const N = `node "${worker}"`;
const cases = [
  [
    "big curl -L -o: rewritten, the cd and the note line kept",
    bash(`cd /tmp && curl -L -o model.bin ${base}/big.bin${NOTE}`),
    `cd /tmp && ${N} ${base}/big.bin model.bin${NOTE}`,
  ],
  [
    "big curl -sSLo with quotes: rewritten",
    bash(`curl -sSLo "my model.bin" '${base}/big.bin?download=true'${NOTE}`),
    `${N} '${base}/big.bin?download=true' "my model.bin"${NOTE}`,
  ],
  [
    "big curl with the file glued to -o: rewritten, the name quoted",
    bash(`curl -Loout.bin ${base}/big.bin${NOTE}`),
    `${N} ${base}/big.bin 'out.bin'${NOTE}`,
  ],
  [
    "big curl -O: rewritten to the URL's file name",
    bash(`curl -LO ${base}/big.bin${NOTE}`),
    `${N} ${base}/big.bin 'big.bin'${NOTE}`,
  ],
  [
    "big wget: rewritten",
    bash(`wget -q ${base}/big.bin${NOTE}`),
    `${N} ${base}/big.bin 'big.bin'${NOTE}`,
  ],
  [
    "big wget -O: rewritten",
    bash(`wget -O out.bin ${base}/big.bin${NOTE}`),
    `${N} ${base}/big.bin out.bin${NOTE}`,
  ],
  [
    "big Invoke-WebRequest -OutFile: rewritten",
    ps(
      `Invoke-WebRequest -Uri ${base}/big.bin -OutFile C:\\m\\x.bin -UseBasicParsing${NOTE}`,
    ),
    `${N} ${base}/big.bin C:\\m\\x.bin${NOTE}`,
  ],
  // command-explain answers the same call in parallel and only one updatedInput is used: the rewrite carries its stand-in
  [
    "big curl without the note line: rewritten, with command-explain's stand-in line",
    bash(`curl -L -o model.bin ${base}/big.bin`),
    `${N} ${base}/big.bin model.bin\n\n# WHAT THIS DOES: (no note given) ${`curl -L -o model.bin ${base}/big.bin`.slice(0, 60)}`,
  ],
  ["small curl: left alone", bash(`curl -L -o s.bin ${base}/small.bin`), null],
  [
    "unknown size: left alone",
    bash(`curl -L -o u.bin ${base}/unknown.bin`),
    null,
  ],
  [
    "big curl, an apostrophe in the glued name: Bash quoting",
    bash(`curl -Lo"it's.bin" ${base}/big.bin${NOTE}`),
    `${N} ${base}/big.bin 'it'\\''s.bin'${NOTE}`,
  ],
  [
    "big curl.exe, an apostrophe in the glued name: PowerShell quoting",
    ps(`curl.exe -Lo"it's.bin" ${base}/big.bin${NOTE}`),
    `${N} ${base}/big.bin 'it''s.bin'${NOTE}`,
  ],
  [
    "big curl -o /dev/null: left alone",
    bash(`curl -L -o /dev/null ${base}/big.bin`),
    null,
  ],
  [
    "big wget -O /dev/null: left alone",
    bash(`wget -O /dev/null ${base}/big.bin`),
    null,
  ],
  [
    "big curl.exe -o NUL: left alone",
    ps(`curl.exe -L -o NUL ${base}/big.bin`),
    null,
  ],
  [
    "big Invoke-WebRequest -OutFile nul: left alone",
    ps(`Invoke-WebRequest -Uri ${base}/big.bin -OutFile nul`),
    null,
  ],
  [
    "big Invoke-WebRequest piped to Out-Null: left alone",
    ps(`Invoke-WebRequest -Uri ${base}/big.bin -OutFile x.bin | Out-Null`),
    null,
  ],
  [
    "no server: left alone",
    bash(`curl -L -o u.bin http://127.0.0.1:1/big.bin`),
    null,
  ],
  [
    "curl with a header: left alone",
    bash(`curl -H "Authorization: Bearer x" -o m.bin ${base}/big.bin`),
    null,
  ],
  [
    "curl to stdout piped: left alone",
    bash(`curl -L ${base}/big.bin | tar x`),
    null,
  ],
  [
    "a variable in the command: left alone",
    bash(`curl -o $OUT ${base}/big.bin`),
    null,
  ],
  [
    "not a shell tool: left alone",
    { tool_name: "Read", tool_input: { file_path: "x" } },
    null,
  ],
];

let fail = 0;
const check = (name, pass, detail) => {
  if (!pass) fail++;
  console.log(
    `${pass ? "ok  " : "FAIL"} ${name}${pass ? "" : `\n  got: ${detail}`}`,
  );
};
const outs = await Promise.all(cases.map(([, input]) => run(input)));
cases.forEach(([name, input, want], i) => {
  const got = newCommand(outs[i]);
  const keeps =
    want === null ||
    JSON.parse(outs[i]).hookSpecificOutput.updatedInput.description ===
      input.tool_input.description;
  check(
    name,
    (want === null ? outs[i] === "" : got === want) && keeps,
    outs[i] || "(nothing)",
  );
});
const ctx = JSON.parse(outs[0]).hookSpecificOutput;
check(
  "the rewrite says why and asks for no permission itself",
  !("permissionDecision" in ctx) && ctx.additionalContext.includes("(60 MB)"),
  JSON.stringify(ctx),
);
const explain = await new Promise((resolve) => {
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("../hooks/command-explain.mjs", import.meta.url))],
    { env: { ...process.env, COMMAND_EXPLAIN: "" } },
  );
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.on("close", () => resolve(out));
  child.stdin.end(
    JSON.stringify({
      session_id: "t",
      cwd: ".",
      ...bash(`curl -L -o model.bin ${base}/big.bin`),
    }),
  );
});
const lastLine = (c) => c?.split("\n").pop();
check(
  "the stand-in line is the one command-explain itself adds",
  lastLine(newCommand(explain)) === lastLine(newCommand(outs[7])),
  `${lastLine(newCommand(explain))} | ${lastLine(newCommand(outs[7]))}`,
);
const noExplain = newCommand(
  await run(bash(`curl -L -o model.bin ${base}/big.bin`), {
    COMMAND_EXPLAIN: "off",
  }),
);
check(
  "COMMAND_EXPLAIN=off: rewritten without a stand-in",
  noExplain === `${N} ${base}/big.bin model.bin`,
  noExplain,
);
const off = await run(bash(`curl -L -o model.bin ${base}/big.bin`), {
  DOWNLOAD_GUARD: "off",
});
check("DOWNLOAD_GUARD=off: left alone", off === "", off);
const bad = await run("not json");
check("bad input: left alone", bad === "", bad);

server.close();
console.log(fail ? `${fail} failed` : "all passed");
process.exitCode = fail ? 1 : 0;
