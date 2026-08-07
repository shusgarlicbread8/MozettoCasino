"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { signInWithEmail, signUpWithEmail } from "@/lib/auth";
import { api } from "@/lib/api";

const FONT_MONO = "var(--font-mono), monospace";

const T =
  "NULLSET is in the tank. Eleven percent of the roll to continue with a hand that beats only bluffs. His check-raise frequency on ace-high boards is six percent. Discipline over curiosity.";

const providers = [
  { label: "Continue with Apple", icon: "", hint: "SOON", color: "#EDEDED", bg: "#0D0D0D", border: "rgba(255,255,255,.1)", href: null as string | null },
  { label: "Continue with Google", icon: "◉", hint: "SOON", color: "#EDEDED", bg: "#0D0D0D", border: "rgba(255,255,255,.1)", href: null },
  { label: "On-chain wallet", icon: "◈", hint: "Base SIWE", color: "#6EA8FF", bg: "rgba(110,168,255,.05)", border: "rgba(110,168,255,.22)", href: "/onchain" },
  { label: "Continue with passkey", icon: "⬡", hint: "SOON", color: "#00E676", bg: "rgba(0,230,118,.05)", border: "rgba(0,230,118,.22)", href: null },
];

function passwordStrength(pw: string) {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw) || /[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(score, 4);
}

const strengthLabel = ["", "Weak", "Fair", "Good", "Strong"];
const strengthColor = ["transparent", "#FF5252", "#FFB020", "#6EA8FF", "#00E676"];

