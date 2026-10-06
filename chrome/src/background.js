// Firefox는 browser.*(Promise), Chrome MV3는 chrome.*(Promise)를 쓴다.
const api = globalThis.browser ?? chrome;

// 저장 폴더 (다운로드 폴더 아래). 브라우저별로 나눠서 Chrome과 Firefox/Zen 목록·파일이 섞이지 않게 한다.
// ※ globalThis.browser는 최근 Chrome에도 있어 판별에 못 쓴다 → 확장 주소의 스킴으로 구분
const FOLDER = api.runtime.getURL('').startsWith('chrome-extension://') ? 'jjal-tok-chrome' : 'jjal-tok';
const MAX_GIFS = 20;
// 파일이 "지금" 있는지 알려주는 Native Messaging 도우미 (native-host/install.sh로 설치, 선택 사항)
const NATIVE_HOST = 'jjaltok_host';
// 다운로드 기록 중 "jjal-tok 폴더 바로 아래 파일"만 골라내는 정규식 (mac/win 경로 구분자 모두)
const FOLDER_FILE_REGEX = `[\\\\/]${FOLDER}[\\\\/][^\\\\/]+$`;

// content.js가 우클릭 시점에 계산해서 보내주는 "실제 원본" GIF URL.
// storage_jjal처럼 <img src>가 썸네일(webp)인 사이트에서 info.srcUrl 대신 쓴다.
let lastContextImageUrl = null;

/*
 * 저장 항목 구조
 * {
 *   id:         고유 ID (목록 식별용, 다운로드 ID와 무관)
 *   url:        원본 GIF URL (중복 판단 기준)
 *   filename:   표시용 파일명
 *   filePath:   실제 저장된 절대 경로 (다운로드 기록을 다시 찾을 때 쓰는 기준)
 *   downloadId: 이번 브라우저 세션에서의 다운로드 ID (Firefox는 재시작마다 바뀜!)
 *   status:     downloading / complete / failed
 *   reveal:     다운로드 완료 시 Finder를 자동으로 열지 여부
 *   timestamp
 * }
 */

// ---------- Storage (항상 storage가 원본, 동시 수정은 큐로 직렬화) ----------

let storageQueue = Promise.resolve();

async function getGifs() {
  const { downloadedGifs = [] } = await api.storage.local.get('downloadedGifs');
  return downloadedGifs;
}

// mutator(gifs)가 반환한 배열을 저장한다. (undefined면 gifs를 그대로 저장)
function updateGifs(mutator) {
  const run = storageQueue.then(async () => {
    const gifs = await getGifs();
    const next = (await mutator(gifs)) ?? gifs;
    await api.storage.local.set({ downloadedGifs: next });
    return next;
  });
  storageQueue = run.catch((error) => console.error('목록 저장 실패:', error));
  return run;
}

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// 20개를 넘어 목록에서 밀려난 항목은 실제 파일도 함께 삭제해서 폴더와 목록을 맞춘다.
// updateGifs 안에서 불리므로 storage를 건드리지 않는 작업만 하고, 기다리지 않는다(fire-and-forget).
function onGifsEvicted(evicted) {
  for (const gif of evicted) {
    locateFile(gif)
      .then(file => (file && file.exists ? deleteFile(file) : true))
      .then(deleted => {
        if (!deleted) {
          console.warn('밀려난 항목의 파일을 삭제하지 못함 (확인 불가):', gif.filename);
        }
      })
      .catch(error => console.error('밀려난 항목 파일 삭제 실패:', gif.filename, error));
  }
}

// ---------- 도우미 (Native Messaging) ----------

// 마지막 도우미 실패 이유: 'missing'(미설치/Chrome) | 'permission'(macOS 권한) | 그 밖의 메시지
let lastNativeError = null;

// 도우미에게 요청한다. 미설치(또는 Chrome)이거나 실패하면 null.
async function callNative(action, payload = {}) {
  try {
    const response = await api.runtime.sendNativeMessage(NATIVE_HOST, { action, ...payload });
    if (response && response.ok) return response;
    lastNativeError = (response && response.error) || 'unknown';
    console.warn(`도우미 ${action} 실패:`, response);
  } catch (error) {
    lastNativeError = 'missing';
  }
  return null;
}

