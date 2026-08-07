import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mozetto Admin",
  description: "Internal ops dashboard — MFA required in production.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-[#2a2a2a] px-6 py-3 flex items-center gap-6 text-sm">
          <strong>Mozetto Admin</strong>
          <nav className="flex gap-4 flex-wrap">
            <Link href="/">Dashboard</Link>
            <Link href="/solvency">Solvency</Link>
            <Link href="/treasury">Treasury</Link>
            <Link href="/governance">Governance</Link>
            <Link href="/sessions">Sessions</Link>
            <Link href="/randomness">Randomness</Link>
            <Link href="/ai">AI</Link>
            <Link href="/audit">Audit</Link>
            <Link href="/verify">Verify</Link>
          </nav>
          <span className="ml-auto muted text-xs">
            Separate deploy · RBAC · hardware MFA in front (prod)
          </span>
        </header>
        <main className="px-6 py-8 max-w-5xl">{children}</main>
      </body>
    </html>
  );
}
