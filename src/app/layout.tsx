import type { Metadata } from "next";
import "./globals.css";
import "./workspace.css";

export const metadata: Metadata = {
  title: { default: "PSB Workspace", template: "%s | PSB Workspace" },
  description: "The private workspace for PSB & Associates LLP.",
  icons: { icon: "/brand/brand-icon.png" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
