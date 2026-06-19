import { createServerFn } from "@tanstack/react-start";

// Natural-language player search. Translates a plain-English request like
// "fast wingers who also have great stamina" into the structured search grammar
// used by parseSearchQuery (e.g. "WINGER PAC > 8 STA > 8"). The CLIENT then
// feeds that string back through the existing parser/matcher so results render
// identically to a hand-typed query. This function never touches league state.

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";

interface InterpretInput {
  query: string;
}

const ATTR_CODES = [
  "OVR (overall rating)", "FIN (finishing)", "SHO (shooting)", "PAS (passing)",
  "VIS (vision)", "DRI (dribbling)", "PAC (pace/speed)", "STA (stamina)",
  "DEF (defending)", "TAC (tackling)", "POS (positioning)", "COM (composure)",
  "WR (work rate)", "AGG (aggression)", "STR (strength)", "AER (aerial/heading)",
];

const POSITIONS = "GK, ST, LW, RW, WINGER, CAM, CM, CDM, LM, RM, CB, LB, RB, LWB, RWB";

const SYSTEM = `You translate a soccer scout's plain-English player request into a compact structured search query for the Eden League player database.

ALL ATTRIBUTES are on a 1.0–10.0 scale (higher is better). Available attribute codes:
${ATTR_CODES.join(", ")}.

Available positions: ${POSITIONS}.

GRAMMAR you must output (space-separated tokens, nothing else):
- An optional position token (use a code above; use WINGER for a generic "winger").
- Zero or more comparison tokens of the form CODE OP NUMBER, where OP is one of > >= < <= = and NUMBER is on the 1–10 scale.
- Optional bare name substrings if the user clearly names a player.

INTERPRETATION GUIDE (map vague words to numeric thresholds on the 1–10 scale):
- "fast / quick / pacey" -> PAC > 8 ; "very fast / blistering" -> PAC > 8.5
- "great / elite / excellent <attr>" -> that attr > 8.5 ; "good <attr>" -> that attr > 7.5
- "high stamina / tireless" -> STA > 8 ; "strong / powerful" -> STR > 8
- "clinical / great finisher" -> FIN > 8.5 ; "creative / great passer" -> PAS > 8 or VIS > 8
- "young" -> AGE < 23 ; "veteran / experienced" -> AGE > 30 ; "cheap" -> SALARY < 5
- Combine multiple traits with multiple comparison tokens (they are ANDed).

EXAMPLES:
- "fast wingers who also have great stamina" -> WINGER PAC > 8 STA > 8.5
- "a clinical striker who is also strong in the air" -> ST FIN > 8.5 AER > 8
- "young cheap defenders with good tackling" -> CB AGE < 23 SALARY < 5 TAC > 7.5

OUTPUT FORMAT:
- Respond with a single JSON object: {"query": "<structured query string>"}
- No markdown, no commentary outside the JSON.`;

function extractJson<T>(content: string): T | null {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try { return JSON.parse(content.slice(start, end + 1)) as T; } catch { return null; }
}

export const interpretSearch = createServerFn({ method: "POST" })
  .inputValidator((data: InterpretInput) => {
    if (!data || typeof data.query !== "string" || data.query.trim().length === 0) {
      throw new Error("Empty query");
    }
    return { query: data.query.trim().slice(0, 300) };
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("AI is not configured");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    let res: Response;
    try {
      res = await fetch(GATEWAY, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0.2,
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: `Translate this request: "${data.query}". Return JSON only.` },
          ],
        }),
        signal: controller.signal,
      });
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") throw new Error("AI request timed out");
      throw e;
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 429) throw new Error("RATE_LIMIT");
    if (res.status === 402) throw new Error("CREDITS");
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`AI request failed (${res.status}): ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = json.choices?.[0]?.message?.content?.trim() ?? "";
    const parsed = extractJson<{ query?: string }>(content);
    const structured = parsed && typeof parsed.query === "string" ? parsed.query.trim() : "";
    if (!structured) throw new Error("Couldn't interpret that search");
    return { query: structured };
  });
