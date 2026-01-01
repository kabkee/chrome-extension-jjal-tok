let draggedImageUrl = null;

document.addEventListener('contextmenu', (e) => {
  if (e.target.tagName === 'IMG') {
    const imgUrl = e.target.src;
    if (isGifUrl(imgUrl)) {
      draggedImageUrl = imgUrl;
    }
  }
}, true);

document.addEventListener('dragstart', (e) => {
  if (e.target.tagName === 'IMG') {
    const imgUrl = e.target.src;
    if (isGifUrl(imgUrl)) {
      draggedImageUrl = imgUrl;
      
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
          chrome.runtime.sendMessage({
            action: 'downloadGif',
            url: imgUrl
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
    const imgUrl = e.target.src;
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
            if (response && response.success) {
              showNotification('GIF가 짤톡에 저장되었습니다!');
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
