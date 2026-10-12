import { createClient } from "@/lib/supabase/server";

export async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export type DashboardSnapshot = {
  today: {
    workDate: string;
    state: string;
    checkIn: string | null;
    checkOut: string | null;
    shiftLabel: string;
    canCheckIn: boolean;
    canCheckOut: boolean;
    serverNow: string;
    durationMinutes: number;
  };
  stats: { present: number; expected: number; onLeave: number; pendingApprovals: number };
  recent: Array<{ date: string; checkIn: string | null; checkOut: string | null; duration: string; result: string }>;
  leaveBalances: Array<{ name: string; allocated: number; used: number; available: number }>;
};
