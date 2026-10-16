// The PSB website names this WEB3FORMS_ACCESS_KEY. A dedicated leave key can override it.
export function leaveWeb3FormsKey(env: Record<string, string | undefined> = process.env): string | undefined {
  return env.LEAVE_WEB3FORMS_ACCESS_KEY?.trim() || env.WEB3FORMS_ACCESS_KEY?.trim() || undefined;
}
