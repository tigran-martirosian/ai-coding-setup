// node test.mjs  (Node 22.6+ with type stripping: 24 runs it as is, 22 needs --experimental-strip-types)
import assert from 'node:assert/strict';
import { classify, parseCheck, checkLine, absolute, sizeLine, projectName, groupSlot, legend, driftedLinks, LINK_TYPES } from './src/map.ts';
import { find, search } from './src/search.ts';
import { layout, radius, random } from './src/layout.ts';
import { checkCommand, read, build } from './src/store.ts';

let passed = 0;
const test = async (name, fn) => {
  try {
    await fn();
    passed++;
  } catch (e) {
    console.error(`FAIL ${name}\n${e.stack}`);
    process.exitCode = 1;
  }
};

const FILE = {
  nodes: [
    { id: 'cart', name: 'Cart', what: 'Holds what the shopper picked.', files: ['src/cart.ts'], notes: ['docs/cart.md'] },
    { id: 'pricing', name: 'Pricing (rules)', what: 'Totals and discounts.', files: ['src/pricing/total.ts'] },
    { id: 'orders', name: 'Orders', what: 'Saves a paid cart.', files: ['src/orders.ts'] },
    { id: 'mail', name: 'Mail', what: 'Sends receipts.', files: [] },
    { id: 'lonely', name: 'Lonely', what: 'Nothing links here.', files: ['x.ts'] },
  ],
  links: [
    { from: 'cart', to: 'pricing', says: 'Asks for the total.', evidence: ['src/cart.ts'] },
    { from: 'orders', to: 'cart', says: 'Reads the cart.', evidence: ['src/orders.ts', 'src/legacy/gone.ts'] },
    { from: 'orders', to: 'mail', says: 'Asks for a receipt.', evidence: ['src/mail/send.ts'] },
    { from: 'orders', to: 'ghost', says: 'dropped: ghost is not a part', evidence: [] },
  ],
};
const loaded = classify(JSON.stringify(FILE));
const { things, links } = loaded.map;

await test('parse: a map', () => {
  assert.equal(loaded.kind, 'map');
  assert.equal(things.length, 5);
  assert.equal(links.length, 3); // the link to an unknown part is left out
  assert.deepEqual(things[3].files, []);
  assert.deepEqual(things[0].notes, ['docs/cart.md']);
  assert.equal(sizeLine(loaded.map), '5 parts · 3 links');
});

await test('state choice: one screen for each file', () => {
  assert.equal(classify(null).kind, 'none');
  assert.deepEqual(classify('{"handledBy":"the Acme tool"}'), { kind: 'elsewhere', by: 'the Acme tool' });
  assert.equal(classify('{nope').kind, 'error');
  assert.match(classify('{nope').message, /not valid JSON/);
  assert.equal(classify('[]').kind, 'error');
  assert.match(classify('{"links":[]}').message, /no "nodes"/);
  assert.match(classify('{"nodes":[{"name":"x"}]}').message, /Part 1 has no id/);
  assert.match(classify('{"nodes":[{"id":"a"},{"id":"a"}]}').message, /share the id "a"/);
  assert.match(classify('{"nodes":[],"links":5}').message, /"links" must be a list/);
  assert.equal(classify('{"nodes":[]}').kind, 'map'); // an empty map is a map
  assert.equal(classify('{"nodes":[{"id":"a"}]}').map.things[0].name, 'a');
});

