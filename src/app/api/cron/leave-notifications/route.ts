import { secretMatches } from "@/modules/crm/automation/security";
import { sendLeaveNotification } from "@/modules/leave/notifications";

export async function GET(request: Request) {
  if (
    !process.env.CRON_SECRET ||
    !secretMatches(request.headers.get("authorization"), `Bearer ${process.env.CRON_SECRET}`)
  )
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const org = process.env.LEAVE_NOTIFICATION_ORGANIZATION_ID;
  if (!org || !process.env.LEAVE_WEB3FORMS_ACCESS_KEY || process.env.LEAVE_WEB3FORMS_SERVER_ENABLED !== "true")
    return Response.json(
      { error: "Server delivery requires a supported Web3Forms plan and explicit configuration" },
      { status: 503 },
    );
  try {
    return Response.json({ state: await sendLeaveNotification(org) });
  } catch {
    return Response.json({ error: "Leave email worker failed. Check the notification log." }, { status: 503 });
  }
}
