const anchor = (line: number) => `data-wf-src="playground/page.tsx:${line}:1" data-wf-section="sample-${line}"`;
const card = (title: string, text: string, line: number) => `<article ${anchor(line)} style="border:1px solid #d4d4d4;padding:32px;background:white"><h3 style="font-size:24px;margin:0 0 16px">${title}</h3><p style="font-size:18px;line-height:1.8;margin:0">${text}</p></article>`;

export const webpage = `<main ${anchor(1)} style="display:grid;grid-template-columns:minmax(0,1fr) 420px;width:100%;font-family:system-ui,sans-serif;color:#242424;background:white">
<div style="min-width:0">
<header ${anchor(2)} style="padding:32px 64px;border-bottom:1px solid #ddd;display:flex;justify-content:space-between;align-items:center"><strong style="font-size:28px">まちの学び舎</strong><nav style="font-size:18px">私たちについて　　講座一覧　　アクセス　　お問い合わせ</nav></header>
<section ${anchor(3)} style="padding:64px;display:grid;grid-template-columns:1.15fr 1fr;gap:48px;align-items:center"><div style="height:400px;background:#ddd;display:grid;place-items:center;font-size:20px;color:#555">メインビジュアル</div><div><p style="font-size:18px">OPEN CAMPUS 2026</p><h1 ${anchor(5)} style="font-size:44px;line-height:1.5;margin:24px 0">新しい一歩を、<br>この街から。</h1><p ${anchor(6)} style="font-size:22px;line-height:1.8">日常の中で、好きなことを見つける。<br>はじめての方も気軽に参加できます。</p><a ${anchor(7)} href="#courses" style="display:inline-block;padding:20px 48px;background:#333;color:white;text-decoration:none;font-size:20px">講座を探す →</a></div></section>
<section ${anchor(8)} style="padding:32px 64px;background:#f3f3f3;display:grid;grid-template-columns:repeat(3,1fr);gap:24px">${card('体験してみる','まずは一日、学びの時間を。',9)}${card('教室へのアクセス','駅から歩いて5分。',10)}${card('よくあるご質問','はじめての方はこちら。',11)}</section>
<section ${anchor(12)} id="courses" style="padding:80px 64px"><p style="font-size:18px;text-align:center">COURSES</p><h2 ${anchor(13)} style="font-size:36px;text-align:center;margin:24px 0 48px">あなたに合う学びを探す</h2><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:24px">${card('暮らしとデザイン','毎日を少し豊かにする、ものづくりの基本を学びます。',14)}${card('ことばと表現','ことばを通して、伝える楽しさを見つけます。',15)}${card('からだと健康','自分のペースで、心地よく体を動かしましょう。',16)}</div></section>
<section ${anchor(17)} style="padding:64px;background:#f6f6f6"><h2 style="font-size:32px;margin:0 0 32px">お知らせ</h2><p ${anchor(18)} style="padding:24px 0;border-bottom:1px solid #ccc;font-size:20px">2026.09.01　秋の体験講座の申し込みを開始しました</p><p ${anchor(19)} style="padding:24px 0;border-bottom:1px solid #ccc;font-size:20px">2026.08.20　新しい教室がオープンしました</p></section>
<footer ${anchor(20)} style="padding:64px;font-size:18px;border-top:1px solid #ddd">まちの学び舎　　お問い合わせ　　アクセス</footer>
</div>
<aside ${anchor(30)} style="padding:32px;background:#f5f5f5;border-left:1px solid #ddd;display:flex;flex-direction:column;gap:24px"><p style="margin:0;font-size:18px;line-height:1.8;color:#a42323">構成の確認用資料です。<br>色・写真はデザイン時に決定します。</p>${card('このページの役割','講座の魅力を伝え、体験の申し込みにつなげます。内容と順番をご確認ください。',31)}${card('最初に伝えること','写真と言葉で教室の雰囲気を伝えます。メインの導線は「講座を探す」です。',32)}${card('3つのご案内','よく使う入口を先にまとめます。気になる点は要素を選んでコメントしてください。',33)}${card('講座の見つけ方','講座の分類と説明文は打合せ後に調整します。',34)}</aside>
</main>`;

export const slides = [
`<div data-gg-src="slide:1" style="width:1920px;height:1080px;background:#f4f1ea;font-family:system-ui,sans-serif;color:#263c34;position:relative;overflow:hidden"><p data-gg-src="slide:1:eyebrow" style="position:absolute;left:120px;top:104px;font-size:24px;letter-spacing:4px">PROJECT PROPOSAL / 2026</p><h1 data-gg-src="slide:1:title" style="position:absolute;left:120px;top:280px;font-size:80px;line-height:1.5;margin:0">伝わる体験を、<br>いっしょにつくる。</h1><p data-gg-src="slide:1:body" style="position:absolute;left:128px;top:632px;font-size:30px;line-height:1.8">ウェブサイト リニューアルのご提案<br>2026年9月</p><div data-gg-src="slide:1:shape" style="position:absolute;left:1180px;top:200px;width:580px;height:640px;background:#d4dfd2;border-radius:280px 280px 16px 16px"></div><p style="position:absolute;left:128px;bottom:64px;font-size:22px">GROWGROUP　 /　PLAYGROUND</p></div>`,
`<div data-gg-src="slide:2" style="width:1920px;height:1080px;background:white;font-family:system-ui,sans-serif;color:#263c34;position:relative"><p style="position:absolute;left:120px;top:88px;font-size:24px">01 / APPROACH</p><h1 data-gg-src="slide:2:title" style="position:absolute;left:120px;top:180px;font-size:64px">迷わず、次の一歩へ。</h1><div style="position:absolute;left:120px;top:440px;width:1680px;display:grid;grid-template-columns:repeat(3,1fr);gap:40px">${card('理解する','誰に、何を伝えるか。使う人の視点から目的を整理します。',51)}${card('つくる','構成・言葉・デザインを一つの体験として組み立てます。',52)}${card('確かめる','実際に触れて、学んだことを次の改善へつなげます。',53)}</div></div>`,
];

