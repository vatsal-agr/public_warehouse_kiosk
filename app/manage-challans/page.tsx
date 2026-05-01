"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";

import { cancelChallanAuthorized } from "@/app/actions/cancelChallan";
import { generateChallanPDF, splitVenueContactInfo } from "@/lib/pdfGenerator";
import { supabase } from "@/lib/supabase";
import { useWarehouseStore } from "@/lib/store";

type MovementRow = {
  challan_number: string;
  quantity: number;
  timestamp: string;
  venue_id: string;
  created_by?: string | null;
};

type ChallanSummary = {
  challanNumber: string;
  venueId: string;
  venueName: string;
  time: string;
  type: "IN" | "OUT" | "MIXED";
  createdBy: string | null;
  /** From `challan_tracker`; `none` if no row (e.g. legacy or receiving ref). */
  trackerStatus: "active" | "cancelled" | "none";
};

type ChallanItem = {
  productId: string;
  productName: string;
  quantity: number;
};

type VenueRow = {
  id: string;
  name: string;
  entity_type?: string;
};

type ProductRow = {
  id: string;
  name: string;
};

function startOfTodayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function endOfTodayISO() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
}

function getChallanType(rows: MovementRow[]): "IN" | "OUT" | "MIXED" {
  if (rows.length === 0) return "MIXED";
  const allIn = rows.every((r) => r.quantity > 0);
  const allOut = rows.every((r) => r.quantity < 0);
  if (allIn) return "IN";
  if (allOut) return "OUT";
  return "MIXED";
}

function createdByFromLatestRow(grp: MovementRow[]): string | null {
  if (grp.length === 0) return null;
  const latest = grp.reduce((best, cur) => (cur.timestamp > best.timestamp ? cur : best), grp[0]);
  const raw = latest?.created_by;
  return raw != null && String(raw).trim() !== "" ? String(raw).trim() : null;
}

function isChallanCancelled(c: ChallanSummary): boolean {
  return c.trackerStatus === "cancelled";
}

