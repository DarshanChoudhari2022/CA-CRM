"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isAdministrator } from "@/modules/identity/access";
import { requireIdentity } from "@/modules/identity/session";

export type EmployeeState = { error?: string; success?: string };
export async function addEmployee(_: EmployeeState, formData: FormData): Promise<EmployeeState> {
  if (!isAdministrator((await requireIdentity()).role)) return { error: "Administrator access required." };
  const supabase = await createClient();
  const manager = String(formData.get("managerId") ?? "");
  const { error } = await supabase.rpc("admin_add_employee", {
    p_code: String(formData.get("code")),
    p_name: String(formData.get("name")),
    p_email: String(formData.get("email")),
    p_department: String(formData.get("department")),
    p_branch_id: String(formData.get("branchId")),
    p_policy_id: String(formData.get("policyId")),
    p_manager_id: manager || null,
    p_joined_on: String(formData.get("joinedOn")),
    p_request_id: crypto.randomUUID(),
  });
  if (error) return { error: error.message };
  revalidatePath("/employees");
  return { success: "Employee added. Select Create login in the directory to generate their credentials." };
}

export async function updateEmployeeAccess(_: EmployeeState, form: FormData): Promise<EmployeeState> {
  if (!isAdministrator((await requireIdentity()).role)) return { error: "Administrator access required." };
  const parsed = z
    .object({ employee: z.uuid(), role: z.enum(["employee", "admin"]), status: z.enum(["active", "inactive"]) })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Choose a valid role and status." };
  const client = await createClient();
  const { error } = await client.rpc("admin_employee_access", {
    p_employee: parsed.data.employee,
    p_role: parsed.data.role,
    p_active: parsed.data.status === "active",
  });
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { success: "Access updated." };
}
