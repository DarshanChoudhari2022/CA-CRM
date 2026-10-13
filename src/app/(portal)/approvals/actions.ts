"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireIdentity } from "@/modules/identity/session";

export async function decide(kind: "leave" | "attendance", id: string, decision: "approved" | "rejected", reason = "") {
  await requireIdentity();
  const input = z
    .object({
      kind: z.enum(["leave", "attendance"]),
      id: z.uuid(),
      decision: z.enum(["approved", "rejected"]),
      reason: z.string().trim().max(500),
    })
    .safeParse({ kind, id, decision, reason });
  if (!input.success) return { error: "Check the request and decision." };
  if (decision === "rejected" && input.data.reason.length < 3)
    return { error: "Enter a rejection reason of at least 3 characters." };
  const supabase = await createClient();
  const rpcName = kind === "leave" ? "decide_leave_request" : "decide_attendance_correction";
  const { error } = await supabase.rpc(rpcName, {
    p_id: id,
    p_decision: decision,
    p_reason: input.data.reason,
    p_request_id: crypto.randomUUID(),
  });
  if (error) return { error: error.message };
  revalidatePath("/approvals");
  revalidatePath("/dashboard");
  revalidatePath("/leave");
  revalidatePath("/attendance");
  return { success: `${kind === "leave" ? "Leave" : "Correction"} ${decision}.` };
}