await test('check output: gone paths and mistakes', () => {
  const out = [
    'GONE src/legacy/gone.ts  (thing orders; link orders -> cart)',
    'GONE C:/Users/you/.claude/x.mjs  (thing cart)',
    'BAD  thing 3: no id',
    'FAIL: 5 things, 3 links, 6 listed paths, 2 gone (33.3%), 1 JSON mistakes',
  ].join('\r\n');
  const c = parseCheck(out);
  assert.deepEqual(c.gone, ['src/legacy/gone.ts', 'C:/Users/you/.claude/x.mjs']);
  assert.deepEqual(c.bad, ['thing 3: no id']);
  assert.deepEqual(checkLine(c), { text: '2 paths gone, 1 mistake in the file', bad: true });
  assert.deepEqual(checkLine(parseCheck('ok: 5 things, 3 links, 6 listed paths, 0 gone (0.0%), 0 JSON mistakes')), { text: 'All paths found', bad: false });
  assert.equal(parseCheck(''), null);
  assert.equal(parseCheck("Error: Cannot find module 'map.mjs'"), null);
  assert.deepEqual(checkLine(null), { text: 'Path check unavailable', bad: false });
});

await test('paths: relative ones join the project, absolute ones stay', () => {
  assert.equal(absolute('C:\\Work\\shop\\', 'src/cart.ts'), 'C:/Work/shop/src/cart.ts');
  assert.equal(absolute('C:/Work/shop', './src/cart.ts'), 'C:/Work/shop/src/cart.ts');
  assert.equal(absolute('C:/Work/shop', 'C:/Users/you/.claude/x.mjs'), 'C:/Users/you/.claude/x.mjs');
  assert.equal(absolute('/home/you/shop', '/etc/x'), '/etc/x');
  assert.equal(projectName('C:\\Work\\shop\\'), 'shop');
});

await test('search: the --near rule', () => {
  assert.deepEqual(find('cart', things, links), ['cart']); // exact id beats "mentions cart"
  assert.deepEqual(find('ORDER', things, links), ['orders']); // a name or id holding the word
  assert.deepEqual(find('discounts', things, links), ['pricing']); // a word of what
  assert.deepEqual(find('pricing/total', things, links), ['pricing']); // a file of the part
  assert.deepEqual(find('send.ts', things, links).sort(), ['mail', 'orders']); // evidence file of a link: both ends
  assert.deepEqual(find('zzz', things, links), []);
  assert.deepEqual(find('rules', things, links), ['pricing']); // the bracket in the name
});

await test('search: matches plus the parts one link away', () => {
  assert.equal(search('   ', things, links), null);
  const f = search('mail', things, links);
  assert.deepEqual(f.matches, ['mail']);
  assert.deepEqual([...f.shown].sort(), ['mail', 'orders']);
  const two = search('mail pricing', things, links);
  assert.deepEqual(two.matches, ['pricing', 'mail']); // in map order
  assert.deepEqual([...two.shown].sort(), ['cart', 'mail', 'orders', 'pricing']);
  assert.deepEqual(search('zzz', things, links).matches, []);
});

const BOX = { width: 1000, height: 700, seed: 7, pad: 22 };
const ids = [];
const edges = [];
for (let i = 0; i < 60; i++) {
  ids.push(`n${i}`);
  if (i > 0) edges.push([`n${i}`, `n${Math.floor(i / 3)}`]);
}
await test('layout: every part stays inside the box', () => {
  for (const set of [ids, ids.slice(0, 15), ids.slice(0, 2), ['solo'], []]) {
    const places = layout(set, edges.filter(([a, b]) => set.includes(a) && set.includes(b)), BOX);
    assert.equal(places.size, set.length);
    for (const p of places.values()) {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
      assert.ok(p.x >= BOX.pad - 1e-6 && p.x <= BOX.width - BOX.pad + 1e-6, `x ${p.x}`);
      assert.ok(p.y >= BOX.pad - 1e-6 && p.y <= BOX.height - BOX.pad + 1e-6, `y ${p.y}`);
    }
  }
});

await test('layout: same seed, same places; other seed, other places', () => {
  const a = [...layout(ids, edges, BOX)];
  assert.deepEqual([...layout(ids, edges, BOX)], a);
  assert.notDeepEqual([...layout(ids, edges, { ...BOX, seed: 8 })], a);
});