// 도우미를 쓸 수 있는 환경인지: nativeMessaging 권한이 있는 빌드(Firefox/Zen) + macOS (도우미가 macOS 전용)
// ※ 최근 Chrome도 globalThis.browser를 지원하므로 브라우저 판별에 쓰면 안 된다.
async function helperSupported() {
  const permissions = api.runtime.getManifest().permissions || [];
  if (!permissions.includes('nativeMessaging')) return false;
  try {
    const { os } = await api.runtime.getPlatformInfo();
    return os === 'mac';
  } catch (error) {
    return false;
  }
}

function dirname(path) {
  return path.replace(/[\\/][^\\/]+$/, '');
}

function basename(path) {
  return path.split(/[\\/]/).pop();
}

// macOS 파일명은 한글이 NFD로 올 수도 있어서, 경로 비교는 NFC로 맞춘 뒤 한다.
function pathKey(path) {
  return path.normalize('NFC');
}

// ---------- 파일 찾기 ----------

// Firefox 데스크톱의 확장용 downloads API는 "이번 브라우저 세션에 받은 것"만 보여준다.
// (완료된 다운로드는 재시작 후 브라우저 '기록'에만 남고 API 목록에는 다시 올라오지 않음)
// 그래서 이번 세션 파일은 다운로드 기록으로, 그 전 파일은 도우미로 경로를 직접 확인한다.
async function findDownloadItem(gif) {
  if (!gif.filePath && !gif.url) return null;
  const query = gif.filePath
    ? { filename: gif.filePath }
    : { url: gif.url, filenameRegex: FOLDER_FILE_REGEX };
  const items = await api.downloads.search({ ...query, orderBy: ['-startTime'] });
  const item = items.find(i => i.state === 'complete') ?? items[0] ?? null;
  if (item) await refreshExists([item]);
  return item;
}

// Firefox의 item.exists는 Finder에서 지운 걸 바로 알지 못한다.
// 도우미가 있으면 실제 디스크를 확인한 값으로 덮어쓴다. 도우미를 썼으면 true.
// (Chrome은 search()가 직접 존재 확인을 하므로 도우미가 필요 없다)
async function refreshExists(items) {
  const paths = items
    .filter(item => item.state === 'complete' && isInJjalTokFolder(item.filename))
    .map(item => item.filename);
  const response = await callNative('exists', { paths });
  if (!response) return false;
  for (const item of items) {
    const exists = response.results[item.filename];
    if (typeof exists === 'boolean') item.exists = exists;
  }
  return true;
}

async function getFolderPath() {
  const known = (await getGifs()).find(g => g.filePath);
  if (known) return dirname(known.filePath);
  const listing = await callNative('list');
  return listing ? listing.folder : null;
}

// 항목의 실제 파일 상태.
// 반환: { path, exists, downloadId } | { inProgress: true } | null(확인 불가: 기록도 도우미도 없음)
// downloadId가 null이면 이전 세션 파일 → 위치 열기/삭제를 도우미로 한다.
async function locateFile(gif) {
  const item = await findDownloadItem(gif);
  if (item && item.state === 'in_progress') return { inProgress: true };
  if (item && item.state === 'complete') {
    return { path: item.filename, exists: item.exists, downloadId: item.id };
  }

  // 예전 버전 항목은 filePath가 없다 → 폴더 경로 + 파일명으로 추정
  let path = gif.filePath;
  if (!path && gif.filename) {
    const folder = await getFolderPath();
    if (folder) path = `${folder}/${gif.filename}`;
  }
  if (!path) return null;

  const response = await callNative('exists', { paths: [path] });
  const exists = response ? response.results[path] : null;
  return typeof exists === 'boolean' ? { path, exists, downloadId: null } : null;
}

async function findDownloadById(downloadId) {
  const [item] = await api.downloads.search({ id: downloadId });
  return item ?? null;
}

function isInJjalTokFolder(path) {
  if (typeof path !== 'string' || /(^|[\\/])\.\.?([\\/]|$)/.test(path)) return false; // . / .. 경로 거부
  return new RegExp(FOLDER_FILE_REGEX, 'i').test(path);
}

