# PodWealth — Spec para Claude Code

## Resumen de la idea

**PodWealth** es un investment club que vive dentro de un grupo de WhatsApp. 3-10 personas conectan sus cuentas Wallbit individuales (cada uno mantiene ownership total de su plata), y un bot agentic (OpenClaw + Claude) actúa como asesor colectivo que:
- Observa los portfolios individuales de cada miembro
- Propone trades coordinados pero asimétricos
- Media negociaciones cuando hay disenso
- Actúa proactivamente con alertas e insights

**Target**: remote workers latinoamericanos que ya usan Wallbit y ya tienen grupos de WhatsApp donde hablan de plata informalmente.

**Diferencial vs Hedge** (competidor principal): Hedge solo opera en US, fuerza montos iguales, requiere app propia, no tiene AI, y ve solo lo que pasa dentro del grupo. PodWealth resuelve los 5 gaps.

---

## Los 7 ejes diferenciadores

### Eje 1 — Enfocado en LATAM

**Qué significa en producto:**
- Idioma del bot: español neutro por defecto, detección automática de portuñol/inglés según el grupo
- Currency framing dual: muestra montos en USD (Wallbit) **y** equivalente en moneda local del usuario (ARS, BRL, COP, MXN, PEN, CLP)
- Contexto LATAM en los insights: "Esto equivale a 3 meses de alquiler en Buenos Aires" / "Es 2 salarios mínimos en México"
- Referencias culturales: el bot entiende "el blue", "el dólar paralelo", "PIX", "transferencia SPEI"
- Onboarding via WhatsApp (no SMS, no email) porque es el canal default de la región

**Implementación en el hackathon:**
- Un sistema prompt de Claude con contexto LATAM cargado
- Tabla de tipos de cambio (API gratis como exchangerate-api)
- Detección de geo desde el número de WhatsApp del usuario (código de país)

---

### Eje 2 — No obliga a montos iguales

**Qué significa en producto:**
- Cada miembro define su "contribution capacity" por mes (opcional, default: el bot lo infiere del histórico Wallbit)
- Cuando se propone un trade colectivo, el bot calcula splits proporcionales automáticamente
- 3 modos de split disponibles para el pod:
  - **Igual** (modo Hedge clásico, opción A)
  - **Proporcional** al capacity de cada uno (modo recomendado por el bot)
  - **Custom** (cada uno decide cuánto poner en ese trade específico)
- Si un miembro no quiere entrar a ese trade, el pod sigue sin él (no se bloquea por falta de unanimidad de plata)

**Ejemplo conversacional:**

> *Bot:* "Marcos propone $300 en VTI. Split sugerido proporcional:
> - Marcos: $150 (capacity alta)
> - María: $90
> - Juan: $60
> ¿Confirman individualmente? ✅ ❌ ⚙️ (custom)"

Cada uno decide solo lo suyo. Sin consenso forzado de monto.

---

### Eje 3 — Nativo en WhatsApp

**Qué significa en producto:**
- El pod **es** un grupo de WhatsApp existente o nuevo (el bot se agrega como participante)
- DMs separados con el bot para data privada (API keys, balances individuales, alertas privadas)
- Comandos cortos: `/balance`, `/propose VTI 300`, `/vote`, `/skip`, `/leave`
- Lenguaje natural también funciona: "che bot, ¿cómo vamos este mes?"
- Reacciones de WhatsApp como voting mechanism: 👍 = aprobar, 👎 = rechazar, ❓ = quiero discutir

**Implementación crítica:**
- WhatsApp Business Cloud API (Meta) — la oficial, gratis hasta 1000 conversaciones/mes
- Para el demo del hackathon alcanza fácil
- Twilio como alternativa si Meta da fricción de approval

**Separación crítica de canales:**
- **Grupo WhatsApp** → conversación pública del pod, propuestas, votos, insights del pod
- **DM privado con el bot** → API keys, balances individuales detallados, warnings personales, ejecución de trades

Nunca exponer balances individuales en el grupo sin consentimiento explícito del usuario.

---

### Eje 4 — IA con contexto del portafolio individual de cada miembro

