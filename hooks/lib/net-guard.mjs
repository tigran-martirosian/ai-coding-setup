// net-guard: keeps outgoing connections away from private, local and not-routable addresses. A host given as an
// address is checked as it is (refusal); a host name gets a lookup that fails when any address it resolves to is
// blocked (checkedLookup), and the socket connects to the addresses that lookup gave. So the check runs on the
// very address connected to: a name that answers a public address once and 127.0.0.1 the next time (DNS
// rebinding) is refused at the connect that would reach 127.0.0.1. Refused: an error with code
// ERR_NET_GUARD_REFUSED.
//
// Per request: hooks/download-guard.mjs passes refusal and checkedLookup to each http(s) request it makes and
// follows redirects itself, so every hop is checked; it runs inside the hook dispatcher, whose other hooks keep
// their own connections. Whole process: guardConnections() wraps net.Socket's connect, which every TCP and TLS
// client in Node goes through (fetch, http, https, net), so every redirect hop is checked too;
// workers/read-page.mjs loads it into defuddle's processes through NODE_OPTIONS and net-guard-preload.mjs.
// Pipes and Unix sockets (a `path`) are not network: not checked.
import dns from "node:dns";
import net from "node:net";

// Private, local and not-routable addresses: localhost, loopback, 10/8, 172.16/12, 192.168/16, 100.64/10,
// link-local and the cloud metadata address 169.254.169.254, 0.0.0.0, 192.0.0/24, the benchmarking 198.18/15,
// multicast and reserved; IPv6 loopback, unique-local, link-local, multicast and local-use NAT64 (64:ff9b:1::/48).
// An IPv6 address that carries an IPv4 one (mapped ::ffff:0:0/96, SIIT-translated ::ffff:0:0:0/96, NAT64
// 64:ff9b::/96, 6to4 2002::/16, Teredo 2001::/32) is also checked by that IPv4 address (isBlocked).
export const BLOCKED = new net.BlockList();
for (const [a, n] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
])
  BLOCKED.addSubnet(a, n, "ipv4");
for (const [a, n] of [
  // ::, ::1 and the old IPv4-compatible form. A ::ffff:0:0/96 rule here would match every IPv4 address: mapped
  // addresses go by the IPv4 inside them, below.
  ["::", 96],
  ["64:ff9b:1::", 48],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
])
  BLOCKED.addSubnet(a, n, "ipv6");

// The eight 16-bit groups of an IPv6 address (a dotted IPv4 tail is two groups)
function groups(address) {
  let s = address.toLowerCase().replace(/%.*$/, "");
  const tail = s.match(/^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (tail) {
    const [a, b, c, d] = tail.slice(2).map(Number);
    s = `${tail[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, rest] = s.split("::");
  const h = head ? head.split(":") : [];
  const r = rest ? rest.split(":") : [];
  const fill =
    rest === undefined ? [] : Array(8 - h.length - r.length).fill("0");
  return [...h, ...fill, ...r].map((g) => Number.parseInt(g, 16));
}

const v4 = (hi, lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

// The IPv4 addresses an IPv6 address carries: mapped, SIIT-translated, NAT64, 6to4, Teredo (its server and its client, whose
// address is stored inverted)
function carried(address) {
  const g = groups(address);
  const zero = (from, to) => g.slice(from, to).every((x) => x === 0);
  if (zero(0, 5) && g[5] === 0xffff) return [v4(g[6], g[7])];
  if (zero(0, 4) && g[4] === 0xffff && g[5] === 0) return [v4(g[6], g[7])];
  if (g[0] === 0x64 && g[1] === 0xff9b && zero(2, 6)) return [v4(g[6], g[7])];
  if (g[0] === 0x2002) return [v4(g[1], g[2])];
  if (g[0] === 0x2001 && g[1] === 0)
    return [v4(g[2], g[3]), v4(g[6] ^ 0xffff, g[7] ^ 0xffff)];
  return [];
}

// true for an IP address in BLOCKED, or an IPv6 one carrying an IPv4 address in BLOCKED; a host name is not an
// address and gives false
export function isBlocked(address) {
  const v = net.isIP(address);
  if (v === 4) return BLOCKED.check(address, "ipv4");
  if (v !== 6) return false;
  return (
    BLOCKED.check(address, "ipv6") ||
    carried(address).some((a) => BLOCKED.check(a, "ipv4"))
  );
}

const refused = (host, address) =>
  Object.assign(
    new Error(
      `net-guard refused ${host}: ${address} is a private or local address`,
    ),
    { code: "ERR_NET_GUARD_REFUSED" },
  );

// The error for a host that is a blocked address; null for an allowed address or a host name
export function refusal(host) {
  const h = String(host).replace(/^\[|\]$/g, "");
  return isBlocked(h) ? refused(h, h) : null;
}

// A dns.lookup with the same calling forms that fails when any address the name gives is blocked
export function checkedLookup(inner = (...a) => dns.lookup(...a)) {
  return (host, opts, cb) => {
    if (typeof opts === "function") [cb, opts] = [opts, {}];
    inner(host, opts, (err, address, family) => {
      if (err) return cb(err);
      const list = Array.isArray(address) ? address : [{ address }];
      const bad = list.find((a) => isBlocked(a.address));
      if (bad) return cb(refused(host, bad.address));
      cb(null, address, family);
    });
  };
}

// The options object of one connect call, made safe in place; an error when its address is blocked
function guard(o) {
  if (o.path) return null;
  const host = String(o.host ?? "localhost").replace(/^\[|\]$/g, "");
  if (net.isIP(host)) return refusal(host);
  o.lookup = checkedLookup(o.lookup || undefined);
  return null;
}

let installed = false;

export function guardConnections() {
  if (installed) return;
  installed = true;
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    const first = args[0];
    let err = null;
    if (Array.isArray(first))
      err = guard(first[0]); // net.connect's own [options, callback]
    else if (first !== null && typeof first === "object") {
      args[0] = { ...first };
      err = guard(args[0]);
    } else if (typeof first === "number" || /^\d+$/.test(first)) {
      const host = typeof args[1] === "string" ? args[1] : undefined;
      const o = { port: first, host };
      err = guard(o);
      args = [o, ...args.slice(host === undefined ? 1 : 2)];
    }
    if (err) {
      process.nextTick(() => this.destroy(err));
      return this;
    }
    return connect.apply(this, args);
  };
}