export default function ManageChallansPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<ChallanSummary[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState<ChallanSummary | null>(null);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [items, setItems] = useState<ChallanItem[]>([]);
  const [modalNotes, setModalNotes] = useState<string | null>(null);
  const [modalBillingEntity, setModalBillingEntity] = useState<string | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const [cancelTarget, setCancelTarget] = useState<ChallanSummary | null>(null);
  const [cancelPassword, setCancelPassword] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadToday() {
      setLoading(true);
      setErrorMsg(null);

      const fromISO = startOfTodayISO();
      const toISO = endOfTodayISO();

      // Assumes `movements.created_at` exists; if your column is named `timestamp`,
      const { data, error } = await supabase
        .from("movements")
        .select("challan_number,quantity,timestamp,venue_id,created_by")
        .gte("timestamp", fromISO)
        .lte("timestamp", toISO)
        .order("timestamp", { ascending: false });

      if (cancelled) return;
      if (error) {
        setErrorMsg(error.message);
        setSummaries([]);
        setLoading(false);
        return;
      }

      const rows = (data ?? []) as MovementRow[];

      const venueIds = Array.from(new Set(rows.map((r) => r.venue_id))).filter(Boolean);
      const venueMap = new Map<string, string>();
      if (venueIds.length > 0) {
        const { data: venuesData } = await supabase
          .from("venues")
          .select("id,name")
          .in("id", venueIds);
        (venuesData ?? []).forEach((v: VenueRow) => {
          venueMap.set(String(v.id), String(v.name));
        });
      }

      const grouped = new Map<string, MovementRow[]>();
      rows.forEach((r) => {
        const key = String(r.challan_number);
        if (!key) return;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(r);
      });

      const built: ChallanSummary[] = Array.from(grouped.entries()).map(([challanNumber, grp]) => {
        const challanNo = String(challanNumber);
        const venueId = grp[0]?.venue_id ?? "";
        const venueName = venueMap.get(venueId) ?? venueId;
        // Use the latest timestamp for display.
        const time = grp.reduce((latest, cur) => (cur.timestamp > latest ? cur.timestamp : latest), grp[0]?.timestamp ?? "");
        return {
          challanNumber: challanNo,
          venueId,
          venueName,
          time,
          type: getChallanType(grp),
          createdBy: createdByFromLatestRow(grp),
          trackerStatus: "none" as ChallanSummary["trackerStatus"],
        };
      });

      const keys = built.map((b) => b.challanNumber).filter(Boolean);
      const statusMap = new Map<string, "active" | "cancelled">();
      if (keys.length > 0) {
        const { data: trData, error: trErr } = await supabase
          .from("challan_tracker")
          .select("challan_number,status")
          .in("challan_number", keys);

        if (!trErr && trData) {
          (trData as { challan_number: string; status: string }[]).forEach((t) => {
            const st = String(t.status);
            if (st === "active" || st === "cancelled") {
              statusMap.set(String(t.challan_number), st);
            }
          });
        }
      }

      const merged: ChallanSummary[] = built.map((b) => ({
        ...b,
        trackerStatus: statusMap.get(b.challanNumber) ?? "none",
      }));

      setSummaries(merged.sort((a, b) => (a.time < b.time ? 1 : -1)));
      setLoading(false);
    }

    void loadToday();
    return () => {
      cancelled = true;
    };
  }, [reloadTick]);

  async function openChallanModal(challan: ChallanSummary) {
    setSelected(challan);
    setItems([]);
    setModalNotes(null);
    setModalBillingEntity(null);
    setEditError(null);
    setItemsLoading(true);

    const { data, error } = await supabase
      .from("movements")
      .select("product_id,quantity,notes,billing_entity,created_by")
      .eq("challan_number", challan.challanNumber);

    if (error) {
      setItems([]);
      setItemsLoading(false);
      return;
    }

    const rows = (data ?? []) as {
      product_id: string;
      quantity: number;
      notes: string | null;
      billing_entity: string | null;
      created_by?: string | null;
    }[];
    const productIds = Array.from(new Set(rows.map((r) => r.product_id))).filter(Boolean);

    const productMap = new Map<string, string>();
    if (productIds.length > 0) {
      const { data: productsData } = await supabase
        .from("products")
        .select("id,name")
        .in("id", productIds);
      (productsData ?? []).forEach((p: ProductRow) => {
        productMap.set(String(p.id), String(p.name));
      });
    }

    const built: ChallanItem[] = rows.map((r) => ({
      productId: r.product_id,
      productName: productMap.get(String(r.product_id)) ?? String(r.product_id),
      quantity: r.quantity,
    }));

    const noteRow = rows.find((r) => r.notes != null && String(r.notes).trim() !== "");
    setModalNotes(noteRow?.notes != null ? String(noteRow.notes).trim() : null);

    const billRow = rows.find(
      (r) => r.billing_entity != null && String(r.billing_entity).trim() !== "",
    );
    setModalBillingEntity(
      billRow?.billing_entity != null ? String(billRow.billing_entity).trim() : null,
    );

    setItems(built);
    setItemsLoading(false);
    setModalOpen(true);
  }

  async function reprintChallanPdf() {
    if (!selected) return;
    if (isChallanCancelled(selected)) return;

    const challanNo =
      typeof selected.challanNumber === "string" ? selected.challanNumber.trim() : "";
    if (!challanNo) return;

    const venueName =
      typeof selected.venueName === "string" && selected.venueName.trim() !== ""
        ? selected.venueName.trim()
        : typeof selected.venueId === "string" && selected.venueId.trim() !== ""
          ? selected.venueId.trim()
          : "—";

    const txType =
      selected.type === "IN" || selected.type === "OUT" || selected.type === "MIXED"
        ? selected.type
        : "MIXED";

    const timeRaw = typeof selected.time === "string" ? selected.time : "";
    const d = timeRaw ? new Date(timeRaw) : null;
    const hasValidTime = d != null && !Number.isNaN(d.getTime());
    const dateStr = hasValidTime
      ? d!.toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        })
      : timeRaw || "—";
    const timeStr = hasValidTime
      ? d!.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
      : "—";

    const cartLines = (items ?? []).map((it) => {
      const q = typeof it.quantity === "number" && Number.isFinite(it.quantity) ? it.quantity : 0;
      return {
        name:
          typeof it.productName === "string" && it.productName.trim() !== ""
            ? it.productName.trim()
            : "Item",
        quantity: Math.abs(q),
      };
    });

    let client_phone: string | null = null;
    let client_address: string | null = null;
    const vid = typeof selected.venueId === "string" ? selected.venueId.trim() : "";
    if (vid) {
      const { data: vRow } = await supabase
        .from("venues")
        .select("contact_info")
        .eq("id", vid)
        .maybeSingle();
      const split = splitVenueContactInfo(
        (vRow as { contact_info?: string | null } | null)?.contact_info,
      );
      client_phone = split.phone || null;
      client_address = split.address || null;
    }

    try {
      generateChallanPDF(
        {
          challan_number: challanNo,
          date: dateStr,
          time: timeStr,
          transaction_type: txType,
          notes: modalNotes ?? undefined,
          client_phone,
          client_address,
        },
        cartLines,
        venueName,
        modalBillingEntity,
      );
    } catch {
      /* PDF / font failures should not crash the kiosk UI */
    }
  }

  const formattedTime = useMemo(() => {
    if (!selected?.time) return "";
    const d = new Date(selected.time);
    if (Number.isNaN(d.getTime())) return selected.time;
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }, [selected]);

  return (
    <div className="flex min-h-screen w-full flex-col bg-[#07090B] text-[#F2F5F7]">
      <div className="w-full border-t-8 border-white/0 bg-transparent p-6 pb-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-black tracking-[0.18em] text-white/80 uppercase">
              Manage Challans
            </div>
            <div className="mt-1 text-xs text-white/60">Today&apos;s transactions</div>
          </div>

          <button
            type="button"
            onClick={() => router.push("/")}
            className="min-h-[48px] min-w-[48px] rounded-2xl border border-white/10 bg-white/5 p-3 text-white/80 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80"
            aria-label="Back to Home"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="flex-1 px-6 pb-10">
        {loading ? (
          <div className="text-xs font-bold uppercase tracking-[0.2em] text-white/60">Loading challans...</div>
        ) : errorMsg ? (
          <div className="text-xs font-bold text-red-200">{errorMsg}</div>
        ) : summaries.length === 0 ? (
          <div className="text-xs leading-5 text-white/60">No challans found for today.</div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {summaries.map((c) => (
              <div
                key={c.challanNumber}
                className={[
                  "flex min-h-[96px] w-full overflow-hidden rounded-3xl border transition",
                  isChallanCancelled(c)
                    ? "border-white/10 bg-white/[0.03] opacity-55"
                    : "border-white/10 bg-white/5 hover:bg-white/[0.07]",
                ].join(" ")}
              >
                <button
                  type="button"
                  onClick={() => openChallanModal(c)}
                  className="min-w-0 flex-1 p-4 text-left focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80"
                  aria-label={`Open challan ${c.challanNumber}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs uppercase tracking-[0.2em] text-white/60">Challan No</div>
                      <div className="mt-1 truncate text-sm font-black text-white/90">{c.challanNumber}</div>
                      <div className="mt-3 text-xs text-white/60">
                        Venue: <span className="text-white/85 font-bold">{c.venueName}</span>
                      </div>
                      {isChallanCancelled(c) ? (
                        <div className="mt-2 inline-flex rounded-full border border-white/20 bg-white/10 px-2.5 py-1 text-[0.65rem] font-black uppercase tracking-[0.2em] text-white/50">
                          Cancelled
                        </div>
                      ) : null}
                    </div>
                    <div className="text-right">
                      <div className="text-xs uppercase tracking-[0.2em] text-white/60">Time</div>
                      <div className="mt-1 flex flex-col items-end gap-0.5">
                        <span className="text-sm font-black text-white/90">
                          {new Date(c.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                        <span className="max-w-[12rem] text-[0.65rem] font-medium text-white/40">
                          👤 Generated by: {c.createdBy ?? "Unknown"}
                        </span>
                      </div>
                      <div
                        className={[
                          "mt-3 inline-flex rounded-full px-3 py-1 text-xs font-black uppercase tracking-[0.2em]",
                          c.type === "IN" ? "bg-green-500/15 text-green-300" : c.type === "OUT" ? "bg-yellow-500/15 text-yellow-200" : "bg-white/10 text-white/80",
                        ].join(" ")}
                      >
                        {c.type}
                      </div>
                    </div>
                  </div>
                </button>
                {!isChallanCancelled(c) ? (
                  <div className="flex shrink-0 flex-col justify-center border-l border-white/10 p-2">
                    <button
                      type="button"
                      onClick={() => {
                        setCancelTarget(c);
                        setCancelPassword("");
                        setCancelError(null);
                      }}
                      className="min-h-[44px] rounded-2xl border border-red-500/35 bg-red-500/10 px-3 text-center text-[0.65rem] font-black uppercase tracking-[0.18em] text-red-200/95 transition hover:bg-red-500/20 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-400/50"
                    >
                      Cancel
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {modalOpen && selected ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Challan details"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        >
          <div className="absolute inset-0" onClick={() => setModalOpen(false)} aria-hidden />

          <div className="relative z-10 w-full max-w-[720px] rounded-3xl border border-white/15 bg-[#0B0E12] p-4 shadow-[0_40px_120px_rgba(0,0,0,0.75)]">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-[0.22em] text-white/60">Challan</div>
                <div className="mt-2 text-lg font-black text-white/90">{selected.challanNumber}</div>
                <div className="mt-1 text-xs text-white/60">
                  Venue: <span className="text-white/85 font-bold">{selected.venueName}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-white/60">
                  <span>
                    Time: <span className="text-white/85 font-bold">{formattedTime}</span>
                  </span>
                  <span className="text-[0.65rem] font-medium text-white/40">
                    👤 Generated by: {selected.createdBy ?? "Unknown"}
                  </span>
                </div>
                <div className="mt-2 text-xs font-bold uppercase tracking-[0.2em] text-white/70">
                  Type: <span className="text-white/90">{selected.type}</span>
                </div>
                {isChallanCancelled(selected) ? (
                  <div className="mt-2 inline-flex rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[0.65rem] font-black uppercase tracking-[0.2em] text-white/50">
                    Cancelled
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="min-h-[48px] min-w-[48px] rounded-2xl border border-white/10 bg-white/5 p-3 text-white/80 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-4 max-h-[45vh] overflow-auto rounded-2xl border border-white/10 bg-white/5 p-3">
              {itemsLoading ? (
                <div className="p-6 text-center text-xs font-bold uppercase tracking-[0.2em] text-white/60">
                  Loading items...
                </div>
              ) : items.length === 0 ? (
                <div className="p-6 text-center text-xs leading-5 text-white/60">No items found for this challan.</div>
              ) : (
                <div className="flex flex-col gap-2">
                  {items.map((it) => (
                    <div
                      key={it.productId}
                      className="rounded-xl border border-white/10 bg-white/5 p-3 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-black text-white/90">{it.productName}</div>
                        <div className="mt-1 text-xs text-white/60">
                          {it.quantity > 0 ? "IN" : it.quantity < 0 ? "OUT" : "—"}
                        </div>
                      </div>
                      <div className="text-sm font-black text-white/90">
                        {it.quantity}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {editError ? (
              <p className="mt-3 text-xs font-bold text-red-300" role="alert">
                {editError}
              </p>
            ) : null}

            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={itemsLoading || editBusy || isChallanCancelled(selected)}
                onClick={() => reprintChallanPdf()}
                className="min-h-[64px] rounded-3xl border-2 border-white/20 bg-white/5 px-4 text-center text-sm font-black tracking-[0.08em] text-white/90 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Reprint"
              >
                🖨️ REPRINT
              </button>
              <button
                type="button"
                disabled={itemsLoading || editBusy || isChallanCancelled(selected)}
                onClick={async () => {
                  if (!selected) return;
                  setEditError(null);
                  setEditBusy(true);
                  const res = await useWarehouseStore.getState().prepareEditChallanForPicker(
                    selected.challanNumber,
                    selected.type,
                  );
                  setEditBusy(false);
                  if (!res.ok) {
                    setEditError(res.error);
                    return;
                  }
                  setModalOpen(false);
                  const challan = encodeURIComponent(selected.challanNumber);
                  const venueId = encodeURIComponent(selected.venueId);
                  router.push(
                    `/picker?mode=${res.mode}&edit=${challan}&venue_id=${venueId}`,
                  );
                }}
                className="min-h-[64px] rounded-3xl border-2 border-white/20 bg-white/5 px-4 text-center text-sm font-black tracking-[0.08em] text-white/90 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Edit challan"
              >
                {editBusy ? "…" : "✏️ EDIT CHALLAN"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {cancelTarget ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Cancel challan"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
        >
          <div className="absolute inset-0" onClick={() => !cancelBusy && setCancelTarget(null)} aria-hidden />

          <div className="relative z-10 w-full max-w-[420px] rounded-3xl border border-white/15 bg-[#0B0E12] p-5 shadow-[0_40px_120px_rgba(0,0,0,0.75)]">
            <div className="text-xs font-bold uppercase tracking-[0.22em] text-white/55">Authorize cancellation</div>
            <p className="mt-2 text-sm text-white/75">
              Enter admin password to cancel challan{" "}
              <span className="font-mono font-bold text-white/90">{cancelTarget.challanNumber}</span>. Stock will be
              reversed automatically.
            </p>
            <label htmlFor="cancel-challan-password" className="mt-4 block text-xs font-bold uppercase tracking-[0.18em] text-white/50">
              Password
            </label>
            <input
              id="cancel-challan-password"
              type="password"
              autoComplete="off"
              value={cancelPassword}
              onChange={(e) => setCancelPassword(e.target.value)}
              disabled={cancelBusy}
              className="mt-2 min-h-[52px] w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-white outline-none focus-visible:ring-4 focus-visible:ring-white/80"
            />
            {cancelError ? (
              <p className="mt-3 text-xs font-bold text-red-300" role="alert">
                {cancelError}
              </p>
            ) : null}
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={cancelBusy}
                onClick={() => {
                  setCancelTarget(null);
                  setCancelPassword("");
                  setCancelError(null);
                }}
                className="min-h-[52px] rounded-2xl border border-white/15 bg-white/5 text-sm font-black uppercase tracking-[0.12em] text-white/85 transition hover:bg-white/10 disabled:opacity-50"
              >
                Back
              </button>
              <button
                type="button"
                disabled={cancelBusy || !cancelPassword.trim()}
                onClick={async () => {
                  if (!cancelTarget) return;
                  setCancelBusy(true);
                  setCancelError(null);
                  const res = await cancelChallanAuthorized({
                    password: cancelPassword,
                    challanNumber: cancelTarget.challanNumber,
                  });
                  setCancelBusy(false);
                  if (!res.ok) {
                    setCancelError(res.error);
                    return;
                  }
                  setCancelTarget(null);
                  setCancelPassword("");
                  setModalOpen(false);
                  setSelected(null);
                  setReloadTick((t) => t + 1);
                }}
                className="min-h-[52px] rounded-2xl border-2 border-red-500/40 bg-red-500/15 text-sm font-black uppercase tracking-[0.12em] text-red-100 transition hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {cancelBusy ? "…" : "Confirm cancel"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

