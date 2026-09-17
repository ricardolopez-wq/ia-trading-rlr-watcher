const DATA_URL = "https://data.alpaca.markets";
const TRADING_URL = "https://paper-api.alpaca.markets";
const SYMBOLS = ["SPY", "VOO", "MSFT"];

const rules = {
  SPY: {
    entryAtOrBelow: 757,
    stop: 715,
    target: 817.5,
    mode: "Intermedia"
  }
};

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta la variable privada ${name}`);
  return value;
}

function alpacaHeaders() {
  return {
    "APCA-API-KEY-ID": requiredEnv("ALPACA_PAPER_API_KEY"),
    "APCA-API-SECRET-KEY": requiredEnv("ALPACA_PAPER_SECRET_KEY"),
    accept: "application/json"
  };
}

async function getJson(url) {
  const response = await fetch(url, { headers: alpacaHeaders() });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Alpaca respondió ${response.status}: ${detail.slice(0, 180)}`);
  }
  return response.json();
}

function currentPrice(snapshot) {
  const candidates = [
    snapshot?.latestQuote?.ap,
    snapshot?.latestTrade?.p,
    snapshot?.minuteBar?.c,
    snapshot?.dailyBar?.c,
    snapshot?.prevDailyBar?.c
  ];
  return candidates.map(Number).find(Number.isFinite) ?? null;
}

function evaluate(symbol, price) {
  if (!Number.isFinite(price)) return { state: "SIN_DATO" };
  const rule = rules[symbol];
  if (!rule) return { state: "OBSERVAR" };

  if (price <= rule.stop) {
    return { state: "REVISAR_RIESGO", reason: `Precio en o debajo del stop simulado ${rule.stop}` };
  }
  if (price >= rule.target) {
    return { state: "OBJETIVO_ALCANZADO", reason: `Precio en o arriba del objetivo simulado ${rule.target}` };
  }
  if (price <= rule.entryAtOrBelow) {
    return { state: "ZONA_COMPRA_SIMULADA", reason: `Precio en o debajo de entrada ${rule.entryAtOrBelow}` };
  }
  return { state: "ESPERAR", reason: `Entrada máxima simulada ${rule.entryAtOrBelow}` };
}

async function main() {
  const checkedAt = new Date().toISOString();
  const clock = await getJson(`${TRADING_URL}/v2/clock`);

  if (!clock.is_open) {
    console.log(JSON.stringify({
      service: "IA Trading RLR",
      mode: "SIMULACION",
      checkedAt,
      marketOpen: false,
      nextOpen: clock.next_open,
      message: "Mercado cerrado; no se generaron señales."
    }));
    return;
  }

  const query = encodeURIComponent(SYMBOLS.join(","));
  const snapshots = await getJson(`${DATA_URL}/v2/stocks/snapshots?symbols=${query}&feed=iex`);
  const signals = SYMBOLS.map((symbol) => {
    const price = currentPrice(snapshots[symbol]);
    return {
      symbol,
      price,
      currency: "USD",
      ...evaluate(symbol, price)
    };
  });

  console.log(JSON.stringify({
    service: "IA Trading RLR",
    mode: "SIMULACION",
    checkedAt,
    marketOpen: true,
    dataFeed: "IEX",
    capitalVirtualMxn: 360000,
    maxLossMxn: 5000,
    executionEnabled: false,
    signals
  }));
}

main().catch((error) => {
  console.error(JSON.stringify({
    service: "IA Trading RLR",
    mode: "SIMULACION",
    checkedAt: new Date().toISOString(),
    error: error instanceof Error ? error.message : "Error desconocido",
    executionEnabled: false
  }));
  process.exitCode = 1;
});
