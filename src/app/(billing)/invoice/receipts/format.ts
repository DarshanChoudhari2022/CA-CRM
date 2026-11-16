import { z } from "zod";

export type SearchParams = Record<string, string | string[] | undefined>;
export const pageSize = 25;

export function queryText(value: SearchParams[string], max = 120) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function queryId(value: SearchParams[string]) {
  return z.uuid().safeParse(value).data;
}

export function pageNumber(value: SearchParams[string]) {
  const page = Number(value);
  return typeof value === "string" && Number.isSafeInteger(page) && page >= 1 && page <= 1_000_000 ? page : 1;
}

export function containsPattern(value: string) {
  return `%${value.replace(/[\\%_*]/g, "\\$&")}%`;
}

export function billingHref(path: string, values: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value) search.set(key, String(value));
  }
  return search.size ? `${path}?${search}` : path;
}

const currency = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });
const date = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
});

export function money(paise: number) {
  return currency.format(paise / 100);
}

export function toPaise(amount: number) {
  return Math.round(amount * 100);
}

export function billingDate(value: string | null) {
  return value ? date.format(new Date(value)) : "—";
}
