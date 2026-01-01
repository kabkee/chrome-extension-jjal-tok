let downloadedGifs = [];

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'saveGifToJjalTok',
    title: '짤톡에 저장',
    contexts: ['image']
  });
});

chrome.downloads.onChanged.addListener((delta) => {
  if (delta.state && delta.state.current === 'complete') {
    const gif = downloadedGifs.find(g => g.downloadId === delta.id);
    if (gif) {
      gif.status = 'complete';
      chrome.storage.local.set({ downloadedGifs: downloadedGifs });
      console.log('다운로드 완료:', gif.filename);
    }
  } else if (delta.state && delta.state.current === 'interrupted') {
    const gif = downloadedGifs.find(g => g.downloadId === delta.id);
    if (gif) {
      gif.status = 'failed';
      chrome.storage.local.set({ downloadedGifs: downloadedGifs });
      console.error('다운로드 실패:', gif.filename);
    }
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'saveGifToJjalTok') {
    const imageUrl = info.srcUrl;
    downloadGif(imageUrl);
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'downloadGif') {
    downloadGif(request.url);
    sendResponse({ success: true });
  } else if (request.action === 'getDownloadedGifs') {
    sendResponse({ gifs: downloadedGifs });
  } else if (request.action === 'clearGif') {
    const gif = downloadedGifs.find(g => g.id === request.id);
    
    if (gif && gif.downloadId) {
      // Chrome: 실제 파일 삭제 지원
      if (chrome.downloads.removeFile) {
        chrome.downloads.removeFile(gif.downloadId, () => {
          if (chrome.runtime.lastError) {
            console.error('파일 삭제 실패:', chrome.runtime.lastError.message);
          } else {
            console.log('파일 삭제 완료:', gif.filename);
          }
          
          // 다운로드 이력에서도 제거
          eraseDownloadHistory(gif.downloadId);
        });
      } else {
        // Firefox/Zen: 실제 파일 삭제 미지원 -> 이력만 삭제
        console.log('이 브라우저는 파일 삭제를 지원하지 않습니다. 목록에서만 제거합니다.');
        eraseDownloadHistory(gif.downloadId);
      }
    }
    
    // 목록에서 제거
    downloadedGifs = downloadedGifs.filter(g => g.id !== request.id);
    chrome.storage.local.set({ downloadedGifs: downloadedGifs }, () => {
      console.log('GIF 목록에서 제거 완료:', request.id);
      sendResponse({ success: true });
    });
    return true;
  } else if (request.action === 'openDownloadsFolder') {
    chrome.downloads.showDefaultFolder();
    sendResponse({ success: true });
  } else if (request.action === 'showInFolder') {
    if (request.downloadId) {
      chrome.downloads.show(request.downloadId);
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: 'downloadId required' });
    }
  }
  return true;
});

function eraseDownloadHistory(downloadId) {
  chrome.downloads.erase({ id: downloadId }, () => {
    if (chrome.runtime.lastError) {
      console.error('다운로드 이력 삭제 실패:', chrome.runtime.lastError.message);
    }
  });
}

async function downloadGif(url) {
  try {
    const filename = extractFilename(url);
    
    // Chrome downloads API로 실제 파일 다운로드
    chrome.downloads.download({
      url: url,
      filename: `jjal-tok/${filename}`,
      saveAs: false,
      conflictAction: 'uniquify'
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('다운로드 실패:', chrome.runtime.lastError);
        return;
      }
      
      console.log('GIF 다운로드 시작:', downloadId, filename);
      
      const gifData = {
        id: downloadId,
        url: url,
        filename: filename,
        timestamp: new Date().toISOString(),
        downloadId: downloadId,
        status: 'downloading'
      };
      
      downloadedGifs.unshift(gifData);
      
      if (downloadedGifs.length > 20) {
        downloadedGifs = downloadedGifs.slice(0, 20);
      }
      
      chrome.storage.local.set({ downloadedGifs: downloadedGifs });
      
      try {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon48.png',
          title: '짤톡',
          message: `${filename} 다운로드 중... 다운로드 폴더에서 확인하세요!`
        });
      } catch (notifError) {
        console.log('알림 생성 실패:', notifError);
      }
    });
  } catch (error) {
    console.error('GIF 다운로드 실패:', error);
  }
}

function extractFilename(url) {
  const urlObj = new URL(url);
  const pathname = urlObj.pathname;
  const filename = pathname.split('/').pop();
  return filename || `gif_${Date.now()}.gif`;
}

chrome.storage.local.get(['downloadedGifs'], (result) => {
  if (result.downloadedGifs) {
    downloadedGifs = result.downloadedGifs;
  }
});
