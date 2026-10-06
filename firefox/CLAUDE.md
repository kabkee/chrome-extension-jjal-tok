# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

**짤톡 (JjalTok)** - Firefox/Zen 브라우저용 GIF 다운로더 확장 프로그램

GIF 이미지를 더블클릭하여 `다운로드/jjal-tok/` 폴더에 자동 저장하고, 카카오톡으로 빠르게 전송할 수 있게 해주는 브라우저 확장 프로그램입니다.

## 개발 환경 설정

### 확장 프로그램 설치 및 테스트

```bash
# 1. Firefox/Zen 브라우저에서 about:debugging 열기
# 2. "This Firefox" (이 Firefox) 클릭
# 3. "Load Temporary Add-on" (임시 애드온 로드) 클릭
# 4. manifest.json 파일 선택
```

### 개발 시 주의사항

- **빌드 프로세스 없음**: 이 프로젝트는 Vanilla JavaScript로 작성되어 별도의 빌드 도구가 필요하지 않습니다
- **확장 프로그램 재로드**: 코드 변경 후 `about:debugging`에서 "Reload" 버튼 클릭
- **페이지 새로고침**: content.js 변경 시 테스트 중인 웹페이지도 새로고침 필요
- **디버깅**:
  - background.js: about:debugging → Inspect 클릭
  - popup: 팝업 우클릭 → Inspect
  - content.js: 웹페이지 개발자 도구

## 코드 아키텍처

### 3-Layer 구조

```
┌─────────────────────────────────────────────────────┐
│  popup/ (UI Layer)                                  │
│  - 저장된 GIF 목록 표시                             │
│  - 다운로드 폴더 열기                               │
│  - GIF 삭제 관리                                    │
└─────────────────────────────────────────────────────┘
                        ↕ (chrome.runtime.sendMessage)
┌─────────────────────────────────────────────────────┐
│  src/background.js (Service Worker / Controller)   │
│  - Chrome Downloads API로 실제 파일 다운로드        │
│  - Storage API로 다운로드 이력 관리 (최대 20개)    │
│  - Context Menus 관리 ("짤톡에 저장")              │
│  - Notifications 발송                               │
└─────────────────────────────────────────────────────┘
                        ↕ (chrome.runtime.sendMessage)
┌─────────────────────────────────────────────────────┐
│  src/content.js (Web Page Integration)              │
│  - GIF 이미지 더블클릭 감지                         │
│  - 드래그 시작 감지                                 │
│  - 우클릭 메뉴 (context menu) 감지                 │
│  - 페이지 내 알림 표시                              │
└─────────────────────────────────────────────────────┘
```

### 주요 데이터 흐름

1. **GIF 다운로드 플로우**:
   - content.js: 사용자 이벤트 감지 (더블클릭/우클릭) → `downloadGif` 메시지 전송
   - background.js: 메시지 수신 → `chrome.downloads.download()` 호출
   - background.js: 다운로드 ID 생성 → Storage에 GIF 정보 저장
   - background.js: `chrome.downloads.onChanged` 리스너로 상태 업데이트 (downloading → complete/failed)

2. **Storage 구조** (`storage.local`이 유일한 원본 — background는 메모리 캐시를 두지 않음):
   ```javascript
   downloadedGifs = [
     {
       id: "1760000000000-ab12cd",   // 목록 고유 ID (다운로드 ID와 무관)
       url: "https://...",            // 원본 GIF URL (중복 판단 기준)
       filename: "example.gif",       // 표시용 파일명
       filePath: "/Users/.../Downloads/jjal-tok/example.gif", // 다운로드 기록을 다시 찾는 기준
       downloadId: 123,               // 이번 세션의 다운로드 ID (재시작 시 reconcile로 갱신)
       status: "complete",            // downloading/complete/failed
       timestamp: "2026-..."
     }
   ]
   ```

3. **최대 20개 제한**: 새 항목은 맨 앞에 추가, 20개 초과분은 목록에서 빠지면서 실제 파일도 삭제(`onGifsEvicted`).
   '동기화 → 목록에 추가'는 빈 자리만큼만 추가한다 (넘치면 방금 추가한 파일이 지워지므로)

4. **중복/동기화/삭제**:
   - 같은 URL 재다운로드 요청 → 파일이 있으면 새로 받지 않고 맨 위로 올린 뒤 `downloads.show()`
   - 다운로드 완료 시 자동으로 Finder에서 파일 위치 열기 (드래그 저장은 제외)
   - 삭제 → `downloads.removeFile()` + `downloads.erase()` (실제 파일 삭제)
   - 동기화 → `downloads.search({ filenameRegex: jjal-tok })`의 `exists`로 목록과 비교

### ⚠️ Firefox 확장용 downloads API는 "이번 세션"만 본다

- 데스크톱 Firefox는 완료된 다운로드를 재시작 후 API 목록에 올리지 않는다 (`DownloadIntegration.shouldPersistDownload`).
  브라우저 '기록'(places)에는 남지만 확장 API로는 조회할 수 없다. 다운로드 ID도 세션마다 새로 매겨진다 (Bug 1247794).
