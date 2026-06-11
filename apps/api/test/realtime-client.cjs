/**
 * Realtime client harness (Chunk 5.3 gate), driven by realtime-e2e.sh. Asserts:
 *  - an unauthenticated socket is rejected (never receives 'ready'),
 *  - an authenticated socket joins its tenant room and receives bridged domain events,
 *  - tenant isolation: closing a deal in tenant A reaches A's socket but NOT B's.
 * Env: BASE, TOKEN_A, TOKEN_B, DEAL_ID. Prints "RESULT: N passed, M failed" and exits non-zero on fail.
 */
const { io } = require('socket.io-client');

const BASE = process.env.BASE;
const TOKEN_A = process.env.TOKEN_A;
const TOKEN_B = process.env.TOKEN_B;
const DEAL_ID = process.env.DEAL_ID;

let pass = 0;
let fail = 0;
const check = (name, ok, extra = '') => {
  if (ok) { console.log(`  ✅ ${name}`); pass++; } else { console.log(`  ❌ ${name} ${extra}`); fail++; }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const connect = (token) => io(BASE, { auth: token ? { token } : {}, transports: ['websocket'], reconnection: false, timeout: 4000 });

async function main() {
  // 1) Unauthenticated socket must be rejected (no 'ready').
  const bad = connect(undefined);
  let badReady = false;
  let badRejected = false;
  bad.on('ready', () => { badReady = true; });
  bad.on('unauthorized', () => { badRejected = true; });
  bad.on('disconnect', () => { badRejected = true; });
  await wait(2500);
  check('unauthenticated socket rejected (no ready)', !badReady && badRejected, `ready=${badReady} rejected=${badRejected}`);
  bad.close();

  // 2) Authenticated sockets for tenant A and tenant B.
  const a = connect(TOKEN_A);
  const b = connect(TOKEN_B);
  const aReady = new Promise((res) => a.on('ready', res));
  const bReady = new Promise((res) => b.on('ready', res));
  const aEvents = [];
  const bEvents = [];
  a.on('event', (e) => aEvents.push(e));
  b.on('event', (e) => bEvents.push(e));
  await Promise.race([Promise.all([aReady, bReady]), wait(4000)]);
  check('authenticated sockets joined (both ready)', a.connected && b.connected, `a=${a.connected} b=${b.connected}`);

  // 3) Trigger a domain event in tenant A (close a deal) → relay → bridge → tenant A room only.
  const res = await fetch(`${BASE}/crm/deals/${DEAL_ID}/stage`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${TOKEN_A}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ stage: 'CLOSED_WON' }),
  });
  check('deal moved to CLOSED_WON (200)', res.status === 200, `status=${res.status}`);

  // Wait for the event to propagate (relay polls @500ms).
  for (let i = 0; i < 30 && aEvents.length === 0; i++) await wait(300);

  const got = aEvents.find((e) => e.type === 'crm.deal_closed.v1');
  check('tenant A socket received crm.deal_closed.v1', Boolean(got), `events=${JSON.stringify(aEvents)}`);
  check('tenant B socket received NOTHING (isolation)', bEvents.length === 0, `B events=${JSON.stringify(bEvents)}`);

  a.close();
  b.close();
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
