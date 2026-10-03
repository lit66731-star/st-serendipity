/* ==========================================================================
   error · 音乐播放器（SillyTavern 第三方扩展）
   界面仿网易云音乐，配色沿用 Serendipity 的暖白 + 灰玫瑰体系。
   歌源：本地文件（存 IndexedDB）+ 直链 URL；播放内核用 HTML5 Audio。
   ========================================================================== */

const extensionName = 'error';
const VERSION = '1.0.0'; // 面板标题旁展示，更新时与 manifest.json 同步

// ---------------- 图标（线性极简） ----------------
const ICONS = {
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
    prev: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zM20 6l-9 6 9 6z"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zM4 6l9 6-9 6z"/></svg>',
    loopList: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3l3 3-3 3"/><path d="M4 6h13a3 3 0 0 1 3 3v1"/><path d="M7 21l-3-3 3-3"/><path d="M20 18H7a3 3 0 0 1-3-3v-1"/></svg>',
    loopOne: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3l3 3-3 3"/><path d="M4 6h13a3 3 0 0 1 3 3v1"/><path d="M7 21l-3-3 3-3"/><path d="M20 18H7a3 3 0 0 1-3-3v-1"/><text x="11.4" y="13" font-size="7" stroke="none" fill="currentColor" font-family="sans-serif">1</text></svg>',
    shuffle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h3l9 12h6"/><path d="M21 6h-3l-4.5 6"/><path d="M3 18h3l1.8-2.4"/><path d="M17 3l3 3-3 3"/><path d="M17 15l3 3-3 3"/></svg>',
    volume: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    music: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 18.5a3 3 0 1 1-2-2.83V6.6L18 4v10.5a3 3 0 1 1-2-2.83V7.6L9 9.3z"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1.5 1.5"/><path d="M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1.5-1.5"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
};

// ---------------- 状态 ----------------
const LOOP_MODES = [
    { key: 'list', title: '列表循环', icon: 'loopList' },
    { key: 'one', title: '单曲循环', icon: 'loopOne' },
    { key: 'shuffle', title: '随机播放', icon: 'shuffle' },
];

let settings = {
    songs: [],          // { id, title, artist, source: 'url'|'local', url?, fileId?, duration? }
    currentIndex: -1,
    loopMode: 'list',
    volume: 0.8,
};

let audio = new Audio();
let playing = false;
let currentObjectUrl = null; // 本地文件播放时的 object URL，切换时 revoke

// ---------------- 工具 ----------------
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtDur(sec) {
    if (sec == null || !isFinite(sec) || sec < 0) return '--:--';
    sec = Math.floor(sec);
    const m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);
}

const LS_KEY = 'st-error-music';
function saveSettings() { try { localStorage.setItem(LS_KEY, JSON.stringify(settings)); } catch (e) {} }
function loadSettings() {
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) {
            const p = JSON.parse(raw);
            settings = Object.assign(settings, p);
            if (!Array.isArray(settings.songs)) settings.songs = [];
        }
    } catch (e) { settings.songs = []; }
}

// ---------------- IndexedDB（本地音频文件持久化） ----------------
const DB_NAME = 'st-error-music';
const DB_STORE = 'files';
function idbOpen() {
    return new Promise((res, rej) => {
        if (!('indexedDB' in window)) return rej(new Error('no idb'));
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
        };
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
    });
}
async function idbPut(id, blob) {
    const db = await idbOpen();
    return new Promise((res, rej) => {
        const tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).put(blob, id);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
    });
}
async function idbGet(id) {
    const db = await idbOpen();
    return new Promise((res, rej) => {
        const tx = db.transaction(DB_STORE, 'readonly');
        const rq = tx.objectStore(DB_STORE).get(id);
        rq.onsuccess = () => res(rq.result || null);
        rq.onerror = () => rej(rq.error);
    });
}
async function idbDel(id) {
    try {
        const db = await idbOpen();
        return new Promise((res, rej) => {
            const tx = db.transaction(DB_STORE, 'readwrite');
            tx.objectStore(DB_STORE).delete(id);
            tx.oncomplete = () => res();
            tx.onerror = () => rej(tx.error);
        });
    } catch (e) {}
}

// ---------------- 播放内核 ----------------
function currentSong() { return settings.songs[settings.currentIndex]; }

async function playIndex(i) {
    const n = settings.songs.length;
    if (!n) return;
    if (i < 0) i = 0;
    if (i >= n) i = n - 1;
    settings.currentIndex = i;
    const s = settings.songs[i];
    saveSettings();

    // 释放上一个本地文件的 object URL
    if (currentObjectUrl) { URL.revokeObjectURL(currentObjectUrl); currentObjectUrl = null; }

    let src;
    if (s.source === 'local') {
        try {
            const blob = await idbGet(s.fileId);
            if (!blob) { toastr.warning('本地文件不存在，已跳过'); return; }
            currentObjectUrl = URL.createObjectURL(blob);
            src = currentObjectUrl;
        } catch (e) { toastr.error('读取本地文件失败'); return; }
    } else {
        src = s.url;
    }

    try {
        audio.src = src;
        await audio.play();
    } catch (e) {
        toastr.warning('播放失败：' + (s.title || s.url));
    }
}