async function revealDownload(downloadId) {
  try {
    await api.downloads.show(downloadId);
    return true;
  } catch (error) {
    console.error('파일 위치 열기 실패:', error);
    return false;
  }
}

// Finder에서 파일 위치 열기 (이번 세션 파일은 downloads API, 이전 파일은 도우미)
async function revealFile(file) {
  if (file.downloadId != null && await revealDownload(file.downloadId)) return true;
  return !!(await callNative('reveal', { path: file.path }));
}

// 실제 파일 삭제. 삭제했으면(또는 이미 없으면) true.
async function deleteFile(file) {
  if (!file || !isInJjalTokFolder(file.path)) return false;
  if (file.downloadId != null) {
    const item = await findDownloadById(file.downloadId);
    if (item && await deleteDownloadedFile(item)) return true;
  }
  const response = await callNative('delete', { paths: [file.path] });
  return !!response && response.results[file.path] === true;
}

// ---------- 다운로드 ----------

// 같은 URL을 연달아 더블클릭했을 때 두 번 받지 않도록 처리 중인 URL을 기억한다.
const pendingUrls = new Set();

// options.reveal: 저장(또는 중복 확인) 후 Finder에서 파일 위치를 열지 여부
async function downloadGif(url, options = {}) {
  if (pendingUrls.has(url)) {
    return { success: true, duplicate: true, inProgress: true };
  }
  pendingUrls.add(url);
  try {
    return await downloadGifOnce(url, options);
  } finally {
    pendingUrls.delete(url);
  }
}

async function downloadGifOnce(url, { reveal = true } = {}) {
  const gifs = await getGifs();
  const existing = gifs.find(g => g.url === url);

  if (existing) {
    const file = await locateFile(existing);

    if (file && file.inProgress) {
      return { success: true, duplicate: true, inProgress: true };
    }

    if (file && file.exists) {
      // 같은 파일: 새로 받지 않고 목록 맨 위로 올린 뒤 위치만 연다.
      await updateGifs(list => {
        const target = list.find(g => g.id === existing.id);
        if (!target) return list;
        Object.assign(target, {
          filePath: file.path,
          downloadId: file.downloadId,
          status: 'complete',
          timestamp: new Date().toISOString()
        });
        return [target, ...list.filter(g => g.id !== existing.id)];
      });
      if (reveal) await revealFile(file);
      return { success: true, duplicate: true };
    }

    // 파일이 없거나 확인할 수 없음 → 같은 이름으로 다시 받는다.
    // (확인 불가인데 실제론 파일이 있는 경우 "이름(1).gif" 중복이 생기지 않도록 덮어쓴다)
    await updateGifs(list => list.filter(g => g.id !== existing.id));
    return startDownload(url, {
      reveal,
      filename: existing.filename || extractFilename(url),
      conflictAction: 'overwrite'
    });
  }

  return startDownload(url, { reveal });
}

// conflictAction: 같은 이름 파일이 있을 때 동작. 기본은 번호 붙이기(uniquify),
// 기록만 사라진 파일을 복구할 때는 같은 이름으로 덮어쓴다(overwrite).
async function startDownload(url, { reveal, filename = extractFilename(url), conflictAction = 'uniquify' }) {

  let downloadId;
  try {
    downloadId = await api.downloads.download({
      url,
      filename: `${FOLDER}/${filename}`,
      saveAs: false,
      conflictAction
    });
  } catch (error) {
    console.error('다운로드 실패:', error);
    return { success: false, error: String(error?.message || error) };
  }

  console.log('GIF 다운로드 시작:', downloadId, filename);

  await updateGifs(list => {
    const next = [{
      id: newId(),
      url,
      filename,
      filePath: null,
      downloadId,
      status: 'downloading',
      reveal,
      timestamp: new Date().toISOString()
    }, ...list];
    onGifsEvicted(next.slice(MAX_GIFS));
    return next.slice(0, MAX_GIFS);
  });

  // 작은 GIF는 download() 콜백보다 'complete' 이벤트가 먼저 와서 놓칠 수 있다.
  // 목록에 넣은 직후 현재 상태를 한 번 더 확인한다.
  const item = await findDownloadById(downloadId);
  if (item) await applyDownloadState(item);

  // Finder가 자동으로 열리지 않는 경우(드래그 저장)에만 알림으로 알려준다.
  if (!reveal) {
    try {
      api.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: '짤톡',
        message: `${filename} 저장 중... 다운로드/${FOLDER} 폴더에서 확인하세요!`
      });
    } catch (error) {
      console.log('알림 생성 실패:', error);
    }
  }

  return { success: true, duplicate: false };
}

