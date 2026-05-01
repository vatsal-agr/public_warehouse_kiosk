export type TransactionMode = "out" | "in";

export type CartItem = {
  productId: string;
  name: string;
  quantity: number;
  /**
   * Custom items do not necessarily exist in the `products` table.
   * We keep them in the cart for UX, but venue confirmation may skip them.
   */
  isCustom?: boolean;
};

const CART_KEY = "kiosk_cart_v1";

function safeJsonParse<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function loadCartFromSession(): CartItem[] {
  if (typeof window === "undefined") return [];
  const parsed = safeJsonParse<CartItem[]>(window.sessionStorage.getItem(CART_KEY));
  if (!parsed || !Array.isArray(parsed)) return [];
  return parsed
    .filter((x) => x && typeof x.productId === "string" && typeof x.name === "string")
    .map((x) => ({
      productId: x.productId,
      name: x.name,
      quantity: Number.isFinite(x.quantity) ? x.quantity : 0,
      isCustom: typeof x.isCustom === "boolean" ? x.isCustom : undefined,
    }))
    .filter((x) => x.quantity > 0);
}

export function saveCartToSession(cart: CartItem[]) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(CART_KEY, JSON.stringify(cart));
}

export function clearCartInSession() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(CART_KEY);
}

