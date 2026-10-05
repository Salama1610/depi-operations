import "server-only";

import { cookies } from "next/headers";
import { LOCALE_COOKIE, normalizeLocale, translator, type Locale } from "./index";

/** The interface language chosen by the browser, from the locale cookie. */
export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  // Arabic until the person chooses English with the language switch.
  const chosen = store.get(LOCALE_COOKIE)?.value;
  return chosen ? normalizeLocale(chosen) : "ar";
}

export async function getT() {
  return translator(await getLocale());
}
