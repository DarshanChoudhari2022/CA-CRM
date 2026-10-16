import type { Metadata } from "next";
import "./fonts.css";
import "./globals.css";
import "./workspace.css";
import "./brand-theme.css";

export const metadata: Metadata = {
  title: { default: "PSB Workspace", template: "%s | PSB Workspace" },
  description: "The private workspace for PSB & Associates LLP.",
  icons: { icon: "/brand/brand-icon.png" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <link
          rel="preload"
          href="/assets/fonts/dm-sans-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
