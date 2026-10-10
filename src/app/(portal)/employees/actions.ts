"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type EmployeeState = { error?: string; success?: string };
export async function addEmployee(_: EmployeeState, formData: FormData): Promise<EmployeeState> {
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
