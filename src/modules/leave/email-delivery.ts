export type LeaveEmailDelivery = {
  id: string;
  lease: string;
  payload: Record<string, string>;
};
export type LeaveEmailOutcome = "sent" | "failed" | "uncertain";

// Browser transport matches the PSB website's free Web3Forms contact form.
export async function deliverLeaveEmail(delivery: LeaveEmailDelivery): Promise<LeaveEmailOutcome> {
  try {
    const response = await fetch("https://api.web3forms.com/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(delivery.payload),
      signal: AbortSignal.timeout(15000),
    });
    const body = await response.json().catch(() => null);
    return response.ok && body?.success === true
      ? "sent"
      : response.status >= 400 && response.status < 500
        ? "failed"
        : "uncertain";
  } catch {
    return "uncertain";
  }
}
