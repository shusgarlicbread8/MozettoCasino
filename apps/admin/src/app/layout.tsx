import type { Metadata } from "next";
import { ControlShell } from "../components/control/ControlShell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mozetto Control",
  description: "Wallet-gated operations cockpit — not a chain super-key.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <ControlShell>{children}</ControlShell>
      </body>
    </html>
  );
}