function togglePlay() {
    if (!settings.songs.length) return;
    if (playing) audio.pause();
    else if (audio.src) audio.play().catch(() => {});
    else playIndex(settings.currentIndex < 0 ? 0 : settings.currentIndex);
}

function playPrev() {
    if (!settings.songs.length) return;
    const n = settings.songs.length;
    let i = settings.currentIndex;
    if (i < 0) i = 0; else i = (i - 1 + n) % n;
    playIndex(i);
}

function playNext() {
    if (!settings.songs.length) return;
    const n = settings.songs.length;
    if (settings.loopMode === 'shuffle' && n > 1) {
        let j = settings.currentIndex;
        while (j === settings.currentIndex) j = Math.floor(Math.random() * n);
        playIndex(j);
    } else {
        playIndex((settings.currentIndex + 1) % n);
    }
}

function onEnded() {
    const n = settings.songs.length;
    if (!n) return;
    if (settings.loopMode === 'one') { playIndex(settings.currentIndex); }
    else playNext(); // list / shuffle 都走这里
}

function cycleLoopMode() {
    const idx = LOOP_MODES.findIndex(m => m.key === settings.loopMode);
    settings.loopMode = LOOP_MODES[(idx + 1) % LOOP_MODES.length].key;
    saveSettings();
    renderControls();
}

function setVolume(v) {
    settings.volume = Math.max(0, Math.min(1, v));
    audio.volume = settings.volume;
    saveSettings();
    $('#st-error .err__vol-input').val(Math.round(settings.volume * 100));
}

// ---------------- 歌单操作 ----------------
async function addUrlSong(url, title) {
    url = (url || '').trim();
    if (!url) return;
    title = (title || '').trim() || url.split('/').pop().split('?')[0].replace(/\.[a-z0-9]+$/i, '') || '未命名';
    settings.songs.push({ id: uid(), title, artist: '', source: 'url', url, duration: null });
    saveSettings();
    renderAll();
}

async function addLocalFiles(files) {
    for (const f of files) {
        const id = uid();
        try {
            await idbPut(id, f);
        } catch (e) {
            toastr.error('保存本地文件失败（浏览器可能不支持 IndexedDB）');
            continue;
        }
        const name = f.name.replace(/\.[a-z0-9]+$/i, '');
        settings.songs.push({ id, title: name, artist: '', source: 'local', fileId: id, duration: null });
    }
    saveSettings();
    renderAll();
}

async function removeSong(id) {
    const idx = settings.songs.findIndex(s => s.id === id);
    if (idx < 0) return;
    const s = settings.songs[idx];
    const wasCurrent = idx === settings.currentIndex;

    if (s.source === 'local') await idbDel(s.fileId);

    settings.songs.splice(idx, 1);
    if (wasCurrent) {
        if (currentObjectUrl) { URL.revokeObjectURL(currentObjectUrl); currentObjectUrl = null; }
        audio.pause();
        audio.removeAttribute('src');
        playing = false;
        if (settings.songs.length) {
            settings.currentIndex = Math.min(idx, settings.songs.length - 1);
            playIndex(settings.currentIndex);
        } else {
            settings.currentIndex = -1;
        }
    } else if (idx < settings.currentIndex) {
        settings.currentIndex -= 1;
    }
    saveSettings();
    renderAll();
}

// ---------------- 渲染 ----------------
function renderControls() {
    const panel = $('#st-error');
    if (!panel.length) return;
    const m = LOOP_MODES.find(x => x.key === settings.loopMode) || LOOP_MODES[0];
    panel.find('.err__loop').attr('title', m.title).html(ICONS[m.icon]);
    panel.find('.err__play-toggle').html(playing ? ICONS.pause : ICONS.play);
    panel.find('.err__disc').toggleClass('is-playing', playing);
    panel.find('.err__needle').toggleClass('is-on', playing);
}

