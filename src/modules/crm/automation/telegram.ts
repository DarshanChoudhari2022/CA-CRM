export async function sendTelegram(recipient: string, body: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || recipient !== process.env.TELEGRAM_PARTNER_CHAT_ID)
    throw new Error("Partner alert configuration required");
  const result = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: recipient, text: body.slice(0, 4000) }),
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!result.ok) throw new Error("Telegram did not confirm acceptance");
  const data = await result.json();
  if (!data.ok || !data.result?.message_id) throw new Error("Telegram acceptance unavailable");
  return String(data.result.message_id);
}
