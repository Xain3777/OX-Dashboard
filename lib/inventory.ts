// Inventory derivations shared across the POS (StoreBlock/KitchenBlock) and
// the manager reports. Pure functions over store state — no I/O.

import type { RawMaterial, ItemRecipeLine, Currency } from "./types";

// Convert an amount between SYP and USD using the live rate (1 USD -> SYP).
export function convertCurrency(amount: number, from: Currency, to: Currency, rate: number): number {
  if (from === to) return amount;
  if (!rate || rate <= 0) return amount;
  return from === "usd" ? amount * rate : amount / rate;
}

// How many whole units of a catalog item can be produced from current
// warehouse stock, given its recipe. Returns null when the item has NO recipe
// (i.e. it isn't recipe-tracked — fall back to its own stock_quantity).
export function recipeAvailability(
  catalogItemId: string,
  rawMaterials: RawMaterial[],
  itemRecipes: ItemRecipeLine[],
): number | null {
  const lines = itemRecipes.filter((r) => r.catalogItemId === catalogItemId);
  if (lines.length === 0) return null;
  let min = Infinity;
  for (const line of lines) {
    const mat = rawMaterials.find((m) => m.id === line.rawMaterialId);
    const have = mat ? mat.currentQuantity : 0;
    const per = line.quantity > 0 ? line.quantity : 1;
    const canMake = Math.floor(have / per);
    if (canMake < min) min = canMake;
  }
  return min === Infinity ? null : min;
}

// Cost of producing one unit of a recipe item, normalized to `target`
// currency. Uses each material's lastPurchasePrice (missing = 0, flagged).
export function recipeUnitCost(
  catalogItemId: string,
  rawMaterials: RawMaterial[],
  itemRecipes: ItemRecipeLine[],
  target: Currency,
  rate: number,
): { cost: number; hasMissingPrice: boolean; lineCount: number } {
  const lines = itemRecipes.filter((r) => r.catalogItemId === catalogItemId);
  let cost = 0;
  let hasMissingPrice = false;
  for (const line of lines) {
    const mat = rawMaterials.find((m) => m.id === line.rawMaterialId);
    if (!mat || mat.lastPurchasePrice == null) { hasMissingPrice = true; continue; }
    const unitCost = convertCurrency(mat.lastPurchasePrice, mat.costCurrency ?? "usd", target, rate);
    cost += unitCost * line.quantity;
  }
  return { cost, hasMissingPrice, lineCount: lines.length };
}
