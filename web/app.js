import {
  WEB_VERSION, compareNames, daysBetween, addDays, leaseMonths, validLink, esc, defaultState, photoStore,
  inventoryStatus, deductionSummary, DEDUCTION_QUESTIONS, sampleDeductions, roomProgress, recordClosed,
  recordDone, journey, leaseSteps, parseBackup,
} from './core.js';

const STORE = 'safelease-v1';
let stored = null;
try { stored = JSON.parse(localStorage.getItem(STORE)); } catch { stored = null; }
let state = migrate(stored || defaultState());

function migrate(s) {
  const base = defaultState();
  s.deductions ||= [];
  s.letters ||= {};
  s.letterStale ||= {};
  s.checks ||= [];
  s.reviewDrafts ||= [];
  s.rooms ||= base.rooms;
  s.record ||= base.record;
  // People who used an earlier version have already seen the app, so they skip the intro.
  if (s.onboarded === undefined) s.onboarded = true;
  return s;
}

let photos = [],
  urls = [],
  route = location.hash.slice(1) || (state.onboarded ? 'home' : 'onboarding'),
  room = null,
  moveout = false,
  cameraStream = null,
  captureDraft = null,
  markStart = null,
  selectedPhoto = null,
  template = state.template || 0,
  checkFiles = [],
  listDraft = { link: '', phone: '', address: '' },
  currentCheck = state.checks.at(-1),
  activeModal = null,
  returnFocus = null,
  toastTimer,
  progressTimer,
  checkRunning = false,
  checkProgress = 0,
  onboardPage = 0,
  pendingRestore = null,
  histIndex = 0,
  replacing = false;

