import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import {
  clearCartInSession,
  loadCartFromSession,
  saveCartToSession,
  type CartItem,
} from "@/lib/kioskStorage";
import { supabase } from "@/lib/supabase";

export type WarehouseProduct = {
  id: string;
  name: string;
  category: string;
  status?: string | null;
  image_url?: string | null;
};

export type WarehouseVenue = {
  id: string;
  name: string;
  entity_type?: string;
  /** Phone / address (e.g. walk-in customers); used for venue checkout search. */
  contact_info?: string | null;
};

export type WarehouseStaff = {
  id: string;
  name: string;
  pin: string;
};

export type WalkInDetails = {
  name: string;
  phone: string;
  address: string;
};

/** Default billing label; keep in sync with venue checkout options. */
export const DEFAULT_CHECKOUT_BILLING_ENTITY = "Entity 1";

type RealtimeRowPayload = {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: Record<string, unknown>;
  old: Record<string, unknown>;
};

function cloneCart(items: CartItem[]): CartItem[] {
  return items.map((c) => ({
    productId: c.productId,
    name: c.name,
    quantity: c.quantity,
    ...(typeof c.isCustom === "boolean" ? { isCustom: c.isCustom } : {}),
  }));
}

/** Matches `app/venue` walk-in `notesToStore` format. */
function parseMovementNotesForCheckout(notes: string): {
  walkIn: WalkInDetails | null;
  deliveryNotes: string;
} {
  const trimmed = notes.trim();
  if (!trimmed) return { walkIn: null, deliveryNotes: "" };
  const m = trimmed.match(/^Name:\s*(.+?)\s*\|\s*Phone:\s*(.+?)\s*\|\s*Address:\s*([\s\S]+)$/i);
  if (m) {
    return {
      walkIn: {
        name: m[1].trim(),
        phone: m[2].trim(),
        address: m[3].trim(),
      },
      deliveryNotes: "",
    };
  }
  return { walkIn: null, deliveryNotes: trimmed };
}

function inferPickerModeFromMovementQuantities(
  rows: { quantity: number }[],
  hint: "IN" | "OUT" | "MIXED",
): "in" | "out" {
  if (rows.length === 0) return hint === "IN" ? "in" : "out";
  const allIn = rows.every((r) => Number(r.quantity) > 0);
  const allOut = rows.every((r) => Number(r.quantity) < 0);
  if (allIn) return "in";
  if (allOut) return "out";
  if (hint === "IN") return "in";
  if (hint === "OUT") return "out";
  return "out";
}

export type PrepareEditChallanResult =
  | { ok: true; mode: "in" | "out" }
  | { ok: false; error: string };

function parseProductRow(row: unknown): WarehouseProduct | null {
  if (!row || typeof row !== "object") return null;
  const o = row as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.name !== "string" || typeof o.category !== "string") {
    return null;
  }
  const status = o.status;
  const rawUrl = o.image_url;
  const image_url =
    typeof rawUrl === "string" && rawUrl.trim() !== "" ? rawUrl.trim() : null;

  return {
    id: o.id,
    name: o.name,
    category: o.category,
    status:
      status === null || status === undefined
        ? null
        : typeof status === "string"
          ? status
          : String(status),
    image_url,
  };
}

function parseVenueRow(row: unknown): WarehouseVenue | null {
  if (!row || typeof row !== "object") return null;
  const o = row as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.name !== "string") return null;
  const et = o.entity_type;
  const entity_type =
    et === null || et === undefined
      ? undefined
      : typeof et === "string" && et.trim() !== ""
        ? et.trim()
        : undefined;
  const rawCi = o.contact_info;
  const contactStr =
    rawCi === null || rawCi === undefined
      ? ""
      : typeof rawCi === "string"
        ? rawCi.trim()
        : String(rawCi).trim();
  const contact_info = contactStr !== "" ? contactStr : undefined;
  return {
    id: o.id,
    name: o.name,
    ...(entity_type ? { entity_type } : {}),
    ...(contact_info !== undefined ? { contact_info } : {}),
  };
}

