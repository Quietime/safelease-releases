(function(root){
  'use strict';
  const normal=s=>String(s||'').normalize('NFKC').trim().toUpperCase().replace(/[＊*•●]/g,'X').replace(/\s+/g,' ');
  function compareNames(payee,owner){
    const p=normal(payee),o=normal(owner);
    if(!p||!o)return {status:'empty',payee:p,owner:o};
    if(!/^[\p{L} .'-]+$/u.test(p)||!/^[\p{L} .'-]+$/u.test(o))return {status:'invalid',payee:p,owner:o};
    if(/\b(PTE|LTD|LLP|SERVICES)\b/.test(p+' '+o))return {status:'company',payee:p,owner:o};
    const visible=[...p].filter(c=>/\p{L}/u.test(c)&&c!=='X').length;
    if(visible<3)return {status:'few',payee:p,owner:o};
    const a=p.split(' '),b=o.split(' ');
    const ok=a.length===b.length&&a.every((word,i)=>{
      const other=b[i];
      if(word.endsWith('XX')){
        const head=word.slice(0,-2),hidden=other.length-head.length;
        return hidden>=1&&hidden<=3&&[...head].every((c,j)=>c==='X'||c===other[j]);
      }
      return word.length===other.length&&[...word].every((c,j)=>c==='X'||c===other[j]);
    });
    return {status:ok?'match':'stop',payee:p,owner:o};
  }
  const day=86400000;
  function dateMs(s){if(!/^\d{4}-\d{2}-\d{2}$/.test(s||''))return NaN;const n=Date.parse(s+'T00:00:00+08:00');return Number.isFinite(n)&&new Date(n+8*3600000).toISOString().slice(0,10)===s?n:NaN;}
  function addDays(s,n){const d=dateMs(s);return Number.isFinite(d)?new Date(d+Number(n)*day+8*3600000).toISOString().slice(0,10):'';}
  function daysLeft(s,now=Date.now()){const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now));const get=t=>parts.find(x=>x.type===t).value;return Math.round((dateMs(s)-dateMs(get('year')+'-'+get('month')+'-'+get('day')))/day);}
  function validateLease(l){
    if(!l.address?.trim()||!l.owner?.trim())return 'required';
    if(!Number.isFinite(dateMs(l.start))||!Number.isFinite(dateMs(l.end))||dateMs(l.end)<=dateMs(l.start))return 'dates';
    if(!Number.isFinite(Number(l.deposit))||Number(l.deposit)<=0||!Number.isFinite(Number(l.rent))||Number(l.rent)<=0)return 'amount';
    if(!/^\d+$/.test(String(l.refundDays))||Number(l.refundDays)<0||Number(l.refundDays)>365)return 'refund';
    return null;
  }
  function leaseMonths(l){const s=new Date(dateMs(l.start)),e=new Date(dateMs(l.end)+day);return (e.getUTCFullYear()-s.getUTCFullYear())*12+e.getUTCMonth()-s.getUTCMonth()+(e.getUTCDate()-s.getUTCDate())/31;}
  function recordStatus(r,now=Date.now()){if(!r)return 'none';return now>=r.opened+2*day?'one_sided':r.confirmed?'confirmed':'open';}
  const api={compareNames,normal,dateMs,addDays,daysLeft,validateLease,leaseMonths,recordStatus,day};
  if(typeof module!=='undefined')module.exports=api;root.Model=api;
})(typeof window!=='undefined'?window:globalThis);
