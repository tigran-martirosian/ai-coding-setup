// The weights that turn tokens into one number. Three tables, because they answer three questions:
// PRICE (list price, for usage-scan and so the plan fit), FAMILY (a rough share between model families,
// for review-scan) and CODEX_WEIGHT (Codex tokens, fitted apart from Claude's in usage-dashboard).
// Changing a table changes that scanner's numbers; the three need not agree with each other.

// What one API message would cost at Anthropic's list prices (dollars per million tokens: input, output,
// cache read; cache writes cost 1.25x input, 2x for the 1-hour cache). First matching model name wins.
// A plan is not billed this way: usage-scan uses it as the plan weight of a message.
export const PRICE = [[/opus-5-5/, 4, 20, 0.2], [/opus/, 5, 25, 0.5], [/fable-5-1|mythos-5-1/, 10, 50, 0.25], [/fable|mythos/, 10, 50, 1],
  [/sonnet-4/, 3, 15, 0.3], [/sonnet/, 2, 10, 0.2], [/haiku/, 1, 5, 0.1]];
// A model that is not in PRICE is priced like Sonnet (usage-scan names it on stderr)
export const PRICE_UNLISTED = [null, 2, 10, 0.2];

// Opus : Sonnet : Haiku = 5 : 3 : 1, and Fable at 2.5 times Opus: review-scan compares shares within one review only
export const FAMILY = [[/fable|mythos/, 12.5, "Fable"], [/opus/, 5, "Opus"], [/sonnet/, 3, "Sonnet"], [/haiku/, 1, "Haiku"]];
export const FAMILY_UNLISTED = 3;

// Codex plan weight by price ratios, relative to one uncached input token: cached input 0.1x, output 8x
export const CODEX_WEIGHT = { cachedInput: 0.1, output: 8 };
