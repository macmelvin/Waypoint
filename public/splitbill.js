// Waypoint — Split Bill
//
// Works out who owes whom after a group meal or shared expense. Runs entirely
// on the device: nothing is sent to the server, and the bill is kept in
// localStorage (same pattern as every other Waypoint preference) so it
// survives closing the app mid-dinner.
//
// Loaded after app.js and relies on its globals: I18N, currentLang, t(),
// applyTranslations(), showToast(), escapeHtml().
//
// All money is handled in integer cents so rounding never makes the shares
// add up to a different total than what was actually paid.
(function () {
  'use strict';

  const STORAGE_KEY = 'waypoint_splitbill';
  const SVC_RATE = 0.10; // typical SG restaurant service charge
  const GST_RATE = 0.09; // SG GST since 1 Jan 2024; charged on subtotal + service

  // ---------- Translations ----------
  const SB_I18N = {
    en: {
      tab_splitbill: '💸 Split Bill',
      sb_intro: "Add who's in the group and what was paid. Waypoint works out who owes whom — with the fewest transfers — so nobody has to do awkward maths at the table.",
      sb_people: 'People', sb_add_person_ph: 'Add a name, e.g. Wei Ling', sb_add: 'Add',
      sb_expenses: 'Expenses', sb_add_expense: '➕ Add an expense',
      sb_desc_ph: 'What was it? e.g. Dinner at Lau Pa Sat', sb_paid_by: 'Paid by',
      sb_svc: '+10% service', sb_gst: '+9% GST',
      sb_split_equal: 'Split equally', sb_split_exact: 'By what each had',
      sb_save: 'Save expense', sb_settle: 'Settle up', sb_share: '📤 Send to the group', sb_new_bill: 'Start a new bill',
      sb_no_people: 'Add at least 2 people to get started.',
      sb_no_expenses: 'No expenses yet.',
      sb_split_n: 'split {n} ways', sb_split_custom: 'split by items',
      sb_paid: 'paid', sb_share_word: 'share',
      sb_gets_back: 'gets back {amt}', sb_owes: 'owes {amt}', sb_even: 'all square',
      sb_pays: 'pays', sb_mark_paid: 'Mark paid', sb_paid_done: 'Paid ✓',
      sb_all_settled: "Everyone's square 🎉", sb_total: 'Total',
      sb_exact_hint: "Enter what each person had, before service & GST — they're added on proportionally.",
      sb_equal_hint: '{amt} each',
      sb_pick_someone: 'Pick at least one person to split with.',
      sb_enter_amount: 'Enter an amount first.',
      sb_person_in_use: '{name} is in an expense — edit that expense first.',
      sb_dup_name: 'That name is already in the group.',
      sb_confirm_reset: 'Tap again to clear this bill',
      sb_copied: 'Summary copied — paste it in your group chat',
      sb_default_desc: 'Expense', sb_share_title: 'Bill split', sb_via: 'Split with Waypoint',
      sb_left: '{amt} left to settle',
    },
    zh: {
      tab_splitbill: '💸 分账',
      sb_intro: '添加同行的人和各自付了什么。Waypoint会用最少的转账次数算出谁该给谁多少钱,饭桌上不用再尴尬地算账。',
      sb_people: '成员', sb_add_person_ph: '输入名字,例如 Wei Ling', sb_add: '添加',
      sb_expenses: '费用', sb_add_expense: '➕ 添加一笔费用',
      sb_desc_ph: '什么费用?例如 老巴刹晚餐', sb_paid_by: '付款人',
      sb_svc: '+10% 服务费', sb_gst: '+9% 消费税',
      sb_split_equal: '平均分摊', sb_split_exact: '按各自点的',
      sb_save: '保存', sb_settle: '结算', sb_share: '📤 发送到群组', sb_new_bill: '开始新账单',
      sb_no_people: '至少添加2个人才能开始。',
      sb_no_expenses: '还没有费用。',
      sb_split_n: '{n}人分摊', sb_split_custom: '按项目分摊',
      sb_paid: '已付', sb_share_word: '应付',
      sb_gets_back: '应收回 {amt}', sb_owes: '应付 {amt}', sb_even: '已两清',
      sb_pays: '付给', sb_mark_paid: '标记已付', sb_paid_done: '已付 ✓',
      sb_all_settled: '大家已两清 🎉', sb_total: '总计',
      sb_exact_hint: '输入每人点的金额(未含服务费和消费税),系统会按比例加上。',
      sb_equal_hint: '每人 {amt}',
      sb_pick_someone: '请至少选择一人分摊。',
      sb_enter_amount: '请先输入金额。',
      sb_person_in_use: '{name} 在某笔费用中——请先修改那笔费用。',
      sb_dup_name: '这个名字已经在群组里了。',
      sb_confirm_reset: '再点一次以清空账单',
      sb_copied: '已复制摘要——粘贴到群聊即可',
      sb_default_desc: '费用', sb_share_title: '分账', sb_via: '由 Waypoint 分账',
      sb_left: '还剩 {amt} 待结清',
    },
    ms: {
      tab_splitbill: '💸 Bahagi Bil',
      sb_intro: 'Tambah siapa dalam kumpulan dan apa yang dibayar. Waypoint kira siapa berhutang kepada siapa — dengan pindahan paling sedikit — jadi tiada kira-kira janggal di meja.',
      sb_people: 'Orang', sb_add_person_ph: 'Tambah nama, cth. Wei Ling', sb_add: 'Tambah',
      sb_expenses: 'Perbelanjaan', sb_add_expense: '➕ Tambah perbelanjaan',
      sb_desc_ph: 'Untuk apa? cth. Makan malam di Lau Pa Sat', sb_paid_by: 'Dibayar oleh',
      sb_svc: '+10% caj servis', sb_gst: '+9% GST',
      sb_split_equal: 'Bahagi sama rata', sb_split_exact: 'Ikut apa dimakan',
      sb_save: 'Simpan', sb_settle: 'Selesaikan', sb_share: '📤 Hantar ke kumpulan', sb_new_bill: 'Mula bil baharu',
      sb_no_people: 'Tambah sekurang-kurangnya 2 orang untuk bermula.',
      sb_no_expenses: 'Belum ada perbelanjaan.',
      sb_split_n: 'dibahagi {n} orang', sb_split_custom: 'dibahagi ikut item',
      sb_paid: 'bayar', sb_share_word: 'bahagian',
      sb_gets_back: 'dapat balik {amt}', sb_owes: 'berhutang {amt}', sb_even: 'sudah langsai',
      sb_pays: 'bayar', sb_mark_paid: 'Tanda dibayar', sb_paid_done: 'Dibayar ✓',
      sb_all_settled: 'Semua sudah langsai 🎉', sb_total: 'Jumlah',
      sb_exact_hint: 'Masukkan apa setiap orang makan, sebelum caj servis & GST — ia ditambah secara berkadar.',
      sb_equal_hint: '{amt} seorang',
      sb_pick_someone: 'Pilih sekurang-kurangnya seorang.',
      sb_enter_amount: 'Masukkan jumlah dahulu.',
      sb_person_in_use: '{name} ada dalam perbelanjaan — ubah perbelanjaan itu dahulu.',
      sb_dup_name: 'Nama itu sudah ada dalam kumpulan.',
      sb_confirm_reset: 'Ketik sekali lagi untuk kosongkan bil',
      sb_copied: 'Ringkasan disalin — tampal dalam sembang kumpulan',
      sb_default_desc: 'Perbelanjaan', sb_share_title: 'Bahagi bil', sb_via: 'Dibahagi dengan Waypoint',
      sb_left: '{amt} lagi belum selesai',
    },
    ta: {
      tab_splitbill: '💸 பில் பகிர்வு',
      sb_intro: 'குழுவில் யார் இருக்கிறார்கள், என்ன செலுத்தப்பட்டது என்பதைச் சேர்க்கவும். யார் யாருக்கு எவ்வளவு தர வேண்டும் என்பதை Waypoint குறைந்த பரிமாற்றங்களுடன் கணக்கிடும்.',
      sb_people: 'நபர்கள்', sb_add_person_ph: 'பெயரைச் சேர்க்கவும், எ.கா. Wei Ling', sb_add: 'சேர்',
      sb_expenses: 'செலவுகள்', sb_add_expense: '➕ செலவைச் சேர்',
      sb_desc_ph: 'என்ன செலவு? எ.கா. லாவ் பா சாட் இரவு உணவு', sb_paid_by: 'செலுத்தியவர்',
      sb_svc: '+10% சேவைக் கட்டணம்', sb_gst: '+9% GST',
      sb_split_equal: 'சமமாகப் பிரி', sb_split_exact: 'ஒவ்வொருவர் சாப்பிட்டதன்படி',
      sb_save: 'சேமி', sb_settle: 'கணக்கைத் தீர்', sb_share: '📤 குழுவுக்கு அனுப்பு', sb_new_bill: 'புதிய பில் தொடங்கு',
      sb_no_people: 'தொடங்க குறைந்தது 2 பேரைச் சேர்க்கவும்.',
      sb_no_expenses: 'இன்னும் செலவுகள் இல்லை.',
      sb_split_n: '{n} பேருக்குப் பிரிக்கப்பட்டது', sb_split_custom: 'பொருட்களின்படி பிரிக்கப்பட்டது',
      sb_paid: 'செலுத்தியது', sb_share_word: 'பங்கு',
      sb_gets_back: '{amt} திரும்பப் பெற வேண்டும்', sb_owes: '{amt} தர வேண்டும்', sb_even: 'கணக்கு சரி',
      sb_pays: 'செலுத்துகிறார்', sb_mark_paid: 'செலுத்தியதாகக் குறி', sb_paid_done: 'செலுத்தப்பட்டது ✓',
      sb_all_settled: 'அனைவரின் கணக்கும் சரி 🎉', sb_total: 'மொத்தம்',
      sb_exact_hint: 'சேவைக் கட்டணம் & GST-க்கு முன் ஒவ்வொருவரின் தொகையை உள்ளிடவும் — அவை விகிதப்படி சேர்க்கப்படும்.',
      sb_equal_hint: 'ஒவ்வொருவருக்கும் {amt}',
      sb_pick_someone: 'குறைந்தது ஒருவரைத் தேர்ந்தெடுக்கவும்.',
      sb_enter_amount: 'முதலில் தொகையை உள்ளிடவும்.',
      sb_person_in_use: '{name} ஒரு செலவில் உள்ளார் — முதலில் அந்தச் செலவைத் திருத்தவும்.',
      sb_dup_name: 'அந்தப் பெயர் ஏற்கனவே குழுவில் உள்ளது.',
      sb_confirm_reset: 'பில்லை அழிக்க மீண்டும் தட்டவும்',
      sb_copied: 'சுருக்கம் நகலெடுக்கப்பட்டது — குழு அரட்டையில் ஒட்டவும்',
      sb_default_desc: 'செலவு', sb_share_title: 'பில் பகிர்வு', sb_via: 'Waypoint மூலம் பகிரப்பட்டது',
      sb_left: 'இன்னும் {amt} தீர்க்க வேண்டும்',
    },
    ja: {
      tab_splitbill: '💸 割り勘',
      sb_intro: 'メンバーと支払った内容を追加すると、Waypointが最少の送金回数で誰が誰にいくら払うかを計算します。テーブルで気まずい計算はもう不要です。',
      sb_people: 'メンバー', sb_add_person_ph: '名前を追加(例:Wei Ling)', sb_add: '追加',
      sb_expenses: '支出', sb_add_expense: '➕ 支出を追加',
      sb_desc_ph: '内容は?(例:ラオパサでの夕食)', sb_paid_by: '支払った人',
      sb_svc: '+10% サービス料', sb_gst: '+9% GST',
      sb_split_equal: '均等に割る', sb_split_exact: '各自の注文分で',
      sb_save: '保存', sb_settle: '精算', sb_share: '📤 グループに送る', sb_new_bill: '新しい割り勘を始める',
      sb_no_people: '始めるには2人以上追加してください。',
      sb_no_expenses: 'まだ支出はありません。',
      sb_split_n: '{n}人で割り勘', sb_split_custom: '注文分で割り勘',
      sb_paid: '支払い', sb_share_word: '負担',
      sb_gets_back: '{amt} 受け取る', sb_owes: '{amt} 支払う', sb_even: '精算済み',
      sb_pays: '→', sb_mark_paid: '支払済みにする', sb_paid_done: '支払済み ✓',
      sb_all_settled: '全員精算済み 🎉', sb_total: '合計',
      sb_exact_hint: 'サービス料・GST前の各自の金額を入力してください。比例して上乗せされます。',
      sb_equal_hint: '1人 {amt}',
      sb_pick_someone: '少なくとも1人選んでください。',
      sb_enter_amount: '先に金額を入力してください。',
      sb_person_in_use: '{name} は支出に含まれています。先にその支出を編集してください。',
      sb_dup_name: 'その名前は既にグループにいます。',
      sb_confirm_reset: 'もう一度タップするとクリアします',
      sb_copied: '概要をコピーしました。グループチャットに貼り付けてください',
      sb_default_desc: '支出', sb_share_title: '割り勘', sb_via: 'Waypointで割り勘',
      sb_left: '残り {amt} 未精算',
    },
    ko: {
      tab_splitbill: '💸 더치페이',
      sb_intro: '함께한 사람과 결제한 내역을 추가하세요. Waypoint가 최소한의 송금으로 누가 누구에게 얼마를 보내야 하는지 계산해 드립니다.',
      sb_people: '멤버', sb_add_person_ph: '이름 추가 (예: Wei Ling)', sb_add: '추가',
      sb_expenses: '지출', sb_add_expense: '➕ 지출 추가',
      sb_desc_ph: '무엇인가요? 예: 라우파삿 저녁', sb_paid_by: '결제한 사람',
      sb_svc: '+10% 봉사료', sb_gst: '+9% GST',
      sb_split_equal: '똑같이 나누기', sb_split_exact: '각자 먹은 만큼',
      sb_save: '저장', sb_settle: '정산', sb_share: '📤 그룹에 보내기', sb_new_bill: '새 계산 시작',
      sb_no_people: '시작하려면 2명 이상 추가하세요.',
      sb_no_expenses: '아직 지출이 없습니다.',
      sb_split_n: '{n}명이 나눔', sb_split_custom: '항목별로 나눔',
      sb_paid: '결제', sb_share_word: '부담',
      sb_gets_back: '{amt} 받을 돈', sb_owes: '{amt} 보낼 돈', sb_even: '정산 완료',
      sb_pays: '→', sb_mark_paid: '송금 완료 표시', sb_paid_done: '송금 완료 ✓',
      sb_all_settled: '모두 정산 완료 🎉', sb_total: '합계',
      sb_exact_hint: '봉사료와 GST 전 각자 금액을 입력하세요. 비율에 맞게 더해집니다.',
      sb_equal_hint: '1인당 {amt}',
      sb_pick_someone: '나눌 사람을 1명 이상 선택하세요.',
      sb_enter_amount: '먼저 금액을 입력하세요.',
      sb_person_in_use: '{name}님이 지출에 포함되어 있어요. 먼저 그 지출을 수정하세요.',
      sb_dup_name: '이미 그룹에 있는 이름입니다.',
      sb_confirm_reset: '한 번 더 탭하면 초기화됩니다',
      sb_copied: '요약이 복사되었습니다. 그룹 채팅에 붙여넣으세요',
      sb_default_desc: '지출', sb_share_title: '더치페이', sb_via: 'Waypoint로 나눔',
      sb_left: '{amt} 정산 남음',
    },
  };
  Object.keys(SB_I18N).forEach((lang) => {
    if (!I18N[lang]) I18N[lang] = {};
    Object.assign(I18N[lang], SB_I18N[lang]);
  });
  applyTranslations();

  function tf(key, vars) {
    let s = t(key);
    Object.keys(vars || {}).forEach((k) => { s = s.split(`{${k}}`).join(vars[k]); });
    return s;
  }

  // ---------- Money helpers ----------
  function money(cents) {
    const v = (Math.abs(cents) / 100).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (cents < 0 ? '-' : '') + 'S$' + v;
  }

  function parseCents(str) {
    const clean = String(str || '').replace(/[^0-9.]/g, '');
    if (!clean) return 0;
    const n = parseFloat(clean);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
  }

  function centsToInput(cents) {
    return cents ? (cents / 100).toFixed(2) : '';
  }

  // Splits totalCents across weights so the parts always sum exactly to the
  // total (largest-remainder rounding — the odd cent goes to whoever lost the
  // most to rounding, not always the first person).
  function allocate(totalCents, weights) {
    const sum = weights.reduce((a, b) => a + b, 0);
    if (!sum) return weights.map(() => 0);
    const raw = weights.map((w) => (totalCents * w) / sum);
    const parts = raw.map(Math.floor);
    let left = totalCents - parts.reduce((a, b) => a + b, 0);
    const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
    for (let k = 0; left > 0; k = (k + 1) % order.length, left--) parts[order[k].i]++;
    return parts;
  }

  function expenseTotal(exp) {
    let total = exp.base;
    if (exp.svc) total = total * (1 + SVC_RATE);
    if (exp.gst) total = total * (1 + GST_RATE);
    return Math.round(total);
  }

  // Returns { personId: cents } — what each person's share of this expense is.
  function expenseShares(exp) {
    const ids = exp.split === 'exact'
      ? Object.keys(exp.exact || {}).filter((id) => exp.exact[id] > 0)
      : exp.among.slice();
    const weights = exp.split === 'exact' ? ids.map((id) => exp.exact[id]) : ids.map(() => 1);
    const parts = allocate(expenseTotal(exp), weights);
    const out = {};
    ids.forEach((id, i) => { out[id] = parts[i]; });
    return out;
  }

  // ---------- State ----------
  let state = load();

  function blank() { return { people: [], expenses: [], paid: {} }; }

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (s && Array.isArray(s.people) && Array.isArray(s.expenses)) return Object.assign(blank(), s);
    } catch (err) { /* ignore — fall back to an empty bill */ }
    return blank();
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (err) { /* private mode — keep in memory */ }
  }

  function uid() { return Math.random().toString(36).slice(2, 9); }
  function personName(id) { const p = state.people.find((x) => x.id === id); return p ? p.name : '?'; }

  // ---------- Calculation ----------
  function computeBalances() {
    const paid = {}, owed = {};
    state.people.forEach((p) => { paid[p.id] = 0; owed[p.id] = 0; });
    state.expenses.forEach((exp) => {
      if (paid[exp.paidBy] === undefined) return;
      paid[exp.paidBy] += expenseTotal(exp);
      const shares = expenseShares(exp);
      Object.keys(shares).forEach((id) => { if (owed[id] !== undefined) owed[id] += shares[id]; });
    });
    return state.people.map((p) => ({ id: p.id, name: p.name, paid: paid[p.id], owed: owed[p.id], net: paid[p.id] - owed[p.id] }));
  }

  // Greedy: biggest debtor pays biggest creditor until one is cleared. Gives
  // at most n-1 transfers, which is what people actually want at the table.
  function computeTransfers(balances) {
    const debtors = balances.filter((b) => b.net < 0).map((b) => ({ id: b.id, amt: -b.net }));
    const creditors = balances.filter((b) => b.net > 0).map((b) => ({ id: b.id, amt: b.net }));
    const out = [];
    while (debtors.length && creditors.length) {
      debtors.sort((a, b) => b.amt - a.amt);
      creditors.sort((a, b) => b.amt - a.amt);
      const d = debtors[0], c = creditors[0];
      const amt = Math.min(d.amt, c.amt);
      if (amt > 0) out.push({ from: d.id, to: c.id, amt });
      d.amt -= amt; c.amt -= amt;
      if (!d.amt) debtors.shift();
      if (!c.amt) creditors.shift();
    }
    return out;
  }

  function transferKey(tr) { return `${tr.from}>${tr.to}:${tr.amt}`; }

  // ---------- Elements ----------
  const $ = (id) => document.getElementById(id);
  const el = {
    people: $('sbPeople'), addPersonForm: $('sbAddPersonForm'), personInput: $('sbPersonInput'),
    expenses: $('sbExpenses'), addExpenseBtn: $('sbAddExpenseBtn'), form: $('sbExpenseForm'),
    desc: $('sbDesc'), amount: $('sbAmount'), paidBy: $('sbPaidBy'), svc: $('sbSvc'), gst: $('sbGst'),
    segBtns: document.querySelectorAll('#sbExpenseForm .sb-seg-btn'), splitPeople: $('sbSplitPeople'),
    splitHint: $('sbSplitHint'), cancel: $('sbCancelExpense'),
    result: $('sbResult'), summary: $('sbSummary'), transfers: $('sbTransfers'),
    shareBtn: $('sbShareBtn'), resetBtn: $('sbResetBtn'),
  };
  if (!el.people) return; // markup not present

  // Draft of the expense currently being added/edited.
  let draft = null;

  // ---------- Rendering ----------
  function renderPeople() {
    if (!state.people.length) {
      el.people.innerHTML = `<p class="hint sb-empty">${escapeHtml(t('sb_no_people'))}</p>`;
      return;
    }
    el.people.innerHTML = state.people.map((p) => `
      <span class="sb-person-chip">
        <span class="sb-avatar" style="--sb-hue:${hue(p.id)}">${escapeHtml(initial(p.name))}</span>
        <span class="sb-person-name">${escapeHtml(p.name)}</span>
        <button type="button" class="sb-chip-x" data-remove-person="${p.id}" aria-label="Remove ${escapeHtml(p.name)}">✕</button>
      </span>`).join('');
  }

  function initial(name) { return (Array.from(name.trim())[0] || '?').toUpperCase(); }
  // Golden-angle spacing by position in the group, so neighbours never get
  // near-identical avatar colours.
  function hue(id) {
    const i = state.people.findIndex((p) => p.id === id);
    return ((i < 0 ? 0 : i) * 137.5 + 210) % 360;
  }

  function renderExpenses() {
    el.addExpenseBtn.disabled = state.people.length < 2;
    if (!state.expenses.length) {
      el.expenses.innerHTML = state.people.length >= 2 ? `<p class="hint sb-empty">${escapeHtml(t('sb_no_expenses'))}</p>` : '';
      return;
    }
    el.expenses.innerHTML = state.expenses.map((exp) => {
      const n = Object.keys(expenseShares(exp)).length;
      const how = exp.split === 'exact' ? t('sb_split_custom') : tf('sb_split_n', { n });
      const extras = [exp.svc ? 'SVC' : '', exp.gst ? 'GST' : ''].filter(Boolean).join(' + ');
      return `
        <div class="sb-expense" data-edit-expense="${exp.id}" role="button" tabindex="0">
          <div class="sb-expense-main">
            <div class="sb-expense-desc">${escapeHtml(exp.desc || t('sb_default_desc'))}</div>
            <div class="sb-expense-meta">${escapeHtml(personName(exp.paidBy))} ${escapeHtml(t('sb_paid'))} · ${escapeHtml(how)}${extras ? ' · ' + extras : ''}</div>
          </div>
          <div class="sb-expense-amt">${money(expenseTotal(exp))}</div>
          <button type="button" class="sb-chip-x" data-remove-expense="${exp.id}" aria-label="Delete">✕</button>
        </div>`;
    }).join('');
  }

  function renderResult() {
    if (state.people.length < 2 || !state.expenses.length) {
      el.result.classList.add('hidden');
      return;
    }
    el.result.classList.remove('hidden');
    const balances = computeBalances();
    const grand = state.expenses.reduce((a, e) => a + expenseTotal(e), 0);

    el.summary.innerHTML = `
      <div class="sb-total-row"><span>${escapeHtml(t('sb_total'))}</span><strong>${money(grand)}</strong></div>
      ${balances.map((b) => {
        const cls = b.net > 0 ? 'pos' : b.net < 0 ? 'neg' : 'zero';
        const label = b.net > 0 ? tf('sb_gets_back', { amt: money(b.net) }) : b.net < 0 ? tf('sb_owes', { amt: money(-b.net) }) : t('sb_even');
        return `
          <div class="sb-balance">
            <span class="sb-avatar" style="--sb-hue:${hue(b.id)}">${escapeHtml(initial(b.name))}</span>
            <div class="sb-balance-main">
              <div class="sb-balance-name">${escapeHtml(b.name)}</div>
              <div class="sb-balance-meta">${escapeHtml(t('sb_paid'))} ${money(b.paid)} · ${escapeHtml(t('sb_share_word'))} ${money(b.owed)}</div>
            </div>
            <span class="sb-net ${cls}">${escapeHtml(label)}</span>
          </div>`;
      }).join('')}`;

    const transfers = computeTransfers(balances);
    // Forget "paid" ticks for transfers that no longer exist (bill changed).
    const live = {};
    transfers.forEach((tr) => { const k = transferKey(tr); if (state.paid[k]) live[k] = true; });
    state.paid = live;

    if (!transfers.length) {
      el.transfers.innerHTML = `<div class="sb-settled">${escapeHtml(t('sb_all_settled'))}</div>`;
      return;
    }
    const outstanding = transfers.filter((tr) => !state.paid[transferKey(tr)]).reduce((a, tr) => a + tr.amt, 0);
    el.transfers.innerHTML = transfers.map((tr) => {
      const k = transferKey(tr);
      const done = !!state.paid[k];
      return `
        <div class="sb-transfer${done ? ' done' : ''}">
          <div class="sb-transfer-text">
            <strong>${escapeHtml(personName(tr.from))}</strong>
            <span class="sb-arrow">→</span>
            <strong>${escapeHtml(personName(tr.to))}</strong>
          </div>
          <div class="sb-transfer-amt">${money(tr.amt)}</div>
          <button type="button" class="pill-btn ${done ? 'ghost' : ''} sb-paid-btn" data-toggle-paid="${escapeHtml(k)}">${escapeHtml(done ? t('sb_paid_done') : t('sb_mark_paid'))}</button>
        </div>`;
    }).join('') + (outstanding
      ? `<p class="hint sb-left">${escapeHtml(tf('sb_left', { amt: money(outstanding) }))}</p>`
      : `<div class="sb-settled">${escapeHtml(t('sb_all_settled'))}</div>`);
  }

  function renderAll() {
    renderPeople();
    renderExpenses();
    renderResult();
    if (draft) renderDraft();
  }

  // ---------- Expense form ----------
  function openForm(exp) {
    draft = exp
      ? JSON.parse(JSON.stringify(exp))
      : { id: null, desc: '', base: 0, paidBy: state.people[0].id, svc: false, gst: false, split: 'equal', among: state.people.map((p) => p.id), exact: {} };
    el.desc.value = draft.desc;
    el.amount.value = centsToInput(draft.base);
    el.svc.checked = draft.svc;
    el.gst.checked = draft.gst;
    el.paidBy.innerHTML = state.people.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
    el.paidBy.value = draft.paidBy;
    el.form.classList.remove('hidden');
    el.addExpenseBtn.classList.add('hidden');
    renderDraft();
    if (!exp) el.desc.focus();
  }

  function closeForm() {
    draft = null;
    el.form.classList.add('hidden');
    el.addExpenseBtn.classList.remove('hidden');
  }

  function renderDraft() {
    el.segBtns.forEach((b) => b.classList.toggle('active', b.dataset.split === draft.split));
    el.amount.readOnly = draft.split === 'exact';
    el.amount.classList.toggle('sb-readonly', draft.split === 'exact');

    if (draft.split === 'equal') {
      el.splitPeople.innerHTML = state.people.map((p) => `
        <label class="sb-split-row">
          <input type="checkbox" data-among="${p.id}" ${draft.among.includes(p.id) ? 'checked' : ''} />
          <span class="sb-avatar" style="--sb-hue:${hue(p.id)}">${escapeHtml(initial(p.name))}</span>
          <span class="sb-split-name">${escapeHtml(p.name)}</span>
        </label>`).join('');
    } else {
      el.splitPeople.innerHTML = state.people.map((p) => `
        <label class="sb-split-row">
          <span class="sb-avatar" style="--sb-hue:${hue(p.id)}">${escapeHtml(initial(p.name))}</span>
          <span class="sb-split-name">${escapeHtml(p.name)}</span>
          <span class="sb-amount-wrap sb-amount-small"><span class="sb-currency">S$</span>
            <input class="sb-input sb-amount" type="text" inputmode="decimal" placeholder="0.00" data-exact="${p.id}" value="${centsToInput(draft.exact[p.id] || 0)}" />
          </span>
        </label>`).join('');
    }
    updateHint();
  }

  function updateHint() {
    if (!draft) return;
    const total = expenseTotal(draft);
    if (draft.split === 'exact') {
      el.splitHint.textContent = t('sb_exact_hint') + (total ? ` ${t('sb_total')}: ${money(total)}` : '');
    } else if (draft.among.length && total) {
      const parts = allocate(total, draft.among.map(() => 1));
      el.splitHint.textContent = `${t('sb_total')} ${money(total)} · ${tf('sb_equal_hint', { amt: money(Math.max(...parts)) })}`;
    } else {
      el.splitHint.textContent = '';
    }
  }

  el.addExpenseBtn.addEventListener('click', () => { if (state.people.length >= 2) openForm(null); });
  el.cancel.addEventListener('click', closeForm);

  el.segBtns.forEach((b) => b.addEventListener('click', () => {
    if (!draft) return;
    draft.split = b.dataset.split;
    if (draft.split === 'exact') {
      // Start the per-person fields empty; the total becomes their sum.
      draft.base = Object.values(draft.exact).reduce((a, c) => a + c, 0);
      el.amount.value = centsToInput(draft.base);
    }
    renderDraft();
  }));

  el.desc.addEventListener('input', () => { if (draft) draft.desc = el.desc.value; });
  el.amount.addEventListener('input', () => { if (draft && draft.split === 'equal') { draft.base = parseCents(el.amount.value); updateHint(); } });
  el.paidBy.addEventListener('change', () => { if (draft) draft.paidBy = el.paidBy.value; });
  el.svc.addEventListener('change', () => { if (draft) { draft.svc = el.svc.checked; updateHint(); } });
  el.gst.addEventListener('change', () => { if (draft) { draft.gst = el.gst.checked; updateHint(); } });

  el.splitPeople.addEventListener('change', (e) => {
    const id = e.target.dataset.among;
    if (!draft || !id) return;
    draft.among = e.target.checked ? [...new Set([...draft.among, id])] : draft.among.filter((x) => x !== id);
    // keep people order stable
    draft.among = state.people.map((p) => p.id).filter((pid) => draft.among.includes(pid));
    updateHint();
  });
  el.splitPeople.addEventListener('input', (e) => {
    const id = e.target.dataset.exact;
    if (!draft || !id) return;
    draft.exact[id] = parseCents(e.target.value);
    draft.base = Object.values(draft.exact).reduce((a, c) => a + c, 0);
    el.amount.value = centsToInput(draft.base);
    updateHint();
  });

  el.form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!draft) return;
    if (draft.split === 'equal') draft.base = parseCents(el.amount.value);
    if (!draft.base) { showToast(t('sb_enter_amount')); return; }
    if (draft.split === 'equal' && !draft.among.length) { showToast(t('sb_pick_someone')); return; }
    draft.desc = el.desc.value.trim();
    draft.paidBy = el.paidBy.value;
    if (draft.split === 'exact') {
      Object.keys(draft.exact).forEach((k) => { if (!draft.exact[k]) delete draft.exact[k]; });
    }
    if (draft.id) {
      const i = state.expenses.findIndex((x) => x.id === draft.id);
      if (i >= 0) state.expenses[i] = draft;
    } else {
      draft.id = uid();
      state.expenses.push(draft);
    }
    save();
    closeForm();
    renderAll();
  });

  // ---------- People ----------
  el.addPersonForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = el.personInput.value.trim().replace(/\s+/g, ' ');
    if (!name) return;
    if (state.people.some((p) => p.name.toLowerCase() === name.toLowerCase())) { showToast(t('sb_dup_name')); return; }
    const person = { id: uid(), name };
    state.people.push(person);
    if (draft && draft.split === 'equal') draft.among.push(person.id);
    el.personInput.value = '';
    save();
    renderAll();
    if (draft) el.paidBy.innerHTML = state.people.map((p) => `<option value="${p.id}"${p.id === draft.paidBy ? ' selected' : ''}>${escapeHtml(p.name)}</option>`).join('');
    el.personInput.focus();
  });

  el.people.addEventListener('click', (e) => {
    const id = e.target.closest('[data-remove-person]')?.dataset.removePerson;
    if (!id) return;
    const used = state.expenses.some((x) => x.paidBy === id || (x.split === 'equal' ? x.among.includes(id) : x.exact[id] > 0));
    if (used) { showToast(tf('sb_person_in_use', { name: personName(id) }), 3500); return; }
    state.people = state.people.filter((p) => p.id !== id);
    if (state.people.length < 2) closeForm();
    save();
    renderAll();
  });

  // ---------- Expense list ----------
  el.expenses.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-remove-expense]');
    if (rm) {
      e.stopPropagation();
      state.expenses = state.expenses.filter((x) => x.id !== rm.dataset.removeExpense);
      if (draft && draft.id === rm.dataset.removeExpense) closeForm();
      save();
      renderAll();
      return;
    }
    const row = e.target.closest('[data-edit-expense]');
    if (row) {
      const exp = state.expenses.find((x) => x.id === row.dataset.editExpense);
      if (exp) { openForm(exp); el.form.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
    }
  });
  el.expenses.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-edit-expense]')) { e.preventDefault(); e.target.click(); }
  });

  // ---------- Settle up ----------
  el.transfers.addEventListener('click', (e) => {
    const k = e.target.closest('[data-toggle-paid]')?.dataset.togglePaid;
    if (!k) return;
    if (state.paid[k]) delete state.paid[k]; else state.paid[k] = true;
    save();
    renderResult();
  });

  function shareText() {
    const balances = computeBalances();
    const transfers = computeTransfers(balances);
    const grand = state.expenses.reduce((a, x) => a + expenseTotal(x), 0);
    const lines = [`💸 ${t('sb_share_title')} — ${t('sb_total')} ${money(grand)}`, ''];
    state.expenses.forEach((x) => {
      lines.push(`• ${x.desc || t('sb_default_desc')}: ${money(expenseTotal(x))} (${personName(x.paidBy)} ${t('sb_paid')})`);
    });
    lines.push('');
    if (!transfers.length) {
      lines.push(t('sb_all_settled'));
    } else {
      transfers.forEach((tr) => {
        const done = state.paid[transferKey(tr)] ? ' ✅' : '';
        lines.push(`👉 ${personName(tr.from)} → ${personName(tr.to)}: ${money(tr.amt)}${done}`);
      });
    }
    lines.push('', `— ${t('sb_via')} · ${location.origin}`);
    return lines.join('\n');
  }

  el.shareBtn.addEventListener('click', async () => {
    const text = shareText();
    if (navigator.share) {
      try { await navigator.share({ title: t('sb_share_title'), text }); return; }
      catch (err) { if (err && err.name === 'AbortError') return; }
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast(t('sb_copied'), 3000);
    } catch (err) { /* clipboard blocked — fall through to WhatsApp */ }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  });

  // ---------- Reset (two-tap, no blocking confirm() dialog) ----------
  let resetArmed = null;
  el.resetBtn.addEventListener('click', () => {
    if (!state.people.length && !state.expenses.length) return;
    if (!resetArmed) {
      el.resetBtn.textContent = t('sb_confirm_reset');
      el.resetBtn.classList.add('armed');
      resetArmed = setTimeout(() => {
        resetArmed = null;
        el.resetBtn.textContent = t('sb_new_bill');
        el.resetBtn.classList.remove('armed');
      }, 3000);
      return;
    }
    clearTimeout(resetArmed);
    resetArmed = null;
    el.resetBtn.classList.remove('armed');
    el.resetBtn.textContent = t('sb_new_bill');
    state = blank();
    save();
    closeForm();
    renderAll();
  });

  // Re-render dynamic text when the language button cycles (app.js's own
  // listener has already updated currentLang + static labels by then).
  const langBtn = document.getElementById('langBtn');
  if (langBtn) langBtn.addEventListener('click', () => renderAll());

  renderAll();

  // Exposed for quick checks in the console / tests.
  window.WaypointSplitBill = { allocate, expenseTotal, computeTransfers };
})();
