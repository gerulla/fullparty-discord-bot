# FullParty Discord Bot VPS Deployment

This is the production setup checklist for running the FullParty Discord bot on a VPS behind `bot.fullparty.gg`.

These steps assume an Ubuntu/Debian VPS and that `bot.fullparty.gg` already points to the VPS IP through Cloudflare DNS.

## 1. Install System Packages

```bash
sudo apt update
sudo apt install -y git curl nginx ufw
```

Install Node.js 22:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

node -v
npm -v
```

The bot expects Node `>=22.12.0`.

## 2. Create App Directory

`/opt` is used here because it is a common Linux location for self-contained service apps.

```bash
sudo mkdir -p /opt/fullparty-discord-bot
sudo chown -R $USER:$USER /opt/fullparty-discord-bot
cd /opt/fullparty-discord-bot
```

Clone the repo:

```bash
git clone YOUR_REPO_URL .
```

Install and build:

```bash
npm ci
npm run build
```

## 3. Create Production Environment File

Create `.env`:

```bash
nano .env
```

Use this shape:

```env
NODE_ENV=production

DISCORD_TOKEN=your_rotated_bot_token
DISCORD_CLIENT_ID=your_discord_client_id
DISCORD_COMMAND_REGISTER_SCOPE=global

FULLPARTY_API_BASE_URL=https://fullparty.gg/api
FULLPARTY_API_TOKEN=your_fullparty_integration_api_token
FULLPARTY_WEB_BASE_URL=https://fullparty.gg
FULLPARTY_WEBHOOK_SIGNING_SECRET=your_webhook_signing_secret

DATABASE_PATH=data/fullparty-discord-bot.sqlite

HTTP_HOST=127.0.0.1
HTTP_PORT=3000
LOG_LEVEL=info

PAYLOAD_COMMAND_ALLOWED_USER_ID=your_discord_user_id
```

Important notes:

- The bot expects `DISCORD_TOKEN`, not `DISCORD_BOT_TOKEN`.
- Rotate the Discord bot token before production if it was ever pasted somewhere unsafe.
- `FULLPARTY_WEBHOOK_SIGNING_SECRET` must match the secret FullParty uses to sign outbound events.
- `FULLPARTY_API_TOKEN` is used when the bot calls the FullParty API.
- `PAYLOAD_COMMAND_ALLOWED_USER_ID` controls who can use `/payload`. Leave it empty to deny `/payload` to everyone.

Create the SQLite data folder:

```bash
mkdir -p data
```

## 4. Test The Bot Manually

```bash
npm start
```

Expected boot logs include:

```text
[FullParty Bot] Boot file loaded.
[FullParty Bot] Starting webhook server.
[FullParty Bot] Starting Discord client login.
```

Stop it with:

```bash
Ctrl+C
```

Deploy global Discord commands:

```bash
npm run commands:deploy:global
```

Use global deploy for user-installed and DM commands.

## 5. Create systemd Service

Create the service file:

```bash
sudo nano /etc/systemd/system/fullparty-discord-bot.service
```

Paste:

```ini
[Unit]
Description=FullParty Discord Bot
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/fullparty-discord-bot
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable fullparty-discord-bot
sudo systemctl start fullparty-discord-bot
```

Watch logs:

```bash
sudo journalctl -u fullparty-discord-bot -f
```

Show recent logs:

```bash
sudo journalctl -u fullparty-discord-bot -n 100 --no-pager
```

## 6. Configure Nginx Reverse Proxy

Create the Nginx site:

```bash
sudo nano /etc/nginx/sites-available/fullparty-discord-bot
```

Paste:

```nginx
server {
    listen 80;
    server_name bot.fullparty.gg;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        add_header Cache-Control "no-store";
    }
}
```

Enable it:

```bash
sudo ln -s /etc/nginx/sites-available/fullparty-discord-bot /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## 7. Enable HTTPS

If Certbot has trouble while Cloudflare proxy is enabled, temporarily set `bot.fullparty.gg` to DNS only in Cloudflare.

Install Certbot:

```bash
sudo apt install -y certbot python3-certbot-nginx
```

Request and install certificate:

```bash
sudo certbot --nginx -d bot.fullparty.gg
```

After HTTPS works, Cloudflare SSL mode should be:

```text
Full (strict)
```

You can turn the orange cloud proxy back on after HTTPS is working.

## 8. Configure Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

## 9. Configure FullParty Outbound Events URL

In the FullParty integration/admin settings, set the outbound events URL to:

```text
https://bot.fullparty.gg/events
```

The signed healthcheck should hit:

```text
GET /events
```

The simple app health endpoint is:

```text
GET /health
```

Important logging note:

- `GET /events` healthchecks are logged as FullParty events.
- `POST /events` event deliveries are logged as FullParty events.
- `GET /health` returns healthy but does not currently log an event line.

Expected event log example:

```text
[FullParty Bot] Event received from ...: integration.healthcheck (GET /events).
```

## 10. Common Runtime Commands

Start:

```bash
sudo systemctl start fullparty-discord-bot
```

Stop:

```bash
sudo systemctl stop fullparty-discord-bot
```

Restart:

```bash
sudo systemctl restart fullparty-discord-bot
```

Status:

```bash
sudo systemctl status fullparty-discord-bot
```

Follow logs:

```bash
sudo journalctl -u fullparty-discord-bot -f
```

## 11. Deploy Updates

From the VPS:

```bash
cd /opt/fullparty-discord-bot
git pull
npm ci
npm run build
sudo systemctl restart fullparty-discord-bot
```

If slash commands changed:

```bash
npm run commands:deploy:global
```

## 12. Automatic Deploys From GitHub

This repo includes a GitHub Actions workflow at:

```text
.github/workflows/deploy.yml
```

On every push to `master`, it will:

1. Install dependencies.
2. Run format check, lint, tests, and build.
3. SSH into the VPS.
4. Pull `origin/master`.
5. Run `npm ci`.
6. Run `npm run build`.
7. Restart `fullparty-discord-bot`.

The VPS deploy commands live in:

```text
scripts/deploy-production.sh
```

### VPS SSH User

Use a normal deploy user if possible. The examples below use `deploy`.

```bash
sudo adduser deploy
sudo chown -R deploy:deploy /opt/fullparty-discord-bot
```

If you already cloned the repo as another user, either use that user for `VPS_USER` or move ownership to the deploy user.

### Allow Restarting The Service

The deploy script needs to restart the systemd service.

Find the `systemctl` path:

```bash
command -v systemctl
```

Usually this is:

```text
/usr/bin/systemctl
```

Create a sudoers file:

```bash
sudo visudo -f /etc/sudoers.d/fullparty-discord-bot-deploy
```

Paste this, replacing `deploy` if your SSH user is different and replacing `/usr/bin/systemctl` if your VPS returned another path:

```text
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart fullparty-discord-bot, /usr/bin/systemctl is-active --quiet fullparty-discord-bot
```

### Create SSH Key For GitHub Actions

On your local machine, create a key just for deploys:

```bash
ssh-keygen -t ed25519 -C "github-actions-fullparty-discord-bot" -f fullparty-discord-bot-deploy
```

This creates:

```text
fullparty-discord-bot-deploy
fullparty-discord-bot-deploy.pub
```

Add the public key to the VPS deploy user:

```bash
ssh deploy@YOUR_VPS_IP
mkdir -p ~/.ssh
chmod 700 ~/.ssh
nano ~/.ssh/authorized_keys
```

Paste the contents of `fullparty-discord-bot-deploy.pub`, then:

```bash
chmod 600 ~/.ssh/authorized_keys
```

Test from your local machine:

```bash
ssh -i fullparty-discord-bot-deploy deploy@YOUR_VPS_IP
```

Important: for `VPS_HOST`, use the VPS IP or a DNS-only hostname. Do not use a Cloudflare orange-cloud proxied hostname for SSH.

### Add GitHub Actions Secrets

In GitHub:

```text
Repo -> Settings -> Secrets and variables -> Actions -> New repository secret
```

Add:

```text
VPS_HOST=your_vps_ip_or_dns_only_hostname
VPS_USER=deploy
VPS_PORT=22
VPS_SSH_KEY=contents_of_fullparty-discord-bot-deploy_private_key
```

`VPS_PORT` is optional if SSH is on port `22`.

### Private Repo Note

The deploy workflow runs `git fetch` on the VPS. If the GitHub repo is private, the VPS itself must also be able to pull it.

Recommended setup:

```bash
ssh-keygen -t ed25519 -C "vps-fullparty-discord-bot-repo" -f ~/.ssh/fullparty_repo_deploy
cat ~/.ssh/fullparty_repo_deploy.pub
```

Add that public key in GitHub:

```text
Repo -> Settings -> Deploy keys -> Add deploy key
```

Read-only access is enough.

Then on the VPS:

```bash
cd /opt/fullparty-discord-bot
git remote set-url origin git@github.com:gerulla/fullparty-discord-bot.git
```

Test:

```bash
git fetch origin
```

### Manual Deploy With The Same Script

You can also run the exact deploy process manually on the VPS:

```bash
cd /opt/fullparty-discord-bot
bash scripts/deploy-production.sh
```

### If Slash Commands Changed

The normal auto deploy does not run:

```bash
npm run commands:deploy:global
```

This avoids accidentally touching Discord command registration on every code deploy.

To deploy slash command changes from GitHub, use the manual workflow:

```text
GitHub repo -> Actions -> Deploy Discord Commands -> Run workflow
```

That workflow lives at:

```text
.github/workflows/deploy-commands.yml
```

It needs these repository secrets:

```text
DISCORD_CLIENT_ID
DISCORD_TOKEN
```

You can still run the command registration manually on the VPS:

```bash
npm run commands:deploy:global
```

## 13. Troubleshooting

If the bot does not start:

```bash
sudo journalctl -u fullparty-discord-bot -n 100 --no-pager
```

If Nginx config fails:

```bash
sudo nginx -t
```

If FullParty healthcheck passes but you do not see logs:

- Confirm FullParty is calling `https://bot.fullparty.gg/events`, not `/health`.
- Check service logs with `journalctl`, not the SSH terminal:

```bash
sudo journalctl -u fullparty-discord-bot -f
```

If Discord commands are stale:

```bash
npm run commands:deploy:global
```

Global Discord commands can take a little time to refresh.