const $ = s => document.querySelector(s),
  T = (en, zh) => (state.lang === 'zh' ? zh : en),
  I = (name, cls = '') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`,
  money = n => 'S$' + Number(n).toLocaleString('en-SG'),
  date = d => d ? new Intl.DateTimeFormat(state.lang === 'zh' ? 'zh-CN' : 'en-SG', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(d + 'T12:00:00Z')) : '—',
  today = () => (state.demo ? '2028-12-15' : new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' })),
  roomName = r => (state.lang === 'zh' ? r?.zh || r?.name : r?.name) || T('Item', '物品'),
  displayName = () => state.name?.trim() || T('there', '同学'),
  initials = () => (state.name || '').trim().split(/\s+/).filter(Boolean).map(n => n[0]).slice(0, 2).join('').toUpperCase();

const tag = (text, type = '') => `<span class="tag ${type}">${type === 'warn' ? I('warn') : type === 'ok' ? I('check') : ''}${text}</span>`,
  btn = (text, action, cls = '', icon = '', extra = '') => `<button type="button" class="btn ${cls}" data-action="${action}" ${extra}>${icon && icon !== 'arrow' ? I(icon) : ''}<span>${text}</span>${icon === 'arrow' ? I('arrow') : ''}</button>`,
  goBtn = (text, to, cls = '', icon = '') => btn(text, 'go:' + to, cls, icon),
  info = text => `<div class="info row start">${I('shield')}<div>${text}</div></div>`,
  legal = () => `<p class="caption">${T('General information, not legal advice.', '一般信息，不构成法律意见。')}</p>`,
  field = (label, name, value = '', type = 'text', extra = '') => `<label class="field"><span>${label}</span><input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`,
  avatar = (cls = '') => `<button class="avatar ${cls}" data-action="go:profile" aria-label="${T('My profile', '我的资料')}">${initials() ? esc(initials()) : I('user')}</button>`,
  pageHead = (title, sub = '', back = '') => `${back ? `<button class="back" data-action="back:${back}">${I('back')}<span>${T('Back', '返回')}</span></button>` : ''}<div class="pagehead"><h1>${title}</h1>${sub ? `<p class="muted">${sub}</p>` : ''}</div>`,
  stepHead = (n, title, sub = '') => `<div class="stephead"><span class="stepnum">${n}</span><div class="grow"><h2>${title}</h2>${sub ? `<p class="caption">${sub}</p>` : ''}</div></div>`;

function save() {
  try { localStorage.setItem(STORE, JSON.stringify(state)); }
  catch { toast(T('Could not save. Your browser storage may be full.', '保存失败。浏览器存储空间可能已满。')); }
}
function toast(s) {
  clearTimeout(toastTimer);
  $('#toast').textContent = s;
  $('#toast').classList.add('visible');
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3500);
}
function go(r) {
  closeModal();
  stopCamera();
  if (route === r) { render(); window.scrollTo(0, 0); }
  else location.hash = r;
}
function replaceRoute(r) {
  if (route === r) return render();
  replacing = true;
  location.replace('#' + r);
}
function back(fallback) {
  if (histIndex > 0) return history.back();
  history.replaceState({ i: 0 }, '', '#' + fallback);
  enterRoute(fallback);
}
function enterRoute(next) {
  stopCamera();
  closeModal();
  if (next !== route && ['record', 'moveout'].includes(next)) room = null;
  route = next;
  render();
  window.scrollTo(0, 0);
}

/* ---------- shell ---------- */

function currentTab() {
  if (['check', 'results', 'photo-match', 'payee', 'review', 'checking'].includes(route)) return 'check';
  if (['lease', 'record', 'add-lease', 'moveout', 'invite', 'landlord', 'locked'].includes(route)) return 'lease';
  if (['evidence', 'export', 'deduction-check'].includes(route)) return 'evidence';
  if (route === 'profile') return '';
  return 'home';
}
function nav() {
  const tabs = [['home', 'home', T('Home', '首页')], ['search', 'check', T('Check', '核查')], ['key', 'lease', T('Lease', '租约')], ['file', 'evidence', T('Evidence', '证据')]];
  return `<nav class="rail" aria-label="${T('Main navigation', '主导航')}"><a class="brandmark" href="#home" aria-label="SafeLease home">${I('logo')}</a>${tabs
    .map(([i, r, l]) => `<button class="navitem ${currentTab() === r ? 'active' : ''}" ${currentTab() === r ? 'aria-current="page"' : ''} data-action="go:${r}">${I(i)}<span>${l}</span></button>`)
    .join('')}${avatar('profile')}</nav>`;
}
function langButton() {
  return `<button class="lang" data-action="language" aria-label="${T('Switch to Chinese', '切换到英文')}">${state.lang === 'en' ? '<strong>EN</strong><span aria-hidden="true">中</span>' : '<span aria-hidden="true">EN</span><strong>中</strong>'}</button>`;
}
function shell(content) {
  const bare = route === 'onboarding' && !state.onboarded;
  return `${bare ? '' : nav()}<div class="shell ${bare ? 'bare' : ''} ${['record', 'results'].includes(route) ? 'wide' : ''}">${!navigator.onLine ? `<div class="offline">${I('wifi')}${T('You’re offline. Your records stay on this device.', '当前离线。记录保存在此设备上。')}</div>` : ''}<header class="topbar"><a class="row wordmark" href="#home"><span class="brandmark">${I('logo')}</span><span class="brandtext">SafeLease <span class="region">SG</span></span></a><div class="row gap8 tr">${langButton()}${bare ? '' : `<button class="iconbtn" data-action="go:notifications" aria-label="${T('Notifications', '通知')}">${I('bell')}${!state.notificationsRead ? '<i class="dot"></i>' : ''}</button>${avatar()}`}</div></header><main id="main" class="${['record', 'results'].includes(route) ? 'split' : ''}">${content}</main></div>`;
}
function demoLine() {
  return `<div class="demo-line">${I('lock')}<span>${T('Interactive preview · Data saved on this device', '交互预览 · 数据保存在此设备')}</span><button data-action="modal:about">${T('About this version', '关于此版本')}</button></div>`;
}
function listrow(icon, title, sub, action, color = '') {
  return `<button class="listrow" data-action="${action}"><span class="circle ${color}">${I(icon)}</span><div class="grow"><h3>${title}</h3>${sub ? `<p>${sub}</p>` : ''}</div>${I('chev', 'chevron')}</button>`;
}

/* ---------- journey ---------- */

function nextSteps() {
  const rp = roomProgress(state.rooms, photos);
  return {
    check: { title: T('Check the listing before you pay', '付款前先核查房源'), sub: T('Link or screenshots, plus the number you are messaging', '房源链接或截图，以及你正在联系的号码'), route: 'check' },
    payee: { title: T('Check who you are paying', '核对收款人'), sub: T('Compare the PayNow name with the owner', '比对 PayNow 姓名与业主'), route: 'payee' },
    'add-lease': { title: T('Add your lease details', '填写租约详情'), sub: T('Dates, deposit and refund clause', '日期、押金与退款条款'), route: 'add-lease' },
    'record-start': { title: T('Build your move-in record', '建立你的入住记录'), sub: T('Photograph each room before you unpack', '开箱前逐个房间拍照'), route: 'record' },
    'record-finish': { title: T('Finish your move-in record', '完成入住记录'), sub: `${rp.taken}/${rp.required} ${T('required photos taken', '张必需照片已拍摄')}`, route: 'record' },
    moveout: { title: T('Take your move-out photos', '拍摄退租照片'), sub: T('Same rooms, same angles', '同样的房间，同样的角度'), route: 'moveout' },
    letter: { title: T('Ask for itemised deductions', '索取扣款明细'), sub: T('Your letter is ready to edit', '信件已备好，可直接编辑'), route: 'evidence' },
    deductions: { title: T('Check each deduction', '逐项核对扣款'), sub: T('Four questions for every amount', '每笔扣款四个问题'), route: 'deduction-check' },
    deposit: { title: T('Prepare for a smooth handover', '为顺利交房做好准备'), sub: T('Dates, deposit and reminders', '日期、押金与提醒'), route: 'lease' },
    done: { title: T('Deposit returned', '押金已退还'), sub: T('Keep your export for your records', '请保留导出的记录'), route: 'lease' },
  };
}
function stageTrack(j) {
  const stages = [T('Check', '核查'), T('Pay', '付款'), T('Move in', '入住'), T('Live', '居住'), T('Move out', '退租')];
  return `<div class="stages" style="--p:${j.progress}%"><div class="stagebar"><i></i></div><ol aria-label="${T('Lease stages', '租约阶段')}">${stages
    .map((s, i) => `<li class="${i < j.stage ? 'done' : i === j.stage ? 'current' : ''}" ${i === j.stage ? 'aria-current="step"' : ''}><span class="sdot"></span><span class="slabel">${s}</span></li>`)
    .join('')}</ol></div>`;
}

function home() {
  const l = state.lease, j = journey(state, photos, today()), n = nextSteps()[j.next], rp = roomProgress(state.rooms, photos);
  const next = `<button class="hero-next" data-action="go:${n.route}"><span class="grow"><span class="eyebrow">${T('Your next step', '下一步')}</span><strong>${n.title}</strong>${n.sub ? `<span class="hero-sub">${n.sub}</span>` : ''}</span><span class="round-arrow">${I('arrow')}</span></button>`;
  const hero = l
    ? `<section class="hero"><div class="row between wrap gap8"><span class="eyebrow">${T('My lease', '我的租约')}</span>${tag(state.demo ? T('Sample lease', '示例租约') : T('Saved on this device', '保存在此设备'))}</div><h2>${esc(l.address)}</h2><p class="hero-meta">${date(l.start)} – ${date(l.end)} · ${money(l.rent)}${T('/mo', '/月')}</p>${stageTrack(j)}${next}</section>`
    : `<section class="hero"><span class="eyebrow">${T('Before you sign', '签约之前')}</span><h2>${T('Found a room? Check it before you pay.', '找到房间了？付款前先核查。')}</h2><p class="hero-meta">${T('A little preparation goes a long way.', '多一分准备，多一分安心。')}</p>${stageTrack(j)}${next}</section>`;
  const outs = photos.filter(p => p.moveout).length;
  const defs = {
    check: ['search', T('Check a listing', '核查房源'), T('Link or screenshot', '房源链接或截图')],
    payee: ['card', T('Check who you pay', '核对收款人'), T('PayNow name comparison', '比对 PayNow 收款姓名')],
    'add-lease': ['key', T('Add your lease', '添加租约'), T('Dates and deposit', '日期与押金')],
    record: ['cam', T('Move-in Record', '入住记录'), `${rp.taken}/${rp.required} ${T('photos', '张照片')}`],
    lease: ['wallet', T('Deposit tracker', '押金追踪'), l ? money(l.deposit) : ''],
    evidence: ['file', T('Evidence Pack', '证据包'), T('Letters and export', '信件与导出')],
    moveout: ['cam', T('Move-out photos', '退租照片'), `${outs} ${T('photos taken', '张照片已拍摄')}`],
    'deduction-check': ['search', T('Deduction Check', '扣款核对'), T('Four questions each', '每项四个问题')],
  };
  const order = !l ? ['check', 'payee', 'add-lease'] : j.stage <= 2 ? ['record', 'payee', 'lease'] : j.stage === 3 ? ['lease', 'evidence', 'record'] : ['moveout', 'evidence', 'deduction-check', 'lease'];
  const actions = order.filter(r => r !== n.route).slice(0, 2)
    .map(r => `<button class="card action-card" data-action="go:${r}"><span class="circle">${I(defs[r][0])}</span>${I('arrow', 'arrow')}<h3>${defs[r][1]}</h3><p>${defs[r][2]}</p></button>`).join('');
  const rem = [];
  if (!l) rem.push(listrow('key', T('Add your lease details', '填写租约详情'), T('Keep dates, deposit and photos together', '集中管理日期、押金与照片'), 'go:add-lease'));
  else {
    if (state.renewal && leaseMonths(l.start, l.end) + state.renewal > 24) rem.push(listrow('warn', T('Renewal would pass 2 years', '续租后将超过两年'), T('Check the length before you sign', '签约前请核对租期'), 'modal:renewal', 'warn'));
    if (j.toEnd > 0) rem.push(listrow('clock', `${j.toEnd} ${T('days to handover', '天后交房')}`, T('Make time for your move-out photos', '记得拍摄退租照片'), 'go:moveout', 'gray'));
    else if (j.toEnd === 0) rem.push(listrow('clock', T('Handover is today', '今天交房'), T('Take your move-out photos before you return the keys', '交还钥匙前拍摄退租照片'), 'go:moveout', 'gray'));
    else if (!state.refundReceived) rem.push(listrow('wallet', `${T('Refund due', '应退押金日期')} ${date(addDays(l.end, l.refundDays))}`, T('Ask for an itemised list if anything is deducted', '如有扣款，请索取明细'), 'go:evidence'));
  }
  const demo = state.demo
    ? `<section class="demo-banner"><span class="circle">${I('info')}</span><div class="grow"><h3>${T('You are exploring a sample lease', '你正在浏览示例租约')}</h3><p>${T('The student, flat and landlord here are fictional. Your own records start empty.', '示例中的学生、房源与房东均为虚构。你自己的记录将从空白开始。')}</p><button class="textbtn inline" data-action="modal:fresh">${T('Start with my own lease', '开始我的租约')}${I('arrow')}</button></div></section>`
    : '';
  return `<div class="greeting"><p class="muted">${T('Your rental, step by step.', '安心租房，一步一步来。')}</p><h1>${T('Hello, ', '你好，')}${esc(displayName())}</h1></div>${demo}${hero}<div class="actions">${actions}</div><section class="card flush"><div class="cardhead row between"><h2>${T('Reminders', '提醒')}</h2><button class="textbtn" data-action="go:notifications">${T('See all', '查看全部')}</button></div>${rem.join('')}</section><div class="footer-note">${I('shield')}${T('A little clarity, from your first viewing to your last day.', '从第一次看房，到交房的最后一天。')}</div>${demoLine()}`;
}

/* ---------- check ---------- */

function check() {
  return `${pageHead(T('Check a listing before you pay', '付款前先核查房源'), T('Free for every student. Know what to check next.', '面向所有学生免费开放。了解下一步需要核查什么。'))}<form id="check-form" class="stack"><div class="card"><label class="field"><span>${T('Listing link', '房源链接')}</span><input name="link" type="url" value="${esc(listDraft.link)}" placeholder="https://…" aria-describedby="link-help"></label><p class="caption mt8" id="link-help">${T('Facebook, Carousell, Telegram or a property portal', 'Facebook、Carousell、Telegram 或房产网站')}</p><div class="divider">${T('or', '或')}</div><button class="upload" type="button" data-action="upload-listing">${I(checkFiles.length ? 'check' : 'upload')}<span><strong>${checkFiles.length ? `${checkFiles.length} ${T('images selected', '张图片已选择')}` : T('Upload listing screenshots', '上传房源截图')}</strong><span class="caption">${checkFiles.length ? T('Tap to choose again', '点按重新选择') : T('Up to 5 images · 10 MB each', '最多 5 张图片 · 每张 10 MB')}</span></span></button><input id="listing-files" type="file" accept="image/*" multiple hidden><p id="check-error" role="alert" class="caption red mt8"></p></div><div class="card stack"><h3>${T('Add what you know', '补充已知信息')} <span class="caption">${T('(optional)', '（选填）')}</span></h3>${field(T('Number you’re messaging', '你正在联系的号码'), 'phone', listDraft.phone, 'tel', 'inputmode="tel" placeholder="+65 9123 4567"')}${field(T('Address', '地址'), 'address', listDraft.address, 'text', `placeholder="${T('Property address', '房源地址')}"`)}</div><div class="notice-banner">${I('info')}<span>${T('Live listing analysis is not connected in this preview. Your input will produce a “Not checked” result with practical next steps.', '此预览未接入实时房源分析。你提交的内容会显示“未核查”及建议的后续步骤。')}</span></div><button class="btn" id="run-check" type="submit" ${(!validLink(listDraft.link) && !checkFiles.length) || !navigator.onLine ? 'disabled' : ''}>${I('search')}<span>${T('Run checks', '开始核查')}</span></button><p class="caption center">${T('Results say what was checked, how, and when. Warnings are not verdicts.', '结果会说明核查内容、方法和时间。警示并非定论。')}</p><button class="btn ghost" type="button" data-action="sample-check"><span>${T('Explore the sample check', '查看示例核查结果')}</span>${I('arrow')}</button>${state.checks.length
    ? `<div class="card flush"><div class="cardhead"><h3>${T('Recent checks', '最近核查')}</h3></div>${state.checks.slice(-3).reverse().map(c => listrow('search', esc(c.address || T('Listing check', '房源核查')), date(c.created.slice(0, 10)), `check-open:${c.id}`)).join('')}</div>`
    : ''}</form>`;
}
function checking() {
  return `${pageHead(T('Preparing your check…', '正在准备核查…'))}<div class="card center"><div class="spinner"></div><h2>${checkProgress}/4 ${T('steps ready', '项步骤已准备')}</h2><p class="muted mt8">${T('Organising your listing and next steps', '整理房源信息与下一步指引')}</p></div><div class="card mt timeline">${[T('Reading your input', '读取输入'), T('Checking service availability', '检查服务可用性'), T('Preparing the CEA guided step', '准备 CEA 手动核查步骤'), T('Preparing your results', '准备结果')].map((s, i) => `<div class="timeline-row"><div class="step-dot ${i < checkProgress ? 'done' : i === checkProgress ? 'current' : ''}">${i < checkProgress ? I('check') : i + 1}</div><p>${s}</p></div>`).join('')}</div>`;
}
function statusCard(title, body, status, source, extra = '', action = '') {
  const type = { warning: 'warn', step: '', checked: 'ok', none: 'none' }[status],
    label = { warning: T('Warning', '警示'), step: T('Your step', '待你核查'), checked: T('Checked', '已核查'), none: T('Not checked', '未核查') }[status];
  return `<section class="card statuscard st-${status}"><div class="row between wrap"><h3>${title}</h3>${tag(label, type)}</div><p class="muted">${body}</p>${extra}<div class="source">${source}</div>${action}</section>`;
}
function results() {
  const c = currentCheck;
  if (!c) return `${pageHead(T('Your listing checks', '房源核查'))}<div class="card empty"><span class="circle">${I('search')}</span><h2>${T('No checks yet', '还没有核查记录')}</h2><p class="muted">${T('Found a room you like? Check it before you pay anything.', '找到喜欢的房间了？付款前先核查。')}</p>${goBtn(T('Check a listing', '核查房源'), 'check')}</div>`;
  return `${pageHead(T('Your check results', '核查结果'), T('The details matter. Here’s what we know.', '细节很重要。以下是已知的信息。'), 'check')}<div class="card row between wrap bottom-space"><div><h3>${esc(c.address || T('Listing check', '房源核查'))}</h3><p class="caption mt8">${c.sample ? T('Sample: common room · S$950/mo', '示例：普通房 · S$950/月') : esc(c.link || T('Uploaded screenshots', '已上传的截图'))}</p></div>${tag(c.sample ? T('Sample results', '示例结果') : T('Saved locally', '已存于本机'), 'red')}</div><div class="split-grid"><div class="stack">${c.sample
    ? statusCard(T('Listing photos', '房源照片'), T('3 of 5 photos also appear in another listing with a different address.', '5 张照片中有 3 张也出现在另一地址的房源中。'), 'warning', T('Sample reverse image search · 21 Jul 2027, 10:42', '示例图片反向搜索 · 2027年7月21日 10:42'), '', goBtn(T('See the photo comparison', '查看照片比对'), 'photo-match', 'secondary small mt'))
    : statusCard(T('Listing photos', '房源照片'), T('Image search is not connected. No search has been performed. This is not a warning about the listing.', '图片搜索尚未接入，未执行搜索。这不是针对该房源的警示。'), 'none', T('Service availability checked', '已检查服务可用性') + ' · ' + date(c.created.slice(0, 10)))}${c.sample
    ? statusCard(T('Payment request', '付款要求'), T('The sample post asks for a booking deposit before a viewing. Ask for the tenancy agreement and clarify any payment request.', '示例帖子要求看房前支付预订押金。请先索取租约并确认任何付款要求。'), 'warning', T('Read from the supplied sample · 21 Jul 2027, 10:42', '来自所附示例 · 2027年7月21日 10:42'))
    : statusCard(T('Payment request', '付款要求'), T('The listing text has not been analysed. Review any requests to pay before a viewing.', '尚未分析房源文本。请留意任何看房前付款要求。'), 'none', T('No analysis service connected', '未连接分析服务'))}${statusCard(T('Agent’s phone number', '中介的手机号码'), c.cea === 'match' ? T('You reported finding a registered agent with this mobile number.', '你已报告找到使用此手机号的注册中介。') : c.cea === 'no' ? T('You reported no matching agent for this mobile number. Ask the person to clarify their role.', '你已报告没有找到匹配的注册中介。请对方说明身份。') : T('Search the number you are actually messaging. A name or registration number alone is not enough.', '请查询你实际联系的手机号码。仅有姓名或注册号码并不足够。'), c.cea === 'match' ? 'checked' : c.cea === 'no' ? 'warning' : 'step', T('CEA Public Register · guided step · reported by you', 'CEA 公共登记册 · 手动核查 · 由你报告') + (c.ceaAt ? ' · ' + date(c.ceaAt.slice(0, 10)) : ''), `<p class="phone-line"><strong>${esc(c.phone || '+65 9123 4567')}</strong></p>`, btn(c.cea ? T('Update your answer', '更新你的回答') : T('Open CEA guided check', '打开 CEA 核查指引'), 'modal:cea', 'secondary small mt'))}</div><div class="stack">${statusCard(T('Owner’s name', '业主姓名'), T('Compare the name in your tenancy agreement with the visible letters shown by PayNow before paying.', '付款前，请比对租约中的业主姓名与 PayNow 显示的可见字母。'), 'none', T('The app never connects to your bank', '本应用不会连接你的银行'))}<div class="card"><h3>${T('Before you pay', '付款前')}</h3><div class="stack mt checklist">${[T('View in person or by live video', '实地或实时视频看房'), T('Get the tenancy agreement first', '先取得租约'), T('Check the owner named in it', '核对租约中的业主')].map((s, i) => `<label class="row small"><input type="checkbox" data-checklist="${i}" ${c.checklist?.[i] ? 'checked' : ''}><span>${s}</span></label>`).join('')}</div></div>${goBtn(T('Next, check who you’re paying', '下一步：核对收款人'), 'payee', '', 'arrow')}<button class="textbtn" data-action="go:review">${T('Ask a person to review it', '申请人工复核')}</button></div></div>${demoLine()}`;
}
function payee() {
  return `${pageHead(T('Check who you’re paying', '核对你要付款的对象'), T('Compare the visible letters before you confirm a transfer.', '确认转账前，比对可见字母。'), 'home')}<div class="stack">${info(T('In your banking app, start the PayNow transfer but <strong>don’t confirm</strong>. Type the name it shows below.', '在银行应用中开始 PayNow 转账，但<strong>不要确认</strong>。在下方输入显示的姓名。'))}<div class="card stack">${field(T('Name shown by PayNow', 'PayNow 显示的姓名'), 'masked', state.masked || '', 'text', 'id="masked" class="mono" placeholder="TaX MeX LiXX" autocomplete="off" autocapitalize="characters" spellcheck="false"')}${field(T('Owner named in your tenancy agreement', '租约中的业主姓名'), 'owner', state.payeeOwner || state.lease?.owner || '', 'text', 'id="payee-owner" autocapitalize="characters"')}<p class="caption">${T('Enter these names yourself. No banking connection is used.', '请自行输入姓名。本应用不连接银行。')}</p></div><div id="comparison" aria-live="polite"></div><div class="row wrap gap8 sample-row"><span class="caption">${T('Try the sample', '试用示例')}</span>${btn(T('Letters match', '字母一致'), 'payee:match', 'ghost small')}${btn(T('Letters differ', '字母不同'), 'payee:mismatch', 'ghost small')}</div><button class="textbtn" data-action="go:review">${T('Company or co-owner? Ask for a manual review', '公司或共同业主？申请人工复核')}</button><div class="footer-note">${I('shield')}${T('SafeLease never holds or moves your money.', 'SafeLease 从不持有或转移你的资金。')}</div></div>`;
}
function renderComparison() {
  if (!$('#comparison')) return;
  const a = $('#masked').value, b = $('#payee-owner').value, result = compareNames(a, b),
    aw = a.trim().toUpperCase().split(/\s+/), bw = b.trim().toUpperCase().split(/\s+/);
  let html = result === 'empty' ? '' : `<div class="card"><h3>${T('Letter by letter', '逐字母比对')}</h3><div class="comparator mt">${aw.map((w, i) => `<div class="word">${[...w].map((c, j) => `<div class="letter-cell ${c === 'X' ? '' : c === bw[i]?.[j] ? 'match' : 'miss'}"><b>${esc(c)}</b><span>${esc(bw[i]?.[j] || '–')}</span></div>`).join('')}</div>`).join('')}</div></div>`;
  if (result === 'match') html += `<div class="success mt"><div class="row">${I('check')}<h3>${T('Visible letters match the owner’s name', '可见字母与业主姓名一致')}</h3></div><p class="mt8">${T('PayNow shows only some letters. A match cannot prove identity.', 'PayNow 仅显示部分字母。匹配结果并不能证明身份。')}</p></div>${state.lease ? goBtn(T('Back to my lease', '返回我的租约'), 'lease', 'secondary mt', 'arrow') : goBtn(T('Next, add your lease details', '下一步：填写租约详情'), 'add-lease', 'mt', 'arrow')}`;
  if (result === 'mismatch') html += `<div class="stop mt" role="alert"><div class="row">${I('stop')}<h2>${T('Don’t transfer yet', '请暂时不要转账')}</h2></div><p>${T('The visible letters don’t match. Ask the owner to confirm the account in writing before paying.', '可见字母不匹配。付款前请业主以书面方式确认账户。')}</p>${btn(T('Copy a message to the owner', '复制发给业主的消息'), 'copy-payee', 'secondary mt', 'copy')}</div>`;
  if (result === 'few' || result === 'manual') html += `<div class="info mt">${tag(result === 'few' ? T('Not checked', '未核查') : T('Your step', '待你核查'), 'none')}<p class="mt8">${result === 'few' ? T('Too few visible letters to compare. Ask the owner to confirm the account in writing.', '可见字母太少，无法比对。请业主书面确认账户。') : T('This name needs a manual review, including company accounts or names using other scripts.', '此姓名需要人工复核，包括公司账户或其他文字的姓名。')}</p></div>`;
  $('#comparison').innerHTML = html;
  state.masked = a;
  state.payeeOwner = b;
  save();
}

/* ---------- lease ---------- */

function addLease() {
  const l = state.lease || {}, needName = !state.name?.trim();
  return `${pageHead(state.lease ? T('Edit lease details', '修改租约详情') : T('Add your lease', '添加租约'), T('Keep the important details in one place.', '将重要信息保存在一个地方。'), state.lease ? 'lease' : 'home')}<form id="lease-form" class="stack"><div class="info row start">${I('file')}<div>${T('Read these details from your agreement. You can edit them at any time.', '请根据租约填写这些信息。你可以随时修改。')}</div></div>${needName ? `<div class="card stack">${field(T('Your name, used to sign your letters', '你的姓名（用于信件署名）'), 'yourName', '', 'text', 'required maxlength="80" autocomplete="name"')}</div>` : ''}<div class="card stack"><h3>${T('The property', '房源')}</h3>${field(T('Property address', '房源地址'), 'address', l.address, 'text', 'required')}${field(T('Owner’s full name', '业主全名'), 'owner', l.owner, 'text', 'required')}</div><div class="card stack"><h3>${T('Dates and money', '日期与金额')}</h3><div class="grid2">${field(T('Lease starts', '租约开始日期'), 'start', l.start, 'date', 'required')}${field(T('Lease ends', '租约结束日期'), 'end', l.end, 'date', 'required')}</div><div class="grid2">${field(T('Monthly rent (S$)', '月租（新币）'), 'rent', l.rent || 950, 'number', 'min="0" step="0.01" required')}${field(T('Deposit (S$)', '押金（新币）'), 'deposit', l.deposit || 950, 'number', 'min="0" step="0.01" required')}</div><div class="grid2">${field(T('Refund within (days)', '退款期限（天）'), 'refundDays', l.refundDays || 14, 'number', 'min="1" max="365" required')}${field(T('Refund clause', '退款条款'), 'clause', l.clause || '4.2')}</div><p class="caption">${T('Check the refund deadline in your agreement.', '请核对租约中的退款期限。')}</p></div><p id="lease-error" class="red small" role="alert"></p><button class="btn" type="submit"><span>${state.lease ? T('Save changes', '保存修改') : T('Save and continue', '保存并继续')}</span>${I('arrow')}</button>${legal()}</form>`;
}
function stepSubs() {
  const l = state.lease, r = state.record, rp = roomProgress(state.rooms, photos), inv = inventoryStatus(photos), outs = photos.filter(p => p.moveout).length;
  return {
    record: r.status === 'locked' ? T('Both confirmed', '双方已确认') : r.status === 'one_sided' ? T('Kept as a one-sided record', '已保存为单方记录') : r.confirmed ? T('Confirmed by you', '你已确认') : rp.taken ? `${rp.taken}/${rp.required} ${T('photos', '张照片')}${inv.missing ? ` · ${inv.missing} ${T('lines missing', '条描述待补')}` : ''}` : T('Ready to start', '可以开始记录'),
    moveout: outs ? `${outs} ${T('photos taken', '张照片已拍摄')}` : T('Before you hand over the keys', '交还钥匙前'),
    letter: state.letterPrepared ? `${T('Prepared', '已准备')} ${date(state.letterPrepared)}` : T('If any amount is deducted', '如有押金扣款'),
    refund: state.refundReceived ? T('Received', '已收到') : `${date(addDays(l.end, l.refundDays))} · ${l.refundDays} ${T('days after handover', '天（交房后）')}`,
  };
}
function lease() {
  const l = state.lease;
  if (!l) return `${pageHead(T('My lease', '我的租约'))}<div class="card empty"><span class="circle">${I('key')}</span><h2>${T('Your next chapter starts here', '你的租房生活，从这里开始')}</h2><p class="muted">${T('Add your lease to keep track of your deposit and important dates.', '添加租约，管理押金和重要日期。')}</p>${goBtn(T('Add your lease', '添加租约'), 'add-lease')}</div>`;
  const left = daysBetween(today(), l.end), months = leaseMonths(l.start, l.end),
    progress = Math.max(0, Math.min(100, 100 * (daysBetween(l.start, today()) / Math.max(1, daysBetween(l.start, l.end))))),
    subs = stepSubs(),
    titles = { record: T('Move-in Record', '入住记录'), moveout: T('Move-out photos', '退租照片'), letter: T('Request itemised deductions', '索取扣款明细'), refund: T('Refund due', '应退押金日期') },
    routes = { record: 'record', moveout: 'moveout', letter: 'evidence', refund: 'evidence' };
  const steps = leaseSteps(state, photos).map((s, i) => `<button class="timeline-row step-btn" data-action="go:${routes[s.key]}"><span class="step-dot ${s.done ? 'done' : s.current ? 'current' : ''}">${s.done ? I('check') : i + 1}</span><span class="grow"><strong>${titles[s.key]}</strong><span class="caption">${subs[s.key]}</span></span>${s.current ? tag(T('Next', '下一步'), 'red') : ''}${I('chev', 'chevron')}</button>`).join('');
  const renewal = state.renewal && months + state.renewal > 24
    ? `<section class="warning"><div class="row start">${I('warn')}<div class="grow"><h3>${T('Renewal offer, check the length', '续租提议：请核对总租期')}</h3><p>${T(`Renewing for ${state.renewal} months would make this tenancy ${months + state.renewal} months long. Residential tenancies must not exceed 2 years to fall within the Small Claims Tribunals’ tenancy jurisdiction.`, `续租 ${state.renewal} 个月后，总租期将为 ${months + state.renewal} 个月。小额索偿庭的住宅租约管辖范围限于不超过两年的租约。`)}</p><div class="row wrap gap8 mt8">${btn(T('See your options', '查看选项'), 'modal:renewal', 'secondary small')}<a class="caption" href="https://www.judiciary.gov.sg/civil/cases-eligible-small-claim" target="_blank" rel="noopener">${T('Singapore Courts guidance ↗', '新加坡法院指引 ↗')}</a></div>${legal()}</div></div></section>`
    : btn(T('Consider a renewal', '考虑续租'), 'modal:renewal', 'ghost');
  return `${pageHead(T('Deposit tracker', '押金追踪'), esc(l.address))}<div class="stack"><section class="hero"><div class="row between wrap gap8"><span class="eyebrow">${T('Your deposit', '你的押金')}</span>${tag(state.refundReceived ? T('Refund received', '已收到退款') : T('Kept by your landlord', '由房东持有'))}</div><div class="money">${money(l.deposit)}</div><p>${T('Lease ends', '租约结束')} ${date(l.end)} · <strong>${left > 0 ? left + ' ' + T('days left', '天后到期') : left === 0 ? T('Handover today', '今天交房') : T('Lease ended', '租约已结束')}</strong></p><div class="progress"><i style="width:${progress}%"></i></div><div class="row between mt8 hero-dates"><span>${date(l.start)}</span><span>${date(l.end)}</span></div></section>${state.demo ? `<p class="caption">${T('Sample timeline · As of 15 Dec 2028', '示例时间线 · 以2028年12月15日为准')}</p>` : ''}<section class="card timeline steps-card"><h3 class="card-title">${T('Steps to get your deposit back', '取回押金的步骤')}</h3>${steps}</section>${renewal}<section class="card row between"><div class="grow"><h3>${T('Move-out reminder', '退租提醒')}</h3><p class="caption mt8">${T('7 days before handover · export to your calendar', '交房前 7 天 · 导出至日历')}</p></div><button class="toggle ${state.reminders ? 'on' : ''}" role="switch" aria-checked="${state.reminders}" aria-label="${T('Move-out reminders', '退租提醒')}" data-action="toggle-reminders"></button></section><div class="btnpair">${btn(T('Add calendar reminder', '添加日历提醒'), 'calendar', 'secondary', 'calendar', state.reminders ? '' : 'disabled')}${btn(state.refundReceived ? T('Refund received', '已收到退款') : T('Mark refund received', '标记已收到退款'), 'refund', state.refundReceived ? 'ghost done-btn' : 'ghost', state.refundReceived ? 'check' : 'wallet')}</div>${goBtn(T('Edit lease details', '修改租约详情'), 'add-lease', 'ghost', 'pen')}${demoLine()}</div>`;
}

/* ---------- photos and records ---------- */

function photoURL(p) {
  const u = URL.createObjectURL(p.blob);
  urls.push(u);
  return u;
}
const QTEXT = () => ({ clause: T('Clause relied on', '依据的条款'), required: T('What it required', '条款要求什么'), breach: T('How it was breached', '如何违反'), loss: T('Loss and its basis', '损失及依据') });
const inventoryLabel = p => `${roomName(state.rooms[p.room])} · ${p.note?.trim() || T('No condition line yet', '尚无状况描述')}`;
function inventoryCard(items, r) {
  const st = inventoryStatus(items);
  return `<section class="card stack" aria-labelledby="inv-title"><div class="row between wrap gap8"><h3 id="inv-title">${T('Agreed inventory', '共同确认的清单')}</h3>${st.total ? tag(st.missing ? `${st.missing} ${st.missing === 1 ? T('line missing', '条待补') : T('lines missing', '条待补')}` : T('Every photo has a line', '每张照片均有描述'), st.missing ? 'warn' : 'ok') : ''}</div><p class="caption">${T('Each in-app photo needs a one-line condition note. Both sides confirm this list, not just the photos.', '每张应用内照片都需要一句状况描述。双方确认的是这份清单，而不只是照片。')}</p>${st.total
    ? `<div class="inv-list">${state.rooms.map((rm, i) => items.filter(p => p.room === i).map(p => `<button class="inv-item" data-action="photo:${p.id}"><span class="eyebrow muted">${esc(roomName(rm))}</span><span class="${p.note?.trim() ? '' : 'red'}">${esc(p.note?.trim() || T('Add a condition line', '添加状况描述'))}</span><span class="caption">${T('You', '你')} ${r.confirmed ? '✓' : '—'} · ${T('Landlord', '房东')} ${r.status === 'locked' ? T('sample ✓', '示例 ✓') : '—'}</span></button>`).join('')).join('')}</div>`
    : `<p class="caption">${T('Your list builds itself as you photograph and note each item.', '拍照并描述每件物品后，清单会自动生成。')}</p>`}<p class="caption">${T('Photos and videos are not the same thing as an agreed inventory (JHK v JHL [2026] SGSCT 16 [63]).', '法庭指出，照片和视频不等同于共同确认的清单（JHK v JHL [2026] SGSCT 16 [63]）。')}</p></section>`;
}
function photoTile(p) {
  return `<button class="card photo" data-action="photo:${p.id}"><img src="${photoURL(p)}" alt="${esc(p.note || roomName(state.rooms[p.room]))}"><p class="small photo-note">${p.note?.trim() ? esc(p.note) : p.moveout ? T('Room photo', '房间照片') : `<span class="red">${T('Add a condition line', '添加状况描述')}</span>`}</p><p class="caption">${I('lock')}${T('SHA-256 fingerprint · local', 'SHA-256 指纹 · 本地')}</p></button>`;
}
function clockText() {
  const r = state.record;
  if (r.status === 'locked') return T('Both confirmed · locked', '双方已确认 · 已锁定');
  if (r.status === 'one_sided') return T('One-sided record', '单方记录');
  if (!r.started) return T('Your first photo starts the clock', '第一张照片启动计时');
  const left = Math.max(0, 48 * 3600000 - (Date.now() - r.started));
  return `${Math.floor(left / 3600000)} ${T('h', '小时')} ${Math.floor((left % 3600000) / 60000)} ${T('min', '分钟')}`;
}
function record() {
  if (!state.lease) return lease();
  const r = state.record, rp = roomProgress(state.rooms, photos), closed = recordClosed(state), items = photos.filter(p => !p.moveout), inv = inventoryStatus(photos);
  if (room === null || room >= state.rooms.length) room = rp.firstIncomplete >= 0 ? rp.firstIncomplete : 0;
  const cur = rp.rooms[room], selected = items.filter(p => p.room === room),
    nextRoom = rp.rooms.findIndex((x, i) => i !== room && !x.done),
    pct = rp.required ? Math.round((100 * rp.taken) / rp.required) : 0;
  const hero = `<section class="hero compact"><div class="row between start"><div class="grow"><span class="eyebrow">${closed ? T('Record status', '记录状态') : r.started ? T('Additions open for', '补充记录剩余时间') : T('Ready when you are', '准备好即可开始')}</span><h2 id="record-clock">${clockText()}</h2></div><span class="hero-icon">${I(closed ? 'lock' : 'clock')}</span></div><div class="progress"><i style="width:${pct}%"></i></div><div class="row between wrap hero-foot"><span>${rp.taken}/${rp.required} ${T('required photos', '张必需照片')}</span><span>${inv.missing ? `${inv.missing} ${T('lines missing', '条描述待补')}` : inv.total ? T('Every photo has a line', '每张照片均有描述') : T('Device time · no cloud backup', '设备时间 · 无云端备份')}</span></div></section>`;
  const tabs = `<div class="roomtabs" aria-label="${T('Rooms', '房间')}">${state.rooms.map((rm, i) => { const x = rp.rooms[i]; return `<button class="roomtab ${i === room ? 'active' : ''} ${x.done ? 'done' : ''}" aria-pressed="${i === room}" data-action="room:${i}"><span class="roomtab-icon">${I(x.done ? 'check' : 'cam')}</span><span class="roomtab-name">${esc(roomName(rm))}</span><span class="count">${x.n}/${x.required}</span></button>`; }).join('')}</div>`;
  const manage = !closed ? `<div class="row wrap gap8">${btn(T('Add a room or item', '添加房间或物品'), 'modal:add-room', 'ghost small', 'plus')}${btn(T('Edit photo counts', '编辑照片数量'), 'modal:room-counts', 'ghost small', 'pen')}</div>` : '';
  const left = cur.required - cur.n;
  const camBtns = closed
    ? btn(T('Take photo', '拍照'), 'camera:in', '', 'cam', 'disabled')
    : cur.done && nextRoom >= 0
      ? `<div class="btnpair">${btn(T(`Go to ${roomName(state.rooms[nextRoom])}`, `前往${roomName(state.rooms[nextRoom])}`), 'room:' + nextRoom, '', 'arrow')}${btn(T('Add another photo', '再拍一张'), 'camera:in', 'ghost', 'cam')}</div>`
      : btn(T('Take photo', '拍照'), 'camera:in', '', 'cam');
  const panel = `<section class="card stack roompanel"><div class="row between start gap8"><div class="grow"><h2>${esc(roomName(state.rooms[room]))}</h2><p class="caption mt8">${closed ? T('This record is closed.', '记录已关闭。') : cur.done ? T('All required photos taken. Add more if something needs a closer look.', '必需照片已拍完。如有细节需要记录，可继续补拍。') : T(`${left} more ${left === 1 ? 'photo' : 'photos'} needed. Capture wide views, surfaces and any existing marks.`, `还需 ${left} 张。拍摄全景、表面和任何已有痕迹。`)}</p></div>${tag(`${cur.n}/${cur.required}`, cur.done ? 'ok' : 'red')}</div>${selected.length ? `<div class="photos">${selected.map(photoTile).join('')}</div>` : `<div class="photo-empty">${I('cam')}<span>${T('No photos of this room yet', '此房间尚无照片')}</span></div>`}${camBtns}<p class="caption">${T('Only the in-app camera is used so the original capture can be fingerprinted.', '仅使用应用内相机，以便为原始拍摄内容生成指纹。')}</p></section>`;
  const firstBlank = items.find(p => !String(p.note || '').trim());
  const todo = [
    ...rp.rooms.map((x, i) => (x.done ? '' : `<button class="todo" data-action="room:${i}">${I('circle')}<span class="grow">${esc(roomName(state.rooms[i]))}</span><span class="caption">${T(`${x.required - x.n} more`, `还需 ${x.required - x.n} 张`)}</span></button>`)),
    inv.missing ? `<button class="todo" data-action="photo:${firstBlank.id}">${I('pen')}<span class="grow">${T('Condition lines', '状况描述')}</span><span class="caption">${T(`${inv.missing} missing`, `${inv.missing} 条待补`)}</span></button>` : '',
  ].join('');
  const ready = rp.complete && inv.ready;
  const confirm = `<section class="card stack"><h3>${T('Confirm the inventory', '确认清单')}</h3><div class="row between"><span>${T('You', '你')}</span>${tag(r.confirmed ? T('Confirmed', '已确认') : T('Not confirmed', '未确认'), r.confirmed ? 'ok' : 'none')}</div><div class="row between"><span>${T('Landlord', '房东')}</span>${tag(r.status === 'locked' ? T('Sample confirmation', '示例确认') : r.status === 'one_sided' ? T('Not confirmed', '未确认') : T('Not invited', '未邀请'), 'none')}</div>${!r.confirmed && !closed
    ? `${todo ? `<div class="todo-list"><p class="eyebrow muted">${T('Still to do', '尚未完成')}</p>${todo}</div>` : ''}${btn(T('I’ve finished, confirm my inventory', '我已完成，确认清单'), 'confirm-record', '', 'check', ready ? '' : 'disabled')}<p class="caption">${ready ? T('All required photos have a condition line.', '所有必需照片均已有状况描述。') : T('Finish the list above to confirm.', '完成上方事项后即可确认。')}</p>`
    : r.confirmed && !closed ? goBtn(T('Landlord confirmation options', '房东确认选项'), 'invite', 'secondary', 'arrow') : ''}</section>`;
  return `${pageHead(T('Move-in Record', '入住记录'), esc(state.lease.address), 'lease')}<div class="stack">${hero}<div class="split-grid"><div class="stack sticky-col">${tabs}${manage}</div><div class="stack">${panel}${inventoryCard(items, r)}${confirm}</div></div>${demoLine()}</div>`;
}
function moveOut() {
  if (!state.lease) return lease();
  const hasIn = i => photos.some(p => p.room === i && !p.moveout), hasOut = i => photos.some(p => p.room === i && p.moveout);
  if (room === null || room >= state.rooms.length) { const k = state.rooms.findIndex((_, i) => hasIn(i) && !hasOut(i)); room = k >= 0 ? k : 0; }
  const original = photos.find(p => p.room === room && !p.moveout), after = photos.filter(p => p.room === room && p.moveout),
    nextRoom = state.rooms.findIndex((_, i) => i !== room && hasIn(i) && !hasOut(i));
  return `${pageHead(T('Move-out photos', '退租照片'), T('Same room. Same angle. A clearer comparison.', '同一房间，同一角度，让对比更清晰。'), 'lease')}<div class="stack"><div class="chips">${state.rooms.map((r, i) => `<button class="chip ${i === room ? 'active' : ''}" aria-pressed="${i === room}" data-action="room:${i}">${hasOut(i) ? I('check') : ''}${esc(roomName(r))}</button>`).join('')}</div><div class="grid2 compare"><div class="card"><h3>${T('Move-in', '入住')}</h3>${original ? `<img class="full mt" src="${photoURL(original)}" alt="${T('Move-in reference', '入住参考照片')}">` : `<div class="photo-empty mt">${I('cam')}</div>`}<p class="caption mt8">${original ? esc(original.note) : T('No move-in photo for this room', '此房间尚无入住照片')}</p></div><div class="card"><h3>${T('Move-out', '退租')}</h3>${after[0] ? `<img class="full mt" src="${photoURL(after[0])}" alt="${T('Move-out photo', '退租照片')}">` : `<div class="photo-empty mt">${I('cam')}</div>`}<p class="caption mt8">${after.length} ${T('photos taken', '张照片已拍摄')}</p></div></div>${info(T('Match the angle of your move-in photo. When available, a ghost overlay helps you line up the camera.', '请匹配入住照片的角度。如已有入住照片，相机将显示半透明叠加图帮助对齐。'))}${after.length && nextRoom >= 0 ? `<div class="btnpair">${btn(T(`Go to ${roomName(state.rooms[nextRoom])}`, `前往${roomName(state.rooms[nextRoom])}`), 'room:' + nextRoom, '', 'arrow')}${btn(T('Add another photo', '再拍一张'), 'camera:out', 'ghost', 'cam')}</div>` : btn(T('Take matching photo', '拍摄对比照片'), 'camera:out', '', 'cam')}${after.length ? `<div class="photos">${after.map(photoTile).join('')}</div>` : ''}${goBtn(T('Open Evidence Pack', '打开证据包'), 'evidence', 'secondary', 'file')}</div>`;
}

/* ---------- evidence ---------- */

const letterKey = () => state.lang + template;
function lettersChanged(templates = [0, 1, 2]) {
  for (const lang of ['en', 'zh']) for (const t of templates) if (state.letters[lang + t]) state.letterStale[lang + t] = true;
}
function letterTools() {
  const key = letterKey(), edited = !!state.letters[key], stale = edited && state.letterStale[key];
  return `<div class="row between wrap gap8">${tag(edited ? T('Edited by you', '已手动编辑') : T('Built from your records', '按你的记录生成'), edited ? 'red' : 'none')}${edited ? btn(T('Reset to template', '恢复模板'), 'letter-reset', 'ghost small', 'back') : ''}</div>${stale ? `<div class="warning small-warning">${T('Your details changed after you edited this letter. Reset it to rebuild from your records, or keep editing.', '你编辑信件后，相关信息已有更新。可恢复模板按记录重新生成，或继续手动编辑。')}</div>` : ''}`;
}
function evidence() {
  if (!state.lease) return lease();
  const sum = deductionSummary(state.deductions, state.lease.deposit),
    names = [T('Request itemised deductions', '索取扣款明细'), T('Dispute a deduction', '质疑扣款'), T('Final notice', '最后通知')],
    hints = [T('Start here, around handover. It asks the landlord to list every deduction with evidence.', '交房前后先用这一封，请房东列明每项扣款及证据。'), T('Use this when one amount seems unfair.', '某笔扣款不合理时使用。'), T('Use this after the refund deadline has passed.', '退款期限已过时使用。')];
  const details = template === 1
    ? `<div class="card stack"><div class="grid2">${field(T('Deducted item', '扣款项目'), 'deduction', state.deduction || '', 'text', `id="deduction" placeholder="${T('e.g. stove cleaning', '例如：炉灶清洁')}"`)}${field(T('Amount (S$)', '金额（新币）'), 'deductionAmount', state.deductionAmount || '', 'number', 'id="deduction-amount" min="0" step="0.01"')}</div><label class="field"><span>${T('Reason', '原因')}</span><select id="deduction-reason">${[T('Existed at move-in', '入住时已存在'), T('Fair wear and tear', '正常损耗'), T('No evidence given', '未提供证据')].map((s, i) => `<option value="${i}" ${state.deductionReason == i ? 'selected' : ''}>${s}</option>`).join('')}</select></label></div>`
    : template === 0
      ? `<section class="card flush">${listrow('search', T('Deduction Check', '扣款核对'), sum.items.length ? `${sum.items.length} ${T('deductions', '项扣款')} · ${sum.open} ${T('open points', '个未回答问题')}${state.dedInLetter ? ' · ' + T('in your letter', '已加入信件') : ''}` : T('Optional. Check each deduction against four questions a tribunal asks', '选填。按法庭会问的四个问题逐项核对扣款'), 'go:deduction-check')}</section>`
      : `<div class="info row start">${I('calendar')}<div>${T(`The refund was due on ${date(addDays(state.lease.end, state.lease.refundDays))}. The letter gives a further 7 days.`, `押金应于 ${date(addDays(state.lease.end, state.lease.refundDays))} 前退还。信件另给 7 天期限。`)}</div></div>`;
  const attach = [
    [T('Move-in Record', '入住记录'), photos.filter(p => !p.moveout).length + ' ' + T('photos', '张照片'), 'in'],
    [T('Move-out photos', '退租照片'), photos.filter(p => p.moveout).length + ' ' + T('photos', '张照片'), 'out'],
    [T('Timeline of key dates', '重要日期时间线'), T('Lease, handover and refund dates', '租约、交房及退款日期'), 'timeline'],
  ].map(([t, s, k]) => `<label class="row"><input type="checkbox" data-attachment="${k}" ${state.attachments?.[k] === false ? '' : 'checked'}><div class="grow"><h3 class="small">${t}</h3><p class="caption">${s}</p></div>${I('file')}</label>`).join('');
  return `${pageHead(T('Evidence Pack', '证据包'), T('Your record. Your words. Ready when you need them.', '你的记录，你的陈述，随时准备好。'))}<div class="stack"><section class="stepblock">${stepHead(1, T('Choose a letter', '选择信件'))}<div class="chips">${names.map((s, i) => `<button class="chip ${template === i ? 'active' : ''}" aria-pressed="${template === i}" data-action="template:${i}">${s}</button>`).join('')}</div><p class="caption">${hints[template]}</p></section><section class="stepblock">${stepHead(2, T('Add the details', '补充细节'))}${details}</section><section class="stepblock">${stepHead(3, T('Read and edit', '阅读并编辑'), T('Changes are saved on this device.', '更改保存在此设备上。'))}<div id="letter-tools" class="stack">${letterTools()}</div><div class="letterpaper" id="letter" contenteditable="true" role="textbox" aria-multiline="true" aria-label="${T('Edit evidence letter', '编辑证据信件')}">${esc(letterText())}</div></section><section class="stepblock">${stepHead(4, T('Choose attachments', '选择附件'))}<div class="card attachments">${attach}</div></section><section class="stepblock">${stepHead(5, T('Export or copy', '导出或复制'))}<div class="btnpair">${goBtn(T('Preview & export PDF', '预览并导出 PDF'), 'export', '', 'file')}${btn(T('Copy letter', '复制信件'), 'copy-letter', 'secondary', 'copy')}</div><p class="caption">${T('A template you complete and send yourself. General information, not legal advice. SafeLease never holds or moves your money.', '这是一份由你自行填写和发送的模板。一般信息，不构成法律意见。SafeLease 从不持有或转移你的资金。')}</p><a class="caption" href="https://www.judiciary.gov.sg/civil/cases-eligible-small-claim" target="_blank" rel="noopener">${T('Read the Small Claims Tribunals eligibility guidance ↗', '查看小额索偿庭的受理条件 ↗')}</a></section></div>`;
}
function deductionCheck() {
  if (!state.lease) return lease();
  const l = state.lease, sum = deductionSummary(state.deductions, l.deposit), inv = photos.filter(p => !p.moveout && p.note?.trim()), q = QTEXT(),
    total = sum.items.length * 4, stated = total - sum.open, keptPct = l.deposit ? Math.min(100, (100 * sum.kept) / l.deposit) : 0;
  const cta = !sum.items.length
    ? btn(T('Add a deduction first', '请先添加扣款'), 'ded-letter', '', 'file', 'disabled')
    : btn(sum.open ? T(`Add ${sum.open} open ${sum.open === 1 ? 'point' : 'points'} to my letter`, `将 ${sum.open} 个未回答问题加入信件`) : T('Use these deductions in my letter', '在信件中使用这些扣款'), 'ded-letter', '', 'file');
  return `${pageHead(T('Deduction Check', '扣款核对'), T('Four questions the landlord should answer for each deduction.', '房东应就每项扣款回答的四个问题。'), 'evidence')}<div class="stack"><section class="card stack"><p>${T(`The landlord kept <strong id="ded-kept">${money(sum.kept)}</strong> of your <strong>${money(l.deposit)}</strong> deposit.`, `房东从你的 <strong>${money(l.deposit)}</strong> 押金中扣留了 <strong id="ded-kept">${money(sum.kept)}</strong>。`)}</p><div class="progress"><i style="width:${keptPct}%"></i></div>${sum.items.length ? `<p class="caption"><span id="ded-stated">${stated}</span>/${total} ${T('points stated by the landlord', '个问题已由房东说明')}</p>` : ''}${sum.overDeposit ? `<p class="caption red">${T('The deductions entered are more than the deposit. Check the amounts.', '已输入的扣款超过押金，请核对金额。')}</p>` : ''}</section>${sum.items.map((d, i) => `<section class="card stack ded" aria-label="${esc(d.item)}"><div class="row between"><h3>${esc(d.item || T('Deduction', '扣款'))}</h3><strong>${money(d.amount)}</strong></div>${DEDUCTION_QUESTIONS.map((k, n) => `<label class="dq"><span class="qn">${n + 1}</span><span class="grow"><span class="dq-head"><span class="small strong">${q[k]}</span><span data-dtag="${i}:${k}">${d.missing.includes(k) ? tag(T('Not stated', '未说明'), 'red') : tag(T('Stated', '已说明'), 'ok')}</span></span><input data-ded="${i}:${k}" value="${esc(state.deductions[i][k] || '')}" placeholder="${T('Not stated yet', '尚未说明')}" maxlength="200"></span></label>`).join('')}<label class="field"><span>${T('In the agreed inventory?', '是否在共同确认的清单中？')}</span><select data-ded="${i}:inventory"><option value="">${T('Not recorded at move-in', '入住时未记录')}</option>${inv.map(p => `<option value="${p.id}" ${d.inventory === p.id ? 'selected' : ''}>${esc(inventoryLabel(p))}</option>`).join('')}</select></label>${d.inventory ? tag(T('Recorded at move-in', '入住时已记录'), 'warn') : ''}${btn(T('Remove', '删除'), 'ded-remove:' + i, 'ghost small', 'x')}</section>`).join('')}<form id="ded-form" class="card stack"><h3>${T('Add a deduction', '添加扣款')}</h3><div class="grid2">${field(T('Item', '项目'), 'item', '', 'text', `required maxlength="80" placeholder="${T('e.g. cleaning', '例如：清洁')}"`)}${field(T('Amount (S$)', '金额（新币）'), 'amount', '', 'number', 'required min="0" step="0.01"')}</div><button class="btn secondary" type="submit">${I('plus')}<span>${T('Add', '添加')}</span></button>${!state.deductions.length ? btn(T('Load sample deductions', '载入示例扣款'), 'ded-sample', 'ghost small') : ''}</form>${cta}<p class="caption">${T('Questions from JJK v JJL [2026] SGSCT 28 [17], namely the clause relied on, what it required, the breach and the loss. A published decision, quoted. General information, not legal advice. No outcome is predicted.', '问题来自 JJK v JJL [2026] SGSCT 28 [17]：依据的条款、条款要求、违约事实和损失。此处引用已公开的判决。一般信息，不构成法律意见；不预测任何结果。')}</p></div>`;
}
function dedLetterLines() {
  const q = QTEXT(), sum = deductionSummary(state.deductions, state.lease?.deposit);
  if (!state.dedInLetter || !sum.items.length) return '';
  const lines = sum.items.map(d => {
    const p = photos.find(x => x.id === d.inventory), parts = [];
    if (d.missing.length) parts.push(T('not yet stated: ', '尚未说明：') + d.missing.map(k => q[k].toLowerCase()).join(T('; ', '；')));
    if (p) parts.push(T(`this item is in my move-in record dated ${date(String(p.created).slice(0, 10))} (“${p.note.trim()}”)`, `此项已记录于 ${date(String(p.created).slice(0, 10))} 的入住记录（“${p.note.trim()}”）`));
    return `- ${d.item} (${money(d.amount)}): ${parts.join(T('; ', '；')) || T('all four points stated', '四项均已说明')}`;
  });
  return T('\n\nFor each deduction, please state the clause relied on, what it required, how it was breached and the loss claimed with its basis.\n', '\n\n请就每项扣款说明所依据的条款、条款要求、如何违反以及主张的损失及其依据。\n') + lines.join('\n');
}
function letterText(fresh = false) {
  const key = letterKey();
  if (!fresh && state.letters[key]) return state.letters[key];
  const l = state.lease,
    deadline = date(template ? addDays(today() > l.end ? today() : l.end, 7) : addDays(l.end, l.refundDays) > today() ? addDays(l.end, l.refundDays) : addDays(today(), 14)),
    reason = [T('the condition existed at move-in', '入住时已存在此状况'), T('this is fair wear and tear', '属于正常损耗'), T('no supporting evidence was given', '尚未提供支持证据')][state.deductionReason || 0],
    amount = state.deductionAmount ? money(state.deductionAmount) : T('[amount]', '[金额]'),
    item = state.deduction || T('[deducted item]', '[扣款项目]'),
    signer = state.name?.trim() || T('[your name]', '[你的姓名]');
  return T(
    `Dear ${l.owner},\n\nRegarding my tenancy at ${l.address}, ending on ${date(l.end)}, and the ${money(l.deposit)} deposit under clause ${l.clause} of our agreement.\n\n${template === 0 ? `Please send an itemised list of any proposed deductions, with supporting evidence, by ${deadline}.${dedLetterLines()}` : template === 1 ? `I am writing to dispute the ${amount} deduction for ${item}, because ${reason}. Please review the attached record and respond by ${deadline}.` : `Please confirm the return of the outstanding deposit by ${deadline}. If we cannot resolve this, I will consider the available dispute-resolution routes, subject to the relevant eligibility requirements.`}\n\n${photos.length ? 'My locally dated photo record is included where selected. It has not been independently verified.' : 'I will provide any relevant supporting evidence separately.'}\n\nYours sincerely,\n${signer}`,
    `尊敬的 ${l.owner}：\n\n关于位于 ${l.address}、于 ${date(l.end)} 结束的租约，以及根据租约第 ${l.clause} 条支付的 ${money(l.deposit)} 押金。\n\n${template === 0 ? `请于 ${deadline} 前提供任何拟议扣款的详细清单及支持证据。${dedLetterLines()}` : template === 1 ? `我对 ${item} 的 ${amount} 扣款提出异议，因为${reason}。请核查所附记录并于 ${deadline} 前回复。` : `请于 ${deadline} 前确认归还尚未退还的押金。如无法协商解决，我将根据适用的受理条件考虑可用的争议解决途径。`}\n\n${photos.length ? '如已选择，随信附上本地记录日期的照片。此记录未经独立核实。' : '我将另行提供相关支持证据。'}\n\n此致\n${signer}`,
  );
}
function exportPage() {
  if (!state.lease) return lease();
  const l = state.lease, selected = photos.filter(p => state.attachments?.[p.moveout ? 'out' : 'in'] !== false);
  return `${pageHead(T('Export preview', '导出预览'), T('Use your browser’s “Save as PDF” destination.', '请选择浏览器中的“另存为 PDF”。'), 'evidence')}<div class="no-print row wrap bottom-space">${btn(T('Print / Save as PDF', '打印 / 另存为 PDF'), 'print', '', 'dl')}<span class="caption">${T('Includes your letter and selected records', '包含信件和选定记录')}</span></div><article class="print-page"><div class="row between print-brand"><strong>SafeLease SG</strong><span class="caption">${T('Local evidence export', '本地证据导出')}</span></div><h1 class="mt">${T('Evidence Pack', '证据包')}</h1><p class="muted mt8">${esc(l.address)}</p><div class="letterpaper plain">${esc(letterText())}</div>${state.attachments?.timeline !== false ? `<div class="card"><h3>${T('Key dates', '重要日期')}</h3><p class="mt8">${T('Lease begins', '租约开始')} · ${date(l.start)}<br>${T('Handover', '交房')} · ${date(l.end)}<br>${T('Refund due', '应退日期')} · ${date(addDays(l.end, l.refundDays))}</p></div>` : ''}<p class="caption mt">${T('General information, not legal advice. SafeLease never holds or moves money.', '一般信息，不构成法律意见。SafeLease 从不持有或转移资金。')}</p>${selected.length ? `<h2 class="mt">${T('Photo records', '照片记录')}</h2><div class="print-photos mt">${selected.map(p => `<figure><img src="${photoURL(p)}" alt="${esc(p.note)}"><figcaption><strong>${esc(roomName(state.rooms[p.room]))} · ${p.moveout ? T('Move-out', '退租') : T('Move-in', '入住')}</strong><br>${esc(p.note)}<br>${esc(p.created)} · ${T('Device time', '设备时间')}<br>SHA-256: ${p.hash}</figcaption></figure>`).join('')}</div><h3 class="mt">${T('About the fingerprints', '关于照片指纹')}</h3><p class="small mt8">${T('Each SHA-256 fingerprint describes the original captured file. It can be used to check whether those bytes have changed. It does not prove when a photo was taken or that a room was in a particular condition. No server verification or landlord authentication is provided in this preview.', '每个 SHA-256 指纹对应原始拍摄文件，可用于检查文件字节是否发生变化，但不能证明拍摄时间或房间状况。此预览不提供服务器核验或房东身份认证。')}</p>` : ''}</article>`;
}

/* ---------- other pages ---------- */

function review() {
  return `${pageHead(T('Ask a person to review', '申请人工复核'), T('Prepare the context a reviewer would need.', '准备复核人员需要的信息。'), 'results')}<form id="review-form" class="stack"><div class="notice-banner">${I('info')}<span>${T('Reviewer delivery is not connected. You can save and download your review request. Nothing is sent automatically.', '尚未连接人工复核服务。你可以保存并下载复核申请；不会自动发送。')}</span></div><div class="card stack"><h3>${T('Which result?', '需要复核哪一项？')}</h3>${[T('Listing photos', '房源照片'), T('Agent’s phone number', '中介手机号码'), T('Payment request', '付款要求'), T('Payee, company or co-owner', '收款人：公司或共同业主')].map((s, i) => `<label class="row small"><input type="radio" name="result" value="${i}" ${i === 0 ? 'checked' : ''}><span>${s}</span></label>`).join('')}</div><label class="field"><span>${T('What should we know?', '请说明情况')}</span><textarea name="note" maxlength="500" required placeholder="${T('Add any context that may help…', '补充有帮助的背景信息……')}"></textarea><span class="caption" id="review-counter">0 / 500</span></label><button class="btn" type="submit">${I('dl')}<span>${T('Save & download review request', '保存并下载复核申请')}</span></button></form>`;
}
function invite() {
  return `${pageHead(T('Ask your landlord to confirm', '请房东确认'), T('A shared record makes the details clear for both of you.', '双方确认，让记录更清楚。'), 'record')}<div class="stack">${info(T('Secure sharing is not connected in this local preview. Export your record and share it yourself. The sample below demonstrates the landlord’s screen without contacting anyone.', '本地预览尚未接入安全分享。请导出记录并自行分享。下方示例仅演示房东页面，不会联系任何人。'))}<section class="stepblock">${stepHead(1, T('Export your record', '导出你的记录'))}${goBtn(T('Export my record', '导出我的记录'), 'export', '', 'file')}</section><section class="stepblock">${stepHead(2, T('Send it with this message', '附上这条消息发送'))}<div class="card"><p class="muted">${esc(inviteText())}</p>${btn(T('Copy message', '复制消息'), 'copy-invite', 'secondary mt', 'copy')}</div></section><section class="stepblock">${stepHead(3, T('Or keep it as your own record', '或保存为你自己的记录'))}${btn(T('Keep as a one-sided record', '保存为单方记录'), 'one-sided', 'ghost', 'lock')}${goBtn(T('Preview landlord screen', '预览房东页面'), 'landlord', 'ghost', 'user')}</section></div>`;
}
function inviteText() {
  return T(`Hi ${state.lease?.owner || ''}, I have prepared a move-in photo record for ${state.lease?.address || ''}. Please review the exported photos and reply in writing if they reflect the condition at move-in. Thank you, ${state.name?.trim() || ''}.`, `您好 ${state.lease?.owner || ''}，我已为 ${state.lease?.address || ''} 准备入住照片记录。请查看导出的照片，并书面回复是否符合入住时的状况。谢谢，${state.name?.trim() || ''}。`);
}
function landlord() {
  const ins = photos.filter(p => !p.moveout);
  return `${pageHead(T('Review the move-in record', '查看入住记录'), T('Landlord screen · demonstration only', '房东页面 · 仅作演示'), 'invite')}<div class="stack"><div class="notice-banner">${I('info')}<span>${T('This is a local demonstration, not an authenticated landlord confirmation.', '这是本地演示，不是经过身份验证的房东确认。')}</span></div><div class="card"><h2>${esc(state.lease?.address || '')}</h2><p class="muted mt8">${T('Prepared by', '记录人')} ${esc(displayName())} · ${ins.length} ${T('photos', '张照片')}</p></div><div class="photos">${ins.slice(0, 8).map(photoTile).join('')}</div><section class="card stack"><h3>${T('Inventory to confirm', '待确认的清单')}</h3>${ins.map(p => `<p class="small">${esc(inventoryLabel(p))}</p>`).join('') || `<p class="caption">${T('No items yet.', '暂无项目。')}</p>`}</section>${info(T('Confirming would mean agreeing to each condition line above as the state of the unit at move-in. Review every image and line first.', '确认意味着认可上述每条状况描述为入住时的单位状况。请先检查每张照片及描述。'))}<form id="landlord-form" class="stack">${field(T('Your name', '你的姓名'), 'landlordName', '', 'text', 'required')}<button class="btn" type="submit"><span>${T('Preview confirmation', '预览确认结果')}</span></button>${btn(T('Add a sample comment', '添加示例评论'), 'modal:comment', 'ghost')}${btn(T('Preview declined state', '预览拒绝确认状态'), 'demo-decline', 'ghost')}</form>${legal()}</div>`;
}
function locked() {
  return `${pageHead(T('Record confirmation preview', '记录确认预览'), '', 'record')}<div class="card empty"><span class="circle big">${I('lock')}</span><h1>${T('Both parties confirmed', '双方已确认')}</h1><p class="muted">${T('This is a demonstration of the locked state. Your actual local record has not been changed by this preview.', '这是已锁定状态的演示。此预览没有修改你的实际本地记录。')}</p><div class="stack mt">${goBtn(T('Back to my record', '返回我的记录'), 'record')}${goBtn(T('Go to Deposit', '查看押金'), 'lease', 'ghost')}</div></div>`;
}
function notifications() {
  const l = state.lease;
  return `${pageHead(T('Notifications', '通知'), T('The next things to keep in mind.', '需要留意的下一步事项。'), 'home')}<div class="row between bottom-space"><span class="eyebrow muted">${T('Lease reminders', '租约提醒')}</span>${state.notificationsRead ? '' : `<button class="textbtn" data-action="mark-read">${T('Mark all read', '全部标记已读')}</button>`}</div><div class="card flush ${!state.notificationsRead ? 'unread' : ''}">${l ? `${listrow('clock', T('Plan your move-out photos', '安排退租拍照'), date(addDays(l.end, -7)), 'notice:moveout', 'gray')}${listrow('wallet', T('Keep an eye on your deposit', '留意押金退款'), T('Refund due', '应退日期') + ' ' + date(addDays(l.end, l.refundDays)), 'notice:lease')}${state.renewal ? listrow('warn', T('Review the renewal length', '核对续租期限'), T('Check your total tenancy length', '检查总租期'), 'notice:lease', 'warn') : ''}` : listrow('key', T('Add a lease to get started', '添加租约开始使用'), T('Your important dates will appear here', '重要日期将显示在这里'), 'notice:add-lease')}</div><p class="caption mt">${T('These reminders are shown in the app. Export a calendar reminder for an alert outside the app.', '这些提醒仅显示在应用中。导出日历提醒可在应用外获得提示。')}</p>`;
}
function profile() {
  return `${pageHead(T('Me & privacy', '个人资料与隐私'), '', 'home')}<div class="stack"><div class="card row"><div class="avatar profile-big">${initials() ? esc(initials()) : I('user')}</div><div class="grow"><h2>${esc(state.name?.trim() || T('Your name', '你的姓名'))}</h2><p class="caption mt8">${esc(state.email || T('No email added', '尚未添加邮箱'))}</p><div class="mt8">${tag(state.demo ? T('Sample profile', '示例资料') : T('Local profile', '本地资料'), 'red')}</div></div></div><section class="card flush">${listrow('user', T('Edit profile', '编辑资料'), T('Name and email for your letters', '用于信件的姓名与邮箱'), 'modal:profile')}${listrow('globe', T('Language', '语言'), state.lang === 'en' ? 'English' : '中文', 'language')}${listrow('shield', T('School partner', '学校合作方'), state.school || T('No school added', '尚未添加学校'), 'modal:school')}</section><div class="settings-heading">${T('Your data', '你的数据')}</div><section class="card flush">${listrow('info', T('What is stored', '存储哪些信息'), T('On this browser, under your control', '保存在此浏览器，由你掌控'), 'modal:privacy')}${listrow('dl', T('Download all my data', '下载我的全部数据'), T('JSON including original photos', '包含原始照片的 JSON 文件'), 'download-data')}${listrow('upload', T('Restore from a backup', '从备份恢复'), T('Load a SafeLease_Backup.json file', '载入 SafeLease_Backup.json 文件'), 'restore-pick')}${listrow('x', T('Delete local data', '删除本地数据'), T('Remove this browser’s records', '删除此浏览器中的记录'), 'modal:delete', 'stop')}</section><input id="restore-file" type="file" accept="application/json,.json" hidden>${info(T('This preview stores photos in your browser, not in the cloud. There is no school access or automatic 12-month deletion service. No NRIC or FIN is collected. Export a backup before clearing browser data.', '此预览将照片保存在浏览器中，不上传云端。学校无法访问，也未接入 12 个月自动删除服务。不收集 NRIC 或 FIN。清理浏览器前请导出备份。'))}<div class="row wrap gap8">${btn(T('About SafeLease', '关于 SafeLease'), 'go:onboarding', 'ghost small')}${btn(T('Preview capabilities', '预览功能说明'), 'modal:about', 'ghost small')}${state.demo ? '' : btn(T('Load the sample lease', '载入示例租约'), 'modal:sample', 'ghost small')}</div><p class="caption center">SafeLease SG · ${T('Web', '网页版')} ${WEB_VERSION}</p></div>`;
}
function onboarding() {
  const first = !state.onboarded, last = onboardPage === 2,
    titles = [T('Check before you pay', '付款前先核查'), T('Record before you move in', '入住前先记录'), T('Keep track of your deposit', '追踪你的押金')],
    bodies = [T('See exactly what has been checked, what hasn’t, and what to do next.', '了解哪些已核查、哪些未核查，以及下一步如何做。'), T('Capture room-by-room photos and record the details while they’re fresh.', '逐个房间拍摄照片，及时记录细节。'), T('Keep key dates together and prepare an evidence letter when you need one.', '集中管理重要日期，需要时准备证据信件。')];
  const actions = last
    ? first
      ? `${btn(T('Explore the sample lease', '浏览示例租约'), 'onboard-done:sample', '', 'arrow')}${btn(T('Start with my own lease', '开始我的租约'), 'onboard-done:own', 'secondary', 'plus')}<p class="caption">${T('You can switch any time from your profile.', '之后可随时在个人资料中切换。')}</p>`
      : goBtn(T('Back to SafeLease', '返回 SafeLease'), 'home', '', 'arrow')
    : `${btn(T('Next', '下一步'), 'onboard:' + (onboardPage + 1), '', 'arrow')}${first ? btn(T('Skip', '跳过'), 'onboard:2', 'ghost') : goBtn(T('Skip', '跳过'), 'home', 'ghost')}`;
  return `<div class="onboard"><div class="onboard-art"><span class="circle">${I(['search', 'cam', 'file'][onboardPage])}</span><span class="circle">${I(['shield', 'lock', 'wallet'][onboardPage])}</span></div><p class="eyebrow muted">${onboardPage + 1} / 3</p><h1 class="intro-title">${titles[onboardPage]}</h1><p class="muted">${bodies[onboardPage]}</p><div class="dots">${titles.map((_, i) => `<button class="${i === onboardPage ? 'on' : ''}" data-action="onboard:${i}" aria-label="${T('Page', '页面')} ${i + 1}" ${i === onboardPage ? 'aria-current="step"' : ''}></button>`).join('')}</div><div class="stack">${actions}</div><p class="caption onboard-for">SafeLease SG · ${T('For international students renting in Singapore', '为在新加坡租房的国际学生而设')}</p></div>`;
}
function photoMatch() {
  return `${pageHead(T('Photo comparison', '照片比对'), T('Sample result from the supplied design', '来自所附设计的示例结果'), 'results')}<div class="stack">${tag(T('Warning · sample', '警示 · 示例'), 'warn')}<div class="grid2">${[T('This listing', '当前房源'), T('Found elsewhere', '其他来源')].map(s => `<div class="card"><div class="photo-empty">${I('house')}</div><h3 class="mt">${s}</h3><p class="caption mt8">${T('Reference placeholder, no source image supplied', '参考占位图，未提供源照片')}</p></div>`).join('')}</div><div class="card stack"><div class="row between"><span class="muted small">${T('Other address', '另一地址')}</span><strong class="small">Blk 21 Dover Cres</strong></div><div class="row between"><span class="muted small">${T('Listed rent', '刊登租金')}</span><strong class="small">S$1,250/mo</strong></div><p class="caption">${T('Illustrative details, not a live search result.', '仅为示例信息，并非实时搜索结果。')}</p></div><div class="warning"><h3>${T('What this can mean', '这可能意味着什么')}</h3><p>${T('An image may be reused for several reasons, including an owner reposting an old photo. Ask for a live video viewing of the exact unit.', '图片被重复使用可能有多种原因，例如业主重新使用旧照片。请要求针对该单位进行实时视频看房。')}</p></div>${goBtn(T('Report a wrong match', '报告匹配错误'), 'review', 'secondary')}</div>`;
}

const TITLES = () => ({ home: T('Home', '首页'), check: T('Check a listing', '核查房源'), results: T('Check results', '核查结果'), payee: T('Check who you pay', '核对收款人'), lease: T('Deposit tracker', '押金追踪'), 'add-lease': T('Lease details', '租约详情'), record: T('Move-in Record', '入住记录'), moveout: T('Move-out photos', '退租照片'), evidence: T('Evidence Pack', '证据包'), 'deduction-check': T('Deduction Check', '扣款核对'), export: T('Export', '导出'), profile: T('Me & privacy', '个人资料与隐私'), notifications: T('Notifications', '通知'), onboarding: T('Welcome', '欢迎') });

function render() {
  urls.forEach(u => URL.revokeObjectURL(u));
  urls = [];
  document.documentElement.lang = state.lang === 'zh' ? 'zh-CN' : 'en';
  const pages = { home, check, checking: () => (checkRunning ? checking() : results()), results, payee, lease, 'add-lease': addLease, record, moveout: moveOut, evidence, 'deduction-check': deductionCheck, export: exportPage, review, invite, landlord, locked, notifications, profile, onboarding, 'photo-match': photoMatch };
  $('#app').innerHTML = shell((pages[route] || home)());
  document.title = `${TITLES()[route] || 'SafeLease'} · SafeLease SG`;
  if (route === 'payee') renderComparison();
}

/* ---------- modals ---------- */

function modal(title, body, name = '') {
  returnFocus = document.activeElement;
  activeModal = name;
  const d = $('#dialog');
  d.innerHTML = `<div class="row between modalhead"><h2 id="modal-title" tabindex="-1">${title}</h2><button data-action="close" aria-label="${T('Close', '关闭')}">${I('x')}</button></div><div class="modalbody">${body}</div>`;
  d.setAttribute('aria-labelledby', 'modal-title');
  if (!d.open) d.showModal();
  $('#modal-title').focus();
}
function closeModal() {
  const d = $('#dialog');
  if (d.open) d.close();
  activeModal = null;
  stopCamera();
  if (returnFocus?.isConnected) returnFocus.focus();
}
function openModal(name) {
  const l = state.lease;
  const map = {
    about: [T('Built for the whole lease', '陪伴整个租约周期'), `<p>${T('A working, local-first preview of SafeLease SG using your red-and-white design.', '根据红白设计构建的 SafeLease SG 本地功能预览。')}</p><div class="card stack"><h3>${T('Available now', '现有功能')}</h3><p>${T('Lease details and reminders, name comparison, guided CEA checks, camera photos with SHA-256 fingerprints, an agreed inventory with a condition line per photo, a Deduction Check, editable letters, print-to-PDF, data export and restore. English and Chinese are supported.', '租约详情与提醒、姓名比对、CEA 核查指引、带 SHA-256 指纹的相机照片、每张照片附状况描述的共同清单、扣款核对、可编辑信件、打印为 PDF、数据导出与恢复。支持中英文。')}</p></div><p class="caption">${T('Not connected yet. Live image or OCR analysis, email accounts, payments, reviewers, secure landlord links, Singapore cloud storage, server time and scheduled deletion. Sample content is labelled.', '尚未接入：实时图片或 OCR 分析、邮箱账户、支付、人工复核、安全房东链接、新加坡云存储、服务器时间和定时删除。示例内容已标注。')}</p><p class="caption">SafeLease SG · ${T('Web', '网页版')} ${WEB_VERSION}</p>`],
    privacy: [T('Your data stays here', '数据保存在本机'), `<p>${T('Lease details and settings are saved in localStorage. Original camera captures, timestamps, SHA-256 fingerprints, notes and annotation layers are saved in IndexedDB.', '租约详情与设置保存在 localStorage。原始相机照片、时间、SHA-256 指纹、备注和标注层保存在 IndexedDB。')}</p><p>${T('Nothing is uploaded to a server. Other browsers and devices cannot see this data. Clearing browser data removes it. Export your data to keep a backup.', '不会上传到服务器。其他浏览器和设备无法查看这些数据。清理浏览器会删除数据，请导出备份。')}</p><p>${T('For production, the design requires Singapore-region storage and deletion 12 months after lease end. Those services are not active in this preview.', '生产版本需使用新加坡区域存储，并在租约结束 12 个月后删除照片。这些服务在预览中尚未启用。')}</p>`],
    cea: [T('Check the number on the CEA register', '在 CEA 登记册核查手机号'), `<div class="timeline">${[
      [T('Copy the number', '复制手机号码'), `<div class="row wrap"><strong>${esc(currentCheck?.phone || '+65 9123 4567')}</strong>${btn(T('Copy', '复制'), 'copy-phone', 'ghost small', 'copy')}</div>`],
      [T('Search by mobile number', '按手机号搜索'), `<p class="caption">${T('The register opens in a new tab. Return here after searching.', '登记册将在新标签页中打开。查询后请返回此处。')}</p><a class="btn mt" href="https://eservices.cea.gov.sg/aceas/public-register/sales/1" target="_blank" rel="noopener">${T('Open CEA Public Register ↗', '打开 CEA 公共登记册 ↗')}</a>`],
      [T('Tell us what you found', '告诉我们查询结果'), `<div class="grid2 mt">${btn(T('Matching agent', '找到匹配中介'), 'cea:match', 'secondary small')}${btn(T('No match', '未找到匹配'), 'cea:no', 'ghost small')}</div>`],
    ].map(([t, b], i) => `<div class="timeline-row"><span class="step-dot current">${i + 1}</span><div class="grow"><h3>${t}</h3><div class="mt8">${b}</div></div></div>`).join('')}</div>`],
    renewal: [T('Your renewal options', '续租选项'), l ? `<p>${T('Current tenancy', '当前租期')} <strong>${leaseMonths(l.start, l.end)} ${T('months', '个月')}</strong></p><form id="renewal-form" class="stack">${field(T('Offered renewal (months)', '提议续租（月）'), 'months', state.renewal || 12, 'number', 'min="0" max="120" required')}<div class="info">${T(`A renewal of up to ${Math.max(0, 24 - leaseMonths(l.start, l.end))} months keeps the calculated total within 24 months. Enter 0 if there is no renewal offer.`, `续租最多 ${Math.max(0, 24 - leaseMonths(l.start, l.end))} 个月，可使计算后的总租期不超过 24 个月。如没有续租提议，请输入 0。`)}</div><p class="caption">${T('A new agreement does not automatically reset tribunal eligibility. Confirm the legal position for your situation.', '重新签订协议并不自动重置受理资格。请根据具体情况确认法律适用。')}</p><button class="btn" type="submit"><span>${T('Save renewal offer', '保存续租提议')}</span></button>${btn(T('Copy a message to the owner', '复制发给业主的消息'), 'copy-renewal', 'secondary', 'copy')}${legal()}</form>` : ''],
    'add-room': [T('Add a room or item', '添加房间或物品'), `<form id="room-form" class="stack">${field(T('Name', '名称'), 'name', '', 'text', 'required maxlength="60"')}${field(T('Required photos', '所需照片数量'), 'required', 3, 'number', 'min="1" max="30" required')}<button class="btn" type="submit"><span>${T('Add room', '添加房间')}</span></button></form>`],
    'room-counts': [T('Required photos', '所需照片'), `<form id="counts-form" class="stack">${state.rooms.map((r, i) => field(esc(roomName(r)), i, r.required, 'number', 'min="1" max="30" required')).join('')}<button class="btn" type="submit" ${recordClosed(state) ? 'disabled' : ''}><span>${T('Save counts', '保存数量')}</span></button></form>`],
    profile: [T('Your profile', '个人资料'), `<form id="profile-form" class="stack">${field(T('Name', '姓名'), 'name', state.name, 'text', 'required maxlength="80" autocomplete="name"')}${field(T('Email for letter drafts', '信件草稿使用的邮箱'), 'email', state.email, 'email', 'autocomplete="email"')}<p class="caption">${T('This edits a local profile. It does not create or authenticate an account.', '仅修改本地资料，不创建账户或进行身份认证。')}</p><button class="btn" type="submit"><span>${T('Save profile', '保存资料')}</span></button></form>`],
    school: [T('School partner', '学校合作方'), `<p>${T('The sample school is Orchard Institute. School code validation and paid Lease Packs are not connected. All local preview features are available without payment.', '示例学校为 Orchard Institute。未接入学校代码验证或租约包支付。本地预览功能均无需付款。')}</p>`],
    delete: [T('Delete local data', '删除本地数据'), `<div class="stop"><h3>${T('This removes your local records', '这将删除你的本地记录')}</h3><p>${T('Export a backup first. Photos, notes, lease details and settings in this browser will be removed.', '请先导出备份。此浏览器中的照片、备注、租约详情和设置将被删除。')}</p></div>${btn(T('Download a backup first', '先下载备份'), 'download-data', 'secondary', 'dl')}<form id="delete-form" class="stack">${field(T('Type DELETE to confirm', '输入 DELETE 以确认'), 'confirm', '', 'text', 'required pattern="DELETE" autocomplete="off"')}<button class="btn danger" type="submit"><span>${T('Delete this browser’s data', '删除此浏览器中的数据')}</span></button></form>`],
    fresh: [T('Start your own lease', '开始自己的租约'), `<p>${T('This replaces the sample lease and clears the current local records. Export any photos or drafts you want to keep first.', '这将替换示例租约并清空现有本地记录。请先导出需保留的照片或草稿。')}</p>${btn(T('Start fresh', '重新开始'), 'fresh', '', 'arrow')}${btn(T('Keep exploring the sample', '继续浏览示例'), 'close', 'ghost')}`],
    sample: [T('Load the sample lease', '载入示例租约'), `<p>${T('This replaces your local records with the fictional sample. Download a backup first if you want to keep them.', '这将用虚构示例替换你的本地记录。如需保留，请先下载备份。')}</p>${btn(T('Download a backup first', '先下载备份'), 'download-data', 'secondary', 'dl')}${btn(T('Replace with the sample', '替换为示例'), 'load-sample', 'danger')}${btn(T('Cancel', '取消'), 'close', 'ghost')}`],
    restore: [T('Restore from a backup', '从备份恢复'), pendingRestore ? `<p>${T(`This backup holds ${pendingRestore.photos.length} photos${pendingRestore.state.lease?.address ? ` for ${esc(pendingRestore.state.lease.address)}` : ''}. Restoring replaces the records in this browser.`, `此备份包含 ${pendingRestore.photos.length} 张照片${pendingRestore.state.lease?.address ? `（${esc(pendingRestore.state.lease.address)}）` : ''}。恢复后将替换此浏览器中的记录。`)}</p>${btn(T('Replace my local data', '替换本地数据'), 'restore-confirm', 'danger', 'upload')}${btn(T('Cancel', '取消'), 'close', 'ghost')}` : ''],
    comment: [T('Sample landlord comment', '示例房东评论'), `<form id="comment-form" class="stack"><label class="field"><span>${T('Comment', '评论')}</span><textarea name="comment" required maxlength="500"></textarea></label><p class="caption">${T('Saved as a local demonstration note and not sent to anyone.', '保存为本地演示备注，不会发送给任何人。')}</p><button class="btn" type="submit"><span>${T('Save sample comment', '保存示例评论')}</span></button></form>`],
  };
  if (map[name]) modal(...map[name], name);
}

/* ---------- camera ---------- */

function stopCamera() {
  if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
}
async function openCamera(out) {
  moveout = out;
  if (!out && recordClosed(state)) return;
  if (room === null) room = 0;
  captureDraft = null;
  modal(T('Camera', '相机') + ' · ' + roomName(state.rooms[room]), `<div class="camera-view"><video id="camera" autoplay playsinline muted></video><div id="camera-message" class="camera-error">${T('Opening camera…', '正在打开相机…')}</div></div><p class="caption">${T('Keep the room well lit. Capture both wide views and close-ups.', '确保房间光线充足。兼顾全景与细节。')}</p><button class="btn" data-action="capture" id="shutter" disabled>${I('cam')}<span>${T('Take photo', '拍照')}</span></button>`, 'camera');
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw Error('unsupported');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    if (activeModal !== 'camera') { stream.getTracks().forEach(t => t.stop()); return; }
    cameraStream = stream;
    $('#camera').srcObject = stream;
    $('#camera-message').remove();
    $('#camera').onloadedmetadata = () => { if ($('#shutter')) $('#shutter').disabled = false; };
    const original = photos.find(p => p.room === room && !p.moveout);
    if (out && original) $('.camera-view').insertAdjacentHTML('beforeend', `<img class="overlay" src="${photoURL(original)}" alt=""><label class="caption overlay-control">${T('Overlay opacity', '叠加透明度')}<input id="opacity" type="range" min="0" max="75" value="35"></label>`);
  } catch (e) {
    if (activeModal !== 'camera') return;
    $('#camera-message').textContent = e.name === 'NotAllowedError'
      ? T('Camera access was denied. Allow camera access in your browser’s site settings, then try again.', '相机访问被拒绝。请在浏览器的网站设置中允许访问相机，然后重试。')
      : T('Your browser can’t open the camera here. Open SafeLease in Safari or Chrome on a device with a camera.', '当前浏览器无法打开相机。请在带相机的设备上使用 Safari 或 Chrome 打开。');
    $('#dialog .modalbody').insertAdjacentHTML('beforeend', btn(T('Try again', '重试'), 'camera:' + (out ? 'out' : 'in'), 'secondary'));
  }
}
async function capture() {
  const v = $('#camera');
  if (!v?.videoWidth) return;
  $('#shutter').disabled = true;
  try {
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.95));
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(x => x.toString(16).padStart(2, '0')).join('');
    captureDraft = { id: crypto.randomUUID(), room, moveout, blob, hash, created: new Date().toISOString(), note: '', marks: [] };
    stopCamera();
    editPhoto(captureDraft, true);
  } catch {
    toast(T('Could not capture the photo. Try again.', '无法拍照，请重试。'));
    if ($('#shutter')) $('#shutter').disabled = false;
  }
}
function editPhoto(p, draft = false) {
  selectedPhoto = p;
  captureDraft = draft ? p : null;
  const readOnly = !draft && !p.moveout && recordClosed(state);
  modal(T('Photo · mark and note', '照片 · 标注与备注'), `<div class="annotated" id="photo-annotate"><img src="${photoURL(p)}" alt="${T('Captured room photo', '拍摄的房间照片')}">${(p.marks || []).map(m => `<i class="mark" style="left:${m.x}%;top:${m.y}%;width:${m.w}%;height:${m.h}%"></i>`).join('')}</div><p class="caption">${readOnly ? T('This record is closed.', '记录已关闭。') : T('Drag on the photo to mark an area. Original bytes stay unchanged.', '在照片上拖动以标记区域。原始文件不会更改。')}</p><form id="photo-form" class="stack"><label class="field"><span>${p.moveout ? T('Note', '备注') : T('Condition line, what is in the photo and any existing mark', '状况描述（照片内容及已有痕迹）')}</span><textarea name="note" maxlength="500" ${!p.moveout ? `placeholder="${T('e.g. Scratch, left wall, about 10 cm', '例如：左墙划痕，约 10 厘米')}"` : ''} ${readOnly ? 'readonly' : ''}>${esc(p.note)}</textarea></label><details class="caption fingerprint"><summary>${T('Fingerprint and time', '指纹与时间')}</summary><div>${T('Device time', '设备时间')} · ${esc(p.created)}<br>SHA-256 · ${p.hash}<br>${T('Content Credentials not inspected', '未检查内容凭证')}</div>${btn(T('Copy fingerprint', '复制指纹'), 'copy-hash', 'ghost small', 'copy')}</details>${!readOnly ? `<div class="btnpair">${btn(T('Undo last mark', '撤销上个标注'), 'undo-mark', 'ghost')}<button class="btn" type="submit">${I('check')}<span>${T('Save photo & note', '保存照片及备注')}</span></button></div>` : ''}</form>`, 'photo');
  $('#photo-annotate').dataset.readonly = readOnly ? 'true' : 'false';
}

/* ---------- utilities ---------- */

async function copy(s) {
  try { await navigator.clipboard.writeText(s); toast(T('Copied', '已复制')); }
  catch { modal(T('Copy this text', '复制以下文本'), `<textarea readonly rows="6">${esc(s)}</textarea><p class="caption">${T('Select the text and use your device’s Copy command.', '选中文本并使用设备的复制功能。')}</p>`); }
}
function download(name, content, type = 'application/json') {
  const blob = content instanceof Blob ? content : new Blob([content], { type }), u = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 2000);
}
async function exportData() {
  toast(T('Preparing your data…', '正在准备数据…'));
  const exported = await Promise.all(photos.map(async p => ({ ...p, blob: undefined, originalBase64: await new Promise(resolve => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(p.blob); }) })));
  download('SafeLease_Backup.json', JSON.stringify({ version: 1, app: 'SafeLease SG web ' + WEB_VERSION, exportedAt: new Date().toISOString(), state, photos: exported }, null, 2));
  toast(T('Data export downloaded', '数据导出已下载'));
}
async function restoreBackup() {
  const { state: s, photos: ps } = pendingRestore;
  const restored = [];
  for (const p of ps) {
    const blob = await (await fetch(p.originalBase64)).blob();
    const { originalBase64, ...rest } = p;
    restored.push({ ...rest, blob });
  }
  await photoStore('clear');
  for (const p of restored) await photoStore('put', p);
  photos = restored;
  state = migrate(s);
  state.onboarded = true;
  template = state.template || 0;
  currentCheck = state.checks.at(-1);
  pendingRestore = null;
  save();
  closeModal();
  go('home');
  toast(T('Backup restored', '备份已恢复'));
}
function calendar() {
  if (!state.lease) return;
  const day = addDays(state.lease.end, -7).replaceAll('-', ''), next = addDays(addDays(state.lease.end, -7), 1).replaceAll('-', '');
  download('SafeLease_Moveout.ics', `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//SafeLease SG//EN\r\nBEGIN:VEVENT\r\nUID:${crypto.randomUUID()}@safelease.local\r\nDTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}\r\nDTSTART;VALUE=DATE:${day}\r\nDTEND;VALUE=DATE:${next}\r\nSUMMARY:Take move-out photos\r\nDESCRIPTION:Photograph each room before handover. Match your move-in angles.\r\nBEGIN:VALARM\r\nTRIGGER:-PT9H\r\nACTION:DISPLAY\r\nDESCRIPTION:Prepare your move-out photo record\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`, 'text/calendar');
  toast(T('Calendar file downloaded', '日历文件已下载'));
}
async function fresh() {
  await photoStore('clear');
  photos = [];
  const lang = state.lang;
  state = defaultState();
  Object.assign(state, { lang, demo: false, onboarded: true, lease: null, name: '', email: '', school: '', renewal: 0 });
  template = 0;
  currentCheck = null;
  save();
  go('add-lease');
}
async function loadSample() {
  await photoStore('clear');
  photos = [];
  const lang = state.lang;
  state = defaultState();
  Object.assign(state, { lang, onboarded: true });
  template = 0;
  currentCheck = null;
  save();
  go('home');
  toast(T('Sample lease loaded', '已载入示例租约'));
}
function markLetterPrepared() {
  state.letterPrepared = today();
  save();
}
function startCheck(sample = false) {
  currentCheck = { id: crypto.randomUUID(), sample, link: sample ? '' : listDraft.link, address: sample ? 'Common room · Clementi Ave 3' : listDraft.address, phone: sample ? '+65 9123 4567' : listDraft.phone, created: new Date().toISOString(), checklist: [] };
  state.checks.push(currentCheck);
  save();
  if (!sample) { listDraft = { link: '', phone: '', address: '' }; checkFiles = []; }
  checkProgress = 0;
  checkRunning = true;
  go('checking');
  clearInterval(progressTimer);
  progressTimer = setInterval(() => {
    checkProgress++;
    if (route === 'checking') render();
    if (checkProgress >= 4) {
      clearInterval(progressTimer);
      checkRunning = false;
      if (route === 'checking') setTimeout(() => replaceRoute('results'), 180);
      else toast(T('Your check is ready', '核查结果已就绪'));
    }
  }, 450);
}