// 다운로드 상태를 목록에 반영하고, 막 완료된 경우 Finder를 연다.
async function applyDownloadState(item) {
  const status = item.state === 'complete' ? 'complete'
    : item.state === 'interrupted' ? 'failed'
    : null;
  if (!status) return;

  let shouldReveal = false;
  await updateGifs(list => {
    const gif = list.find(g => g.downloadId === item.id && g.status === 'downloading');
    if (!gif) return list;
    // 저장 창에서 사용자가 취소한 경우: '실패'로 남기지 않고 목록에서 뺀다
    if (status === 'failed' && item.error === 'USER_CANCELED') {
      return list.filter(g => g !== gif);
    }
    gif.status = status;
    if (status === 'complete') {
      gif.filePath = item.filename;
      gif.filename = item.filename.split(/[\\/]/).pop();
      shouldReveal = gif.reveal !== false;
    }
    delete gif.reveal;
    return list;
  });

  if (shouldReveal) await revealDownload(item.id);
}

api.downloads.onChanged.addListener(async (delta) => {
  if (!delta.state) return;
  const item = await findDownloadById(delta.id);
  if (item) await applyDownloadState(item);
});

// ---------- 목록 항목 열기 / 삭제 ----------

async function revealGif(id) {
  const gif = (await getGifs()).find(g => g.id === id);
  if (!gif) return { success: false, error: '목록에 없는 항목입니다' };

  const file = await locateFile(gif);
  if (file && file.inProgress) return { success: true };
  if (file && file.exists) {
    await updateGifs(list => {
      const target = list.find(g => g.id === id);
      if (target) Object.assign(target, { downloadId: file.downloadId, filePath: file.path, status: 'complete' });
      return list;
    });
    return { success: await revealFile(file) };
  }

  if (!gif.url) return { success: false, error: '파일이 없고 원본 주소도 없어 복구할 수 없어요' };

  // 파일이 없거나 확인할 수 없는 경우: 원본에서 같은 이름으로 다시 받아 위치를 연다.
  // (확인만 못 했을 뿐 파일이 남아 있을 수 있으므로 덮어써서 중복 파일이 생기지 않게 한다)
  await updateGifs(list => list.filter(g => g.id !== id));
  const result = await startDownload(gif.url, {
    reveal: true,
    filename: gif.filename || extractFilename(gif.url),
    conflictAction: 'overwrite'
  });
  return { ...result, redownloaded: true };
}

// 이번 세션 다운로드의 실제 파일 삭제 + 다운로드 기록 삭제. 삭제했으면 true.
async function deleteDownloadedFile(item) {
  if (!item || item.state !== 'complete' || !isInJjalTokFolder(item.filename)) {
    return false;
  }
  let deleted = true;
  try {
    await api.downloads.removeFile(item.id);
  } catch (error) {
    // 이미 파일이 없는 경우도 여기로 온다 → 결과적으로 "없는 상태"이므로 성공으로 본다.
    console.warn('파일 삭제 실패(이미 없을 수 있음):', error?.message || error);
    deleted = /doesn't exist|not exist/i.test(String(error?.message || error));
  }
  try {
    await api.downloads.erase({ id: item.id });
  } catch (error) {
    console.warn('다운로드 기록 삭제 실패:', error?.message || error);
  }
  return deleted;
}

async function clearGif(id) {
  const gif = (await getGifs()).find(g => g.id === id);
  let fileDeleted = false;

  if (gif) {
    const file = await locateFile(gif);
    if (file && !file.inProgress) {
      fileDeleted = file.exists ? await deleteFile(file) : true;
    }
  }

  await updateGifs(list => list.filter(g => g.id !== id));
  return { success: true, fileDeleted };
}

