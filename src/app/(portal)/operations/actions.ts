"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireIdentity } from "@/modules/identity/session";

export async function operation(
  _: { error?: string; success?: string },
  form: FormData,
): Promise<{ error?: string; success?: string }> {
  const identity = await requireIdentity();
  const kind = String(form.get("operation"));
  if (kind !== "cancel" && !["admin", "partner"].includes(identity.role)) return { error: "Administrator required." };
  const client = await createClient();
  const value = (name: string) => String(form.get(name) ?? "");
  if (kind === "employee" && !["employee", "admin"].includes(value("role")))
    return { error: "Choose Employee or Administrator." };
  let result: { error: { message: string } | null };
  if (kind === "holiday")
    result = await client.rpc("admin_add_holiday", {
      p_branch: value("branch"),
      p_date: value("date"),
      p_name: value("name"),
    });
  else if (kind === "employee")
    result = await client.rpc("admin_update_employee", {
      p_id: value("employee"),
      p_manager: value("manager") || null,
      p_department: value("department"),
      p_role: value("role"),
      p_active: value("active") === "true",
      p_last_date: value("lastDate") || null,
    });
  else if (kind === "excuse")
    result = await client.rpc("admin_excuse_day", {
      p_employee: value("employee"),
      p_date: value("date"),
      p_reason: value("reason"),
      p_remove: value("remove") === "true",
    });
  else if (kind === "cancel")
    result = await client.rpc("cancel_workspace_request", { p_kind: value("kind"), p_id: value("id") });
  else return { error: "Unknown operation." };
  if (result.error) return { error: result.error.message };
  for (const path of ["/operations", "/employees", "/attendance", "/leave", "/approvals"]) revalidatePath(path);
  return { success: "Saved." };
}