/* ---------- events ---------- */

document.addEventListener('click', async e => {
  if (e.target.closest('.skip')) {
    e.preventDefault();
    const m = $('#main');
    m.setAttribute('tabindex', '-1');
    m.focus();
    return;
  }
  const b = e.target.closest('[data-action]');
  if (!b || b.disabled) return;
  const a = b.dataset.action, [kind, arg] = a.split(':');
  if (kind === 'go') return go(arg);
  if (kind === 'back') return back(arg);
  if (kind === 'modal') return openModal(arg);
  if (a === 'close') return closeModal();
  if (a === 'language') {
    const y = scrollY;
    state.lang = state.lang === 'en' ? 'zh' : 'en';
    save();
    closeModal();
    render();
    scrollTo(0, y);
    return;
  }
  if (a === 'upload-listing') return $('#listing-files').click();
  if (a === 'sample-check') return startCheck(true);
  if (kind === 'check-open') { currentCheck = state.checks.find(c => c.id === arg); return go('results'); }
  if (kind === 'payee') {
    state.masked = arg === 'match' ? 'TaX MeX LiXX' : 'WoX KaX HoXX';
    state.payeeOwner = 'Tan Mei Ling';
    render();
    return;
  }
  if (a === 'copy-payee') return copy(T(`Hi, before I pay, could you confirm in writing that the PayNow account showing “${state.masked}” belongs to you, the owner named in our agreement? Thank you.`, `您好，付款前请书面确认 PayNow 显示“${state.masked}”的账户属于您，即租约上列明的业主。谢谢。`));
  if (kind === 'cea') {
    if (currentCheck) { currentCheck.cea = arg; currentCheck.ceaAt = new Date().toISOString(); save(); }
    closeModal();
    render();
    toast(T('Agent’s phone number, your answer is saved', '中介手机号码：已保存你的回答'));
    return;
  }
  if (a === 'copy-phone') return copy(currentCheck?.phone || '+65 9123 4567');
  if (kind === 'room') { room = Number(arg); render(); $('.roompanel, .compare')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return; }
  if (kind === 'camera') return openCamera(arg === 'out');
  if (a === 'capture') return capture();
  if (kind === 'photo') { const p = photos.find(x => x.id === arg); if (p) editPhoto(structuredClone(p)); return; }
  if (a === 'undo-mark') { selectedPhoto.marks.pop(); $('#photo-annotate .mark:last-of-type')?.remove(); return; }
  if (a === 'copy-hash') return copy(selectedPhoto.hash);
  if (a === 'confirm-record') {
    const rp = roomProgress(state.rooms, photos);
    if (!rp.complete || !inventoryStatus(photos).ready) return;
    state.record.confirmed = new Date().toISOString();
    save();
    go('invite');
    return;
  }
  if (a === 'one-sided') { state.record.status = 'one_sided'; save(); go('record'); return; }
  if (a === 'copy-invite') return copy(inviteText());
  if (a === 'demo-decline') {
    modal(T('One-sided record preview', '单方记录预览'), `<p>${T('The landlord has not confirmed. In a connected version, the record would retain your dated originals and show who has or has not confirmed.', '房东尚未确认。接入服务后，记录将保留带日期的原件并显示各方确认状态。')}</p>${btn(T('Back to my record', '返回我的记录'), 'go:record')}`);
    return;
  }
  if (a === 'toggle-reminders') { state.reminders = !state.reminders; save(); render(); return; }
  if (a === 'calendar') return calendar();
  if (a === 'refund') {
    state.refundReceived = !state.refundReceived;
    save();
    render();
    toast(state.refundReceived ? T('Refund marked as received', '已标记收到退款') : T('Refund marked as outstanding', '已改为未收到退款'));
    return;
  }
  if (kind === 'template') { template = Number(arg); state.template = template; save(); render(); return; }
  if (a === 'letter-reset') {
    delete state.letters[letterKey()];
    delete state.letterStale[letterKey()];
    save();
    render();
    toast(T('Letter rebuilt from your records', '已按记录重新生成信件'));
    return;
  }
  if (a === 'copy-letter') { markLetterPrepared(); return copy(letterText()); }
  if (kind === 'ded-remove') { state.deductions.splice(Number(arg), 1); lettersChanged([0]); save(); render(); return; }
  if (a === 'ded-sample') { state.deductions = sampleDeductions(photos, state.lang === 'zh'); lettersChanged([0]); save(); render(); return; }
  if (a === 'ded-letter') {
    if (!state.deductions.length) return;
    state.dedInLetter = true;
    template = 0;
    state.template = 0;
    lettersChanged([0]);
    save();
    go('evidence');
    toast(state.letters[state.lang + '0'] ? T('Your edited letter is kept. Reset it to include the open points.', '已保留你编辑的信件。恢复模板即可加入未回答的问题。') : T('Open points added to your letter', '未回答的问题已加入信件'));
    return;
  }
  if (a === 'print') { markLetterPrepared(); return window.print(); }
  if (a === 'mark-read') { state.notificationsRead = true; save(); render(); return; }
  if (kind === 'notice') { state.notificationsRead = true; save(); go(arg); return; }
  if (a === 'download-data') return exportData();
  if (a === 'restore-pick') return $('#restore-file').click();
  if (a === 'restore-confirm') {
    try { await restoreBackup(); }
    catch (err) { console.error(err); toast(T('Could not restore this backup.', '无法恢复此备份。')); }
    return;
  }
  if (a === 'fresh') return fresh();
  if (a === 'load-sample') return loadSample();
  if (a === 'copy-renewal') return copy(T(`Hi ${state.lease.owner}, could we discuss the proposed renewal length? The current tenancy is ${leaseMonths(state.lease.start, state.lease.end)} months. I would like to understand the total duration and the applicable dispute-resolution options before signing.`, `您好 ${state.lease.owner}，能否讨论一下续租期限？当前租期为 ${leaseMonths(state.lease.start, state.lease.end)} 个月。我希望在签约前了解总租期与适用的争议解决途径。`));
  if (kind === 'onboard') { onboardPage = Number(arg); render(); return; }
  if (kind === 'onboard-done') {
    onboardPage = 0;
    if (arg === 'own') return fresh();
    state.onboarded = true;
    save();
    go('home');
  }
});

