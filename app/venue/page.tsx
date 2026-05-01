"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, MapPin, Trash2, X } from "lucide-react";

import { todayDateKeyLocal } from "@/lib/challanTracker";
import { generateChallanPDF, splitVenueContactInfo } from "@/lib/pdfGenerator";
import { supabase } from "@/lib/supabase";
import {
  clearCartInSession,
  loadCartFromSession,
  saveCartToSession,
  type CartItem,
  type TransactionMode,
} from "@/lib/kioskStorage";
import {
  mergeVenueIntoCatalog,
  useWarehouseStore,
  type WalkInDetails,
  type WarehouseVenue,
  DEFAULT_CHECKOUT_BILLING_ENTITY,
} from "@/lib/store";
import { useInactivityReset } from "@/lib/useInactivityReset";

const BILLING_TENT = DEFAULT_CHECKOUT_BILLING_ENTITY;
const BILLING_DERA = "Entity Name";
const BILLING_OPTIONS = [BILLING_TENT, BILLING_DERA] as const;

/** Must match the generic placeholder row in `venues` (not saved walk-in customers). */
const WALK_IN_GENERIC_VENUE_NAME = "Walk-in / One-Off Customer";

function normalizeVenueNameForMatch(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** DB text may differ slightly in whitespace; keeps selection + pin logic aligned. */
function isGenericWalkInVenueName(name: string): boolean {
  return (
    normalizeVenueNameForMatch(name) === normalizeVenueNameForMatch(WALK_IN_GENERIC_VENUE_NAME)
  );
}

/** Core properties / hotels: default grid only (not saved walk-in customer rows). */
function isCoreHotelVenue(v: WarehouseVenue): boolean {
  const t = String(v.entity_type ?? "").trim();
  if (t === "Walk-In") return false;
  return t === "" || t === "Venue";
}

function isSavedWalkInCustomerVenue(v: WarehouseVenue): boolean {
  return String(v.entity_type ?? "").trim() === "Walk-In";
}

/** Supports text return, JSON object, or single-row array from `create_challan_with_movements`. */
function parseChallanNumberFromRpc(data: unknown): string {
  if (data === null || data === undefined) return "";
  if (typeof data === "string" || typeof data === "number" || typeof data === "boolean") {
    return String(data).trim();
  }
  if (Array.isArray(data)) {
    if (data.length === 0) return "";
    return parseChallanNumberFromRpc(data[0]);
  }
  if (typeof data === "object") {
    const o = data as Record<string, unknown>;
    const cn = o.challan_number ?? o.challanNumber;
    if (cn != null) return String(cn).trim();
    const keys = Object.keys(o);
    if (keys.length === 1 && o[keys[0]] != null) {
      return String(o[keys[0]]).trim();
    }
  }
  return "";
}

/** Match on display name or contact line (phone / address) for search. */
function venueMatchesSearchQuery(v: WarehouseVenue, qLower: string): boolean {
  if (!qLower) return true;
  if (v.name.toLowerCase().includes(qLower)) return true;
  const ci = (v.contact_info ?? "").trim();
  return ci.length > 0 && ci.toLowerCase().includes(qLower);
}

export default function VenuePage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-[100dvh] w-screen items-center justify-center overflow-hidden bg-[#07090B] text-white/60">
          Loading...
        </div>
      }
    >
      <VenueClient />
    </Suspense>
  );
}

function VenueClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const modeParam = searchParams.get("mode");
  const transactionMode: TransactionMode | null =
    modeParam === "out" || modeParam === "in" ? modeParam : null;

  const editChallanParam = searchParams.get("edit") ?? searchParams.get("challan_number");
  const venueIdParam = searchParams.get("venue_id");

  const venues = useWarehouseStore((s) => s.venues);
  const isVenueCatalogLoaded = useWarehouseStore((s) => s.isLoaded);
  const activeWorker = useWarehouseStore((s) => s.activeWorker);
  const walkInDetails = useWarehouseStore((s) => s.walkInDetails);
  const setWalkInDetails = useWarehouseStore((s) => s.setWalkInDetails);
  const checkoutVenueId = useWarehouseStore((s) => s.checkoutVenueId);
  const setCheckoutVenueId = useWarehouseStore((s) => s.setCheckoutVenueId);
  const checkoutBillingEntity = useWarehouseStore((s) => s.checkoutBillingEntity);
  const setCheckoutBillingEntity = useWarehouseStore((s) => s.setCheckoutBillingEntity);
  const checkoutDeliveryNotes = useWarehouseStore((s) => s.checkoutDeliveryNotes);
  const setCheckoutDeliveryNotes = useWarehouseStore((s) => s.setCheckoutDeliveryNotes);
  const resetCheckoutForm = useWarehouseStore((s) => s.resetCheckoutForm);
  const [submitErrorMsg, setSubmitErrorMsg] = useState<string | null>(null);
  const [checkoutSuccessNotice, setCheckoutSuccessNotice] = useState<string | null>(null);

  const [venueQuery, setVenueQuery] = useState("");

  const [cart, setCart] = useState<CartItem[]>(() => loadCartFromSession());

  // Cart editing modal (overwrites quantity)
  const [modalOpen, setModalOpen] = useState(false);
  const [activeCartItem, setActiveCartItem] = useState<CartItem | null>(null);
  const [typedQty, setTypedQty] = useState("");
  const [qtyError, setQtyError] = useState<string | null>(null);

  useEffect(() => {
    saveCartToSession(cart);
  }, [cart]);

  useInactivityReset({
    timeoutMs: 150_000,
    onReset: useCallback(() => {
      useWarehouseStore.getState().persistCartForActiveWorker();
      useWarehouseStore.getState().resetCheckoutForm();
      setCart([]);
      clearCartInSession();
      setModalOpen(false);
      setActiveCartItem(null);
      setTypedQty("");
      setQtyError(null);
      router.push("/");
    }, [router]),
  });

  useEffect(() => {
    if (!isVenueCatalogLoaded) {
      void useWarehouseStore.getState().fetchInitialData();
    }
  }, [isVenueCatalogLoaded]);

  useEffect(() => {
    if (!isVenueCatalogLoaded) return;
    if (activeWorker == null) {
      router.replace("/");
    }
  }, [isVenueCatalogLoaded, activeWorker, router]);

  useEffect(() => {
    if (venueIdParam) {
      setCheckoutVenueId(venueIdParam);
    }
  }, [venueIdParam, setCheckoutVenueId]);

  const patchWalkIn = useCallback((patch: Partial<WalkInDetails>) => {
    const prev = useWarehouseStore.getState().walkInDetails;
    setWalkInDetails({
      name: patch.name ?? prev?.name ?? "",
      phone: patch.phone ?? prev?.phone ?? "",
      address: patch.address ?? prev?.address ?? "",
    });
  }, [setWalkInDetails]);

  const totalQty = useMemo(() => cart.reduce((sum, x) => sum + x.quantity, 0), [cart]);
  const canConfirm = cart.length > 0 && !!checkoutVenueId && transactionMode !== null;

  const isStockOut = transactionMode === "out";
  const themeBorderClass = isStockOut ? "border-yellow-500" : "border-green-500";
  const themeTintBgClass = isStockOut ? "bg-yellow-500/5" : "bg-green-500/5";
  const themeBtnBgClass = isStockOut ? "bg-yellow-500 hover:bg-yellow-600 text-black" : "bg-green-500 hover:bg-green-600 text-black";

  const cartItemName = activeCartItem?.name ?? "";

  const walkInPlaceholderVenue = useMemo(
    () => venues.find((v) => isGenericWalkInVenueName(v.name)) ?? null,
    [venues],
  );

  /**
   * Below the generic walk-in tile: core hotels only when search is empty (A–Z).
   * With search text: filter hotels + Walk-In rows where name OR contact_info matches (Walk-In only in this mode).
   */
  const visibleVenues = useMemo(() => {
    const q = venueQuery.trim().toLowerCase();
    const nonGeneric = venues.filter((v) => !isGenericWalkInVenueName(v.name));

    const sortAlpha = (list: WarehouseVenue[]) =>
      [...list].sort((a, b) => a.name.localeCompare(b.name));

    if (!q) {
      return sortAlpha(nonGeneric.filter(isCoreHotelVenue));
    }

    return sortAlpha(
      nonGeneric.filter((v) => {
        if (!venueMatchesSearchQuery(v, q)) return false;
        return isCoreHotelVenue(v) || isSavedWalkInCustomerVenue(v);
      }),
    );
  }, [venues, venueQuery]);

  const selectedVenueName = useMemo(() => {
    return venues.find((v) => v.id === checkoutVenueId)?.name ?? "";
  }, [venues, checkoutVenueId]);

  const isWalkInOneOff = isGenericWalkInVenueName(selectedVenueName);

  const walkInNameTrim = (walkInDetails?.name ?? "").trim();
  const walkInPhoneTrim = (walkInDetails?.phone ?? "").trim();
  const walkInAddressTrim = (walkInDetails?.address ?? "").trim();

  function closeModal() {
    setModalOpen(false);
    setActiveCartItem(null);
    setTypedQty("");
    setQtyError(null);
  }

  function openEditQtyModal(item: CartItem) {
    setActiveCartItem(item);
    setTypedQty(String(item.quantity));
    setQtyError(null);
    setModalOpen(true);
  }

  function appendDigit(digit: string) {
    if (!modalOpen) return;
    if (typedQty.length >= 3) return;
    setTypedQty((prev) => `${prev}${digit}`);
    setQtyError(null);
  }

  function clearDigits() {
    setTypedQty("");
    setQtyError(null);
  }

  function confirmQty() {
    if (!activeCartItem) return;
    if (!typedQty) {
      setQtyError("Type quantity first.");
      return;
    }

    const qty = Number.parseInt(typedQty, 10);
    if (!Number.isFinite(qty) || qty < 1) {
      setQtyError("Quantity must be at least 1.");
      return;
    }

    // Overwrite quantity (not additive).
    setCart((prev) =>
      prev.map((x) => (x.productId === activeCartItem.productId ? { ...x, quantity: qty } : x)),
    );
    closeModal();
  }

  async function confirmTransaction() {
    if (!transactionMode || !checkoutVenueId) return;
    if (cart.length === 0) return;

    setSubmitErrorMsg(null);

    let notesToStore: string | null = null;
    if (isWalkInOneOff) {
      if (!walkInNameTrim || !walkInPhoneTrim || !walkInAddressTrim) {
        setSubmitErrorMsg(
          "Full name, phone number, and address are required for walk-in customers.",
        );
        return;
      }
      notesToStore = `Name: ${walkInNameTrim} | Phone: ${walkInPhoneTrim} | Address: ${walkInAddressTrim}`;
    } else {
      const trimmed = checkoutDeliveryNotes.trim();
      notesToStore = trimmed || null;
    }

    // If cart items are custom, create matching `products` rows first,
    // then use the newly generated UUIDs in the RPC payload.
    const customItems = cart.filter((x) => x.productId.startsWith("custom_"));
    const productIdMap = new Map<string, string>();

    if (customItems.length > 0) {
      const { data, error } = await supabase
        .from("products")
        .insert(
          customItems.map((x) => ({
            name: x.name,
            category: "Custom",
            status: "Active",
          })),
        )
        .select("id");

      if (error) {
        setSubmitErrorMsg(error.message);
        return;
      }

      const inserted = data ?? [];
      customItems.forEach((item, idx) => {
        const realId = inserted[idx]?.id;
        if (typeof realId === "string") {
          productIdMap.set(item.productId, realId);
        }
      });

      const missing = customItems.filter((x) => !productIdMap.get(x.productId));
      if (missing.length > 0) {
        setSubmitErrorMsg("Failed to create custom products (missing IDs).");
        return;
      }
    }

    const createdBy = useWarehouseStore.getState().activeWorker;

    let venueIdForMovements = checkoutVenueId;
    let venueNameForPdf = selectedVenueName;

    if (isWalkInOneOff) {
      const { data: createdVenue, error: walkInVenueErr } = await supabase
        .from("venues")
        .insert({
          name: walkInNameTrim,
          contact_info: `${walkInPhoneTrim} | ${walkInAddressTrim}`,
          entity_type: "Walk-In",
        })
        .select("id,name,entity_type,contact_info")
        .single();

      if (walkInVenueErr) {
        setSubmitErrorMsg(walkInVenueErr.message);
        return;
      }
      if (!createdVenue || typeof createdVenue.id !== "string") {
        setSubmitErrorMsg("Failed to create walk-in customer record.");
        return;
      }

      venueIdForMovements = createdVenue.id;
      venueNameForPdf = String(createdVenue.name ?? walkInNameTrim);
      const et =
        typeof createdVenue.entity_type === "string" && createdVenue.entity_type.trim() !== ""
          ? createdVenue.entity_type.trim()
          : "Walk-In";
      const mergedContact =
        typeof createdVenue.contact_info === "string" && createdVenue.contact_info.trim() !== ""
          ? createdVenue.contact_info.trim()
          : `${walkInPhoneTrim} | ${walkInAddressTrim}`;
      useWarehouseStore.setState((s) => ({
        venues: mergeVenueIntoCatalog(s.venues, {
          id: createdVenue.id,
          name: venueNameForPdf,
          entity_type: et,
          contact_info: mergedContact,
        }),
      }));
    }

    if (editChallanParam) {
      const { error: deleteError } = await supabase
        .from("movements")
        .delete()
        .eq("challan_number", editChallanParam);
      if (deleteError) {
        setSubmitErrorMsg(deleteError.message);
        return;
      }
    }

    const itemsForRpc = cart.map((item) => {
      const isCustom = item.productId.startsWith("custom_");
      const realId = isCustom ? productIdMap.get(item.productId) : item.productId;
      return {
        item_id: realId ?? item.productId,
        qty: transactionMode === "out" ? -Math.abs(item.quantity) : Math.abs(item.quantity),
      };
    });

    const { data: rpcData, error: rpcError } = await supabase.rpc("create_challan_with_movements", {
      p_billing_entity: checkoutBillingEntity,
      p_created_by: createdBy ?? "",
      p_date_key: todayDateKeyLocal(),
      p_existing_challan_number: editChallanParam?.trim() || null,
      p_items: itemsForRpc,
      p_notes: notesToStore ?? "",
      p_venue_id: venueIdForMovements,
      p_mode: transactionMode,
    });

    if (rpcError) {
      setSubmitErrorMsg(`Database Error: ${rpcError.message}`);
      return;
    }

    const challanNumber = parseChallanNumberFromRpc(rpcData);
        if (!challanNumber) {
      setSubmitErrorMsg("Could not read challan number from create_challan_with_movements.");
      return;
    }

    clearCartInSession();
    setCart([]);
    useWarehouseStore.getState().clearSavedCartForActiveWorker();
    useWarehouseStore.getState().clearWalkInDetails();
    useWarehouseStore.getState().resetCheckoutForm();

    if (transactionMode === "out") {
      const cartForPdf = cart.map((item) => ({
        name: item.name,
        quantity: -Math.abs(item.quantity),
      }));
      const printedAt = new Date();
      const venueRow = useWarehouseStore.getState().venues.find((x) => x.id === venueIdForMovements);
      const { phone: pdfClientPhone, address: pdfClientAddress } = splitVenueContactInfo(
        venueRow?.contact_info,
      );
      generateChallanPDF(
        {
          challan_number: challanNumber,
          date: printedAt.toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
          }),
          time: printedAt.toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
          }),
          transaction_type: "OUT",
          notes: notesToStore,
          client_phone: pdfClientPhone || null,
          client_address: pdfClientAddress || null,
        },
        cartForPdf,
        venueNameForPdf,
        checkoutBillingEntity,
      );
      router.push("/");
    } else {
      setCheckoutSuccessNotice("Items Received and Logged");
      window.setTimeout(() => {
        setCheckoutSuccessNotice(null);
        router.push("/");
      }, 2200);
    }
  }

  return (
    <div
      className={[
        "flex h-[100dvh] w-screen flex-col overflow-hidden bg-[#07090B] text-[#F2F5F7] border-t-8",
        themeBorderClass,
      ].join(" ")}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center justify-between gap-4 px-4 pt-4 sm:px-6 sm:pt-6">
          <button
            type="button"
            onClick={() => {
              closeModal();
              const modePart = transactionMode ? `?mode=${transactionMode}` : "";
              const extras: string[] = [];
              if (editChallanParam) {
                extras.push(`edit=${encodeURIComponent(editChallanParam)}`);
              }
              const venueToUse = venueIdParam ?? checkoutVenueId;
              if (venueToUse) {
                extras.push(`venue_id=${encodeURIComponent(venueToUse)}`);
              }
              const extraPart = extras.length
                ? `${modePart ? "&" : "?"}${extras.join("&")}`
                : "";
              router.push(`/picker${modePart}${extraPart}`);
            }}
            className="min-h-[48px] min-w-[48px] rounded-2xl border border-white/15 bg-transparent px-3 py-2 text-white/80 transition hover:bg-white/5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80"
            aria-label="Back to Items"
          >
            <div className="flex items-center gap-2">
              <ArrowLeft size={18} />
              <span className="text-xs font-black tracking-[0.16em] uppercase">BACK TO ITEMS</span>
            </div>
          </button>

          <div className="min-w-0">
            <div className="text-sm font-black tracking-[0.18em] text-white/80 uppercase">
              Venue Checkout
            </div>
            <div className="mt-1 text-xs text-white/60">
              Total units: {totalQty}
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              resetCheckoutForm();
              setCart([]);
              clearCartInSession();
              router.push("/");
            }}
            className="min-h-[48px] min-w-[48px] rounded-2xl border border-white/10 bg-white/5 p-3 text-white/80 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80"
            aria-label="Cancel and return home"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-hidden p-4 lg:flex-row">
          {/* Left: venues + forms (independent scroll) */}
          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto pr-2">
            <div>
              <div className="flex items-center gap-2">
                <MapPin size={16} color="#D7E0E8" />
                <div className="text-xs font-bold uppercase tracking-[0.2em] text-white/70">
                  Select Venue
                </div>
              </div>

              <div className="mt-3 flex items-center gap-3">
                <input
                  value={venueQuery}
                  onChange={(e) => setVenueQuery(e.target.value)}
                  placeholder="Search name, phone, or address…"
                  className="min-h-[48px] w-full flex-1 rounded-2xl border border-white/10 bg-black/20 px-4 text-white placeholder:text-white/40 outline-none focus-visible:ring-4 focus-visible:ring-white/80"
                  aria-label="Search venues by name, phone, or address"
                />
              </div>

              <div className="mt-3 rounded-3xl border border-white/10 bg-white/5 p-3">
                {!isVenueCatalogLoaded ? (
                  <div className="p-6 text-center text-xs font-bold uppercase tracking-[0.2em] text-white/60">
                    Loading venues...
                  </div>
                ) : venues.length === 0 ? (
                  <div className="p-6 text-xs leading-5 text-white/60">
                    No venues found.
                  </div>
                ) : walkInPlaceholderVenue == null && visibleVenues.length === 0 ? (
                  venueQuery.trim() ? (
                    <div className="space-y-3 p-6 text-xs leading-5 text-white/60">
                      <p>No venues match your search.</p>
                      <p className="text-white/45">
                        Clear the search to see all hotels. Search by name, phone, or address to find saved
                        walk-in customers.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3 p-6 text-xs leading-5 text-white/60">
                      <p>No venues available for checkout.</p>
                      <p className="text-white/45">
                        Add a venue named &quot;{WALK_IN_GENERIC_VENUE_NAME}&quot; for one-off sales. Hotels
                        should use entity_type Venue or leave it unset; saved customers use Walk-In (they
                        appear when you search).
                      </p>
                    </div>
                  )
                ) : (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {walkInPlaceholderVenue ? (
                      <button
                        key={walkInPlaceholderVenue.id}
                        type="button"
                        onClick={() => setCheckoutVenueId(walkInPlaceholderVenue.id)}
                        className={[
                          "order-first min-h-[64px] rounded-3xl border px-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80 md:col-span-2",
                          walkInPlaceholderVenue.id === checkoutVenueId
                            ? "border-white/30 bg-white/10"
                            : "border-white/10 bg-white/5 hover:bg-white/10",
                        ].join(" ")}
                        aria-pressed={walkInPlaceholderVenue.id === checkoutVenueId}
                      >
                        <div className="text-sm font-black tracking-wide text-white/90">
                          {WALK_IN_GENERIC_VENUE_NAME}
                        </div>
                        <div className="mt-1 text-[0.65rem] uppercase tracking-[0.22em] text-white/50">
                          New one-off — tap to enter customer details
                        </div>
                      </button>
                    ) : null}
                    {visibleVenues.map((v) => {
                      const active = v.id === checkoutVenueId;
                      const isWalkInEntity = isSavedWalkInCustomerVenue(v);
                      const contactLine = (v.contact_info ?? "").trim();
                      return (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => setCheckoutVenueId(v.id)}
                          className={[
                            "min-h-[64px] rounded-3xl border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80",
                            active
                              ? "border-white/30 bg-white/10"
                              : "border-white/10 bg-white/5 hover:bg-white/10",
                          ].join(" ")}
                          aria-pressed={active}
                        >
                          <div className="flex items-start gap-2">
                            {isWalkInEntity ? (
                              <span
                                className="shrink-0 pt-0.5 text-base leading-none opacity-80"
                                title="Walk-in customer"
                                aria-hidden
                              >
                                👤
                              </span>
                            ) : null}
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-black tracking-wide text-white/90">{v.name}</div>
                              {isWalkInEntity && contactLine ? (
                                <div className="mt-1 line-clamp-2 text-[0.7rem] leading-snug font-medium text-white/45">
                                  {contactLine}
                                </div>
                              ) : null}
                            </div>
                          </div>
                          <div className="mt-2 text-[0.65rem] uppercase tracking-[0.22em] text-white/50">
                            Tap to select
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Billing entity + walk-in / standard notes */}
            {checkoutVenueId ? (
              <div className="flex flex-col gap-4">
              <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
                <div className="text-xs font-bold uppercase tracking-[0.22em] text-white/70">
                  Select billing entity
                </div>
                <div
                  className="mt-4 flex flex-col gap-3"
                  role="radiogroup"
                  aria-label="Select billing entity"
                >
                  {BILLING_OPTIONS.map((opt) => {
                    const active = checkoutBillingEntity === opt;
                    return (
                      <label
                        key={opt}
                        className={[
                          "flex min-h-[52px] cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 transition",
                          active
                            ? "border-white/35 bg-white/10"
                            : "border-white/10 bg-black/25 hover:bg-white/5",
                        ].join(" ")}
                      >
                        <input
                          type="radio"
                          name="billing-entity"
                          value={opt}
                          checked={active}
                          onChange={() => setCheckoutBillingEntity(opt)}
                          className="h-5 w-5 shrink-0 accent-[#2E5BFF]"
                        />
                        <span className="text-sm font-bold text-white/90">{opt}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

            {isWalkInOneOff ? (
              <div className="flex flex-col gap-5 rounded-3xl border border-white/10 bg-white/5 p-5">
                <div className="text-xs font-bold uppercase tracking-[0.22em] text-white/70">
                  Walk-in customer details
                </div>
                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="walk-in-full-name"
                    className="text-xs font-bold uppercase tracking-[0.18em] text-white/55"
                  >
                    Full name <span className="text-amber-200/90">(required)</span>
                  </label>
                  <input
                    id="walk-in-full-name"
                    value={walkInDetails?.name ?? ""}
                    onChange={(e) => patchWalkIn({ name: e.target.value })}
                    placeholder="Customer full name"
                    autoComplete="name"
                    className="min-h-[52px] w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-base text-white placeholder:text-white/40 outline-none focus-visible:border-white/25 focus-visible:ring-4 focus-visible:ring-white/80"
                    aria-required
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="walk-in-phone"
                    className="text-xs font-bold uppercase tracking-[0.18em] text-white/55"
                  >
                    Phone number <span className="text-amber-200/90">(required)</span>
                  </label>
                  <input
                    id="walk-in-phone"
                    type="tel"
                    inputMode="tel"
                    value={walkInDetails?.phone ?? ""}
                    onChange={(e) => patchWalkIn({ phone: e.target.value })}
                    placeholder="Phone number"
                    autoComplete="tel"
                    className="min-h-[52px] w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-base text-white placeholder:text-white/40 outline-none focus-visible:border-white/25 focus-visible:ring-4 focus-visible:ring-white/80"
                    aria-required
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="walk-in-address"
                    className="text-xs font-bold uppercase tracking-[0.18em] text-white/55"
                  >
                    Address <span className="text-amber-200/90">(required)</span>
                  </label>
                  <textarea
                    id="walk-in-address"
                    value={walkInDetails?.address ?? ""}
                    onChange={(e) => patchWalkIn({ address: e.target.value })}
                    placeholder="Street, area, city"
                    autoComplete="street-address"
                    rows={3}
                    className="min-h-[52px] w-full resize-y rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-base text-white placeholder:text-white/40 outline-none focus-visible:border-white/25 focus-visible:ring-4 focus-visible:ring-white/80"
                    aria-required
                  />
                </div>
              </div>
            ) : (
              <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
                <div className="text-xs uppercase tracking-[0.22em] text-white/60">
                  Delivery Notes / Reference (Optional)
                </div>
                <textarea
                  value={checkoutDeliveryNotes}
                  onChange={(e) => setCheckoutDeliveryNotes(e.target.value)}
                  placeholder="Optional delivery notes / reference"
                  className="mt-2 min-h-[48px] w-full resize-none rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-white placeholder:text-white/40 outline-none focus-visible:ring-4 focus-visible:ring-white/80"
                  aria-label="Delivery Notes / Reference (Optional)"
                />
              </div>
            )}
              </div>
            ) : null}
          </div>

          {/* Right: order summary + scrollable lines + pinned checkout */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-white/15 bg-background lg:h-full lg:w-[400px] lg:shrink-0 lg:flex-none">
            <div className="shrink-0 border-b border-white/10 p-4">
              <div className="text-sm font-black tracking-[0.18em] text-white/80 uppercase">
                Order summary
              </div>
              <div className="mt-1 text-xs text-white/55">Review lines before confirming</div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {cart.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-xs leading-5 text-white/60">
                  Cart is empty. Return to Home.
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {cart.map((item) => (
                    <div
                      key={item.productId}
                      className={`rounded-2xl border border-white/10 p-4 ${themeTintBgClass}`}
                    >
                      <div className="text-sm font-black text-white/90">{item.name}</div>
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <span className="text-xs font-black uppercase tracking-[0.2em] text-white/60">
                          Qty
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => openEditQtyModal(item)}
                            className="flex h-[48px] min-w-[88px] shrink-0 items-center justify-center rounded-xl border border-white/10 bg-black/20 px-3 text-white transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80"
                            aria-label={`Edit quantity for ${item.name}`}
                          >
                            <div className="text-lg font-black text-white">
                              {transactionMode === "out" ? "-" : "+"}
                              {item.quantity}
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setCart((prev) => prev.filter((x) => x.productId !== item.productId));
                            }}
                            className="flex h-[48px] w-[48px] shrink-0 items-center justify-center rounded-xl border border-white/10 bg-black/20 text-white/80 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80"
                            aria-label={`Remove ${item.name}`}
                          >
                            <Trash2 size={20} className="shrink-0" aria-hidden />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-auto shrink-0 border-t border-white/10 bg-background/95 p-4">
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-white/60">
                Totals
              </div>
              <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-white/90">
                <span className="font-black">
                  {cart.length} line{cart.length === 1 ? "" : "s"}
                </span>
                <span className="text-white/45">·</span>
                <span className="font-bold text-white/80">{totalQty} total units</span>
              </div>

              {submitErrorMsg ? (
                <div className="mt-3 text-xs leading-5 font-bold text-red-200">{submitErrorMsg}</div>
              ) : null}

              <button
                type="button"
                onClick={confirmTransaction}
                disabled={!canConfirm}
                className={[
                  "mt-4 min-h-[96px] w-full rounded-3xl border-2 border-white/15 px-6 py-4 text-center shadow-[0_20px_60px_rgba(0,0,0,0.55)] transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/40",
                  themeBtnBgClass,
                ].join(" ")}
              >
                <div className="text-[1.05rem] font-black tracking-[0.06em]">
                  CONFIRM TRANSACTION
                </div>
                <div className="mt-1 text-xs font-bold tracking-[0.2em] opacity-80 uppercase">
                  {transactionMode ? (transactionMode === "out" ? "STOCK OUT (NEGATIVE)" : "STOCK IN (POSITIVE)") : "SELECT STOCK MODE"}
                </div>
              </button>
            </div>
          </div>
        </div>

      {/* Quantity Modal Overlay (editing cart item) */}
      {modalOpen && activeCartItem ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Edit quantity"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        >
          <div className="absolute inset-0" onClick={closeModal} aria-hidden />

          <div className="relative z-10 w-full max-w-[560px] rounded-3xl border border-white/15 bg-[#0B0E12] p-4 shadow-[0_40px_120px_rgba(0,0,0,0.75)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-[0.22em] text-white/60">
                  Quantity Entry
                </div>
                <div className="mt-2 text-lg font-black text-white/90">{cartItemName}</div>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="min-h-[48px] min-w-[48px] rounded-2xl border border-white/10 bg-white/5 p-3 text-white/80 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80"
                aria-label="Cancel"
              >
                <X size={20} />
              </button>
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="text-xs uppercase tracking-[0.22em] text-white/60">Typed</div>
              <div className="mt-2 flex items-center justify-between gap-4">
                <div className="text-[2rem] font-black text-white">
                  {typedQty ? typedQty : "—"}
                </div>
                {qtyError ? (
                  <div className="max-w-[180px] rounded-xl border border-red-500/30 bg-red-500/10 p-2 text-xs font-bold text-red-200">
                    {qtyError}
                  </div>
                ) : (
                  <div className="max-w-[180px] text-xs font-bold leading-4 text-white/60">
                    Type quantity with keypad, then press Enter.
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => appendDigit(d)}
                  className="min-h-[64px] min-w-[64px] rounded-3xl border border-white/10 bg-white/5 text-[2rem] font-black text-white/90 shadow-[0_14px_40px_rgba(0,0,0,0.35)] transition hover:bg-white/10 active:bg-white/15 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80"
                  aria-label={`Digit ${d}`}
                >
                  {d}
                </button>
              ))}

              <button
                type="button"
                onClick={clearDigits}
                className="min-h-[64px] min-w-[64px] rounded-3xl border border-white/10 bg-white/5 px-2 text-xs font-black uppercase tracking-[0.22em] text-white/80 transition hover:bg-white/10 active:bg-white/15 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80"
                aria-label="Clear quantity"
              >
                CLEAR
              </button>

              <button
                type="button"
                onClick={() => appendDigit("0")}
                className="min-h-[64px] min-w-[64px] rounded-3xl border border-white/10 bg-white/5 text-[2rem] font-black text-white/90 shadow-[0_14px_40px_rgba(0,0,0,0.35)] transition hover:bg-white/10 active:bg-white/15 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80"
                aria-label="Digit 0"
              >
                0
              </button>

              <button
                type="button"
                onClick={confirmQty}
                disabled={!typedQty}
                className="min-h-[64px] min-w-[64px] rounded-3xl border-2 border-white/20 bg-[#2E5BFF] px-2 text-xs font-black uppercase tracking-[0.22em] text-white transition hover:bg-[#3A6DFF] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/40"
                aria-label="Enter quantity"
              >
                ENTER
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {checkoutSuccessNotice ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-6"
        >
          <div className="max-w-md rounded-3xl border-2 border-green-500/40 bg-[#0B0E12] px-8 py-10 text-center shadow-[0_24px_80px_rgba(0,0,0,0.6)]">
            <p className="text-lg font-black tracking-wide text-green-300">{checkoutSuccessNotice}</p>
          </div>
        </div>
      ) : null}
      </div>
    </div>
  );
}