function renderNow() {
    const panel = $('#st-error');
    if (!panel.length) return;
    const s = currentSong();
    const titleEl = panel.find('.err__now-title');
    const artistEl = panel.find('.err__now-artist');
    const discCover = panel.find('.err__disc-cover');
    const discNote = panel.find('.err__disc-note');
    if (s) {
        titleEl.text(s.title);
        artistEl.text(s.artist || '未知艺术家');
        if (s.cover) {
            discCover.css('background-image', `url("${s.cover.replace(/"/g, '\\"')}")`).show();
            discNote.hide();
        } else {
            discCover.css('background-image', '').hide();
            discNote.show();
        }
        panel.find('.err__now-time').text(fmtDur(audio.currentTime || 0));
        panel.find('.err__now-dur').text(fmtDur(s.duration));
    } else {
        titleEl.text('未在播放');
        artistEl.text('添加歌曲开始播放');
        discCover.css('background-image', '').hide();
        discNote.show();
        panel.find('.err__now-time').text('00:00');
        panel.find('.err__now-dur').text('--:--');
    }
}

function renderList() {
    const panel = $('#st-error');
    if (!panel.length) return;
    const list = panel.find('.err__list');
    list.empty();
    if (!settings.songs.length) {
        list.append(`<div class="err__empty">
            <div class="err__empty-icon">${ICONS.music}</div>
            <div class="err__empty-title">歌单还是空的</div>
            <div class="err__empty-sub">粘贴音频直链，或选择本地音频文件加入</div>
        </div>`);
        return;
    }
    settings.songs.forEach((s, i) => {
        const isCur = i === settings.currentIndex;
        const isPlaying = isCur && playing;
        const idxHtml = isPlaying
            ? '<span class="err__eq"><i></i><i></i><i></i></span>'
            : `<span class="err__row-idx">${String(i + 1).padStart(2, '0')}</span>`;
        list.append(`<div class="err__row ${isCur ? 'is-current' : ''}" data-id="${s.id}">
            <span class="err__row-idxwrap">${idxHtml}</span>
            <div class="err__row-main">
                <div class="err__row-title">${escapeHtml(s.title)}</div>
                <div class="err__row-artist">${escapeHtml(s.artist || '未知艺术家')}</div>
            </div>
            <span class="err__row-src">${s.source === 'local' ? ICONS.folder : ICONS.link}</span>
            <span class="err__row-dur">${fmtDur(s.duration)}</span>
            <button type="button" class="err__row-del" data-id="${s.id}" title="删除">${ICONS.trash}</button>
        </div>`);
    });
}

function renderAll() {
    renderList();
    renderNow();
    renderControls();
    const panel = $('#st-error');
    if (panel.length) panel.find('.err__count').text(settings.songs.length + ' 首');
}

// ---------------- 面板 ----------------
function buildPanel() {
    if ($('#st-error').length) return;
    const html = `
    <div id="st-error" class="err" style="display:none">
      <div class="err__head">
        <div class="err__brand">
          <span class="err__title">error</span>
          <span class="err__version">v${VERSION}</span>
        </div>
        <button type="button" class="err__close" title="关闭">${ICONS.close}</button>
      </div>

      <div class="err__body">
        <div class="err__stage">
          <div class="err__disc-wrap">
            <div class="err__needle"><span class="err__needle-pivot"></span><span class="err__needle-arm"></span></div>
            <div class="err__disc">
              <div class="err__disc-cover" style="display:none"></div>
              <div class="err__disc-note">${ICONS.music}</div>
              <div class="err__disc-center"></div>
            </div>
          </div>
          <div class="err__now">
            <div class="err__now-title">未在播放</div>
            <div class="err__now-artist">添加歌曲开始播放</div>
          </div>
          <div class="err__progress">
            <span class="err__now-time">00:00</span>
            <input type="range" class="err__seek" min="0" max="0" step="0.1" value="0">
            <span class="err__now-dur">--:--</span>
          </div>
          <div class="err__controls">
            <button type="button" class="err__ctrl err__loop" title="列表循环">${ICONS.loopList}</button>
            <button type="button" class="err__ctrl err__prev" title="上一首">${ICONS.prev}</button>
            <button type="button" class="err__ctrl err__play-toggle" title="播放/暂停">${ICONS.play}</button>
            <button type="button" class="err__ctrl err__next" title="下一首">${ICONS.next}</button>
            <div class="err__vol">
              <span class="err__vol-icon">${ICONS.volume}</span>
              <input type="range" class="err__vol-input" min="0" max="100" step="1" value="80">
            </div>
          </div>
        </div>

        <div class="err__side">
          <div class="err__side-head">
            <span class="err__label">播放列表</span>
            <span class="err__count">0 首</span>
          </div>
          <div class="err__add-row">
            <input type="text" class="err__url-input" placeholder="粘贴音频直链（.mp3/.m4a/…）">
            <button type="button" class="err__add-url" title="添加直链">${ICONS.plus}</button>
            <button type="button" class="err__add-local" title="添加本地文件">${ICONS.folder}</button>
          </div>
          <input type="file" class="err__file-input" accept="audio/*" multiple hidden>
          <div class="err__list"></div>
        </div>
      </div>
    </div>`;
    $('body').append(html);
    bindPanelEvents();
}

