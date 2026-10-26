import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  store: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  upload: vi.fn(),
}));
vi.mock("@/modules/crm/automation/store", () => ({ automationStore: mocks.store }));

import { POST } from "./route";

const token = "a".repeat(64);
const hash = createHash("sha256").update(token).digest("hex");
const collectionUrl = `https://example.invalid/collect/${token}`;
const storagePath = "firm/collection/document.pdf";
const pdf = Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");

function uploadRequest(bytes: Uint8Array = pdf) {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(bytes)], "accounts.pdf", { type: "application/pdf" }));
  return new Request(`https://example.invalid/api/collect/${token}`, {
    method: "POST",
    body: form,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.store.mockReturnValue({ rpc: mocks.rpc, storage: { from: mocks.from } });
  mocks.from.mockReturnValue({ upload: mocks.upload });
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === "crm_collection_reserve") return { data: { path: storagePath }, error: null };
    if (name === "crm_collection_finish") return { data: null, error: null };
    throw new Error(`Unexpected RPC: ${name}`);
  });
  mocks.upload.mockResolvedValue({ data: { path: storagePath }, error: null });
});

it("uploads multipart PDF bytes to the reserved path, finishes, and redirects to the collection", async () => {
  const response = await POST(uploadRequest(), { params: Promise.resolve({ token }) });

  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(collectionUrl);
  expect(mocks.rpc).toHaveBeenCalledTimes(2);
  expect(mocks.rpc).toHaveBeenNthCalledWith(1, "crm_collection_reserve", {
    p_hash: hash,
    p_name: "accounts.pdf",
    p_type: "application/pdf",
    p_size: pdf.byteLength,
  });
  expect(mocks.from).toHaveBeenCalledExactlyOnceWith("crm-documents");
  expect(mocks.upload).toHaveBeenCalledExactlyOnceWith(storagePath, pdf, {
    contentType: "application/pdf",
    upsert: false,
  });
  expect(mocks.rpc).toHaveBeenNthCalledWith(2, "crm_collection_finish", { p_hash: hash });
  expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.upload.mock.invocationCallOrder[0]);
  expect(mocks.upload.mock.invocationCallOrder[0]).toBeLessThan(mocks.rpc.mock.invocationCallOrder[1]);
});

it("rejects a PDF filename and MIME type with invalid magic before accessing the database", async () => {
  const response = await POST(uploadRequest(Buffer.from("This is not a PDF")), {
    params: Promise.resolve({ token }),
  });

  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(`${collectionUrl}?result=error`);
  expect(mocks.store).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.upload).not.toHaveBeenCalled();
});

it.each([
  ["file limit", 10 * 1024 * 1024 + 1],
  ["request-body limit", 11 * 1024 * 1024 + 1],
])("rejects a multipart PDF above the %s before accessing the database", async (_limit, size) => {
  const bytes = new Uint8Array(size);
  bytes.set(pdf);
  const response = await POST(uploadRequest(bytes), { params: Promise.resolve({ token }) });

  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(`${collectionUrl}?result=error`);
  expect(mocks.store).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.upload).not.toHaveBeenCalled();
});

it("redirects with an error and never finishes the collection when storage upload fails", async () => {
  mocks.upload.mockResolvedValue({ data: null, error: { message: "Storage unavailable" } });

  const response = await POST(uploadRequest(), { params: Promise.resolve({ token }) });

  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(`${collectionUrl}?result=error`);
  expect(mocks.upload).toHaveBeenCalledExactlyOnceWith(storagePath, pdf, {
    contentType: "application/pdf",
    upsert: false,
  });
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  expect(mocks.rpc).toHaveBeenCalledWith("crm_collection_reserve", {
    p_hash: hash,
    p_name: "accounts.pdf",
    p_type: "application/pdf",
    p_size: pdf.byteLength,
  });
  expect(mocks.rpc).not.toHaveBeenCalledWith("crm_collection_finish", expect.anything());
});
