import { query } from "@mozetto/database";

console.log("[settlement-worker] stub running — processes ledger settlements; Base Sepolia later");

async function tick() {
  const pending = await query(`select count(*)::int as n from settlements where status = 'pending'`);
  console.log("[settlement-worker] pending settlements", pending.rows[0]?.n ?? 0);
}

setInterval(() => {
  tick().catch((e) => console.error(e));
}, 30000);

tick().catch(console.error);
