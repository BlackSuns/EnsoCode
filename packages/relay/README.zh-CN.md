# EnsoCode 中继

<p align="right"><a href="README.md">English</a></p>

手机伴侣 / 远程节点的配对与密文转发服务。中继**只转发密文**，不能解密聊天。

默认公共实例：`https://enso-relay.j3.do`（Cloudflare Worker）。也可以自建。

自建后，在桌面端 **设置 → 设备 → 中继地址** 填你的 URL。两端必须指向同一中继。

| | Cloudflare Worker（推荐） | Go 单二进制 |
| --- | --- | --- |
| 适合 | 自定义域、全球边缘 | 自己的机器 / NAS / VPS |
| 依赖 | Node、Wrangler、CF 账号 | 无（一个文件） |
| 数据 | Durable Object（SQLite） | 旁边的 `relay.sqlite` |
| 手机 PWA | 与 Worker 同域静态资源 | 已内嵌，打开中继根地址即可 |

协议兼容，客户端不用改。更细的 Go 运行说明见 [`../relay-go/README.zh-CN.md`](../relay-go/README.zh-CN.md)。

---

## 方式一：Cloudflare Worker（推荐）

源码在本目录，生产域名 `enso-relay.j3.do`。

```bash
pnpm install
pnpm --filter @enso/relay release          # 生产
pnpm --filter @enso/relay release:dev      # 开发副本 enso-relay-dev.j3.do
```

需要 `CLOUDFLARE_API_TOKEN` 与 `CLOUDFLARE_ACCOUNT_ID`。自定义域写在 `wrangler.jsonc` 的 `routes`。

`pnpm --filter @enso/relay dev` 会先构建手机 PWA 再 `wrangler dev`。

推送到 `dev` 且改动 `packages/relay`、`packages/phone` 或 `packages/pair` 时，`.github/workflows/deploy-relay.yml` 会自动部署生产 Worker。

---

## 方式二：Go 单二进制

适合没有 Cloudflare 的机器。应用 Release 发布后会再构建中继，并挂到同一个 [GitHub Release](https://github.com/J3n5en/EnsoCode/releases/latest)：

- `enso-relay-linux-amd64`（x86_64）
- `enso-relay-linux-arm64`（aarch64）

```bash
chmod +x enso-relay-linux-amd64
./enso-relay-linux-amd64
```

无需配置。默认监听 `:8787`，SQLite 建在可执行文件旁边，PWA 已打进二进制。

把桌面中继地址设为：

- 同一台机器：`http://127.0.0.1:8787`
- 局域网：`http://<局域网IP>:8787`（启动日志会打印）
- 公网：必须 HTTPS，例如 `https://relay.example.com`

手机浏览器打开同一个地址即可扫码配对。

可选环境变量 / 参数：`--listen`、`--db`、`--tls-cert`、`--tls-key`（`RELAY_LISTEN` / `RELAY_DB` / `RELAY_TLS_CERT` / `RELAY_TLS_KEY`）。

### 公网 HTTPS

公网手机端需要 HTTPS。局域网用 HTTP 即可。

**Caddy**（自动签证书，WebSocket 不用额外配置）：

```caddy
relay.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

**Nginx**（WebSocket 升级 + 长超时，配对连接会一直开着）：

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl http2;
    server_name relay.example.com;
    ssl_certificate     /etc/letsencrypt/live/relay.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/relay.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_read_timeout 7d;
        proxy_send_timeout 7d;
    }
}
```

**不反代** — 证书交给进程自己终止 TLS。证书自己准备（certbot、已有文件等），进程不会续期。

```bash
./enso-relay \
  --listen :443 \
  --tls-cert /etc/letsencrypt/live/relay.example.com/fullchain.pem \
  --tls-key  /etc/letsencrypt/live/relay.example.com/privkey.pem
```

监听 `:443` 需要 root 或 `cap_net_bind_service`。certbot 续期后重启进程（或写 deploy hook）。HTTP-01 仍要占用 80 端口；没有反代时用 DNS-01，或先 `certbot standalone` 签好再启动中继。

桌面中继地址填 `https://relay.example.com`。

---

## 协议摘要

客户端只依赖这些接口（Go / CF 行为一致）：

- `POST /v1/pair/request` `{ publicKey }`
- `POST /v1/pair/claim` `{ publicKey, boxedKey, deviceName? }`
- `WS /v1/pair/:id?role=host|guest&token=`
- `DELETE /v1/pair/:id?token=`

文本 `ping` → `pong`（不转发给对端）。业务帧只转发、上限 1MB。无效 token 先升级 WebSocket 再以 `1008 revoked` 关闭。
