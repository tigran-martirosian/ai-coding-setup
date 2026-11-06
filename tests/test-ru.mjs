// Test for hooks/lib/ru.mjs: the « » word edges of the Russian twin patterns.
import { ru, ruHyphen } from "../hooks/lib/ru.mjs";

let failed = 0;
const check = (name, ok) => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}`); };

const word = ru("«терминал»");
check("a whole word matches", word.test("откройте терминал сейчас"));
check("a letter before it does not", !word.test("мультитерминал"));
check("a letter after it does not", !word.test("терминалы"));
check("a prefix class (\p{L}*) takes the endings", ru(String.raw`«терминал\p{L}*»`).test("в терминале"));
check("case does not matter by default", word.test("ТЕРМИНАЛ"));
check("a digit or punctuation is an edge", word.test("(терминал)") && word.test("1терминал2"));
check("the flags can be replaced", !ru("«терминал»", "u").test("ТЕРМИНАЛ"));
check("the regex has the u flag", word.unicode && word.ignoreCase);
check("English text is left to the other regexes", !word.test("open a terminal"));
check("a hyphen is an edge for ru()", ru("«ли»").test("ли-бо"));
check("a hyphen is not an edge for ruHyphen()", !ruHyphen("«ли»").test("ли-бо") && ruHyphen("«ли»").test("ли бо"));

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
