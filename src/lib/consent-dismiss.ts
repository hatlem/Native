// GetCookies' banner close button (×) only hides the banner: it stores no
// choice, so the next page load asks again — and every catalog filter, sort
// and search is a full page load. The widget also draws the × although the
// domain's config turns it off (show_close_button: false). Closing without
// choosing is not consent, so it is recorded as the refusal it is:
// necessary cookies only, the same outcome as "Reject all".

export const BANNER_CLOSE_SELECTOR = '.gc-banner-container [data-action="close"]';
export const DISMISS_CATEGORIES = ["necessary"] as const;

export type GetCookiesApi = {
  _loaded?: boolean;
  getConsent?: () => unknown;
  updateConsent?: (categories: string[]) => unknown;
};

/** The categories to store when the visitor closes the banner, or null when
 *  there is nothing to do: the widget isn't up yet, or a choice is already
 *  stored (closing never overrides a choice). */
export function dismissalCategories(api: GetCookiesApi | undefined): string[] | null {
  if (!api?._loaded || typeof api.updateConsent !== "function") return null;
  const existing = typeof api.getConsent === "function" ? api.getConsent() : null;
  if (existing) return null;
  return [...DISMISS_CATEGORIES];
}
