// Runs inside the DUI browser that is painted onto the TV prop.
const stage = document.getElementById('stage');
const loadingEl = document.getElementById('loading');
const messageEl = document.getElementById('message');

let current = { id: null, platform: null, player: null, ready: false, live: false };
const desired = { volume: 50, paused: false };

/* ---------- overlays ---------- */
function showLoading(on) {
  loadingEl.classList.toggle('show', on);
  if (on) messageEl.classList.remove('show');
}
function showMessage(title, text) {
  loadingEl.classList.remove('show');
  document.getElementById('msgTitle').textContent = title;
  document.getElementById('msgText').textContent = text || '';
  messageEl.classList.add('show');
}
function hideMessage() { messageEl.classList.remove('show'); }

/* ---------- script loaders ---------- */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}
let ytPromise, twitchPromise, hlsPromise;
function ensureYT() {
  if (window.YT && window.YT.Player) return Promise.resolve();
  if (!ytPromise) {
    ytPromise = new Promise(res => {
      window.onYouTubeIframeAPIReady = res;
      loadScript('https://www.youtube.com/iframe_api');
    });
  }
  return ytPromise;
}
function ensureTwitch() {
  if (window.Twitch && window.Twitch.Player) return Promise.resolve();
  return (twitchPromise = twitchPromise || loadScript('https://player.twitch.tv/js/embed/v1.js'));
}
function ensureHls() {
  if (window.Hls) return Promise.resolve();
  return (hlsPromise = hlsPromise || loadScript('https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js'));
}

function twitchTime(s) {
  s = Math.max(0, Math.floor(s));
  return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m${s % 60}s`;
}

const ENDED_TEXT = 'Open the TV menu to play something else.';
const YT_ERRORS = {
  2: 'The video link is not valid.',
  5: 'This video can\u2019t play in the TV player.',
  100: 'This video was removed or made private.',
  101: 'The owner doesn\u2019t allow this video to play outside YouTube.',
  150: 'The owner doesn\u2019t allow this video to play outside YouTube.',
  152: 'YouTube blocked the embed. Staff: host dui.html on GitHub Pages and set Config.DuiUrl.',
  153: 'YouTube blocked the embed. Staff: host dui.html on GitHub Pages and set Config.DuiUrl.',
};

/* ---------- lifecycle ---------- */
function clear() {
  const p = current.player;
  try {
    if (p) {
      if (current.platform === 'youtube' && p.destroy) p.destroy();
      if (current.platform === 'direct') {
        if (current.hls) current.hls.destroy();
        p.pause(); p.removeAttribute('src'); p.load();
      }
    }
  } catch (e) {}
  stage.innerHTML = '';
  current = { id: null, platform: null, player: null, ready: false, live: false };
  showLoading(false);
  hideMessage();
}

async function load(msg) {
  clear();
  const m = msg.media;
  const token = msg.mediaId;
  current.id = token;
  current.platform = m.platform;
  current.live = !!m.live;
  showLoading(true);

  try {
    if (m.platform === 'youtube') {
      await ensureYT();
      if (current.id !== token) return;
      // Build the embed ourselves so YouTube receives a valid referrer/origin
      const frame = document.createElement('iframe');
      frame.id = 'yt';
      frame.allow = 'autoplay; encrypted-media; picture-in-picture';
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
      const params = new URLSearchParams({
        enablejsapi: '1', autoplay: '1', controls: '0', disablekb: '1', fs: '0',
        iv_load_policy: '3', rel: '0', playsinline: '1',
        start: String(Math.floor(msg.offset || 0)),
        origin: location.origin,
        widget_referrer: location.href,
      });
      frame.src = `https://www.youtube.com/embed/${encodeURIComponent(m.id)}?${params}`;
      stage.appendChild(frame);
      current.player = new YT.Player('yt', {
        events: {
          onReady: e => {
            current.ready = true;
            e.target.unMute();
            e.target.setVolume(desired.volume);
            if (desired.paused) e.target.pauseVideo(); else e.target.playVideo();
          },
          onStateChange: e => {
            if (e.data === YT.PlayerState.PLAYING) showLoading(false);
            if (e.data === YT.PlayerState.ENDED) showMessage('Video ended', ENDED_TEXT);
          },
          onError: e => showMessage('Can\u2019t play this video', YT_ERRORS[e.data] || `YouTube error ${e.data}.`),
        },
      });
    }

    else if (m.platform === 'twitch') {
      await ensureTwitch();
      if (current.id !== token) return;
      const host = document.createElement('div');
      host.id = 'tw';
      stage.appendChild(host);
      const opts = {
        width: '100%', height: '100%', parent: [location.hostname],
        autoplay: true, muted: false, controls: false,
      };
      if (m.channel) {
        opts.channel = m.channel;
      } else {
        opts.video = 'v' + m.video;
        opts.time = twitchTime(msg.offset || 0);
        current.vod = true;
      }
      const p = new Twitch.Player('tw', opts);
      current.player = p;
      p.addEventListener(Twitch.Player.READY, () => {
        current.ready = true;
        p.setMuted(desired.volume === 0);
        p.setVolume(desired.volume / 100);
        if (desired.paused) p.pause(); else p.play();
      });
      p.addEventListener(Twitch.Player.PLAYING, () => showLoading(false));
      p.addEventListener(Twitch.Player.OFFLINE, () => showMessage('Channel is offline', `${m.channel} isn\u2019t streaming right now.`));
      p.addEventListener(Twitch.Player.ENDED, () => showMessage('Video ended', ENDED_TEXT));
    }

    else if (m.platform === 'kick') {
      const f = document.createElement('iframe');
      const muted = desired.volume === 0;
      f.allow = 'autoplay; fullscreen';
      f.src = `https://player.kick.com/${encodeURIComponent(m.channel)}?autoplay=true&muted=${muted}`;
      f.onload = () => showLoading(false);
      stage.appendChild(f);
      current.player = f;
      current.ready = true;
      current.kickMuted = muted;
    }

    else if (m.platform === 'direct') {
      const v = document.createElement('video');
      v.playsInline = true;
      v.autoplay = true;
      v.volume = Math.min(1, desired.volume / 100);
      stage.appendChild(v);
      current.player = v;

      const start = () => {
        current.ready = true;
        if (!m.live && msg.offset > 0) { try { v.currentTime = msg.offset; } catch (e) {} }
        if (!desired.paused) v.play().catch(() => {});
      };
      v.addEventListener('playing', () => showLoading(false));
      v.addEventListener('ended', () => showMessage('Video ended', ENDED_TEXT));
      v.addEventListener('error', () => showMessage('Can\u2019t play this video', 'The link could not be loaded. Check that it is a public video file.'));

      if (m.hls && !v.canPlayType('application/vnd.apple.mpegurl')) {
        await ensureHls();
        if (current.id !== token) return;
        const h = new Hls();
        current.hls = h;
        h.loadSource(m.src);
        h.attachMedia(v);
        h.on(Hls.Events.MANIFEST_PARSED, start);
        h.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) showMessage('Stream unavailable', 'The stream could not be loaded.'); });
      } else {
        v.addEventListener('loadedmetadata', start, { once: true });
        v.src = m.src;
      }
    }
  } catch (e) {
    showMessage('Can\u2019t play this link', 'The player failed to load.');
  }
}