- 그래서 저장된 `downloadId`는 믿지 않고, 항상 `locateFile(gif)`로 파일 상태를 구한다.
  - 이번 세션 파일 → `downloads.search({ filename })`로 찾고 `show()`/`removeFile()`
  - 이전 세션 파일 → `filePath`(옛 항목은 폴더+파일명 추정)로 도우미에게 `exists`/`reveal`/`delete`
- `item.exists`도 Finder 삭제를 바로 반영하지 않으므로 도우미가 있으면 `refreshExists()`로 덮어쓴다.
- 도우미(`native-host/`, `./install.sh`, 선택 설치)는 jjal-tok 폴더 바로 아래 파일만 다룬다 (exists/list/delete/reveal/openFolder). xpi에는 포함되지 않는다.
  - Swift로 만든 `JjalTok Helper.app`이다 (`JjalTokHelper.swift`를 install.sh가 빌드·로컬 서명).
    macOS(TCC)는 브라우저가 실행한 도우미에 브라우저 권한을 물려주지 않아서, 스크립트로 만들면 python3 자체에
    다운로드 폴더 권한을 줘야 한다. 그래서 전용 앱으로 만들어 그 앱에만 '다운로드 폴더' 권한을 받는다.
  - 로그: `~/Library/Logs/JjalTok/host.log` (권한 오류는 `PERMISSION`으로 남음)
  도우미가 없으면 이전 세션 항목은 '확인 불가'가 되고, 클릭 시 같은 이름으로 다시 받아(overwrite) 복구한다.

### Chrome Extension API 사용

- `chrome.downloads`: 파일 다운로드, 폴더 열기, 파일 위치 표시
- `chrome.storage.local`: 다운로드 이력 영구 저장
- `chrome.contextMenus`: 우클릭 메뉴 ("짤톡에 저장")
- `chrome.notifications`: 다운로드 시작 알림
- `chrome.runtime.sendMessage`: 레이어 간 통신

### Firefox vs Chrome 차이점

- 두 브라우저 모두 `downloads.removeFile()`을 지원한다 (실제 파일 삭제).
- `chrome/`와 `firefox/`의 `src/*.js`, `popup/popup.js`는 동일한 코드 (`globalThis.browser ?? chrome`).

## 파일별 역할

- `manifest.json`: 확장 프로그램 설정 (permissions, background, content_scripts, browser_specific_settings)
- `src/background.js`: 다운로드 관리자 역할 (Service Worker)
- `src/content.js`: 웹페이지에 주입되어 사용자 이벤트 감지
- `popup/popup.html`: 확장 프로그램 팝업 UI
- `popup/popup.js`: 팝업 로직 (GIF 목록 렌더링, 삭제, 폴더 열기)
- `popup/popup.css`: 팝업 스타일
- `icons/`: 확장 프로그램 아이콘 (16x16, 48x48, 128x128)

## 개발 시 고려사항

### GIF 감지 로직
```javascript
// content.js에서 GIF URL 감지
function isGifUrl(url) {
  return url && (url.toLowerCase().endsWith('.gif') || url.includes('.gif?'));
}
```
- `.gif?` 패턴도 지원 (쿼리 파라미터가 있는 GIF URL)

### 확장 프로그램 재로드 후 에러 처리
- content.js가 주입된 페이지에서 확장 프로그램을 재로드하면 `chrome.runtime.id`가 무효화됨
- 에러 캐치 후 사용자에게 "페이지를 새로고침하세요" 안내

### 다운로드 폴더 구조
- 모든 GIF는 `다운로드/jjal-tok/` 서브폴더에 저장
- 파일명 충돌 시 `conflictAction: 'uniquify'`로 자동 번호 추가

## 배포 (GitHub Release)

- `npm run build` / `npm run lint` (firefox/에서): 개발용 파일·native-host 제외하고 xpi 빌드
- `npm run sign`: Mozilla **비공개(unlisted)** 서명 — 스토어에 등록·노출되지 않고 서명된 xpi만 받는다.
  `WEB_EXT_API_KEY`(JWT issuer) / `WEB_EXT_API_SECRET`(JWT secret) 환경 변수 필요 (AMO 개발자 API 키).
  같은 버전은 두 번 서명할 수 없으므로 manifest version을 먼저 올린다.
- 서명 결과(`web-ext-artifacts/<해시>-<버전>.xpi`)를 `jjaltok-<버전>.xpi`로 이름 바꿔 커밋하고 릴리스에 첨부
- Chrome은 `chrome/` 폴더를 zip으로 첨부 (개발자 모드 "압축해제된 확장 프로그램 로드"로 설치)
- macOS 도우미는 미리 빌드해 배포하지 않는다 (공증 없는 앱은 Gatekeeper가 막음) → 소스의 `install.sh`로 각자 빌드

## 기술 스택

- Manifest V3 (Firefox/Zen Browser)
- Vanilla JavaScript (ES6+)
- Chrome Extension APIs (Downloads, Storage, Context Menus, Notifications)
- No build tools, no dependencies
