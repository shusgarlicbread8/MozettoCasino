import { Nav } from "./Nav";
import { MobileTabBar } from "./MobileTabBar";
import { Topbar } from "./Topbar";
import { PageFade } from "./PageFade";
import { WalletReconnect } from "./WalletReconnect";
import { DebugTerminal } from "./DebugTerminal";
import { LeaveGuardProvider } from "@/lib/leave-guard";
import { SessionProvider } from "@/lib/session";
import { color } from "@/lib/design-tokens";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <LeaveGuardProvider>
        <div
          className="mz-atmosphere mz-app-shell"
          style={{ display: "flex", minHeight: "100vh", width: "100%", background: color.ink }}
        >
          <Nav />
          <div
            className="mz-app-main"
            style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, width: "100%" }}
          >
            <Topbar />
            <PageFade>
              <WalletReconnect />
              {children}
            </PageFade>
          </div>
          <MobileTabBar />
          <DebugTerminal />
        </div>
      </LeaveGuardProvider>
    </SessionProvider>
  );
}
