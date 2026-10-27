import type { RegistryEntry } from "../../shared.ts";
import { buildOpenAiCompatibleRegistryEntry } from "../../shared.ts";

export const evrenProvider: RegistryEntry = buildOpenAiCompatibleRegistryEntry({
  id: "evren",
  alias: "evren",
  baseUrl: "https://evren-llmapi.ssyz.org.tr/v1/chat/completions",
  modelsUrl: "https://evren-llmapi.ssyz.org.tr/v1/models",
  models: [],
  passthroughModels: true,
});
