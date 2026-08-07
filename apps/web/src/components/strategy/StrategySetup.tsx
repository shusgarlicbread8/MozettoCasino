"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui";
import { color, font, radius, space } from "@/lib/design-tokens";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import {
  AXIS_DELTA_MAX,
  CONSUMER_TRAITS,
  STRATEGY_PRESET_LIST,
  STRATEGY_PRESETS,
  buildBehaviorPreview,
  clampTraitToEnvelope,
  defaultOverridesForPreset,
  resolveAxes,
  shortHex,
  traitBounds,
  type ConsumerTraitId,
  type ConsumerTraitOverrides,
  type StrategyProfileKey,
} from "@/lib/strategy-profiles";
import { readStrategyDraft, writeStrategyDraft } from "@/lib/strategy-store";

type Props = {
  /** Compact mode for embed / setup route. */
  compact?: boolean;
};

export function StrategySetup({ compact = false }: Props) {
  const { me, refresh } = useSession();
  const [mounted, setMounted] = useState(false);
  const [profileKey, setProfileKey] = useState<StrategyProfileKey>("fox");
  const [traits, setTraits] = useState<ConsumerTraitOverrides>(() => defaultOverridesForPreset("fox"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    const draft = readStrategyDraft(me?.config?.profile_key);
    setProfileKey(draft.profileKey);
    setTraits(draft.traits);
  }, [me?.config?.profile_key]);

  const preset = STRATEGY_PRESETS[profileKey];
  const axes = useMemo(() => resolveAxes(profileKey, traits), [profileKey, traits]);
  const preview = useMemo(() => buildBehaviorPreview(profileKey, axes), [profileKey, axes]);
  const dirtyVsPreset = CONSUMER_TRAITS.some((t) => traits[t.id] !== preset.axes[t.axis]);

  function selectProfile(key: StrategyProfileKey) {
    setProfileKey(key);
    setTraits(defaultOverridesForPreset(key));
    setNotice(null);
    setError(null);
  }

  function setTrait(id: ConsumerTraitId, value: number) {
    setTraits((prev) => ({
      ...prev,
      [id]: clampTraitToEnvelope(profileKey, id, value),
    }));
    setNotice(null);
  }

  function resetTraits() {
    setTraits(defaultOverridesForPreset(profileKey));
    setNotice(null);
  }

  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      writeStrategyDraft({ profileKey, traits });
      await api("/v1/me/agent", {
        method: "PATCH",
        body: JSON.stringify({ profileKey, risk: "balanced" }),
      });
      await refresh();
      setNotice(`Strategy locked preference: ${preset.label}. Find Match will commit ${shortHex(preset.profileConfigHash)}.`);
    } catch (e) {
      // Still persist local draft so Find Match can read profileKey offline.
      writeStrategyDraft({ profileKey, traits });
      setError(e instanceof Error ? e.message : "Could not sync to account — draft saved locally.");
    } finally {
      setBusy(false);
    }
  }

  if (!mounted) {
    return (
      <main style={{ flex: 1, padding: compact ? "20px 22px" : "26px 28px 56px", maxWidth: 1100 }}>
        <div style={{ color: color.textMuted, fontFamily: font.sans, fontSize: 14 }}>Loading strategy…</div>
      </main>
    );
  }

  return (
    <main
      style={{
        flex: 1,
        padding: compact ? "20px 22px 40px" : "26px 28px 56px",
        maxWidth: 1100,
        animation: "ar-fade 0.45s ease both",
      }}
    >
      <header style={{ marginBottom: space[6] }}>
        <div
          className="mz-mono"
          style={{
            fontSize: 10.5,
            letterSpacing: "0.14em",
            color: color.textFaint,
            textTransform: "uppercase",
          }}
        >
          AI / Strategy
        </div>
        <h1
          className="mz-display"
          style={{
            margin: "8px 0 0",
            fontSize: compact ? 28 : 36,
            fontWeight: 700,
            letterSpacing: "-0.03em",
            color: color.text,
          }}
        >
          Tune your AI
        </h1>
        <p
          style={{
            margin: "10px 0 0",
            maxWidth: 540,
            fontSize: 14.5,
            lineHeight: 1.55,
            color: color.textMuted,
            fontFamily: font.sans,
          }}
        >
          Pick a profile, nudge bounded traits, preview behavior. No return promises — style only. The
          profile hash locks when you Find Match.
        </p>
      </header>

      {/* Profile picker */}
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 12,
        }}
      >
        {STRATEGY_PRESET_LIST.map((p) => {
          const active = p.key === profileKey;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => selectProfile(p.key)}
              style={{
                textAlign: "left",
                padding: "16px 16px 14px",
                borderRadius: radius.lg,
                border: `1px solid ${active ? p.color : color.lineStrong}`,
                background: active
                  ? `linear-gradient(160deg, ${p.color}22, ${color.inkPanel} 55%)`
                  : color.inkElevated,
                cursor: "pointer",
                transition: "border-color 0.2s ease, transform 0.18s ease, background 0.2s ease",
                transform: active ? "translateY(-2px)" : undefined,
                boxShadow: active ? `0 12px 36px ${p.color}18` : undefined,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 12,
                    display: "grid",
                    placeItems: "center",
                    fontSize: 16,
                    color: p.color,
                    border: `1px solid ${p.color}55`,
                    background: "rgba(0,0,0,0.35)",
                    animation: active ? "ar-float 5.5s ease-in-out infinite" : undefined,
                  }}
                >
                  {p.glyph}
                </span>
                <div>
                  <div
                    className="mz-display"
                    style={{ fontSize: 17, fontWeight: 650, letterSpacing: "-0.02em", color: color.text }}
                  >
                    {p.label}
                  </div>
                  <div className="mz-mono" style={{ fontSize: 10, color: p.color, marginTop: 2, letterSpacing: "0.06em" }}>
                    {p.intent.toUpperCase()}
                  </div>
                </div>
              </div>
              <p style={{ margin: "12px 0 0", fontSize: 12.5, lineHeight: 1.5, color: color.textMuted }}>
                {p.blurb}
              </p>
            </button>
          );
        })}
      </section>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: compact ? "1fr" : "repeat(auto-fit, minmax(300px, 1fr))",
          gap: 14,
          marginTop: 16,
          alignItems: "start",
        }}
      >
        {/* Sliders */}
        <section
          style={{
            borderRadius: radius.xl,
            border: `1px solid ${color.line}`,
            background: color.inkElevated,
            padding: "22px 24px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
            <div>
              <div style={{ fontSize: 15.5, fontWeight: 600, letterSpacing: "-0.02em", fontFamily: font.sans }}>
                Bounded traits
              </div>
              <div className="mz-mono" style={{ fontSize: 10.5, color: color.textFaint, marginTop: 4 }}>
                ±{AXIS_DELTA_MAX} FROM {preset.label.toUpperCase()} PRESET · 0–100
              </div>
            </div>
            <button
              type="button"
              onClick={resetTraits}
              disabled={!dirtyVsPreset}
              className="mz-mono"
              style={{
                background: "transparent",
                border: "none",
                color: dirtyVsPreset ? color.accent : color.textFaint,
                fontSize: 11,
                cursor: dirtyVsPreset ? "pointer" : "default",
                letterSpacing: "0.08em",
              }}
            >
              RESET
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 18, marginTop: 20 }}>
            {CONSUMER_TRAITS.map((trait) => {
              const bounds = traitBounds(profileKey, trait.id);
              const value = traits[trait.id] ?? bounds.base;
              return (
                <label key={trait.id} style={{ display: "block" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <span style={{ fontSize: 13.5, fontWeight: 550, color: color.text, fontFamily: font.sans }}>
                      {trait.label}
                    </span>
                    <span className="mz-mono" style={{ fontSize: 12, color: preset.color }}>
                      {value}
                      <span style={{ color: color.textFaint }}> / {bounds.base}</span>
                    </span>
                  </div>
                  <input
                    type="range"
                    min={bounds.min}
                    max={bounds.max}
                    value={value}
                    onChange={(e) => setTrait(trait.id, Number(e.target.value))}
                    style={{
                      width: "100%",
                      marginTop: 8,
                      accentColor: preset.color,
                      cursor: "pointer",
                    }}
                  />
                  <div style={{ fontSize: 11.5, color: color.textFaint, marginTop: 4, lineHeight: 1.45 }}>
                    {trait.hint}
                  </div>
                </label>
              );
            })}
          </div>
        </section>

        {/* Preview + hash lock */}
        <aside style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <section
            style={{
              borderRadius: radius.xl,
              border: `1px solid ${preset.color}40`,
              background: `linear-gradient(165deg, ${preset.color}14, ${color.inkElevated} 50%)`,
              padding: "22px 22px 20px",
              animation: "ar-up 0.5s ease both",
            }}
          >
            <div className="mz-mono" style={{ fontSize: 10, letterSpacing: "0.14em", color: color.textFaint }}>
              BEHAVIORAL PREVIEW
            </div>
            <div
              className="mz-display"
              style={{ fontSize: 22, fontWeight: 700, marginTop: 8, letterSpacing: "-0.02em", color: color.text }}
            >
              {preset.glyph} {preset.label}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 18 }}>
              {preview.bars.map((bar) => (
                <div key={bar.id}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5 }}>
                    <span style={{ color: color.textMuted }}>{bar.label}</span>
                    <span className="mz-mono" style={{ color: bar.color }}>
                      {bar.value}
                    </span>
                  </div>
                  <div
                    style={{
                      height: 6,
                      borderRadius: 4,
                      background: "rgba(255,255,255,0.06)",
                      marginTop: 5,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${bar.value}%`,
                        borderRadius: 4,
                        background: bar.color,
                        transition: "width 0.28s ease",
                        boxShadow: `0 0 12px ${bar.color}55`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <ul
              style={{
                margin: "18px 0 0",
                padding: "0 0 0 16px",
                display: "flex",
                flexDirection: "column",
                gap: 8,
                color: color.textMuted,
                fontSize: 12.5,
                lineHeight: 1.5,
              }}
            >
              {preview.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>

            <div
              style={{
                marginTop: 16,
                paddingTop: 14,
                borderTop: `1px solid ${color.line}`,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {preview.tradeoffs.map((t) => (
                <div key={t} className="mz-mono" style={{ fontSize: 10.5, color: color.warn, lineHeight: 1.45 }}>
                  {t}
                </div>
              ))}
            </div>
          </section>

          <section
            style={{
              borderRadius: radius.xl,
              border: `1px solid ${color.line}`,
              background: color.inkPanel,
              padding: "18px 20px",
            }}
          >
            <div className="mz-mono" style={{ fontSize: 10, letterSpacing: "0.14em", color: color.textFaint }}>
              HASH LOCK · FIND MATCH
            </div>
            <div style={{ marginTop: 10, fontSize: 12.5, color: color.textMuted, lineHeight: 1.5 }}>
              Seat ticket field <span className="mz-mono" style={{ color: color.text }}>profileConfigHash</span>{" "}
              commits when you queue. Mid-match edits do not apply.
            </div>
            <HashRow label="presetId" value={preset.presetId} />
            <HashRow label="profileConfigHash" value={preset.profileConfigHash} accent={preset.color} />
            {dirtyVsPreset ? (
              <div className="mz-mono" style={{ fontSize: 10.5, color: color.textFaint, marginTop: 10, lineHeight: 1.45 }}>
                Trait deltas preview locally. Season 1 queue locks the preset seed hash by profile key;
                full PROFILE_V1 axis envelope hashing is ready in agent-runtime for a later API accept path.
              </div>
            ) : null}
          </section>
        </aside>
      </div>

      <footer
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "center",
          marginTop: 20,
        }}
      >
        <Button size="lg" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save strategy"}
        </Button>
        <Button href="/poker" variant="secondary" size="lg">
          Find Match
        </Button>
        {error ? (
          <span style={{ fontSize: 13, color: color.danger }}>{error}</span>
        ) : notice ? (
          <span style={{ fontSize: 13, color: color.accent }}>{notice}</span>
        ) : (
          <span className="mz-mono" style={{ fontSize: 11, color: color.textFaint }}>
            NO FREE-TEXT PROMPTS · NO CHAIN-OF-THOUGHT EDITOR
          </span>
        )}
      </footer>

    </main>
  );
}

function HashRow({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div className="mz-mono" style={{ fontSize: 10, color: color.textFaint, letterSpacing: "0.1em" }}>
        {label}
      </div>
      <div
        className="mz-mono"
        title={value}
        style={{
          marginTop: 4,
          fontSize: 12,
          color: accent ?? color.text,
          wordBreak: "break-all",
        }}
      >
        {shortHex(value, 10, 8)}
      </div>
    </div>
  );
}
