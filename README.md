# campus-relay-server

校园智办服务器中转层。它只负责账号、设备、配对、WebSocket 消息转发和任务状态记录，不运行 Hermes、OCR、浏览器自动化或知识库。

## 本地运行

```bash
cp .env.example .env
npm install
npm start
```

默认监听 `127.0.0.1:8780`，建议在服务器上用 Nginx 反代到 HTTPS 域名。

## 主要接口

- `GET /health`
- `POST /auth/register`
- `POST /auth/login`
- `GET /me`
- `POST /devices/register`
- `GET /devices`
- `POST /devices/:deviceId/pairing-code`
- `POST /devices/pair`
- `POST /commands`
- `GET /commands/:commandId`
- `WS /ws/desktop?token=<deviceToken>`
- `WS /ws/mobile?token=<userJwt>`

## 部署到宝塔

服务器目录建议使用：

```bash
/www/wwwroot/campus-relay-server
```

第一次 Git 部署：

```bash
cd /www/wwwroot
git clone <你的仓库地址> campus-relay-server
cd campus-relay-server
bash scripts/deploy.sh
```

后续更新：

```bash
cd /www/wwwroot/campus-relay-server
bash scripts/update-server.sh
```

如果不用 Git，只是手动上传文件，也可以直接运行：

```bash
npm install --omit=dev
pm2 start src/server.js --name campus-relay-server
pm2 save
```