**Qué significa en producto:**
- El bot lee **el portfolio Wallbit completo** de cada miembro (no solo lo del pod)
- Mantiene perfil dinámico por persona: risk profile inferido, sectoral exposure, cash idle, tax lots, transaction history
- Cuando hay una propuesta de trade, evalúa impact **para cada miembro por separado**
- Memoria de tesis individuales: "María mencionó que cree en biotech largo plazo", "Juan dijo que va a comprar un auto en 2 años así que cuida liquidez"

**Ejemplo de output:**

> *Propuesta: $200 en NVDA por miembro*
>
> *Bot DM privado a cada uno:*
> - **A Marcos**: "Ojo, ya tenés 18% en tech. Esto te lleva a 26%. ¿Seguro?"
> - **A María**: "Te quedan $340 cash idle, esta compra te baja a $140. Recordá que mencionaste querer reservar $500 para el viaje en marzo."
> - **A Juan**: "Bajo tech exposure (4%). Trade hace sentido para tu perfil. Te queda buffer cómodo de cash."

**Cada uno recibe el mismo trade contextualizado a su realidad**. Esto es lo que Hedge no puede hacer porque solo ve la slice del grupo.

**Risk profile inferido (no preguntado):**
- "70% de tu portfolio es ETFs amplios → conservador"
- "Tradeas 2-3 veces por mes → activo pero no day-trader"
- "Holdeas posiciones en promedio 8 meses → medium-term"
- "Tu mayor drawdown asumido fue -22% en marzo → tolerás volatilidad"

Lo presenta como confirmación binaria al usuario: 👍 va, 👎 corregir. No formularios.

---

### Eje 5 — Negociación mediada

**Qué significa en producto:**
- Si hay disenso, el bot no fuerza a votar. Abre un **negotiation thread** en el grupo
- Estructura la conversación: "María vota no. Acá las objeciones más comunes a [ticker] hoy: A, B, C. ¿Cuál es la tuya?"
- Genera **counterproposals** automáticas: "Si la objeción es el timing, ¿qué tal $100 ahora + $200 si baja a $X?", "Si es la concentración, ¿qué tal QQQ en vez de NVDA solo?"
- Mantiene historial de argumentos para no repetirse: "Esto ya lo discutieron hace 2 semanas, conclusión fue X"

**Ejemplo:**

> *Marcos: Propongo $500 en TSLA por cabeza*
> *María: 👎*
> *Bot: María, tu razón principal suele ser la volatilidad. ¿Es eso o algo diferente esta vez?*
> *María: La valuación, está cara*
> *Bot: Marcos, María cuestiona valuación (P/E actual: 67x vs media histórica 45x). 3 paths posibles:*
> *1. Esperar earnings (5 días) y reevaluar*
> *2. Reducir el size a $200 promedio*
> *3. Tickers similares con valuación más razonable: GM ($X), F ($Y)*
> *¿Cuál exploran?*

**Esto es el feature más diferencial del producto** — y el más demo-friendly. Mostrar esto en vivo es lo que vende el pitch.

---

### Eje 6 — Portfolio awareness combinado

**Qué significa en producto:**
- Vista combinada del pod: % por sector, geo, asset class, top 10 holdings
- Detección de correlaciones: "el pod combinado tiene 73% en tech, alta correlación a NASDAQ"
- Alertas de concentración: "Si aprueban este trade, el pod cruza 80% en US equities, sin exposure internacional"
- Comparación pod vs individual: cada miembro ve "tu portfolio individual" vs "el pod promedio"

**Display sugerido (resumen weekly):**

> *📊 Resumen semanal del Pod "Los Remotos"*
>
> *Combinado: $14,320 (+2.1% esta semana)*
> *Sectores: Tech 73% | Healthcare 8% | Cash 12% | Otros 7%*
> *🚨 Alert: cero exposure a bonos, cero mercados emergentes*
> *💡 Outlier de la semana: Sarah, +4.3% (vs pod promedio +2.1%) — cambió mix a más international ETFs hace 3 semanas*

