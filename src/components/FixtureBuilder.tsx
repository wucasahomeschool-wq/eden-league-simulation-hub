import { useMemo, useState } from "react";
import { useLeague } from "@/state/league";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface Draft {
  key: string;
  week: number;
  home: string;
  away: string;
}

export function FixtureBuilder({
  weeks,
  title,
  onSaved,
  commit,
  saveLabelOverride,
}: {
  weeks: number[];
  title: string;
  onSaved?: () => void;
  commit?: (entries: { week: number; home: string; away: string }[]) => void;
  saveLabelOverride?: string;
}) {
  const { state, addFixtures } = useLeague();
  const teams = state.teamOrder;

  const [week, setWeek] = useState(weeks[0]);
  const [home, setHome] = useState(teams[0]);
  const [away, setAway] = useState(teams[1]);
  const [drafts, setDrafts] = useState<Draft[]>([]);

  const sameTeam = home === away;

  function add() {
    if (sameTeam) return;
    setDrafts((prev) => [
      ...prev,
      { key: `${Date.now()}-${Math.random()}`, week, home, away },
    ]);
  }

  function remove(key: string) {
    setDrafts((prev) => prev.filter((d) => d.key !== key));
  }

  function save() {
    if (drafts.length === 0) return;
    const entries = drafts.map(({ week, home, away }) => ({ week, home, away }));
    if (commit) commit(entries);
    else addFixtures(entries);
    setDrafts([]);
    onSaved?.();
  }

  const byWeek = useMemo(() => {
    const map = new Map<number, Draft[]>();
    for (const w of weeks) map.set(w, []);
    for (const d of drafts) {
      if (!map.has(d.week)) map.set(d.week, []);
      map.get(d.week)!.push(d);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [drafts, weeks]);

  // Flag teams already used twice / duplicate matchups within the selected week.
  const warnings = useMemo(() => {
    const w = drafts.filter((d) => d.week === week);
    const count = new Map<string, number>();
    const out: string[] = [];
    for (const d of w) {
      count.set(d.home, (count.get(d.home) ?? 0) + 1);
      count.set(d.away, (count.get(d.away) ?? 0) + 1);
    }
    for (const [t, c] of count) if (c > 1) out.push(`${t} appears ${c}× in Week ${week}`);
    return out;
  }, [drafts, week]);

  return (
    <div className="rounded-xl border bg-card p-4">
      <h3 className="mb-3 text-sm font-bold uppercase tracking-wide">{title}</h3>

      <div className="grid gap-3 sm:grid-cols-[auto_1fr_auto_1fr_auto] sm:items-end">
        <Field label="Week">
          <Select value={String(week)} onValueChange={(v) => setWeek(Number(v))}>
            <SelectTrigger className="w-full bg-card"><SelectValue /></SelectTrigger>
            <SelectContent>
              {weeks.map((w) => <SelectItem key={w} value={String(w)}>Week {w}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Home">
          <TeamSelect value={home} teams={teams} onChange={setHome} />
        </Field>
        <span className="hidden pb-2 text-center font-bold text-muted-foreground sm:block">vs</span>
        <Field label="Away">
          <TeamSelect value={away} teams={teams} onChange={setAway} />
        </Field>
        <Button onClick={add} disabled={sameTeam} className="font-semibold">ADD</Button>
      </div>
      {sameTeam && (
        <p className="mt-2 text-xs text-destructive">Home and Away must differ.</p>
      )}
      {warnings.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-destructive">
          {warnings.map((w) => <li key={w}>⚠ {w}</li>)}
        </ul>
      )}

      <div className="mt-4 space-y-3">
        {byWeek.map(([w, list]) => (
          <div key={w} className="rounded-lg border bg-panel/40 p-3">
            <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Week {w} · {list.length} {list.length === 1 ? "match" : "matches"}
            </div>
            {list.length === 0 ? (
              <p className="text-xs text-muted-foreground">No fixtures added yet.</p>
            ) : (
              <ul className="divide-y">
                {list.map((d) => (
                  <li key={d.key} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                    <span className="font-medium">{d.home} <span className="text-muted-foreground">vs</span> {d.away}</span>
                    <button
                      onClick={() => remove(d.key)}
                      className="text-xs font-semibold text-destructive hover:underline"
                    >
                      remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 flex justify-end">
        <Button onClick={save} disabled={drafts.length === 0} className="px-6 font-semibold">
          {saveLabelOverride ?? `SAVE ${drafts.length} FIXTURE${drafts.length === 1 ? "" : "S"}`}
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

function TeamSelect({
  value, teams, onChange,
}: {
  value: string; teams: string[]; onChange: (v: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full bg-card"><SelectValue /></SelectTrigger>
      <SelectContent>
        {teams.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
