// Command-line options for the setup-audit scripts: `--name value` pairs and the arguments left over.
// All scripts read their options here, so a flag means the same thing in each of them.
export const ARGS = process.argv.slice(2);

// The value after the first `--name`, or `def` when the flag is not there
export const opt = (name, def, argv = ARGS) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? def : argv[i + 1];
};

// The values after every `--name`, in order (a flag given more than once)
export const optAll = (name, argv = ARGS) =>
  argv.flatMap((a, i) =>
    a === `--${name}` && argv[i + 1] !== undefined ? [argv[i + 1]] : [],
  );

// The arguments that are neither a `--name` nor the value of one of `valueFlags` (names without the dashes)
export const positional = (valueFlags = [], argv = ARGS) =>
  argv.filter(
    (a, i) =>
      !a.startsWith("--") && !valueFlags.some((f) => argv[i - 1] === `--${f}`),
  );

// A comma list given with `--name a,b` (once or several times): lower-case, trimmed, empty parts dropped
export const optList = (name, argv = ARGS) =>
  optAll(name, argv)
    .flatMap((s) => s.split(","))
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
