import { createHash } from "node:crypto";
import { automationStore } from "@/modules/crm/automation/store";
import { documentType } from "@/modules/crm/documents";

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-f0-9]{64}$/.test(token)) return new Response("Not found", { status: 404 });
  const url = new URL(`/collect/${token}`, request.url);
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error("No file");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 11 * 1024 * 1024) {
        await reader.cancel();
        throw new Error("Too large");
      }
      chunks.push(value);
    }
    const form = await new Response(Buffer.concat(chunks), {
      headers: { "Content-Type": request.headers.get("content-type") ?? "" },
    }).formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("File required");
    const type = documentType(file.name, file.size),
      bytes = Buffer.from(await file.arrayBuffer());
    const magic =
      type === "application/pdf"
        ? bytes.subarray(0, 5).toString() === "%PDF-"
        : type === "image/png"
          ? bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a"
          : type === "image/jpeg"
            ? bytes.subarray(0, 3).toString("hex") === "ffd8ff"
            : bytes.subarray(0, 4).toString("hex") === "504b0304";
    if (!magic) throw new Error("File content does not match type");
    const hash = createHash("sha256").update(token).digest("hex"),
      db = automationStore();
    const { data, error } = await db.rpc("crm_collection_reserve", {
      p_hash: hash,
      p_name: file.name.slice(0, 160),
      p_type: type,
      p_size: file.size,
    });
    if (error) throw new Error("Link unavailable");
    const upload = await db.storage
      .from("crm-documents")
      .upload(data.path, bytes, { contentType: type, upsert: false });
    if (upload.error && upload.error.message !== "The resource already exists")
      throw new Error("Storage upload failed");
    const finish = await db.rpc("crm_collection_finish", { p_hash: hash });
    if (finish.error) throw new Error("Upload not finalized");
  } catch {
    url.searchParams.set("result", "error");
  }
  return Response.redirect(url, 303);
}
