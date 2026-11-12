/**
 * Sepehr360 search-page parser.
 *
 * Design constraint that shaped this file: Sepehr360 publishes **no API contract and
 * no stable CSS classes**. Any parser pinned to `div.result-card__price` will break on
 * the next deploy and, worse, will break *silently* (0 rows looks like "no flights").
 *
 * So the parser is content-driven:
 *   1. it finds the smallest DOM sub-trees that contain BOTH a price ("تومان") and a
 *      clock time ("HH:MM") — on the real page that is exactly one result card;
 *   2. inside each card it reads fields by their *meaning* (time patterns, price
 *      pattern, Persian keywords), not by class name;
 *   3. every field it cannot recognise stays `null`, and the parse reports warnings
 *      when a card yields no price/time at all.
 *
 * That makes the connector tolerant to markup changes and honest when it is wrong:
 * `meta.emptyState` distinguishes "the page says there are no flights" from
 * "we understood nothing", and the adapter treats the latter as a `parse` error.
 */

import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { normalizeDigits, parsePriceText } from "@/modules/money/price";
import { resolveAirlineCode } from "@/modules/airlines/registry";
import { parsePersianDuration, parseStops, parseWallClock } from "./parse-duration";
import type { Sepehr360ParseResult, Sepehr360RawOffer } from "./types";

const PRICE_MARKER = /(تومان|تومن|ريال|ریال)/;
const CLOCK = /(\d{1,2}:\d{2})/;
const MAX_CARDS = 400;

export function parseSearchPage(html: string): Sepehr360ParseResult {
  const warnings: string[] = [];
  const $ = cheerio.load(html);

  // Scripts/styles carry JSON that can contain prices and times; never parse them.
  $("script, style, noscript, template").remove();

  const pageText = normalizeDigits($("body").text() || $.root().text());
  const challenge = detectChallenge(pageText, $.html().slice(0, 200_000));
  const resultCount = parseResultCount(pageText);
  const emptyState = isExplicitEmpty(pageText);
  const airports = parsePageAirports(pageText);

  if (challenge) {
    return {
      offers: [],
      meta: {
        resultCount,
        updatedText: null,
        originAirport: airports.origin,
        destinationAirport: airports.destination,
        emptyState: false,
        challenge,
      },
      warnings: [],
    };
  }

  const cards = findCards($);
  if (cards.length === 0 && !emptyState) {
    warnings.push("no-result-cards-found");
  }
  if (cards.length === 0 && resultCount && resultCount > 0) {
    warnings.push(`page-declares-${resultCount}-results-but-none-parsed`);
  }

  const offers: Sepehr360RawOffer[] = [];
  cards.slice(0, MAX_CARDS).forEach((element, index) => {
    const record = parseCard($, element, index);
    if (!record) {
      warnings.push(`card-${index}-unparsed`);
      return;
    }
    offers.push(record);
  });

  if (offers.length > 0 && offers.every((offer) => offer.priceAmount === null)) {
    warnings.push("no-prices-parsed");
  }

  return {
    offers,
    meta: {
      resultCount,
      updatedText: parseUpdatedText(pageText),
      originAirport: airports.origin,
      destinationAirport: airports.destination,
      emptyState,
      challenge: null,
    },
    warnings,
  };
}

/**
 * Find "result cards": the innermost elements containing a price marker and a clock.
 * Choosing the *innermost* match avoids returning the whole results container as one
 * card (which would collapse 20 offers into one).
 */
function findCards($: cheerio.CheerioAPI): Element[] {
  const candidates: Element[] = [];
  $("body *").each((_, element) => {
    const $element = $(element);
    // Cards are leaf-ish: skip containers with many element children (layout wrappers).
    const text = normalizeDigits($element.text());
    if (text.length < 8 || text.length > 600) return;
    if (!PRICE_MARKER.test(text)) return;
    if (!CLOCK.test(text)) return;
    const hasQualifyingChild = $element
      .children()
      .toArray()
      .some((child) => {
        const childText = normalizeDigits($(child).text());
        return PRICE_MARKER.test(childText) && CLOCK.test(childText) && childText.length >= 8;
      });
    if (hasQualifyingChild) return; // a descendant is the real card
    candidates.push(element);
  });

  // If nothing matched (very different markup), fall back to the classic card containers.
  if (candidates.length === 0) {
    $("[class*='result'], [class*='flight'], [data-testid*='result']").each((_, element) => {
      const text = normalizeDigits($(element).text());
      if (PRICE_MARKER.test(text) && CLOCK.test(text) && text.length <= 1200) candidates.push(element);
    });
  }

  return dedupeNested(candidates);
}

