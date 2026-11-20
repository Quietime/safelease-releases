(function(){const {Store,Buffer,paynowCheck,ceaCheck}=AndroidCore;const password='SafeLease-Demo-2026!';
const accounts={tenant:{email:'tenant@demo.invalid',name:'DEMO Tenant / 演示租客',role:'tenant'},landlord:{email:'landlord@demo.invalid',name:'DEMO Landlord / 演示房东',role:'landlord'},staff:{email:'staff@demo.invalid',name:'DEMO Reviewer / 演示复核员',role:'staff'},other:{email:'other@demo.invalid',name:'DEMO Unrelated / 无关账户',role:'landlord'}};

window.seedAndroid=function(localStore){
  let clock=Date.now();const store=localStore;store.now=()=>clock;
  const users={},scenarios=[];
  try{
    for(const [key,a] of Object.entries(accounts)){const provisioned=store.provision({...a,isTest:true});store.activate(a.email,provisioned.activation,password);users[key]=store.one('SELECT * FROM accounts WHERE id=?',provisioned.id);}
    const today=new Date(clock).toISOString().slice(0,10),year=Number(today.slice(0,4));
    const lease=(address,old=false)=>store.createLease(users.tenant,{address:'DEMO / 演示 · '+address,start_date:old?(year-3)+'-01-01':today,end_date:old?(year-3)+'-12-31':(year+1)+'-10-01',refund_date:old?(year-2)+'-01-14':(year+1)+'-10-14',deposit_cents:200000});
    const joinLandlord=l=>{const invite=store.invite(users.tenant,l.id,{email:accounts.landlord.email});store.accept(users.landlord,invite.token);};
const fixtures=[Buffer.from(Native.fixture(false),'base64'),Buffer.from(Native.fixture(true),'base64')];
    function record(l,kind='movein',damaged=false,extra={}){
      const p=store.photo(users.tenant,l.id,fixtures[damaged?1:0],{mime:'image/jpeg',captureClaim:new Date(clock).toISOString()});
      const v=store.addVersion(users.tenant,l.id,kind,{note:'DEMO ILLUSTRATION / 演示插图，非实际相机记录',photos:[{id:p.id,room:'Demo room / 演示房间',note:damaged?'DEMO scratch / 演示划痕':'DEMO baseline / 演示基线',...extra}]});
      return {photo:p,version:v};
    }
    function confirm(l,v,u=users.tenant){return store.decide(u,l.id,v.id,{kind:'confirm',digest:v.digest,note:'DEMO independent decision / 演示独立确认'});}
    const screening=store.createScreening(users.tenant,{title:'DEMO · Pre-lease checks / 租约前检查'});
    store.recordScreeningCheck(users.tenant,screening.id,paynowCheck({visible:'T** M** L***',expected:'Tan Mei Ling'}));
    store.recordScreeningCheck(users.tenant,screening.id,ceaCheck({registration:'DEMO-NOT-A-REAL-REGISTRATION',note:'DEMO observation only / 演示自报记录，未核实真实中介或产权'}));
    // Preserve the actual historic timestamp and label the replay in the visible source.
    const history=JSON.parse(Native.asset('historical-image-query.json'));
    const current=clock;clock=history.actual.created;
    store.recordScreeningCheck(users.tenant,screening.id,{kind:'image',object:history.image,source:history.actual.source+' · HISTORICAL TEST REPLAY / 历史测试回放',status:history.actual.status,result:{...history.actual,note:'Historical real query of a public NASA image. Not a new query, not a rental verification. / 公共NASA图片历史真实查询回放，并非本次新查询或房源核验。'}});
    clock=current;
    const live=lease('01 · Start here / 现场操作起点');scenarios.push({key:'live',lease_id:live.id,address:live.address,description:'Empty lease. Take a real camera photo; invite landlord@demo.invalid in another session.'});
    const both=lease('02 · Both confirmed + new supplement / 双方确认与补充');joinLandlord(both);
    const baseline=record(both);confirm(both,baseline.version);confirm(both,baseline.version,users.landlord);
    const supplement=store.addVersion(users.tenant,both.id,'movein',{expected_version:baseline.version.id,supplement:true,note:'DEMO supplement awaiting fresh decisions / 补充版本等待重新确认',photos:[{id:baseline.photo.id,room:'Demo room',note:'Additional annotation / 新增批注'}]});
    const moveout=record(both,'moveout',true,{paired_with:baseline.photo.id});confirm(both,moveout.version);
    store.refund(users.tenant,both.id,{amount_cents:150000,received_date:today,note:'DEMO partial refund / 演示部分退款'});
    scenarios.push({key:'bilateral',lease_id:both.id,address:both.address,baseline:baseline.version.id,supplement:supplement.id,moveout:moveout.version.id,photo_id:baseline.photo.id});
    const timeout=lease('03 · One-sided after 48h / 48小时后仍为单方');clock-=49*3600000;const late=record(timeout);confirm(timeout,late.version);clock=current;scenarios.push({key:'timeout',lease_id:timeout.id,address:timeout.address,version_id:late.version.id});
    const disputed=lease('04 · Dispute and review queue / 异议与人工复核');joinLandlord(disputed);const issue=record(disputed);confirm(disputed,issue.version);store.decide(users.landlord,disputed.id,issue.version.id,{kind:'dispute',digest:issue.version.digest,note:'DEMO disagreement: illustration condition needs review / 演示异议，请复核照片批注'});scenarios.push({key:'disputed',lease_id:disputed.id,address:disputed.address});
    const refused=lease('05 · Refused participation / 房东拒绝参与');joinLandlord(refused);const declined=record(refused);confirm(refused,declined.version);store.decide(users.landlord,refused.id,declined.version.id,{kind:'refuse',digest:declined.version.digest,note:'DEMO refusal / 演示拒绝，不代表双方认可'});scenarios.push({key:'refused',lease_id:refused.id,address:refused.address});
    for(const hold of [false,true]){const old=lease(hold?'07 · Retention hold / 争议保留':'06 · Retention due / 到期清理',true);const r=record(old);if(hold)store.createCase(users.tenant,old.id,{subject:'DEMO retention hold / 演示争议保留',photo_ids:[r.photo.id]});scenarios.push({key:hold?'held':'expired',lease_id:old.id,address:old.address,photo_id:r.photo.id});}
    const manifest={format:'SafeLease local presentation 1',created:new Date(current).toISOString(),scope:'Synthetic demonstration only. No real participants or rental outcomes.',screening_id:screening.id,accounts,scenarios};
Native.setting('demo-seed',JSON.stringify(manifest));return manifest;
  }finally{store.now=()=>Native.now();}
};})();