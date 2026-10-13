export const documentMimeTypes = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;
export type DocumentVersion = {
  id: string;
  document_id: string;
  version: number;
  filename: string;
  byte_size: number;
  state: "pending" | "ready" | "discarding";
  storage_path: string;
  uploaded_by: string | null;
  created_at: string;
};
export function documentType(filename: string, size: number): string {
  const extension = filename.split(".").at(-1)?.toLowerCase() ?? "";
  if (size < 1 || size > 10485760 || !Object.hasOwn(documentMimeTypes, extension))
    throw new Error("Choose a PDF, PNG, JPEG, DOCX or XLSX between 1 byte and 10 MB.");
  return documentMimeTypes[extension as keyof typeof documentMimeTypes];
}
