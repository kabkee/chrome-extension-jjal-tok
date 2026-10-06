document.addEventListener('DOMContentLoaded', () => {
  loadGifs();

  // 설치된 버전 표시 (업데이트가 제대로 됐는지 확인용)
  const versionEl = document.getElementById('version');
  if (versionEl) versionEl.textContent = `v${chrome.runtime.getManifest().version}`;

  // 폴더 열기 버튼
  const openFolderBtn = document.getElementById('openFolderBtn');
  if (openFolderBtn) {
    openFolderBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'openDownloadsFolder' }, (response) => {
        // 브라우저 API로는 하위 폴더를 직접 못 열어서, 폴더 안 파일이 하나도 없으면 다운로드 폴더가 열린다
        if (response && response.opened === 'default') {
          showSyncPanel(`<p>아직 이 브라우저로 저장한 GIF가 없어서 다운로드 폴더를 열었어요. GIF를 저장하면 그 뒤로는 <code>${escapeHtml(response.folder)}</code> 폴더가 열려요.</p>`);
        }
      });
    });
  }

  // 동기화 버튼
  const syncBtn = document.getElementById('syncBtn');
  if (syncBtn) {
    syncBtn.addEventListener('click', () => syncWithFolder(syncBtn));
  }

  // 다운로드 완료 등으로 목록이 바뀌면 다시 그린다.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.downloadedGifs) {
      renderGifs(changes.downloadedGifs.newValue || []);
    }
  });

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
    renderGifs((response && response.gifs) || []);
  });
}

