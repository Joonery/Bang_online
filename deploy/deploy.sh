#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/opt/bang-online"
SERVICE_NAME="bang-online"
SERVICE_USER="banggame"
BACKEND_PORT="3001"
PUBLIC_PORT="8080"
CADDYFILE="/etc/caddy/Caddyfile"
MARKER_BEGIN="# BEGIN bang-online (managed by deploy/deploy.sh)"
MARKER_END="# END bang-online (managed by deploy/deploy.sh)"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
PULL_SOURCE=false

log() { printf '[bang-online] %s\n' "$*"; }
fail() { printf '[bang-online] ERROR: %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: sudo bash deploy/deploy.sh [--pull]

  --pull  배포 전에 현재 브랜치를 git pull --ff-only로 업데이트합니다.

The repository must be located at /opt/bang-online.
EOF
}

for argument in "$@"; do
  case "${argument}" in
    --pull) PULL_SOURCE=true ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; fail "알 수 없는 옵션입니다: ${argument}" ;;
  esac
done

[[ "${EUID}" -eq 0 ]] || fail "root 권한이 필요합니다: sudo bash deploy/deploy.sh"
[[ "${SOURCE_DIR}" == "${APP_DIR}" ]] || fail "저장소를 ${APP_DIR}에 clone한 뒤 그 위치에서 실행하세요. 현재 위치: ${SOURCE_DIR}"

for command_name in node npm caddy systemctl curl awk grep install runuser ss sed; do
  command -v "${command_name}" >/dev/null 2>&1 || fail "필수 명령을 찾을 수 없습니다: ${command_name}"
done

NODE_MAJOR="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
[[ "${NODE_MAJOR}" =~ ^[0-9]+$ ]] || fail "Node.js 버전을 확인할 수 없습니다."
(( NODE_MAJOR >= 22 )) || fail "Node.js 22 이상이 필요합니다. 현재 버전: $(node --version)"

if ! id "${SERVICE_USER}" >/dev/null 2>&1; then
  log "전용 사용자 ${SERVICE_USER} 생성"
  useradd --system --home-dir "${APP_DIR}" --shell /sbin/nologin "${SERVICE_USER}"
fi

chown -R "${SERVICE_USER}:${SERVICE_USER}" "${APP_DIR}"

if [[ "${PULL_SOURCE}" == true ]]; then
  command -v git >/dev/null 2>&1 || fail "--pull에는 git이 필요합니다."
  [[ -z "$(runuser -u "${SERVICE_USER}" -- git -C "${APP_DIR}" status --porcelain)" ]] || fail "작업 트리에 변경 사항이 있어 pull하지 않았습니다."
  log "원격 저장소에서 fast-forward 업데이트"
  runuser -u "${SERVICE_USER}" -- git -C "${APP_DIR}" pull --ff-only
fi

if ! systemctl is-active --quiet "${SERVICE_NAME}" && ss -H -ltn | awk -v port=":${BACKEND_PORT}" '$4 ~ port "$" { found=1 } END { exit !found }'; then
  fail "내부 포트 ${BACKEND_PORT}을 다른 프로세스가 사용 중입니다."
fi

log "문법 검사와 테스트 실행"
(
  cd "${APP_DIR}"
  runuser -u "${SERVICE_USER}" -- npm run check
)

log "systemd 서비스 설치"
install -o root -g root -m 0644 "${APP_DIR}/deploy/bang-online.service" "/etc/systemd/system/${SERVICE_NAME}.service"
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}" >/dev/null
systemctl restart "${SERVICE_NAME}"

health_ok=false
for _ in {1..20}; do
  if curl --fail --silent --show-error "http://127.0.0.1:${BACKEND_PORT}/api/health" >/dev/null; then
    health_ok=true
    break
  fi
  sleep 0.5
done
if [[ "${health_ok}" != true ]]; then
  journalctl -u "${SERVICE_NAME}" -n 50 --no-pager >&2 || true
  fail "내부 헬스체크에 실패했습니다."
fi

log "기존 Caddy 설정을 보존하면서 ${PUBLIC_PORT} 포트 프록시 구성"
install -d -o root -g root -m 0755 /etc/caddy
[[ -f "${CADDYFILE}" ]] || install -o root -g root -m 0644 /dev/null "${CADDYFILE}"
CADDY_BACKUP="${CADDYFILE}.before-bang.$(date +%Y%m%d%H%M%S)"
cp -a "${CADDYFILE}" "${CADDY_BACKUP}"
CADDY_STAGED="$(mktemp /etc/caddy/Caddyfile.bang.XXXXXX)"
trap 'rm -f "${CADDY_STAGED:-}"' EXIT

awk -v begin="${MARKER_BEGIN}" -v end="${MARKER_END}" '
  $0 == begin { managed=1; next }
  $0 == end { managed=0; next }
  !managed { print }
' "${CADDYFILE}" > "${CADDY_STAGED}"

if grep -Eq "(^|[[:space:]])(http://)?:${PUBLIC_PORT}[[:space:]]*\\{" "${CADDY_STAGED}"; then
  if grep -Fq "reverse_proxy 127.0.0.1:${BACKEND_PORT}" "${CADDY_STAGED}"; then
    log "기존 Caddy ${PUBLIC_PORT} → ${BACKEND_PORT} 설정을 그대로 사용"
  else
    fail "Caddy에서 ${PUBLIC_PORT} 포트를 이미 다른 용도로 사용 중입니다. ${CADDYFILE}을 확인하세요. 백업: ${CADDY_BACKUP}"
  fi
else
  cat >> "${CADDY_STAGED}" <<EOF

${MARKER_BEGIN}
http://:${PUBLIC_PORT} {
    encode zstd gzip

    reverse_proxy 127.0.0.1:${BACKEND_PORT} {
        flush_interval -1
    }
}
${MARKER_END}
EOF
fi

caddy fmt --overwrite "${CADDY_STAGED}" >/dev/null
caddy validate --config "${CADDY_STAGED}" --adapter caddyfile
install -o root -g caddy -m 0644 "${CADDY_STAGED}" "${CADDYFILE}"

if command -v getenforce >/dev/null 2>&1 && [[ "$(getenforce)" == "Enforcing" ]]; then
  command -v setsebool >/dev/null 2>&1 || fail "SELinux 설정 도구 setsebool을 찾을 수 없습니다."
  setsebool -P httpd_can_network_connect 1
fi

if ! systemctl reload caddy; then
  cp -a "${CADDY_BACKUP}" "${CADDYFILE}"
  systemctl reload caddy || true
  fail "Caddy reload에 실패하여 기존 설정을 복구했습니다."
fi

if systemctl is-active --quiet firewalld && command -v firewall-cmd >/dev/null 2>&1; then
  log "firewalld에서 외부 ${PUBLIC_PORT}/tcp 허용"
  firewall-cmd --permanent --add-port="${PUBLIC_PORT}/tcp" >/dev/null
  if firewall-cmd --permanent --query-port="${BACKEND_PORT}/tcp" >/dev/null; then
    firewall-cmd --permanent --remove-port="${BACKEND_PORT}/tcp" >/dev/null
  fi
  firewall-cmd --reload >/dev/null
fi

log "배포 완료"
log "내부 상태: http://127.0.0.1:${BACKEND_PORT}/api/health"
log "외부 주소: http://<OCI_PUBLIC_IP>:${PUBLIC_PORT}"
log "OCI NSG 또는 Security List에서도 TCP ${PUBLIC_PORT} 인바운드를 허용해야 합니다."
