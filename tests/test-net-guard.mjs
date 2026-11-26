// Tests for hooks/lib/net-guard.mjs isBlocked: which addresses count as private or local, including IPv6
// addresses that carry an IPv4 address inside (mapped, NAT64, 6to4, Teredo). Run: node test-net-guard.mjs
import { isBlocked } from "../hooks/lib/net-guard.mjs";

let pass = 0,
  fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) {
    pass++;
    return;
  }
  fail++;
  console.log(`FAIL  ${name}${extra ? `\n      ${extra}` : ""}`);
};

for (const [a, why] of [
  ["127.0.0.1", "loopback"],
  ["169.254.169.254", "cloud metadata"],
  ["192.0.0.1", "IETF protocol assignments 192.0.0.0/24"],
  ["198.18.0.1", "benchmarking 198.18.0.0/15"],
  ["198.19.255.255", "benchmarking 198.18.0.0/15, its last address"],
  ["::1", "IPv6 loopback"],
  ["::ffff:7f00:1", "IPv4-mapped 127.0.0.1"],
  ["::ffff:169.254.169.254", "IPv4-mapped metadata address"],
  ["::ffff:0:127.0.0.1", "SIIT-translated 127.0.0.1"],
  ["::ffff:0:a9fe:a9fe", "SIIT-translated metadata address"],
  ["64:ff9b::7f00:1", "NAT64 of 127.0.0.1"],
  ["64:ff9b::127.0.0.1", "NAT64 of 127.0.0.1, dotted"],
  ["64:ff9b::a9fe:a9fe", "NAT64 of the metadata address"],
  ["64:ff9b:1::1", "local-use NAT64 64:ff9b:1::/48"],
  ["2002:7f00:1::1", "6to4 of 127.0.0.1"],
  ["2002:c0a8:101::", "6to4 of 192.168.1.1"],
  ["2001:0:4136:e378:8000:63bf:80ff:fffe", "Teredo with client 127.0.0.1"],
  ["2001:0:a00:1:8000:63bf:f7f7:f7f7", "Teredo with server 10.0.0.1"],
])
  ok(
    `${a} (${why}) is blocked: an address that is or carries a private or local IPv4 must be refused`,
    isBlocked(a),
  );

for (const [a, why] of [
  ["8.8.8.8", "public IPv4"],
  ["192.0.1.1", "just past 192.0.0.0/24"],
  ["198.20.0.1", "just past 198.18.0.0/15"],
  ["2606:4700::1111", "public IPv6"],
  ["::ffff:808:808", "IPv4-mapped 8.8.8.8"],
  ["::ffff:0:808:808", "SIIT-translated 8.8.8.8"],
  ["64:ff9b::808:808", "NAT64 of 8.8.8.8"],
  ["2002:808:808::1", "6to4 of 8.8.8.8"],
  ["2001:0:4136:e378:8000:63bf:f7f7:f7f7", "Teredo with client 8.8.8.8"],
  ["example.com", "a host name, not an address"],
])
  ok(
    `${a} (${why}) is allowed: only private or local addresses are refused`,
    !isBlocked(a),
  );

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
