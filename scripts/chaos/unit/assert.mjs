/**
 * WP-101 unit chaos — shared tiny assert helpers (no test framework required).
 */
export function assert(cond, msg) {
  if (!cond) throw new Error(msg ?? "assertion failed");
}

export function assertEqual(a, b, msg) {
  if (a !== b) {
    throw new Error(msg ?? `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}

export function assertDeepEqual(a, b, msg) {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) {
    throw new Error(msg ?? `expected ${sb}, got ${sa}`);
  }
}

export function ok(name) {
  console.log(`  PASS  ${name}`);
}

export function section(title) {
  console.log(`\n== ${title} ==`);
}
