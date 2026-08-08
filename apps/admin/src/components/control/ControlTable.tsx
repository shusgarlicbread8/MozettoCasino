export type ControlColumn<T> = {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  sticky?: boolean;
  mono?: boolean;
};

export function ControlTable<T>({
  columns,
  rows,
  rowKey,
  empty = "No rows",
  error,
  stale,
  onRowClick,
}: {
  columns: ControlColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: string;
  error?: string | null;
  stale?: boolean;
  onRowClick?: (row: T) => void;
}) {
  if (error) {
    return <div className="ctrl-table-state err">{error}</div>;
  }
  if (!rows.length) {
    return <div className="ctrl-table-state">{empty}</div>;
  }
  return (
    <div className={stale ? "ctrl-table-wrap stale" : "ctrl-table-wrap"}>
      {stale ? <div className="ctrl-stale-banner">STALE — verify upstream authority</div> : null}
      <table className="ctrl-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.sticky ? "sticky" : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={onRowClick ? "clickable" : undefined}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={[c.sticky ? "sticky" : "", c.mono ? "mono" : ""]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
