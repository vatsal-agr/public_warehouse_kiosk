"use server";

import { createClient } from "@supabase/supabase-js";

import { parseDeliveryChallanParts } from "@/lib/challanTracker";

function getSupabaseForActions() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return null;
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const REVERSAL_NOTE_PREFIX = "System Reversal: Authorized cancellation of";

export async function cancelChallanAuthorized(input: {
  password: string;
  challanNumber: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword || adminPassword.length === 0) {
    return { ok: false, error: "Cancellation is not configured (missing ADMIN_PASSWORD)." };
  }

  const provided = (input.password ?? "").trim();
  if (provided !== adminPassword) {
    return { ok: false, error: "Incorrect password." };
  }

  const challanNumber = (input.challanNumber ?? "").trim();
  if (!challanNumber) {
    return { ok: false, error: "Missing challan number." };
  }

  const supabase = getSupabaseForActions();
  if (!supabase) {
    return { ok: false, error: "Server misconfiguration (Supabase)." };
  }

  const { data: trackerRow, error: trackerReadErr } = await supabase
    .from("challan_tracker")
    .select("challan_number,status")
    .eq("challan_number", challanNumber)
    .maybeSingle();

  if (trackerReadErr) {
    return { ok: false, error: trackerReadErr.message };
  }

  if (trackerRow && String(trackerRow.status) === "cancelled") {
    return { ok: false, error: "This challan is already cancelled." };
  }

  const { data: movementRows, error: movErr } = await supabase
    .from("movements")
    .select("product_id,venue_id,quantity,notes,billing_entity,created_by")
    .eq("challan_number", challanNumber);

  if (movErr) {
    return { ok: false, error: movErr.message };
  }

  const rows = movementRows ?? [];
  if (rows.length === 0) {
    return { ok: false, error: "No movements found for this challan." };
  }

  const reversalChallanNumber = `REV-${challanNumber}-${Date.now()}`;
  const noteText = `${REVERSAL_NOTE_PREFIX} [${challanNumber}]`;

  const reversalInserts = rows.map(
    (r: {
      product_id: string;
      venue_id: string;
      quantity: number;
      billing_entity?: string | null;
      created_by?: string | null;
    }) => ({
      product_id: r.product_id,
      venue_id: r.venue_id,
      quantity: -Number(r.quantity),
      challan_number: reversalChallanNumber,
      notes: noteText,
      billing_entity: r.billing_entity ?? null,
      created_by: "System",
    }),
  );

  const { error: insertErr } = await supabase.from("movements").insert(reversalInserts);
  if (insertErr) {
    return { ok: false, error: insertErr.message };
  }

  if (trackerRow) {
    const { error: updErr } = await supabase
      .from("challan_tracker")
      .update({ status: "cancelled" })
      .eq("challan_number", challanNumber)
      .eq("status", "active");

    if (updErr) {
      return { ok: false, error: `Reversal posted but status update failed: ${updErr.message}` };
    }
  } else {
    const parts = parseDeliveryChallanParts(challanNumber);
    if (parts) {
      await supabase.from("challan_tracker").insert({
        challan_number: challanNumber,
        date_key: parts.dateKey,
        suffix: parts.suffix,
        status: "cancelled",
      });
    }
  }

  return { ok: true };
}
