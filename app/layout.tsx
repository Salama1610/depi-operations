import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DEPI Operations · Round 5",
  description: "DEPI Round 5 operations and student service-link verification.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
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
      <body className="antialiased">{children}</body>
    </html>
  );
}
