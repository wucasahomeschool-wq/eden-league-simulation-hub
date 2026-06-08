import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { LeagueProvider, useLeague } from "@/state/league";
import { SimulationTerminal } from "@/components/SimulationTerminal";
import { ScheduleSuite } from "@/components/ScheduleSuite";
import { StandingsSuite } from "@/components/StandingsSuite";
import { TeamEditorSuite } from "@/components/TeamEditorSuite";
import { PlayoffsSuite } from "@/components/PlayoffsSuite";
import { MatchSchedulingSuite } from "@/components/MatchSchedulingSuite";
import { TradesSuite } from "@/components/TradesSuite";
import { Button } from "@/components/ui/button";
import edenLogo from "@/assets/eden-league-logo.png.asset.json";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Eden League Data Hub" },
      { name: "description", content: "Central database, simulation engine, standings and roster control center for the 24-team Eden League." },
      { property: "og:title", content: "Eden League Data Hub" },
      { property: "og:description", content: "Simulation terminal, schedule, live standings and roster editor for the Eden League." },
    ],
  }),
  component: () => (
    <LeagueProvider>
      <Hub />
    </LeagueProvider>
  ),
});

const SUITES = [
  { name: "Simulation Terminal", render: () => <SimulationTerminal /> },
  { name: "Season Schedule", render: () => <ScheduleSuite /> },
  { name: "Match Scheduling", render: () => <MatchSchedulingSuite /> },
  { name: "League Standings", render: () => <StandingsSuite /> },
  { name: "Playoffs", render: () => <PlayoffsSuite /> },
  { name: "Trades", render: () => <TradesSuite /> },
  { name: "Team Editor", render: () => <TeamEditorSuite /> },
];

function Hub() {
  const [idx, setIdx] = useState(0);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const prev = () => setIdx((i) => (i - 1 + SUITES.length) % SUITES.length);
  const next = () => setIdx((i) => (i + 1) % SUITES.length);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b bg-card/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-3">
          <UndoButton />
          <button
            onClick={prev}
            aria-label="Previous suite"
            className="ml-auto select-none px-3 py-1 text-2xl font-bold text-muted-foreground transition-colors hover:text-primary"
          >
            ‹
          </button>
          <div className="flex flex-col items-center text-center">
            <div className="flex items-center gap-2">
              <img src={edenLogo.url} alt="Eden League crest" className="h-8 w-8 object-contain" />
              <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Eden League Data Hub
              </div>
            </div>
            <h1 className="text-lg font-extrabold tracking-tight sm:text-xl">
              {SUITES[idx].name}
            </h1>
          </div>
          <button
            onClick={next}
            aria-label="Next suite"
            className="mr-auto select-none px-3 py-1 text-2xl font-bold text-muted-foreground transition-colors hover:text-primary"
          >
            ›
          </button>
          <div className="w-[72px]" aria-hidden />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {mounted ? SUITES[idx].render() : (
          <div className="py-20 text-center text-sm text-muted-foreground">Loading league state…</div>
        )}
      </main>
    </div>
  );
}

function UndoButton() {
  const { undo, canUndo } = useLeague();
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={undo}
      disabled={!canUndo}
      title="Undo the last action across any suite"
      className="font-semibold"
    >
      ↶ UNDO
    </Button>
  );
}
