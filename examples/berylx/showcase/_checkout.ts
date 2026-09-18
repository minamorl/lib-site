// Shared fixture for every version of the checkout: the state shape, the
// order that arrives at 02:14, and the exact state each version must end in.
export interface Checkout {
  order: { id: number; qty: number; card: string };
  stock: { reserved: number; warehouse: string | null };
  risk: number | null;
  charged: boolean;
  failure: string | null;
  notified: boolean;
}

export const initial: Checkout = {
  order: { id: 4127, qty: 2, card: 'declined' },
  stock: { reserved: 0, warehouse: null },
  risk: null,
  charged: false,
  failure: null,
  notified: false,
};

// The declined path: stock released (using what reserve took), the failure
// recorded, nothing charged, nobody notified.
export const afterDecline: Checkout = {
  ...initial,
  risk: 0.12,
  failure: 'card_declined: released 2 @ tokyo-2',
};

// The happy path, for a card the issuer accepts.
export const accepted: Checkout = { ...initial, order: { ...initial.order, card: 'visa' } };
export const afterAccept: Checkout = {
  ...accepted,
  stock: { reserved: 2, warehouse: 'tokyo-2' },
  risk: 0.12,
  charged: true,
  notified: true,
};
