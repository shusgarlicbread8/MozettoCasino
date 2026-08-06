import { Nav } from "./Nav";
import { Topbar } from "./Topbar";
import { PageFade } from "./PageFade";
import { WalletReconnect } from "./WalletReconnect";
import { LeaveGuardProvider } from "@/lib/leave-guard";
import { SessionProvider } from "@/lib/session";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <LeaveGuardProvider>
        <div style={{ display: "flex", minHeight: "100vh", width: "100%", background: "#080808" }}>
          <Nav />
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, width: "100%" }}>
            <Topbar />
            <PageFade>
              <WalletReconnect />
              {children}
            </PageFade>
          </div>
        </div>
      </LeaveGuardProvider>
    </SessionProvider>
  );
}
