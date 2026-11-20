(function(){'use strict';
const {Store,Fault,fail,hash,Buffer,decode,paynowCheck,ceaCheck}=AndroidCore;
if(Native.isDemoWorkspace()){try{Native.chooseWorkspace('personal')}catch{}}
const s=new Store(),previous=Native.setting('demo-seed',null);
if(!Native.isDemoWorkspace())try{s.run("UPDATE accounts SET disabled=1 WHERE email LIKE '%@demo.invalid'");}catch{}
if(!previous&&Native.isDemoWorkspace()){if(s.one('SELECT count(*) n FROM accounts').n)throw Error('Incomplete demo initialization; preserve app data and contact support.');seedAndroid(s);}
window.AndroidDemoStore=s;
try{const last=Number(localStorage.getItem('safelease-retention-last-'+(Native.isDemoWorkspace()?'demo':'personal'))||0);if(Date.now()-last>=86400000){s.purge();localStorage.setItem('safelease-retention-last-'+(Native.isDemoWorkspace()?'demo':'personal'),String(Date.now()));}}catch{}
let raw=Native.setting('session',null)||'';
if(Native.isDemoWorkspace()&&!raw){const entry=s.login('tenant@demo.invalid','SafeLease-Demo-2026!');raw=entry.raw;Native.setting('session',raw);Native.setting('remember-session','1');}
const original=window.fetch.bind(window);
function demoLogin(role){if(!Native.isDemoWorkspace())fail(403,'demo_workspace_required');if(!['tenant','landlord','staff'].includes(role))fail(400,'invalid_role');const result=s.login(role+'@demo.invalid','SafeLease-Demo-2026!');if(raw)s.logout(raw);raw=result.raw;Native.setting('session',raw);Native.setting('remember-session','1');return {user:result.user,csrf:result.csrf};}
function reference(kind,q='',offset=0){if(kind==='counts'){const c=JSON.parse(Native.asset('reference/catalog.json'));return {counts:c.counts,coverage:c.coverage,sources:c.sources,accessed:c.accessed,notice:'Historical rentals are not available listings.'};}const tables={agents:['reg','name','agency','licence'],rentals:['town','street','month','type','block'],listings:['title','area','type'],guides:['title_en','title_zh','body_en','body_zh'],community:['title_en','title_zh','body_en','body_zh']},order={agents:'name COLLATE NOCASE,reg',rentals:'month DESC,id',listings:'area COLLATE NOCASE,id',guides:'id',community:'id'};if(!Object.hasOwn(tables,kind))fail(400,'invalid_reference_kind');q=String(q).trim().replace(/\s+/gu,' ');if(q.length>100||!Number.isSafeInteger(offset)||offset<0)fail(400,'invalid_query');const p=[],where=(q?q.split(' '):['']).map(word=>{const pattern='%'+word.replace(/[\\%_]/g,'\\$&')+'%';p.push(...tables[kind].map(()=>pattern));return '('+tables[kind].map(k=>k+" LIKE ? ESCAPE '\\'").join(' OR ')+')';}).join(' AND ');const query=(sql,args)=>decode(Native.reference(sql,JSON.stringify(args))),total=query(`SELECT count(*) n FROM ${kind} WHERE ${where}`,p)[0].n,rows=query(`SELECT * FROM ${kind} WHERE ${where} ORDER BY ${order[kind]} LIMIT 30 OFFSET ?`,[...p,offset]);return {kind,query:q,limit:30,offset,total,has_more:offset+rows.length<total,rows};}
function checkInput(b){if(b.kind==='cea'){if(b.register_result!==undefined&&!['match','not_found','unsure'].includes(b.register_result))fail(400,'invalid_text');const result=ceaCheck(b);if(b.register_result){result.result.register_result=b.register_result;result.result.phone=String(b.phone||'').slice(0,40);if(b.register_result!=='unsure'){if(!/^[+\d ()-]{5,40}$/.test(result.result.phone))fail(400,'agent_phone_required');result.status='user_reported_not_verified';delete result.result.reason;result.object=result.result.phone;}}return result;}if(b.kind==='paynow')return paynowCheck(b);if(b.kind!=='image')fail(400,'check_kind_required');let u;try{u=new URL(b.url);}catch{fail(400,'public_image_url_required');}if(u.protocol!=='https:'||u.username||u.password||u.hostname==='localhost'||/^\d|^\[/.test(u.hostname))fail(400,'public_https_image_url_required');if(b.consent!==true)fail(400,'external_lookup_consent_required');return {kind:'image',object:u.href,source:'Android offline edition / 安卓离线版',status:'not_checked',result:{reason:'provider_not_configured',limitation:'No live reverse image service ran. Historical replay is labelled separately. / 未进行实时图片查询，历史回放另行标明。'}};}
function file(u,lid,kind){const lease=s.lease(u,lid),manifest={format:'SafeLease local evidence 1',exported_at:new Date().toISOString(),time_notice:'All receipt times originate on this phone. Not independent trusted timestamps.',status_notice:'Decisions belong to local accounts. They do not independently verify identity, property ownership or legal admissibility.',lease,checks:s.all('SELECT * FROM checks WHERE lease_id=? ORDER BY created',lid),agreement_details:{...ChecklistData.plan(s,u,lid),source:'User entered; not verified'},letter_draft:ChecklistData.draft(s,u,lid),cases:s.queue(u).filter(c=>c.lease_id===lid).map(c=>s.caseDetail(u,c.id)),photos:[]},seen=new Set();for(const r of lease.records)for(const v of r.versions)for(const meta of v.body.photos){if(seen.has(meta.id))continue;seen.add(meta.id);const p=s.one('SELECT * FROM photos WHERE id=?',meta.id),m=s.photoMeta(p);m.filename=p.bytes?'originals/'+p.id+(p.mime==='image/jpeg'?'.jpg':'.png'):null;manifest.photos.push(m);}const result=decode(Native.makeExport(JSON.stringify(manifest),kind));s.event(u,kind==='letter'?'letter_exported':'evidence_exported',lid);return result;}
function dispatch(path,method,b,headers,url){let m;
 const extraMixed=/^\/leases\/[^/]+\/(plan|draft)$/.test(path);
 const reviewRead=/^\/listing-reviews(?:\/[^/]+)?$/.test(path)||/^\/screenings\/[^/]+\/review$/.test(path);
 const reviewWrite=path==='/listing-reviews'||/^\/listing-reviews\/[^/]+\/(assign|complete|withdraw|report|resolve-report)$/.test(path);
 const extraRead=/^\/(?:screenings\/[^/]+\/intake|leases\/[^/]+\/(access|letter\.pdf))$/.test(path);
 const mixed=path==='/listing-reviews'||extraMixed||/^\/(leases|screenings|cases)$/.test(path)||/^\/leases\/[^/]+\/checks$/.test(path);
 const read=reviewRead||extraRead||/^\/(health|me|reference|metrics|getting-started)$/.test(path)||/^\/(leases|screenings|cases)\/[^/]+$/.test(path)||/^\/leases\/[^/]+\/(?:evidence\/|export\.)(pdf|zip)$/.test(path);
 const write=reviewWrite||path==='/listing-intake'||/^\/(activate|login|guest|presentation-login|logout|survey|invites\/accept|maintenance\/purge)$/.test(path)||/^\/screenings\/[^/]+\/checks$/.test(path)||/^\/leases\/[^/]+\/(invites|captures|refunds|versions\/(movein|moveout)|versions\/[^/]+\/decide|invites\/[^/]+\/revoke)$/.test(path)||/^\/cases\/[^/]+\/(assign|reply|resolve)$/.test(path);
 if(!mixed&&!read&&!write)fail(404,'not_found');
 if(mixed?!['GET','POST'].includes(method):read?method!=='GET':method!=='POST')fail(405,'method_not_allowed');
 if(path==='/health')return {ok:true,service:'SafeLease Android local demo',storage_region:'device_local'};
 if(path==='/activate'&&method==='POST')return s.activate(b.email,b.activation,b.password);
 if(path==='/presentation-login')return demoLogin(b.role);
 if(path==='/guest'){
  let guest=s.one('SELECT * FROM accounts WHERE email=?','guest@safelease.local');
  if(!guest){const value=s.provision({email:'guest@safelease.local',name:'Guest',role:'tenant',isTest:Native.isTesting()});s.run('UPDATE accounts SET activation_hash=NULL,activation_expires=NULL WHERE id=?',value.id);guest=s.one('SELECT * FROM accounts WHERE id=?',value.id);}
  raw=Native.random(32);const token=Native.random(32);s.run('INSERT INTO sessions VALUES(?,?,?,?)',hash(raw),guest.id,token,s.now()+30*86400000);Native.setting('session',raw);Native.setting('remember-session','1');s.audit(guest.id,'guest_login',guest.id);return {user:s.publicUser(guest),csrf:token};
 }
 if(path==='/login'&&method==='POST'){const value=s.login(b.email,b.password);raw=value.raw;Native.setting('session',raw);Native.setting('remember-session',b.remember===false?'0':'1');if(b.remember!==false)s.run('UPDATE sessions SET expires=? WHERE token_hash=?',s.now()+30*86400000,hash(raw));return {user:value.user,csrf:value.csrf};}
 const u=s.session(raw);if(method==='POST'&&headers.get('X-CSRF-Token')!==u.csrf)fail(403,'csrf_denied');
 if(path==='/me'){if(Native.setting('remember-session',null)!=='0')s.run('UPDATE sessions SET expires=? WHERE token_hash=?',s.now()+30*86400000,hash(raw));return {user:s.publicUser(u),csrf:u.csrf};}if(path==='/logout'){s.logout(raw);raw='';Native.setting('session','');return {ok:true};}
 if(path==='/getting-started'){
 const leases=s.listLeases(u),screenings=u.role==='tenant'?s.listScreenings(u):[],own=leases.filter(l=>s.one('SELECT tenant_id FROM leases WHERE id=?',l.id)?.tenant_id===u.id);
 const photos=s.one('SELECT count(*) n FROM photos WHERE uploaded_by=? AND bytes IS NOT NULL',u.id).n;
 const versions=s.one('SELECT count(*) n FROM versions WHERE created_by=?',u.id).n;
 const exports=s.one("SELECT count(*) n FROM events WHERE user_id=? AND kind='evidence_exported'",u.id).n;
 return {screening:screenings.length,lease:own.length,photo:photos,version:versions,export:exports,lease_id:own[0]?.id||null,screening_id:screenings[0]?.id||null};
 }
 if(path==='/reference')return reference(url.searchParams.get('kind')||'counts',url.searchParams.get('q')||'',Number(url.searchParams.get('offset')||0));
 if(path==='/listing-reviews')return method==='GET'?ListingReviewData.queue(s,u):ListingReviewData.create(s,u,b);
 if((m=path.match(/^\/screenings\/([^/]+)\/review$/)))return ListingReviewData.forScreening(s,u,m[1]);
 if((m=path.match(/^\/listing-reviews\/([^/]+)$/)))return ListingReviewData.detail(s,u,m[1]);
 if((m=path.match(/^\/listing-reviews\/([^/]+)\/(assign|complete|withdraw|report|resolve-report)$/)))return ListingReviewData.action(s,u,m[1],m[2],b);
 if(path==='/listing-intake')return ChecklistData.intake(s,u,b);
 if((m=path.match(/^\/screenings\/([^/]+)\/intake$/)))return ChecklistData.readIntake(s,u,m[1]);
 if((m=path.match(/^\/leases\/([^/]+)\/(plan|draft|access|letter\.pdf)$/))){if(m[2]==='letter.pdf')return file(u,m[1],'letter');return ChecklistData[m[2]](s,u,m[1],method==='POST'?b:null);}
 if(path==='/leases'){if(method==='GET')return s.listLeases(u);return s.tx(()=>{const row=s.createLease(u,b);if(b.room_names||b.owner_name)ChecklistData.plan(s,u,row.id,{owner_name:b.owner_name||'',rooms:String(b.room_names||'Room').split(',').map(x=>x.trim()),renewal_end:''});return row;});}
 if(path==='/screenings')return method==='GET'?s.listScreenings(u):s.createScreening(u,b);
 if(path==='/invites/accept')return s.accept(u,b.token);
 if((m=path.match(/^\/screenings\/([^/]+)$/)))return s.screening(u,m[1]);
 if((m=path.match(/^\/screenings\/([^/]+)\/checks$/)))return s.recordScreeningCheck(u,m[1],checkInput(b));
 if((m=path.match(/^\/leases\/([^/]+)$/)))return s.lease(u,m[1]);
 if((m=path.match(/^\/leases\/([^/]+)\/(?:evidence\/|export\.)(pdf|zip)$/)))return file(u,m[1],m[2]);
 if((m=path.match(/^\/leases\/([^/]+)\/invites$/)))return s.invite(u,m[1],b);
 if((m=path.match(/^\/leases\/([^/]+)\/invites\/([^/]+)\/revoke$/)))return s.revoke(u,m[1],m[2]);
 if((m=path.match(/^\/leases\/([^/]+)\/captures$/))){s.tenant(u,m[1]);decode(Native.validatePhoto(b.image_base64,b.mime));return s.capture(u,m[1],Buffer.from(b.image_base64,'base64'),b);}
 if((m=path.match(/^\/leases\/([^/]+)\/versions\/(movein|moveout)$/)))return s.addVersion(u,m[1],m[2],b);
 if((m=path.match(/^\/leases\/([^/]+)\/versions\/([^/]+)\/decide$/)))return s.decide(u,m[1],m[2],b);
 if((m=path.match(/^\/leases\/([^/]+)\/refunds$/)))return s.refund(u,m[1],b);
 if((m=path.match(/^\/leases\/([^/]+)\/checks$/))){s.member(u,m[1]);return method==='GET'?s.all('SELECT * FROM checks WHERE lease_id=? ORDER BY created DESC',m[1]):s.recordCheck(u,m[1],checkInput(b));}
 if(path==='/cases')return method==='GET'?s.queue(u):s.createCase(u,b.lease_id,b);
 if((m=path.match(/^\/cases\/([^/]+)$/)))return s.caseDetail(u,m[1]);
 if((m=path.match(/^\/cases\/([^/]+)\/(assign|reply|resolve)$/)))return m[2]==='assign'?s.assign(u,m[1]):m[2]==='reply'?s.reply(u,m[1],b):s.resolve(u,m[1]);
 if(path==='/maintenance/purge'&&method==='POST'){if(u.role!=='staff')fail(403,'staff_required');return s.purge();}
 if(path==='/survey')return s.survey(u,b);if(path==='/metrics')return s.metrics(u);fail(404,'not_found');
}
window.fetch=async function(input,options={}){
 const incoming=input instanceof Request?input:null;
 const url=new URL(incoming?incoming.url:String(input),location.origin);
 if(url.origin!==location.origin||!url.pathname.startsWith('/api/'))return original(input,options);
 const path=url.pathname.slice(4),method=(options.method||incoming?.method||'GET').toUpperCase();
 if(path.startsWith('/photos/')||/^\/cases\/[^/]+\/photos\//.test(path))return original(input,options);
 try{
  const requestBody=options.body!==undefined?options.body:incoming&&!['GET','HEAD'].includes(method)?await incoming.clone().text():undefined;
  let b={};if(requestBody!==undefined&&requestBody!==''){try{b=JSON.parse(requestBody);}catch{fail(400,'invalid_json');}if(!b||typeof b!=='object'||Array.isArray(b))fail(400,'json_object_required');}
  const result=dispatch(path,method,b,new Headers(options.headers||incoming?.headers||{}),url);
  return new Response(JSON.stringify(result),{status:method==='POST'&&!['/login','/logout','/activate'].includes(path)?201:200,headers:{'Content-Type':'application/json'}});
 }catch(error){
  if(error instanceof Fault&&error.status===403)try{s.audit(null,'access_denied',path,{reason:error.code});}catch{}
  return new Response(JSON.stringify({error:error instanceof Fault?error.code:String(error.message)}),{status:error instanceof Fault?error.status:500,headers:{'Content-Type':'application/json'}});
 }
};
})();
