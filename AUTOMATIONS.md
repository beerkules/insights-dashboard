# Hashtag Hamburg — Automations Migrationsprojekt

## Ziel

Automatisierungen von Zapier (und Make.com) auf den eigenen Server (Cloudflare Pages Functions / Python) übertragen. Gründe: mehr Kontrolle, weniger Abhängigkeit, Kosteneinsparung.

## Aktueller Stand (02.04.2026)

### Bereits migriert (auf eigenem Server)

| # | Name | Technik | Endpoint | Funktion |
|---|------|---------|----------|----------|
| 1 | Deal Won → Status "Kunde" & Telegram | Cloudflare Function (JS) | `/api/deal-won` | Close-Webhook empfangen → Lead-Status auf "Kunde" setzen → Telegram-Nachricht senden |
| 2 | Instagram Insights API | Cloudflare Function (JS) | `/api/insights` | Meta Graph API abfragen, Post-Insights für das Campaign Dashboard liefern |
| 3 | Screenshot Insights Extraktor (AI) | Cloudflare Function (JS) | `/api/extract` | Hochgeladene Insight-Screenshots per Claude API analysieren → strukturierte JSON-Daten |
| 4 | TikTok Spark Ads Automation | Python (eigener Server) | `/webhook/tiktok` | Neue TikTok-Posts erkennen → automatisch Spark Ad Kampagnen (€100 / 5 Tage) erstellen |
| 5 | **Calendly → Close Lead + Opportunity** | Cloudflare Function (JS) | `/api/calendly-lead` | Ersetzt 7 Calendly-Zaps + 2 SubZaps. Calendly-Webhook → Phone normalisieren → Round-Robin User → Lead suchen/erstellen → Opportunity anlegen. **Spart ~873 Zapier Tasks/Monat (70%)** |

### Noch auf Zapier (zu migrieren)

Gesamtverbrauch aktueller Billing-Zyklus (18.03. – 18.04.2026): **1.239 Tasks** von 5.000 (Team Plan)

**Task-Verbrauch pro Zap (absteigend):**

| Zap | Tasks | Status | Kategorie | Priorität |
|-----|------:|--------|-----------|-----------|
| (SUBZAP) Neuer Termin Kennenlerngespräch | 439 | ~~On~~ → **Migriert** | CRM | ✅ → /api/calendly-lead |
| (SubZap) Create A Lead in Close | 434 | ~~On~~ → **Migriert** | CRM | ✅ → /api/calendly-lead |
| Dialfire Coldcallings → Close | 138 | On | Outbound | ★★ |
| Neueröffnungen Import | 91 | On | CRM | ★★ |
| Deal Won → Status "Kunde" & Telegram | 50 | **Off** | CRM | ✅ Bereits migriert |
| Datev Upload | 34 | On | Billing | ★ |
| Screenshot #Hamburg → Close | 21 | On | Social | ★ |
| Typeform Moodboard → Gmail | 20 | On | Intern | ★ |
| Weekly Reminder - Salesteam | 12 | On | Intern | ★ |
| Webseite Leadformular → Close | 0 | On | CRM | ★ |
| Calendly (Erstgespräch/Direct Closing RoundRobin) → Close | 0 | On | CRM | ★ |
| Calendly (Erstgespräch) → Close | 0 | On | CRM | ★ |
| Calendly (Erstgespräch Benjamin) → Close | 0 | On | CRM | ★ |
| Calendly (Erstgespräch nach Coldcall) → Close | 0 | On | CRM | ★ |

**Top-Verbraucher:** Die beiden SubZaps (Neuer Termin + Create Lead) verbrauchen zusammen **873 von 1.239 Tasks (70%)**.
Diese werden von den verschiedenen Calendly-Zaps aufgerufen. Eine Migration der SubZaps + Calendly-Zaps würde den Zapier-Verbrauch um ~70% senken.

## Ordnerstruktur

