interface GroqModelsResponse {
  data?: { id: string }[];
}

/** Warns at startup if the configured Groq models are no longer available, since Groq's catalog changes. */
export async function checkConfiguredModels(): Promise<void> {
  const apiKey = process.env["GROQ_API_KEY"];
  if (!apiKey) return;

  const primary = process.env["GROQ_MODEL_PRIMARY"] ?? "openai/gpt-oss-120b";
  const fallback = process.env["GROQ_MODEL_FALLBACK"] ?? "llama-3.3-70b-versatile";

  try {
    const res = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    if (!res.ok) {
      console.warn(`Could not verify Groq models at startup (HTTP ${res.status}).`);
      return;
    }
    const body = (await res.json()) as GroqModelsResponse;
    const available = new Set((body.data ?? []).map((m) => m.id));
    for (const [label, model] of [["primary", primary] as const, ["fallback", fallback] as const]) {
      if (!available.has(model)) {
        console.warn(`Configured Groq ${label} model "${model}" was not found in the current model list.`);
      }
    }
  } catch (err) {
    console.warn("Could not verify Groq models at startup:", err instanceof Error ? err.message : err);
  }
}