await test('layout: parts do not sit on top of each other, linked parts are nearer than unlinked', () => {
  const places = layout(ids, edges, BOX);
  const pts = [...places.values()];
  let least = Infinity;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) least = Math.min(least, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
  assert.ok(least > 8, `closest pair ${least}`);
  const d = (a, b) => Math.hypot(places.get(a).x - places.get(b).x, places.get(a).y - places.get(b).y);
  const linked = edges.reduce((s, [a, b]) => s + d(a, b), 0) / edges.length;
  let all = 0;
  let count = 0;
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++, count++) all += d(ids[i], ids[j]);
  assert.ok(linked < (all / count) * 0.7, `linked ${linked} vs ${all / count}`);
});

await test('layout: radius grows with links and is capped; random is seeded', () => {
  assert.ok(radius(0) < radius(4) && radius(4) < radius(12));
  assert.equal(radius(1000), 16);
  assert.equal(random(3)(), random(3)());
});

// ---- typed links, groups, tokens, drift ----
const NEW = {
  nodes: [
    { id: 'a', name: 'A', group: 'Money', words: ['pric\\w+', 'cost'] },
    { id: 'b', name: 'B', group: 'Money' },
    { id: 'c', name: 'C', group: 'World' },
    { id: 'd', name: 'D' },
  ],
  links: [
    { from: 'a', to: 'b', type: 'feeds', says: 'Passes the price.', evidence: ['x.ts', { file: 'y.ts', token: 'price(' }, { file: 'z.ts' }, 5, { token: 'no file' }] },
    { from: 'b', to: 'c', says: 'No type given.' },
    { from: 'c', to: 'd', type: 'nonsense' },
    { from: 'a', to: 'c', type: 'limits' },
  ],
};

await test('parse: typed and tokened links, group and words', () => {
  const m = classify(JSON.stringify(NEW)).map;
  assert.deepEqual(m.links.map((l) => l.type), ['feeds', 'uses', 'uses', 'limits']); // absent or unknown reads as uses
  assert.deepEqual(m.links.map((l) => l.typed), [true, false, false, true]); // and the card says "to X" for it
  assert.deepEqual(m.links[0].evidence, [{ file: 'x.ts' }, { file: 'y.ts', token: 'price(' }, { file: 'z.ts' }]);
  assert.deepEqual(m.links[1].evidence, []);
  assert.equal(m.things[0].group, 'Money');
  assert.deepEqual(m.things[0].words, ['pric\\w+', 'cost']);
  assert.equal(m.things[3].group, '');
  assert.deepEqual(m.things[3].words, []);
  assert.deepEqual(LINK_TYPES, ['uses', 'feeds', 'spends', 'opens', 'boosts', 'limits']);
});

await test('parse: an old-format map is unchanged', () => {
  assert.ok(links.every((l) => l.type === 'uses'));
  assert.deepEqual(links[1].evidence, [{ file: 'src/orders.ts' }, { file: 'src/legacy/gone.ts' }]);
  assert.ok(things.every((n) => n.group === '' && n.words.length === 0));
  assert.deepEqual(legend(loaded.map), []);
  assert.equal(find('send.ts', things, links).length, 2); // search still reads the evidence files
});

await test('check output: the literal DRIFT line', () => {
  const out = [
    'GONE src/old.ts  (thing a)',
    'DRIFT src/pricing.ts  (link cart -> pricing): no longer has: price(',
    'DRIFT src/pricing.ts  (link cart -> pricing): no longer has: total',
    'DRIFT src/mail.ts  (link orders -> mail): no longer has: send mail',
    'FAIL: 5 things, 3 links, 6 listed paths, 1 gone (16.7%), 3 drifted, 0 JSON mistakes',
  ].join('\n');
  const c = parseCheck(out);
  assert.deepEqual(c.drift, ['src/pricing.ts', 'src/pricing.ts', 'src/mail.ts']);
  assert.deepEqual(c.driftLinks[0], { file: 'src/pricing.ts', from: 'cart', to: 'pricing', token: 'price(' });
  assert.equal(c.driftLinks[2].token, 'send mail');
  assert.equal(driftedLinks(c), 2); // two links, three tokens
  assert.deepEqual(checkLine(c), { text: "1 path gone, 2 links' code changed", bad: true });
  assert.equal(checkLine(parseCheck('FAIL: 1 things, 1 links, 1 listed paths, 0 gone, 1 drifted\nDRIFT a.ts  (link x -> y): no longer has: t')).text, "1 link's code changed");
  assert.deepEqual(parseCheck('ok: 1 things, 0 links, 0 listed paths, 0 gone, 0 drifted').driftLinks, []);
});

