/**
 * Pure helpers behind the composer's context meter: how much of the model's
 * context window the selected session currently occupies. Kept free of Vue
 * so the arithmetic — which row wins, which window applies — is unit-tested.
 */
import type { ChatMessage, ModelChoice, ModelOption } from "../../shared/types";

export interface ContextUsage {
  /** Tokens the conversation carried after its latest reported step. */
  used: number;
  /** The model's context window; null when no catalog reported one. */
  window: number | null;
  /** used / window, floored at 0 but not capped (overflow stays visible); null without a window. */
  ratio: number | null;
}

/**
 * The newest assistant row that reported a step footprint. Later steps of a
 * tool-calling turn re-send the whole conversation, so the last one is the
 * size the next prompt will carry (plus what the user is about to type).
 */
export function latestContextTokens(messages: readonly ChatMessage[]): number | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const row = messages[i];
    if (
      row?.role === "assistant" &&
      typeof row.contextTokens === "number" &&
      row.contextTokens > 0
    ) {
      return row.contextTokens;
    }
  }
  return null;
}

/** The context window of a model choice, from the active backend's catalog. */
export function contextWindowFor(
  model: ModelChoice | null,
  models: readonly ModelOption[],
): number | null {
  if (!model) return null;
  const option = models.find(
    (m) => m.providerId === model.providerId && m.modelId === model.modelId,
  );
  return typeof option?.contextWindow === "number" && option.contextWindow > 0
    ? option.contextWindow
    : null;
}

export function contextUsageOf(used: number | null, window: number | null): ContextUsage | null {
  if (used === null) return null;
  return { used, window, ratio: window === null ? null : Math.max(used / window, 0) };
}
