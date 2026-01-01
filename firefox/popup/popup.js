document.addEventListener('DOMContentLoaded', () => {
  loadGifs();
  
  const openFolderBtn = document.getElementById('openFolderBtn');
  if (openFolderBtn) {
    openFolderBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'openDownloadsFolder' });
    });
  }
});

function loadGifs() {
  chrome.runtime.sendMessage({ action: 'getDownloadedGifs' }, (response) => {
    const gifList = document.getElementById('gifList');
    
    if (!response || !response.gifs || response.gifs.length === 0) {
      gifList.innerHTML = `
        <div class="empty-state">
          <p>저장된 GIF가 없습니다</p>
          <p class="hint">웹페이지에서 GIF를 더블클릭하여 저장하세요</p>
        </div>
      `;
      return;
    }
    
    gifList.innerHTML = '';
    
    response.gifs.forEach(gif => {
      const gifItem = createGifItem(gif);
      gifList.appendChild(gifItem);
    });
  });
}

function createGifItem(gif) {
  const item = document.createElement('div');
  item.className = 'gif-item';
  
  // 상태 배지
  if (gif.status) {
    const statusBadge = document.createElement('div');
    statusBadge.className = `status-badge status-${gif.status}`;
    statusBadge.textContent = gif.status === 'downloading' ? '다운로드 중' : 
                              gif.status === 'complete' ? '완료' : '실패';
    item.appendChild(statusBadge);
  }
  
  // 썸네일 (실제 GIF 이미지)
  const thumbnail = document.createElement('img');
  thumbnail.src = gif.url;
  thumbnail.alt = gif.filename;
  thumbnail.style.cssText = `
    width: 100%;
    height: 120px;
    object-fit: cover;
    display: block;
  `;
  
  // 이미지 로드 실패 시 대체 아이콘 표시
  thumbnail.onerror = () => {
    const placeholder = document.createElement('div');
    placeholder.style.cssText = `
      width: 100%;
      height: 120px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 48px;
    `;
    placeholder.textContent = '🎬';
    thumbnail.replaceWith(placeholder);
  };
  
  item.appendChild(thumbnail);
  
  const info = document.createElement('div');
  info.className = 'info';
  
  const filename = document.createElement('span');
  filename.className = 'filename';
  filename.textContent = gif.filename;
  
  const buttonContainer = document.createElement('div');
  
  if (gif.downloadId && gif.status === 'complete') {
    const showBtn = document.createElement('button');
    showBtn.className = 'show-in-folder-btn';
    showBtn.textContent = '📁 위치';
    showBtn.onclick = (e) => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ 
        action: 'showInFolder', 
        downloadId: gif.downloadId 
      });
    };
    buttonContainer.appendChild(showBtn);
  }
  
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'delete-btn';
  deleteBtn.textContent = '삭제';
  deleteBtn.onclick = (e) => {
    e.stopPropagation();
    deleteGif(gif.id);
  };
  buttonContainer.appendChild(deleteBtn);
  
  info.appendChild(filename);
  info.appendChild(buttonContainer);
  
  item.appendChild(info);
  
  return item;
}

function deleteGif(id) {
  chrome.runtime.sendMessage({ action: 'clearGif', id: id }, () => {
    loadGifs();
  });
}