await test('legend: only when the map has groups, one row per group by name', () => {
  assert.deepEqual(legend(classify(JSON.stringify(NEW)).map).map((g) => g.name), ['Money', 'World']);
  assert.deepEqual(legend(classify(JSON.stringify({ nodes: [{ id: 'a' }, { id: 'b', group: '' }] })).map), []);
});

await test('group colours: the same name gives the same slot, in range; one map never repeats a colour', () => {
  for (const name of ['Money', 'World', 'a', 'Тест', 'x'.repeat(50)]) {
    const slot = groupSlot(name);
    assert.ok(Number.isInteger(slot) && slot >= 1 && slot <= 8, name);
    assert.equal(groupSlot(name), slot);
  }
  const other = classify(JSON.stringify({ nodes: [{ id: 'q', group: 'World' }, { id: 'r', group: 'Aardvark' }, { id: 's', group: 'Money' }] })).map;
  const slotOf = (m, name) => legend(m).find((g) => g.name === name).slot;
  // a name keeps its slot from map to map unless an earlier name in the same map took it: Aardvark takes World's here
  assert.equal(slotOf(other, 'Money'), slotOf(classify(JSON.stringify(NEW)).map, 'Money'));
  assert.equal(slotOf(other, 'Aardvark'), groupSlot('World'));
  assert.notEqual(slotOf(other, 'World'), slotOf(other, 'Aardvark'));
  assert.ok(new Set(['Money', 'World', 'Combat', 'Items', 'Quests', 'UI'].map(groupSlot)).size >= 4); // names spread over the slots
});

await test('groups whose names share a colour slot still get different colours', () => {
  assert.equal(groupSlot('grow'), groupSlot('resources'));
  const m = classify(JSON.stringify({ nodes: ['base', 'boss', 'fight', 'gear', 'grow', 'resources', 'sell', 'smoke'].map((g, i) => ({ id: 'n' + i, group: g })) })).map;
  assert.equal(new Set(legend(m).map((g) => g.slot)).size, 8);
});

// A graph the size of the biggest real map: 134 parts, 603 links, in 6 groups.
const BIG_IDS = Array.from({ length: 134 }, (_, i) => 'p' + i);
const BIG_GROUPS = BIG_IDS.map((_, i) => 'g' + (i % 6));
const BIG_LINKS = [];
{
  const rnd = random(11);
  while (BIG_LINKS.length < 603) {
    const a = Math.floor(rnd() * 134);
    const b = Math.floor(rnd() * 134);
    if (a !== b) BIG_LINKS.push([BIG_IDS[a], BIG_IDS[b]]);
  }
}
// Like real maps: most links stay inside a group.
const CLUSTERED = BIG_LINKS.map(([a, b], i) => (i % 5 === 0 ? [a, b] : [a, BIG_IDS[(Number(b.slice(1)) - (Number(b.slice(1)) % 6) + (Number(a.slice(1)) % 6)) % 134]]));

await test('layout: 134 parts and 603 links lay out in under a second, and no two touch', () => {
  const radii = BIG_IDS.map(() => 9);
  const began = performance.now();
  const places = layout(BIG_IDS, BIG_LINKS, { ...BOX, groups: BIG_GROUPS, radii });
  const took = performance.now() - began;
  assert.ok(took < 1000, 'took ' + Math.round(took) + ' ms');
  const pts = [...places.values()];
  let least = Infinity;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) least = Math.min(least, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
  assert.ok(least >= 18 - 0.5, 'closest pair ' + least); // radius + radius, edge to edge
  for (const p of pts) assert.ok(p.x >= BOX.pad - 1e-6 && p.x <= BOX.width - BOX.pad + 1e-6 && p.y >= BOX.pad - 1e-6 && p.y <= BOX.height - BOX.pad + 1e-6);
});

