import { supabase } from "@/lib/supabase";

import { todayDateKeyLocal } from "@/lib/challanTracker";

/**
 * Next delivery challan: `YYYYMMDD-NN` where NN = MAX(suffix)+1 for that date in `challan_tracker`
 * (includes cancelled rows so numbers are never reused). Does not use count().
 */
export async function allocateNextDeliveryChallanYmd(): Promise<
  { ok: true; challanNumber: string } | { ok: false; error: string }
> {
  const dateKey = todayDateKeyLocal();

  const { data, error } = await supabase
    .from("challan_tracker")
    .select("suffix")
    .eq("date_key", dateKey)
    .order("suffix", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message };
  }

  const maxSuffix =
    data && typeof (data as { suffix?: unknown }).suffix === "number"
      ? Math.max(0, (data as { suffix: number }).suffix)
      : 0;

  const next = maxSuffix + 1;
  const challanNumber = `${dateKey}-${String(next).padStart(2, "0")}`;
  return { ok: true, challanNumber };
}

/** Stock-in reference; kept off the delivery sequence (no `challan_tracker` row). */
export function allocateReceivingReferenceChallanNumber(): string {
  return `RC-${Date.now()}`;
}
