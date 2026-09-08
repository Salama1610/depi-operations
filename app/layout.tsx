import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DEPI Operations · Round 5",
  description: "Staff-only coaching and freelancing operations for Career180 and Freelance Yard.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
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