await test('layout: group parts sit nearer their own centre than without the pull', () => {
  const spread = (places) => {
    let total = 0;
    for (let g = 0; g < 6; g++) {
      const mine = BIG_IDS.filter((_, i) => i % 6 === g).map((id) => places.get(id));
      const mx = mine.reduce((s, p) => s + p.x, 0) / mine.length;
      const my = mine.reduce((s, p) => s + p.y, 0) / mine.length;
      total += mine.reduce((s, p) => s + Math.hypot(p.x - mx, p.y - my), 0) / mine.length;
    }
    return total / 6;
  };
  const plain = spread(layout(BIG_IDS, CLUSTERED, BOX));
  const pulled = spread(layout(BIG_IDS, CLUSTERED, { ...BOX, groups: BIG_GROUPS }));
  assert.ok(pulled < plain, 'pulled ' + pulled + ' vs plain ' + plain);
  assert.deepEqual([...layout(BIG_IDS, BIG_LINKS, { ...BOX, groups: BIG_GROUPS })], [...layout(BIG_IDS, BIG_LINKS, { ...BOX, groups: BIG_GROUPS })]);
});

await test('store: read picks the screen, the check runs only for a map', async () => {
  const calls = [];
  const exec = async (command) => {
    calls.push(command);
    return { success: true, stdout: 'GONE a.ts  (thing cart)\nFAIL: 1 things, 0 links, 1 listed paths, 1 gone (100.0%), 0 JSON mistakes\n', stderr: '', exitCode: 0 };
  };
  const invokeWith = (result) => async (channel, file) => {
    assert.equal(channel, 'extensions:read-file');
    assert.equal(file, 'C:/Work/shop/.claude/systems-map.json');
    if (result instanceof Error) throw result;
    return result;
  };
  const snap = await read('C:\\Work\\shop', invokeWith(JSON.stringify(FILE)), exec);
  assert.equal(snap.loaded.kind, 'map');
  assert.deepEqual(snap.check.gone, ['a.ts']);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /"C:\/Work\/shop"$/);
  assert.match(checkCommand('C:/x'), /systems-map.*--check/);

  const none = await read('C:\\Work\\shop', invokeWith(new Error("Error invoking remote method 'extensions:read-file': Error: ENOENT: no such file")), exec);
  assert.equal(none.loaded.kind, 'none');
  assert.equal(calls.length, 1);
  await assert.rejects(read('C:\\Work\\shop', invokeWith(new Error('EACCES: permission denied')), exec), /EACCES/);

  const broken = async () => {
    throw new Error('spawn failed');
  };
  assert.equal((await read('C:\\Work\\shop', invokeWith(JSON.stringify(FILE)), broken)).check, null);
  const again = await read('C:\\Work\\shop', invokeWith(JSON.stringify(FILE)), exec);
  assert.equal(again.key, snap.key); // the same file and check: the panel keeps its state
});

await test('store: build sends /systems-map and reports a refusal', async () => {
  let sent;
  assert.equal(await build(async (c, a) => ((sent = [c, a]), {}), 'Build a map', 50), '');
  assert.equal(sent[0], 'extensions:ai-send-prompt');
  assert.equal(sent[1].prompt, '/systems-map');
  assert.equal(await build(async () => Promise.reject(new Error('No project open')), 'Build a map', 50), 'No project open');
  assert.equal(await build(() => new Promise(() => {}), 'Build a map', 20), ''); // a session that runs for minutes counts as started
});

console.log(process.exitCode ? 'FAILED' : `${passed} passed`);
