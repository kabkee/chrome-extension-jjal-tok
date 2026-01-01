# 짤톡 (JjalTok) - GIF 다운로더 for KakaoTalk

GIF 이미지를 다운로드 폴더에 자동 저장하여 카카오톡으로 빠르게 전송하는 Chrome 확장 프로그램

## 주요 기능

- �️ **더블클릭으로 GIF 다운로드**: 웹페이지에서 GIF를 더블클릭하면 자동으로 다운로드 폴더에 저장
- � **우클릭 메뉴**: 이미지 우클릭 → "짤톡에 저장"
- 💾 **최대 20개 GIF 관리**: 다운로드 이력 자동 관리
- � **다운로드 폴더 바로 열기**: 팝업에서 버튼 클릭으로 폴더 즉시 접근
- � **실제 GIF 파일 저장**: 애니메이션이 살아있는 원본 .gif 파일로 저장
- 📍 **파일 위치 표시**: 다운로드 완료된 파일의 위치를 탐색기에서 바로 확인

## 설치 방법

1. 이 저장소를 클론하거나 다운로드
2. Chrome 또는 Chromium 기반 브라우저(Zen, Edge 등)에서 `chrome://extensions/` 열기
3. 오른쪽 상단의 "개발자 모드" 활성화
4. "압축해제된 확장 프로그램을 불러오기" 클릭
5. 이 폴더 선택

## 사용 방법

### 1. GIF 저장
- 웹페이지에서 GIF 이미지를 **더블클릭**
- 또는 GIF 이미지 **우클릭** → "짤톡에 저장"
- GIF가 자동으로 `다운로드/jjal-tok/` 폴더에 저장됩니다

### 2. 다운로드 폴더 열기
- 브라우저 툴바의 짤톡 아이콘 클릭
- 팝업에서 **"📁 다운로드 폴더 열기"** 버튼 클릭
- 또는 완료된 GIF 항목의 **"📁 위치"** 버튼 클릭

### 3. 카카오톡으로 전송
- 탐색기/Finder에서 저장된 GIF 파일 확인
- 파일을 카카오톡 채팅창으로 **드래그 앤 드롭**
- 애니메이션이 살아있는 GIF로 전송됩니다! 🎉

## 왜 파일 시스템 방식인가요?

브라우저의 보안 제한으로 인해 드래그 앤 드롭으로 직접 파일을 전달하면 PNG로 변환되는 문제가 있습니다. 
실제 파일 시스템에 .gif 파일로 저장하면 카카오톡에서 애니메이션이 유지됩니다.

## 기술 스택

- Chrome Extension Manifest V3
- Vanilla JavaScript
- Chrome Downloads API
- Chrome Storage API
- Chrome Context Menus API
- Chrome Notifications API

## 프로젝트 구조

```
jjal-tok/
├── manifest.json          # Chrome 확장 설정 파일
├── src/
│   ├── background.js      # 백그라운드 스크립트 (다운로드 관리)
│   └── content.js         # 콘텐츠 스크립트 (이미지 감지)
├── popup/
│   ├── popup.html         # 팝업 UI
│   ├── popup.css          # 팝업 스타일
│   └── popup.js           # 팝업 로직
├── icons/                 # 확장 아이콘
└── README.md
```

## 기술 스택

- Chrome Extension Manifest V3
- Vanilla JavaScript
- Chrome Storage API
- Chrome Downloads API
- Drag and Drop API

## 개발 계획

- [ ] 아이콘 디자인 추가
- [ ] 저장 용량 제한 설정 기능
- [ ] GIF 검색 기능
- [ ] 태그 및 카테고리 분류
- [ ] 클립보드 복사 기능
- [ ] 단축키 지원

## 주의사항

- 카카오톡 PC 앱에서 드래그 앤 드롭이 작동하지 않을 수 있습니다
- 이 경우 GIF를 클릭하여 다운로드 후 수동으로 전송하세요
- 최대 20개의 GIF만 저장되며, 오래된 항목부터 자동 삭제됩니다

## 라이선스

MIT License

## 개발자

kabkee