document.addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target, f = Object.fromEntries(new FormData(form));
  if (!form.checkValidity()) { form.reportValidity(); return; }
  try {
    switch (form.id) {
      case 'check-form':
        listDraft = { ...listDraft, ...f };
        if ((validLink(f.link) || checkFiles.length) && navigator.onLine) startCheck();
        break;
      case 'lease-form': {
        if (f.end <= f.start) { $('#lease-error').textContent = T('The end date must be after the start date.', '结束日期必须晚于开始日期。'); return; }
        if (state.record.status === 'locked') { toast(T('Closed records cannot be edited.', '已关闭记录无法修改。')); return; }
        const isNew = !state.lease;
        if (f.yourName) state.name = f.yourName.trim();
        delete f.yourName;
        state.lease = { ...f, rent: Number(f.rent), deposit: Number(f.deposit), refundDays: Number(f.refundDays) };
        state.demo = false;
        lettersChanged();
        save();
        toast(isNew ? T('Lease saved', '租约已保存') : T('Changes saved', '修改已保存'));
        go(isNew ? nextSteps()[journey(state, photos, today()).next].route : 'lease');
        break;
      }
      case 'room-form':
        state.rooms.push({ name: f.name.trim(), zh: f.name.trim(), required: Number(f.required) });
        room = state.rooms.length - 1;
        save();
        closeModal();
        render();
        break;
      case 'counts-form':
        if (recordClosed(state)) return;
        state.rooms.forEach((r, i) => (r.required = Number(f[i])));
        save();
        closeModal();
        render();
        break;
      case 'profile-form':
        state.name = f.name.trim();
        state.email = f.email;
        lettersChanged();
        save();
        closeModal();
        render();
        break;
      case 'renewal-form':
        state.renewal = Number(f.months);
        save();
        closeModal();
        render();
        break;
      case 'photo-form': {
        if (!selectedPhoto.moveout && recordClosed(state)) return;
        selectedPhoto.note = f.note;
        await photoStore('put', selectedPhoto);
        const i = photos.findIndex(p => p.id === selectedPhoto.id);
        if (i < 0) photos.push(selectedPhoto);
        else photos[i] = selectedPhoto;
        if (!selectedPhoto.moveout && !state.record.started) { state.record.started = Date.now(); state.record.status = 'open'; }
        if (!selectedPhoto.moveout) state.record.confirmed = null;
        save();
        closeModal();
        render();
        toast(T('Photo saved with its SHA-256 fingerprint', '照片及 SHA-256 指纹已保存'));
        break;
      }
      case 'landlord-form':
        go('locked');
        break;
      case 'ded-form':
        state.deductions.push({ item: f.item.trim(), amount: Number(f.amount) });
        lettersChanged([0]);
        save();
        render();
        break;
      case 'comment-form':
        state.sampleComment = f.comment;
        save();
        closeModal();
        toast(T('Sample comment saved locally', '示例评论已保存在本地'));
        break;
      case 'review-form': {
        const request = { ...f, checkId: currentCheck?.id || null, created: new Date().toISOString(), status: 'draft_not_sent' };
        state.reviewDrafts.push(request);
        save();
        download('SafeLease_Review_Request.json', JSON.stringify(request, null, 2));
        toast(T('Request saved and downloaded. Not sent.', '申请已保存并下载。尚未发送。'));
        break;
      }
      case 'delete-form':
        if (f.confirm === 'DELETE') {
          await photoStore('clear');
          localStorage.removeItem(STORE);
          photos = [];
          const lang = state.lang;
          state = defaultState();
          Object.assign(state, { lang, lease: null, demo: false, onboarded: true, name: '', email: '', school: '', renewal: 0 });
          template = 0;
          currentCheck = null;
          save();
          go('home');
          toast(T('Local data deleted', '本地数据已删除'));
        }
        break;
    }
  } catch (err) {
    toast(T('Could not save. Please check browser storage and try again.', '保存失败。请检查浏览器存储并重试。'));
    console.error(err);
  }
});

