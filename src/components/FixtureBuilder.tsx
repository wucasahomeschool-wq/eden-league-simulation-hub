import { useMemo, useRef, useState } from "react";
import { useLeague } from "@/state/league";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

interface Draft {
  key: string;
  week: number;
  home: string;
  away: string;
}

const pairKey = (a: string, b: string) => [a, b].sort().join(" ⚔ ");

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
  const perWeekMatches = Math.floor(teams.length / 2);

  const [week, setWeek] = useState(weeks[0]);
  const [home, setHome] = useState(teams[0]);
  const [away, setAway] = useState(teams[1]);
  const [drafts, setDrafts] = useState<Draft[]>([]);

  // Validation dialogs
  const [errorReport, setErrorReport] = useState<{ messages: string[]; gotoWeek: number } | null>(null);
  const [warnReport, setWarnReport] = useState<string[] | null>(null);
  const [highlightWeek, setHighlightWeek] = useState<number | null>(null);
  const weekRefs = useRef<Record<number, HTMLDivElement | null>>({});

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

  // --- Hard validation: blocks saving until every week is complete & balanced ---
  function validateSchedule(): { messages: string[]; gotoWeek: number } | null {
    for (const w of weeks) {
      const list = drafts.filter((d) => d.week === w);
      const appear = new Map<string, number>();
      for (const d of list) {
        appear.set(d.home, (appear.get(d.home) ?? 0) + 1);
        appear.set(d.away, (appear.get(d.away) ?? 0) + 1);
      }
      const msgs: string[] = [];
      if (list.length !== perWeekMatches) {
        msgs.push(
          `Week ${w} has ${list.length} match${list.length === 1 ? "" : "es"}, but every week must have exactly ${perWeekMatches} (so all ${teams.length} clubs play once).`,
        );
      }
      const dupes = teams.filter((t) => (appear.get(t) ?? 0) > 1);
      const missing = teams.filter((t) => !(appear.get(t) ?? 0));
      if (dupes.length) msgs.push(`Week ${w}: ${dupes.join(", ")} ${dupes.length === 1 ? "is" : "are"} scheduled more than once.`);
      if (missing.length) msgs.push(`Week ${w}: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not scheduled.`);
      if (msgs.length) return { messages: msgs, gotoWeek: w };
    }
    return null;
  }

  // --- Soft warning: rematches (a pairing that appears more than once) ---
  function rematchWarnings(): string[] {
    const seen = new Map<string, number>();
    for (const d of drafts) seen.set(pairKey(d.home, d.away), (seen.get(pairKey(d.home, d.away)) ?? 0) + 1);
    const out: string[] = [];
    for (const [k, c] of seen) if (c > 1) out.push(`${k.replace(" ⚔ ", " vs ")} appears ${c} times in this schedule.`);
    return out;
  }

  function commitNow() {
    const entries = drafts.map(({ week, home, away }) => ({ week, home, away }));
    if (commit) commit(entries);
    else addFixtures(entries);
    setDrafts([]);
    setWarnReport(null);
    onSaved?.();
  }

  function save() {
    if (drafts.length === 0) return;
    const err = validateSchedule();
    if (err) { setErrorReport(err); return; }
    const warns = rematchWarnings();
    if (warns.length) { setWarnReport(warns); return; }
    commitNow();
  }

  function acknowledgeError() {
    if (!errorReport) return;
    const target = errorReport.gotoWeek;
    setWeek(target);
    setHighlightWeek(target);
    setErrorReport(null);
    // Scroll the offending week into view so the user lands right on the problem.
    requestAnimationFrame(() => {
      weekRefs.current[target]?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
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
          <Select value={String(week)} onValueChange={(v) => { setWeek(Number(v)); setHighlightWeek(null); }}>
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
        {byWeek.map(([w, list]) => {
          const isHighlighted = highlightWeek === w;
          const complete = list.length === perWeekMatches;
          return (
            <div
              key={w}
              ref={(el) => { weekRefs.current[w] = el; }}
              className={`scroll-mt-24 rounded-lg border p-3 transition-colors ${
                isHighlighted
                  ? "border-destructive bg-destructive/10 ring-2 ring-destructive"
                  : "border-border bg-panel/40"
              }`}
            >
              <div className="mb-1.5 flex items-center justify-between gap-2 text-xs font-bold uppercase tracking-wide">
                <span className="text-muted-foreground">
                  Week {w} · {list.length}/{perWeekMatches} {list.length === 1 ? "match" : "matches"}
                </span>
                <span className={complete ? "text-primary" : "text-destructive"}>
                  {complete ? "✓ balanced" : "incomplete"}
                </span>
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
          );
        })}
      </div>

      <div className="mt-4 flex justify-end">
        <Button onClick={save} disabled={drafts.length === 0} className="px-6 font-semibold">
          {saveLabelOverride ?? `SAVE ${drafts.length} FIXTURE${drafts.length === 1 ? "" : "S"}`}
        </Button>
      </div>

      {/* Hard error — blocks saving until fixed */}
      <Dialog open={!!errorReport} onOpenChange={(o) => { if (!o) acknowledgeError(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive">⛔ Schedule is incomplete</DialogTitle>
            <DialogDescription>
              You can't save yet — every week must have exactly {perWeekMatches} matches with each club playing
              once. Fix the issue below:
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-1.5 text-sm text-foreground">
            {errorReport?.messages.map((m, i) => <li key={i}>• {m}</li>)}
          </ul>
          <DialogFooter>
            <Button onClick={acknowledgeError} className="font-semibold">OK — take me to Week {errorReport?.gotoWeek}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Soft warning — rematches, bypassable */}
      <Dialog open={!!warnReport} onOpenChange={(o) => { if (!o) setWarnReport(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-highlight-gold">⚠ Possible rematch detected</DialogTitle>
            <DialogDescription>
              The schedule is valid and balanced, but some clubs are set to face each other more than once:
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-1.5 text-sm text-foreground">
            {warnReport?.map((m, i) => <li key={i}>• {m}</li>)}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWarnReport(null)}>Go back and edit</Button>
            <Button onClick={commitNow} className="font-semibold">Schedule anyway</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
