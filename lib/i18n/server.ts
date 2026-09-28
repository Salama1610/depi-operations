import "server-only";

import { cookies } from "next/headers";
import { LOCALE_COOKIE, normalizeLocale, translator, type Locale } from "./index";

/** The interface language chosen by the browser, from the locale cookie. */
export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  return normalizeLocale(store.get(LOCALE_COOKIE)?.value);
}

export async function getT() {
  return translator(await getLocale());
}