**Importante:** este eje requiere que cada miembro consienta compartir su composición agregada con el grupo. Los montos absolutos individuales nunca se exponen al grupo (solo % relativos y cambios direccionales).

---

### Eje 7 — Proactividad

**Triggers de evento (real-time):**
- Trade ejecutado por cualquier miembro → análisis y publicación en el grupo en <30s
- Cash deposit recibido en una cuenta → "Juan, llegaron $500. ¿Querés que te proponga 3 opciones para alocar?"
- Drop de >5% en un activo que 2+ miembros tienen → alerta + contexto
- Earnings report de un ticker con exposure del pod → resumen y impacto

**Triggers temporales (cron):**
- Lunes 9am: "Foco de la semana: 3 earnings que importan para el pod"
- Viernes 6pm: "Recap semanal + score del pod"
- Cada último día del mes: "Performance mensual y rebalanceo sugerido"

**Triggers de comportamiento:**
- Si nadie habla en el grupo por 7 días: "¿Conversamos sobre [tema relevante]?"
- Si un miembro no trade en 30 días pero tiene cash idle: DM privado con sugerencia
- Si el pod tiene una racha de outperformance: celebración + recordatorio de fundamentals
- Si el pod tiene racha de loss: contexto + framing de largo plazo (anti-pánico)

**Implementación:**
- OpenClaw soporta cron jobs nativos
- Webhooks de Wallbit (si los exponen) para triggers de evento
- Si Wallbit no expone webhooks, polling cada N minutos a los endpoints de balance/transactions

---

## Demo flow de 3 minutos

Cada momento del demo activa uno o más ejes explícitamente.

### 0:00–0:20 — Setup
3 celulares en pantalla (Marcos en Buenos Aires, María en CDMX, Juan en São Paulo). Grupo de WhatsApp llamado "Los Remotos" ya existente, con conversaciones casuales de meses.

→ **Ejes activos: 3 (WhatsApp), 1 (LATAM)**

### 0:20–0:50 — Onboarding
Marcos agrega el bot al grupo. El bot se presenta brevemente. Cada uno recibe DM con magic link. Cada uno tapea autorizar en Wallbit (sin pegar API keys manualmente). Vuelven al grupo. El bot publica: *"Pod activo. $14,320 combinados, 3 miembros conectados. 60 segundos."*

→ **Ejes activos: 3 (sin app), 1 (LATAM-first onboarding)**

### 0:50–1:20 — Portfolio awareness
El bot publica auto-análisis: *"Vista combinada del pod: 73% tech, 0% bonos, 12% cash idle, exposure cero a Latam y emerging markets. Outlier: María ganó 4.3% vs pod promedio."*

→ **Ejes activos: 6 (portfolio awareness), 7 (proactividad)**

### 1:20–1:50 — Trade asimétrico
Marcos en el grupo: "che, viendo NVDA hoy, no?". Bot responde con propuesta y splits proporcionales: Marcos $150, María $90, Juan $60. **No iguales.**

→ **Ejes activos: 2 (montos asimétricos), 4 (contexto individual)**

### 1:50–2:20 — Negociación
María vota 👎. Bot abre negotiation: "María, ¿valuación o timing?". María: "Concentración". Bot propone counterproposal: "Si es por tech-concentración, ¿qué tal QQQ split entre 4 sectores?". Marcos y Juan reaccionan 👍. María 👍.

→ **Ejes activos: 5 (negociación mediada), 4 (IA en context)**

### 2:20–2:50 — Ejecución y context individual
Cada uno recibe DM privado con su propio sizing personalizado + warning si aplica. Tap. Trade ejecutado. Vuelve al grupo: *"3 trades ejecutados, total $300, pod ahora 68% tech (-5%), exposure ampliada."*

→ **Ejes activos: 4 (context individual), 6 (portfolio awareness post-trade)**

### 2:50–3:00 — Close
Bot programa: *"Próximo recap: viernes 6pm. ¿Querés alertas si algo del pod se mueve >5%? 🔔"*. Cierre del pitch.

→ **Ejes activos: 7 (proactividad)**