document.addEventListener('input', e => {
  if (e.target.closest('#check-form')) {
    const f = Object.fromEntries(new FormData($('#check-form')));
    listDraft = { ...listDraft, ...f };
    $('#run-check').disabled = (!validLink(f.link) && !checkFiles.length) || !navigator.onLine;
    if (e.target.name === 'link') {
      const phone = f.link.match(/(?:\+65|%2B65|65)?([89]\d{7})(?!\d)/);
      if (phone && !f.phone) { $('#check-form [name=phone]').value = '+65 ' + phone[1]; listDraft.phone = '+65 ' + phone[1]; }
    }
  }
  if (['masked', 'payee-owner'].includes(e.target.id)) renderComparison();
  if (e.target.id === 'letter') {
    state.letters[letterKey()] = e.target.innerText;
    const wasStale = state.letterStale[letterKey()];
    delete state.letterStale[letterKey()];
    save();
    if (!$('#letter-tools .btn') || wasStale) $('#letter-tools').innerHTML = letterTools();
  }
  if (e.target.dataset.ded && e.target.tagName === 'INPUT') {
    const [i, k] = e.target.dataset.ded.split(':'), d = state.deductions[Number(i)];
    if (d) {
      d[k] = e.target.value;
      lettersChanged([0]);
      save();
      const sum = deductionSummary(state.deductions, state.lease?.deposit), t = $(`[data-dtag="${i}:${k}"]`);
      if (t) t.innerHTML = e.target.value.trim() ? tag(T('Stated', '已说明'), 'ok') : tag(T('Not stated', '未说明'), 'red');
      if ($('#ded-stated')) $('#ded-stated').textContent = sum.items.length * 4 - sum.open;
    }
  }
  if (e.target.closest('#review-form') && e.target.name === 'note') $('#review-counter').textContent = e.target.value.length + ' / 500';
  if (e.target.id === 'opacity') $('.camera-view .overlay').style.opacity = e.target.value / 100;
  if (['deduction', 'deduction-amount', 'deduction-reason'].includes(e.target.id)) {
    state.deduction = $('#deduction').value;
    state.deductionAmount = $('#deduction-amount').value;
    state.deductionReason = $('#deduction-reason').value;
    if (state.letters[letterKey()]) {
      lettersChanged([1]);
      $('#letter-tools').innerHTML = letterTools();
    } else $('#letter').textContent = letterText();
    save();
  }
});