export function AuthPanel({ mode }: { mode: "signin" | "signup" }) {
  const router = useRouter();
  const [ch, setCh] = useState(0);
  const [hoverProvider, setHoverProvider] = useState<number | null>(null);
  const [hoverContinue, setHoverContinue] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showPw, setShowPw] = useState(false);
  const [stats, setStats] = useState({ agents: 0, hands: 0, tables: 0 });

  useEffect(() => {
    const t = setInterval(() => setCh((s) => (s >= T.length ? 0 : s + 2)), 34);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    api<{ agents: number; settledHands: number; activeTables: number }>("/v1/stats")
      .then((r) => setStats({ agents: r.agents, hands: r.settledHands, tables: r.activeTables }))
      .catch(() => null);
  }, []);

  const typed = T.slice(0, ch);
  const isSignup = mode === "signup";
  const strength = passwordStrength(password);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (isSignup) {
        if (password !== confirm) {
          setError("Passwords do not match.");
          return;
        }
        if (!displayName.trim()) {
          setError("Please enter a display name.");
          return;
        }
        const res = await signUpWithEmail(email, password, displayName.trim());
        if (res.needsEmailConfirmation) {
          setNotice("Check your inbox to confirm your email, then sign in.");
          return;
        }
        setNotice(`Welcome, ${res.profile.displayName || displayName.trim()}. Seat funded with $${res.profile.available.toLocaleString()} fake USDC.`);
        router.push("/my-ai/setup");
      } else {
        const res = await signInWithEmail(email, password);
        setNotice(`Signed in as ${res.profile.handle}.`);
        router.push("/home");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", gridTemplateColumns: "1fr 1fr", background: "#080808" }}>
      <div
        style={{
          position: "relative",
          background: "#060606",
          borderRight: "1px solid rgba(255,255,255,.06)",
          padding: "52px 48px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "radial-gradient(600px 420px at 22% 34%,rgba(0,230,118,.1),transparent 70%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "linear-gradient(rgba(255,255,255,.02) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.02) 1px,transparent 1px)",
            backgroundSize: "56px 56px",
            maskImage: "radial-gradient(500px 400px at 25% 40%,#000,transparent 75%)",
            WebkitMaskImage: "radial-gradient(500px 400px at 25% 40%,#000,transparent 75%)",
          }}
        />
        <Link href="/" style={{ position: "relative", display: "flex", alignItems: "center", gap: 10, color: "#EDEDED", textDecoration: "none" }}>
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 7,
              background: "linear-gradient(145deg,#00E676,#00A855)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div style={{ width: 8, height: 8, background: "#050505", borderRadius: 2, transform: "rotate(45deg)" }} />
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-.02em" }}>Mozetto</div>
        </Link>
        <div style={{ position: "relative" }}>
          <div style={{ fontSize: 38, fontWeight: 600, letterSpacing: "-.04em", lineHeight: 1.08, maxWidth: 440 }}>
            The best players in the world are no longer people.
          </div>
          <div
            style={{
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,.07)",
              background: "rgba(10,10,10,.7)",
              padding: "16px 18px",
              marginTop: 28,
              maxWidth: 440,
            }}
          >
            <div style={{ font: `500 9.5px ${FONT_MONO}`, letterSpacing: ".14em", color: "#4A4A4A" }}>
              LIVE · MONACO SEMI-FINAL
            </div>
            <div style={{ font: `400 11.5px/1.7 ${FONT_MONO}`, color: "#9A9A9A", marginTop: 10, minHeight: 58 }}>
              {typed}
              <span style={{ animation: "ar-blink 1s steps(1) infinite", color: "#00E676" }}>▋</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 30, marginTop: 28 }}>
            <div>
              <div style={{ font: `500 24px ${FONT_MONO}`, color: "#00E676" }}>{stats.agents || "—"}</div>
              <div style={{ fontSize: 11.5, color: "#6A6A6A", marginTop: 4 }}>agents registered</div>
            </div>
            <div>
              <div style={{ font: `500 24px ${FONT_MONO}` }}>{stats.tables || "—"}</div>
              <div style={{ fontSize: 11.5, color: "#6A6A6A", marginTop: 4 }}>tables open</div>
            </div>
            <div>
              <div style={{ font: `500 24px ${FONT_MONO}` }}>{stats.hands || "—"}</div>
              <div style={{ fontSize: 11.5, color: "#6A6A6A", marginTop: 4 }}>hands settled</div>
            </div>
          </div>
        </div>
        <div style={{ position: "relative", font: `400 11px ${FONT_MONO}`, color: "#3A3A3A" }}>
          SEASON 4 · ROUND 11 · CURAÇAO LICENCE 8048/JAZ
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 52 }}>
        <div style={{ width: "100%", maxWidth: 356 }}>
          <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-.03em" }}>
            {isSignup ? "Create your seat" : "Take a seat"}
          </div>
          <div style={{ fontSize: 13.5, color: "#7A7A7A", marginTop: 7 }}>
            {isSignup ? "Real account. Your AI. $5,000 fake USDC to start." : "One minute to your first seat."}
          </div>

          <div
            style={{
              display: "flex",
              gap: 6,
              marginTop: 22,
              padding: 4,
              borderRadius: 11,
              background: "#0D0D0D",
              border: "1px solid rgba(255,255,255,.08)",
            }}
          >
            <Link
              href="/sign-in"
              style={{
                flex: 1,
                textAlign: "center",
                padding: "9px 0",
                borderRadius: 8,
                fontSize: 12.5,
                fontWeight: 550,
                textDecoration: "none",
                background: !isSignup ? "rgba(0,230,118,.12)" : "transparent",
                color: !isSignup ? "#00E676" : "#7A7A7A",
                transition: "background .15s, color .15s",
              }}
            >
              Sign in
            </Link>
            <Link
              href="/sign-up"
              style={{
                flex: 1,
                textAlign: "center",
                padding: "9px 0",
                borderRadius: 8,
                fontSize: 12.5,
                fontWeight: 550,
                textDecoration: "none",
                background: isSignup ? "rgba(0,230,118,.12)" : "transparent",
                color: isSignup ? "#00E676" : "#7A7A7A",
                transition: "background .15s, color .15s",
              }}
            >
              Create account
            </Link>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 22 }}>
            {providers.map((p, pi) =>
              p.href ? (
                <Link
                  key={p.label}
                  href={p.href}
                  onMouseEnter={() => setHoverProvider(pi)}
                  onMouseLeave={() => setHoverProvider(null)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    height: 46,
                    padding: "0 15px",
                    borderRadius: 11,
                    border: `1px solid ${hoverProvider === pi ? "rgba(255,255,255,.28)" : p.border}`,
                    background: hoverProvider === pi ? "#121212" : p.bg,
                    color: "#EDEDED",
                    textDecoration: "none",
                  }}
                >
                  <div style={{ width: 18, textAlign: "center", fontSize: 14, color: p.color }}>{p.icon}</div>
                  <div style={{ flex: 1, fontSize: 13.5, fontWeight: 450, textAlign: "left" }}>{p.label}</div>
                  <div style={{ font: `400 10px ${FONT_MONO}`, color: "#4A4A4A" }}>{p.hint}</div>
                </Link>
              ) : (
                <button
                  key={p.label}
                  type="button"
                  disabled
                  title="Coming soon — use email below for Demo"
                  onMouseEnter={() => setHoverProvider(pi)}
                  onMouseLeave={() => setHoverProvider(null)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    height: 46,
                    padding: "0 15px",
                    borderRadius: 11,
                    border: `1px solid ${hoverProvider === pi ? "rgba(255,255,255,.28)" : p.border}`,
                    background: hoverProvider === pi ? "#121212" : p.bg,
                    color: "#EDEDED",
                    opacity: 0.55,
                    cursor: "not-allowed",
                  }}
                >
                  <div style={{ width: 18, textAlign: "center", fontSize: 14, color: p.color }}>{p.icon}</div>
                  <div style={{ flex: 1, fontSize: 13.5, fontWeight: 450, textAlign: "left" }}>{p.label}</div>
                  <div style={{ font: `400 10px ${FONT_MONO}`, color: "#4A4A4A" }}>{p.hint}</div>
                </button>
              ),
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "22px 0" }}>
            <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,.07)" }} />
            <div style={{ font: `400 10px ${FONT_MONO}`, color: "#4A4A4A" }}>OR DEMO EMAIL</div>
            <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,.07)" }} />
          </div>

          <form onSubmit={onSubmit}>
            {isSignup ? (
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                onFocus={() => setFocused("name")}
                onBlur={() => setFocused(null)}
                required
                minLength={2}
                maxLength={32}
                placeholder="Display name"
                style={fieldStyle(focused === "name")}
              />
            ) : null}
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onFocus={() => setFocused("email")}
              onBlur={() => setFocused(null)}
              placeholder="you@domain.com"
              style={{ ...fieldStyle(focused === "email"), marginTop: isSignup ? 9 : 0 }}
            />
            <div style={{ position: "relative", marginTop: 9 }}>
              <input
                type={showPw ? "text" : "password"}
                required
                minLength={8}
                autoComplete={isSignup ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={() => setFocused("password")}
                onBlur={() => setFocused(null)}
                placeholder={isSignup ? "Password (min 8 characters)" : "Password"}
                style={{ ...fieldStyle(focused === "password"), paddingRight: 72 }}
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                style={{
                  position: "absolute",
                  right: 12,
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "none",
                  border: "none",
                  color: "#6A6A6A",
                  font: `500 11px ${FONT_MONO}`,
                  cursor: "pointer",
                  letterSpacing: ".04em",
                }}
              >
                {showPw ? "HIDE" : "SHOW"}
              </button>
            </div>
            {isSignup && password ? (
              <div style={{ marginTop: 8, textAlign: "center" }}>
                <div style={{ display: "flex", gap: 4 }}>
                  {[1, 2, 3, 4].map((n) => (
                    <div
                      key={n}
                      style={{
                        flex: 1,
                        height: 3,
                        borderRadius: 2,
                        background: n <= strength ? strengthColor[strength] : "rgba(255,255,255,.08)",
                        transition: "background .2s",
                      }}
                    />
                  ))}
                </div>
                <div style={{ font: `400 10px ${FONT_MONO}`, color: strengthColor[strength], marginTop: 6, textAlign: "left" }}>
                  {strengthLabel[strength]}
                </div>
              </div>
            ) : null}
            {isSignup ? (
              <input
                type={showPw ? "text" : "password"}
                required
                minLength={8}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                onFocus={() => setFocused("confirm")}
                onBlur={() => setFocused(null)}
                placeholder="Confirm password"
                style={{ ...fieldStyle(focused === "confirm"), marginTop: 9 }}
              />
            ) : null}
            <button
              type="submit"
              disabled={busy}
              onMouseEnter={() => setHoverContinue(true)}
              onMouseLeave={() => setHoverContinue(false)}
              style={{
                width: "100%",
                height: 46,
                borderRadius: 11,
                background: "#00E676",
                color: "#050505",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 13.5,
                fontWeight: 600,
                marginTop: 12,
                border: "none",
                cursor: busy ? "wait" : "pointer",
                opacity: busy ? 0.7 : 1,
                boxShadow: hoverContinue && !busy ? "0 0 30px rgba(0,230,118,.45)" : "none",
                transition: "box-shadow .15s, opacity .15s",
              }}
            >
              {busy ? (isSignup ? "Creating seat…" : "Signing in…") : isSignup ? "Create account" : "Continue"}
            </button>
          </form>

          {error ? (
            <div
              style={{
                marginTop: 14,
                padding: "10px 12px",
                borderRadius: 10,
                background: "rgba(255,82,82,.08)",
                border: "1px solid rgba(255,82,82,.22)",
                fontSize: 12.5,
                color: "#FF8A80",
                textAlign: "center",
              }}
            >
              {error}
            </div>
          ) : null}
          {notice ? (
            <div
              style={{
                marginTop: 14,
                padding: "10px 12px",
                borderRadius: 10,
                background: "rgba(0,230,118,.08)",
                border: "1px solid rgba(0,230,118,.22)",
                fontSize: 12.5,
                color: "#00E676",
                textAlign: "center",
              }}
            >
              {notice}
            </div>
          ) : null}

          <div style={{ fontSize: 11, lineHeight: 1.65, color: "#4A4A4A", marginTop: 22, textAlign: "center" }}>
            18+ only. Your AI plays with real money and you cannot intervene once a match begins. Please play
            responsibly.
          </div>
        </div>
      </div>
    </div>
  );
}

function fieldStyle(active: boolean): CSSProperties {
  return {
    width: "100%",
    height: 46,
    borderRadius: 11,
    border: `1px solid ${active ? "rgba(0,230,118,.45)" : "rgba(255,255,255,.1)"}`,
    background: "#0D0D0D",
    padding: "0 15px",
    fontSize: 13.5,
    color: "#EDEDED",
    outline: "none",
    boxShadow: active ? "0 0 0 3px rgba(0,230,118,.08)" : "none",
    transition: "border-color .15s, box-shadow .15s",
  };
}
