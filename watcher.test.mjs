import test from "node:test";
import assert from "node:assert/strict";
import { marketCandidates, readGbmValidatedQuotes } from "./watcher.mjs";

test("la fuente pública mexicana nunca crea candidatos", () => {
  const candidates = marketCandidates({
    FMTY14: {
      market: "MX",
      trade: 14.1,
      previousClose: 13,
      dataQuality: "REFERENCE_ONLY",
      tradeableForSimulation: false
    }
  });
  assert.deepEqual(candidates, []);
});

test("GBM fresco habilita simulación y conserva la variación reportada", () => {
  process.env.GBM_VALIDATED_QUOTES_JSON = JSON.stringify({
    GCARSOA1: {
      trade: 133.47,
      bid: 133.47,
      ask: 133.81,
      changePct: 2.84,
      capturedAt: new Date().toISOString()
    }
  });
  const prices = readGbmValidatedQuotes();
  const candidates = marketCandidates(prices);
  assert.equal(prices.GCARSOA1.tradeableForSimulation, true);
  assert.equal(candidates[0].symbol, "GCARSOA1");
  assert.equal(candidates[0].changePct, 2.84);
});

test("una validación GBM vencida se rechaza", () => {
  process.env.GBM_VALIDATED_QUOTES_JSON = JSON.stringify({
    WALMEX: {
      trade: 45.23,
      changePct: -2.35,
      capturedAt: new Date(Date.now() - 11 * 60_000).toISOString()
    }
  });
  assert.deepEqual(readGbmValidatedQuotes(), {});
});