// ---------- 동기화 ----------

// jjal-tok 폴더에 받은 "완료된" 다운로드 기록 (이번 세션 것만 보임).
// Chrome은 search() 호출이 파일 존재 확인을 '트리거'만 하므로 잠깐 기다렸다 한 번 더 조회한다.
async function searchFolderDownloads() {
  const query = { filenameRegex: FOLDER_FILE_REGEX, state: 'complete', orderBy: ['-startTime'] };
  await api.downloads.search(query);
  await new Promise(resolve => setTimeout(resolve, 300));
  return api.downloads.search(query);
}

// 원본 URL을 모르는 항목은 macOS가 파일에 기록해 둔 다운로드 출처(kMDItemWhereFroms)로 채운다.
// URL이 있어야 썸네일이 보이고, 같은 GIF를 다시 더블클릭했을 때 중복으로 알아본다.
// 반환: 도우미가 확인했지만 출처 기록이 없는 항목 id 목록 (도우미 실패 시엔 빈 목록 — 함부로 지우지 않기 위해)
async function fillMissingUrls() {
  const targets = (await getGifs()).filter(g => !g.url && g.filePath);
  if (targets.length === 0) return [];
  const response = await callNative('sourceUrl', { paths: targets.map(g => g.filePath) });
  if (!response) return [];

  const unknownIds = [];
  await updateGifs(list => {
    for (const gif of list) {
      if (gif.url || !gif.filePath || !(gif.filePath in response.results)) continue;
      const url = response.results[gif.filePath];
      if (typeof url === 'string') gif.url = url;
      else unknownIds.push(gif.id);
    }
    return list;
  });
  return unknownIds;
}

async function syncWithFolder() {
  // 원본 URL을 끝내 알 수 없는 항목은 썸네일·중복 확인이 안 되므로 파일과 함께 정리한다.
  const unknownIds = await fillMissingUrls();
  let droppedUnknown = 0;
  for (const id of unknownIds) {
    const result = await clearGif(id);
    if (result.success) droppedUnknown++;
  }

  const items = await searchFolderDownloads();
  await refreshExists(items);

  const located = new Map();
  for (const gif of await getGifs()) {
    if (gif.status !== 'downloading') located.set(gif.id, await locateFile(gif));
  }

  let removed = 0;
  let unverified = 0;
  const next = await updateGifs(list => list.filter(gif => {
    if (!located.has(gif.id)) return true; // 다운로드 중이거나 동기화 도중 새로 추가된 항목
    const file = located.get(gif.id);
    if (file && file.inProgress) return true;
    if (!file) {
      // 다운로드 기록도 도우미도 없어 확인 불가. 클릭하면 다시 받아서 복구된다.
      unverified++;
      return true;
    }
    if (!file.exists) {
      removed++;
      return false;
    }
    Object.assign(gif, { downloadId: file.downloadId, filePath: file.path, status: 'complete' });
    return true;
  }));

  // 파일이 없는 다운로드 기록은 정리
  for (const item of items) {
    if (!item.exists) api.downloads.erase({ id: item.id }).catch(() => {});
  }

  // 목록에 없는 파일: 도우미가 있으면 폴더를 직접 읽고, 없으면 이번 세션 다운로드 기록에서 찾는다.
  const folderGif = next.find(g => g.filePath);
  const listing = await callNative('list', { path: folderGif ? dirname(folderGif.filePath) : null });
  const folderFiles = listing
    ? listing.files
    : items.filter(item => item.exists).map(item => item.filename);

  const listedPaths = new Set(next.filter(g => g.filePath).map(g => pathKey(g.filePath)));
  const urlByPath = new Map(items.map(item => [pathKey(item.filename), item.url]));
  const seen = new Set();
  const orphans = [];
  for (const filePath of folderFiles) {
    const key = pathKey(filePath);
    if (listedPaths.has(key) || seen.has(key)) continue;
    seen.add(key);
    orphans.push({ filePath, filename: basename(filePath), url: urlByPath.get(key) ?? null });
  }
  await rememberOrphans(orphans.map(o => o.filePath));

  // 도우미를 쓸 수 있는 환경인데 폴더를 못 읽었으면 팝업에서 이유별로 안내 (도우미 미설치 / macOS 권한)
  const nativeProblem = !listing && await helperSupported() ? (lastNativeError || 'missing') : null;
  return { success: true, removed, unverified, orphans, droppedUnknown, nativeProblem, listCount: next.length, folder: FOLDER };
}

