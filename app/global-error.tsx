"use client";

// The last resort when the page frame itself fails (12 November 2026). It
// replaces the root layout, so it carries its own <html> and both languages.

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "48px 16px", maxWidth: 560, margin: "0 auto", lineHeight: 1.6 }}>
        <h1 style={{ fontSize: 20 }}>Something went wrong on our side.</h1>
        <p>Reload the page. Nothing you saved is lost.</p>
        <p dir="rtl" lang="ar">حدث خطأ من جهتنا. أعد تحميل الصفحة، ولن يضيع شيء مما حفظته.</p>
        <button onClick={() => window.location.reload()} style={{ padding: "8px 16px", fontSize: 15 }}>
          Reload · إعادة التحميل
        </button>
        {error?.digest && <p style={{ color: "#666", fontSize: 13 }}>Reference: {error.digest}</p>}
      </body>
    </html>
  );
}
