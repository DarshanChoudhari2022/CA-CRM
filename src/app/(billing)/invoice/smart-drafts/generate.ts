"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireCrmIdentity } from "@/modules/identity/crm";

export async function generateFilingDraft(_: { error?: string }, form: FormData): Promise<{ error?: string }> {
  await requireCrmIdentity();
  const input = z.object({ filing: z.uuid(), service: z.uuid() }).safeParse(Object.fromEntries(form));
  if (!input.success) return { error: "Choose a filing and a service." };
  const { data, error } = await (await createClient()).rpc("billing_generate_filing_draft", {
    p_filing: input.data.filing,
    p_service: input.data.service,
  });
  if (error || typeof data !== "string") return { error: error?.message ?? "Draft unavailable." };
  revalidatePath("/invoice", "layout");
  redirect(`/invoice/raise?id=${data}`);
}