/** マルチフレームのキャンバス確認用: 長さの違う 3 ページ */
export const webpagePages: { title: string; html: string }[] = [
  { title: 'トップページ', html: webpage },
  {
    title: '私たちについて',
    html: `<main ${anchor(101)} style="width:100%;font-family:system-ui,sans-serif;color:#242424;background:white">
<header ${anchor(102)} style="padding:32px 64px;border-bottom:1px solid #ddd;display:flex;justify-content:space-between;align-items:center"><strong style="font-size:28px">まちの学び舎</strong><nav style="font-size:18px">私たちについて　　講座一覧　　アクセス　　お問い合わせ</nav></header>
<section ${anchor(103)} style="padding:80px 64px"><p style="font-size:18px">ABOUT</p><h1 ${anchor(104)} style="font-size:44px;margin:24px 0">私たちについて</h1><p ${anchor(105)} style="font-size:20px;line-height:1.9;max-width:900px">まちの学び舎は、日常のなかで学びを続けたい人のための教室です。年齢や経験に関わらず、それぞれのペースで続けられる講座を用意しています。</p></section>
<section ${anchor(106)} style="padding:0 64px 80px;display:grid;grid-template-columns:repeat(2,1fr);gap:24px">${card('大切にしていること', '「続けられる」を第一に、少人数で進めます。', 107)}${card('講師について', '各分野で活動する講師が、実践に沿って教えます。', 108)}</section>
<footer ${anchor(109)} style="padding:64px;font-size:18px;border-top:1px solid #ddd">まちの学び舎　　お問い合わせ　　アクセス</footer>
</main>`,
  },
  {
    title: 'お問い合わせ',
    html: `<main ${anchor(201)} style="width:100%;font-family:system-ui,sans-serif;color:#242424;background:white">
<header ${anchor(202)} style="padding:32px 64px;border-bottom:1px solid #ddd;display:flex;justify-content:space-between;align-items:center"><strong style="font-size:28px">まちの学び舎</strong><nav style="font-size:18px">私たちについて　　講座一覧　　アクセス　　お問い合わせ</nav></header>
<section ${anchor(203)} style="padding:80px 64px;max-width:960px"><p style="font-size:18px">CONTACT</p><h1 ${anchor(204)} style="font-size:44px;margin:24px 0">お問い合わせ</h1><p ${anchor(205)} style="font-size:20px;line-height:1.9">講座の内容・見学のご希望など、お気軽にご連絡ください。</p><div ${anchor(206)} style="margin-top:40px;display:grid;gap:16px"><div style="height:56px;border:1px solid #bbb;display:flex;align-items:center;padding:0 16px;color:#777">お名前</div><div style="height:56px;border:1px solid #bbb;display:flex;align-items:center;padding:0 16px;color:#777">メールアドレス</div><div style="height:160px;border:1px solid #bbb;padding:16px;color:#777">お問い合わせ内容</div><div style="height:56px;width:240px;background:#333;color:white;display:flex;align-items:center;justify-content:center;font-size:18px">送信する</div></div></section>
<footer ${anchor(207)} style="padding:64px;font-size:18px;border-top:1px solid #ddd">まちの学び舎　　お問い合わせ　　アクセス</footer>
</main>`,
  },
];

/**
 * ?mode=svg … SVG の選択を確かめる見本。
 *   - ボタンの中のアイコン(線だけの矢印)
 *   - 文字の上に重なる装飾の SVG(斜めの線。箱は見出し・段落・ボタンを覆う)
 *   - 塗りのある SVG(円)
 */
export const svgProbe = `<main style="width:100%;font-family:system-ui,sans-serif;color:#242424;background:white">
<section id="svgprobe" style="position:relative;padding:64px">
<h2 id="probe-heading" style="font-size:36px;margin:0">見出し（SVG の下にある文字）</h2>
<p id="probe-text" style="font-size:18px;margin:16px 0 0">この段落は装飾の SVG の下にあります。クリックで選びたい。</p>
<a id="probe-btn" href="#" style="display:inline-flex;align-items:center;gap:8px;margin-top:24px;height:44px;padding:0 24px;background:#222;color:#fff;text-decoration:none"><span>ボタン</span><svg id="probe-icon" aria-hidden="true" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg></a>
<svg id="probe-overlay" style="position:absolute;left:0;top:0" width="900" height="260" viewBox="0 0 900 260" fill="none"><path d="M0 250 L900 10" stroke="#999" stroke-width="3"/></svg>
<div id="probe-drawn" style="position:absolute;left:420px;top:40px;width:360px;height:200px;background-color:transparent"><svg width="360" height="200" style="position:absolute;left:0;top:0;overflow:visible"><line x1="0" y1="0" x2="360" y2="200" stroke="#555" stroke-width="2"/></svg></div>
<svg id="probe-filled" style="position:absolute;right:64px;top:64px" width="120" height="120" viewBox="0 0 120 120"><circle cx="60" cy="60" r="50" fill="#e5e5e5"/></svg>
</section>
<section id="svgafter" style="padding:64px;background:#f3f3f3"><p id="after-text" style="font-size:18px;margin:0">SVG の無いセクション</p></section>
</main>`;
