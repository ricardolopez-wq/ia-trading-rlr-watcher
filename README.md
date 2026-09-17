# IA Trading RLR Watcher

Vigilante de mercado para el piloto ficticio de Ricardo.

## Seguridad

- Sólo consulta el reloj bursátil y datos de mercado de Alpaca.
- No crea, modifica ni cancela órdenes.
- No contiene claves ni contraseñas.
- Opera en modo simulación con capital virtual de $360,000 MXN.
- Conserva un límite global de pérdida simulada de $5,000 MXN.

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

Nunca escribas los valores de esas variables dentro de GitHub.
