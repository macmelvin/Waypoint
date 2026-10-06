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
      sb_save: 'Save expense', sb_settle: 'Settle up', sb_share: '📤 Send to the group', sb_new_bill: 'Start a new bill',
      sb_no_people: "Add who was there — before or after scanning the receipt, either works.",
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
      sb_split_equal: "Equally",
      sb_split_exact: "By person",
      sb_scan: "📷 Take photo",
      sb_scan_receipt: "📷 Scan a receipt",
      sb_add_item: "+ Add item",
      sb_item_ph: "Item",
      sb_scan_loading: "Loading scanner (first time only)…",
      sb_scan_reading: "Reading receipt… {pct}%",
      sb_scan_none: "Couldn't find any items. Try a flatter, brighter photo, or add items by hand.",
      sb_scan_fail: "Couldn't read that photo. Check your connection (the scanner downloads once) and try again.",
      sb_scan_found: "Found {n} items. Check them, then save.",
      sb_n_items: "{n} items",
      sb_items_hint: "Tap any item to fix a misread name or price.",
      sb_receipt_says: "receipt says {amt}",
      sb_need_items: "Add at least one item with a price.",
      sb_need_people: "Add at least 2 people above so the bill can be split.",
      sb_scan_found_nopeople: "Found {n} items. Now add who was there ↑",
      sb_paid_by_ph: "— add people above —",
      sb_gallery: "🖼️ From gallery",
    },
    zh: {
      tab_splitbill: '💸 分账',
      sb_intro: '添加同行的人和各自付了什么。Waypoint会用最少的转账次数算出谁该给谁多少钱,饭桌上不用再尴尬地算账。',
      sb_people: '成员', sb_add_person_ph: '输入名字,例如 Wei Ling', sb_add: '添加',
      sb_expenses: '费用', sb_add_expense: '➕ 添加一笔费用',
      sb_desc_ph: '什么费用?例如 老巴刹晚餐', sb_paid_by: '付款人',
      sb_svc: '+10% 服务费', sb_gst: '+9% 消费税',
      sb_save: '保存', sb_settle: '结算', sb_share: '📤 发送到群组', sb_new_bill: '开始新账单',
      sb_no_people: "添加同行的人——扫描收据之前或之后都可以。",
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
      sb_split_equal: "平均",
      sb_split_exact: "按人",
      sb_scan: "📷 拍照",
      sb_scan_receipt: "📷 扫描收据",
      sb_add_item: "+ 添加项目",
      sb_item_ph: "项目",
      sb_scan_loading: "正在加载扫描器(仅首次)…",
      sb_scan_reading: "正在识别收据… {pct}%",
      sb_scan_none: "没有找到任何项目。请拍一张更平整、更亮的照片,或手动添加。",
      sb_scan_fail: "无法读取这张照片。请检查网络(扫描器仅需下载一次)后重试。",
      sb_scan_found: "找到 {n} 个项目。检查一下,然后保存。",
      sb_n_items: "{n} 个项目",
      sb_items_hint: "点击任意项目可修正识别错误的名称或价格。",
      sb_receipt_says: "收据显示 {amt}",
      sb_need_items: "请至少添加一个有价格的项目。",
      sb_need_people: "请先在上方添加至少2个人,才能分账。",
      sb_scan_found_nopeople: "找到 {n} 个项目。现在添加同行的人 ↑",
      sb_paid_by_ph: "— 请在上方添加成员 —",
      sb_gallery: "🖼️ 从相册选择",
    },
    ms: {
      tab_splitbill: '💸 Bahagi Bil',
      sb_intro: 'Tambah siapa dalam kumpulan dan apa yang dibayar. Waypoint kira siapa berhutang kepada siapa — dengan pindahan paling sedikit — jadi tiada kira-kira janggal di meja.',
      sb_people: 'Orang', sb_add_person_ph: 'Tambah nama, cth. Wei Ling', sb_add: 'Tambah',
      sb_expenses: 'Perbelanjaan', sb_add_expense: '➕ Tambah perbelanjaan',
      sb_desc_ph: 'Untuk apa? cth. Makan malam di Lau Pa Sat', sb_paid_by: 'Dibayar oleh',
      sb_svc: '+10% caj servis', sb_gst: '+9% GST',
      sb_save: 'Simpan', sb_settle: 'Selesaikan', sb_share: '📤 Hantar ke kumpulan', sb_new_bill: 'Mula bil baharu',
      sb_no_people: "Tambah siapa yang hadir — sebelum atau selepas imbas resit, kedua-duanya boleh.",
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
      sb_split_equal: "Sama rata",
      sb_split_exact: "Ikut orang",
      sb_scan: "📷 Ambil foto",
      sb_scan_receipt: "📷 Imbas resit",
      sb_add_item: "+ Tambah item",
      sb_item_ph: "Item",
      sb_scan_loading: "Memuatkan pengimbas (kali pertama sahaja)…",
      sb_scan_reading: "Membaca resit… {pct}%",
      sb_scan_none: "Tiada item ditemui. Cuba foto yang lebih rata dan terang, atau tambah item sendiri.",
      sb_scan_fail: "Tidak dapat membaca foto itu. Semak sambungan anda (pengimbas dimuat turun sekali) dan cuba lagi.",
      sb_scan_found: "{n} item ditemui. Semak, kemudian simpan.",
      sb_n_items: "{n} item",
      sb_items_hint: "Ketik mana-mana item untuk membetulkan nama atau harga yang salah dibaca.",
      sb_receipt_says: "resit menunjukkan {amt}",
      sb_need_items: "Tambah sekurang-kurangnya satu item berharga.",
      sb_need_people: "Tambah sekurang-kurangnya 2 orang di atas supaya bil boleh dibahagi.",
      sb_scan_found_nopeople: "{n} item ditemui. Sekarang tambah siapa yang hadir ↑",
      sb_paid_by_ph: "— tambah orang di atas —",
      sb_gallery: "🖼️ Dari galeri",
    },
    ta: {
      tab_splitbill: '💸 பில் பகிர்வு',
      sb_intro: 'குழுவில் யார் இருக்கிறார்கள், என்ன செலுத்தப்பட்டது என்பதைச் சேர்க்கவும். யார் யாருக்கு எவ்வளவு தர வேண்டும் என்பதை Waypoint குறைந்த பரிமாற்றங்களுடன் கணக்கிடும்.',
      sb_people: 'நபர்கள்', sb_add_person_ph: 'பெயரைச் சேர்க்கவும், எ.கா. Wei Ling', sb_add: 'சேர்',
      sb_expenses: 'செலவுகள்', sb_add_expense: '➕ செலவைச் சேர்',
      sb_desc_ph: 'என்ன செலவு? எ.கா. லாவ் பா சாட் இரவு உணவு', sb_paid_by: 'செலுத்தியவர்',
      sb_svc: '+10% சேவைக் கட்டணம்', sb_gst: '+9% GST',
      sb_save: 'சேமி', sb_settle: 'கணக்கைத் தீர்', sb_share: '📤 குழுவுக்கு அனுப்பு', sb_new_bill: 'புதிய பில் தொடங்கு',
      sb_no_people: "யார் இருந்தார்கள் என்பதைச் சேர்க்கவும் — ரசீதை ஸ்கேன் செய்வதற்கு முன்போ பின்போ, இரண்டும் சரி.",
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
      sb_split_equal: "சமமாக",
      sb_split_exact: "நபர்படி",
      sb_scan: "📷 புகைப்படம் எடு",
      sb_scan_receipt: "📷 ரசீதை ஸ்கேன் செய்",
      sb_add_item: "+ பொருளைச் சேர்",
      sb_item_ph: "பொருள்",
      sb_scan_loading: "ஸ்கேனர் ஏற்றப்படுகிறது (முதல் முறை மட்டும்)…",
      sb_scan_reading: "ரசீது படிக்கப்படுகிறது… {pct}%",
      sb_scan_none: "பொருட்கள் எதுவும் கிடைக்கவில்லை. தட்டையான, பிரகாசமான புகைப்படத்தை முயற்சிக்கவும், அல்லது கையால் சேர்க்கவும்.",
      sb_scan_fail: "அந்தப் புகைப்படத்தைப் படிக்க முடியவில்லை. இணைப்பைச் சரிபார்த்து மீண்டும் முயற்சிக்கவும்.",
      sb_scan_found: "{n} பொருட்கள் கிடைத்தன. சரிபார்த்து, பின் சேமிக்கவும்.",
      sb_n_items: "{n} பொருட்கள்",
      sb_items_hint: "தவறாகப் படிக்கப்பட்ட பெயர் அல்லது விலையைத் திருத்த எந்தப் பொருளையும் தட்டவும்.",
      sb_receipt_says: "ரசீதில் {amt}",
      sb_need_items: "விலையுடன் குறைந்தது ஒரு பொருளைச் சேர்க்கவும்.",
      sb_need_people: "பில்லைப் பிரிக்க மேலே குறைந்தது 2 பேரைச் சேர்க்கவும்.",
      sb_scan_found_nopeople: "{n} பொருட்கள் கிடைத்தன. இப்போது யார் இருந்தார்கள் என்பதைச் சேர்க்கவும் ↑",
      sb_paid_by_ph: "— மேலே நபர்களைச் சேர்க்கவும் —",
      sb_gallery: "🖼️ கேலரியிலிருந்து",
    },
    ja: {
      tab_splitbill: '💸 割り勘',
      sb_intro: 'メンバーと支払った内容を追加すると、Waypointが最少の送金回数で誰が誰にいくら払うかを計算します。テーブルで気まずい計算はもう不要です。',
      sb_people: 'メンバー', sb_add_person_ph: '名前を追加(例:Wei Ling)', sb_add: '追加',
      sb_expenses: '支出', sb_add_expense: '➕ 支出を追加',
      sb_desc_ph: '内容は?(例:ラオパサでの夕食)', sb_paid_by: '支払った人',
      sb_svc: '+10% サービス料', sb_gst: '+9% GST',
      sb_save: '保存', sb_settle: '精算', sb_share: '📤 グループに送る', sb_new_bill: '新しい割り勘を始める',
      sb_no_people: "メンバーを追加してください。レシートの読み取り前でも後でも大丈夫です。",
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
      sb_split_equal: "均等",
      sb_split_exact: "人ごと",
      sb_scan: "📷 撮影する",
      sb_scan_receipt: "📷 レシートを読み取る",
      sb_add_item: "+ 品目を追加",
      sb_item_ph: "品目",
      sb_scan_loading: "スキャナーを読み込み中(初回のみ)…",
      sb_scan_reading: "レシートを読み取り中… {pct}%",
      sb_scan_none: "品目が見つかりませんでした。平らで明るい写真で再度お試しいただくか、手動で追加してください。",
      sb_scan_fail: "写真を読み取れませんでした。接続を確認して(スキャナーは初回のみダウンロード)もう一度お試しください。",
      sb_scan_found: "{n} 品目が見つかりました。確認してから保存してください。",
      sb_n_items: "{n} 品目",
      sb_items_hint: "読み間違えた品名や金額は、タップして修正できます。",
      sb_receipt_says: "レシート記載 {amt}",
      sb_need_items: "金額のある品目を1つ以上追加してください。",
      sb_need_people: "割り勘するには、上で2人以上追加してください。",
      sb_scan_found_nopeople: "{n} 品目が見つかりました。次にメンバーを追加してください ↑",
      sb_paid_by_ph: "— 上でメンバーを追加 —",
      sb_gallery: "🖼️ 写真から選ぶ",
    },
    ko: {
      tab_splitbill: '💸 더치페이',
      sb_intro: '함께한 사람과 결제한 내역을 추가하세요. Waypoint가 최소한의 송금으로 누가 누구에게 얼마를 보내야 하는지 계산해 드립니다.',
      sb_people: '멤버', sb_add_person_ph: '이름 추가 (예: Wei Ling)', sb_add: '추가',
      sb_expenses: '지출', sb_add_expense: '➕ 지출 추가',
      sb_desc_ph: '무엇인가요? 예: 라우파삿 저녁', sb_paid_by: '결제한 사람',
      sb_svc: '+10% 봉사료', sb_gst: '+9% GST',
      sb_save: '저장', sb_settle: '정산', sb_share: '📤 그룹에 보내기', sb_new_bill: '새 계산 시작',
      sb_no_people: "함께한 사람을 추가하세요. 영수증 스캔 전이나 후 모두 괜찮아요.",
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
      sb_split_equal: "균등",
      sb_split_exact: "사람별",
      sb_scan: "📷 사진 찍기",
      sb_scan_receipt: "📷 영수증 스캔",
      sb_add_item: "+ 항목 추가",
      sb_item_ph: "항목",
      sb_scan_loading: "스캐너 불러오는 중 (처음 한 번만)…",
      sb_scan_reading: "영수증 읽는 중… {pct}%",
      sb_scan_none: "항목을 찾지 못했습니다. 더 평평하고 밝은 사진으로 다시 시도하거나 직접 추가하세요.",
      sb_scan_fail: "사진을 읽을 수 없습니다. 연결을 확인하고 (스캐너는 한 번만 다운로드) 다시 시도하세요.",
      sb_scan_found: "{n}개 항목을 찾았습니다. 확인 후 저장하세요.",
      sb_n_items: "{n}개 항목",
      sb_items_hint: "잘못 읽힌 이름이나 가격은 탭해서 고칠 수 있어요.",
      sb_receipt_says: "영수증 {amt}",
      sb_need_items: "가격이 있는 항목을 1개 이상 추가하세요.",
      sb_need_people: "나누려면 위에서 2명 이상 추가하세요.",
      sb_scan_found_nopeople: "{n}개 항목을 찾았습니다. 이제 함께한 사람을 추가하세요 ↑",
      sb_paid_by_ph: "— 위에서 멤버 추가 —",
      sb_gallery: "🖼️ 앨범에서 선택",
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
    const symbol = (state && state.currency && state.currency.symbol) || 'S$';
    return (cents < 0 ? '-' : '') + symbol + v;
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

  // Receipt line items (from a scan or typed in) are only a breakdown of the
  // bill — the total is still split equally among the ticked people.
  function itemsSum(items) { return (items || []).reduce((a, it) => a + (it.cents || 0), 0); }
  function hasItems(exp) { return !!(exp.items && exp.items.length); }

  // Returns { personId: cents } — what each person's share of this expense is.
  function expenseShares(exp) {
    let ids, weights;
    if (exp.split === 'exact') {
      ids = Object.keys(exp.exact || {}).filter((id) => exp.exact[id] > 0);
      weights = ids.map((id) => exp.exact[id]);
    } else {
      ids = exp.among.slice();
      weights = ids.map(() => 1);
    }
    const parts = allocate(expenseTotal(exp), weights);
    const out = {};
    ids.forEach((id, i) => { out[id] = parts[i]; });
    return out;
  }

  // ---------- State ----------
  let state = load();

  // currency: { code, symbol } for the bill's own amounts (SGD by default).
  // currencyAuto: true while it's still following GPS detection; false once
  // the person has picked one from the dropdown, so we stop overwriting it.
  function blank(carry) {
    return Object.assign({
      people: [], expenses: [], paid: {},
      currency: { code: 'SGD', symbol: 'S$' }, currencyAuto: true,
    }, carry || {});
  }

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (s && Array.isArray(s.people) && Array.isArray(s.expenses)) {
        // Bills saved while the old "By item" mode existed become equal
        // splits among everyone who shared any item.
        s.expenses.forEach((x) => {
          if (x.split !== 'items') return;
          const ids = new Set();
          (x.items || []).forEach((it) => (it.among || []).forEach((id) => ids.add(id)));
          x.split = 'equal';
          x.among = s.people.map((p) => p.id).filter((id) => ids.has(id));
          if (!x.among.length) x.among = s.people.map((p) => p.id);
          x.items = (x.items || []).map((it) => ({ name: it.name, cents: it.cents }));
        });
        // Bills saved before the currency feature shipped have neither
        // field — default them to SGD, still auto-following GPS.
        if (!s.currency || !s.currency.code) s.currency = { code: 'SGD', symbol: 'S$' };
        if (typeof s.currencyAuto !== 'boolean') s.currencyAuto = true;
        return Object.assign(blank(), s);
      }
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
    addRow: $('sbAddRow'), scanReceiptBtn: $('sbScanReceiptBtn'),
    itemsBox: $('sbItemsBox'), items: $('sbItems'), addItem: $('sbAddItem'),
    receiptCamera: $('sbReceiptCamera'), receiptGallery: $('sbReceiptGallery'), scanStatus: $('sbScanStatus'), scanBar: $('sbScanBar'), scanText: $('sbScanText'),
    result: $('sbResult'), summary: $('sbSummary'), transfers: $('sbTransfers'),
    shareBtn: $('sbShareBtn'), resetBtn: $('sbResetBtn'),
    currencyBox: $('sbCurrencyBox'), currencyName: $('sbCurrencyName'), currencySrc: $('sbCurrencySrc'),
    currencySel: $('sbCurrencySel'), currencySym: $('sbCurrencySym'),
  };
  if (!el.people) return; // markup not present

  // ---------- Currency (follows GPS; overridable; converts to SGD at settle-up) ----------
  const SB_CTY_OVERRIDE_KEY = 'waypoint_sb_cty_override';
  const fxRateCache = {}; // currency code -> { rate, at } — SGD-per-1-unit-of-that-currency, this page load only

  function currencyLabel(code) {
    // A country name that uses this currency (e.g. "Malaysia" for MYR) reads
    // more naturally next to a symbol than the bare ISO code would.
    if (code === 'SGD') return 'Singapore Dollar';
    const countryCode = Object.keys(CURRENCY_BY_COUNTRY).find((k) => CURRENCY_BY_COUNTRY[k][0] === code);
    return countryCode && SAFETY_DATA[countryCode] ? SAFETY_DATA[countryCode].n : code;
  }

  function renderCurrencyBox() {
    if (el.currencySym) el.currencySym.textContent = state.currency.symbol;
    if (!el.currencyBox) return;
    const cur = state.currency;
    el.currencyName.textContent = `${currencyLabel(cur.code)} (${cur.symbol})`;
    el.currencySrc.textContent = state.currencyAuto ? (deviceCountryCache ? deviceCountryCache.src : "Based on your phone's time zone") : 'Chosen by you';
    if (!el.currencySel.options.length) {
      const override = localStorage.getItem(SB_CTY_OVERRIDE_KEY) || '';
      const countryOptions = ['<option value="">Detect automatically</option>']
        .concat(Object.keys(SAFETY_DATA).sort((a, b) => SAFETY_DATA[a].n.localeCompare(SAFETY_DATA[b].n))
          .map((k) => `<option value="${k}">${escapeHtml(SAFETY_DATA[k].n)} — ${escapeHtml(currencyForCountry(k).symbol)} (${escapeHtml(currencyForCountry(k).code)})</option>`))
        .join('');
      el.currencySel.innerHTML = countryOptions;
      el.currencySel.value = override;
    }
  }

  function applyCurrencyFromCountry(countryCode, src) {
    const cur = currencyForCountry(countryCode);
    const changed = !state.currency || state.currency.code !== cur.code;
    state.currency = cur;
    save();
    if (changed) renderAll();
    else renderCurrencyBox();
  }

  // Called by app.js when the Split Bill tab is opened. Only runs GPS
  // detection while the person hasn't manually picked a currency — once
  // they have, we stop overriding it (same pattern as the Safety tab).
  function onTabOpen() {
    if (!state.currencyAuto) { renderCurrencyBox(); return; }
    detectDeviceCountry().then((c) => applyCurrencyFromCountry(c.code, c.src));
    renderCurrencyBox();
  }

  if (el.currencySel) {
    el.currencySel.addEventListener('change', (e) => {
      const code = e.target.value;
      if (code) {
        localStorage.setItem(SB_CTY_OVERRIDE_KEY, code);
        localStorage.setItem(DEVICE_COUNTRY_OVERRIDE_KEY, code); // keep in sync so a future "detect automatically" elsewhere agrees
        state.currencyAuto = false;
        applyCurrencyFromCountry(code, 'Chosen by you');
      } else {
        localStorage.removeItem(SB_CTY_OVERRIDE_KEY);
        localStorage.removeItem(DEVICE_COUNTRY_OVERRIDE_KEY);
        deviceCountryCache = null;
        state.currencyAuto = true;
        save();
        detectDeviceCountry().then((c) => applyCurrencyFromCountry(c.code, c.src));
      }
    });
  }

  // Looks up (and caches, this page load only) how many SGD one unit of
  // `code` is worth, via our own /api/fx-rate proxy (server-cached too).
  // Resolves to null on any failure — callers just skip showing the
  // conversion rather than showing something wrong.
  async function getSgdRate(code) {
    if (code === 'SGD') return 1;
    const cached = fxRateCache[code];
    if (cached) return cached.rate;
    try {
      const r = await fetch(`/api/fx-rate?base=${encodeURIComponent(code)}`);
      const j = await r.json();
      const rate = j && j.rates && typeof j.rates.SGD === 'number' ? j.rates.SGD : null;
      if (rate) fxRateCache[code] = { rate, at: Date.now() };
      return rate;
    } catch (err) {
      return null;
    }
  }

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
    if (!state.expenses.length) {
      el.expenses.innerHTML = draft ? '' : `<p class="hint sb-empty">${escapeHtml(t('sb_no_expenses'))}</p>`;
      return;
    }
    el.expenses.innerHTML = state.expenses.map((exp) => {
      const n = Object.keys(expenseShares(exp)).length;
      const how = exp.split === 'exact' ? t('sb_split_custom')
        : (hasItems(exp) ? tf('sb_n_items', { n: exp.items.length }) + ' · ' : '') + tf('sb_split_n', { n });
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
    const showFx = state.currency.code !== 'SGD';
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
          <div class="sb-transfer-amt-wrap">
            <div class="sb-transfer-amt">${money(tr.amt)}</div>
            ${showFx ? `<div class="hint sb-transfer-fx" id="sbFx-${escapeHtml(k)}"></div>` : ''}
          </div>
          <button type="button" class="pill-btn ${done ? 'ghost' : ''} sb-paid-btn" data-toggle-paid="${escapeHtml(k)}">${escapeHtml(done ? t('sb_paid_done') : t('sb_mark_paid'))}</button>
        </div>`;
    }).join('') + (outstanding
      ? `<p class="hint sb-left">${escapeHtml(tf('sb_left', { amt: money(outstanding) }))}</p>`
      : `<div class="sb-settled">${escapeHtml(t('sb_all_settled'))}</div>`)
      + (showFx ? `<p class="hint sb-fx-attr">Converted amounts by <a href="https://www.exchangerate-api.com" target="_blank" rel="noopener">Exchange Rate API</a></p>` : '');

    // Fill in "≈ S$x.xx" next to each transfer once the rate's fetched —
    // async so it never blocks the (synchronous) local-currency render above.
    if (showFx) {
      getSgdRate(state.currency.code).then((rate) => {
        if (!rate) return;
        transfers.forEach((tr) => {
          const node = document.getElementById(`sbFx-${transferKey(tr)}`);
          if (!node) return; // bill changed before the rate came back
          const sgdCents = Math.round(tr.amt * rate);
          const v = (sgdCents / 100).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          node.textContent = `≈ S$${v}`;
        });
      });
    }
  }

  function renderAll() {
    renderCurrencyBox();
    renderPeople();
    renderExpenses();
    renderResult();
    if (draft) renderDraft();
  }

  // ---------- Expense form ----------
  function openForm(exp, fromScan) {
    draft = exp
      ? JSON.parse(JSON.stringify(exp))
      : { id: null, desc: '', base: 0, paidBy: state.people[0] ? state.people[0].id : '', svc: false, gst: false, split: 'equal', among: state.people.map((p) => p.id), exact: {}, items: [] };
    if (!draft.items) draft.items = [];
    if (!draft.exact) draft.exact = {};
    el.desc.value = draft.desc;
    el.amount.value = centsToInput(draft.base);
    el.svc.checked = draft.svc;
    el.gst.checked = draft.gst;
    renderPaidBy();
    el.form.classList.remove('hidden');
    el.addRow.classList.add('hidden');
    renderDraft();
    if (!exp && !fromScan) el.desc.focus();
  }

  function closeForm() {
    draft = null;
    el.form.classList.add('hidden');
    el.addRow.classList.remove('hidden');
    setScanStatus(null);
  }

  function renderDraft() {
    el.segBtns.forEach((b) => b.classList.toggle('active', b.dataset.split === draft.split));
    // The amount is worked out for you from the per-person amounts, or from
    // the receipt items when there are any.
    const derived = draft.split === 'exact' || hasItems(draft);
    el.amount.readOnly = derived;
    el.amount.classList.toggle('sb-readonly', derived);
    el.itemsBox.classList.toggle('hidden', draft.split === 'exact');
    if (draft.split !== 'exact') renderItems();

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
          <span class="sb-amount-wrap sb-amount-small"><span class="sb-currency">${escapeHtml(state.currency.symbol)}</span>
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
      return;
    }
    const lines = [];
    const n = draft.items.filter((it) => it.cents).length;
    if (total) {
      let line = `${n ? tf('sb_n_items', { n }) + ' · ' : ''}${t('sb_total')} ${money(total)}`;
      if (n && draft.receiptTotal) {
        const ok = Math.abs(total - draft.receiptTotal) <= 10; // allow the receipt's own rounding line
        line += ` · ${ok ? '' : '⚠️ '}${tf('sb_receipt_says', { amt: money(draft.receiptTotal) })}${ok ? ' ✓' : ''}`;
      }
      if (draft.among.length) {
        const parts = allocate(total, draft.among.map(() => 1));
        line += ` · ${tf('sb_equal_hint', { amt: money(Math.max(...parts)) })}`;
      }
      lines.push(line);
    }
    if (n) lines.push(t('sb_items_hint'));
    el.splitHint.textContent = lines.join('\n');
  }

  el.addExpenseBtn.addEventListener('click', () => openForm(null));

  function renderPaidBy() {
    if (!draft) return;
    if (!draft.paidBy && state.people[0]) draft.paidBy = state.people[0].id;
    el.paidBy.innerHTML = state.people.length
      ? state.people.map((p) => `<option value="${p.id}"${p.id === draft.paidBy ? ' selected' : ''}>${escapeHtml(p.name)}</option>`).join('')
      : `<option value="">${escapeHtml(t('sb_paid_by_ph'))}</option>`;
  }
  el.cancel.addEventListener('click', closeForm);

  el.segBtns.forEach((b) => b.addEventListener('click', () => {
    if (!draft) return;
    draft.split = b.dataset.split;
    syncBase();
    renderDraft();
  }));

  el.desc.addEventListener('input', () => { if (draft) draft.desc = el.desc.value; });
  el.amount.addEventListener('input', () => { if (draft && draft.split === 'equal' && !hasItems(draft)) { draft.base = parseCents(el.amount.value); updateHint(); } });
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
    draft.paidBy = el.paidBy.value;
    if (state.people.length < 2 || !draft.paidBy) {
      showToast(t('sb_need_people'), 3500);
      el.personInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.personInput.focus({ preventScroll: true });
      return;
    }
    if (draft.split === 'equal') {
      draft.items = draft.items.filter((it) => it.cents).map((it) => ({ name: (it.name || '').trim() || t('sb_item_ph'), cents: it.cents }));
      if (draft.items.length) syncBase(); else draft.base = parseCents(el.amount.value);
    }
    if (draft.base <= 0) { showToast(t(hasItems(draft) ? 'sb_need_items' : 'sb_enter_amount')); return; }
    if (draft.split === 'equal' && !draft.among.length) { showToast(t('sb_pick_someone')); return; }
    draft.desc = el.desc.value.trim();
    draft.paidBy = el.paidBy.value;
    if (draft.split === 'exact') {
      Object.keys(draft.exact).forEach((k) => { if (!draft.exact[k]) delete draft.exact[k]; });
    }
    // Keep only the fields the chosen split mode uses.
    if (draft.split !== 'equal') draft.items = [];
    if (draft.split !== 'exact') draft.exact = {};
    delete draft.receiptTotal;
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

  // ---------- Receipt items + scan ----------
  function syncBase() {
    if (!draft) return;
    if (draft.split === 'equal' && hasItems(draft)) draft.base = itemsSum(draft.items);
    else if (draft.split === 'exact') draft.base = Object.values(draft.exact).reduce((a, c) => a + c, 0);
    else return;
    el.amount.value = centsToInput(Math.max(0, draft.base));
  }

  function renderItems() {
    el.items.innerHTML = draft.items.map((it, i) => `
      <div class="sb-item">
        <input class="sb-input sb-item-name" type="text" maxlength="40" placeholder="${escapeHtml(t('sb_item_ph'))}" data-item-name="${i}" value="${escapeHtml(it.name)}" />
        <span class="sb-amount-wrap sb-amount-small"><span class="sb-currency">${escapeHtml(state.currency.symbol)}</span>
          <input class="sb-input sb-amount" type="text" inputmode="decimal" placeholder="0.00" data-item-price="${i}" value="${it.cents ? (it.cents / 100).toFixed(2) : ''}" />
        </span>
        <button type="button" class="sb-chip-x" data-item-remove="${i}" aria-label="Remove item">✕</button>
      </div>`).join('');
  }

  el.items.addEventListener('input', (e) => {
    if (!draft) return;
    const ni = e.target.dataset.itemName, pi = e.target.dataset.itemPrice;
    if (ni !== undefined) draft.items[ni].name = e.target.value;
    if (pi !== undefined) {
      // allow "-2.00" for discount lines
      const neg = /^\s*-/.test(e.target.value);
      draft.items[pi].cents = parseCents(e.target.value) * (neg ? -1 : 1);
      syncBase();
      updateHint();
    }
  });

  el.items.addEventListener('click', (e) => {
    if (!draft) return;
    const rm = e.target.closest('[data-item-remove]');
    if (rm) {
      draft.items.splice(+rm.dataset.itemRemove, 1);
      syncBase(); renderDraft();
    }
  });

  el.addItem.addEventListener('click', () => {
    if (!draft) return;
    const firstItem = !hasItems(draft);
    draft.items.push({ name: '', cents: 0 });
    syncBase();
    if (firstItem) renderDraft(); else renderItems(); // amount box becomes auto-calculated
    const inputs = el.items.querySelectorAll('[data-item-name]');
    if (inputs.length) inputs[inputs.length - 1].focus();
  });

  function setScanStatus(frac, text) {
    if (frac === null) { el.scanStatus.classList.add('hidden'); return; }
    el.scanStatus.classList.remove('hidden');
    el.scanBar.style.width = `${Math.round(frac * 100)}%`;
    el.scanText.textContent = text;
  }

  let scanning = false;
  async function handleReceipt(file) {
    if (!file || !draft || scanning || !window.WaypointReceipt) return;
    scanning = true;
    el.itemsBox.classList.add('scanning');
    setScanStatus(0.02, t('sb_scan_loading'));
    try {
      const r = await window.WaypointReceipt.scanReceipt(file, (frac, stage) => {
        setScanStatus(frac, stage === 'read' ? tf('sb_scan_reading', { pct: Math.round(frac * 100) }) : t('sb_scan_loading'));
      });
      if (!draft) return; // form closed mid-scan
      if (!r.items.length) { setScanStatus(null); showToast(t('sb_scan_none'), 4000); return; }
      // Replace blank rows; keep anything the user already typed.
      draft.items = draft.items.filter((it) => it.cents || (it.name || '').trim())
        .concat(r.items.map((it) => ({ name: it.name, cents: it.cents })));
      draft.split = 'equal';
      if (!el.desc.value.trim() && r.title) { el.desc.value = titleCase(r.title); draft.desc = el.desc.value; }
      draft.svc = r.svc; el.svc.checked = r.svc;
      draft.gst = r.gst && !r.gstInclusive; el.gst.checked = draft.gst;
      draft.receiptTotal = r.total || null;
      syncBase();
      renderDraft();
      setScanStatus(null);
      if (state.people.length < 2) {
        showToast(tf('sb_scan_found_nopeople', { n: r.items.length }), 4000);
        el.personInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.personInput.focus({ preventScroll: true });
      } else {
        showToast(tf('sb_scan_found', { n: r.items.length }), 3500);
      }
    } catch (err) {
      console.error('Receipt scan failed', err);
      setScanStatus(null);
      showToast(t('sb_scan_fail'), 4000);
    } finally {
      scanning = false;
      el.itemsBox.classList.remove('scanning');
      el.receiptCamera.value = '';
      el.receiptGallery.value = '';
    }
  }

  function titleCase(s) {
    return s.toLowerCase().replace(/(^|[\s(&/-])([a-z])/g, (m, a, b) => a + b.toUpperCase()).slice(0, 40);
  }

  [el.receiptCamera, el.receiptGallery].forEach((input) => {
    input.addEventListener('change', () => handleReceipt(input.files && input.files[0]));
  });

  el.scanReceiptBtn.addEventListener('click', () => {
    openForm(null, true);
    el.receiptCamera.click(); // same tap, so mobile browsers allow the camera to open
  });

  // ---------- People ----------
  el.addPersonForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = el.personInput.value.trim().replace(/\s+/g, ' ');
    if (!name) return;
    if (state.people.some((p) => p.name.toLowerCase() === name.toLowerCase())) { showToast(t('sb_dup_name')); return; }
    const person = { id: uid(), name };
    state.people.push(person);
    if (draft) draft.among.push(person.id);
    el.personInput.value = '';
    save();
    renderAll();
    renderPaidBy();
    el.personInput.focus();
  });

  el.people.addEventListener('click', (e) => {
    const id = e.target.closest('[data-remove-person]')?.dataset.removePerson;
    if (!id) return;
    const used = state.expenses.some((x) => x.paidBy === id
      || (x.split === 'exact' ? (x.exact || {})[id] > 0 : x.among.includes(id)));
    if (used) { showToast(tf('sb_person_in_use', { name: personName(id) }), 3500); return; }
    state.people = state.people.filter((p) => p.id !== id);
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
      if (hasItems(x)) x.items.forEach((it) => lines.push(`   · ${it.name} ${money(it.cents)}`));
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
    // Keep the current currency going into the new bill — starting a fresh
    // bill almost always means you're still in the same place, so there's
    // no reason to re-ask or silently drop back to SGD.
    state = blank({ currency: state.currency, currencyAuto: state.currencyAuto });
    save();
    closeForm();
    renderAll();
  });

  // Re-render dynamic text when the language button cycles (app.js's own
  // listener has already updated currentLang + static labels by then).
  const langBtn = document.getElementById('langBtn');
  if (langBtn) langBtn.addEventListener('click', () => renderAll());

  renderAll();

  // Exposed for quick checks in the console / tests, and onTabOpen for
  // app.js's tab-switch handler to trigger currency detection on demand.
  window.WaypointSplitBill = { allocate, expenseTotal, expenseShares, computeTransfers, onTabOpen };
})();
