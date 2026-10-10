import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "PSB Firm Portal", template: "%s | PSB Firm Portal" },
  description: "Attendance and leave management for P S B & Associates LLP.",
  icons: { icon: "/brand/brand-icon.png" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
