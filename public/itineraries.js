// Waypoint — Itineraries
//
// Ready-made multi-day trip plans. Unlike every other feature in this file,
// there's no user input and nothing is computed — this is just curated
// content, structured so a day's stop can jump straight into the SAME live
// landmark card every other part of the app uses (selectSearchResult), not a
// separate read-only write-up. Tapping a stop gets you real transit info,
// opening hours and nearby food, exactly as if you'd searched for that place
// yourself.
//
// Loaded after app.js and relies on its globals: LANDMARKS,
// selectSearchResult(), switchToSearchTab(), I18N, currentLang, t(),
// applyTranslations(), escapeHtml().
//
// The 3- and 5-day lengths are the same trip as the 7-day one, just cut
// short -- SG_7_DAY is written in priority order (Marina Bay first, then
// Sentosa, then the river/heritage day, ...), so a shorter visit gets
// that same ordered list sliced to however many days they have, rather
// than a separately-curated set that could drift out of sync with it.
// renderStops() still has a "coming soon" fallback for an empty days
// array, kept as defensive insurance for any future length added before
// its content is ready, but nothing currently exercises that path.
(function () {
  'use strict';

  const STORAGE_KEY = 'waypoint_itineraries';

  // ---------- Translations (UI chrome only — matches the rest of the app's
  // convention of translating section labels/intros but not individual
  // card copy, e.g. Guided Walk/Must-Eats card text is English-only too) ----
  const IT_I18N = {
    en: {
      tab_itineraries: 'Itineraries',
      it_intro: "Pick a trip length, then tap any stop to open it right inside Waypoint — the same live transit directions, hours and nearby food you'd get from searching for it yourself.",
      it_day_label: 'Day {n}',
      it_coming_soon: 'The {n}-day plan is on its way — try the 7-day Singapore itinerary in the meantime.',
    },
    zh: {
      tab_itineraries: '行程',
      it_intro: '选择行程天数,然后点击任意一站,直接在Waypoint内打开——和你自己搜索该地点一样,有实时交通路线、开放时间和附近美食。',
      it_day_label: '第{n}天',
      it_coming_soon: '{n}天行程即将上线——目前可以先试试7天新加坡行程。',
    },
    ms: {
      tab_itineraries: 'Itinerari',
      it_intro: 'Pilih tempoh percutian anda, kemudian ketik mana-mana destinasi untuk membukanya terus dalam Waypoint — maklumat transit, waktu operasi dan makanan berdekatan sama seperti jika anda mencarinya sendiri.',
      it_day_label: 'Hari {n}',
      it_coming_soon: 'Pelan {n} hari akan tersedia tidak lama lagi — cuba itinerari 7 hari Singapura buat masa ini.',
    },
    ta: {
      tab_itineraries: 'பயணத் திட்டம்',
      it_intro: 'பயண நாட்களைத் தேர்ந்தெடுத்து, பின் எந்த இடத்தையும் தட்டி Waypoint-ல் நேரடியாகத் திறக்கவும் — நீங்களே தேடியது போலவே நேரடி போக்குவரத்து விவரங்கள், நேரம் மற்றும் அருகிலுள்ள உணவகங்கள் கிடைக்கும்.',
      it_day_label: 'நாள் {n}',
      it_coming_soon: '{n} நாள் திட்டம் விரைவில் வரும் — இதற்கிடையில் 7 நாள் சிங்கப்பூர் பயணத்திட்டத்தை முயற்சிக்கவும்.',
    },
    ja: {
      tab_itineraries: '旅程',
      it_intro: '旅行日数を選んで、気になるスポットをタップすると、Waypoint内でそのまま開きます——自分で検索したときと同じように、リアルタイムの交通案内、営業時間、近くの食事情報が表示されます。',
      it_day_label: '{n}日目',
      it_coming_soon: '{n}日間のプランは近日公開予定です。その間は7日間のシンガポール旅程をお試しください。',
    },
    ko: {
      tab_itineraries: '일정',
      it_intro: '여행 기간을 선택한 후 원하는 장소를 탭하면 Waypoint 안에서 바로 열립니다. 직접 검색했을 때와 동일하게 실시간 교통 정보, 운영시간, 주변 맛집을 확인할 수 있어요.',
      it_day_label: '{n}일차',
      it_coming_soon: '{n}일 플랜은 곧 제공될 예정입니다. 그동안 7일 싱가포르 일정을 이용해 보세요.',
    },
  };
  Object.keys(IT_I18N).forEach((lang) => {
    if (!I18N[lang]) I18N[lang] = {};
    Object.assign(I18N[lang], IT_I18N[lang]);
  });
  applyTranslations();

  function tf(key, vars) {
    let s = t(key);
    Object.keys(vars || {}).forEach((k) => { s = s.split(`{${k}}`).join(vars[k]); });
    return s;
  }

  // ---------- Photos — reuses images already shipped for other features
  // (Guided Walk / More Places / Tix & Tours) rather than adding new ones,
  // per landmarkKey -> path under /images. A key with no entry here falls
  // back to the stop's own `emoji` in the card instead of a broken <img>.
  const PHOTO_MAP = {
    civicdistrict: 'guidedwalk/civicdistrict.jpg',
    chinatown: 'guidedwalk/chinatown.jpg',
    littleindia: 'guidedwalk/littleindia.jpg',
    kampongglam: 'guidedwalk/kampongglam.jpg',
    fortcanning: 'guidedwalk/fortcanning.jpg',
    hawparvilla: 'guidedwalk/hawparvilla.jpg',
    pulauubin: 'guidedwalk/pulauubin.jpg',
    merlionpark: 'places/merlionpark.jpg',
    artsciencemuseum: 'places/artsciencemuseum.jpg',
    sentosa: 'places/sentosa.jpg',
    clarkequay: 'places/clarkequay.jpg',
    esplanade: 'places/esplanade.jpg',
    eastcoastpark: 'places/eastcoastpark.jpg',
    jewelchangi: 'places/jewelchangi.jpg',
    macritchietreetop: 'places/macritchietreetop.jpg',
    mbs: 'tickets/mbs.jpg',
    gardensbythebay: 'tickets/gardensbythebay.jpg',
    uss: 'tickets/uss.jpg',
    seaaquarium: 'tickets/seaaquarium.jpg',
    sgzoo: 'tickets/sgzoo.jpg',
    riverwonders: 'tickets/riverwonders.jpg',
    nightsafari: 'tickets/nightsafari.jpg',
  };

  // ---------- Trip plan content ----------
  // Each stop's `key` must be a real LANDMARKS key -- the display name
  // always comes from LANDMARKS[key].label at render time (never duplicated
  // here), so if a landmark is ever renamed this stays in sync automatically.
  // `time`/`note`/`emoji` are this feature's own curated copy.
  const SG_7_DAY = [
    {
      title: 'Marina Bay & Civic District',
      summary: "Singapore's most famous skyline, almost entirely on foot.",
      stops: [
        { key: 'civicdistrict', time: 'Morning', emoji: '🏛️', note: "Singapore's old colonial core along the river — the Arts House, Old Parliament and the Padang are all a few minutes' walk apart." },
        { key: 'merlionpark', time: 'Late morning', emoji: '🦁', note: 'The classic lion-fish statue, with Marina Bay Sands filling the skyline right behind it — the most-photographed spot in the country.' },
        { key: 'mbs', time: 'Midday', emoji: '🏙️', note: "Marina Bay Sands' towers and rooftop SkyPark anchor the whole bay — browse The Shoppes below, or ride up for the view." },
        { key: 'artsciencemuseum', time: 'Afternoon', emoji: '🔮', note: 'The lotus-shaped museum next door runs rotating digital-art and science exhibitions — a good air-conditioned break from the heat.' },
        { key: 'gardensbythebay', time: 'Evening', emoji: '🌳', note: 'Catch the free Supertree Grove light show after dark, then walk the Cloud Forest or OCBC Skyway if there is still energy left.' },
      ],
    },
    {
      title: 'Sentosa Island',
      summary: "A full day on Singapore's resort island, just across the strait.",
      stops: [
        { key: 'sentosa', time: 'Morning', emoji: '🏖️', note: 'Cross over by cable car, the Sentosa Express monorail, or on foot via the boardwalk from VivoCity — all under 15 minutes.' },
        { key: 'uss', time: 'Day', emoji: '🎢', note: 'Universal Studios Singapore packs 24 rides across 7 themed zones — book the big-name rides online ahead to skip the queue.' },
        { key: 'seaaquarium', time: 'Afternoon', emoji: '🐠', note: "One of the world's largest aquariums, inside Resorts World — the Open Ocean habitat tank alone holds 18 million litres." },
      ],
    },
    {
      title: 'Chinatown & the River',
      summary: 'Heritage shophouses by day, riverside nightlife after dark.',
      stops: [
        { key: 'chinatown', time: 'Morning', emoji: '🏮', note: 'Wander the shophouse streets around Pagoda Street and Ann Siang Hill, then step inside the Buddha Tooth Relic Temple.' },
        { key: 'maxwellfood', time: 'Midday', emoji: '🍜', note: "One of Singapore's best-known hawker centres for lunch — Tian Tian's chicken rice is the stall everyone queues for." },
        { key: 'clarkequay', time: 'Evening', emoji: '🌉', note: 'Restored riverside godowns, now bars and restaurants — also where the Singapore River cruise boats depart from.' },
        { key: 'esplanade', time: 'Night', emoji: '🎭', note: 'The durian-shaped performing arts centre is a short riverside walk away, with a free rooftop deck looking back over the bay.' },
      ],
    },
    {
      title: 'Little India, Kampong Glam & Fort Canning',
      summary: "Two of Singapore's most colourful ethnic quarters, plus a quiet hilltop park.",
      stops: [
        { key: 'littleindia', time: 'Morning', emoji: '🌺', note: 'Spice shops, garland stalls and the gold-topped Sri Veeramakaliamman Temple make this the most sensory stop on the trip.' },
        { key: 'kampongglam', time: 'Midday', emoji: '🕌', note: "Home to the golden-domed Sultan Mosque and Haji Lane's narrow strip of indie boutiques and cafés." },
        { key: 'fortcanning', time: 'Afternoon', emoji: '🌳', note: 'A green hilltop park with the old Fort Canning Centre, and the underground WWII-era Battle Box tucked beneath it.' },
      ],
    },
    {
      title: 'Mandai Wildlife Reserve',
      summary: 'Singapore Zoo, River Wonders and Night Safari all sit in the same forested precinct — an easy full day into the evening.',
      stops: [
        { key: 'sgzoo', time: 'Morning', emoji: '🐘', note: "One of the world's best-rated zoos, with an open-concept layout — most enclosures have no visible bars or cages." },
        { key: 'riverwonders', time: 'Afternoon', emoji: '🐼', note: 'Asia\'s only river-themed wildlife park, home to the giant pandas Kai Kai and Jia Jia.' },
        { key: 'nightsafari', time: 'Evening', emoji: '🌙', note: 'The world\'s first nocturnal wildlife park — walk the trails or ride the tram as the animals come alive after dark.' },
      ],
    },
    {
      title: 'East Coast & Pulau Ubin',
      summary: "Singapore's laid-back seafront, then a step back in time by boat to Pulau Ubin.",
      stops: [
        { key: 'pulauubin', time: 'Morning', emoji: '⛴️', note: 'A bumboat from Changi Point Ferry Terminal gets you to this rustic island in about 15 minutes — rent a bike for Chek Jawa Wetlands.' },
        { key: 'eastcoastpark', time: 'Afternoon', emoji: '🚴', note: 'A long seafront park for cycling, skating or just a walk — rental kiosks are dotted along the way.' },
        { key: 'jewelchangi', time: 'Evening', emoji: '💧', note: "The world's tallest indoor waterfall sits inside Changi Airport's Jewel complex — easy to combine with a flight, or visit on its own." },
      ],
    },
    {
      title: 'Nature Trails & Local Flavours',
      summary: 'A quieter closing day: forest trails in the morning, quirky sights and food to finish.',
      stops: [
        { key: 'macritchietreetop', time: 'Morning', emoji: '🌲', note: 'A forest hike out to a suspension bridge strung between two of the reservoir\'s tallest treetops — go early to beat the heat.' },
        { key: 'hawparvilla', time: 'Midday', emoji: '🗿', note: 'A free, surreal 1937 theme park of statues depicting Chinese mythology and folklore — including the famously gruesome Ten Courts of Hell.' },
        { key: 'chinatownfoodcentre', time: 'Evening', emoji: '🍲', note: 'Finish with dinner at this no-frills hawker centre — it holds more Michelin-recognised stalls than almost anywhere else in Singapore.' },
      ],
    },
  ];

  const TRIP_PLANS = {
    3: { days: SG_7_DAY.slice(0, 3) },
    5: { days: SG_7_DAY.slice(0, 5) },
    7: { days: SG_7_DAY },
  };
  const LENGTHS = [3, 5, 7];

  // ---------- State (just remembers where the person left off) ----------
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (s && LENGTHS.includes(s.length)) return { length: s.length, dayByLength: s.dayByLength || {} };
    } catch (err) { /* ignore — fall back to defaults */ }
    return { length: 7, dayByLength: {} };
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (err) { /* private mode — keep in memory */ }
  }
  let state = load();

  function currentDayIndex() {
    const plan = TRIP_PLANS[state.length];
    const stored = state.dayByLength[state.length] || 0;
    return plan.days.length ? Math.min(stored, plan.days.length - 1) : 0;
  }

  // ---------- Elements ----------
  const $ = (id) => document.getElementById(id);
  const el = {
    lengthBtns: document.querySelectorAll('#panel-itineraries .tp-seg-btn'),
    dayTabs: $('tpDayTabs'),
    stops: $('tpStops'),
  };
  if (!el.dayTabs || !el.stops) return; // markup not present

  // ---------- Rendering ----------
  function renderLengthBtns() {
    el.lengthBtns.forEach((b) => b.classList.toggle('active', Number(b.dataset.length) === state.length));
  }

  function renderDayTabs() {
    const plan = TRIP_PLANS[state.length];
    if (!plan.days.length) { el.dayTabs.innerHTML = ''; return; }
    const activeIdx = currentDayIndex();
    el.dayTabs.innerHTML = plan.days.map((d, i) => `
      <button type="button" class="tp-day-tab${i === activeIdx ? ' active' : ''}" data-day="${i}">${escapeHtml(tf('it_day_label', { n: i + 1 }))}</button>
    `).join('');
  }

  function stopPhoto(key) {
    const path = PHOTO_MAP[key];
    return path ? `/images/${path}` : null;
  }

  function renderStops() {
    const plan = TRIP_PLANS[state.length];
    if (!plan.days.length) {
      el.stops.innerHTML = `<p class="tp-coming-soon">${escapeHtml(tf('it_coming_soon', { n: state.length }))}</p>`;
      return;
    }
    const day = plan.days[currentDayIndex()];
    const stopsHtml = day.stops.map((s) => {
      const landmark = LANDMARKS[s.key];
      const name = landmark ? landmark.label : s.key; // defensive — should never happen
      const photo = stopPhoto(s.key);
      const photoHtml = photo
        ? `<img class="tp-stop-photo" src="${escapeHtml(photo)}" alt="${escapeHtml(name)}" />`
        : `<span class="tp-stop-photo-fallback" aria-hidden="true">${s.emoji || '📍'}</span>`;
      return `
        <div class="tp-stop" data-landmark="${escapeHtml(s.key)}">
          ${photoHtml}
          <div class="tp-stop-text">
            <div class="tp-stop-time">${escapeHtml(s.time)}</div>
            <div class="tp-stop-name">${escapeHtml(name)}</div>
            <div class="tp-stop-note">${escapeHtml(s.note)}</div>
          </div>
          <button type="button" class="tp-stop-explore" data-explore="${escapeHtml(s.key)}">🧭 Explore</button>
        </div>`;
    }).join('');
    el.stops.innerHTML = `
      <div class="tp-day-title">${escapeHtml(day.title)}</div>
      <p class="tp-day-summary">${escapeHtml(day.summary)}</p>
      ${stopsHtml}`;
    addPhotoRetryOnError('.tp-stop-photo');
  }

  function renderAll() {
    renderLengthBtns();
    renderDayTabs();
    renderStops();
  }

  // ---------- Events ----------
  el.lengthBtns.forEach((b) => b.addEventListener('click', () => {
    const length = Number(b.dataset.length);
    if (!LENGTHS.includes(length) || length === state.length) return;
    state.length = length;
    save();
    renderAll();
  }));

  el.dayTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-day]');
    if (!btn) return;
    state.dayByLength[state.length] = Number(btn.dataset.day);
    save();
    renderDayTabs();
    renderStops();
  });

  el.stops.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-explore]');
    if (!btn) return;
    const key = btn.dataset.explore;
    if (!LANDMARKS[key]) return;
    switchToSearchTab();
    selectSearchResult(LANDMARKS[key]);
  });

  // Re-render when the language cycles (app.js's own listener has already
  // updated currentLang + static labels by then) — only the UI chrome
  // (intro, day labels, coming-soon text) actually changes; stop content
  // stays English either way, same as Guided Walk/Must-Eats.
  const langBtn = document.getElementById('langBtn');
  if (langBtn) langBtn.addEventListener('click', () => renderAll());

  // Called by app.js's tab-switch handler when this tab is opened. Nothing
  // async to kick off (unlike Split Bill's currency detection) — just make
  // sure what's showing reflects the last-used length/day.
  function onTabOpen() { renderAll(); }

  renderAll();

  window.WaypointItineraries = { onTabOpen, TRIP_PLANS };
})();
