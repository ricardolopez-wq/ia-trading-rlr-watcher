const DATA_URL = "https://data.alpaca.markets";
const TRADING_URL = "https://paper-api.alpaca.markets";
const GRAPH_URL = "https://graph.facebook.com";
const SYMBOLS = ["SPY", "VOO", "MSFT"];

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta la variable privada ${name}`);
  return value;
}

function optionalEnv(name) {
  return process.env[name]?.trim() || null;
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
      "OAI-Sites-Authorization": `Bearer ${requiredEnv("SITES_BYPASS_TOKEN")}`,
      "x-alert-secret": requiredEnv("ALERT_WEBHOOK_SECRET")
    },
    body: JSON.stringify(payload)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Tablero respondió ${response.status}: ${result.error || "sin detalle"}`);
  return result;
}

function whatsappConfig() {
  const accessToken = optionalEnv("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = optionalEnv("WHATSAPP_PHONE_NUMBER_ID");
  const toNumber = optionalEnv("WHATSAPP_TO_NUMBER")?.replace(/\D/g, "");
  if (!accessToken || !phoneNumberId || !toNumber) return null;
  return {
    accessToken,
    phoneNumberId,
    toNumber,
    templateName: optionalEnv("WHATSAPP_TEMPLATE_NAME") || "ia_trading_alerta",
    languageCode: optionalEnv("WHATSAPP_TEMPLATE_LANGUAGE") || "es_MX",
    graphVersion: optionalEnv("WHATSAPP_GRAPH_VERSION") || "v23.0"
  };
}

function firstValue(source, names) {
  for (const name of names) {
    const value = source?.[name];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return null;
}

function formatAlert(alert) {
  if (typeof alert === "string") return alert.slice(0, 900);
  const title = firstValue(alert, ["title", "type", "kind", "signal"]) || "Alerta de mercado";
  const symbol = firstValue(alert, ["symbol", "ticker", "asset"]);
  const instruction = firstValue(alert, ["instruction", "action", "message", "description"]);
  const price = firstValue(alert, ["price", "entry", "entryPrice"]);
  const stop = firstValue(alert, ["stop", "stopLoss"]);
  const target = firstValue(alert, ["target", "takeProfit"]);
  const lines = [`IA Trading RLR — ${title}`];
  if (symbol) lines.push(`Activo: ${symbol}`);
  if (instruction) lines.push(`Acción: ${instruction}`);
  if (price) lines.push(`Precio: ${price}`);
  if (stop) lines.push(`Stop: ${stop}`);
  if (target) lines.push(`Objetivo: ${target}`);
  if (lines.length === 1) lines.push(JSON.stringify(alert));
  lines.push("Modo: SIMULACIÓN. No ejecuta órdenes.");
  return lines.join("\n").slice(0, 900);
}

async function sendWhatsAppAlert(config, alert) {
  const response = await fetch(`${GRAPH_URL}/${config.graphVersion}/${config.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.accessToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: config.toNumber,
      type: "template",
      template: {
        name: config.templateName,
        language: { code: config.languageCode },
        components: [{
          type: "body",
          parameters: [{ type: "text", text: formatAlert(alert) }]
        }]
      }
    })
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = result?.error?.message || `HTTP ${response.status}`;
    throw new Error(`WhatsApp respondió: ${detail}`);
  }
  return result?.messages?.[0]?.id || null;
}

async function sendNewAlertsToWhatsApp(alerts) {
  const config = whatsappConfig();
  if (!config || !alerts.length) return { configured: Boolean(config), sent: 0, failed: 0 };
  let sent = 0;
  let failed = 0;
  for (const alert of alerts) {
    try {
      await sendWhatsAppAlert(config, alert);
      sent += 1;
    } catch (error) {
      failed += 1;
      console.warn(JSON.stringify({
        service: "IA Trading RLR",
        channel: "WhatsApp",
        error: error instanceof Error ? error.message : "No fue posible enviar la alerta"
      }));
    }
  }
  return { configured: true, sent, failed };
}

async function publish(payload) {
  try {
    const dashboard = await sendToDashboard(payload);
    const alerts = Array.isArray(dashboard.alerts) ? dashboard.alerts : [];
    const whatsapp = await sendNewAlertsToWhatsApp(alerts);
    console.log(JSON.stringify({
      ...payload,
      dashboardAccepted: true,
      alertsCreated: alerts.length,
      whatsappConfigured: whatsapp.configured,
      whatsappSent: whatsapp.sent,
      whatsappFailed: whatsapp.failed
    }));
    return { dashboardAccepted: true, alertsCreated: alerts.length, whatsapp };
  } catch (error) {
    console.warn(JSON.stringify({
      ...payload,
      dashboardAccepted: false,
      dashboardError: error instanceof Error ? error.message : "No fue posible actualizar el tablero"
    }));
    return { dashboardAccepted: false };
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
    const report = await publish({
      service: "IA Trading RLR",
      mode: "SIMULACION",
      checkedAt,
      marketOpen: false,
      dataFeed: "IEX",
      prices: {},
      error: message,
      executionEnabled: false
    });
    console.error(JSON.stringify({
      service: "IA Trading RLR",
      mode: "SIMULACION",
      checkedAt,
      error: message,
      dashboardAccepted: report.dashboardAccepted,
      executionEnabled: false
    }));
    process.exitCode = 1;
  }
}

main();
