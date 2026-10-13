import { createHash, randomBytes } from "node:crypto";
import { automationStore } from "./store";
export async function createCollectionLink(documentId: string, org: string) {
  const origin = new URL(process.env.NEXT_PUBLIC_APP_URL ?? "");
  if (origin.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(origin.hostname))
    throw new Error("Secure app URL required");
  const db = automationStore();
  const { data, error } = await db
    .from("crm_documents")
    .select("id")
    .eq("id", documentId)
    .eq("organization_id", org)
    .in("status", ["requested", "rejected"])
    .maybeSingle();
  if (error || !data) throw new Error("Document is not awaiting collection");
  const token = randomBytes(32).toString("hex");
  const { error: saveError } = await db.from("crm_collection_links").insert({
    token_hash: createHash("sha256").update(token).digest("hex"),
    organization_id: org,
    document_id: documentId,
    expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
  });
  if (saveError) throw new Error("Could not issue collection link");
  return new URL(`/collect/${token}`, origin.origin).toString();
}
