"use client";

import { useState } from "react";
import { HoverDiv } from "@/components/Hoverable";

const MONO = "var(--font-mono), monospace";

const ITEMS = [
  { cat: "AVATAR", name: "Obsidian Mask", desc: "A matte black avatar frame with a slow emerald sheen.", glyph: "◆", color: "#00E676", rarity: "RARE", price: "$4.00", tone: "rgba(0,230,118,.14)" },
  { cat: "AVATAR", name: "Paper Fox", desc: "Folded-paper avatar in warm amber.", glyph: "✦", color: "#FFB020", rarity: "COMMON", price: "$2.00", tone: "rgba(255,177,32,.14)" },
  { cat: "AVATAR", name: "Deep Blue", desc: "Cold analytical avatar for patient players.", glyph: "◈", color: "#6EA8FF", rarity: "COMMON", price: "$2.00", tone: "rgba(110,168,255,.14)" },
  { cat: "AVATAR", name: "Crimson Edge", desc: "Sharp red frame with a pressure-pulse animation.", glyph: "●", color: "#FF5252", rarity: "RARE", price: "$4.00", tone: "rgba(255,82,82,.14)" },
  { cat: "CARD BACK", name: "Emerald Weave", desc: "Woven green card back with a fine gold thread.", glyph: "▤", color: "#00E676", rarity: "OWNED", price: "Owned", tone: "rgba(0,230,118,.1)" },
  { cat: "CARD BACK", name: "Midnight Grid", desc: "Terminal-blue grid on near-black stock.", glyph: "▦", color: "#6EA8FF", rarity: "COMMON", price: "$1.50", tone: "rgba(110,168,255,.1)" },
  { cat: "CARD BACK", name: "Bone Ivory", desc: "Warm ivory back with a debossed monogram.", glyph: "▥", color: "#EDEDED", rarity: "RARE", price: "$3.00", tone: "rgba(255,255,255,.08)" },
  { cat: "TABLE SKIN", name: "Monte Felt", desc: "Classic deep-green felt with a brass rail.", glyph: "⬮", color: "#00E676", rarity: "OWNED", price: "Owned", tone: "rgba(0,230,118,.1)" },
  { cat: "TABLE SKIN", name: "Slate Room", desc: "Charcoal felt, cool white lighting, no ornament.", glyph: "⬯", color: "#BABABA", rarity: "COMMON", price: "$3.00", tone: "rgba(255,255,255,.07)" },
  { cat: "TABLE SKIN", name: "Amber Lounge", desc: "Low amber light and oxblood leather trim.", glyph: "⬬", color: "#FFB020", rarity: "LEGENDARY", price: "$8.00", tone: "rgba(255,177,32,.14)" },
  { cat: "ANIMATION", name: "Slow Arrival", desc: "Your AI fades in from smoke as the match opens.", glyph: "⟡", color: "#C89BFF", rarity: "RARE", price: "$5.00", tone: "rgba(200,155,255,.14)" },
  { cat: "ANIMATION", name: "Clean Sweep", desc: "Victory animation: the pot slides in one motion.", glyph: "⟶", color: "#00E676", rarity: "RARE", price: "$5.00", tone: "rgba(0,230,118,.14)" },
];

const RC: Record<string, string> = { COMMON: "#6A6A6A", RARE: "#6EA8FF", LEGENDARY: "#FFB020", OWNED: "#00E676" };
const TABS = ["ALL", "AVATAR", "CARD BACK", "TABLE SKIN", "ANIMATION"];

export default function ShopPage() {
  const [tab, setTab] = useState(0);
  const t = TABS[tab];
  const items = ITEMS.filter((i) => t === "ALL" || i.cat === t);

  return (
    <main style={{ flex: 1, padding: "26px 28px 56px", maxWidth: 1180 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 29, fontWeight: 600, letterSpacing: "-.035em" }}>Shop</h1>
          <p style={{ margin: "8px 0 0", fontSize: 13.5, color: "#7A7A7A" }}>Looks only. Nothing here changes how your AI plays or gives any advantage at the table.</p>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {TABS.map((k, i) => (
            <HoverDiv
              key={k}
              onClick={() => setTab(i)}
              style={{
                padding: "8px 15px",
                borderRadius: 9,
                font: `500 11px ${MONO}`,
                letterSpacing: ".04em",
                cursor: "pointer",
                background: tab === i ? "rgba(0,230,118,.09)" : "transparent",
                border: `1px solid ${tab === i ? "rgba(0,230,118,.35)" : "rgba(255,255,255,.09)"}`,
                color: tab === i ? "#00E676" : "#6A6A6A",
                transition: "all .18s",
              }}
              hoverStyle={{}}
            >
              {k}
            </HoverDiv>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginTop: 20 }}>
        {items.map((i) => {
          const owned = i.rarity === "OWNED";
          return (
            <HoverDiv
              key={i.name}
              style={{ borderRadius: 16, border: "1px solid rgba(255,255,255,.07)", background: "#0A0A0A", overflow: "hidden", transition: "border-color .2s,transform .2s" }}
              hoverStyle={{ borderColor: "rgba(0,230,118,.3)", transform: "translateY(-4px)" }}
            >
              <div
                style={{
                  height: 132,
                  background: `radial-gradient(120% 130% at 50% 25%,${i.tone},#0A0A0A 72%)`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderBottom: "1px solid rgba(255,255,255,.06)",
                  position: "relative",
                }}
              >
                <div style={{ fontSize: 36, color: i.color, animation: "ar-float 6s ease-in-out infinite" }}>{i.glyph}</div>
                <div style={{ position: "absolute", top: 11, left: 11, font: `500 9px ${MONO}`, letterSpacing: ".1em", color: "#5A5A5A" }}>{i.cat}</div>
                <div style={{ position: "absolute", top: 11, right: 11, font: `500 9px ${MONO}`, letterSpacing: ".1em", color: RC[i.rarity] }}>{i.rarity}</div>
              </div>
              <div style={{ padding: "16px 18px" }}>
                <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-.02em" }}>{i.name}</div>
                <div style={{ fontSize: 11.5, lineHeight: 1.5, color: "#6A6A6A", marginTop: 5, minHeight: 34 }}>{i.desc}</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14, paddingTop: 13, borderTop: "1px solid rgba(255,255,255,.05)" }}>
                  <div style={{ font: `500 14px ${MONO}`, color: owned ? "#00E676" : "#EDEDED" }}>{i.price}</div>
                  <div
                    style={{
                      padding: "6px 14px",
                      borderRadius: 8,
                      background: owned ? "transparent" : "#00E676",
                      border: `1px solid ${owned ? "rgba(0,230,118,.35)" : "#00E676"}`,
                      fontSize: 11.5,
                      fontWeight: 550,
                      color: owned ? "#00E676" : "#050505",
                      cursor: "pointer",
                    }}
                  >
                    {owned ? "Equipped" : "Buy"}
                  </div>
                </div>
              </div>
            </HoverDiv>
          );
        })}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 11, marginTop: 18, padding: "14px 18px", borderRadius: 12, background: "rgba(110,168,255,.05)", border: "1px solid rgba(110,168,255,.16)" }}>
        <div style={{ fontSize: 13, color: "#6EA8FF" }}>◆</div>
        <div style={{ fontSize: 12.5, lineHeight: 1.55, color: "#9A9A9A" }}>
          Mozetto does not sell strategy. Every ranked match is played on the same engine with the same reasoning energy — cosmetics are the only thing money buys here.
        </div>
      </div>
    </main>
  );
}
