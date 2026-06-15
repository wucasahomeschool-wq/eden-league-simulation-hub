import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useServerFn } from "@tanstack/react-start";
import { useLeague } from "@/state/league";
import { generateNews, type NewsKind } from "@/lib/news.functions";
import { buildPostgameBrief, buildRoundupBrief, buildDramaBrief } from "@/lib/news-brief";
import { downloadText } from "@/lib/league-export";
import { Button } from "@/components/ui/button";

type Tab = NewsKind;

const TABS: { key: Tab; label: string; blurb: string }[] = [
  { key: "postgame", label: "Post-Game", blurb: "Match reports from a single completed fixture." },
  { key: "roundup", label: "Weekly Roundup", blurb: "League-wide wrap of a completed match week." },
  { key: "drama", label: "Media Drama", blurb: "Off-pitch storylines, title race & dressing-room mood." },
];

export function NewsSuite() {
  const { state, standings, leaderboards } = useLeague();
  const run = useServerFn(generateNews);

  const [tab, setTab] = useState<Tab>("postgame");
  const [fixtureId, setFixtureId] = useState<string>("");
  const [week, setWeek] = useState<number>(0);
  const [focus, setFocus] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [article, setArticle] = useState<string | null>(null);

  // Completed fixtures (have both result + payload so individual events exist).
  const playedFixtures = useMemo(
    () =>
      state.fixtures
        .filter((f) => state.results[f.id] && state.payloads[f.id])
        .sort((a, b) => b.week - a.week),
    [state.fixtures, state.results, state.payloads]
  );

  // Weeks that have at least one recorded result.
  const playedWeeks = useMemo(() => {
    const ws = new Set<number>();
    for (const f of state.fixtures) if (state.results[f.id]) ws.add(f.week);
    return [...ws].sort((a, b) => b - a);
  }, [state.fixtures, state.results]);

  const generate = async () => {
    setError(null);
    setArticle(null);

    let brief: string | null = null;
    if (tab === "postgame") {
      const id = fixtureId || playedFixtures[0]?.id;
      if (!id) { setError("No completed match with recorded events yet."); return; }
      brief = buildPostgameBrief(state, id);
    } else if (tab === "roundup") {
      const wk = week || playedWeeks[0];
      if (!wk) { setError("No completed match weeks yet."); return; }
      brief = buildRoundupBrief(state, standings, leaderboards, wk);
    } else {
      brief = buildDramaBrief(state, standings, leaderboards);
    }

    if (!brief) { setError("Not enough recorded data to write this story yet."); return; }

    setLoading(true);
    try {
      const res = await run({ data: { kind: tab, brief, focus: focus.trim() || undefined } });
      setArticle(res.article);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("RATE_LIMIT")) setError("The AI desk is swamped — try again in a moment.");
      else if (msg.includes("CREDITS")) setError("AI credits exhausted. Add credits in Settings → Workspace → Usage.");
      else setError("Couldn't file the story. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border-l-4 border-highlight-blue bg-card px-4 py-2 text-xs text-muted-foreground">
        The Newsroom is purely for fun. Every article is written from your league's
        <span className="font-semibold text-foreground"> real results, ratings, and stats</span> — no invented numbers.
      </div>

      <div className="inline-flex flex-wrap gap-1 rounded-lg bg-muted p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setArticle(null); setError(null); }}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors ${
              tab === t.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">{TABS.find((t) => t.key === tab)?.blurb}</p>

      <div className="flex flex-wrap items-end gap-3">
        {tab === "postgame" && (
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
            MATCH
            <select
              value={fixtureId || playedFixtures[0]?.id || ""}
              onChange={(e) => setFixtureId(e.target.value)}
              className="rounded-md border bg-background px-2 py-1.5 text-sm text-foreground"
            >
              {playedFixtures.length === 0 && <option value="">No completed matches</option>}
              {playedFixtures.map((f) => {
                const r = state.results[f.id];
                return (
                  <option key={f.id} value={f.id}>
                    W{f.week}: {f.home} {r.homeGoals}–{r.awayGoals} {f.away}
                  </option>
                );
              })}
            </select>
          </label>
        )}

        {tab === "roundup" && (
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
            MATCH WEEK
            <select
              value={week || playedWeeks[0] || ""}
              onChange={(e) => setWeek(Number(e.target.value))}
              className="rounded-md border bg-background px-2 py-1.5 text-sm text-foreground"
            >
              {playedWeeks.length === 0 && <option value="">No completed weeks</option>}
              {playedWeeks.map((w) => (
                <option key={w} value={w}>Week {w}</option>
              ))}
            </select>
          </label>
        )}

        <Button onClick={generate} disabled={loading} className="font-semibold">
          {loading ? "Filing story…" : "✍ Write Article"}
        </Button>
      </div>

      <label className="flex flex-col gap-1 text-xs font-semibold uppercase text-muted-foreground">
        STORY ANGLE <span className="font-normal normal-case">(optional — tell the writer what to focus on)</span>
        <textarea
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder={
            tab === "drama"
              ? 'e.g. "Frame this around the underdog playoff run" or "Focus on the title-race pressure on the leaders"'
              : tab === "roundup"
              ? 'e.g. "Lead with the relegation battle" or "Spotlight the golden boot race"'
              : 'e.g. "Focus on the goalkeeper\'s performance" or "Frame it as a tactical upset"'
          }
          className="resize-y rounded-md border bg-background px-3 py-2 text-sm font-normal text-foreground placeholder:text-muted-foreground"
        />
      </label>

      {error && (
        <div className="rounded-lg border-l-4 border-highlight-red bg-card px-4 py-3 text-sm text-foreground">
          {error}
        </div>
      )}

      {loading && !article && (
        <div className="rounded-lg border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          The beat writer is at the keyboard…
        </div>
      )}

      {article && (
        <article className="rounded-xl border bg-card p-6 shadow-sm">
          <div className="space-y-3 text-foreground/90">
            <ReactMarkdown
              components={{
                h2: ({ children }) => (
                  <h2 className="text-xl font-extrabold tracking-tight text-foreground">{children}</h2>
                ),
                h1: ({ children }) => (
                  <h2 className="text-xl font-extrabold tracking-tight text-foreground">{children}</h2>
                ),
                p: ({ children }) => <p className="leading-relaxed">{children}</p>,
                strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
                em: ({ children }) => <em className="italic">{children}</em>,
              }}
            >
              {article}
            </ReactMarkdown>
          </div>
          <div className="mt-4 border-t pt-2 text-[10px] uppercase tracking-widest text-muted-foreground">
            Eden League Newsroom · AI-written from real league data · entertainment only
          </div>
        </article>
      )}
    </div>
  );
}
