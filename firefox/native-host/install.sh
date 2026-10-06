#!/bin/bash
# 짤톡 Native Messaging 도우미 설치 (macOS, Firefox/Zen)
#
#   ./install.sh            설치 (도우미 앱 빌드 → 브라우저 등록 → 다운로드 폴더 권한 요청)
#   ./install.sh uninstall  제거
#
# 소스를 받지 않고 한 줄로 설치 (도우미 소스는 GitHub에서 받아 이 Mac에서 빌드):
#   curl -fsSL https://raw.githubusercontent.com/kabkee/chrome-extension-jjal-tok/v1.2.6/firefox/native-host/install.sh | bash
#   (제거: 위 명령 끝에 `-s uninstall`)
# 받는 소스는 아래 RELEASE_TAG로 고정되고, SOURCE_SHA256과 일치할 때만 빌드한다.
# ※ JjalTokHelper.swift를 고치면 릴리스 전에 SOURCE_SHA256과 RELEASE_TAG를 함께 갱신할 것.
#
# 설치 위치
#   도우미 앱:     ~/Library/Application Support/JjalTok/JjalTok Helper.app
#   브라우저 등록: ~/Library/Application Support/Mozilla/NativeMessagingHosts/jjaltok_host.json
#   (Zen 등 Firefox 기반 브라우저는 모두 Mozilla 폴더의 등록 파일을 읽는다)
#
# 왜 앱으로 만드나: macOS는 ~/Downloads 접근 권한을 앱 단위로 준다. 브라우저가 실행한 도우미는
# 브라우저 권한을 물려받지 못하므로, 짤톡 전용 앱을 만들어 이 앱에만 '다운로드 폴더' 권한을 받는다.
set -euo pipefail

HOST_NAME="jjaltok_host"
EXTENSION_ID="jjaltok@kabkee.dev"
BUNDLE_ID="dev.kabkee.jjaltok.helper"
APP_NAME="JjalTok Helper"
RELEASE_TAG="v1.2.6"
SOURCE_SHA256="7e5aa4609fed741a03c436cd7b045590188bdf1d245d35f3b6b6bece9a54189f"
REPO_RAW="https://raw.githubusercontent.com/kabkee/chrome-extension-jjal-tok/$RELEASE_TAG/firefox/native-host"
# curl | bash 로 실행되면 $0이 "bash"라서 스크립트 폴더가 없다 → 그때는 소스를 GitHub에서 받는다
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || pwd)"
APP_DIR="$HOME/Library/Application Support/JjalTok"
APP_PATH="$APP_DIR/$APP_NAME.app"
EXEC_PATH="$APP_PATH/Contents/MacOS/JjalTokHelper"
MANIFEST_DIR="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"
MANIFEST_PATH="$MANIFEST_DIR/$HOST_NAME.json"
LOG_PATH="$HOME/Library/Logs/JjalTok/host.log"

if [[ "${1:-}" == "uninstall" ]]; then
  rm -f "$MANIFEST_PATH" "$APP_DIR/$HOST_NAME.py"
  rm -rf "$APP_PATH"
  rmdir "$APP_DIR" 2>/dev/null || true
  tccutil reset All "$BUNDLE_ID" >/dev/null 2>&1 || true
  echo "✅ 짤톡 도우미를 제거했습니다."
  exit 0
fi

if [[ "$(uname)" != "Darwin" ]]; then
  echo "❌ 이 설치 스크립트는 macOS 전용입니다." >&2
  exit 1
fi

# /usr/bin/swiftc는 Command Line Tools가 없어도 존재하는 껍데기라서 xcrun으로 실제 설치 여부를 확인한다
if ! xcrun --find swiftc >/dev/null 2>&1; then
  echo "❌ 도우미를 빌드하려면 Xcode Command Line Tools가 필요합니다."
  echo "   터미널에서 'xcode-select --install' 을 실행해 설치한 뒤, 이 명령을 다시 실행하세요." >&2
  exit 1
fi

# 1) 도우미 앱 빌드
BUILD_DIR="$(mktemp -d)"
trap 'rm -rf "$BUILD_DIR"' EXIT
SOURCE="$SCRIPT_DIR/JjalTokHelper.swift"
if [[ ! -f "$SOURCE" ]]; then
  echo "⬇️  도우미 소스 받는 중..."
  SOURCE="$BUILD_DIR/JjalTokHelper.swift"
  curl -fsSL "$REPO_RAW/JjalTokHelper.swift" -o "$SOURCE"
  # 받은 소스가 이 스크립트가 기대하는 것과 같은지 확인 (다르면 다운로드 폴더 권한을 받을 앱을 만들지 않는다)
  ACTUAL_SHA256="$(shasum -a 256 "$SOURCE" | cut -d' ' -f1)"
  if [[ "$ACTUAL_SHA256" != "$SOURCE_SHA256" ]]; then
    echo "❌ 받은 도우미 소스의 해시가 다릅니다. 설치를 중단합니다." >&2
    echo "   기대: $SOURCE_SHA256" >&2
    echo "   실제: $ACTUAL_SHA256" >&2
    exit 1
  fi
