/**
 * Interface language. English is the source of every string, so the
 * dictionary is keyed by the English text itself: `t("Sign in")` looks the
 * text up for the active locale and falls back to the English when no
 * translation exists, which keeps names, identifiers and status values that
 * flow through the same helpers untouched.
 */
import { ar } from "./ar";

export type Locale = "en" | "ar";
export const locales: readonly Locale[] = ["en", "ar"];
export const defaultLocale: Locale = "en";
/** Cookie that remembers the chosen interface language for a year. */
export const LOCALE_COOKIE = "depi_lang";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const localeNames: Record<Locale, string> = { en: "English", ar: "العربية" };

const dictionaries: Record<Locale, Record<string, string>> = { en: {}, ar };

export function normalizeLocale(value: string | null | undefined): Locale {
  const lowered = (value || "").trim().toLowerCase().slice(0, 2);
  return locales.includes(lowered as Locale) ? (lowered as Locale) : defaultLocale;
}

export function dirFor(locale: Locale): "ltr" | "rtl" {
  return locale === "ar" ? "rtl" : "ltr";
}

export type Vars = Record<string, string | number | null | undefined>;

/** Fills `{name}` placeholders; a missing value leaves the placeholder blank. */
export function interpolate(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, key) =>
    key in vars ? String(vars[key] ?? "") : match,
  );
}

export function translate(locale: Locale, text: string, vars?: Vars): string {
  const found = locale === "en" ? undefined : dictionaries[locale][text];
  return interpolate(found ?? text, vars);
}

export type Translate = (text: string, vars?: Vars) => string;

export function translator(locale: Locale): Translate {
  return (text, vars) => translate(locale, text, vars);
}

/** The locale from a Cookie header or document.cookie string. */
export function localeFromCookieHeader(header: string | null | undefined): Locale {
  const match = (header || "").match(new RegExp("(?:^|;\\s*)" + LOCALE_COOKIE + "=([^;]*)"));
  return normalizeLocale(match ? decodeURIComponent(match[1]) : undefined);
}
