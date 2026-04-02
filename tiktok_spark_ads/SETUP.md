# TikTok Spark Ads Automation - Setup

## Voraussetzungen

- Python 3.8+
- TikTok Developer App (approved)
- TikTok Ads Manager Account mit Advertiser ID
- Server mit öffentlicher URL (für Webhooks)
- SMTP-Zugang für E-Mail-Benachrichtigungen

## 1. Installation

```bash
cd tiktok_spark_ads
pip install -r requirements.txt
```

## 2. Credentials einrichten

```bash
cp setup.env.example .env
nano .env  # Credentials eintragen
```

Dann in eurer Shell (oder `.bashrc`/`.zshrc`):

```bash
export $(cat .env | xargs)
```

### Access Token generieren

1. OAuth-URL im Browser öffnen:
```
https://business-api.tiktok.com/portal/auth?app_id=YOUR_APP_ID&redirect_uri=https://hashtaghamburg.de&state=random123
```

2. Nach Autorisierung bekommt ihr einen `auth_code` als URL-Parameter.

3. Auth-Code gegen Access Token tauschen:
```bash
curl -X POST "https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/" \
  -H "Content-Type: application/json" \
  -d '{
    "app_id": "YOUR_APP_ID",
    "secret": "YOUR_APP_SECRET",
    "auth_code": "THE_AUTH_CODE"
  }'
```

4. `access_token` aus Response in `.env` eintragen.

## 3. Betriebsmodi

### Option A: Webhook (empfohlen — Echtzeit)

Der Webhook-Server reagiert sofort wenn ein neuer Post veröffentlicht wird.

#### Server starten

Entwicklung:
```bash
python webhook_server.py
```

Produktion (mit gunicorn):
```bash
gunicorn -w 2 -b 0.0.0.0:5050 webhook_server:app
```

#### Nginx Reverse Proxy (auf eurem Webserver)

In eurer Nginx-Config hinzufügen:

```nginx
location /webhook/tiktok {
    proxy_pass http://127.0.0.1:5050;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}

location /health {
    proxy_pass http://127.0.0.1:5050;
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

#### Webhook bei TikTok registrieren

Im TikTok Developer Portal → Your App → Webhooks:
- URL: `https://hashtaghamburg.de/webhook/tiktok`
- Verify Token: `hashtaghamburg_verify_2024` (oder euer eigener in .env)
- Events: `video.publish` / `content.publish`

#### Als Systemd-Service (damit es automatisch läuft)

```bash
sudo nano /etc/systemd/system/tiktok-ads.service
```

```ini
[Unit]
Description=TikTok Spark Ads Webhook Server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/pfad/zu/tiktok_spark_ads
EnvironmentFile=/pfad/zu/tiktok_spark_ads/.env
ExecStart=/usr/bin/python3 -m gunicorn -w 2 -b 127.0.0.1:5050 webhook_server:app
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable tiktok-ads
sudo systemctl start tiktok-ads
sudo systemctl status tiktok-ads
```

### Option B: Cron-Job (Fallback — täglich prüfen)

Falls Webhooks nicht funktionieren, prüft ein Cron-Job täglich:

```bash
crontab -e
```

```
0 9 * * * cd /pfad/zu/tiktok_spark_ads && /usr/bin/python3 main.py >> /var/log/tiktok_automation.log 2>&1
```

### Option C: Beides (empfohlen)

Webhook für Echtzeit + Cron als Backup falls ein Webhook verpasst wird.
Der Tracker (`promoted_posts.json`) verhindert Doppel-Promotions.

## 4. E-Mail-Benachrichtigungen

Bei jeder geschalteten Anzeige geht eine Mail an `moin@hashtaghamburg.de` mit:
- Post-Titel und Video-ID
- Budget-Details (€100 / 5 Tage)
- Campaign-, Ad Group- und Ad-IDs
- Link zum TikTok Ads Manager

### SMTP einrichten

**Gmail:** App-Passwort unter https://myaccount.google.com/apppasswords erstellen.

**Eigener Mailserver:** SMTP_HOST und Credentials in `.env` anpassen.

## 5. Test

```bash
# Dry run — prüft Posts ohne Ads zu schalten
python main.py --dry-run

# Health check des Webhook-Servers
curl https://hashtaghamburg.de/health
```

## 6. Post-Filter anpassen

In `config.py`:

```python
# Nur Posts mit bestimmten Hashtags promoten
REQUIRED_HASHTAGS = ["#boost", "#ad"]

# Nur Posts mit bestimmten Keywords
REQUIRED_CAPTION_KEYWORDS = ["launch", "neu"]

# Alle Posts promoten (Standard)
REQUIRED_HASHTAGS = None
REQUIRED_CAPTION_KEYWORDS = None
```

## Dateien

| Datei | Beschreibung |
|---|---|
| `config.py` | Alle Einstellungen (Budget, Filter, SMTP, Webhook) |
| `tiktok_api.py` | TikTok API Client (Campaign/Ad Group/Ad) |
| `main.py` | Cron-Modus: Post-Erkennung + Promotion |
| `webhook_server.py` | Webhook-Modus: Flask-Server für Echtzeit-Trigger |
| `notifier.py` | E-Mail-Benachrichtigungen (Erfolg + Fehler) |
| `promoted_posts.json` | Tracker für beworbene Posts (auto-generiert) |
| `automation.log` | Log-Datei (auto-generiert) |

## Troubleshooting

- **"Missing credentials"**: `.env` nicht geladen → `export $(cat .env | xargs)`
- **API Error 40001**: Access Token abgelaufen → neu generieren
- **API Error 40002**: Falsche Advertiser ID
- **Keine Videos**: TikTok Account muss im Business Center verknüpft sein
- **Webhook 403**: Falsches `verify_token` in `.env`
- **Keine E-Mail**: SMTP-Credentials prüfen, Port 587 offen?
- **Doppelte Ads**: `promoted_posts.json` prüfen
