import { Nav } from "./Nav";
import { Topbar } from "./Topbar";
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
            <div style={{ flex: 1, minWidth: 0, width: "100%", display: "flex", flexDirection: "column" }}>{children}</div>
          </div>
        </div>
      </LeaveGuardProvider>
    </SessionProvider>
  );
}
