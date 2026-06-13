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

  useEffect(() => {
    const pending = Object.entries(state.managers ?? {}).filter(
      ([, m]) => m.pendingGeneration
    );
    for (const [team] of pending) {
      if (inFlight.current.has(team)) continue;
      inFlight.current.add(team);
      const tacticalStyle = state.teams[team]?.tactical_style;
      run({ data: { team, tacticalStyle } })
        .then((res) => {
          replaceManager(team, { name: res.name, personality: res.personality });
        })
        .catch(() => {
          // Leave the interim manager in place; retry on a later change.
        })
        .finally(() => {
          inFlight.current.delete(team);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.managers]);

  return null;
}
