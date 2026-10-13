import { createHash } from "node:crypto";
import { createCollectionLink } from "./collection";
import { automationStore } from "./store";

export async function collectWhatsAppAttachment(org: string, inboundId: string, documentId: string) {
  const db = automationStore();
  const [inbox, document] = await Promise.all([
    db
      .from("crm_inbound")
      .select("body,client_id")
      .eq("id", inboundId)
      .eq("organization_id", org)
      .eq("channel", "whatsapp")
      .single(),
    db
      .from("crm_documents")
      .select("client_id")
      .eq("id", documentId)
      .eq("organization_id", org)
      .in("status", ["requested", "rejected"])
      .single(),
  ]);
  if (inbox.error || document.error || !inbox.data.client_id || inbox.data.client_id !== document.data.client_id)
    throw new Error("Select a requested document belonging to this client");
  const prefix = "Attachment requires staff matching and review. ";
  if (!inbox.data.body.startsWith(prefix)) throw new Error("No supported attachment");
  const attachment = JSON.parse(inbox.data.body.slice(prefix.length));
  if (!["image", "document"].includes(attachment.type) || !/^\d+$/.test(attachment.media?.id ?? ""))
    throw new Error("Invalid media reference");
  const token = process.env.WHATSAPP_ACCESS_TOKEN,
    version = process.env.WHATSAPP_GRAPH_VERSION;
  if (!token || !/^v\d+\.\d+$/.test(version ?? "")) throw new Error("WhatsApp configuration required");
  const headers = { Authorization: `Bearer ${token}` };
  const response = await fetch(`https://graph.facebook.com/${version}/${attachment.media.id}`, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("Media unavailable or expired");
  const metadata = await response.json();
  const types: Record<string, string> = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  };
  if (!types[metadata.mime_type] || metadata.file_size > 10485760)
    throw new Error("Unsupported attachment type or size");
  const url = new URL(metadata.url);
  if (
    url.protocol !== "https:" ||
    !["facebook.com", "fbsbx.com", "fbcdn.net"].some(
      (domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`),
    )
  )
    throw new Error("Untrusted media URL");
  const file = await fetch(url, { headers, redirect: "error", signal: AbortSignal.timeout(20000) });
  if (!file.ok || !file.body) throw new Error("Download failed");
  const reader = file.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 10485760) {
      await reader.cancel();
      throw new Error("File too large");
    }
    chunks.push(value);
  }
  if (!size) throw new Error("Empty attachment");
  const bytes = Buffer.concat(chunks);
  const digest = createHash("sha256").update(bytes).digest();
  if (metadata.sha256 && ![digest.toString("hex"), digest.toString("base64")].includes(metadata.sha256))
    throw new Error("Attachment checksum mismatch");
  const link = await createCollectionLink(documentId, org),
    secret = new URL(link).pathname.split("/").at(-1) ?? "";
  const hash = createHash("sha256").update(secret).digest("hex");
  const reserved = await db.rpc("crm_collection_reserve", {
    p_hash: hash,
    p_name: `whatsapp-${attachment.media.id}.${types[metadata.mime_type]}`,
    p_type: metadata.mime_type,
    p_size: size,
  });
  if (reserved.error) throw new Error("Reservation failed");
  const uploaded = await db.storage
    .from("crm-documents")
    .upload(reserved.data.path, bytes, { contentType: metadata.mime_type, upsert: false });
  if (uploaded.error) throw new Error("Upload failed");
  const finished = await db.rpc("crm_collection_finish", { p_hash: hash });
  if (finished.error) throw new Error("Finalization failed");
  await db
    .from("crm_inbound")
    .update({
      status: "complete",
      reply: "Attachment received and linked by staff. Document verification pending.",
      updated_at: new Date().toISOString(),
    })
    .eq("id", inboundId)
    .eq("organization_id", org);
}
