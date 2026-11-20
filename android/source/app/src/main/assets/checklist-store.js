(function(){'use strict';
const {fail,Buffer,hash,decode}=AndroidCore;
const string=(v,max=500)=>{if(v===undefined)return '';if(typeof v!=='string'||v.length>max)fail(400,'invalid_note');return v.trim();};
const validDay=v=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)fail(400,'invalid_date');return v;};
function intake(s,u,b){
 if(u.role!=='tenant')fail(403,'tenant_required');
 const url=string(b.listing_url,2000),phone=string(b.phone,40),address=string(b.address,500),post=string(b.post_text,5000),mime=string(b.screenshot_mime,30);
 if(url){let parsed;try{parsed=new URL(url);}catch{fail(400,'public_https_image_url_required');}if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.hostname==='localhost')fail(400,'public_https_image_url_required');}
 if(phone&&!/^[+\d ()-]{5,40}$/.test(phone))fail(400,'invalid_text');
 const encoded=string(b.screenshot_base64,8*1024*1024);let bytes=null;
 if(encoded){if(!['image/png','image/jpeg'].includes(mime))fail(415,'jpeg_or_png_required');bytes=Buffer.from(encoded,'base64');if(bytes.length>6*1024*1024)fail(400,'photo_size');decode(Native.validatePhoto(encoded,mime));}
 if(!url&&!bytes)fail(400,'listing_link_or_screenshot_required');
 if(typeof b.prepay!=='boolean')fail(400,'invalid_text');
 return s.tx(()=>{const row=s.createScreening(u,{title:address||url||'Listing screenshot'});s.run('INSERT INTO listing_intakes VALUES(?,?,?,?,?,?,?,?,?)',row.id,url,phone,address,post,b.prepay?1:0,bytes,mime,s.now());
  s.recordScreeningCheck(u,row.id,{kind:'listing_context',object:address||url||'Screenshot',source:'Local user input',status:'user_reported_not_verified',result:{url,phone,address,prepay:b.prepay,screenshot_sha256:bytes?hash(bytes):null,image_lookup:'not_checked',owner_name:'not_checked',note:'User supplied details. No OCR, live image search, identity or ownership verification.'}});return {id:row.id};});
}
function readIntake(s,u,sid){s.screeningOwner(u,sid);const row=s.one('SELECT * FROM listing_intakes WHERE screening_id=?',sid);if(!row)return null;return {...row,screenshot:row.screenshot?row.screenshot.toString('base64'):null};}
function plan(s,u,lid,b){s.member(u,lid);if(b){s.tenant(u,lid);const name=string(b.owner_name,100),renewal=string(b.renewal_end,10),rooms=b.rooms;
 if(!Array.isArray(rooms)||rooms.length<1||rooms.length>20||rooms.some(x=>typeof x!=='string'||!x.trim()||x.length>60)||new Set(rooms.map(x=>x.trim().toLowerCase())).size!==rooms.length)fail(400,'invalid_room_plan');
 if(renewal){validDay(renewal);if(renewal<s.one('SELECT end_date FROM leases WHERE id=?',lid).end_date)fail(400,'invalid_lease_dates');}
 s.tx(()=>{s.run('INSERT OR REPLACE INTO lease_plans VALUES(?,?,?,?,?)',lid,name,JSON.stringify(rooms.map(x=>x.trim())),renewal,s.now());s.audit(u.id,'lease_plan_saved',lid,{owner_name_user_entered:true,rooms:rooms.length,renewal_end:renewal});});}
 const row=s.one('SELECT * FROM lease_plans WHERE lease_id=?',lid);return row?{...row,rooms:JSON.parse(row.rooms)}:{lease_id:lid,owner_name:'',rooms:[],renewal_end:'',updated:null};}
function draft(s,u,lid,b){s.member(u,lid);if(b){const letter=string(b.letter,12000),items=b.attachments;if(!Array.isArray(items)||items.some(x=>!['movein','moveout'].includes(x))||new Set(items).size!==items.length)fail(400,'invalid_attachments');
 const records=s.lease(u,lid).records;for(const kind of items)if(!records.some(r=>r.kind===kind&&r.versions.length&&(kind!=='moveout'||r.versions.some(v=>v.body.photos.length))))fail(400,'attachment_unavailable');
 s.run('INSERT OR REPLACE INTO evidence_drafts VALUES(?,?,?,?,?)',lid,u.id,letter,JSON.stringify(items),s.now());s.audit(u.id,'evidence_draft_saved',lid,{attachments:items});}
 const row=s.one('SELECT * FROM evidence_drafts WHERE lease_id=? AND user_id=?',lid,u.id);return row?{...row,attachments:JSON.parse(row.attachments)}:{letter:'',attachments:[],updated:null};}
function access(s,u,lid){s.member(u,lid);s.audit(u.id,'access_log_read',lid);return {retention_due:AndroidCore.retentionDueAt(s.one('SELECT end_date FROM leases WHERE id=?',lid).end_date),hold:Boolean(s.one('SELECT 1 FROM cases WHERE lease_id=? AND hold=1',lid)),entries:s.all('SELECT a.action,a.at,a.detail,coalesce(p.name,?) actor_name FROM audits a LEFT JOIN accounts p ON a.actor=p.id WHERE a.object_id=? OR a.object_id IN(SELECT id FROM cases WHERE lease_id=?) ORDER BY a.at DESC,a.id DESC LIMIT 100','System',lid,lid)};}
window.ChecklistData={intake,readIntake,plan,draft,access};
})();
