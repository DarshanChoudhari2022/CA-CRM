// CI may use an isolated loopback database without TLS. Hosted checks always require TLS.
export function testDatabaseOptions() {
  const url = new URL(process.env.SUPABASE_DB_URL ?? "");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (process.env.TEST_DATABASE_LOCAL === "1" && !local)
    throw new Error("Unencrypted test database must be on loopback.");
  return { max: 1, ssl: process.env.TEST_DATABASE_LOCAL === "1" && local ? false : "require" };
}
