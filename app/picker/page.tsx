"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Box, LogOut, Package, ShoppingCart, Trash2, X } from "lucide-react";

import {
  CartItem,
  clearCartInSession,
  loadCartFromSession,
  saveCartToSession,
  type TransactionMode,
} from "@/lib/kioskStorage";
import { useWarehouseStore, type WarehouseProduct } from "@/lib/store";
import { useInactivityReset } from "@/lib/useInactivityReset";

function ProductCardVisual({
  imageUrl,
  productName,
}: {
  imageUrl?: string | null;
  productName: string;
}) {
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    queueMicrotask(() => setBroken(false));
  }, [imageUrl]);

  const trimmed = (imageUrl ?? "").trim();
  const showImage = trimmed.length > 0 && !broken;

  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/10 via-white/5 to-transparent">
      {showImage ? (
        <Image
          src={trimmed}
          alt={productName}
          fill
          className="object-cover"
          sizes="(max-width: 768px) 100vw, 33vw"
          onError={() => setBroken(true)}
        />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/20">
          <Package size={28} color="#D7E0E8" className="opacity-90" aria-hidden />
          <span className="text-center text-[0.65rem] font-black uppercase tracking-[0.2em] text-white/55">
            📦 No Image
          </span>
        </div>
      )}
    </div>
  );
}

export default function PickerPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-[100dvh] w-screen items-center justify-center overflow-hidden bg-[#07090B] text-white/60">
          Loading...
        </div>
      }
    >
      <PickerClient />
    </Suspense>
  );
}

function PickerClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const modeParam = searchParams.get("mode");
  const transactionMode: TransactionMode | null =
    modeParam === "out" || modeParam === "in" ? modeParam : null;

  const editChallanParam =
    searchParams.get("edit") ?? searchParams.get("challan_number");
  const venueIdParam = searchParams.get("venue_id");

  const editQs = editChallanParam ? `&edit=${encodeURIComponent(editChallanParam)}` : "";
  const venueQs = venueIdParam ? `&venue_id=${encodeURIComponent(venueIdParam)}` : "";
  const editVenueQs = `${editQs}${venueQs}`;

  const products = useWarehouseStore((s) => s.products);
  const isCatalogLoaded = useWarehouseStore((s) => s.isLoaded);
  const activeWorker = useWarehouseStore((s) => s.activeWorker);
  const logoutWorker = useWarehouseStore((s) => s.logoutWorker);

  const categories = useMemo(() => {
    const unique = new Set<string>();
    for (const p of products) {
      if (p.category) unique.add(p.category);
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [products]);

  // Must remain in React state so the UI can highlight + filter.
  const [selectedCategory, setSelectedCategory] = useState<string>("");

  const [cart, setCart] = useState<CartItem[]>(() => loadCartFromSession());

  const [transactionType, setTransactionType] = useState<TransactionMode>(
    transactionMode ?? "out",
  );

  const [pendingTransactionType, setPendingTransactionType] = useState<TransactionMode | null>(null);
  const [switchConfirmOpen, setSwitchConfirmOpen] = useState(false);

  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

  const isStockOut = transactionType === "out";
  const themeBorderColorClass = isStockOut ? "border-yellow-500" : "border-green-500";
  const themeTintBgClass = isStockOut ? "bg-yellow-500/5" : "bg-green-500/5";
  const themeBtnBgClass = isStockOut ? "bg-yellow-500" : "bg-green-500";
  const themeBtnHoverClass = isStockOut ? "hover:bg-yellow-600" : "hover:bg-green-600";
  const themeBtnTextClass = "text-black";

  // Persist cart across routes (picker -> venue) and across refreshes.
  useEffect(() => {
    saveCartToSession(cart);
  }, [cart]);

  useEffect(() => {
    if (!isCatalogLoaded) {
      void useWarehouseStore.getState().fetchInitialData();
    }
  }, [isCatalogLoaded]);

  useEffect(() => {
    if (!isCatalogLoaded) return;
    if (activeWorker == null) {
      router.replace("/");
    }
  }, [isCatalogLoaded, activeWorker, router]);

  useEffect(() => {
    if (categories.length === 0) return;
    if (!selectedCategory || !categories.includes(selectedCategory)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedCategory(categories[0]);
    }
  }, [categories, selectedCategory]);

  const [modalOpen, setModalOpen] = useState(false);
  const [activeProduct, setActiveProduct] = useState<WarehouseProduct | null>(null);
  const [activeCartItem, setActiveCartItem] = useState<CartItem | null>(null);
  const [typedQty, setTypedQty] = useState("");
  const [qtyError, setQtyError] = useState<string | null>(null);

  const [customItemModalOpen, setCustomItemModalOpen] = useState(false);
  const [customItemName, setCustomItemName] = useState("");
  const [customTypedQty, setCustomTypedQty] = useState("");
  const [customQtyError, setCustomQtyError] = useState<string | null>(null);

  useInactivityReset({
    timeoutMs: 150_000,
    onReset: useCallback(() => {
      useWarehouseStore.getState().persistCartForActiveWorker();
      setCart([]);
      clearCartInSession();
      setModalOpen(false);
      setActiveProduct(null);
      setActiveCartItem(null);
      setTypedQty("");
      setQtyError(null);
      setCustomItemModalOpen(false);
      setCustomItemName("");
      setCustomTypedQty("");
      setCustomQtyError(null);
      router.push("/");
    }, [router]),
  });

  const modalTargetName = activeProduct?.name ?? activeCartItem?.name ?? "";

  const totalQty = useMemo(() => cart.reduce((sum, item) => sum + item.quantity, 0), [cart]);

  const filteredProducts = useMemo(
    () => products.filter((p) => p.category === selectedCategory),
    [products, selectedCategory],
  );

  const proceedDisabled = cart.length === 0;

  function requestTransactionSwitch(next: TransactionMode) {
    if (next === transactionType) return;

    if (cart.length > 0) {
      setPendingTransactionType(next);
      setSwitchConfirmOpen(true);
      return;
    }

    setTransactionType(next);
    router.replace(`/picker?mode=${next}${editVenueQs}`);
  }

  function confirmTransactionSwitch() {
    const next = pendingTransactionType;
    if (!next) return;
    setTransactionType(next);
    setPendingTransactionType(null);
    setSwitchConfirmOpen(false);
    router.replace(`/picker?mode=${next}${editVenueQs}`);
  }

  function cancelTransactionSwitch() {
    setPendingTransactionType(null);
    setSwitchConfirmOpen(false);
  }

  function openQtyModal(product: WarehouseProduct) {
    setActiveProduct(product);
    setActiveCartItem(null);
    setTypedQty("");
    setQtyError(null);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setActiveProduct(null);
    setActiveCartItem(null);
    setTypedQty("");
    setQtyError(null);
  }

  function openEditQtyModal(item: CartItem) {
    setActiveCartItem(item);
    setActiveProduct(null);
    setTypedQty(String(item.quantity));
    setQtyError(null);
    setModalOpen(true);
  }

  function appendDigit(digit: string) {
    if (!modalOpen) return;
    // Keep quantity human-scale for the kiosk UI.
    if (typedQty.length >= 3) return;
    setTypedQty((prev) => `${prev}${digit}`);
    setQtyError(null);
  }

  function clearDigits() {
    setTypedQty("");
    setQtyError(null);
  }

  function confirmQty() {
    if (!typedQty) {
      setQtyError("Type quantity first.");
      return;
    }

    const qty = Number.parseInt(typedQty, 10);
    if (!Number.isFinite(qty) || qty < 1) {
      setQtyError("Quantity must be at least 1.");
      return;
    }

    if (activeProduct) {
      setCart((prev) => {
        const idx = prev.findIndex((x) => x.productId === activeProduct.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], quantity: next[idx].quantity + qty };
          return next;
        }
        return [
          ...prev,
          { productId: activeProduct.id, name: activeProduct.name, quantity: qty },
        ];
      });
    } else if (activeCartItem) {
      setCart((prev) =>
        prev.map((x) =>
          x.productId === activeCartItem.productId
            ? { ...x, quantity: qty }
            : x,
        ),
      );
    }

    closeModal();
  }

  function openCustomItemModal() {
    setCustomItemModalOpen(true);
    setCustomItemName("");
    setCustomTypedQty("");
    setCustomQtyError(null);
  }

  function closeCustomItemModal() {
    setCustomItemModalOpen(false);
    setCustomItemName("");
    setCustomTypedQty("");
    setCustomQtyError(null);
  }

  function appendCustomDigit(digit: string) {
    if (!customItemModalOpen) return;
    if (customTypedQty.length >= 3) return;
    setCustomTypedQty((prev) => `${prev}${digit}`);
    setCustomQtyError(null);
  }

  function clearCustomDigits() {
    setCustomTypedQty("");
    setCustomQtyError(null);
  }

  const handleLogout = useCallback(() => {
    saveCartToSession(cart);
    logoutWorker();
    setCart([]);
    closeModal();
    closeCustomItemModal();
    setClearConfirmOpen(false);
    setSwitchConfirmOpen(false);
    setPendingTransactionType(null);
    router.push("/");
  }, [cart, logoutWorker, router]);

  function confirmCustomItem() {
    const trimmedName = customItemName.trim();
    if (!trimmedName) {
      setCustomQtyError("Item name is required.");
      return;
    }

    if (!customTypedQty) {
      setCustomQtyError("Type quantity first.");
      return;
    }

    const qty = Number.parseInt(customTypedQty, 10);
    if (!Number.isFinite(qty) || qty < 1) {
      setCustomQtyError("Quantity must be at least 1.");
      return;
    }

    const tempId = `custom_${Date.now()}_${Math.random().toString(16).slice(2)}`;

    setCart((prev) => [
      ...prev,
      { productId: tempId, name: trimmedName, quantity: qty, isCustom: true },
    ]);

    closeCustomItemModal();
  }

  return (
    <div
      className={[
        "flex h-[100dvh] w-screen flex-col overflow-hidden bg-[#07090B] text-[#F2F5F7] border-t-8",
        themeBorderColorClass,
      ].join(" ")}
    >
      <div
        className={[
          "grid min-h-0 flex-1 w-full grid-cols-[20%_50%_30%] grid-rows-[auto_1fr]",
        ].join(" ")}
      >
      {/* Transaction Toggle (Top) + Logout */}
      <div className="col-span-3 row-start-1 flex flex-wrap items-center justify-between gap-3 px-4 py-5">
        <button
          type="button"
          onClick={handleLogout}
          className="flex min-h-[52px] min-w-[52px] items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-4 text-xs font-black uppercase tracking-[0.12em] text-white/85 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80"
          aria-label="Log out worker"
        >
          <LogOut size={18} className="shrink-0 opacity-90" aria-hidden />
          <span className="hidden sm:inline">Logout</span>
        </button>
        <div className="min-w-0 flex-1 basis-[min(100%,320px)] sm:basis-[560px]">
          <div className="relative mx-auto w-full max-w-[560px] rounded-3xl border border-white/10 bg-white/5 p-2">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => requestTransactionSwitch("out")}
                className={[
                  "min-h-[72px] rounded-2xl border px-4 text-center transition",
                  isStockOut
                    ? `border-yellow-500/40 ${themeBtnBgClass} ${themeBtnTextClass} shadow-[0_14px_40px_rgba(0,0,0,0.35)]`
                    : "border-white/10 bg-white/5 text-white/90 hover:bg-white/10",
                ].join(" ")}
                aria-pressed={isStockOut}
              >
                <div className="text-[1.35rem] font-black tracking-[0.18em] uppercase">
                  STOCK OUT
                </div>
              </button>
              <button
                type="button"
                onClick={() => requestTransactionSwitch("in")}
                className={[
                  "min-h-[72px] rounded-2xl border px-4 text-center transition",
                  !isStockOut
                    ? `border-green-500/40 ${themeBtnBgClass} ${themeBtnTextClass} shadow-[0_14px_40px_rgba(0,0,0,0.35)]`
                    : "border-white/10 bg-white/5 text-white/90 hover:bg-white/10",
                ].join(" ")}
                aria-pressed={!isStockOut}
              >
                <div className="text-[1.35rem] font-black tracking-[0.18em] uppercase">
                  STOCK IN
                </div>
              </button>
            </div>
          </div>
        </div>
        <div
          className="hidden w-[52px] shrink-0 sm:block sm:w-[120px]"
          aria-hidden
        />
      </div>

      {/* Left Sidebar */}
      <aside className="row-start-2 col-start-1 flex h-full min-h-0 flex-col overflow-hidden border-r border-white/10 p-4">
        <div className="flex shrink-0 items-center gap-2">
          <Box size={18} color="#D7E0E8" />
          <div className="text-sm font-black tracking-[0.18em] text-white/80 uppercase">
            Categories
          </div>
        </div>
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-3">
            {!isCatalogLoaded ? (
              <div className="text-xs leading-5 text-white/60">
                Loading active categories...
              </div>
            ) : categories.length === 0 ? (
              <div className="text-xs leading-5 text-white/60">
                No active products found.
              </div>
            ) : (
              categories.map((cat) => {
                const active = cat === selectedCategory;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    className={[
                      "min-h-[48px] w-full rounded-2xl border px-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80",
                      active
                        ? "border-white/30 bg-white/10"
                        : "border-white/10 bg-white/5 hover:bg-white/10",
                    ].join(" ")}
                    aria-pressed={active}
                  >
                    <div className="text-[0.95rem] font-black tracking-wide">{cat}</div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="mt-4 shrink-0">
          <button
            type="button"
            onClick={openCustomItemModal}
            className="min-h-[56px] w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-center text-[0.95rem] font-black tracking-wide text-white/90 transition hover:bg-white/10 active:bg-white/15 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80"
            aria-label="Custom Item"
          >
            ➕ Custom Item
          </button>
        </div>

        <div className="mt-4 shrink-0 rounded-2xl border border-white/10 bg-white/5 p-3">
          <div className="text-xs uppercase tracking-[0.2em] text-white/60">Selected</div>
          <div className="mt-2 text-sm font-bold text-white">{selectedCategory}</div>
          <div className="mt-2 text-xs leading-5 text-white/60">
            Tap a product card to enter quantity.
          </div>
        </div>
      </aside>

      {/* Center Grid */}
      <main className="row-start-2 col-start-2 flex h-full min-h-0 flex-col overflow-hidden border-r border-white/10 p-4">
        <div className="flex shrink-0 items-center justify-between">
          <div>
            <div className="text-sm font-black tracking-[0.18em] text-white/80 uppercase">
              Picking Screen
            </div>
            <div className="mt-1 text-xs text-white/60">
              Tap a product, type quantity, press Enter.
            </div>
          </div>
          <div className="hidden items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 md:flex">
            <ShoppingCart size={16} color="#D7E0E8" />
            <div className="text-xs font-bold text-white/90">
              Cart: {cart.length} item{cart.length === 1 ? "" : "s"}
            </div>
          </div>
        </div>

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="grid grid-cols-3 gap-4">
            {!isCatalogLoaded ? (
              <div className="col-span-3 rounded-3xl border border-white/10 bg-white/5 p-6 text-center text-xs font-bold uppercase tracking-[0.2em] text-white/60">
                Loading products...
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="col-span-3 rounded-3xl border border-white/10 bg-white/5 p-6 text-center text-xs font-bold uppercase tracking-[0.2em] text-white/60">
                No active products in this category
              </div>
            ) : (
              filteredProducts.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => openQtyModal(product)}
                  className="group min-h-[160px] rounded-3xl border-2 border-white/10 bg-white/5 p-3 text-left shadow-[0_10px_30px_rgba(0,0,0,0.35)] transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80"
                  aria-label={`Add ${product.name}`}
                >
                  <div className="flex h-full flex-col">
                    <ProductCardVisual imageUrl={product.image_url} productName={product.name} />
                    <div className="mt-3 text-center text-[0.95rem] font-black tracking-tight text-white/90">
                      {product.name}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </main>

      {/* Right Sidebar / Live Cart */}
      <aside
        className={`row-start-2 col-start-3 flex h-full min-h-0 flex-col overflow-hidden p-4 ${themeTintBgClass}`}
      >
        <div className="flex shrink-0 items-center justify-between">
          <div>
            <div className="text-sm font-black tracking-[0.18em] text-white/80 uppercase">
              Live Cart
            </div>
            <div className="mt-1 text-xs text-white/60">
              Total units: {totalQty}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setClearConfirmOpen(true)}
            className="min-h-[48px] min-w-[140px] rounded-2xl border border-white/15 bg-white/5 px-3 text-[0.95rem] font-black tracking-wide text-white/90 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80"
            aria-label="Clear Cart"
          >
            🗑️ Clear Cart
          </button>
        </div>

        <div className="mt-4 flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {cart.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-sm font-black tracking-wide text-white/90">No items yet</div>
                <div className="mt-2 text-xs leading-5 text-white/60">
                  Tap a product card, then enter the quantity.
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {cart.map((item) => (
                  <div
                    key={item.productId}
                    className="rounded-2xl border border-white/10 bg-white/5 p-4"
                  >
                    <div className="truncate text-sm font-black text-white/90">{item.name}</div>
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
                          <div className="text-lg font-black">{item.quantity}</div>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setCart((prev) => prev.filter((x) => x.productId !== item.productId));
                            if (activeCartItem?.productId === item.productId) closeModal();
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

          <div className="mt-auto shrink-0 pt-4">
            <button
              type="button"
              onClick={() => {
                // Close any modals to avoid UI artifacts during navigation.
                closeModal();
                closeCustomItemModal();
                router.push(`/venue?mode=${transactionType}${editVenueQs}`);
              }}
              disabled={proceedDisabled}
              className={[
                "min-h-[88px] w-full rounded-3xl border-2 border-white/15 px-6 py-4 text-center shadow-[0_20px_60px_rgba(0,0,0,0.55)] transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/40",
                themeBtnBgClass,
                themeBtnHoverClass,
                themeBtnTextClass,
              ].join(" ")}
            >
              <div className="text-[1.15rem] font-black tracking-[0.06em] text-black">
                Proceed to Venue
              </div>
            </button>
          </div>
        </div>
      </aside>
      </div>

      {/* Quantity Modal Overlay (no HTML <input>) */}
      {modalOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Select quantity"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        >
          <div
            className="absolute inset-0"
            onClick={closeModal}
            aria-hidden
          />

          <div className="relative z-10 w-full max-w-[560px] rounded-3xl border border-white/15 bg-[#0B0E12] p-4 shadow-[0_40px_120px_rgba(0,0,0,0.75)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-[0.22em] text-white/60">
                  Quantity Entry
                </div>
                <div className="mt-2 text-lg font-black text-white/90">
                  {modalTargetName}
                </div>
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
                    Type a digit, then press Enter.
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

      {/* Custom Item Modal */}
      {customItemModalOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Add custom item"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        >
          <div
            className="absolute inset-0"
            onClick={closeCustomItemModal}
            aria-hidden
          />

          <div className="relative z-10 w-full max-w-[560px] rounded-3xl border border-white/15 bg-[#0B0E12] p-4 shadow-[0_40px_120px_rgba(0,0,0,0.75)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-[0.22em] text-white/60">
                  Custom Item
                </div>
                <div className="mt-2 text-lg font-black text-white/90">
                  Add to Live Cart
                </div>
              </div>

              <button
                type="button"
                onClick={closeCustomItemModal}
                className="min-h-[48px] min-w-[48px] rounded-2xl border border-white/10 bg-white/5 p-3 text-white/80 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80"
                aria-label="Cancel"
              >
                <X size={20} />
              </button>
            </div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
              <label className="text-xs uppercase tracking-[0.22em] text-white/60">
                Item Name
              </label>
              <input
                value={customItemName}
                onChange={(e) => setCustomItemName(e.target.value)}
                placeholder="Enter item name"
                className="mt-2 min-h-[48px] w-full rounded-xl border border-white/10 bg-black/20 px-3 text-base text-white placeholder:text-white/40 outline-none focus-visible:ring-4 focus-visible:ring-white/80"
              />

              <div className="mt-4 text-xs uppercase tracking-[0.22em] text-white/60">Typed</div>
              <div className="mt-2 flex items-center justify-between gap-4">
                <div className="text-[2rem] font-black text-white">
                  {customTypedQty ? customTypedQty : "—"}
                </div>

                {customQtyError ? (
                  <div className="max-w-[180px] rounded-xl border border-red-500/30 bg-red-500/10 p-2 text-xs font-bold text-red-200">
                    {customQtyError}
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
                  onClick={() => appendCustomDigit(d)}
                  className="min-h-[64px] min-w-[64px] rounded-3xl border border-white/10 bg-white/5 text-[2rem] font-black text-white/90 shadow-[0_14px_40px_rgba(0,0,0,0.35)] transition hover:bg-white/10 active:bg-white/15 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80"
                  aria-label={`Digit ${d}`}
                >
                  {d}
                </button>
              ))}

              <button
                type="button"
                onClick={clearCustomDigits}
                className="min-h-[64px] min-w-[64px] rounded-3xl border border-white/10 bg-white/5 px-2 text-xs font-black uppercase tracking-[0.22em] text-white/80 transition hover:bg-white/10 active:bg-white/15 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80"
                aria-label="Clear quantity"
              >
                CLEAR
              </button>

              <button
                type="button"
                onClick={() => appendCustomDigit("0")}
                className="min-h-[64px] min-w-[64px] rounded-3xl border border-white/10 bg-white/5 text-[2rem] font-black text-white/90 shadow-[0_14px_40px_rgba(0,0,0,0.35)] transition hover:bg-white/10 active:bg-white/15 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80"
                aria-label="Digit 0"
              >
                0
              </button>

              <button
                type="button"
                onClick={confirmCustomItem}
                disabled={!customTypedQty || customTypedQty.length === 0}
                className="min-h-[64px] min-w-[64px] rounded-3xl border-2 border-white/20 bg-[#2E5BFF] px-2 text-xs font-black uppercase tracking-[0.22em] text-white transition hover:bg-[#3A6DFF] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/40"
                aria-label="Enter custom item quantity"
              >
                ENTER
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Change Transaction Type Confirmation Modal */}
      {switchConfirmOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Change Transaction Type"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        >
          <div
            className="absolute inset-0"
            onClick={cancelTransactionSwitch}
            aria-hidden
          />

          <div className="relative z-10 w-full max-w-[560px] rounded-3xl border border-white/15 bg-[#0B0E12] p-4 shadow-[0_40px_120px_rgba(0,0,0,0.75)]">
            <div className="text-sm font-black leading-6 tracking-wide text-white/90">
              Change Transaction Type? You have items in your cart. Are you sure you want to switch?
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={cancelTransactionSwitch}
                className="min-h-[64px] min-w-[64px] rounded-3xl border border-white/10 bg-white/5 px-4 text-sm font-black tracking-wide text-white/80 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80"
                aria-label="Cancel switch"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={confirmTransactionSwitch}
                className="min-h-[64px] min-w-[64px] rounded-3xl border-2 border-white/15 px-4 text-sm font-black tracking-wide text-white transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80"
                style={{
                  background: isStockOut ? "#00B050" : "#FFD400",
                }}
                aria-label="Yes, Switch"
              >
                Yes, Switch
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Clear Cart Confirmation Modal */}
      {clearConfirmOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Clear Cart"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        >
          <div
            className="absolute inset-0"
            onClick={() => setClearConfirmOpen(false)}
            aria-hidden
          />

          <div className="relative z-10 w-full max-w-[560px] rounded-3xl border border-white/15 bg-[#0B0E12] p-4 shadow-[0_40px_120px_rgba(0,0,0,0.75)]">
            <div className="text-sm font-black leading-6 tracking-wide text-white/90">
              Are you sure you want to empty the cart? [Cancel] [Yes, Empty]
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setClearConfirmOpen(false)}
                className="min-h-[64px] min-w-[64px] rounded-3xl border border-white/10 bg-white/5 px-4 text-sm font-black tracking-wide text-white/80 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80"
                aria-label="Cancel empty cart"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={() => {
                  setClearConfirmOpen(false);
                  closeModal();
                  closeCustomItemModal();
                  setCart([]);
                  clearCartInSession();
                }}
                className="min-h-[64px] min-w-[64px] rounded-3xl border-2 border-white/15 px-4 text-sm font-black tracking-wide text-white transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/80"
                style={{ background: "#B91C1C" }}
                aria-label="Yes, Empty"
              >
                Yes, Empty
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