function parseStaffRow(row: unknown): WarehouseStaff | null {
  if (!row || typeof row !== "object") return null;
  const o = row as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.name !== "string") return null;
  const pinRaw = o.pin;
  const pin =
    pinRaw === null || pinRaw === undefined ? "" : typeof pinRaw === "string" ? pinRaw : String(pinRaw);
  return { id: o.id, name: o.name, pin };
}

function sortProductsByName(list: WarehouseProduct[]): WarehouseProduct[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name));
}

function sortVenuesByName(list: WarehouseVenue[]): WarehouseVenue[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name));
}

/** Upsert a venue row into the in-memory catalog (e.g. after creating a walk-in customer). */
export function mergeVenueIntoCatalog(
  venues: WarehouseVenue[],
  venue: WarehouseVenue,
): WarehouseVenue[] {
  const without = venues.filter((v) => v.id !== venue.id);
  return sortVenuesByName([...without, venue]);
}

function mergeProductsAfterRealtime(
  products: WarehouseProduct[],
  eventType: "INSERT" | "UPDATE" | "DELETE",
  newRow: Record<string, unknown> | null,
  oldRow: Record<string, unknown> | null,
): WarehouseProduct[] {
  if (eventType === "DELETE") {
    const id = oldRow && typeof oldRow.id === "string" ? oldRow.id : null;
    return id ? products.filter((p) => p.id !== id) : products;
  }

  const parsed = newRow ? parseProductRow(newRow) : null;
  if (!parsed) return products;

  const shouldInclude = parsed.status === "Active";
  if (!shouldInclude) {
    return products.filter((p) => p.id !== parsed.id);
  }

  const without = products.filter((p) => p.id !== parsed.id);
  return sortProductsByName([...without, parsed]);
}

function mergeVenuesAfterRealtime(
  venues: WarehouseVenue[],
  eventType: "INSERT" | "UPDATE" | "DELETE",
  newRow: Record<string, unknown> | null,
  oldRow: Record<string, unknown> | null,
): WarehouseVenue[] {
  if (eventType === "DELETE") {
    const id = oldRow && typeof oldRow.id === "string" ? oldRow.id : null;
    return id ? venues.filter((v) => v.id !== id) : venues;
  }

  const parsed = newRow ? parseVenueRow(newRow) : null;
  if (!parsed) return venues;

  const without = venues.filter((v) => v.id !== parsed.id);
  return sortVenuesByName([...without, parsed]);
}

function isRealtimeRowPayload(x: unknown): x is RealtimeRowPayload {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  const et = o.eventType;
  return et === "INSERT" || et === "UPDATE" || et === "DELETE";
}

type WarehouseState = {
  products: WarehouseProduct[];
  venues: WarehouseVenue[];
  staff: WarehouseStaff[];
  isLoaded: boolean;
  activeWorker: string | null;
  savedCarts: Record<string, CartItem[]>;
  walkInDetails: WalkInDetails | null;
  checkoutVenueId: string;
  checkoutBillingEntity: string;
  checkoutDeliveryNotes: string;
  fetchInitialData: () => Promise<void>;
  subscribeToChanges: () => () => void;
  loginWorker: (workerName: string, pin: string) => boolean;
  logoutWorker: () => void;
  persistCartForActiveWorker: () => void;
  clearSavedCartForActiveWorker: () => void;
  setWalkInDetails: (details: WalkInDetails) => void;
  clearWalkInDetails: () => void;
  setCheckoutVenueId: (venueId: string) => void;
  setCheckoutBillingEntity: (entity: string) => void;
  setCheckoutDeliveryNotes: (notes: string) => void;
  resetCheckoutForm: () => void;
  /** Load challan lines into session cart + checkout fields; call before `router.push` to picker. */
  prepareEditChallanForPicker: (
    challanNumber: string,
    txTypeHint?: "IN" | "OUT" | "MIXED",
  ) => Promise<PrepareEditChallanResult>;
};

type WarehousePersisted = Pick<WarehouseState, "activeWorker" | "savedCarts">;

const PERSIST_KEY = "kiosk-warehouse-v1";

const persistStorage = createJSONStorage<WarehousePersisted>(() => {
  if (typeof window === "undefined") {
    return {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    };
  }
  return window.localStorage;
});

