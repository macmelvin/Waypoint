// Waypoint Lens — camera button in the Search bar. Snap a landmark, sign,
// menu, dish or object and get what it is, a translation of any writing, and
// its history, in the tourist's own language. The AI call happens on our
// server (see /lens.js at the repo root) so the API key never reaches phones.
//
// Loaded after app.js and relies on its globals: I18N, currentLang, t(),
// applyTranslations(), showToast(), escapeHtml().
(function () {
  'use strict';

  const LANG_KEY = 'waypoint_lens_lang';
  const SEEN_KEY = 'waypoint_lens_seen';

  // Dropdown order. Codes must match LANGS in /lens.js on the server.
  const LENS_LANGS = [
    ['en', 'English'], ['zh', '简体中文'], ['zh-TW', '繁體中文'], ['ms', 'Bahasa Melayu'], ['ta', 'தமிழ்'],
    ['ja', '日本語'], ['ko', '한국어'], ['th', 'ไทย'], ['id', 'Bahasa Indonesia'], ['vi', 'Tiếng Việt'],
    ['tl', 'Filipino'], ['hi', 'हिन्दी'], ['ar', 'العربية'], ['fr', 'Français'], ['de', 'Deutsch'],
    ['es', 'Español'], ['it', 'Italiano'], ['pt', 'Português'], ['ru', 'Русский'], ['nl', 'Nederlands'],
  ];
  // Voices for "Listen" (speechSynthesis wants a BCP-47 tag).
  const SPEECH_TAG = {
    en: 'en-SG', zh: 'zh-CN', 'zh-TW': 'zh-TW', ms: 'ms-MY', ta: 'ta-IN', ja: 'ja-JP', ko: 'ko-KR', th: 'th-TH',
    id: 'id-ID', vi: 'vi-VN', tl: 'fil-PH', hi: 'hi-IN', ar: 'ar-SA', fr: 'fr-FR', de: 'de-DE', es: 'es-ES',
    it: 'it-IT', pt: 'pt-PT', ru: 'ru-RU', nl: 'nl-NL',
  };

  const L_I18N = {
    en: {
      lens_btn_title: 'Scan & explain with your camera', lens_looking: 'Looking closely…', lens_translating: 'Explaining in {lang}…',
      lens_explain_in: 'Explain in', lens_listen: '🔊 Listen', lens_stop: '⏹ Stop', lens_show_map: '📍 Show on map',
      lens_scan_again: '📷 Scan another', lens_gallery: '🖼️ From gallery',
      lens_text_found: 'Text in the photo', lens_history: 'History & story', lens_tip: 'Visitor tip',
      lens_best_guess: 'Best guess', lens_ai_note: 'AI-generated — double-check anything important.',
      lens_err_limit: "You've used all your scans for now. Please try again in a while.",
      lens_err_generic: "Couldn't explain that photo. Check your connection and try again.",
      lens_err_image: "Couldn't open that photo. Try another one.",
      lens_new_hint: 'New: tap 📷 in the search bar and point it at anything to learn its story.',
    },
    zh: {
      lens_btn_title: '用相机扫描并讲解', lens_looking: '正在仔细查看…', lens_translating: '正在用{lang}讲解…',
      lens_explain_in: '讲解语言', lens_listen: '🔊 朗读', lens_stop: '⏹ 停止', lens_show_map: '📍 在地图上显示',
      lens_scan_again: '📷 再扫一个', lens_gallery: '🖼️ 从相册选择',
      lens_text_found: '照片中的文字', lens_history: '历史与故事', lens_tip: '游客小贴士',
      lens_best_guess: '推测', lens_ai_note: '由AI生成——重要信息请再核实。',
      lens_err_limit: '您的扫描次数暂时已用完,请稍后再试。',
      lens_err_generic: '无法讲解这张照片。请检查网络后重试。',
      lens_err_image: '无法打开这张照片,请换一张试试。',
      lens_new_hint: '新功能:点击搜索栏里的📷,对准任何东西,了解它的故事。',
    },
    ms: {
      lens_btn_title: 'Imbas & terangkan dengan kamera', lens_looking: 'Sedang meneliti…', lens_translating: 'Menerangkan dalam {lang}…',
      lens_explain_in: 'Terangkan dalam', lens_listen: '🔊 Dengar', lens_stop: '⏹ Henti', lens_show_map: '📍 Tunjuk di peta',
      lens_scan_again: '📷 Imbas lagi', lens_gallery: '🖼️ Dari galeri',
      lens_text_found: 'Teks dalam foto', lens_history: 'Sejarah & kisah', lens_tip: 'Tip pelawat',
      lens_best_guess: 'Tekaan terbaik', lens_ai_note: 'Dijana AI — semak semula maklumat penting.',
      lens_err_limit: 'Anda telah menggunakan semua imbasan buat masa ini. Sila cuba sebentar lagi.',
      lens_err_generic: 'Tidak dapat menerangkan foto itu. Semak sambungan dan cuba lagi.',
      lens_err_image: 'Tidak dapat membuka foto itu. Cuba foto lain.',
      lens_new_hint: 'Baharu: ketik 📷 di bar carian dan halakan pada apa sahaja untuk mengetahui kisahnya.',
    },
    ta: {
      lens_btn_title: 'கேமராவால் ஸ்கேன் செய்து விளக்கு', lens_looking: 'கவனமாகப் பார்க்கிறது…', lens_translating: '{lang}-இல் விளக்குகிறது…',
      lens_explain_in: 'விளக்க மொழி', lens_listen: '🔊 கேள்', lens_stop: '⏹ நிறுத்து', lens_show_map: '📍 வரைபடத்தில் காட்டு',
      lens_scan_again: '📷 இன்னொன்றை ஸ்கேன் செய்', lens_gallery: '🖼️ கேலரியிலிருந்து',
      lens_text_found: 'புகைப்படத்தில் உள்ள உரை', lens_history: 'வரலாறு & கதை', lens_tip: 'பார்வையாளர் குறிப்பு',
      lens_best_guess: 'சிறந்த ஊகம்', lens_ai_note: 'AI உருவாக்கியது — முக்கியமானவற்றை மீண்டும் சரிபார்க்கவும்.',
      lens_err_limit: 'இப்போதைக்கு உங்கள் ஸ்கேன்கள் முடிந்துவிட்டன. சிறிது நேரம் கழித்து முயற்சிக்கவும்.',
      lens_err_generic: 'அந்தப் புகைப்படத்தை விளக்க முடியவில்லை. இணைப்பைச் சரிபார்த்து மீண்டும் முயற்சிக்கவும்.',
      lens_err_image: 'அந்தப் புகைப்படத்தைத் திறக்க முடியவில்லை. வேறொன்றை முயற்சிக்கவும்.',
      lens_new_hint: 'புதியது: தேடல் பட்டியில் 📷 ஐத் தட்டி, எதையும் நோக்கி அதன் கதையை அறியுங்கள்.',
    },
    ja: {
      lens_btn_title: 'カメラで撮って解説', lens_looking: 'よく見ています…', lens_translating: '{lang}で解説中…',
      lens_explain_in: '解説の言語', lens_listen: '🔊 読み上げ', lens_stop: '⏹ 停止', lens_show_map: '📍 地図で表示',
      lens_scan_again: '📷 もう一枚', lens_gallery: '🖼️ 写真から選ぶ',
      lens_text_found: '写真の中の文字', lens_history: '歴史とストーリー', lens_tip: '観光のヒント',
      lens_best_guess: '推測', lens_ai_note: 'AIによる生成です。重要な情報はご確認ください。',
      lens_err_limit: '現在スキャン回数の上限に達しました。しばらくしてからお試しください。',
      lens_err_generic: '写真を解説できませんでした。接続を確認して再度お試しください。',
      lens_err_image: 'その写真を開けませんでした。別の写真でお試しください。',
      lens_new_hint: '新機能:検索バーの📷をタップして、気になるものに向けるとストーリーがわかります。',
    },
    ko: {
      lens_btn_title: '카메라로 찍고 설명 듣기', lens_looking: '자세히 보는 중…', lens_translating: '{lang}(으)로 설명하는 중…',
      lens_explain_in: '설명 언어', lens_listen: '🔊 듣기', lens_stop: '⏹ 멈춤', lens_show_map: '📍 지도에서 보기',
      lens_scan_again: '📷 하나 더 찍기', lens_gallery: '🖼️ 앨범에서 선택',
      lens_text_found: '사진 속 글자', lens_history: '역사와 이야기', lens_tip: '여행 팁',
      lens_best_guess: '추정', lens_ai_note: 'AI가 생성한 내용입니다. 중요한 정보는 다시 확인하세요.',
      lens_err_limit: '지금은 스캔 횟수를 모두 사용했어요. 잠시 후 다시 시도하세요.',
      lens_err_generic: '사진을 설명하지 못했어요. 연결을 확인하고 다시 시도하세요.',
      lens_err_image: '사진을 열 수 없어요. 다른 사진으로 시도하세요.',
      lens_new_hint: '새 기능: 검색창의 📷을 눌러 무엇이든 비추면 그 이야기를 알려드려요.',
    },
  };
  Object.keys(L_I18N).forEach((lang) => { I18N[lang] = Object.assign(I18N[lang] || {}, L_I18N[lang]); });
  applyTranslations();

  const tf = (key, vars) => Object.keys(vars || {}).reduce((s, k) => s.split(`{${k}}`).join(vars[k]), t(key));
  const $ = (id) => document.getElementById(id);
  const el = {
    btn: $('lensBtn'), camera: $('lensCamera'), gallery: $('lensGallery'), modal: $('lensModal'), close: $('lensClose'),
    photo: $('lensPhoto'), title: $('lensTitle'), local: $('lensLocal'), body: $('lensBody'), lang: $('lensLang'),
    speak: $('lensSpeak'), map: $('lensMap'), again: $('lensAgain'), fromGallery: $('lensFromGallery'),
    searchBox: document.querySelector('#panel-search .search-box'), searchInput: $('searchInput'),
  };
  if (!el.btn || !el.modal) return;

  let lastImage = null;   // base64 JPEG of the current photo, reused when switching language
  let lastResult = null;
  let requestSeq = 0;

  // ---------- Language ----------
  function defaultLang() {
    try { const saved = localStorage.getItem(LANG_KEY); if (saved && LENS_LANGS.some(([c]) => c === saved)) return saved; } catch (e) { /* ignore */ }
    const app = typeof currentLang === 'string' ? currentLang : 'en';
    if (LENS_LANGS.some(([c]) => c === app)) return app;
    const nav = (navigator.language || 'en').toLowerCase();
    if (nav.startsWith('zh-tw') || nav.startsWith('zh-hk')) return 'zh-TW';
    const hit = LENS_LANGS.find(([c]) => nav.startsWith(c.toLowerCase()));
    return hit ? hit[0] : 'en';
  }
  el.lang.innerHTML = LENS_LANGS.map(([c, n]) => `<option value="${c}">${escapeHtml(n)}</option>`).join('');
  el.lang.value = defaultLang();

  // ---------- Enable only when the server has an API key ----------
  fetch('/api/lens/status').then((r) => (r.ok ? r.json() : null)).then((s) => {
    if (!s || !s.enabled) return;
    el.btn.classList.remove('hidden');
    el.searchBox.classList.add('has-lens');
    let seen = false;
    try { seen = !!localStorage.getItem(SEEN_KEY); } catch (e) { /* ignore */ }
    if (!seen) {
      el.btn.classList.add('is-new');
      setTimeout(() => showToast(t('lens_new_hint'), 5000), 2500);
    }
  }).catch(() => { /* offline — keep hidden */ });

  function markSeen() {
    el.btn.classList.remove('is-new');
    try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) { /* ignore */ }
  }

  el.btn.addEventListener('click', () => { markSeen(); el.camera.click(); });
  el.again.addEventListener('click', () => el.camera.click());
  el.fromGallery.addEventListener('click', () => el.gallery.click());
  [el.camera, el.gallery].forEach((input) => input.addEventListener('change', () => {
    const f = input.files && input.files[0];
    input.value = '';
    if (f) handlePhoto(f);
  }));

  // ---------- Photo → small JPEG ----------
  function toJpegBase64(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const MAX = 1024;
        const scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * scale);
        c.height = Math.round(img.naturalHeight * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        const dataUrl = c.toDataURL('image/jpeg', 0.82);
        resolve({ dataUrl, base64: dataUrl.split(',')[1] });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')); };
      img.src = url;
    });
  }

  // ---------- Sheet ----------
  function openSheet() {
    el.modal.classList.remove('hidden');
    document.body.classList.add('lens-open');
  }
  function closeSheet() {
    stopSpeaking();
    el.modal.classList.add('hidden');
    document.body.classList.remove('lens-open');
    requestSeq++; // ignore any answer still on its way
  }
  el.close.addEventListener('click', closeSheet);
  el.modal.addEventListener('click', (e) => { if (e.target === el.modal) closeSheet(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !el.modal.classList.contains('hidden')) closeSheet(); });

  function showLoading(msg) {
    stopSpeaking();
    el.title.textContent = msg;
    el.local.textContent = '';
    el.body.innerHTML = '<div class="lens-skeleton"><span></span><span></span><span></span><span></span></div>';
    el.map.classList.add('hidden');
    el.speak.disabled = true;
    el.modal.classList.add('loading');
  }

  function showError(msg) {
    el.modal.classList.remove('loading');
    el.title.textContent = '😕';
    el.body.innerHTML = `<p class="lens-error">${escapeHtml(msg)}</p>`;
    el.speak.disabled = true;
  }

  async function handlePhoto(file) {
    let img;
    try { img = await toJpegBase64(file); } catch (e) { showToast(t('lens_err_image')); return; }
    lastImage = img.base64;
    el.photo.src = img.dataUrl;
    openSheet();
    explain(t('lens_looking'));
  }

  async function explain(loadingMsg) {
    if (!lastImage) return;
    const seq = ++requestSeq;
    const lang = el.lang.value;
    showLoading(loadingMsg);
    try {
      const res = await fetch('/api/lens/explain', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image: lastImage, lang }),
      });
      const data = await res.json().catch(() => ({}));
      if (seq !== requestSeq) return;
      if (res.status === 429) return showError(t('lens_err_limit'));
      if (!res.ok || !data.result) return showError(t('lens_err_generic'));
      lastResult = data.result;
      render(data.result, lang);
    } catch (err) {
      if (seq === requestSeq) showError(t('lens_err_generic'));
    }
  }

  function paragraphs(text) {
    return String(text || '').split(/\n\s*\n|\n/).map((p) => p.trim()).filter(Boolean)
      .map((p) => `<p>${escapeHtml(p)}</p>`).join('');
  }

  function render(r, lang) {
    el.modal.classList.remove('loading');
    const rtl = lang === 'ar';
    el.body.dir = rtl ? 'rtl' : 'ltr';
    el.title.dir = rtl ? 'rtl' : 'ltr';
    el.title.textContent = r.name || '—';
    el.local.textContent = r.name_local && r.name_local !== r.name ? r.name_local : '';

    const parts = [];
    if (r.confidence === 'low' || r.identified === false) parts.push(`<span class="lens-badge">${escapeHtml(t('lens_best_guess'))}</span>`);
    if (r.summary) parts.push(`<p class="lens-summary">${escapeHtml(r.summary)}</p>`);
    if (Array.isArray(r.text_found) && r.text_found.length) {
      parts.push(`<h3>${escapeHtml(t('lens_text_found'))}</h3><div class="lens-texts">${r.text_found.map((x) => `
        <div class="lens-text-row"><div class="lens-orig">${escapeHtml(x.original)}</div><div class="lens-trans">${escapeHtml(x.translation)}</div></div>`).join('')}</div>`);
    }
    if (r.history) parts.push(`<h3>${escapeHtml(t('lens_history'))}</h3>${paragraphs(r.history)}`);
    if (r.tip) parts.push(`<div class="lens-tip"><strong>💡 ${escapeHtml(t('lens_tip'))}</strong> ${escapeHtml(r.tip)}</div>`);
    parts.push(`<p class="lens-note">${escapeHtml(t('lens_ai_note'))}</p>`);
    el.body.innerHTML = parts.join('');
    el.body.scrollTop = 0;

    el.map.classList.toggle('hidden', !r.map_query);
    el.speak.disabled = !('speechSynthesis' in window);
  }

  // ---------- Language switch → re-explain the same photo ----------
  el.lang.addEventListener('change', () => {
    try { localStorage.setItem(LANG_KEY, el.lang.value); } catch (e) { /* ignore */ }
    const name = (LENS_LANGS.find(([c]) => c === el.lang.value) || [])[1] || '';
    if (lastImage && !el.modal.classList.contains('hidden')) explain(tf('lens_translating', { lang: name }));
  });

  // ---------- Listen ----------
  let speaking = false;
  function stopSpeaking() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    speaking = false;
    el.speak.textContent = t('lens_listen');
  }
  el.speak.addEventListener('click', () => {
    if (!('speechSynthesis' in window) || !lastResult) return;
    if (speaking) { stopSpeaking(); return; }
    const r = lastResult;
    const text = [r.name, r.summary, r.history, r.tip].filter(Boolean).join('. \n');
    const u = new SpeechSynthesisUtterance(text);
    const tag = SPEECH_TAG[el.lang.value] || 'en-SG';
    u.lang = tag;
    const voice = window.speechSynthesis.getVoices().find((v) => v.lang && v.lang.toLowerCase().startsWith(tag.slice(0, 2).toLowerCase()));
    if (voice) u.voice = voice;
    u.onend = u.onerror = () => { speaking = false; el.speak.textContent = t('lens_listen'); };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    speaking = true;
    el.speak.textContent = t('lens_stop');
  });

  // ---------- Show on map → run a normal Waypoint search ----------
  el.map.addEventListener('click', () => {
    if (!lastResult || !lastResult.map_query) return;
    closeSheet();
    const tab = document.querySelector('.tab-btn[data-tab="search"]');
    if (tab) tab.click();
    el.searchInput.value = lastResult.map_query;
    el.searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    el.searchInput.focus();
  });

  // Re-label buttons when the app language cycles.
  const langBtn = document.getElementById('langBtn');
  if (langBtn) langBtn.addEventListener('click', () => { if (!speaking) el.speak.textContent = t('lens_listen'); el.btn.title = t('lens_btn_title'); });
  el.btn.title = t('lens_btn_title');
})();
