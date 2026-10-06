let draggedImageUrl = null;

// storage_jjal의 그리드는 썸네일(항상 .webp)을 <img src>로 표시하므로,
// src만 보면 GIF 원본을 더 이상 찾을 수 없다. 카드 컨테이너에 심어둔
// data-file 속성(원본 경로)이 있으면 그걸 우선 쓰고, 없는 사이트는
// 기존처럼 src를 그대로 쓴다.
function resolveImageUrl(imgEl) {
  const container = imgEl.closest('[data-file]');
  if (container) {
    return new URL(container.dataset.file, location.href).href;
  }
  return imgEl.src;
}

document.addEventListener('contextmenu', (e) => {
  if (e.target.tagName === 'IMG') {
    const imgUrl = resolveImageUrl(e.target);
    if (isGifUrl(imgUrl)) {
      draggedImageUrl = imgUrl;

      // 브라우저 컨텍스트 메뉴는 클릭 시점의 <img src>(=썸네일)를
      // info.srcUrl로 넘기므로, 우클릭한 시점에 우리가 계산한 원본
      // GIF URL을 백그라운드에 미리 알려준다. 컨텍스트 메뉴의
      // '짤톡에 저장' 클릭 핸들러가 이 값을 info.srcUrl보다 우선 사용한다.
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
          chrome.runtime.sendMessage({
            action: 'setContextImageUrl',
            url: imgUrl
          });
        }
      } catch (error) {
        console.error('컨텍스트 메뉴 URL 전달 오류:', error);
      }
    }
  }
}, true);

document.addEventListener('dragstart', (e) => {
  if (e.target.tagName === 'IMG') {
    const imgUrl = resolveImageUrl(e.target);
    if (isGifUrl(imgUrl)) {
      draggedImageUrl = imgUrl;

      try {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
          // 드래그 중에 Finder가 튀어나오면 드래그가 끊기므로 위치 열기는 하지 않는다.
          chrome.runtime.sendMessage({
            action: 'downloadGif',
            url: imgUrl,
            reveal: false
          });
        }
      } catch (error) {
        console.error('드래그 시 확장 프로그램 컨텍스트 오류:', error);
      }
    }
  }
});

document.addEventListener('dblclick', (e) => {
  console.log('더블클릭 이벤트 발생:', e.target.tagName);
  if (e.target.tagName === 'IMG') {
    const imgUrl = resolveImageUrl(e.target);
    console.log('이미지 URL:', imgUrl);
    console.log('GIF 여부:', isGifUrl(imgUrl));
    if (isGifUrl(imgUrl)) {
      console.log('GIF 다운로드 요청 전송');
      
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
          chrome.runtime.sendMessage({
            action: 'downloadGif',
            url: imgUrl
          }, (response) => {
            if (chrome.runtime.lastError) {
              console.error('메시지 전송 실패:', chrome.runtime.lastError.message);
              showNotification('⚠️ 확장 프로그램을 재로드한 경우 페이지를 새로고침하세요!');
              return;
            }
            console.log('백그라운드 응답:', response);
            if (response && response.inProgress) {
              showNotification('저장 중인 GIF입니다. 잠시만요!');
            } else if (response && response.duplicate) {
              showNotification('이미 저장된 GIF예요. 파일 위치를 엽니다!');
            } else if (response && response.success) {
              showNotification('GIF가 짤톡에 저장되었습니다!');
            } else if (response) {
              showNotification('⚠️ GIF 저장에 실패했습니다.');
            }
          });
        } else {
          console.error('Chrome 확장 API를 사용할 수 없습니다.');
          showNotification('⚠️ 페이지를 새로고침하세요!');
        }
      } catch (error) {
        console.error('확장 프로그램 컨텍스트 오류:', error);
        showNotification('⚠️ 페이지를 새로고침하세요!');
      }
    }
  }
});

function isGifUrl(url) {
  return url && (url.toLowerCase().endsWith('.gif') || url.includes('.gif?'));
}

function showNotification(message) {
  const notification = document.createElement('div');
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #4CAF50;
    color: white;
    padding: 15px 20px;
    border-radius: 8px;
    box-shadow: 0 4px 6px rgba(0,0,0,0.2);
    z-index: 999999;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 14px;
    animation: slideIn 0.3s ease-out;
  `;
  
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease-out';
    setTimeout(() => notification.remove(), 300);
  }, 2000);
}

const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from { transform: translateX(400px); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  @keyframes slideOut {
    from { transform: translateX(0); opacity: 1; }
    to { transform: translateX(400px); opacity: 0; }
  }
`;
document.head.appendChild(style);
