// The Russian twin patterns of the English regexes (for `--language russian`). \b does not see Cyrillic letters, so
// a twin uses the u flag, and « » stand for "no letter on this side": «слово» is the word with no letter before or
// after it. A hook writes its twins with ru() and ORs them in next to the English ones.
//   const RU_TERM = ru(String.raw`«(?:терминал\p{L}*|консол\p{L}*)»`);   // flags "iu" unless given
// ruHyphen() is the same except that » also refuses a hyphen after the word (no-response-gate: "ли" must not
// match inside "ли-бо").
const OPEN = String.raw`(?<!\p{L})`;
export const ru = (src, flags = "iu") =>
  new RegExp(
    src.replace(/«/g, OPEN).replace(/»/g, String.raw`(?!\p{L})`),
    flags,
  );
export const ruHyphen = (src, flags = "iu") =>
  new RegExp(
    src.replace(/«/g, OPEN).replace(/»/g, String.raw`(?![\p{L}-])`),
    flags,
  );
