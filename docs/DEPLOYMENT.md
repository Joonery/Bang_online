# Oracle Linux 9 · OCI 배포

이 문서는 기존 `Sesil_BoardGame`과 같은 OCI 인스턴스에서 BANG!을 함께 실행하는 구성을 기준으로 합니다.

```text
기존 세실 게임  Caddy :80  → Node.js :3000
BANG!          Caddy :8080 → Node.js :3001
```

BANG! 접속 주소는 `http://OCI_공인_IP:8080`입니다. 3001은 백엔드 포트이므로 OCI에서 공개하지 않습니다.

## 전제 조건

- Oracle Linux 9.8, aarch64
- Node.js 22 이상
- Caddy와 firewalld 설치 및 실행
- 저장소의 최신 변경 사항이 GitHub에 push되어 있음

확인:

```bash
node --version
caddy version
sudo systemctl is-active caddy firewalld
```

## 1. OCI에서 8080 열기

OCI Console에서 인스턴스가 사용하는 NSG 또는 Subnet Security List에 다음 Stateful Ingress Rule을 추가합니다.

```text
Source CIDR:      0.0.0.0/0
Protocol:         TCP
Destination port: 8080
```

3001은 추가하지 않습니다. OS의 8080 방화벽 규칙은 배포 스크립트가 설정하지만, OCI 콘솔의 네트워크 규칙은 서버 내부 스크립트로 변경할 수 없습니다.

## 2. 최초 배포

로컬 변경 사항을 먼저 commit하고 GitHub에 push합니다.

```powershell
cd D:\Python\Bang_online
git add .
git commit -m "Add automatic OCI deployment"
git push origin main
```

OCI 서버에서 저장소를 `/opt/bang-online`에 clone합니다. 공개 저장소 기준 명령입니다.

```bash
sudo git clone https://github.com/Joonery/Bang_online.git /opt/bang-online
cd /opt/bang-online
sudo bash deploy/deploy.sh
```

스크립트가 다음 작업을 순서대로 처리합니다.

1. Node.js 22와 필수 명령 확인
2. `banggame` 시스템 사용자 생성
3. 문법 검사와 전체 테스트
4. `bang-online.service` 설치 및 `127.0.0.1:3001`에서 시작
5. 기존 Caddyfile을 백업하고 8080 → 3001 블록만 추가
6. Caddy 설정 검사와 무중단 reload
7. SELinux reverse proxy 허용 및 firewalld 8080 개방
8. 내부 API 헬스체크

기존 `/etc/caddy/Caddyfile` 전체를 저장소 파일로 덮어쓰지 않습니다. 배포 직전 백업은 `/etc/caddy/Caddyfile.before-bang.YYYYMMDDHHMMSS` 형태로 남습니다.

## 3. 배포 확인

OCI 서버에서:

```bash
sudo systemctl status bang-online caddy --no-pager
curl --fail http://127.0.0.1:3001/api/health
sudo ss -lntp | grep -E ':(3000|3001|8080)\b'
```

다른 PC 또는 휴대전화에서:

```text
http://OCI_공인_IP:8080
http://OCI_공인_IP:8080/api/health
```

접속되지 않으면 다음을 확인합니다.

```bash
sudo firewall-cmd --list-ports
sudo journalctl -u bang-online -n 100 --no-pager
sudo journalctl -u caddy -n 100 --no-pager
```

`firewall-cmd`에 8080이 있어도 접속되지 않는다면 OCI NSG/Security List의 8080 인바운드 규칙이 빠졌을 가능성이 큽니다.

## 4. 이후 자동 업데이트 배포

게임이 진행 중이지 않을 때 실행합니다. 서비스가 재시작되면 메모리에 있는 게임·채팅·토큰이 사라집니다.

```bash
cd /opt/bang-online
sudo bash deploy/deploy.sh --pull
```

`--pull`은 작업 트리가 깨끗한지 확인한 뒤 `git pull --ff-only`를 실행하고, 테스트·서비스 재시작·Caddy 검증·헬스체크를 다시 수행합니다. 서버에서 파일을 직접 수정했다면 안전을 위해 자동 pull을 중단합니다.

이미 별도로 `git pull`을 했다면 옵션 없이 실행합니다.

```bash
sudo bash /opt/bang-online/deploy/deploy.sh
```

## 5. BANG!만 종료하거나 다시 시작하기

```bash
sudo systemctl stop bang-online
sudo systemctl start bang-online
sudo systemctl restart bang-online
```

부팅 시 자동 시작까지 해제하려면:

```bash
sudo systemctl disable --now bang-online
```

다시 활성화:

```bash
sudo systemctl enable --now bang-online
```

`killall node`, `pkill node`, `systemctl stop caddy`는 사용하지 마세요. 같은 서버에서 실행 중인 세실 게임까지 종료될 수 있습니다.

## 운영 메모

- 외부 8080은 HTTP입니다. 인터넷을 통한 실제 운영에서는 별도 도메인과 HTTPS 구성이 더 안전합니다.
- Caddy의 `flush_interval -1`은 SSE 실시간 이벤트 전달을 위해 유지합니다.
- 동시에 BANG! 세션 하나만 존재합니다.
- 배포·서버 재시작 시 현재 BANG! 게임 상태는 복구되지 않습니다.
