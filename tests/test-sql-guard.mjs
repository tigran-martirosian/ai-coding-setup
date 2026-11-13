// Tests for hooks/sql-guard.mjs. Run: node test-sql-guard.mjs
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const hook = fileURLToPath(new URL("../hooks/sql-guard.mjs", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "sqlguard-"));
writeFileSync(join(dir, "wipe.sql"), "-- nightly\nTRUNCATE TABLE sales;\n");
writeFileSync(
  join(dir, "load.sql"),
  "INSERT INTO sales SELECT * FROM staging;\nDELETE FROM staging WHERE day = today();\n",
);
const run = (ev, env = {}) =>
  spawnSync(process.execPath, [hook], {
    input: JSON.stringify({ session_id: "t", cwd: dir, ...ev }),
    env: { ...process.env, ...env },
    encoding: "utf8",
  }).stdout;
const bash = (command) => ({ tool_name: "Bash", tool_input: { command } });
const cases = [
  [
    "DROP TABLE via clickhouse-client: ask",
    bash(`clickhouse-client --query "DROP TABLE db.sales"`),
    true,
  ],
  ["TRUNCATE via psql: ask", bash(`psql -c "TRUNCATE sales"`), true],
  ["DELETE without WHERE: ask", bash(`psql -c "DELETE FROM sales"`), true],
  [
    "DELETE with WHERE: allow",
    bash(`psql -c "DELETE FROM sales WHERE id = 5"`),
    false,
  ],
  [
    "UPDATE without WHERE: ask",
    bash(`mysql -e "UPDATE sales SET x = 0"`),
    true,
  ],
  [
    "UPDATE with WHERE: allow",
    bash(`mysql -e "UPDATE sales SET x = 0 WHERE id = 1"`),
    false,
  ],
  [
    "ALTER TABLE DROP PARTITION: ask",
    bash(`clickhouse client -q "ALTER TABLE t DROP PARTITION 202609"`),
    true,
  ],
  [
    "SELECT: allow",
    bash(`clickhouse-client --query "SELECT count() FROM sales"`),
    false,
  ],
  [
    "TRUNCATE inside a .sql file: ask",
    bash(`clickhouse-client --queries-file wipe.sql`),
    true,
  ],
  ["safe .sql file: allow", bash(`psql -f load.sql`), false],
  [
    "grep for DROP TABLE (no client): allow",
    bash(`grep -rn "DROP TABLE" migrations/`),
    false,
  ],
  [
    "PowerShell DROP: ask",
    {
      tool_name: "PowerShell",
      tool_input: { command: `sqlcmd -Q "DROP DATABASE test"` },
    },
    true,
  ],
  [
    "Read tool: allow",
    { tool_name: "Read", tool_input: { file_path: "x.sql" } },
    false,
  ],
  [
    "commented-out DROP: allow",
    bash(`psql -c "-- DROP TABLE x\nSELECT 1"`),
    false,
  ],
];
let fail = 0;
for (const [name, ev, want] of cases) {
  const out = run(ev);
  const ok = out.includes('"ask"') === want;
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
}
const bad = spawnSync(process.execPath, [hook], {
  input: "not json",
  encoding: "utf8",
}).stdout;
console.log(`${bad === "" ? "ok  " : "FAIL"} bad input: allow`);
if (bad !== "") fail++;
const off = run(bash(`psql -c "DROP TABLE x"`), { SQL_GUARD: "off" });
console.log(`${off === "" ? "ok  " : "FAIL"} SQL_GUARD=off: allow`);
if (off !== "") fail++;
console.log(fail ? `${fail} failed` : "all passed");
process.exit(fail ? 1 : 0);
