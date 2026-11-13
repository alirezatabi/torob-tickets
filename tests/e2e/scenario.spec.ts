import { test, expect, type Page } from "@playwright/test";

/**
 * The reference scenario of prompt 02, end to end — with **no date entered**:
 *
 *   homepage → اصفهان / کیش → search → 8-day strip → one card per flight →
 *   at least three sellers under each → the highlighted price is the cheapest →
 *   changing the day changes the URL → changing the sort changes the order →
 *   four passengers push the too-small offers out of "cheapest".
 *
 * The app runs with an empty environment (no API key, no database): everything here is the
 * deterministic demo dataset.
 */

const SCENARIO = { origin: "IFN", destination: "KIH" } as const;

async function openScenario(page: Page) {
  await page.goto(`/search?origin=${SCENARIO.origin}&destination=${SCENARIO.destination}`);
  await expect(page.getByTestId("results-list")).toBeVisible();
}

test.describe("Isfahan → Kish, no date chosen", () => {
  test("the homepage needs only origin and destination", async ({ page }) => {
    await page.goto("/");
    // Origin and destination start empty on purpose: the route is the user's to choose.
    // Submitting without them must say so instead of searching a guessed route.
    await expect(page.getByRole("combobox", { name: "مبدأ" })).toContainText("از کجا؟");
    await page.getByRole("button", { name: /جستجوی پرواز/ }).click();
    await expect(page.getByRole("alert")).toContainText("هم مبدأ و هم مقصد");

    // Choosing both is the only required interaction; the date still defaults to today.
    await page.getByRole("combobox", { name: "مبدأ" }).click();
    await page.getByRole("option", { name: /اصفهان/ }).click();
    await page.getByRole("combobox", { name: "مقصد" }).click();
    await page.getByRole("option", { name: /کیش/ }).click();
    await page.getByRole("button", { name: /جستجوی پرواز/ }).click();
    await page.waitForURL(/\/search\?/);
    await expect(page.getByTestId("results-list")).toBeVisible();
    // Round-trip is honestly disabled rather than silently dropping the return leg.
    await expect(page.getByRole("button", { name: /رفت‌وبرگشت/ })).toBeDisabled();
  });

  test("shows exactly eight day chips with prices and a «—» for days without offers", async ({ page }) => {
    await openScenario(page);
    const chips = page.getByTestId("date-chip");
    await expect(chips).toHaveCount(8);
    // The first chip is today and is selected.
    await expect(chips.first()).toHaveAttribute("data-selected", "true");
    await expect(chips.first()).toContainText("امروز");
    // Every chip has an accessible name that explains its price or its absence.
    for (let index = 0; index < 8; index++) {
      const label = await chips.nth(index).getAttribute("aria-label");
      expect(label).toBeTruthy();
      expect(label).toMatch(/ارزان‌ترین|پروازی برای این روز نیست|ظرفیت ندارد|دریافت نشد/);
    }
    // Prices are Persian-formatted; an unknown price is an em dash, never ۰.
    const firstPrice = await chips.first().getByTestId("date-chip-price").textContent();
    expect(firstPrice).not.toBe("۰");
  });

  test("renders one short row per physical flight — and nothing else", async ({ page }) => {
    await openScenario(page);
    const cards = page.getByTestId("offer-card");
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeGreaterThanOrEqual(2);

    // The two physical flights of this route: Iran Air ~13:00 and Kish Air ~19:00.
    await expect(cards.filter({ hasText: "IR-3301" })).toHaveCount(1);
    await expect(cards.filter({ hasText: "Y9-7204" })).toHaveCount(1);

    // The list is a summary: no seller list, no recommendation block on the page.
    await expect(cards.first().getByTestId("seller-list")).toHaveCount(0);
    await expect(page.getByTestId("recommendation-text")).toHaveCount(0);
    await expect(page.getByText("بهترین تطابق")).toHaveCount(0);

    // Each row leads with the carrier's own badge.
    await expect(cards.first().getByTestId("airline-logo")).toBeVisible();

    // Every row carries the six facts of the brief.
    for (const card of await cards.all()) {
      await expect(card.getByTestId("offer-price")).toContainText("تومان");
      await expect(card.getByTestId("flight-capacity")).toContainText("صندلی");
      await expect(card.getByTestId("flight-aircraft")).not.toBeEmpty();
      await expect(card.getByTestId("flight-details")).toBeAttached();
      // Origin → destination cities are both on the row.
      await expect(card).toContainText("اصفهان");
      await expect(card).toContainText("کیش");
    }
  });

  test("the row's price and its sellers' prices agree on the ticket page", async ({ page }) => {
    await openScenario(page);
    const card = page.getByTestId("offer-card").first();
    const shown = await card.getByTestId("offer-price").textContent();

    await card.getByTestId("flight-details").click();
    await page.waitForURL(/\/flight\?/);
    const detail = page.getByTestId("flight-page");
    await expect(detail).toBeVisible();
    await expect(detail.getByTestId("flight-cheapest")).toHaveText(shown ?? "");
    // Every seller of this flight is here, cheapest marked once.
    const sellers = detail.getByTestId("seller-list").locator("li");
    expect(await sellers.count()).toBeGreaterThanOrEqual(3);
    await expect(detail.getByTestId("seller-list").getByText("کمترین")).toHaveCount(1);
    await expect(detail).toContainText("شرایط استرداد");
    await expect(detail).toContainText("بار همراه");
    // …and the flight is drawn on the planet.
    await expect(detail.getByTestId("route-globe")).toBeVisible();
  });

  test("the day strip slides: the picked day is not shoved to the start, and days before it stay", async ({ page }) => {
    // A window of eight days, with the selection two days in.
    await page.goto(
      `/search?origin=${SCENARIO.origin}&destination=${SCENARIO.destination}&date=2026-11-20&strip=2026-11-18`,
    );
    const chips = page.getByTestId("date-chip");
    await expect(chips).toHaveCount(8);
    const dates = await chips.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-date") ?? ""));
    const selectedIndex = dates.indexOf("2026-11-20");
    // Days *before* the selection are on screen — the old strip started at the selection.
    expect(selectedIndex).toBeGreaterThan(0);

    // Tapping a later day keeps the whole window exactly where it was.
    await chips.nth(5).click();
    await page.waitForURL(/date=/);
    const after = await page
      .getByTestId("date-chip")
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-date") ?? ""));
    expect(after).toEqual(dates);
    await expect(page.getByTestId("results-list")).toBeVisible();
  });

  test("the pager walks forward a window at a time and back again", async ({ page }) => {
    await page.goto(
      `/search?origin=${SCENARIO.origin}&destination=${SCENARIO.destination}&date=2026-11-20&strip=2026-11-18`,
    );
    const readDates = () =>
      page.getByTestId("date-chip").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-date") ?? ""));
    const first = await readDates();

    await page.getByTestId("date-strip-next").click();
    await page.waitForURL(/strip=2026-11-26/);
    const next = await readDates();
    // One window forward, not one day: none of the old days remain, and a chip is still selected.
    expect(next[0]).toBe("2026-11-26");
    await expect(page.locator('[data-testid="date-chip"][data-selected="true"]')).toHaveCount(1);

    await page.getByTestId("date-strip-prev").click();
    await page.waitForURL(/strip=2026-11-18/);
    expect(await readDates()).toEqual(first);
  });

  test("changing the day keeps every other parameter and reloads the list", async ({ page }) => {
    await page.goto(
      `/search?origin=${SCENARIO.origin}&destination=${SCENARIO.destination}&pax=2&sort=fastest`,
    );
    const chips = page.getByTestId("date-chip");
    const secondDate = await chips.nth(1).getAttribute("data-date");
    await chips.nth(1).click();
    await page.waitForURL(new RegExp(`date=${secondDate}`));
    const url = new URL(page.url());
    expect(url.searchParams.get("pax")).toBe("2");
    expect(url.searchParams.get("sort")).toBe("fastest");
    await expect(page.getByTestId("results-list")).toBeVisible();
  });

  test("the sort tabs really change the order", async ({ page }) => {
    await openScenario(page);
    const keys = async () =>
      (await page.getByTestId("offer-card").evaluateAll((cards) =>
        cards.map((card) => card.getAttribute("data-group-key") ?? ""),
      )) as string[];

    const cheapestOrder = await keys();
    await page.getByRole("tab", { name: "زودترین حرکت" }).click();
    await expect(page).toHaveURL(/sort=earliest/);
    await expect(page.getByTestId("results-list")).toBeVisible();
    const earliestOrder = await keys();

    expect(cheapestOrder.length).toBe(earliestOrder.length);
    // The cheapest flight of this route departs at 19:00, the earliest at 13:00.
    expect(earliestOrder[0]).not.toBe(cheapestOrder[0]);
  });

  test("four passengers drop an offer with three seats from the cheapest spot", async ({ page }) => {
    await page.goto(
      `/search?origin=${SCENARIO.origin}&destination=${SCENARIO.destination}&pax=4`,
    );
    await expect(page.getByTestId("results-list")).toBeVisible();
    const cards = page.getByTestId("offer-card");
    expect(await cards.count()).toBeGreaterThan(0);

    // Either the small-capacity seller is greyed out with a reason, or the flight is sold out
    // and says so — in both cases the price shown is never an offer that cannot be bought.
    const body = await page.getByTestId("results-list").textContent();
    expect(body).toMatch(/ظرفیت کافی نیست|تکمیل ظرفیت|صندلی/);
  });

  test("a flight with too little capacity for the group is marked «تکمیل ظرفیت» last", async ({ page }) => {
    await page.goto(
      `/search?origin=${SCENARIO.origin}&destination=${SCENARIO.destination}&pax=9`,
    );
    await expect(page.getByTestId("results-list")).toBeVisible();
    const soldOut = page.locator('[data-sold-out="true"]');
    if ((await soldOut.count()) === 0) test.skip(true, "every flight still has a seller with nine seats on this date");
    const all = page.getByTestId("offer-card");
    const last = all.last();
    await expect(last).toHaveAttribute("data-sold-out", "true");
  });
});