```
dashboard-deploy/
├── automations.html          # Dashboard-UI: Übersicht aller Automations
├── admin.html                # Kunden-Dashboard
├── index.html                # Campaign Dashboard (Frontend)
├── favicon.svg
├── logo.svg / logo-dark.svg
├── functions/
│   └── api/
│       ├── deal-won.js       # ✅ Migriert: Close Webhook → Status + Telegram
│       ├── calendly-lead.js  # ✅ Migriert: Calendly → Close Lead + Opportunity (ersetzt 9 Zaps)
│       ├── insights.js       # ✅ Server: Instagram Insights via Meta Graph API
│       └── extract.js        # ✅ Server: Screenshot-Analyse via Claude API
├── tiktok_spark_ads/         # ✅ Migriert: Python-basierte TikTok Automation
│   ├── main.py               # Hauptlogik: Post-Erkennung + Kampagnen-Erstellung
│   ├── tiktok_api.py         # TikTok Marketing API Wrapper
│   ├── config.py             # Konfiguration (Env-Vars, Budget, Filter)
│   ├── notifier.py           # E-Mail-Benachrichtigungen
│   ├── webhook_server.py     # Webhook-Empfänger
│   ├── requirements.txt      # Python Dependencies
│   ├── setup.env.example     # Env-Var Template
│   └── SETUP.md              # Setup-Anleitung
└── img/                      # Bilder für Dashboard
```

## Env-Vars (benötigt für Server-Functions)

| Variable | Genutzt von |
|----------|-------------|
| `CLOSE_API_KEY` | deal-won.js |
| `TELEGRAM_BOT_TOKEN` | deal-won.js |
| `TELEGRAM_CHAT_ID` | deal-won.js |
| `META_PAGE_TOKEN` | insights.js |
| `IG_ACCOUNT_ID` | insights.js |
| `ANTHROPIC_API_KEY` | extract.js |
| `TIKTOK_ACCESS_TOKEN` | tiktok_spark_ads |
| `TIKTOK_ADVERTISER_ID` | tiktok_spark_ads |
| `TIKTOK_APP_SECRET` | tiktok_spark_ads |
| `SMTP_HOST/USER/PASSWORD` | tiktok_spark_ads (Notifications) |

## Empfohlene Migrationsreihenfolge

Basierend auf Task-Verbrauch und Komplexität:

1. ~~**Calendly → Close Lead-Erstellung (inkl. SubZaps)** — 873 Tasks/Monat, ~70% des Verbrauchs.~~
   ✅ **ERLEDIGT** → `functions/api/calendly-lead.js`

2. **Dialfire Coldcallings → Close** — 138 Tasks/Monat.
   Dialfire Webhook → CF Function → Close API Update.

3. **Neueröffnungen Import** — 91 Tasks/Monat.
   Datenquelle analysieren, dann als Cron oder Webhook umsetzen.

4. **Datev Upload** — 34 Tasks/Monat.
   Google Drive/Mail → Datev Integration. Komplexität abhängig von Datev-API.

5. **Screenshot #Hamburg → Close** — 21 Tasks/Monat.
   Instagram Monitoring + Close Lead-Erstellung.

6. **Rest** (Typeform, Weekly Reminder, Webseite Leadformular) — niedrig, aber einfach zu migrieren.

## Nächster Schritt

→ **Dialfire Coldcallings → Close** als Cloudflare Function implementieren (138 Tasks/Monat).

## Deployment-Anleitung für calendly-lead.js

### 1. Env Var sicherstellen
`CLOSE_API_KEY` muss bereits gesetzt sein (wird auch von deal-won.js genutzt).

### 2. Calendly Webhook konfigurieren
```
URL: https://hashtaghamburg.de/api/calendly-lead
Events: invitee.created
```
In Calendly: Organization → Integrations → Webhooks → Subscribe.
Einen einzigen Webhook für alle Event Types erstellen — die Function unterscheidet intern.

### 3. Custom Field IDs in Close prüfen
Die Custom Field IDs in `calendly-lead.js` nutzen Platzhalter-Prefixe (`custom.cf_*`).
Die echten IDs müssen aus Close geholt werden:
```
GET https://api.close.com/api/v1/custom_field/lead/
```
Und dann in der Function angepasst werden.

## Hinweis: Login automations.html

Das Automations-Dashboard (`automations.html`) nutzt ein Hardcoded-Passwort im Frontend-JS. Für Produktionseinsatz sollte das durch serverseitige Auth ersetzt werden.