/* ---------- controls ---------- */
function setVolume(vol) {
  desired.volume = vol;
  const p = current.player;
  if (!p || !current.ready) return;
  try {
    switch (current.platform) {
      case 'youtube':
        if (vol > 0 && p.isMuted()) p.unMute();
        p.setVolume(vol);
        break;
      case 'twitch':
        p.setMuted(vol === 0);
        p.setVolume(vol / 100);
        break;
      case 'direct':
        p.volume = Math.min(1, vol / 100);
        break;
      case 'kick': {
        // Kick's embed has no volume API, so sound is either on or off
        const mute = vol === 0;
        if (mute !== current.kickMuted) {
          current.kickMuted = mute;
          p.src = p.src.replace(/muted=(true|false)/, 'muted=' + mute);
        }
        break;
      }
    }
  } catch (e) {}
}

function setPaused(paused, offset) {
  desired.paused = paused;
  const p = current.player;
  if (!p || !current.ready) return;
  try {
    switch (current.platform) {
      case 'youtube':
        if (paused) p.pauseVideo();
        else { if (p.getDuration() > 0) p.seekTo(offset, true); p.playVideo(); }
        break;
      case 'twitch':
        if (paused) p.pause(); else p.play();
        break;
      case 'direct':
        if (paused) p.pause();
        else { if (!current.live) p.currentTime = offset; p.play().catch(() => {}); }
        break;
    }
  } catch (e) {}
}

// Keeps every player within a few seconds of each other
function sync(offset) {
  const p = current.player;
  if (!p || !current.ready || desired.paused) return;
  try {
    if (current.platform === 'youtube') {
      const d = p.getDuration();
      if (!d || offset >= d) return; // live stream or already finished
      if (Math.abs(p.getCurrentTime() - offset) > 4) p.seekTo(offset, true);
    } else if (current.platform === 'direct' && !current.live) {
      if (isFinite(p.duration) && offset < p.duration && Math.abs(p.currentTime - offset) > 4) p.currentTime = offset;
    } else if (current.platform === 'twitch' && current.vod) {
      if (Math.abs(p.getCurrentTime() - offset) > 6) p.seek(offset);
    }
  } catch (e) {}
}

window.addEventListener('message', (event) => {
  let msg = event.data;
  if (typeof msg === 'string') { try { msg = JSON.parse(msg); } catch (e) { return; } }
  if (!msg || !msg.type) return;

  if (msg.type === 'state') {
    desired.volume = msg.volume;
    if (msg.mediaId !== current.id) {
      desired.paused = msg.paused;
      load(msg);
    } else {
      if (msg.paused !== desired.paused) setPaused(msg.paused, msg.offset);
      else sync(msg.offset);
      setVolume(msg.volume);
    }
  } else if (msg.type === 'volume') {
    setVolume(msg.volume);
  } else if (msg.type === 'stop') {
    clear();
  }
});
