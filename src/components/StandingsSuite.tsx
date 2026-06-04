import { useLeague } from "@/state/league";

const COLS: { key: string; label: string }[] = [
  { key: "rank", label: "RANK" },
  { key: "team", label: "TEAM NAME" },
  { key: "pld", label: "PLD" },
  { key: "w", label: "W" },
  { key: "d", label: "D" },
  { key: "l", label: "L" },
  { key: "gf", label: "GF" },
  { key: "ga", label: "GA" },
  { key: "gd", label: "GD" },
  { key: "pts", label: "PTS" },
];

export function StandingsSuite() {
  const { standings } = useLeague();
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b bg-panel text-left text-xs font-bold uppercase tracking-wide text-muted-foreground">
            {COLS.map((c) => (
              <th key={c.key} className={`px-3 py-2.5 ${c.key === "team" ? "text-left" : "text-center"}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {standings.map((row) => (
            <tr key={row.team} className="border-b last:border-0 odd:bg-muted/40">
              <td className="px-3 py-2 text-center font-mono font-semibold tabular-nums">{row.rank}</td>
              <td className="px-3 py-2 font-medium">{row.team}</td>
              <td className="px-3 py-2 text-center tabular-nums">{row.pld}</td>
              <td className="px-3 py-2 text-center tabular-nums">{row.w}</td>
              <td className="px-3 py-2 text-center tabular-nums">{row.d}</td>
              <td className="px-3 py-2 text-center tabular-nums">{row.l}</td>
              <td className="px-3 py-2 text-center tabular-nums">{row.gf}</td>
              <td className="px-3 py-2 text-center tabular-nums">{row.ga}</td>
              <td className="px-3 py-2 text-center tabular-nums">
                {row.gd > 0 ? `+${row.gd}` : row.gd}
              </td>
              <td className="px-3 py-2 text-center font-mono font-bold tabular-nums text-primary">{row.pts}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
