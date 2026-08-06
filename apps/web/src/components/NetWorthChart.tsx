"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { api } from "@/lib/api";
import { money } from "@/lib/session";

const FONT_MONO = "var(--font-geist-mono), monospace";
const RANGES = ["1h", "1d", "1w", "all"] as const;
type Range = (typeof RANGES)[number];

type Point = {
  t: string;
  total: number;
  wallet: number;
  locked: number;
  legacy: number;
};

type NetWorthResponse = {
  range: Range;
  points: Point[];
};

export function NetWorthChart() {
  const reduceMotion = useReducedMotion();
  const [range, setRange] = useState<Range>("1d");
  const [points, setPoints] = useState<Point[]>([]);
  const [hover, setHover] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<NetWorthResponse>(`/v1/wallet/net-worth?range=${range}`);
      setPoints(r.points || []);
    } catch {
      setPoints([]);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  const { path, area, min, max, start, end, pnl } = useMemo(() => {
    if (points.length === 0) {
      return { path: "", area: "", min: 0, max: 0, start: 0, end: 0, pnl: 0 };
    }
    const vals = points.map((p) => p.total);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const pad = hi === lo ? Math.max(1, hi * 0.05) : (hi - lo) * 0.12;
    const yMin = lo - pad;
    const yMax = hi + pad;
    const w = 100;
    const h = 40;
    const coords = points.map((p, i) => {
      const x = points.length === 1 ? w / 2 : (i / (points.length - 1)) * w;
      const y = h - ((p.total - yMin) / (yMax - yMin)) * h;
      return { x, y, ...p };
    });
    const d = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(2)} ${c.y.toFixed(2)}`).join(" ");
    const a = `${d} L ${coords[coords.length - 1]!.x.toFixed(2)} ${h} L ${coords[0]!.x.toFixed(2)} ${h} Z`;
    const s = points[0]!.total;
    const e = points[points.length - 1]!.total;
    return { path: d, area: a, min: lo, max: hi, start: s, end: e, pnl: e - s };
  }, [points]);

  const active = hover != null ? points[hover] : points[points.length - 1];

  return (
    <div
      style={{
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,.07)",
        background: "#0A0A0A",
        marginTop: 14,
        padding: "18px 20px 16px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ font: `400 10px ${FONT_MONO}`, letterSpacing: ".12em", color: "#5A5A5A" }}>NET WORTH</div>
          <div style={{ font: `500 22px ${FONT_MONO}`, marginTop: 6, color: "#EDEDED" }}>
            {active ? money(active.total) : "—"}
          </div>
          <div style={{ fontSize: 12, color: "#6A6A6A", marginTop: 4 }}>
            {points.length >= 2 ? (
              <>
                {money(start)} → {money(end)} ·{" "}
                <span style={{ color: pnl >= 0 ? "#00E676" : "#FF8A8A" }}>
                  {pnl >= 0 ? "+" : "−"}
                  {money(Math.abs(pnl))}
                </span>
              </>
            ) : (
              "Wallet + locked + Mozetto idle"
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              style={{
                padding: "5px 10px",
                borderRadius: 6,
                border: "none",
                cursor: "pointer",
                font: `500 10px ${FONT_MONO}`,
                letterSpacing: ".06em",
                background: range === r ? "rgba(255,255,255,.1)" : "transparent",
                color: range === r ? "#EDEDED" : "#5A5A5A",
              }}
            >
              {r.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 14, height: 140, position: "relative" }}>
        {loading && points.length === 0 ? (
          <div style={{ height: "100%", display: "grid", placeItems: "center", color: "#5A5A5A", font: `400 12px ${FONT_MONO}` }}>
            Loading…
          </div>
        ) : points.length < 2 ? (
          <div style={{ height: "100%", display: "grid", placeItems: "center", color: "#5A5A5A", font: `400 12px ${FONT_MONO}`, textAlign: "center", lineHeight: 1.5 }}>
            Chart builds as your wallet balance changes.
            <br />
            Get Test mUSDC or join a match to seed history.
          </div>
        ) : (
          <svg
            viewBox="0 0 100 40"
            preserveAspectRatio="none"
            style={{ width: "100%", height: "100%" }}
            onMouseLeave={() => setHover(null)}
          >
            <defs>
              <linearGradient id="nwFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgba(0,230,118,.35)" />
                <stop offset="100%" stopColor="rgba(0,230,118,0)" />
              </linearGradient>
            </defs>
            <motion.path
              d={area}
              fill="url(#nwFill)"
              initial={reduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.45 }}
            />
            <motion.path
              d={path}
              fill="none"
              stroke="#00E676"
              strokeWidth="0.6"
              vectorEffect="non-scaling-stroke"
              initial={reduceMotion ? false : { pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            />
            {points.map((_, i) => {
              const x = points.length === 1 ? 50 : (i / (points.length - 1)) * 100;
              return (
                <rect
                  key={i}
                  x={x - 100 / points.length / 2}
                  y={0}
                  width={Math.max(100 / points.length, 1)}
                  height={40}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                />
              );
            })}
          </svg>
        )}
      </div>
      {active && points.length >= 2 && (
        <div style={{ marginTop: 8, font: `400 11px ${FONT_MONO}`, color: "#5A5A5A" }}>
          {new Date(active.t).toLocaleString()} · wallet {money(active.wallet)} · locked {money(active.locked)}
          {active.legacy > 0 ? ` · Mozetto ${money(active.legacy)}` : ""}
          {max > min ? ` · range ${money(min)}–${money(max)}` : ""}
        </div>
      )}
    </div>
  );
}
