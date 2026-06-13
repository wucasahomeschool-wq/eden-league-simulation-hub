import { useEffect, useRef } from "react";
import { useLeague } from "@/state/league";
import { useServerFn } from "@tanstack/react-start";
import { generateManager } from "@/lib/negotiation.functions";

// Always-mounted watcher: when an AI club's manager is sacked, the state layer
// flags that club's manager with `pendingGeneration`. This component detects
// those flags and asks Lovable AI for a fresh in-character manager, then writes
// it back into league state. User-controlled clubs are never sacked, so they
// never appear here. Failures are silent and harmless — the interim manager
// simply remains until the next attempt.
export function ManagerGenerationWatcher() {
  const { state, replaceManager } = useLeague();
  const run = useServerFn(generateManager);
  const inFlight = useRef<Set<string>>(new Set());
  // Per-team cooldown timestamps: after a failed generation we wait before
  // retrying so a rate-limited / down gateway is never hammered on every
  // subsequent state change.
  const cooldownUntil = useRef<Map<string, number>>(new Map());
  const RETRY_COOLDOWN_MS = 60_000;

  useEffect(() => {
    const pending = Object.entries(state.managers ?? {}).filter(
      ([, m]) => m.pendingGeneration
    );
    const now = Date.now();
    for (const [team] of pending) {
      if (inFlight.current.has(team)) continue;
      const until = cooldownUntil.current.get(team) ?? 0;
      if (now < until) continue; // still cooling down from a recent failure
      inFlight.current.add(team);
      const tacticalStyle = state.teams[team]?.tactical_style;
      run({ data: { team, tacticalStyle } })
        .then((res) => {
          cooldownUntil.current.delete(team);
          replaceManager(team, { name: res.name, personality: res.personality });
        })
        .catch(() => {
          // Back off before the next attempt; the interim manager stays in place.
          cooldownUntil.current.set(team, Date.now() + RETRY_COOLDOWN_MS);
        })
        .finally(() => {
          inFlight.current.delete(team);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.managers]);

  return null;
}