document.addEventListener('change', async e => {
  if (e.target.id === 'listing-files') {
    const fs = [...e.target.files];
    if (fs.length > 5 || fs.some(f => f.size > 10 * 1024 * 1024 || !f.type.startsWith('image/'))) {
      $('#check-error').textContent = T('Choose up to 5 images, each no larger than 10 MB.', '请选择最多 5 张图片，每张不超过 10 MB。');
      return;
    }
    checkFiles = fs;
    render();
  }
  if (e.target.id === 'restore-file') {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try { pendingRestore = parseBackup(await file.text()); openModal('restore'); }
    catch { toast(T('This file is not a SafeLease backup.', '此文件不是 SafeLease 备份。')); }
  }
  if (e.target.dataset.checklist !== undefined && currentCheck) {
    currentCheck.checklist[Number(e.target.dataset.checklist)] = e.target.checked;
    save();
  }
  if (e.target.dataset.ded && e.target.tagName === 'SELECT') {
    const [i, k] = e.target.dataset.ded.split(':');
    if (state.deductions[Number(i)]) { state.deductions[Number(i)][k] = e.target.value; lettersChanged([0]); save(); render(); }
  }
  if (e.target.dataset.attachment) {
    state.attachments ||= {};
    state.attachments[e.target.dataset.attachment] = e.target.checked;
    save();
  }
});

