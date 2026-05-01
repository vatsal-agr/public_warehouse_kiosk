"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";

import { supabase } from "@/lib/supabase";

type MovementAgg = {
  venue_id: string;
  product_id: string;
  quantity: number;
};

type VenueRow = { id: string; name: string; entity_type?: string };
type ProductRow = { id: string; name: string };

type VenueOutstanding = {
  venueId: string;
  venueName: string;
  lines: { productId: string; productName: string; netQty: number }[];
};

export function StockAtVenuesView() {
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [venuesData, setVenuesData] = useState<VenueOutstanding[]>([]);
  /** Open venue IDs (all collapsed by default) */
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);

    const { data, error } = await supabase
      .from("movements")
      .select("venue_id,product_id,quantity");

    if (error) {
      setErrorMsg(error.message);
      setVenuesData([]);
      setLoading(false);
      return;
    }

    const rows = (data ?? []) as MovementAgg[];
    const pairSums = new Map<string, { venueId: string; productId: string; sum: number }>();

    for (const r of rows) {
      const vid = String(r.venue_id ?? "");
      const pid = String(r.product_id ?? "");
      if (!vid || !pid) continue;
      const key = `${vid}\t${pid}`;
      const q = typeof r.quantity === "number" && Number.isFinite(r.quantity) ? r.quantity : 0;
      const prev = pairSums.get(key);
      if (prev) prev.sum += q;
      else pairSums.set(key, { venueId: vid, productId: pid, sum: q });
    }

    const outstanding = [...pairSums.values()].filter((x) => x.sum !== 0);
    if (outstanding.length === 0) {
      setVenuesData([]);
      setOpenIds(new Set());
      setLoading(false);
      return;
    }

    const venueIds = [...new Set(outstanding.map((x) => x.venueId))];
    const productIds = [...new Set(outstanding.map((x) => x.productId))];

    const venueMap = new Map<string, string>();
    const { data: venuesRes } = await supabase.from("venues").select("id,name").in("id", venueIds);
    (venuesRes ?? []).forEach((v: VenueRow) => venueMap.set(String(v.id), String(v.name)));

    const productMap = new Map<string, string>();
    const { data: productsRes } = await supabase.from("products").select("id,name").in("id", productIds);
    (productsRes ?? []).forEach((p: ProductRow) => productMap.set(String(p.id), String(p.name)));

    const byVenue = new Map<string, VenueOutstanding>();
    for (const o of outstanding) {
      const vName = venueMap.get(o.venueId) ?? o.venueId;
      if (!byVenue.has(o.venueId)) {
        byVenue.set(o.venueId, {
          venueId: o.venueId,
          venueName: vName,
          lines: [],
        });
      }
      byVenue.get(o.venueId)!.lines.push({
        productId: o.productId,
        productName: productMap.get(o.productId) ?? o.productId,
        netQty: o.sum * -1,
      });
    }

    const list = [...byVenue.values()].map((v) => ({
      ...v,
      lines: v.lines.sort((a, b) => a.productName.localeCompare(b.productName)),
    }));
    list.sort((a, b) => a.venueName.localeCompare(b.venueName));

    setVenuesData(list);
    // Drop open ids for venues that no longer exist
    setOpenIds((prev) => {
      const next = new Set<string>();
      const have = new Set(list.map((x) => x.venueId));
      for (const id of prev) {
        if (have.has(id)) next.add(id);
      }
      return next;
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(id);
  }, [load]);

  const expandAll = useCallback(() => {
    setOpenIds(new Set(venuesData.map((v) => v.venueId)));
  }, [venuesData]);

  const collapseAll = useCallback(() => {
    setOpenIds(new Set());
  }, []);

  const toggle = useCallback((venueId: string) => {
    setOpenIds((prev) => {
      const n = new Set(prev);
      if (n.has(venueId)) n.delete(venueId);
      else n.add(venueId);
      return n;
    });
  }, []);

  if (loading) {
    return (
      <div className="text-xs font-bold uppercase tracking-[0.2em] text-white/55">Loading stock positions…</div>
    );
  }

  if (errorMsg) {
    return (
      <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm font-bold text-red-200">
        {errorMsg}
      </div>
    );
  }

  if (venuesData.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-sm text-white/55">
        No outstanding balances. All items are currently in the warehouse.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-bold">
        <button
          type="button"
          onClick={expandAll}
          className="text-white/50 underline decoration-white/20 underline-offset-2 transition hover:text-white/90 hover:decoration-white/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
        >
          Expand all
        </button>
        <button
          type="button"
          onClick={collapseAll}
          className="text-white/50 underline decoration-white/20 underline-offset-2 transition hover:text-white/90 hover:decoration-white/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
        >
          Collapse all
        </button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="max-w-3xl text-sm text-white/50">
          Non-zero movement totals by venue and product (summed across all challans). Positive quantities
          indicate items held at the venue; negative means net back at the warehouse.
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="shrink-0 rounded-2xl border border-white/15 bg-white/5 px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-white/80 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80"
        >
          Refresh
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {venuesData.map((v) => {
          const isOpen = openIds.has(v.venueId);
          return (
            <div
              key={v.venueId}
              className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] shadow-[0_8px_32px_rgba(0,0,0,0.3)]"
            >
              <button
                type="button"
                id={`venue-acc-${v.venueId}`}
                aria-expanded={isOpen}
                aria-controls={`venue-pnl-${v.venueId}`}
                onClick={() => toggle(v.venueId)}
                className="flex w-full min-h-[56px] items-center justify-between gap-4 border border-transparent px-4 py-3.5 text-left transition hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#2E5BFF]/50"
              >
                <span className="min-w-0 text-base font-black leading-snug text-white/95">{v.venueName}</span>
                <ChevronDown
                  className={[
                    "h-5 w-5 shrink-0 text-white/50 transition-transform duration-300 ease-out",
                    isOpen ? "rotate-180" : "rotate-0",
                  ].join(" ")}
                  strokeWidth={2.25}
                  aria-hidden
                />
              </button>

              <div
                id={`venue-pnl-${v.venueId}`}
                role="region"
                aria-labelledby={`venue-acc-${v.venueId}`}
                className={[
                  "grid overflow-hidden transition-[grid-template-rows] duration-300 ease-out",
                  isOpen
                    ? "grid-rows-[1fr] border-t border-white/10"
                    : "grid-rows-[0fr] border-t border-transparent",
                ].join(" ")}
              >
                <div className="min-h-0 overflow-hidden" aria-hidden={!isOpen}>
                  <div className="px-4 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">Items (net qty)</p>
                    <div className="mt-3 overflow-x-auto rounded-xl border border-white/10">
                      <table className="w-full min-w-[240px] border-collapse text-left text-sm">
                        <thead>
                          <tr className="border-b border-white/10 bg-black/30">
                            <th className="px-3 py-2.5 text-xs font-black uppercase tracking-[0.12em] text-white/55">Product</th>
                            <th className="px-3 py-2.5 text-right text-xs font-black uppercase tracking-[0.12em] text-white/55">
                              Net qty
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {v.lines.map((line) => (
                            <tr key={line.productId} className="border-b border-white/[0.05] last:border-b-0 odd:bg-white/[0.02]">
                              <td className="px-3 py-2.5 text-sm font-bold text-white/90">{line.productName}</td>
                              <td className="px-3 py-2.5 text-right font-mono text-sm font-black tabular-nums text-amber-200/95">
                                {line.netQty}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
