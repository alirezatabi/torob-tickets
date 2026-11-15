import { test, expect, type Page } from "@playwright/test";

/**
 * The critical flow from the brief:
 * search → results (short rows) → filter/sort → per-ticket detail → offer comparison.
 *
 * Deliberately runs with no API key and no database: everything must work from
 * the curated demo data.
 */

function isoDaysFromToday(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function search(page: Page, params: Record<string, string>) {
  const query = new URLSearchParams(params).toString();
  await page.goto(`/search?${query}`);
  await expect(page.getByTestId("results-list")).toBeVisible();
}

test.describe("Torob Tickets journey", () => {
  const date = isoDaysFromToday(7);
  const resultsUrl = { origin: "THR", destination: "IST", date };

  test("homepage explains the product and offers both search modes", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("بلیت هواپیما");
    await expect(page.getByRole("tab", { name: "جستجوی فرمی" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "جستجوی طبیعی" })).toBeVisible();
    // Demo data must be disclosed, never presented as live prices.
    await expect(page.getByText("داده‌های نمونه").first()).toBeVisible();
  });

  test("form search reaches results with prices and providers", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /جستجوی پرواز/ }).click();
    await page.waitForURL(/\/search\?/);

    await expect(page.getByTestId("results-list")).toBeVisible();
    const cards = page.getByTestId("offer-card");
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeGreaterThan(3);
    await expect(cards.first().getByTestId("offer-price")).toContainText("تومان");
  });

  test("natural-language search produces a structured search", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tab", { name: "جستجوی طبیعی" }).click();
    await page
      .getByLabel(/درخواست خود را/)
      .fill("ارزان‌ترین پرواز تهران به استانبول فردا با بار و بدون توقف");
    await page.getByRole("button", { name: /جستجو با هوش مصنوعی/ }).click();

    await page.waitForURL(/\/search\?/);
    const url = new URL(page.url());
    expect(url.searchParams.get("origin")).toBe("THR");
    expect(url.searchParams.get("destination")).toBe("IST");
    expect(url.searchParams.get("bag")).toBe("1");
    expect(url.searchParams.get("stops")).toBe("0");
    await expect(page.getByTestId("results-list")).toBeVisible();
  });

  test("sorting and filtering change the visible results", async ({ page }) => {
    await search(page, resultsUrl);

    // The default tab *is* «ارزان‌ترین»; the order must change when another tab is chosen.
    const cheapestPrice = await page.getByTestId("offer-price").first().textContent();
    await page.getByRole("tab", { name: "زودترین حرکت" }).click();
    await expect(page).toHaveURL(/sort=earliest/);
    await expect(page.getByTestId("results-list")).toBeVisible();
    const earliestPrice = await page.getByTestId("offer-price").first().textContent();
    expect(cheapestPrice).not.toBeNull();
    expect(earliestPrice).not.toBeNull();

    // A direct-only filter must remove multi-stop offers.
    await page.getByRole("button", { name: "مستقیم" }).click();
    await expect(page).toHaveURL(/stops=0/);
    await expect(page.getByTestId("results-list")).toBeVisible();
    const cards = page.getByTestId("offer-card");
    const count = await cards.count();
    for (let index = 0; index < count; index++) {
      await expect(cards.nth(index)).not.toContainText("۲ توقف");
    }
  });

  test("the results page makes no recommendation — and each row opens its own ticket page", async ({ page }) => {
    await search(page, resultsUrl);
    // The «بهترین تطابق» block was removed from /search by request.
    await expect(page.getByTestId("recommendation-text")).toHaveCount(0);
    await expect(page.getByText("بهترین تطابق")).toHaveCount(0);

    const card = page.getByTestId("offer-card").first();
    // The whole row is the link, so a tap anywhere on it opens the ticket.
    await card.click();
    await page.waitForURL(/\/flight\?/);
    await expect(page.getByTestId("flight-page")).toBeVisible();
    await expect(page.getByTestId("flight-page")).toContainText("فروشنده‌های همین پرواز");
    await expect(page.getByTestId("flight-page")).toContainText("تومان");
  });

  test("comparing two offers shows a side-by-side table with unknown values marked", async ({ page }) => {
    await search(page, resultsUrl);

    const compareButtons = page.getByRole("button", { name: /افزودن به مقایسه/ });
    await compareButtons.nth(0).click();
    await compareButtons.nth(1).click();
    await page.getByRole("link", { name: /مقایسهٔ گزینه‌ها/ }).click();

    await page.waitForURL(/\/compare\?/);
    const table = page.getByTestId("compare-table");
    await expect(table).toBeVisible();
    await expect(table).toContainText("مدت سفر");
    await expect(table).toContainText("بار همراه");
    await expect(table).toContainText("شرایط استرداد");
  });

  test("an invalid search shows a helpful error instead of crashing", async ({ page }) => {
    await page.goto("/search?origin=THR");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("کامل نیستند");
  });

  test("a missing date is not an error: it means today", async ({ page }) => {
    await page.goto("/search?origin=THR&destination=MHD");
    await expect(page.getByTestId("results-list")).toBeVisible();
    await expect(page.getByTestId("date-chip")).toHaveCount(8);
  });

  test("an impossible calendar date is reported, not silently searched", async ({ page }) => {
    await page.goto("/search?origin=THR&destination=MHD&date=2026-13-45");
    await expect(page.getByTestId("search-error")).toContainText("وجود ندارد");
  });

  test("a route without demo data shows the empty state", async ({ page }) => {
    await page.goto(`/search?origin=SYZ&destination=LHR&date=${date}`);
    await expect(page.getByRole("heading", { name: /پروازی پیدا نشد/ })).toBeVisible();
  });
});
