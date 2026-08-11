export type PageItem = number | "ellipsis";

// Windowed page strip: 1 … current-1 current current+1 … last. Keeps the
// control usable at ~48 pages (2,858 titles / 60 per page) instead of
// forcing a click-through-every-page prev/next crawl.
export function pageWindow(current: number, total: number): PageItem[] {
  const delta = 1;
  const middle: number[] = [];
  for (
    let i = Math.max(2, current - delta);
    i <= Math.min(total - 1, current + delta);
    i++
  ) {
    middle.push(i);
  }

  const items: PageItem[] = [1];
  if (middle[0] > 2) items.push("ellipsis");
  items.push(...middle);
  if (middle[middle.length - 1] < total - 1) items.push("ellipsis");
  if (total > 1) items.push(total);
  return items;
}
