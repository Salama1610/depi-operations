"use client";

import { createContext, useContext, type ReactNode } from "react";
import { Languages } from "lucide-react";
import {
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  defaultLocale,
  dirFor,
  localeNames,
  translator,
  type Locale,
  type Translate,
} from "./index";

const LocaleContext = createContext<Locale>(defaultLocale);

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export function useDir() {
  return dirFor(useLocale());
}

/** Translates English interface text for the active locale. */
export function useT(): Translate {
  return translator(useLocale());
}

/**
 * Stores the chosen language in a cookie and reloads, so the server renders
 * the whole page in that language and direction from the first paint.
 */
export function switchLocale(next: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax`;
  window.location.reload();
}

export function LanguageToggle({ className = "" }: { className?: string }) {
  const locale = useLocale();
  const next: Locale = locale === "ar" ? "en" : "ar";
  return (
    <button
      type="button"
      className={"lang-toggle " + className}
      onClick={() => switchLocale(next)}
      lang={next}
      dir={dirFor(next)}
      aria-label={localeNames[next]}
      title={localeNames[next]}
    >
      <Languages size={16} aria-hidden="true" />
      <span>{localeNames[next]}</span>
    </button>
  );
}
