"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireIdentity } from "@/modules/identity/session";
export async function acknowledge(form: FormData) {
  await requireIdentity();
  const id = z.uuid().parse(form.get("id"));
  const { error } = await (await createClient()).rpc("crm_acknowledge_event", { p_id: id });
  if (error) throw new Error(error.message);
  revalidatePath("/crm/automations");
}
