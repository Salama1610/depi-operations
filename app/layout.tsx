import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Freelance Yard Operations · DEPI Round 5",
  description: "DEPI Round 5 operations and student service-link verification.",
  icons: {
    icon: "/brand/logo.png",
    shortcut: "/brand/logo.png",
    apple: "/brand/logo-stacked.png",
  },
  other: {
    "codex-preview": "development",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* Brand typefaces: Bebas Neue for display, Montserrat for everything
            else. Arabic falls back to GE SS Two where it is installed, then to
            the system Arabic face, because GE SS Two is a licensed font and is
            not served from a public CDN. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- this is the root layout of the app router, so the font loads for every page */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Montserrat:wght@400;500;600;700&display=swap"
        />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