// 목록에 없는 파일들 처리: mode = 'delete' | 'adopt'
// 마지막 동기화가 "목록에 없는 파일"로 보여준 경로만 삭제/추가할 수 있게 기억해 둔다.
// (요청에 담긴 임의 경로를 그대로 믿지 않기 위해. 백그라운드가 잠들었다 깨도 남도록 storage.session 사용)
let lastOrphanPaths = [];

async function rememberOrphans(paths) {
  lastOrphanPaths = paths;
  try {
    await api.storage.session.set({ lastOrphanPaths: paths });
  } catch (error) {
    // storage.session이 없는 오래된 브라우저 → 메모리 값만 사용
  }
}

async function getRememberedOrphans() {
  try {
    const { lastOrphanPaths: saved } = await api.storage.session.get('lastOrphanPaths');
    if (Array.isArray(saved)) return saved;
  } catch (error) {
    // 메모리 값 사용
  }
  return lastOrphanPaths;
}

async function resolveOrphans(filePaths, mode) {
  let count = 0;
  const allowed = new Set(await getRememberedOrphans());
  const targets = filePaths.filter(path => allowed.has(path) && isInJjalTokFolder(path));

  if (mode === 'delete') {
    for (const filePath of targets) {
      const [item] = await api.downloads.search({ filename: filePath, state: 'complete' });
      if (await deleteFile({ path: filePath, downloadId: item ? item.id : null })) count++;
    }
  } else if (mode === 'adopt') {
    // 이번 세션 기록이 없는 파일은 파일 속성에서 원본 URL을 찾고, 그래도 모르면 추가하지 않는다.
    const sources = await callNative('sourceUrl', { paths: targets });
    const adopted = [];
    for (const filePath of targets) {
      const [item] = await api.downloads.search({ filename: filePath, state: 'complete' });
      const url = item ? item.url : (sources && sources.results[filePath]);
      if (typeof url !== 'string') continue;
      adopted.push({
        id: newId(),
        url,
        filename: basename(filePath),
        filePath,
        downloadId: item ? item.id : null,
        status: 'complete',
        timestamp: new Date().toISOString()
      });
    }
    await updateGifs(list => {
      // 빈 자리만큼만 추가한다. (넘치는 걸 evict하면 방금 추가한 파일이 바로 지워지므로)
      const known = new Set(list.filter(g => g.filePath).map(g => pathKey(g.filePath)));
      const room = Math.max(0, MAX_GIFS - list.length);
      const added = adopted.filter(g => !known.has(pathKey(g.filePath))).slice(0, room);
      count = added.length;
      return [...list, ...added];
    });
  }

  return { success: true, count };
}

// 브라우저 시작/확장 업데이트 시: 저장된 downloadId를 이번 세션 기준으로 다시 맞춘다.
// (Firefox는 재시작하면 예전 다운로드가 API에서 사라지고 ID도 새로 매겨진다)
async function reconcileDownloadIds() {
  const resolved = new Map();
  for (const gif of await getGifs()) {
    resolved.set(gif.id, await locateFile(gif).catch(() => null));
  }
  await updateGifs(list => {
    for (const gif of list) {
      const file = resolved.get(gif.id);
      if (file && file.inProgress) continue;
      gif.downloadId = file ? file.downloadId : null;
      // 추정 경로는 실제로 있을 때만 확정한다
      if (file && (file.exists || gif.filePath)) gif.filePath = file.path;
      // 예전 버전의 경쟁 상태로 'downloading'에 멈춰 있던 항목은 클릭 시 복구되므로 완료로 표시
      if (gif.status === 'downloading') gif.status = 'complete';
      // 예전 버전 항목은 id가 다운로드 ID(숫자)였다 → 충돌 방지를 위해 새 ID로 교체
      if (typeof gif.id === 'number') gif.id = newId();
    }
    return list;
  });
}

// ---------- 이벤트 연결 ----------

