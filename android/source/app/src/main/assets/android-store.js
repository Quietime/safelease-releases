(function(){'use strict';
class ByteBuffer extends Uint8Array {
 static from(value,encoding){if(typeof value==='string'){if(encoding==='base64')return new ByteBuffer(Uint8Array.from(atob(value),c=>c.charCodeAt(0)));if(encoding==='hex')return new ByteBuffer(value.match(/../g).map(x=>parseInt(x,16)));return new ByteBuffer(new TextEncoder().encode(value));}return new ByteBuffer(value);}
 static isBuffer(value){return value instanceof ByteBuffer;}
 toString(encoding){if(encoding==='hex')return Array.from(this,n=>n.toString(16).padStart(2,'0')).join('');if(encoding==='base64'||encoding==='base64url'){let s='';for(let i=0;i<this.length;i+=8192)s+=String.fromCharCode(...this.subarray(i,i+8192));let b=btoa(s);return encoding==='base64url'?b.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''):b;}return new TextDecoder().decode(this);}
 equals(other){return this.length===other.length&&this.every((v,i)=>v===other[i]);}
 toJSON(){return {__blob:this.toString('base64')};}
}
const Buffer=ByteBuffer,randomUUID=()=>Native.uuid(),randomBytes=n=>Buffer.from(Native.random(n),'base64');
const createHash=()=>({value:null,update(value){this.value=value;return this;},digest(){return Native.hash(typeof this.value==='string'?this.value:this.value.toString('base64'),typeof this.value!=='string');}});
function decode(raw){const value=JSON.parse(raw,(_,v)=>v&&v.__blob?Buffer.from(v.__blob,'base64'):v);if(value&&value.__error)throw Error(value.__error);return value;}
const AndroidSql={prepare(sql){return {get(...p){return decode(Native.query(sql,JSON.stringify(p)))[0];},all(...p){return decode(Native.query(sql,JSON.stringify(p)));},run(...p){return decode(Native.run(sql,JSON.stringify(p)));}};},exec(sql){decode(Native.exec(sql));},close(){}};

class Fault extends Error {constructor(status,code){super(code);this.status=status;this.code=code;}}
const fail=(status,code)=>{throw new Fault(status,code);};
const hash=x=>createHash('sha256').update(x).digest('hex');
const id=()=>randomUUID(), token=()=>randomBytes(32).toString('base64url');
const text=(x,max=2000)=>{if(typeof x!=='string'||!x.trim()||x.length>max)fail(400,'invalid_text');return x.trim();};
const day=x=>{if(typeof x!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(x)||!Number.isFinite(Date.parse(x))||new Date(x).toISOString().slice(0,10)!==x)fail(400,'invalid_date');return x;};
const cents=x=>{if(!Number.isSafeInteger(x)||x<0||x>100000000)fail(400,'invalid_amount');return x;};
const optionalNote=(x,max)=>{if(x===undefined)return '';if(typeof x!=='string'||x.length>max)fail(400,'invalid_note');return x;};
function retentionDueAt(endDate){
  day(endDate);const [year,month,date]=endDate.split('-').map(Number),targetYear=year+1;
  const monthEnd=new Date(0);monthEnd.setUTCFullYear(targetYear,month,0);
  const due=new Date(0);due.setUTCFullYear(targetYear,month-1,Math.min(date,monthEnd.getUTCDate()));
  // The retained date ends at midnight of the following Singapore calendar day.
  due.setUTCHours(16,0,0,0);return due.getTime();
}
const email=x=>{x=text(x,254).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x))fail(400,'invalid_email');return x;};
function password(p){if(typeof p!=='string'||p.length<12||p.length>256)fail(400,'password_12_to_256');return p;}
function encodePassword(p){return Native.encodePassword(password(p));}
const dummy=Native.encodePassword('dummy-unusable-password');
function checkPassword(p,encoded){return typeof p==='string'&&p.length<=256&&Native.checkPassword(p,encoded);}
class Store {
  constructor({dir='./var',now=()=>Date.now()}={}){
    this.now=()=>Native.now();this.db=AndroidSql;
    this.txDepth=0;
  }
  one(sql,...p){return this.db.prepare(sql).get(...p);}
  all(sql,...p){return this.db.prepare(sql).all(...p);}
  run(sql,...p){return this.db.prepare(sql).run(...p);}
  tx(fn){const depth=this.txDepth++,name='safelease_'+depth;
    try{this.db.exec(depth?'SAVEPOINT '+name:'BEGIN IMMEDIATE');try{const value=fn();this.db.exec(depth?'RELEASE '+name:'COMMIT');return value;}catch(e){if(depth){this.db.exec('ROLLBACK TO '+name);this.db.exec('RELEASE '+name);}else this.db.exec('ROLLBACK');throw e;}}
    finally{this.txDepth--;}
  }
  audit(actor,action,object,detail={}){this.run('INSERT INTO audits(actor,action,object_id,at,detail) VALUES(?,?,?,?,?)',actor,action,object,this.now(),JSON.stringify(detail));}
  event(u,kind,lease='',reason=''){this.run('INSERT INTO events VALUES(?,?,?,?,?,?,?)',id(),u.id,lease,kind,reason,this.now(),u.is_test);}
  provision({email:mail,name,role,isTest=false}){
    if(!['tenant','landlord','staff'].includes(role))fail(400,'invalid_role');
    const uid=id(),activation=token();
    this.run('INSERT INTO accounts(id,email,name,role,activation_hash,activation_expires,created,is_test) VALUES(?,?,?,?,?,?,?,?)',uid,email(mail),text(name,100),role,hash(activation),this.now()+86400000,this.now(),isTest?1:0);
    this.audit(null,'account_provisioned',uid,{role,isTest});return {id:uid,activation,expires:this.now()+86400000};
  }
  activate(mail,activation,p){const a=this.one('SELECT * FROM accounts WHERE email=?',email(mail));if(!a||a.disabled||a.password_hash||!a.activation_hash||a.activation_hash!==hash(text(activation,100))||a.activation_expires<=this.now())fail(403,'activation_invalid');const h=encodePassword(p);this.run('UPDATE accounts SET password_hash=?,activation_hash=NULL,activation_expires=NULL WHERE id=?',h,a.id);this.audit(a.id,'account_activated',a.id);return {ok:true};}
  login(mail,p){const a=this.one('SELECT * FROM accounts WHERE email=?',email(mail));const ok=checkPassword(p,a?.password_hash||dummy);if(!ok||!a||a.disabled||!a.password_hash)fail(401,'invalid_credentials');const raw=token(),csrf=token(),expires=this.now()+7*86400000;this.run('INSERT INTO sessions VALUES(?,?,?,?)',hash(raw),a.id,csrf,expires);this.audit(a.id,'login',a.id);return {raw,csrf,expires,user:this.publicUser(a)};}
  publicUser(a){return {id:a.id,email:a.email,name:a.name,role:a.role,is_test:a.is_test};}
  session(raw){const s=this.one('SELECT a.*,s.csrf FROM sessions s JOIN accounts a ON a.id=s.user_id WHERE s.token_hash=? AND s.expires>? AND a.disabled=0',hash(raw||''),this.now());if(!s)fail(401,'login_required');return s;}
  logout(raw){this.run('DELETE FROM sessions WHERE token_hash=?',hash(raw||''));}
  member(u,l){const m=this.one('SELECT role FROM members WHERE user_id=? AND lease_id=?',u.id,l);if(!m)fail(403,'lease_access_denied');return m;}
  tenant(u,l){if(this.member(u,l).role!=='tenant')fail(403,'tenant_required');}
  createLease(u,b){if(u.role!=='tenant')fail(403,'tenant_required');const lid=id(),start=day(b.start_date),end=day(b.end_date),refund=day(b.refund_date);if(start>end||refund<end)fail(400,'invalid_lease_dates');this.tx(()=>{this.run('INSERT INTO leases VALUES(?,?,?,?,?,?,?,?)',lid,u.id,text(b.address,500),start,end,cents(b.deposit_cents),refund,this.now());this.run('INSERT INTO members VALUES(?,?,?)',lid,u.id,'tenant');if(b.screening_id!==undefined&&b.screening_id!==''){if(typeof b.screening_id!=='string')fail(400,'invalid_screening');if(b.share_screening!==true)fail(400,'screening_share_consent_required');this.linkScreening(u,b.screening_id,lid);}this.event(u,'lease_created',lid);this.audit(u.id,'lease_created',lid);});return this.lease(u,lid);}
  screeningOwner(u,sid){const row=this.one('SELECT * FROM screenings WHERE id=?',sid);if(u.role!=='tenant'||!row||row.owner_id!==u.id)fail(403,'screening_access_denied');return row;}
  listScreenings(u){if(u.role!=='tenant')fail(403,'tenant_required');return this.all('SELECT * FROM screenings WHERE owner_id=? ORDER BY created DESC',u.id);}
  createScreening(u,b){if(u.role!=='tenant')fail(403,'tenant_required');const sid=id();this.tx(()=>{this.run('INSERT INTO screenings VALUES(?,?,?,NULL,?,NULL)',sid,u.id,text(b.title,500),this.now());this.audit(u.id,'screening_created',sid);this.event(u,'screening_created');});return this.screening(u,sid);}
  screening(u,sid){const row=this.screeningOwner(u,sid);this.audit(u.id,'screening_read',sid);return {...row,checks:this.all('SELECT * FROM screening_checks WHERE screening_id=? ORDER BY created DESC',sid)};}
  recordScreeningCheck(u,sid,{kind,object,source,status,result}){return this.tx(()=>{const row=this.screeningOwner(u,sid);if(row.lease_id)fail(409,'screening_already_linked');if(this.one('SELECT count(*) n FROM screening_checks WHERE screening_id=?',sid).n>=100)fail(400,'screening_max_100_checks');const cid=id();this.run('INSERT INTO screening_checks VALUES(?,?,?,?,?,?,?,?,?)',cid,sid,u.id,kind,object,source,status,JSON.stringify(result),this.now());this.event(u,'check_'+kind,'',result?.reason?status+':'+result.reason:status);this.audit(u.id,'screening_check_recorded',sid,{check_id:cid,kind,status,reason:result?.reason||null});return this.one('SELECT * FROM screening_checks WHERE id=?',cid);});}
  linkScreening(u,sid,lid){const row=this.screeningOwner(u,sid);if(row.lease_id)fail(409,'screening_already_linked');this.tenant(u,lid);this.run('INSERT INTO checks(id,lease_id,user_id,kind,object,source,status,result,created) SELECT id,?,user_id,kind,object,source,status,result,created FROM screening_checks WHERE screening_id=?',lid,sid);this.run('UPDATE screenings SET lease_id=?,linked_at=? WHERE id=?',lid,this.now(),sid);this.audit(u.id,'screening_linked',lid,{screening_id:sid});this.event(u,'screening_linked',lid);}
  listLeases(u){return this.all('SELECT l.*,m.role FROM leases l JOIN members m ON l.id=m.lease_id WHERE m.user_id=? ORDER BY l.created DESC',u.id);}
  lease(u,l){this.member(u,l);const lease=this.one('SELECT * FROM leases WHERE id=?',l);const refunds=this.all('SELECT * FROM refunds WHERE lease_id=? ORDER BY created',l);const returned=refunds.reduce((s,r)=>s+r.amount_cents,0);return {...lease,server_now:this.now(),members:this.all('SELECT a.id,a.name,m.role FROM members m JOIN accounts a ON m.user_id=a.id WHERE m.lease_id=?',l),refunds,returned_cents:returned,outstanding_cents:lease.deposit_cents-returned,photos:this.all('SELECT id,lease_id,uploaded_by,sha256,mime,length(bytes) AS bytes_length,received,capture_claim,purged FROM photos WHERE lease_id=?',l).map(p=>this.photoMeta(p)),records:this.all('SELECT * FROM records WHERE lease_id=?',l).map(r=>({...r,versions:this.all('SELECT * FROM versions WHERE record_id=? ORDER BY seq DESC',r.id).map(v=>this.versionData(v))})),invites:this.all('SELECT id,email,expires,revoked,accepted_by FROM invites WHERE lease_id=?',l)};}
  invite(u,l,b){this.tenant(u,l);if(this.one("SELECT 1 FROM members WHERE lease_id=? AND role='landlord'",l))fail(409,'landlord_already_bound');const mail=email(b.email);if(mail===u.email)fail(400,'separate_identity_required');const raw=token(),iid=id(),hours=b.hours??48;if(!Number.isInteger(hours)||hours<1||hours>168)fail(400,'invite_hours_1_to_168');this.run('INSERT INTO invites(id,lease_id,email,token_hash,expires,created) VALUES(?,?,?,?,?,?)',iid,l,mail,hash(raw),this.now()+hours*3600000,this.now());this.audit(u.id,'invite_created',l,{invite_id:iid,email:mail});return {id:iid,token:raw,expires:this.now()+hours*3600000};}
  revoke(u,l,i){this.tenant(u,l);this.run('UPDATE invites SET revoked=1 WHERE id=? AND lease_id=?',i,l);this.audit(u.id,'invite_revoked',l,{invite_id:i});return {ok:true};}
  accept(u,raw){if(u.role!=='landlord')fail(403,'landlord_required');return this.tx(()=>{const i=this.one('SELECT * FROM invites WHERE token_hash=?',hash(text(raw,100)));if(!i||i.revoked||i.expires<=this.now()||i.accepted_by)fail(410,'invite_expired_or_used');if(i.email!==u.email)fail(403,'invite_identity_mismatch');if(this.one("SELECT 1 FROM members WHERE lease_id=? AND role='landlord'",i.lease_id))fail(409,'landlord_already_bound');this.run('INSERT INTO members VALUES(?,?,?)',i.lease_id,u.id,'landlord');this.run('UPDATE invites SET accepted_by=? WHERE id=?',u.id,i.id);this.audit(u.id,'invite_accepted',i.lease_id,{invite_id:i.id});return {lease_id:i.lease_id};});}
  photo(u,l,bytes,{mime,captureClaim=null,sha256=null}={}){
    this.tenant(u,l);if(!Buffer.isBuffer(bytes)||bytes.length<12||bytes.length>10*1024*1024)fail(400,'photo_size');
    const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255,png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));if(!(jpeg&&mime==='image/jpeg')&&!(png&&mime==='image/png'))fail(415,'jpeg_or_png_required');
    if(captureClaim!==null&&(!Number.isFinite(Date.parse(captureClaim))||captureClaim.length>50))fail(400,'capture_claim_invalid');
    const digest=hash(bytes);if(sha256&&sha256!==digest)fail(422,'hash_mismatch');const pid=id();this.run('INSERT INTO photos VALUES(?,?,?,?,?,?,?,?,NULL)',pid,l,u.id,digest,mime,bytes,this.now(),captureClaim);this.audit(u.id,'original_received',l,{photo_id:pid,sha256:digest});return this.photoMeta(this.one('SELECT * FROM photos WHERE id=?',pid));
  }
  capture(u,l,bytes,b){
    this.tenant(u,l);
    if(typeof b.request_id!=='string'||!/^[0-9a-f-]{36}$/i.test(b.request_id))fail(400,'invalid_capture_request');
    if(!b.version||typeof b.version!=='object'||Array.isArray(b.version)||!Array.isArray(b.version.photos)||!b.photo||typeof b.photo!=='object'||Array.isArray(b.photo))fail(400,'invalid_capture_request');
    const fingerprint=hash(JSON.stringify({lease:l,kind:b.kind,version:b.version,photo:b.photo,mime:b.mime,capture_claim:b.capture_claim??null,sha256:hash(bytes)}));
    return this.tx(()=>{
      const prior=this.one('SELECT * FROM capture_commands WHERE user_id=? AND request_id=?',u.id,b.request_id);
      if(prior){if(prior.lease_id!==l||prior.fingerprint!==fingerprint)fail(409,'capture_request_conflict');return {photo:this.photoMeta(this.one('SELECT id,lease_id,uploaded_by,sha256,mime,length(bytes) AS bytes_length,received,capture_claim,purged FROM photos WHERE id=?',prior.photo_id)),version:this.versionData(this.one('SELECT * FROM versions WHERE id=?',prior.version_id)),replayed:true};}
      const photo=this.photo(u,l,bytes,{mime:b.mime,captureClaim:b.capture_claim??null});
      const version=this.addVersion(u,l,b.kind,{...b.version,photos:[...b.version.photos,{...b.photo,id:photo.id}]});
      this.run('INSERT INTO capture_commands VALUES(?,?,?,?,?,?,?)',u.id,b.request_id,l,fingerprint,photo.id,version.id,this.now());
      return {photo,version,replayed:false};
    });
  }
  photoMeta(p){const {bytes,...meta}=p;return {...meta,bytes_length:bytes?.length??meta.bytes_length??0,capture_time_type:'device_claim',receipt_time_type:'device_backend_received'};}
  getPhoto(u,pid){const p=this.one('SELECT * FROM photos WHERE id=?',pid);if(!p)fail(404,'photo_not_found');this.member(u,p.lease_id);this.audit(u.id,'photo_read',p.lease_id,{photo_id:pid});if(!p.bytes)fail(410,'photo_retention_purged');return p;}
  versionData(v){const decisions=this.all('SELECT d.*,a.name,m.role FROM decisions d JOIN accounts a ON d.user_id=a.id JOIN records r ON r.id=? JOIN members m ON m.lease_id=r.lease_id AND m.user_id=d.user_id WHERE version_id=?',v.record_id,v.id);let status='pending';if(decisions.some(d=>d.kind==='dispute'))status='disputed';else if(decisions.some(d=>d.kind==='refuse'))status='refused';else if(['tenant','landlord'].every(role=>decisions.some(d=>d.role===role&&d.kind==='confirm')))status='bilateral';else if(this.now()>=v.deadline)status='one_sided_timeout';return {...v,body:JSON.parse(v.body),decisions,status,locked:status==='bilateral'};}
  addVersion(u,l,kind,b){this.tenant(u,l);if(!['movein','moveout'].includes(kind))fail(400,'invalid_record_kind');return this.tx(()=>{
    let r=this.one('SELECT * FROM records WHERE lease_id=? AND kind=?',l,kind);if(!r){r={id:id(),lease_id:l,kind,created:this.now()};this.run('INSERT INTO records VALUES(?,?,?,?)',r.id,l,kind,r.created);}
    const old=this.one('SELECT * FROM versions WHERE record_id=? ORDER BY seq DESC LIMIT 1',r.id);
    if((b.expected_version??null)!==(old?.id??null))fail(409,'version_changed_refresh');
    const requiresSupplement=old&&(this.versionData(old).locked||old.deadline<=this.now()||this.versionData(old).status==='refused'||this.versionData(old).status==='disputed');
    if(requiresSupplement&&!b.supplement)fail(409,'supplement_required');
    if(b.supplement!==undefined&&typeof b.supplement!=='boolean')fail(400,'invalid_supplement_flag');
    if(!Array.isArray(b.photos)||b.photos.length>40)fail(400,'max_40_photos');
    const recordNote=optionalNote(b.note,4000);
    const seen=new Set();const photos=b.photos.map(x=>{if(!x||typeof x!=='object'||Array.isArray(x)||typeof x.id!=='string'||!x.id||x.id.length>100)fail(400,'invalid_photo_reference');if(seen.has(x.id))fail(400,'duplicate_photo');seen.add(x.id);const p=this.one('SELECT id,lease_id,sha256,mime,length(bytes) AS bytes_length,received,capture_claim,purged FROM photos WHERE id=? AND lease_id=?',x.id,l);if(!p||!p.bytes_length||p.purged!==null)fail(400,'photo_not_available');let paired=null;if(x.paired_with){if(kind!=='moveout')fail(400,'pair_moveout_only');const inr=this.one("SELECT id FROM records WHERE lease_id=? AND kind='movein'",l);const vv=inr&&this.all('SELECT body FROM versions WHERE record_id=?',inr.id);if(!vv||!vv.some(v=>JSON.parse(v.body).photos.some(z=>z.id===x.paired_with)))fail(400,'paired_photo_not_in_movein');paired=x.paired_with;}return {id:p.id,sha256:p.sha256,received:p.received,capture_claim:p.capture_claim,mime:p.mime,room:text(x.room,100),note:optionalNote(x.note,2000),paired_with:paired};});
    const body=JSON.stringify({note:recordNote,photos});const fresh=!old||Boolean(b.supplement),opened=fresh?this.now():old.opened;const v={id:id(),record_id:r.id,seq:(old?.seq??0)+1,parent_id:old?.id??null,base_id:fresh&&old?old.id:old?.base_id??null,opened,deadline:opened+48*3600000,created:this.now(),created_by:u.id,body,digest:hash(body)};
    this.run('INSERT INTO versions VALUES(?,?,?,?,?,?,?,?,?,?,?)',...['id','record_id','seq','parent_id','base_id','opened','deadline','created','created_by','body','digest'].map(k=>v[k]));
    this.audit(u.id,'version_created',l,{version_id:v.id,digest:v.digest,supplement:fresh&&!!old});this.event(u,kind+'_version',l);return this.versionData(v);
  });}
  decide(u,l,vid,b){this.member(u,l);if(!['confirm','dispute','refuse'].includes(b.kind))fail(400,'invalid_decision');return this.tx(()=>{const v=this.one('SELECT v.* FROM versions v JOIN records r ON r.id=v.record_id WHERE v.id=? AND r.lease_id=?',vid,l);if(!v)fail(404,'version_not_found');const latest=this.one('SELECT id FROM versions WHERE record_id=? ORDER BY seq DESC LIMIT 1',v.record_id);if(latest.id!==vid)fail(409,'superseded_version');if(b.digest!==v.digest)fail(409,'version_digest_mismatch');if(b.kind==='confirm'&&this.now()>=v.deadline)fail(409,'confirmation_window_closed');if(this.one('SELECT 1 FROM decisions WHERE version_id=? AND user_id=?',vid,u.id))fail(409,'decision_already_recorded');const note=optionalNote(b.note,2000);if(b.kind!=='confirm'&&!note.trim())fail(400,'decision_reason_required');this.run('INSERT INTO decisions VALUES(?,?,?,?,?)',vid,u.id,b.kind,note,this.now());this.audit(u.id,'decision_'+b.kind,l,{version_id:vid,digest:v.digest});if(b.kind==='dispute')this.createCase(u,l,{subject:'Version dispute '+vid,photo_ids:JSON.parse(v.body).photos.map(p=>p.id)},false);this.event(u,'decision_'+b.kind,l);return this.versionData(v);});}
  refund(u,l,b){this.tenant(u,l);return this.tx(()=>{const a=cents(b.amount_cents);if(!a)fail(400,'positive_refund_required');const lease=this.lease(u,l);if(a>lease.outstanding_cents)fail(400,'refund_exceeds_deposit');this.run('INSERT INTO refunds VALUES(?,?,?,?,?,?,?)',id(),l,a,day(b.received_date),optionalNote(b.note,2000),u.id,this.now());this.audit(u.id,'refund_recorded',l,{amount_cents:a});return this.lease(u,l);});}
  createCase(u,l,b,audit=true){this.member(u,l);const photos=b.photo_ids??[];if(!Array.isArray(photos)||photos.length>40||photos.some(pid=>!this.one('SELECT 1 FROM photos WHERE id=? AND lease_id=?',pid,l)))fail(400,'invalid_case_photos');const cid=id();this.run('INSERT INTO cases(id,lease_id,requester,subject,photo_ids,created) VALUES(?,?,?,?,?,?)',cid,l,u.id,text(b.subject),JSON.stringify(photos),this.now());if(audit)this.audit(u.id,'case_created',l,{case_id:cid});return {id:cid};}
  queue(u){if(u.role==='staff')return this.all('SELECT id,subject,status,assignee,created FROM cases ORDER BY created');return this.all('SELECT c.* FROM cases c JOIN members m ON c.lease_id=m.lease_id WHERE m.user_id=? ORDER BY created',u.id);}
  caseAccess(u,cid){const c=this.one('SELECT * FROM cases WHERE id=?',cid);if(!c)fail(404,'case_not_found');if(u.role==='staff'){if(c.assignee!==u.id)fail(403,'case_not_assigned');}else this.member(u,c.lease_id);return c;}
  caseDetail(u,cid){const c=this.caseAccess(u,cid);this.audit(u.id,'case_read',c.id);return {...c,photo_ids:JSON.parse(c.photo_ids),replies:this.all('SELECT id,author,body,created FROM replies WHERE case_id=? ORDER BY created',cid)};}
  assign(u,cid){if(u.role!=='staff')fail(403,'staff_required');const r=this.run('UPDATE cases SET assignee=? WHERE id=? AND (assignee IS NULL OR assignee=?)',u.id,cid,u.id);if(!r.changes)fail(409,'case_already_assigned');this.audit(u.id,'case_assigned',cid);return this.caseDetail(u,cid);}
  reply(u,cid,b){this.caseAccess(u,cid);const body=text(b.body,4000);this.run('INSERT INTO replies VALUES(?,?,?,?,?)',id(),cid,u.id,body,this.now());this.audit(u.id,'case_reply',cid);return this.caseDetail(u,cid);}
  resolve(u,cid){const c=this.caseAccess(u,cid);if(u.role!=='staff')fail(403,'staff_required');this.run("UPDATE cases SET status='resolved',hold=0 WHERE id=?",c.id);this.audit(u.id,'case_resolved_hold_released',c.id);return this.caseDetail(u,cid);}
  casePhoto(u,cid,pid){const c=this.caseAccess(u,cid);if(c.status!=='open')fail(403,'case_closed');if(!JSON.parse(c.photo_ids).includes(pid))fail(403,'photo_outside_case');const p=this.one('SELECT * FROM photos WHERE id=? AND lease_id=?',pid,c.lease_id);if(!p?.bytes)fail(410,'photo_retention_purged');this.audit(u.id,'case_photo_read',cid,{photo_id:pid});return p;}
  recordCheck(u,l,{kind,object,source,status,result}){this.member(u,l);return this.tx(()=>{const cid=id();this.run('INSERT INTO checks VALUES(?,?,?,?,?,?,?,?,?)',cid,l,u.id,kind,object,source,status,JSON.stringify(result),this.now());this.event(u,'check_'+kind,l,result?.reason?status+':'+result.reason:status);this.audit(u.id,'check_recorded',l,{check_id:cid,kind,status,reason:result?.reason||null});return this.one('SELECT * FROM checks WHERE id=?',cid);});}
  survey(u,b){for(const key of ['pu','peou'])if(!Array.isArray(b[key])||b[key].length!==4||b[key].some(n=>!Number.isInteger(n)||n<1||n>7))fail(400,'survey_four_items_1_to_7');this.run('INSERT INTO surveys VALUES(?,?,?,?,?,?)',id(),u.id,JSON.stringify(b.pu),JSON.stringify(b.peou),this.now(),u.is_test);return {pu_mean:b.pu.reduce((s,n)=>s+n,0)/4,peou_mean:b.peou.reduce((s,n)=>s+n,0)/4};}
  metrics(u){
    if(u.role!=='staff')fail(403,'staff_required');
    const cohorts=[0,1].map(is_test=>{
      const leases=this.all('SELECT l.* FROM leases l JOIN accounts a ON l.tenant_id=a.id WHERE a.is_test=?',is_test);
      const stages={lease_created:leases.length,movein_recorded:0,landlord_joined:0,movein_bilateral:0,moveout_recorded:0,evidence_generated:0,core_records_and_export:0};
      for(const l of leases){const records=this.all('SELECT * FROM records WHERE lease_id=?',l.id);const has=kind=>records.some(r=>r.kind===kind&&this.one('SELECT 1 FROM versions WHERE record_id=?',r.id));const movein=has('movein'),moveout=has('moveout'),exported=Boolean(this.one("SELECT 1 FROM events WHERE lease_id=? AND kind='evidence_exported'",l.id));if(movein)stages.movein_recorded++;if(moveout)stages.moveout_recorded++;if(exported)stages.evidence_generated++;if(this.one("SELECT 1 FROM members WHERE lease_id=? AND role='landlord'",l.id))stages.landlord_joined++;if(records.filter(r=>r.kind==='movein').some(r=>this.all('SELECT * FROM versions WHERE record_id=?',r.id).some(v=>this.versionData(v).status==='bilateral')))stages.movein_bilateral++;if(movein&&moveout&&exported)stages.core_records_and_export++;}
      const surveys=this.all('SELECT pu,peou FROM surveys WHERE is_test=?',is_test);const mean=k=>surveys.length?surveys.reduce((sum,row)=>sum+JSON.parse(row[k]).reduce((s,n)=>s+n,0)/4,0)/surveys.length:null;
      return {is_test,denominator:'leases created by this cohort',stages,core_completion_rate:leases.length?stages.core_records_and_export/leases.length:null,questionnaire:{responses:surveys.length,pu_mean:mean('pu'),peou_mean:mean('peou')}};
    });
    return {cohorts,events:this.all('SELECT is_test,kind,reason,count(*) count FROM events GROUP BY is_test,kind,reason'),note:'Observed records and generated exports only. A generated file is not proof of a successful download or rental outcome. No-response participation is not bilateral. Empty cohort rate is null. Test and live cohorts remain separate.'};
  }
  purge(){const now=this.now();const due=this.all("SELECT * FROM leases WHERE NOT EXISTS(SELECT 1 FROM cases WHERE cases.lease_id=leases.id AND hold=1)").filter(l=>{return now>=retentionDueAt(l.end_date);});let count=0;this.tx(()=>{for(const l of due){const r=this.run('UPDATE photos SET bytes=NULL,purged=? WHERE lease_id=? AND bytes IS NOT NULL',now,l.id);count+=Number(r.changes);if(r.changes)this.audit(null,'retention_purged',l.id,{photos:Number(r.changes)});}this.run('DELETE FROM sessions WHERE expires<=?',now);});this.db.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM;');return {photos_purged:count,at:now,backup_note:'Live SQLite bytes removed; separate backups require independently verified expiry. No backup deletion claimed.'};}
  close(){this.db.close();}
  lockRestoredAccess(){return this.tx(()=>{this.run('DELETE FROM sessions');const r=this.run('UPDATE accounts SET disabled=1,activation_hash=NULL,activation_expires=NULL');this.audit(null,'restore_access_locked','accounts',{accounts:Number(r.changes),reason:'Backup sessions, old credentials and activation tokens must not regain access after restore'});return {accounts_locked:Number(r.changes),sessions_revoked:true,operator_reactivation_required:true};});}
}

