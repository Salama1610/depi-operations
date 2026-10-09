import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true },
});
after(async () => {
  await vite.close();
});

const pages = [
  "app/operations.tsx",
  "app/program-flow.tsx",
  "app/weekly-progress.tsx",
  "app/control-center.tsx",
  "app/portal-view.tsx",
  "app/dashboard.tsx",
  "app/opportunities.tsx",
  "app/student/page.tsx",
  "app/login/login-form.tsx",
  "app/auth/update-password/password-form.tsx",
  "app/page.tsx",
];

/** Every literal passed to t("...") in the interface files. */
async function translationKeys() {
  const keys = new Set();
  for (const file of pages) {
    const source = await readFile(new URL(file, new URL("..", import.meta.url)), "utf8");
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node) => {
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(sf) === "t" &&
        node.arguments[0] &&
        ts.isStringLiteralLike(node.arguments[0])
      ) {
        keys.add(node.arguments[0].text);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return keys;
}

// Brand names, example data and identifiers that stay in English by design.
const untranslated = new Set([
  "DEPI",
  "Freelance Yard",
  "name@example.com",
  "depi/client-account-101",
  "Approved design service",
  "Banner design",
  "https://…",
]);

const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

test("every interface string has an Arabic translation with matching placeholders", async () => {
  const { ar } = await vite.ssrLoadModule("/lib/i18n/ar.ts");
  const keys = await translationKeys();
  const missing = [...keys].filter((key) => !(key in ar) && !untranslated.has(key));
  assert.deepEqual(missing, [], "untranslated interface strings");
  for (const [key, value] of Object.entries(ar)) {
    assert.equal(placeholders(value), placeholders(key), `placeholders differ for "${key}"`);
    assert.ok(value.trim(), `empty translation for "${key}"`);
  }
});

test("translate falls back to English and fills placeholders", async () => {
  const { translate, normalizeLocale, dirFor, localeFromCookieHeader } = await vite.ssrLoadModule("/lib/i18n/index.ts");
  assert.equal(translate("ar", "Sign in"), "تسجيل الدخول");
  assert.equal(translate("en", "Sign in"), "Sign in");
  assert.equal(translate("ar", "S20001"), "S20001");
  assert.equal(translate("ar", "Week {v0}", { v0: 3 }), "الأسبوع 3");
  assert.equal(translate("en", "{v0} of {v1} records", { v0: "1–25", v1: 80 }), "1–25 of 80 records");
  assert.equal(normalizeLocale("AR"), "ar");
  assert.equal(normalizeLocale("fr"), "en");
  assert.equal(dirFor("ar"), "rtl");
  assert.equal(localeFromCookieHeader("a=1; depi_lang=ar; b=2"), "ar");
  assert.equal(localeFromCookieHeader(null), "en");
});

async function renderIn(locale, modulePath, exportName, props = {}) {
  const { LocaleProvider } = await vite.ssrLoadModule("/lib/i18n/context.tsx");
  const mod = await vite.ssrLoadModule(modulePath);
  const Component = mod[exportName];
  return renderToStaticMarkup(
    React.createElement(LocaleProvider, { locale }, React.createElement(Component, props)),
  );
}

test("the sign-in form renders in Arabic and in English", async () => {
  const ar = await renderIn("ar", "/app/login/login-form.tsx", "default", { configured: true });
  assert.match(ar, /مرحباً بعودتك/);
  assert.match(ar, /تسجيل الدخول/);
  assert.match(ar, /class="lang-toggle[^"]*"[^>]*lang="en"/);
  assert.doesNotMatch(ar, /Welcome back/);

  const en = await renderIn("en", "/app/login/login-form.tsx", "default", { configured: true });
  assert.match(en, /Welcome back/);
  assert.match(en, /<span>العربية<\/span>/);
});

test("the password form renders in Arabic", async () => {
  const html = await renderIn("ar", "/app/auth/update-password/password-form.tsx", "default");
  assert.match(html, /اختر كلمة مرور جديدة/);
  assert.match(html, /تحديث كلمة المرور/);
});

test("the student portal shell renders in Arabic", async () => {
  const html = await renderIn("ar", "/app/student/page.tsx", "default");
  assert.match(html, /خدمات الطلاب/);
  assert.match(html, /جارٍ تحميل روابط خدماتك…/);
});

test("the staff console shell renders in Arabic with the sidebar on the right", async () => {
  const html = await renderIn("ar", "/app/operations.tsx", "default", { module: "home" });
  assert.match(html, /نظرة عامة/);
  assert.match(html, /مهامي/);
  // Program flow is for leaders and administrators; a person with no role does not see it.
  assert.doesNotMatch(html, /مسار البرنامج/);
  assert.match(html, /data-side="right"/);
  assert.doesNotMatch(html, />Overview</);

  const en = await renderIn("en", "/app/operations.tsx", "default", { module: "home" });
  assert.match(en, />Overview</);
  assert.match(en, /data-side="left"/);
});

test("the program flow shell renders in Arabic", async () => {
  const html = await renderIn("ar", "/app/program-flow.tsx", "ProgramFlow");
  assert.match(html, /جارٍ تحميل مسار البرنامج الكامل…/);
});
