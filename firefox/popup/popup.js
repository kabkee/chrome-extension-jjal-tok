document.addEventListener('DOMContentLoaded', () => {
  loadGifs();

  // 폴더 열기 버튼
  const openFolderBtn = document.getElementById('openFolderBtn');
  if (openFolderBtn) {
    openFolderBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'openDownloadsFolder' });
    });
  }

  // 사용법 버튼
  const helpBtn = document.getElementById('helpBtn');
  const helpModal = document.getElementById('helpModal');
  const closeModal = document.getElementById('closeModal');

  if (helpBtn && helpModal) {
    helpBtn.addEventListener('click', () => {
      helpModal.classList.add('show');
    });
  }

  if (closeModal && helpModal) {
    closeModal.addEventListener('click', () => {
      helpModal.classList.remove('show');
    });

    // 모달 배경 클릭 시 닫기
    helpModal.addEventListener('click', (e) => {
      if (e.target === helpModal) {
        helpModal.classList.remove('show');
      }
    });
  }
});

function loadGifs() {
  const gifList = document.getElementById('gifList');

  // 로딩 중 표시
  gifList.innerHTML = '<div class="empty-state"><p>로딩 중...</p></div>';

  chrome.runtime.sendMessage({ action: 'getDownloadedGifs' }, (response) => {
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

  // 이미지 로드 실패 시 대체 아이콘 표시
  thumbnail.onerror = () => {
    const placeholder = document.createElement('div');
    placeholder.style.cssText = `
      width: 100%;
      height: 100%;
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

  // 삭제 버튼
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

  // 이미지 클릭 시 폴더 열기
  if (gif.downloadId && gif.status === 'complete') {
    item.style.cursor = 'pointer';
    item.addEventListener('click', (e) => {
      // 삭제 버튼 클릭이 아닌 경우에만
      if (!e.target.classList.contains('delete-btn')) {
        chrome.runtime.sendMessage({
          action: 'showInFolder',
          downloadId: gif.downloadId
        });
      }
    });
  }

  return item;
}

function deleteGif(id) {
  chrome.runtime.sendMessage({ action: 'clearGif', id: id }, () => {
    loadGifs();
  });
}