const compareNames=globalThis.Model.compareNames;
function paynowCheck(b){
  const visible=optionalNote(b.visible,100),expected=optionalNote(b.expected,100),comparison=compareNames(visible,expected);
  const incomplete=['empty','invalid','few','company'].includes(comparison.status);
  return {kind:'paynow_helper',object:visible+' ↔ '+expected,source:'User input / 用户输入 · SafeLease character comparison / 字符比较',status:incomplete?'not_checked':'user_reported_not_verified',result:{visible,expected,comparison:comparison.status,...(incomplete?{reason:'insufficient_name_input'}:{}),limitation:'Character comparison of user-entered visible text only. No PayNow or bank connection. Does not verify identity, bank account ownership or property ownership.'}};
}
function ceaCheck(b){
  const registration=optionalNote(b.registration,100),note=optionalNote(b.note,4000),incomplete=!registration.trim()||!note.trim();
  return {kind:'cea_self_report',object:registration,source:'https://eservices.cea.gov.sg/aceas/public-register/sales/1/',status:incomplete?'not_checked':'user_reported_not_verified',result:{note,...(incomplete?{reason:'insufficient_register_observation'}:{}),limitation:'User-reported official-register check; platform has not verified the identity of the person contacting you.'}};
}

window.AndroidCore={Store,Fault,fail,hash,Buffer,decode,paynowCheck,ceaCheck,retentionDueAt};})();
