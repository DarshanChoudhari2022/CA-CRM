export type DailyReportPhoto = { id: string; path: string; state: "pending" | "ready" | "discarding" };
export type DailyReportData = { workDate: string; canEdit: boolean; summary: string; photos: DailyReportPhoto[] };
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export function validateWorkPhoto(file: { size: number; type: string }): string | null {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return "Choose a JPEG, PNG or WebP photo.";
  if (file.size <= 0 || file.size > MAX_PHOTO_BYTES) return "Choose a photo up to 5 MB.";
  return null;
}
