import type { Metadata } from "next";
import { Libre_Baskerville, Manrope } from "next/font/google";
import "./globals.css";

const brandSerif = Libre_Baskerville({ subsets: ["latin"], weight: "400", variable: "--font-brand-serif" });
const brandSans = Manrope({ subsets: ["latin"], variable: "--font-brand-sans" });

export const metadata: Metadata = {
  title: { default: "PSB Workspace", template: "%s | PSB Workspace" },
  description: "The private workspace for PSB & Associates LLP.",
  icons: { icon: "/brand/brand-icon.png" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${brandSerif.variable} ${brandSans.variable}`}>{children}</body>
    </html>
  );
}