/** Keep outer cards only (a card may contain a nested price box). */
function dedupeNested(elements: Element[]): Element[] {
  const nodes = new Set(elements);
  return elements.filter((element) => {
    let parent: Element | null = (element as { parent?: Element }).parent ?? null;
    while (parent) {
      if (nodes.has(parent)) return false;
      parent = (parent as { parent?: Element }).parent ?? null;
    }
    return true;
  });
}

function parseCard(
  $: cheerio.CheerioAPI,
  element: Element,
  index: number,
): Sepehr360RawOffer | null {
  const $card = $(element);
  const text = normalizeDigits($card.text()).replace(/\s+/g, " ").trim();

  const clocks = [...text.matchAll(/(\d{1,2}:\d{2})/g)].map((match) => match[1] ?? null);
  const departTime = parseWallClock(clocks[0] ?? null);
  const arriveTime = parseWallClock(clocks[1] ?? null);

  const priceText = findPriceText($, $card, text);
  const price = priceText ? parsePriceText(priceText) : null;

  const airline = resolveCardAirline($card, text);
  const durationText = findDurationText(text);
  const stopsLabel = findKeyword(text, /(مستقیم|بدون توقف|\d+\s*توقف|یک توقف|دو توقف)/);
  const cabinLabel = findKeyword(text, /(اکونومی|اقتصادی|بیزنس|بیزینس|درجه یک|فرست کلاس)/);
  const sellerText = findKeyword(text, /فروش توسط\s*\d+\s*سایت(?:\s*مختلف)?|فروشنده:\s*[^·|\d]{2,30}/);
  const availabilityText = findKeyword(text, /(\d+)\s*(?:صندلی|بلیط باقی|بلیت باقی)/);
  const originLabel = findKeyword(text, /(?:^|\s)از\s+[^\d·|]{2,25}?(?=\s+(?:به|در|ساعت|قیمت|$))/);
  const destinationLabel = findKeyword(
    text,
    /(?:^|\s)به\s+[^\d·|]{2,25}?(?=\s+(?:مستقیم|بدون توقف|یک توقف|دو توقف|\d+ توقف|اکونومی|اقتصادی|بیزنس|بیزینس|در|ساعت|قیمت|فروش|$))/,
  );

  // A card without any clock time is not a flight row; keep the rejection explicit.
  if (departTime === null && arriveTime === null) return null;

  return {
    index,
    airlineCode: airline.code,
    airlineNameFa: airline.nameFa,
    departTime: departTime === null ? null : toClock(departTime),
    arriveTime: arriveTime === null ? null : toClock(arriveTime),
    durationText: cleanLabel(durationText),
    priceText: cleanLabel(priceText),
    priceAmount: price?.amount ?? null,
    originLabel: cleanLabel(originLabel?.replace(/^\s*از\s+/, "") ?? null),
    destinationLabel: cleanLabel(destinationLabel?.replace(/^\s*به\s+/, "") ?? null),
    cabinLabel: cleanLabel(cabinLabel),
    stopsLabel: cleanLabel(stopsLabel),
    sellerText: cleanLabel(sellerText),
    availabilityText,
    charterHint: /چارتر/.test(text),
  };
}

/**
 * The price is the number that sits next to a currency word. We look for the
 * innermost element mentioning a currency, read its parent's text (price + "تومان"
 * are often split across two spans), then fall back to the largest "… تومان" number
 * in the card.
 */
