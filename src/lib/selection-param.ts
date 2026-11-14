import { isGroupKey } from "@/dedupe/group";

/**
 * The `compare=` / `groups=` URL format: `<groupKey>:<offerId>`, comma-separated.
 *
 * Both halves can contain `:`. Group keys never do (they are `IR|IR3301|2026-11-20|IFN>KIH`),
 * but offer ids are `provider:rawId` and a raw id may hold a colon too. Splitting from the
 * right — the obvious `lastIndexOf(":")` — therefore truncates inside the offer id and
 * silently drops the selection, so ambiguity is resolved by *validity* instead: the group key
 * is the leftmost prefix `isGroupKey` accepts, and everything after its following ":" is the
 * offer id. Kept out of the page module so it can be unit-tested and reused by both pages.
 */
export function splitSelectionToken(token: string): { groupKey: string; offerId: string } {
  for (let index = token.indexOf(":"); index > 0; index = token.indexOf(":", index + 1)) {
    const head = token.slice(0, index);
    if (isGroupKey(head)) return { groupKey: head, offerId: token.slice(index + 1) };
  }
  // No group-key prefix: the token is either a bare group key (old links) or a bare offer id.
  return { groupKey: token, offerId: "" };
}

export function parseSelectionParam(value: string): { groupKey: string; offerId: string }[] {
  if (!value) return [];
  return value
    .split(",")
    .map(splitSelectionToken)
    .filter((token) => token.groupKey.length > 0 || token.offerId.length > 0);
}

export function selectionParam(items: { groupKey: string; offerId: string }[]): string {
  return items.map((item) => `${item.groupKey}:${item.offerId}`).join(",");
}
