export default function ControlLoading() {
  return (
    <div className="ctrl-loading" aria-busy="true" aria-label="Loading">
      <div className="ctrl-loading-bar" style={{ width: "28%" }} />
      <div className="ctrl-loading-bar" style={{ width: "48%" }} />
      <div className="ctrl-metric-grid" style={{ marginTop: 8 }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="ctrl-loading-bar lg" />
        ))}
      </div>
      <div className="ctrl-loading-bar lg" style={{ marginTop: 8 }} />
    </div>
  );
}
