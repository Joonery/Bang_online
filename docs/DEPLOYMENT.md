# Oracle VM 배포

## 운영 구조

```text
브라우저 4~7개
  ├─ HTTPS POST (플레이어 행동·채팅)
  └─ HTTPS SSE  (상태 변경·재접속)
             ↓
Caddy :443 / :80
             ↓ 127.0.0.1:3000
Node.js 단일 프로세스
             ↓
메모리의 단일 게임 세션 (DB 없음)
```

Sesil_BoardGame에서 검증된 Caddy → Node.js → SSE 구조를 재사용했습니다. 외부 npm 패키지, Redis, DB, 컨테이너는 필요하지 않습니다.

## 1. 서버 준비

Ubuntu 계열 Oracle VM에 Node.js 22 이상과 Caddy를 설치합니다. Oracle Cloud 보안 목록과 OS 방화벽에서 TCP 80/443을 허용하고, 도메인의 A 레코드를 VM 공인 IP로 연결합니다.

```bash
node --version
caddy version
```

## 2. 코드 배치

```bash
sudo mkdir -p /opt/bang-online
sudo cp -R . /opt/bang-online
sudo useradd --system --home /opt/bang-online --shell /usr/sbin/nologin banggame || true
sudo chown -R banggame:banggame /opt/bang-online
```

Git clone/pull로 배치해도 됩니다. dependency가 없으므로 `npm install`은 실행하지 않아도 됩니다.

배포 전 검사:

```bash
cd /opt/bang-online
npm run check
npm test
```

## 3. systemd 등록

```bash
sudo cp /opt/bang-online/deploy/bang-online.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now bang-online
sudo systemctl status bang-online
curl http://127.0.0.1:3000/api/health
```

정상 응답은 `{"ok":true,...}`입니다.

로그 확인:

```bash
journalctl -u bang-online -f
```

## 4. HTTPS와 reverse proxy

`deploy/Caddyfile`의 `bang.example.com`을 실제 도메인으로 바꿉니다.

```bash
sudo cp /opt/bang-online/deploy/Caddyfile /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy는 인증서를 자동 발급하고 gzip/zstd 압축을 적용합니다. `flush_interval -1`은 SSE 이벤트를 버퍼링하지 않고 즉시 전달하기 위한 설정입니다. nginx를 쓴다면 SSE 경로에서 `proxy_buffering off`, 충분히 긴 `proxy_read_timeout`, HTTP/1.1 keep-alive를 설정해야 합니다.

## 5. 업데이트와 복구

```bash
cd /opt/bang-online
sudo -u banggame git pull --ff-only
npm run check
npm test
sudo systemctl restart bang-online
```

서버 재시작 시 진행 중 게임, token, 로그와 채팅은 사라집니다. 브라우저 새로고침과 짧은 네트워크 단절은 token으로 복구되지만 프로세스 재시작을 넘는 영속성은 제공하지 않습니다. 업데이트 전에 플레이어에게 게임 종료를 안내하세요.

## 자원·보안 메모

- 앱 포트 3000은 public firewall에 열지 않고 loopback reverse proxy로만 접근시킵니다.
- systemd 서비스는 전용 사용자, `NoNewPrivileges`, `PrivateTmp`, read-only system 보호를 사용합니다.
- POST 본문은 32 KiB, 채팅은 300자로 제한됩니다.
- 정적 카드 이미지는 `Cache-Control: public, max-age=31536000, immutable`로 한 번만 내려받습니다.
- SSE는 상태가 바뀔 때만 전송합니다. 첫 연결에는 복구용 전체 기록, 이후에는 최근 로그 delta만 보내며 25초 간격 주석 heartbeat를 사용합니다.
- 동시에 한 세션만 존재합니다. 새 방은 기존 게임이 끝난 뒤 만들 수 있습니다.
