const DATA_URL = "https://data.alpaca.markets";
const TRADING_URL = "https://paper-api.alpaca.markets";
const GRAPH_URL = "https://graph.facebook.com";
const US_SYMBOLS = ["SPY", "QQQ", "VOO", "MSFT", "NVDA", "AMZN", "AAPL", "META", "GOOGL", "TSLA", "AVGO", "AMD"];
const MEXICO_SYMBOLS = {
  "NAFTRAC": "NAFTRACISHRS.MX",
  "WALMEX": "WALMEX.MX",
  "AMXL": "AMXL.MX",
  "FEMSAUBD": "FEMSAUBD.MX",
  "CEMEXCPO": "CEMEXCPO.MX",
  "BIMBOA": "BIMBOA.MX",
  "GMEXICOB": "GMEXICOB.MX",
  "GAPB": "GAPB.MX",
  "ASURB": "ASURB.MX",
  "GCARSOA1": "GCARSOA1.MX",
  "VISTAA": "VISTAA.MX",
  "TLEVISACPO": "TLEVISACPO.MX",
  "FMTY14": "FMTY14.MX",
  "DANHOS13": "DANHOS13.MX",
  "KIMBERA": "KIMBERA.MX"
};

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

async function getPublicJson(url) {
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "IA-Trading-RLR/1.0" }
  });
  if (!response.ok) throw new Error(`Fuente pública respondió ${response.status}`);
  return response.json();
}

