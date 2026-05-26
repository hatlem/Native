// DEPRECATED location — the implementation moved to src/lib/pricing/visibility.ts
// when the confirmedAt gate was added. This file re-exports so existing
// imports keep working; new code should import from "@/lib/pricing/visibility".
export {
  arePricesVisible,
  allPricesVisible,
  anyHiddenPrices,
  redactProductPricing,
  isProductPriceShown,
  type TitleWithVisibility,
  type ProductWithConfirmation,
} from "./pricing/visibility";
