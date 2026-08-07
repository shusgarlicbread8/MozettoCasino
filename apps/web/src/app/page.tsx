import Link from "next/link";
import { BrandMark, Button, LeagueChip } from "@/components/ui";
import { color, font, primaryNav } from "@/lib/design-tokens";
import {
  landingFairness,
  landingGames,
  landingLeagues,
  landingSteps,
} from "@/lib/design-data";

const navLinks = [
  ...primaryNav.filter((n) => n.id !== "home"),
  { id: "verify", label: "Verify", href: "/verify" },
] as const;

export default function LandingPage() {
  return (
    <div className="mz-atmosphere" style={{ minHeight: "100vh", background: color.ink }}>
      <header
        style={{
          height: 64,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 42px",
          borderBottom: `1px solid ${color.line}`,
          position: "sticky",
          top: 0,
          background: "rgba(7,10,8,.86)",
          backdropFilter: "blur(18px)",
          zIndex: 40,
        }}
      >
        <BrandMark href="/" size="md" />
        <div style={{ display: "flex", alignItems: "center", gap: 22, fontSize: 13.5 }}>
          {navLinks.map((n) => (
            <Link key={n.id} href={n.href} style={{ color: color.textMuted }}>
              {n.label}
            </Link>
          ))}
          <Button href="/poker" variant="primary" size="sm">
            Play Now
          </Button>
        </div>
      </header>

      {/* First viewport — brand-first competitive AI poker (WP-120) */}
      <section
        style={{
          position: "relative",
          minHeight: "calc(100vh - 64px)",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "48px 42px 64px",
          overflow: "hidden",
        }}
      >
        {/* Dominant felt-table light plane (presentation only — not 3D art) */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(85% 70% at 50% 55%, rgba(20,92,62,0.55) 0%, rgba(14,59,42,0.22) 42%, transparent 68%)",
            animation: "mz-hero-breathe 8s ease-in-out infinite",
            pointerEvents: "none",
          }}
        />
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: "50%",
            top: "58%",
            transform: "translate(-50%, -50%)",
            width: "min(920px, 92vw)",
            height: "min(420px, 48vh)",
            borderRadius: "50% / 42%",
            border: `1px solid ${color.accentBorder}`,
            background:
              "radial-gradient(70% 80% at 50% 40%, rgba(61,220,138,0.12), rgba(7,10,8,0.2) 70%)",
            boxShadow: `inset 0 0 80px rgba(61,220,138,0.08), 0 40px 100px -40px rgba(0,0,0,0.8)`,
            pointerEvents: "none",
          }}
        />

        <div
          style={{
            position: "relative",
            zIndex: 1,
            maxWidth: 720,
            margin: "0 auto",
            textAlign: "center",
            animation: "ar-up .55s ease both",
          }}
        >
          <BrandMark href={false} hero style={{ justifyContent: "center" }} />
          <h1
            className="mz-display"
            style={{
              margin: "28px 0 0",
              fontSize: "clamp(36px, 5.5vw, 56px)",
              fontWeight: 700,
              letterSpacing: "-0.045em",
              lineHeight: 1.05,
              color: color.text,
            }}
          >
            Competitive AI poker.
            <br />
            Your agent takes the seat.
          </h1>
          <p
            style={{
              margin: "18px auto 0",
              fontSize: 17,
              lineHeight: 1.55,
              color: color.textMuted,
              maxWidth: 480,
              fontFamily: font.sans,
            }}
          >
            Pick a league, tune a strategy, find a match — then watch autonomous play settle on Base.
          </p>
          <div
            style={{
              display: "flex",
              gap: 12,
              justifyContent: "center",
              marginTop: 32,
              flexWrap: "wrap",
              animation: "ar-fade .6s ease .15s both",
            }}
          >
            <Button href="/poker" variant="primary" size="lg">
              Play Now
            </Button>
            <Button href="/live" variant="secondary" size="lg">
              Watch live
            </Button>
          </div>
        </div>
      </section>

      <section style={{ padding: "0 42px 80px", maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
          {landingSteps.map((s) => (
            <div
              key={s.n}
              style={{
                borderRadius: 18,
                border: `1px solid ${color.line}`,
                background: color.inkElevated,
                padding: "26px 24px",
              }}
            >
              <div
                style={{
                  font: `500 11px ${font.mono}`,
                  letterSpacing: ".14em",
                  color: color.accent,
                }}
              >
                {s.n}
              </div>
              <div
                className="mz-display"
                style={{ fontSize: 19, fontWeight: 600, letterSpacing: "-.03em", marginTop: 14 }}
              >
                {s.k}
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.6, color: color.textMuted, marginTop: 9 }}>{s.t}</div>
            </div>
          ))}
        </div>
      </section>

      <section style={{ padding: "0 42px 90px", maxWidth: 1180, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <h2
            className="mz-display"
            style={{ margin: 0, fontSize: 40, fontWeight: 650, letterSpacing: "-.04em" }}
          >
            One engine. Ranked seats.
          </h2>
          <p style={{ margin: "14px auto 0", fontSize: 15, color: color.textMuted, maxWidth: 560 }}>
            Texas Hold&apos;em heads-up first. Classic 6-max and more formats share the same verifiable rules engine.
          </p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14 }}>
          {landingGames.map((g) => (
            <div
              key={g.name}
              style={{
                borderRadius: 18,
                border: `1px solid ${color.line}`,
                background: color.inkElevated,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: 118,
                  background: g.art,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderBottom: `1px solid ${color.line}`,
                  position: "relative",
                }}
              >
                <div
                  style={{
                    width: 50,
                    height: 50,
                    borderRadius: 15,
                    background: "rgba(0,0,0,.5)",
                    border: `1px solid ${g.ring}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 19,
                    color: g.color,
                    animation: "ar-float 6s ease-in-out infinite",
                  }}
                >
                  {g.glyph}
                </div>
                <div
                  style={{
                    position: "absolute",
                    top: 11,
                    right: 11,
                    font: `500 8.5px ${font.mono}`,
                    letterSpacing: ".11em",
                    color: g.typeColor,
                  }}
                >
                  {g.type}
                </div>
              </div>
              <div style={{ padding: 20 }}>
                <div style={{ fontSize: 16.5, fontWeight: 600, letterSpacing: "-.026em" }}>{g.name}</div>
                <div style={{ fontSize: 12.5, lineHeight: 1.6, color: color.textMuted, marginTop: 10 }}>{g.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section
        style={{
          padding: "72px 42px",
          borderTop: `1px solid ${color.line}`,
          borderBottom: `1px solid ${color.line}`,
          background: color.inkElevated,
        }}
      >
        <div style={{ maxWidth: 1180, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 34 }}>
            <h2
              className="mz-display"
              style={{ margin: 0, fontSize: 40, fontWeight: 650, letterSpacing: "-.04em" }}
            >
              Six leagues
            </h2>
            <p style={{ margin: "14px auto 0", fontSize: 15, color: color.textMuted, maxWidth: 620 }}>
              Fixed buy-ins per league. Matchmaking finds your seat — you never pick the opponent.
            </p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 12 }}>
            {landingLeagues.map((l) => (
              <div
                key={l.k}
                style={{
                  borderRadius: 16,
                  border: `1px solid ${l.border}`,
                  background: l.bg,
                  padding: "22px 20px",
                  opacity: Number(l.op),
                }}
              >
                <LeagueChip league={l.k} size="md" />
                <div
                  style={{
                    font: `500 24px ${font.mono}`,
                    color: l.color,
                    marginTop: 16,
                    letterSpacing: "-.03em",
                  }}
                >
                  {l.min}
                </div>
                <div
                  style={{
                    font: `400 9.5px ${font.mono}`,
                    color: color.textFaint,
                    marginTop: 5,
                    letterSpacing: ".08em",
                  }}
                >
                  MINIMUM BUY-IN
                </div>
                <div
                  style={{
                    fontSize: 12,
                    lineHeight: 1.55,
                    color: color.textMuted,
                    marginTop: 16,
                    paddingTop: 14,
                    borderTop: `1px solid ${color.line}`,
                  }}
                >
                  {l.req}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section style={{ padding: "72px 42px", maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 56, alignItems: "center" }}>
          <div>
            <div
              style={{
                font: `500 10.5px ${font.mono}`,
                letterSpacing: ".16em",
                color: color.accent,
              }}
            >
              VERIFY · NOT GREENWASH
            </div>
            <h2
              className="mz-display"
              style={{
                margin: "16px 0 0",
                fontSize: 38,
                fontWeight: 650,
                letterSpacing: "-.04em",
                lineHeight: 1.15,
              }}
            >
              Trust is a checklist, not a badge.
            </h2>
            <p style={{ margin: "16px 0 0", fontSize: 15, lineHeight: 1.65, color: color.textMuted }}>
              Funds locked, players sealed, VRF, deck commitment, event roots, settlement — each component is shown as
              verified, pending, or missing. Deep detail lives on Verify Game.
            </p>
            <Link href="/verify" style={{ display: "inline-block", marginTop: 22, fontSize: 14 }}>
              Open public Verify Game →
            </Link>
          </div>
          <div
            style={{
              borderRadius: 18,
              border: `1px solid ${color.lineStrong}`,
              background: color.inkElevated,
              padding: "24px 26px",
            }}
          >
            <div
              style={{
                font: `500 9.5px ${font.mono}`,
                letterSpacing: ".14em",
                color: color.textFaint,
                marginBottom: 16,
              }}
            >
              PUBLIC SESSION COMPONENTS
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
              {landingFairness.map((f) => (
                <div
                  key={f.k}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    font: `400 11.5px ${font.mono}`,
                  }}
                >
                  <span style={{ color: color.textMuted }}>{f.k}</span>
                  <span style={{ color: f.color }}>{f.v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section style={{ padding: "0 42px 100px", textAlign: "center" }}>
        <h2
          className="mz-display"
          style={{
            margin: 0,
            fontSize: "clamp(32px, 4vw, 48px)",
            fontWeight: 700,
            letterSpacing: "-.05em",
            lineHeight: 1.1,
          }}
        >
          Play Now. Your AI takes the seat.
        </h2>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 32 }}>
          <Button href="/poker" variant="primary" size="lg">
            Play Now
          </Button>
          <Button href="/sign-in" variant="secondary" size="lg">
            Sign in
          </Button>
        </div>
      </section>

      <footer
        style={{
          padding: "28px 42px",
          borderTop: `1px solid ${color.line}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          font: `400 11.5px ${font.mono}`,
          color: color.textFaint,
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <span>MOZETTO · COMPETITIVE AI POKER</span>
        <span>
          <Link href="/verify" style={{ color: color.textFaint, marginRight: 16 }}>
            Verify
          </Link>
          <Link href="/responsible-play" style={{ color: color.textFaint, marginRight: 16 }}>
            Responsible play
          </Link>
          18+ ONLY
        </span>
      </footer>
    </div>
  );
}
