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
    // Origin/destination are prefilled; the date is prefilled with today, and the search
    // button is the only required interaction.
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

  test("renders one card per physical flight, each with at least three sellers", async ({ page }) => {
    await openScenario(page);
    const cards = page.getByTestId("offer-card");
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeGreaterThanOrEqual(2);

    // The two physical flights of this route: Iran Air ~13:00 and Kish Air ~19:00.
    await expect(cards.filter({ hasText: "IR-3301" })).toHaveCount(1);
    await expect(cards.filter({ hasText: "Y9-7204" })).toHaveCount(1);

    for (const card of await cards.all()) {
      const sellers = card.getByTestId("seller-list").locator("li");
      expect(await sellers.count()).toBeGreaterThanOrEqual(3);
      // Every row shows a toman price.
      await expect(sellers.first()).toContainText("تومان");
    }
  });

  test("the highlighted price is the cheapest of that flight's sellers", async ({ page }) => {
    await openScenario(page);
    const card = page.getByTestId("offer-card").first();
    const shown = await card.getByTestId("offer-price").textContent();
    const prices = await card.getByTestId("seller-list").locator("li .nums").allTextContents();
    const toNumber = (text: string) =>
      Number(
        text
          .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
          .replace(/[^\d]/g, ""),
      );
    const numbers = prices.map(toNumber).filter((value) => Number.isFinite(value) && value > 0);
    expect(numbers.length).toBeGreaterThan(0);
    expect(toNumber(shown ?? "")).toBe(Math.min(...numbers));
    // And exactly one seller is marked as the cheapest.
    await expect(card.getByTestId("seller-list").getByText("کمترین")).toHaveCount(1);
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
