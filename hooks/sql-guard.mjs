// sql-guard: a PreToolUse hook (Bash|PowerShell) that makes the user confirm destructive SQL before
// it runs: DROP (table, database, view...), TRUNCATE, DELETE or UPDATE without WHERE, and ALTER TABLE
// ... DROP/DETACH (partitions, columns). It only looks at commands that call a database client
// (clickhouse, psql, mysql, sqlite3, duckdb, sqlcmd, ...) plus any .sql file the command passes in.
// SQL run from inside a Python or other script is not seen. Fails open. SQL_GUARD=off disables it.
import { readFileSync, existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const CLIENT =
  /\b(clickhouse(-client|-local)?|psql|pgcli|mysql|mariadb|sqlite3|duckdb|sqlcmd|bq|snowsql|trino|usql)\b/i;
const RULES = [
  [
    /\bDROP\s+(TABLE|DATABASE|SCHEMA|VIEW|DICTIONARY|MATERIALIZED\s+VIEW)\b/i,
    "DROP",
  ],
  [/\bTRUNCATE\b/i, "TRUNCATE"],
  [
    /\bALTER\s+TABLE\b[\s\S]*?\b(DROP|DETACH)\s+(PARTITION|PART|COLUMN)\b/i,
    "ALTER TABLE ... DROP/DETACH",
  ],
];

function findings(sql) {
  const hits = [];
  for (const stmt of sql.split(";")) {
    for (const [re, label] of RULES) if (re.test(stmt)) hits.push(label);
    if (/\bDELETE\s+FROM\b/i.test(stmt) && !/\bWHERE\b/i.test(stmt))
      hits.push("DELETE without WHERE");
    if (/\bUPDATE\s+\S+\s+SET\b/i.test(stmt) && !/\bWHERE\b/i.test(stmt))
      hits.push("UPDATE without WHERE");
  }
  return [...new Set(hits)];
}

try {
  if ((process.env.SQL_GUARD || "").toLowerCase() === "off") process.exit(0);
  const event = JSON.parse(readFileSync(0, "utf8"));
  const command = String((event.tool_input || {}).command || "");
  if (
    !["Bash", "PowerShell"].includes(event.tool_name) ||
    !CLIENT.test(command)
  )
    process.exit(0);

  // Also read .sql files the command passes in (-f, --queries-file, < file.sql, ...)
  let sql = command;
  for (const m of command.matchAll(/["']?([^\s"'<>|;]+\.sql)\b["']?/gi)) {
    const file = isAbsolute(m[1])
      ? m[1]
      : join(event.cwd || process.cwd(), m[1]);
    if (existsSync(file)) sql += ";\n" + readFileSync(file, "utf8");
  }
  // Drop SQL comments ("-- text"), but not command-line flags like --query
  const hits = findings(sql.replace(/(^|[\s"'])--(?=\s)[^\n]*/g, "$1"));
  if (!hits.length) process.exit(0);

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: `[sql-guard] This command contains ${hits.join(", ")}. It can delete data for good. Run it only if you meant to, on the right database.`,
      },
    }),
  );
} catch {
  // Fail open
}
process.exit(0);