function renderGifs(gifs) {
  const gifList = document.getElementById('gifList');

  if (gifs.length === 0) {
    gifList.innerHTML = `
      <div class="empty-state">
        <p>저장된 GIF가 없습니다</p>
        <p class="hint">웹페이지에서 GIF를 더블클릭하여 저장하세요</p>
      </div>
    `;
    return;
  }

  gifList.innerHTML = '';

  gifs.forEach(gif => {
    const gifItem = createGifItem(gif);
    gifList.appendChild(gifItem);
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

  // 이미지 클릭 시 Finder에서 파일 위치 열기.
  // 다운로드 ID는 브라우저 재시작마다 바뀌므로 background가 파일 경로로 다시 찾아서 연다.
  // (다운로드 기록/파일이 없어졌으면 원본에서 다시 받아 위치를 연다)
  if (gif.status !== 'downloading') {
    item.style.cursor = 'pointer';
    item.addEventListener('click', (e) => {
      // 삭제 버튼 클릭이 아닌 경우에만
      if (!e.target.classList.contains('delete-btn')) {
        chrome.runtime.sendMessage({ action: 'revealGif', id: gif.id }, (response) => {
          if (response && response.redownloaded) {
            showSyncPanel('<p>파일을 찾을 수 없어 원본에서 다시 받았어요. 완료되면 위치가 열립니다.</p>');
          } else if (response && !response.success) {
            showSyncPanel(`<p>⚠️ 파일 위치를 열지 못했어요: ${escapeHtml(response.error || '')}</p>`);
          }
        });
      }
    });
  }

  return item;
}

function deleteGif(id) {
  chrome.runtime.sendMessage({ action: 'clearGif', id: id }, (response) => {
    if (response && !response.fileDeleted) {
      showSyncPanel('<p>목록에서는 지웠지만 실제 파일은 삭제하지 못했어요. (이전 브라우저 세션에 받은 파일은 도우미가 설치돼 있어야 삭제할 수 있어요)</p>');
    }
    loadGifs();
  });
}

// ---------- 동기화 ----------

function showSyncPanel(html) {
  const panel = document.getElementById('syncPanel');
  panel.innerHTML = html;
  panel.hidden = false;
  return panel;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function syncWithFolder(syncBtn) {
  syncBtn.disabled = true;
  showSyncPanel('<p>폴더와 목록을 비교하는 중...</p>');

  chrome.runtime.sendMessage({ action: 'syncWithFolder' }, (response) => {
    syncBtn.disabled = false;
    if (!response || !response.success) {
      showSyncPanel(`<p>⚠️ 동기화 실패: ${escapeHtml((response && response.error) || '')}</p>`);
      return;
    }

    const lines = [];
    if (response.removed > 0) {
      lines.push(`<p>🗑 폴더에서 사라진 파일 ${response.removed}개를 목록에서 뺐어요.</p>`);
    } else if (response.listCount === 0) {
      lines.push('<p>목록이 비어 있어요. 이 브라우저에서 GIF를 저장하면 여기에 쌓여요. (목록은 브라우저마다 따로 관리돼요)</p>');
    } else {
      lines.push('<p>✅ 목록의 파일이 모두 폴더에 있어요.</p>');
    }

    if (response.droppedUnknown > 0) {
      lines.push(`<p>🧹 원본 주소를 알 수 없는 항목 ${response.droppedUnknown}개를 파일과 함께 정리했어요.</p>`);
    }

    if (response.unverified > 0) {
      lines.push(`<p>❔ ${response.unverified}개는 이전 브라우저 세션에 받은 파일이라 확인하지 못했어요. 클릭하면 다시 받아 복구됩니다.</p>`);
    }

    if (response.nativeProblem === 'permission') {
      lines.push('<p class="sync-hint">⚠️ macOS가 도우미의 다운로드 폴더 접근을 막고 있어 폴더 확인·이전 파일 삭제를 못 했어요. <b>시스템 설정 → 개인정보 보호 및 보안 → 파일 및 폴더 → JjalTok Helper → 다운로드 폴더</b>를 켜거나 <code>native-host/install.sh</code>를 다시 실행해 권한 요청 창에서 [허용]을 누르세요.</p>');
    } else if (response.nativeProblem === 'missing') {
      lines.push('<p class="sync-hint">ℹ️ 이전 세션에 받은 파일까지 확인·삭제하고 Finder에서 지운 파일을 바로 반영하려면 <code>native-host/install.sh</code>로 도우미를 설치하세요.</p>');
    } else if (response.nativeProblem) {
      lines.push(`<p class="sync-hint">⚠️ 도우미 오류로 폴더를 확인하지 못했어요: ${escapeHtml(response.nativeProblem)}</p>`);
    }

    const orphans = response.orphans || [];
    if (orphans.length > 0) {
      lines.push(`<p>📂 목록에 없는 파일 ${orphans.length}개가 폴더에 있어요.</p>`);
      lines.push(`<ul>${orphans.map(o => `<li>${escapeHtml(o.filename)}</li>`).join('')}</ul>`);
      lines.push(`
        <div class="sync-actions">
          <button id="deleteOrphansBtn" class="danger">파일 삭제</button>
          <button id="adoptOrphansBtn">목록에 추가</button>
        </div>
      `);
    }

    const panel = showSyncPanel(lines.join(''));
    const filePaths = orphans.map(o => o.filePath);

    const resolve = (mode, doneText) => {
      panel.querySelectorAll('.sync-actions button').forEach(b => { b.disabled = true; });
      chrome.runtime.sendMessage({ action: 'resolveOrphans', mode, filePaths }, (result) => {
        showSyncPanel(result && result.success
          ? `<p>✅ ${result.count}개 ${doneText}</p>`
          : `<p>⚠️ 처리 실패: ${escapeHtml((result && result.error) || '')}</p>`);
      });
    };

    const deleteBtn = panel.querySelector('#deleteOrphansBtn');
    const adoptBtn = panel.querySelector('#adoptOrphansBtn');
    if (deleteBtn) deleteBtn.addEventListener('click', () => resolve('delete', '파일을 삭제했어요.'));
    if (adoptBtn) adoptBtn.addEventListener('click', () => resolve('adopt', '목록에 추가했어요. (최대 20개까지, 원본 주소를 알 수 없는 파일은 제외)'));
  });
}
