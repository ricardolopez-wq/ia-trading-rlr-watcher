# IA Trading RLR Watcher

Vigilante de mercado para el piloto ficticio de Ricardo.

## Seguridad

- Sólo consulta el reloj bursátil y datos de mercado de Alpaca.
- No crea, modifica ni cancela órdenes.
- No contiene claves, tokens ni contraseñas.
- Opera en modo simulación con capital virtual de $360,000 MXN.
- Conserva un límite global de pérdida simulada de $5,000 MXN.
- WhatsApp sólo recibe las alertas nuevas que confirma el tablero.

## Activos iniciales

- SPY
- VOO
- MSFT

Regla inicial de SPY: entrada simulada máxima USD 757, stop USD 715 y objetivo USD 817.50.

## Render

Render ejecuta `npm start` cada cinco minutos de lunes a viernes. El programa consulta primero si el mercado estadounidense está abierto; cuando está cerrado registra el estado y termina.

Variables privadas requeridas en Render:

- `ALPACA_PAPER_API_KEY`
- `ALPACA_PAPER_SECRET_KEY`
- `ALERT_WEBHOOK_URL`
- `ALERT_WEBHOOK_SECRET`
- `SITES_BYPASS_TOKEN`

Variables de WhatsApp que se agregarán cuando Meta habilite el número de producción:

- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_TO_NUMBER`
- `WHATSAPP_TEMPLATE_NAME` (opcional; por defecto `ia_trading_alerta`)
- `WHATSAPP_TEMPLATE_LANGUAGE` (opcional; por defecto `es_MX`)
- `WHATSAPP_GRAPH_VERSION` (opcional; por defecto `v23.0`)

Si las tres variables obligatorias de WhatsApp no existen, el vigilante continúa actualizando el tablero y no intenta enviar mensajes.

Nunca escribas los valores de esas variables dentro de GitHub.
