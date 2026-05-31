# campus-relay-server

Campus relay server for EduHermes. It only handles accounts, device binding,
WebSocket relay, command status, and notifications. It does not run Hermes, OCR,
browser automation, or the campus knowledge base.

## Local Run

```bash
cp .env.example .env
npm install
npm start
```

Default listen address is `127.0.0.1:8780`. In production, expose it through
Nginx HTTPS, for example `https://relay.hhlai.xyz`.

## Main APIs

- `GET /health`
- `POST /auth/register`
- `POST /auth/login`
- `GET /me`
- `POST /devices/register`
- `GET /devices`
- `POST /pairing/desktop/start`
- `POST /pairing/claim`
- `POST /devices/:deviceId/pairing-code`
- `POST /devices/pair`
- `POST /commands`
- `GET /commands/:commandId`
- `WS /ws/desktop?token=<deviceToken>`
- `WS /ws/mobile?token=<userJwt>`

## Desktop Pairing Flow

1. Desktop app calls `POST /pairing/desktop/start`.
2. Server returns `{ code, pairingUrl, expiresAt, device, deviceToken }`.
3. Desktop stores `deviceToken` and shows `code` or `pairingUrl` as a QR code.
4. Mobile app logs in and calls `POST /pairing/claim` with `{ code }`.
5. Server binds the pending desktop device to the mobile user's account.

Example:

```bash
curl -X POST https://relay.hhlai.xyz/pairing/desktop/start \
  -H "Content-Type: application/json" \
  -d '{"deviceName":"宿舍电脑","platform":"windows"}'
```

```bash
curl -X POST https://relay.hhlai.xyz/pairing/claim \
  -H "Authorization: Bearer <userJwt>" \
  -H "Content-Type: application/json" \
  -d '{"code":"123456"}'
```

## Deploy With Baota

Suggested server directory:

```bash
/www/wwwroot/campus-relay-server
```

First deploy:

```bash
cd /www/wwwroot
git clone https://github.com/Roins-hub/campus-relay-server.git campus-relay-server
cd campus-relay-server
bash scripts/deploy.sh
```

Update:

```bash
cd /www/wwwroot/campus-relay-server
bash scripts/update-server.sh
```

If GitHub is slow in China, keep the remote mirror:

```bash
git remote set-url origin https://ghfast.top/https://github.com/Roins-hub/campus-relay-server.git
```