function bindPanelEvents() {
    const panel = $('#st-error');

    panel.find('.err__close').on('click', () => togglePanel(false));
    panel.find('.err__play-toggle').on('click', togglePlay);
    panel.find('.err__prev').on('click', playPrev);
    panel.find('.err__next').on('click', playNext);
    panel.find('.err__loop').on('click', cycleLoopMode);

    // 列表点击：点行播放、点删除移除
    panel.find('.err__list').on('click', '.err__row', function (e) {
        if ($(e.target).closest('.err__row-del').length) return;
        const id = $(this).data('id');
        const i = settings.songs.findIndex(s => s.id === id);
        if (i >= 0) playIndex(i);
    });
    panel.find('.err__list').on('click', '.err__row-del', function (e) {
        e.stopPropagation();
        removeSong($(this).data('id'));
    });

    // 添加直链
    panel.find('.err__add-url').on('click', () => {
        const input = panel.find('.err__url-input');
        addUrlSong(input.val());
        input.val('');
    });
    panel.find('.err__url-input').on('keydown', (e) => {
        if (e.key === 'Enter') {
            const input = panel.find('.err__url-input');
            addUrlSong(input.val());
            input.val('');
        }
    });

    // 本地文件
    panel.find('.err__add-local').on('click', () => panel.find('.err__file-input').trigger('click'));
    panel.find('.err__file-input').on('change', function () {
        if (this.files && this.files.length) addLocalFiles(Array.from(this.files));
        this.value = '';
    });

    // 进度 / 音量
    let seeking = false;
    panel.find('.err__seek').on('input', function () { seeking = true; });
    panel.find('.err__seek').on('change', function () {
        const v = parseFloat(this.value);
        if (isFinite(v) && audio.duration) { audio.currentTime = v; }
        seeking = false;
    });
    panel.find('.err__vol-input').on('input', function () { setVolume(parseInt(this.value, 10) / 100); });

    // 点击进度条区域不冒泡到面板
    panel.find('.err__progress').on('click', (e) => e.stopPropagation());
}

function fitPanelToViewport() {
    // 面板由 CSS 固定铺满全屏，这里只清除可能残留的内联定位。
    const panel = $('#st-error');
    if (!panel.length) return;
    panel.css({ top: '', bottom: '', left: '', right: '', width: '', maxWidth: '', maxHeight: '' });
}

function togglePanel(force) {
    const panel = $('#st-error');
    if (!panel.length) return;
    const show = force === undefined ? !panel.is(':visible') : force;
    if (show) {
        fitPanelToViewport();
        panel.show();
        renderAll();
    } else {
        panel.hide();
    }
    // 打开面板时给 body 打标记，用于移动端恢复触摸滚动（ST 移动端给 body 设了 touch-action:none）
    document.body.classList.toggle('st-error-open', show);
}

// ---------------- 顶栏按钮 ----------------
function buildButton() {
    const btn = $(`<div id="st-error-button" class="fa-solid fa-music fa-fw interactable"
        title="音乐播放器" data-i18n="[title]Music player" tabindex="0" role="button"></div>`);
    btn.on('click', () => togglePanel());
    // 优先插到顶栏右侧 #top-settings-holder，其次扩展菜单
    const holder = $('#top-settings-holder');
    if (holder.length) holder.append(btn);
    else {
        const menu = $('#extensionsMenu');
        if (menu.length) menu.append(btn);
        else $('body').append(btn);
    }
}

// ---------------- 初始化 ----------------
jQuery(async () => {
    loadSettings();
    audio.volume = settings.volume;
    buildButton();
    buildPanel();

    // 音频事件
    audio.addEventListener('play', () => { playing = true; renderControls(); renderNow(); });
    audio.addEventListener('pause', () => { playing = false; renderControls(); renderNow(); });
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('timeupdate', () => {
        const p = $('#st-error');
        if (!p.length || !p.is(':visible')) return;
        const d = audio.duration;
        if (isFinite(d) && d > 0) {
            p.find('.err__seek').attr('max', d).val(audio.currentTime);
        }
        p.find('.err__now-time').text(fmtDur(audio.currentTime));
    });
    audio.addEventListener('loadedmetadata', () => {
        const s = currentSong();
        const d = audio.duration;
        if (s && isFinite(d) && d > 0) { s.duration = d; saveSettings(); }
        renderNow();
    });
    audio.addEventListener('error', () => {
        if (!audio.src) return;
        toastr.error('播放出错：' + (currentSong() ? currentSong().title : '未知'));
    });

    $(window).on('resize.st-error', fitPanelToViewport);
    $(window).on('orientationchange.st-error', () => setTimeout(fitPanelToViewport, 300));
});
