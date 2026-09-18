const DATA_URL = "https://data.alpaca.markets";
const TRADING_URL = "https://paper-api.alpaca.markets";
const SYMBOLS = ["SPY", "VOO", "MSFT"];

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

function quote(snapshot) {
  const numberOrNull = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
  return {
    ask: numberOrNull(snapshot?.latestQuote?.ap),
    bid: numberOrNull(snapshot?.latestQuote?.bp),
    trade: numberOrNull(snapshot?.latestTrade?.p),
    close: numberOrNull(snapshot?.minuteBar?.c ?? snapshot?.dailyBar?.c ?? snapshot?.prevDailyBar?.c)
  };
}

async function sendToDashboard(payload) {
  const response = await fetch(requiredEnv("ALERT_WEBHOOK_URL"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-alert-secret": requiredEnv("ALERT_WEBHOOK_SECRET")
    },
    body: JSON.stringify(payload)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Tablero respondió ${response.status}: ${result.error || "sin detalle"}`);
  return result;
}

async function publish(payload) {
  try {
    const dashboard = await sendToDashboard(payload);
    console.log(JSON.stringify({ ...payload, dashboardAccepted: true, alertsCreated: dashboard.alerts?.length || 0 }));
  } catch (error) {
    console.warn(JSON.stringify({
      ...payload,
      dashboardAccepted: false,
      dashboardError: error instanceof Error ? error.message : "No fue posible actualizar el tablero"
    }));
  }
}

async function main() {
  const checkedAt = new Date().toISOString();
  try {
    const clock = await getJson(`${TRADING_URL}/v2/clock`);
    if (!clock.is_open) {
      const payload = {
        service: "IA Trading RLR",
        mode: "SIMULACION",
        checkedAt,
        marketOpen: false,
        nextOpen: clock.next_open,
        dataFeed: "IEX",
        prices: {},
        executionEnabled: false
      };
      await publish(payload);
      return;
    }

    const query = encodeURIComponent(SYMBOLS.join(","));
    const snapshots = await getJson(`${DATA_URL}/v2/stocks/snapshots?symbols=${query}&feed=iex`);
    const prices = Object.fromEntries(SYMBOLS.map((symbol) => [symbol, quote(snapshots[symbol])]));
    const payload = {
      service: "IA Trading RLR",
      mode: "SIMULACION",
      checkedAt,
      marketOpen: true,
      dataFeed: "IEX",
      prices,
      capitalVirtualMxn: 360000,
      vehicleReserveMxn: 260000,
      tradingCapitalMxn: 100000,
      maxLossMxn: 5000,
      executionEnabled: false
    };
    await publish(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    try {
      await sendToDashboard({
        service: "IA Trading RLR",
        mode: "SIMULACION",
        checkedAt,
        marketOpen: false,
        dataFeed: "IEX",
        prices: {},
        error: message,
        executionEnabled: false
      });
    } catch (reportError) {
      console.error(JSON.stringify({
        service: "IA Trading RLR",
        mode: "SIMULACION",
        checkedAt,
        error: message,
        dashboardError: reportError instanceof Error ? reportError.message : "No fue posible reportar la falla",
        executionEnabled: false
      }));
      process.exitCode = 1;
      return;
    }
    console.error(JSON.stringify({ service: "IA Trading RLR", mode: "SIMULACION", checkedAt, error: message, dashboardAccepted: true, executionEnabled: false }));
    process.exitCode = 1;
  }
}

main();