api.runtime.onInstalled.addListener(() => {
  api.contextMenus.create({
    id: 'saveGifToJjalTok',
    title: '짤톡에 저장',
    contexts: ['image']
  });
  reconcileDownloadIds();
});

api.runtime.onStartup.addListener(() => {
  reconcileDownloadIds();
});

api.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'saveGifToJjalTok') {
    // content.js가 우클릭 직전에 알려준 원본 GIF URL이 있으면 그걸 쓰고,
    // 없으면(다른 사이트 등) 브라우저가 넘겨준 info.srcUrl로 폴백한다.
    const imageUrl = lastContextImageUrl || info.srcUrl;
    lastContextImageUrl = null;
    downloadGif(imageUrl, { reveal: true });
  }
});

const handlers = {
  setContextImageUrl: (request) => {
    lastContextImageUrl = request.url;
    return { success: true };
  },
  downloadGif: (request) => downloadGif(request.url, { reveal: request.reveal !== false }),
  getDownloadedGifs: async () => ({ gifs: await getGifs() }),
  revealGif: (request) => revealGif(request.id),
  clearGif: (request) => clearGif(request.id),
  syncWithFolder: () => syncWithFolder(),
  resolveOrphans: (request) => resolveOrphans(request.filePaths || [], request.mode),
  openDownloadsFolder: () => openJjalTokFolder()
};

// '폴더 열기': 다운로드 API에는 "특정 폴더 열기"가 없고 showDefaultFolder()는 ~/Downloads만 연다.
// 1) jjal-tok 안의 가장 최근 파일을 show()하면 Finder가 jjal-tok 폴더를 연다 (그 파일이 선택된 상태).
// 2) 남은 파일이 없으면 도우미에게 폴더 열기를 부탁하고, 3) 그것도 안 되면 기본 다운로드 폴더를 연다.
async function openJjalTokFolder() {
  const items = await api.downloads.search({
    filenameRegex: FOLDER_FILE_REGEX,
    state: 'complete',
    orderBy: ['-startTime']
  });
  await refreshExists(items);

  const existing = items.find(item => item.exists);
  if (existing && await revealDownload(existing.id)) {
    return { success: true, opened: 'jjal-tok' };
  }

  // 이번 세션 파일이 없으면 도우미가 폴더를 연다 (목록에 남은 경로의 폴더, 없으면 ~/Downloads/jjal-tok)
  const folderPath = items[0] ? dirname(items[0].filename) : await getFolderPath();
  if (await callNative('openFolder', { path: folderPath })) {
    return { success: true, opened: 'jjal-tok' };
  }

  api.downloads.showDefaultFolder();
  return { success: true, opened: 'default', folder: FOLDER };
}

// 웹페이지에 주입된 content script가 보낼 수 있는 요청은 GIF 저장 관련뿐이다.
// 파일 삭제·동기화 같은 나머지는 확장 프로그램 자체 페이지(팝업)에서 온 요청만 받는다.
const CONTENT_SCRIPT_ACTIONS = new Set(['setContextImageUrl', 'downloadGif']);

function isFromExtensionPage(sender) {
  return sender.id === api.runtime.id && !sender.tab &&
    typeof sender.url === 'string' && sender.url.startsWith(api.runtime.getURL(''));
}

api.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const handler = handlers[request.action];
  if (!handler || sender.id !== api.runtime.id) return false;
  if (!CONTENT_SCRIPT_ACTIONS.has(request.action) && !isFromExtensionPage(sender)) {
    console.warn('허용되지 않은 요청 무시:', request.action, sender.url);
    return false;
  }

  Promise.resolve()
    .then(() => handler(request))
    .then(sendResponse)
    .catch((error) => {
      console.error(`${request.action} 처리 실패:`, error);
      sendResponse({ success: false, error: String(error?.message || error) });
    });
  return true; // 비동기 응답
});

function extractFilename(url) {
  try {
    const filename = decodeURIComponent(new URL(url).pathname.split('/').pop());
    if (filename) return filename;
  } catch (error) {
    // 잘못된 URL / 인코딩이면 아래 기본 이름 사용
  }
  return `gif_${Date.now()}.gif`;
}