fi
echo "🔨 도우미 앱 빌드 중..."
swiftc -O -o "$BUILD_DIR/JjalTokHelper" "$SOURCE"

mkdir -p "$APP_DIR" "$MANIFEST_DIR"
rm -rf "$APP_PATH" "$APP_DIR/$HOST_NAME.py"   # 이전 버전(python 스크립트) 정리
mkdir -p "$APP_PATH/Contents/MacOS"
cp "$BUILD_DIR/JjalTokHelper" "$EXEC_PATH"

cat > "$APP_PATH/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleName</key><string>$APP_NAME</string>
  <key>CFBundleDisplayName</key><string>$APP_NAME</string>
  <key>CFBundleExecutable</key><string>JjalTokHelper</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>6</string>
  <key>CFBundleVersion</key><string>6</string>
  <key>LSUIElement</key><true/>
  <key>NSDownloadsFolderUsageDescription</key>
  <string>짤톡이 다운로드/jjal-tok 폴더의 GIF 목록을 확인하고, 짤톡에서 삭제한 파일을 지우기 위해 필요합니다.</string>
</dict>
</plist>
PLIST

# 권한을 이 앱에 고정하기 위해 (로컬) 서명
codesign --force --sign - --identifier "$BUNDLE_ID" "$APP_PATH" >/dev/null 2>&1

# 2) 브라우저에 등록
cat > "$MANIFEST_PATH" <<JSON
{
  "name": "$HOST_NAME",
  "description": "JjalTok helper: checks and removes GIFs in the jjal-tok download folder",
  "path": "$EXEC_PATH",
  "type": "stdio",
  "allowed_extensions": ["$EXTENSION_ID"]
}
JSON

# 3) 동작 확인 (ping)
RESPONSE="$(/usr/bin/python3 - "$EXEC_PATH" <<'PY'
import json, struct, subprocess, sys
msg = json.dumps({"action": "ping"}).encode()
out = subprocess.run([sys.argv[1]], input=struct.pack("@I", len(msg)) + msg,
                     capture_output=True, timeout=10).stdout
print(out[4:].decode())
PY
)"
if [[ "$RESPONSE" != *'"ok":true'* ]]; then
  echo "❌ 도우미 응답 확인에 실패했습니다: $RESPONSE" >&2
  exit 1
fi

# 4) 다운로드 폴더 권한 요청: 앱을 단독으로 실행해 macOS 권한 창을 띄운다.
echo "🔐 macOS가 'JjalTok Helper가 다운로드 폴더에 접근하려고 합니다' 창을 띄우면 [허용]을 눌러주세요."
BEFORE="$(grep -c 'request-access' "$LOG_PATH" 2>/dev/null || true)"
open -W "$APP_PATH" --args --request-access 2>/dev/null || true
# 앱이 너무 빨리 끝나면 open -W가 기다리지 못하므로, 결과가 로그에 남을 때까지 기다린다 (권한 창 응답 포함 최대 60초)
RESULT=""
for _ in $(seq 1 120); do
  if [[ "$(grep -c 'request-access' "$LOG_PATH" 2>/dev/null || true)" != "${BEFORE:-0}" ]]; then
    RESULT="$(grep 'request-access' "$LOG_PATH" | tail -1)"
    break
  fi
  sleep 0.5
done

echo "✅ 짤톡 도우미 설치 완료"
echo "   도우미 앱: $APP_PATH"
echo "   등록:      $MANIFEST_PATH"
if [[ "$RESULT" == *"-> ok"* ]]; then
  echo "   다운로드 폴더 권한: 허용됨 ✅"
else
  echo "   다운로드 폴더 권한: 아직 없음 ⚠️"
  echo "   시스템 설정 → 개인정보 보호 및 보안 → 파일 및 폴더 → 'JjalTok Helper' → 다운로드 폴더 를 켜거나,"
  echo "   '전체 디스크 접근 권한'에 위 도우미 앱을 추가하세요."
fi
echo "   브라우저 재시작은 필요 없습니다. (확장 기능이 요청할 때마다 도우미가 새로 실행됨)"