document.addEventListener('pointerdown', e => {
  const a = e.target.closest('#photo-annotate');
  if (!a || a.dataset.readonly === 'true') return;
  const r = a.getBoundingClientRect();
  markStart = { x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 };
  a.setPointerCapture(e.pointerId);
});
document.addEventListener('pointerup', e => {
  const a = e.target.closest('#photo-annotate');
  if (!markStart || !a) return;
  const r = a.getBoundingClientRect(),
    x = Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)),
    y = Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100)),
    m = { x: Math.min(x, markStart.x), y: Math.min(y, markStart.y), w: Math.abs(x - markStart.x), h: Math.abs(y - markStart.y) };
  if (m.w > 1 && m.h > 1) {
    selectedPhoto.marks.push(m);
    a.insertAdjacentHTML('beforeend', `<i class="mark" style="left:${m.x}%;top:${m.y}%;width:${m.w}%;height:${m.h}%"></i>`);
  }
  markStart = null;
});
$('#dialog').addEventListener('click', e => {
  if (e.target === $('#dialog')) {
    const r = e.target.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeModal();
  }
});
$('#dialog').addEventListener('cancel', () => { stopCamera(); activeModal = null; });
$('#dialog').addEventListener('close', stopCamera);
window.addEventListener('hashchange', () => {
  if (replacing) { replacing = false; history.replaceState({ i: histIndex }, ''); }
  else if (history.state && typeof history.state.i === 'number') histIndex = history.state.i;
  else { histIndex += 1; history.replaceState({ i: histIndex }, ''); }
  enterRoute(location.hash.slice(1) || 'home');
});
window.addEventListener('online', render);
window.addEventListener('offline', render);
window.addEventListener('pagehide', stopCamera);
window.visualViewport?.addEventListener('resize', () => {
  if (document.activeElement?.matches('input,textarea')) document.activeElement.scrollIntoView({ block: 'nearest' });
});

function expireRecord() {
  if (state.record.status === 'open' && state.record.started && Date.now() - state.record.started >= 48 * 3600000) {
    state.record.status = 'one_sided';
    save();
    return true;
  }
  return false;
}
setInterval(() => {
  if (expireRecord()) { if (route === 'record' && !$('#dialog').open) render(); }
  else if ($('#record-clock')) $('#record-clock').textContent = clockText();
}, 30000);
expireRecord();

if (history.state && typeof history.state.i === 'number') histIndex = history.state.i;
else history.replaceState({ i: 0 }, '');
try { photos = await photoStore('getAll'); }
catch { toast(T('Photo storage is unavailable in this browser.', '此浏览器无法存储照片。')); }
render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