async function fetchYahooQuote(symbol, displaySymbol, market) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=5m&range=5d`;
  const data = await getPublicJson(url);
  const chart = data?.chart?.result?.[0];
  if (!chart) throw new Error(`Sin cotización para ${displaySymbol}`);
  const meta = chart.meta || {};
  const timestamps = chart.timestamp || [];
  const quoteData = chart.indicators?.quote?.[0] || {};
  const latestIndex = timestamps.length - 1;
  const timestamp = Number(timestamps[latestIndex]) * 1000;
  const latestVolume = Number(quoteData.volume?.[latestIndex]);
  const current = Number(meta.regularMarketPrice);
  const previousClose = Number(meta.chartPreviousClose ?? meta.previousClose);
  const ageMinutes = Number.isFinite(timestamp) ? Math.max(0, (Date.now() - timestamp) / 60000) : null;
  return {
    market,
    route: market === "MX" ? "Trading MX" : "SIC",
    source: "Yahoo public chart (experimental)",
    sourceSymbol: symbol,
    currency: meta.currency || (market === "MX" ? "MXN" : "USD"),
    trade: Number.isFinite(current) ? current : null,
    close: Number.isFinite(current) ? current : null,
    previousClose: Number.isFinite(previousClose) ? previousClose : null,
    volume: Number.isFinite(latestVolume) ? latestVolume : null,
    timestamp: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null,
    ageMinutes,
    tradeableForSimulation: market !== "MX" || (meta.currency === "MXN" && Number.isFinite(ageMinutes) && ageMinutes <= 15),
    realTradingAuthorized: false
  };
}

async function fetchMexicoPrices() {
  const entries = Object.entries(MEXICO_SYMBOLS);
  const settled = await Promise.allSettled(entries.map(([display, source]) =>
    fetchYahooQuote(source, display, "MX").then((value) => [display, value])
  ));
  return Object.fromEntries(settled.filter((item) => item.status === "fulfilled").map((item) => item.value));
}

async function fetchUsdMxn() {
  const quote = await fetchYahooQuote("MXN=X", "USD/MXN", "FX");
  return quote.trade;
}

function quote(snapshot) {
  const numberOrNull = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
  return {
    ask: numberOrNull(snapshot?.latestQuote?.ap),
    bid: numberOrNull(snapshot?.latestQuote?.bp),
    trade: numberOrNull(snapshot?.latestTrade?.p),
    close: numberOrNull(snapshot?.minuteBar?.c ?? snapshot?.dailyBar?.c ?? snapshot?.prevDailyBar?.c),
    previousClose: numberOrNull(snapshot?.prevDailyBar?.c),
    market: "US",
    route: "SIC",
    source: "Alpaca IEX",
    currency: "USD",
    realTradingAuthorized: false
  };
}

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

function marketCandidates(prices) {
  return Object.entries(prices)
    .map(([symbol, price]) => {
      const current = price.trade ?? price.close;
      const previous = price.previousClose;
      const changePct = current && previous ? ((current - previous) / previous) * 100 : null;
      const spreadPct = price.ask && price.bid ? ((price.ask - price.bid) / ((price.ask + price.bid) / 2)) * 100 : null;
      return { symbol, ...price, changePct, spreadPct };
    })
    .filter((item) =>
      Number.isFinite(item.changePct) &&
      Math.abs(item.changePct) >= 0.4 &&
      (!Number.isFinite(item.spreadPct) || item.spreadPct <= 0.8) &&
      (item.market !== "MX" || item.tradeableForSimulation === true)
    )
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
    .slice(0, 6);
}

function validateProposal(analysis, candidates, fxUsdMxn) {
  if (analysis?.status !== "PROPONER") return analysis;

  const candidate = candidates.find((item) => item.symbol === analysis.symbol);
  const entryMax = Number(analysis.entryMax);
  const stop = Number(analysis.stop);
  const proposedCapital = Number(analysis.capitalMxn);
  const currency = analysis.currency || candidate?.currency;
  const fx = currency === "USD" ? Number(fxUsdMxn) : 1;
  const unitCostMxn = entryMax * fx;
  const titles = Math.floor(proposedCapital / unitCostMxn);
  const estimatedCostMxn = proposedCapital * 0.005;
  const priceRiskMxn = (entryMax - stop) * fx * titles;
  const totalRiskMxn = priceRiskMxn + estimatedCostMxn;

  const invalid = (
    analysis.action !== "BUY" ||
    analysis.orderType !== "LIMITADA" ||
    !candidate ||
    !Number.isFinite(fx) || fx <= 0 ||
    !Number.isFinite(entryMax) || entryMax <= 0 ||
    !Number.isFinite(stop) || stop <= 0 || stop >= entryMax ||
    !Number.isFinite(proposedCapital) || proposedCapital <= 0 || proposedCapital > 20000 ||
    titles < 1 ||
    !Number.isFinite(totalRiskMxn) || totalRiskMxn > 500
  );

  if (invalid) {
    return {
      status: "ESPERAR",
      reason: "La propuesta de IA fue rechazada por el control matemático de títulos, capital o riesgo.",
      rejectedProposal: {
        symbol: analysis.symbol || null,
        proposedCapitalMxn: Number.isFinite(proposedCapital) ? proposedCapital : null,
        unitCostMxn: Number.isFinite(unitCostMxn) ? Number(unitCostMxn.toFixed(2)) : null,
        titles: Number.isFinite(titles) ? titles : null,
        calculatedRiskMxn: Number.isFinite(totalRiskMxn) ? Number(totalRiskMxn.toFixed(2)) : null
      }
    };
  }

  const actualCapitalMxn = unitCostMxn * titles;
  return {
    ...analysis,
    titles,
    capitalMxn: Number(actualCapitalMxn.toFixed(2)),
    estimatedRoundTripCostMxn: Number((actualCapitalMxn * 0.005).toFixed(2)),
    riskMxn: Number((((entryMax - stop) * fx * titles) + actualCapitalMxn * 0.005).toFixed(2))
  };
}

async function analyzeWithAI(prices, checkedAt, fxUsdMxn) {
  const candidates = marketCandidates(prices);
  if (!candidates.length) {
    return { status: "ESPERAR", reason: "No hay movimientos que superen el filtro previo de 0.4%.", candidates: [] };
  }

  const prompt = [
    "Eres el motor prudente de propuestas de IA Trading RLR.",
    "Trabajas exclusivamente en SIMULACIÓN; nunca afirmes que ejecutaste una orden.",
    "Capital total: 100000 MXN. Bolsa intradía máxima: 20000 MXN.",
    "Riesgo máximo por operación: 500 MXN. Pérdida diaria máxima: 1000 MXN. Bloqueo acumulado: 5000 MXN.",
    "Analizas simultáneamente Trading MX y EUA/SIC. EUA usa Alpaca IEX; México usa una fuente pública experimental solo para simulación.",
    "Si los datos no bastan, elige ESPERAR. No inventes información.",
    "Devuelve exclusivamente JSON válido con: status (PROPONER o ESPERAR), strategy, symbol, action, orderType, entryMin, entryMax, capitalMxn, target, stop, validity, cancelIf, rationale, confidence y dataLimitations.",
    "Para PROPONER usa orden LIMITADA, capitalMxn <= 20000, riesgo <= 500 MXN y considera un costo estimado total de entrada y salida de 0.50%.",
    "Incluye titles como número entero de títulos completos. capitalMxn debe cubrir entryMax * titles convertido a MXN; si no alcanza para 1 título, elige ESPERAR.",
    "No propongas México si tradeableForSimulation no es true. No autorices dinero real con fuentes experimentales.",
    "Incluye además market, route, currency, titles, estimatedRoundTripCostMxn y riskMxn.",
    `Hora UTC: ${checkedAt}`,
    `Tipo de cambio USD/MXN: ${fxUsdMxn || "no disponible"}`,
    `Candidatos: ${JSON.stringify(candidates.map((item) => ({
      ...item,
      priceMxn: item.currency === "USD" && fxUsdMxn ? (item.trade ?? item.close) * fxUsdMxn : (item.trade ?? item.close)
    })))}`
  ].join("\n");

  const response = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${requiredEnv("OPENAI_API_KEY")}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: optionalEnv("OPENAI_MODEL") || "gpt-5-mini",
      messages: [
        { role: "system", content: "Analiza riesgo bursátil de forma conservadora y responde solo JSON válido." },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" },
      reasoning_effort: "low",
      max_completion_tokens: 2000
    })
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = result?.error?.message || `HTTP ${response.status}`;
    throw new Error(`OpenAI respondió: ${detail}`);
  }

  const rawContent = result?.choices?.[0]?.message?.content;
  const content = typeof rawContent === "string"
    ? rawContent
    : Array.isArray(rawContent)
      ? rawContent.map((part) => part?.text || "").join("")
      : "";
  if (!content.trim()) {
    const finishReason = result?.choices?.[0]?.finish_reason || "sin detalle";
    throw new Error(`OpenAI no devolvió un análisis utilizable (${finishReason})`);
  }
  const analysis = validateProposal(JSON.parse(content), candidates, fxUsdMxn);
  return { ...analysis, candidates, generatedAt: checkedAt, model: optionalEnv("OPENAI_MODEL") || "gpt-5-mini" };
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
    const [mexicoPrices, fxUsdMxn] = await Promise.all([
      fetchMexicoPrices(),
      fetchUsdMxn().catch(() => null)
    ]);

    let usPrices = {};
    if (clock.is_open) {
      const query = encodeURIComponent(US_SYMBOLS.join(","));
      const snapshots = await getJson(`${DATA_URL}/v2/stocks/snapshots?symbols=${query}&feed=iex`);
      usPrices = Object.fromEntries(US_SYMBOLS.map((symbol) => [symbol, quote(snapshots[symbol])]));
    }

    const prices = { ...mexicoPrices, ...usPrices };
    let aiAnalysis;
    try {
      aiAnalysis = await analyzeWithAI(prices, checkedAt, fxUsdMxn);
    } catch (error) {
      aiAnalysis = {
        status: "ESPERAR",
        reason: "El análisis de IA no estuvo disponible; no se propone ninguna operación.",
        error: error instanceof Error ? error.message : "Error desconocido"
      };
    }
    const payload = {
      service: "IA Trading RLR",
      mode: "SIMULACION",
      checkedAt,
      marketOpen: clock.is_open,
      mexicoMarketDataAvailable: Object.keys(mexicoPrices).length > 0,
      dataFeeds: { us: "Alpaca IEX", mexico: "Yahoo public chart (experimental, simulation only)" },
      fxUsdMxn,
      prices,
      tradingCapitalMxn: 100000,
      intradayCapitalMxn: 20000,
      reserveMxn: 80000,
      maxRiskPerTradeMxn: 500,
      maxDailyLossMxn: 1000,
      maxLossMxn: 5000,
      aiConnected: true,
      aiAnalysis,
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