function findPriceText($: cheerio.CheerioAPI, $card: cheerio.Cheerio<Element>, text: string): string | null {
  let fromNode: string | null = null;
  $card.find("*").each((_, element) => {
    if (fromNode) return;
    const $element = $(element);
    if ($element.children().length > 0) return;
    const own = normalizeDigits($element.text());
    if (!PRICE_MARKER.test(own)) return;
    const container = normalizeDigits($element.parent().text());
    const match = /\d[\d\s.,]*\s*(?:تومان|تومن|ریال)/.exec(container) ?? /\d[\d\s.,]{3,}/.exec(container);
    if (match) fromNode = match[0];
  });
  if (fromNode) return fromNode;

  const withCurrency = [...text.matchAll(/(\d[\d\s.,]{3,})\s*(?:تومان|تومن|ریال)/g)].map((m) => m[1] ?? "");
  if (withCurrency.length > 0) return withCurrency[0] ?? null;

  const anyNumber = /(\d[\d\s.,]{4,})/.exec(text);
  return anyNumber?.[1] ?? null;
}

function resolveCardAirline(
  $card: cheerio.Cheerio<Element>,
  text: string,
): { code: string | null; nameFa: string | null } {
  const image = $card.find("img").first();
  const logoUrl = image.length > 0 ? image.attr("src") ?? image.attr("data-src") ?? null : null;
  const altText = image.length > 0 ? image.attr("alt") ?? null : null;

  const textCandidate = matchKnownAirlineName(text);
  return resolveAirlineCode({ logoUrl, nameFa: altText ?? textCandidate, nameEn: null });
}

/** Airline names appear as plain text on the card; pick the first registry hit. */
function matchKnownAirlineName(text: string): string | null {
  const known = [
    "ایران ایر",
    "ایران ایرتور",
    "ماهان",
    "آسمان",
    "ساها",
    "کارون",
    "قشم",
    "آتا",
    "پارس",
    "وارش",
    "آوا",
    "کاسپین",
    "زاگرس",
    "کیش ایر",
    "تابان ایر",
    "شیراز ایر",
    "یزد ایر",
    "سما",
    "فلای پرشیا",
    "ترکیش",
    "پگاسوس",
    "امارات",
    "قطر",
    "عمان ایر",
    "لوفت‌هانزا",
  ];
  return known.find((name) => text.includes(name)) ?? null;
}

function findDurationText(text: string): string | null {
  const match = /(\d+\s*(?:ساعت|دقیقه)(?:\s*و\s*\d+\s*(?:ساعت|دقیقه))?)/.exec(text);
  return match?.[1] ?? null;
}

function findKeyword(text: string, pattern: RegExp): string | null {
  const match = pattern.exec(text);
  return match?.[0]?.trim() ?? null;
}

/** Collapse whitespace/newlines that HTML indentation leaves in extracted labels. */
function cleanLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : null;
}

function toClock(minutes: number): string {
  const hours = Math.floor(minutes / 60) % 24;
  const rest = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function parseResultCount(text: string): number | null {
  const match = /(\d+)\s*نتیجه/.exec(text);
  return match?.[1] ? Number(match[1]) : null;
}

function parseUpdatedText(text: string): string | null {
  const match = /(?:آخرین بروزرسانی|بروزرسانی|به‌روزرسانی)[^\d]{0,10}([^\n·|]{2,40})/.exec(text);
  return match?.[1]?.trim() ?? null;
}

function isExplicitEmpty(text: string): boolean {
  // ZWNJ ("نتیجه‌ای") and a plain space are the same word to a reader but not to a regex.
  const normalized = text.replace(/\u200c/g, " ");
  return /(نتیجه\s*ای یافت نشد|پروازی یافت نشد|بلیطی موجود نیست|نتیجه\s*ای پیدا نشد|پروازی موجود نیست)/.test(normalized);
}

function parsePageAirports(text: string): { origin: string | null; destination: string | null } {
  const origin = /از\s*([A-Z]{3})\b/.exec(text);
  const destination = /به\s*([A-Z]{3})\b/.exec(text);
  return { origin: origin?.[1] ?? null, destination: destination?.[1] ?? null };
}

function detectChallenge(pageText: string, htmlSnippet: string): string | null {
  if (/g-recaptcha|hcaptcha|cf-challenge/.test(htmlSnippet)) return "captcha";
  if (/کد امنیتی|احراز هویت|ورود به حساب/.test(pageText.slice(0, 3_000))) return "login-wall";
  if (/دسترسی شما محدود/.test(pageText.slice(0, 3_000))) return "blocked";
  return null;
}

export { parsePersianDuration, parseStops, parseWallClock };
