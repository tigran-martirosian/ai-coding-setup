// What the page keeps on the phone between opens, so a screen can be drawn before the first hello (Home, Projects,
// the last session): one localStorage item per name, `phone.kept<STORE_SUFFIX>:<name>`, holding { data, at }; a
// test copy's build suffix ("-test") keeps its entries apart from the real app's, and a plain build's is empty. An
// entry over 200 KB is not kept; all entries together stay under 2 MB, the oldest dropped first. Sizes are counted in
// characters of the stored text, the unit localStorage's limit is counted in. localStorage can be blocked in a
// webview: nothing is kept then, and the screens wait for the PC as before.
//   keep(name, data) -> true when kept; kept(name) -> { data, at } or null; forgetAll() on Unpair.
import { STORE_SUFFIX } from "../screens.generated.js";

// Read at call time: screens.generated.js may still be loading when this file is first evaluated.
const prefix = () => `phone.kept${STORE_SUFFIX}:`;
export const ENTRY_MAX = 200 * 1024;
export const ALL_MAX = 2 * 1024 * 1024;

// Every kept entry as { key, size, at }; an unreadable one is removed.
function entries() {
  const list = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(prefix())) continue;
    const text = localStorage.getItem(key) ?? "";
    let at = 0;
    try {
      at = JSON.parse(text).at;
    } catch {
      /* unreadable: dropped first */
    }
    list.push({ key, size: text.length, at: Number(at) || 0 });
  }
  return list;
}

export function keep(name, data) {
  const key = prefix() + name;
  const text = JSON.stringify({ data, at: Date.now() });
  if (text.length > ENTRY_MAX) return false;
  try {
    const others = entries()
      .filter((e) => e.key !== key)
      .sort((a, b) => a.at - b.at);
    let total = text.length + others.reduce((n, e) => n + e.size, 0);
    while (total > ALL_MAX && others.length) {
      const oldest = others.shift();
      localStorage.removeItem(oldest.key);
      total -= oldest.size;
    }
    localStorage.setItem(key, text);
    return true;
  } catch {
    return false;
  }
}

export function kept(name) {
  try {
    const text = localStorage.getItem(prefix() + name);
    if (text === null) return null;
    const { data, at } = JSON.parse(text);
    return { data, at };
  } catch {
    return null;
  }
}

export function forgetAll() {
  try {
    for (const { key } of entries()) localStorage.removeItem(key);
  } catch {
    /* storage blocked: nothing was kept */
  }
}
