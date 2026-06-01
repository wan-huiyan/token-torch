# litellm-prices.json — provenance

- **Source:** https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json
- **Fetched:** 2026-06-01
- **Method:** urllib download (certifi CA bundle), then extracted only bare `claude-*` keys with `litellm_provider === "anthropic"`.
- **Fields kept (per-TOKEN):** input_cost_per_token, output_cost_per_token, cache_creation_input_token_cost, cache_read_input_token_cost.
- **Conversion:** pricing.ts multiplies each by 1e6 (-> $/MTok) and round2()s. As of fetch, derived rates match the hardcoded MODEL_RATES exactly; pricing.ts keeps the hardcoded literal as a drift-guarded fallback.