export const useWarehouseStore = create<WarehouseState>()(
  persist(
    (set, get) => ({
      products: [],
      venues: [],
      staff: [],
      isLoaded: false,
      activeWorker: null,
      savedCarts: {},
      walkInDetails: null,
      checkoutVenueId: "",
      checkoutBillingEntity: DEFAULT_CHECKOUT_BILLING_ENTITY,
      checkoutDeliveryNotes: "",

      setWalkInDetails: (details) => {
        set({
          walkInDetails: {
            name: details.name,
            phone: details.phone,
            address: details.address,
          },
        });
      },

      clearWalkInDetails: () => {
        set({ walkInDetails: null });
      },

      setCheckoutVenueId: (venueId) => {
        set({ checkoutVenueId: venueId });
      },

      setCheckoutBillingEntity: (entity) => {
        set({ checkoutBillingEntity: entity });
      },

      setCheckoutDeliveryNotes: (notes) => {
        set({ checkoutDeliveryNotes: notes });
      },

      resetCheckoutForm: () => {
        set({
          walkInDetails: null,
          checkoutVenueId: "",
          checkoutBillingEntity: DEFAULT_CHECKOUT_BILLING_ENTITY,
          checkoutDeliveryNotes: "",
        });
      },

      prepareEditChallanForPicker: async (challanNumber, txTypeHint = "MIXED") => {
        const trimmed = challanNumber.trim();
        if (!trimmed) {
          return { ok: false, error: "Missing challan number." };
        }

        const { data, error } = await supabase
          .from("movements")
          .select("product_id,quantity,venue_id,notes,billing_entity")
          .eq("challan_number", trimmed);

        if (error) {
          return { ok: false, error: error.message };
        }

        const rows = (data ?? []) as {
          product_id: string;
          quantity: number;
          venue_id: string;
          notes: string | null;
          billing_entity: string | null;
        }[];

        if (rows.length === 0) {
          return { ok: false, error: "No movement rows found for this challan." };
        }

        const venueId = String(rows[0]?.venue_id ?? "").trim();
        if (!venueId) {
          return { ok: false, error: "Challan is missing venue_id." };
        }

        const productIds = [...new Set(rows.map((r) => r.product_id))].filter(Boolean);
        const { data: productsData, error: prodErr } = await supabase
          .from("products")
          .select("id,name,category")
          .in("id", productIds);

        if (prodErr) {
          return { ok: false, error: prodErr.message };
        }

        const productMap = new Map<string, { name: string; category: string }>();
        (productsData ?? []).forEach((p: { id: string; name: string; category: string }) => {
          productMap.set(String(p.id), { name: p.name, category: p.category });
        });

        const cartItems: CartItem[] = rows
          .map((r) => {
            const meta = productMap.get(String(r.product_id));
            const q = Math.abs(Number(r.quantity));
            const qty = Number.isFinite(q) && q > 0 ? Math.floor(q) : 0;
            const isCustom = meta?.category === "Custom";
            return {
              productId: r.product_id,
              name: meta?.name ?? String(r.product_id),
              quantity: qty,
              ...(isCustom ? { isCustom: true as const } : {}),
            };
          })
          .filter((c) => c.quantity > 0);

        if (cartItems.length === 0) {
          return { ok: false, error: "Could not build a cart from this challan (no valid quantities)." };
        }

        const noteRow = rows.find((r) => r.notes != null && String(r.notes).trim() !== "");
        const notesRaw = noteRow?.notes != null ? String(noteRow.notes).trim() : "";
        const { walkIn, deliveryNotes } = parseMovementNotesForCheckout(notesRaw);

        const billRow = rows.find(
          (r) => r.billing_entity != null && String(r.billing_entity).trim() !== "",
        );
        const billing =
          billRow?.billing_entity != null && String(billRow.billing_entity).trim() !== ""
            ? String(billRow.billing_entity).trim()
            : DEFAULT_CHECKOUT_BILLING_ENTITY;

        const mode = inferPickerModeFromMovementQuantities(rows, txTypeHint);

        saveCartToSession(cloneCart(cartItems));
        set({
          checkoutVenueId: venueId,
          checkoutBillingEntity: billing,
          walkInDetails: walkIn,
          checkoutDeliveryNotes: walkIn ? "" : deliveryNotes,
        });

        return { ok: true, mode };
      },

      fetchInitialData: async () => {
        const [productsRes, venuesRes, staffRes] = await Promise.all([
          supabase.from("products").select("id,name,category,status,image_url").eq("status", "Active"),
          supabase.from("venues").select("id,name,entity_type,contact_info").order("name"),
          supabase.from("staff").select("id,name,pin").order("name"),
        ]);

        const rawProducts = productsRes.data ?? [];
        const products = sortProductsByName(
          (Array.isArray(rawProducts) ? rawProducts : [])
            .map(parseProductRow)
            .filter((p): p is WarehouseProduct => p !== null && p.status === "Active"),
        );

        const rawVenues = venuesRes.data ?? [];
        const venues = sortVenuesByName(
          (Array.isArray(rawVenues) ? rawVenues : [])
            .map(parseVenueRow)
            .filter((v): v is WarehouseVenue => v !== null),
        );

        const rawStaff = staffRes.error ? [] : (staffRes.data ?? []);
        const staff = (Array.isArray(rawStaff) ? rawStaff : [])
          .map(parseStaffRow)
          .filter((s): s is WarehouseStaff => s !== null);

        set((state) => ({
          ...state,
          products,
          venues,
          staff,
          isLoaded: true,
        }));
      },

      loginWorker: (workerName: string, pin: string) => {
        const name = workerName.trim();
        const pinTrim = pin.trim();
        if (!name || !pinTrim) return false;

        const match = get().staff.find(
          (s) => s.name === name && String(s.pin).trim() === pinTrim,
        );
        if (!match) return false;

        const saved = get().savedCarts[name] ?? [];
        saveCartToSession(cloneCart(saved));
        set({ activeWorker: name });
        return true;
      },

      logoutWorker: () => {
        const w = get().activeWorker;
        if (w) {
          const current = loadCartFromSession();
          set((s) => ({
            activeWorker: null,
            savedCarts: { ...s.savedCarts, [w]: cloneCart(current) },
          }));
        } else {
          set({ activeWorker: null });
        }
        clearCartInSession();
      },

      persistCartForActiveWorker: () => {
        const w = get().activeWorker;
        if (!w) return;
        const current = loadCartFromSession();
        set((s) => ({
          savedCarts: { ...s.savedCarts, [w]: cloneCart(current) },
        }));
      },

      clearSavedCartForActiveWorker: () => {
        const w = get().activeWorker;
        if (!w) return;
        set((s) => ({
          savedCarts: { ...s.savedCarts, [w]: [] },
        }));
      },

      subscribeToChanges: () => {
        const onProducts = (payload: unknown) => {
          if (!isRealtimeRowPayload(payload)) return;
          set((state) => ({
            products: mergeProductsAfterRealtime(
              state.products,
              payload.eventType,
              payload.new,
              payload.old,
            ),
          }));
        };

        const onVenues = (payload: unknown) => {
          if (!isRealtimeRowPayload(payload)) return;
          set((state) => ({
            venues: mergeVenuesAfterRealtime(
              state.venues,
              payload.eventType,
              payload.new,
              payload.old,
            ),
          }));
        };

        const channel = supabase
          .channel("public-db-changes")
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "products" },
            onProducts,
          )
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "venues" },
            onVenues,
          );

        channel.subscribe();

        return () => {
          void supabase.removeChannel(channel);
        };
      },
    }),
    {
      name: PERSIST_KEY,
      storage: persistStorage,
      partialize: (state): WarehousePersisted => ({
        activeWorker: state.activeWorker,
        savedCarts: state.savedCarts,
      }),
      onRehydrateStorage: () => (state, error) => {
        if (error || !state?.activeWorker) return;
        queueMicrotask(() => {
          if (typeof window === "undefined") return;
          if (loadCartFromSession().length > 0) return;
          const saved = state.savedCarts[state.activeWorker!];
          if (saved?.length) saveCartToSession(cloneCart(saved));
        });
      },
    },
  ),
);
