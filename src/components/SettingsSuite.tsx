import { useCallback, useEffect, useState } from "react";
import { useLeague, TRANSFER_WINDOW_LAST_WEEK, DEFAULT_FORMATION } from "@/state/league";
import { GOAL_MULTIPLIER_DEFAULT, IDENTITY_BOOST_WEIGHT } from "@/engine/engine";
import { DEFAULT_SALARY_CAP, CONTRACT_EXEMPT_TEAMS } from "@/lib/contracts";
import { UTILITY_THRESHOLD } from "@/lib/trades";
import {
  MORALE_BASELINE, SACK_THRESHOLD, MANAGER_RENEWAL_MORALE,
  HIGH_MORALE, LOW_MORALE, SEASON_MORALE_RESET,
} from "@/lib/morale";
import { listVersions, deleteVersion, type LeagueVersion } from "@/lib/versions";
import { SaveVersionButton } from "@/components/SaveVersionButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

export function SettingsSuite() {
  const { state, setSalaryCap, revertToVersion } = useLeague();

  return (
    <div className="space-y-6">
      <LeagueSettings cap={state.salaryCap ?? 0} setSalaryCap={setSalaryCap} />
      <VersionArchive revertToVersion={revertToVersion} />
    </div>
  );
}

// ---------------- League Settings (reference) ----------------
function LeagueSettings({ cap, setSalaryCap }: { cap: number; setSalaryCap: (n: number) => void }) {
  const [capDraft, setCapDraft] = useState("");

  function commitCap() {
    const v = parseFloat(capDraft);
    if (!Number.isNaN(v) && v > 0) setSalaryCap(v);
    setCapDraft("");
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card/70 p-4 shadow-lg">
        <h2 className="text-sm font-extrabold uppercase tracking-wide text-primary">League Settings</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Central reference for the engine and league rules. Most values are fixed in the
          simulation engine (ported line-for-line from the Python reference); the Hard Salary Cap
          is adjustable below.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <SettingsCard title="Simulation Engine">
          <Row label="Default tempo" value="Normal (1.2×) · Slow 1.0× / Fast 1.4×" />
          <Row label="Goal multiplier (default)" value={`${GOAL_MULTIPLIER_DEFAULT}×`} />
          <Row label="Identity boost weight" value={String(IDENTITY_BOOST_WEIGHT)} />
          <Row label="Dynamic tactics" value="On (pre-match scouting + live shifts)" />
          <Row label="Weather effects" value="On" />
          <Row label="Playoff penalties" value="Skip extra time → shootout" />
        </SettingsCard>

        <SettingsCard title="Contract Engine">
          <Row label="Hard salary cap" value={`$${cap.toFixed(1)}M`} highlight />
          <div className="flex items-center gap-2 py-1.5">
            <Input
              type="number" min={1} step={1} value={capDraft} placeholder="new cap ($M)"
              onChange={(e) => setCapDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && commitCap()}
              className="h-8 w-32 text-center font-mono"
            />
            <Button size="sm" variant="secondary" onClick={commitCap} disabled={!capDraft}>SET CAP</Button>
          </div>
          <Row label="Default cap baseline" value={`$${DEFAULT_SALARY_CAP}M`} />
          <Row label="Demand modifier range" value="0.8× – 1.4× (morale + rating)" />
          <Row label="Veteran paycut offer" value="15% (accept ≈ 30 + morale·0.5%)" />
          <Row label="Exempt clubs" value={[...CONTRACT_EXEMPT_TEAMS].join(", ")} />
        </SettingsCard>

        <SettingsCard title="Trade Engine">
          <Row label="Utility threshold" value={`${UTILITY_THRESHOLD} (combined ΔU to propose)`} />
          <Row label="Transfer window" value={`Weeks 1–${TRANSFER_WINDOW_LAST_WEEK}`} />
          <Row label="Cash utility weight" value="0.25× budget ($M)" />
          <Row label="Bench rating weight" value="0.40×" />
        </SettingsCard>

        <SettingsCard title="Morale Engine">
          <Row label="Baseline" value={String(MORALE_BASELINE)} />
          <Row label="High / Low bands" value={`${HIGH_MORALE} / ${LOW_MORALE}`} />
          <Row label="Sack threshold" value={String(SACK_THRESHOLD)} />
          <Row label="Manager renewal morale" value={String(MANAGER_RENEWAL_MORALE)} />
          <Row label="Season carry-over reset" value={`±${SEASON_MORALE_RESET} toward ${MORALE_BASELINE}`} />
        </SettingsCard>

        <SettingsCard title="League Structure">
          <Row label="Teams" value="24 · 9v9" />
          <Row label="Default formation" value={DEFAULT_FORMATION} />
          <Row label="Regular season" value="12 weeks" />
          <Row label="Final Four" value="Weeks 13–16 (48 games)" />
          <Row label="Playoffs" value="Top 14 seeded, byes for seeds 1–2" />
        </SettingsCard>
      </div>
    </div>
  );
}

function SettingsCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow">
      <div className="border-b bg-panel px-4 py-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <div className="divide-y px-4">{children}</div>
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`text-right font-medium ${highlight ? "font-mono font-extrabold text-primary" : ""}`}>{value}</span>
    </div>
  );
}

// ---------------- Version Archive ----------------
function VersionArchive({ revertToVersion }: { revertToVersion: (data: LeagueVersion["data"]) => void }) {
  const [versions, setVersions] = useState<LeagueVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmRevert, setConfirmRevert] = useState<LeagueVersion | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setVersions(await listVersions());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load versions.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function handleDelete(id: string) {
    try {
      await deleteVersion(id);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete version.");
    }
  }

  function doRevert() {
    if (!confirmRevert) return;
    revertToVersion(confirmRevert.data);
    setConfirmRevert(null);
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-panel px-4 py-2.5">
        <div className="text-sm font-bold uppercase tracking-wide">Save Version Archive</div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => void refresh()}>↻ Refresh</Button>
          <SaveVersionButton variant="secondary" onSaved={refresh} />
        </div>
      </div>

      <div className="px-4 py-2 text-xs text-muted-foreground">
        Restore points for all league data except Team Editor rosters/budgets/lineups. Use these to
        recover if the live Cloud save ever glitches.
      </div>

      {error && <div className="px-4 py-2 text-xs text-destructive">{error}</div>}

      {loading ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">Loading saved versions…</div>
      ) : versions.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          No saved versions yet. Click <span className="font-semibold text-foreground">Save Version</span> to create one.
        </div>
      ) : (
        <ul className="divide-y">
          {versions.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <div>
                <div className="font-semibold">{v.title}</div>
                <div className="text-xs text-muted-foreground">
                  {new Date(v.created_at).toLocaleString()} · Season {v.data?.season ?? "?"} · Week {v.data?.currentWeek ?? "?"}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => setConfirmRevert(v)}>REVERT TO THIS</Button>
                <Button
                  size="sm" variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => handleDelete(v.id)}
                >
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!confirmRevert} onOpenChange={(o) => !o && setConfirmRevert(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Revert to this version?</DialogTitle>
            <DialogDescription>
              This replaces the current schedule, results, match commentary, playoffs, trades and
              contract settings with <span className="font-semibold text-foreground">{confirmRevert?.title}</span>.
              Your Team Editor data (rosters, budgets, lineups) will be kept as-is. You can undo this
              with the UNDO button afterwards.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRevert(null)}>Cancel</Button>
            <Button variant="destructive" onClick={doRevert}>Revert league data</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
