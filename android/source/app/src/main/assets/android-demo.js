(function(){'use strict';
const language=()=>localStorage.getItem('safelease-language')==='zh'?'zh':'en';
const t=(en,zh)=>language()==='zh'?zh:en;
const catalog=JSON.parse(Native.asset('android-ui-copy.json'));
let lastScope='';
function text(value){if(typeof value!=='string')return value;if(value.startsWith('Version dispute '))return t('Version dispute ','版本异议 ')+value.slice(16);const pair=catalog[value];return pair?pair[language()==='zh'?1:0]:value;}
function apply(){
 Native.setting('language',language());
 document.querySelector('#settings').textContent=t('Settings','设置');
 document.querySelector('#language').textContent=t('Language','语言');
 document.querySelector('#camera h2').textContent=t('Camera','相机');
 document.querySelector('label:has(#camera-room)').firstChild.textContent=t('Room','房间');
 document.querySelector('label:has(#camera-note)').firstChild.textContent=t('Note','备注');
 document.querySelector('#capture').textContent=t('Capture & save','拍摄并保存');
 document.querySelector('#close-camera').textContent=t('Cancel','取消');
 if(!document.querySelector('#camera-room').value||['Room','房间'].includes(document.querySelector('#camera-room').value))document.querySelector('#camera-room').value=t('Room','房间');
 for(const form of document.querySelectorAll('form'))form.noValidate=true;
 if(typeof view!=='undefined'){const scope=view+(view==='lease'?lease?.id||'':view==='screening'?screening?.id||'':'');if(scope!==lastScope){window.scrollTo(0,0);lastScope=scope;}}
}
function settings(){
 beginView('settings');const prefs=JSON.parse(Native.updatePreferences()),status=JSON.parse(Native.updateStatus());
 const toggle=(key,en,zh)=>`<label class="settings-row"><span>${tr(en,zh)}</span><input type="checkbox" data-update-pref="${key}" ${prefs[key]?'checked':''}></label>`;
 shell(`<h1>${tr('Settings','设置')}</h1><section class="panel"><h2>${tr('App updates','应用更新')}</h2><p>${tr('Installed version','当前版本')} ${esc(status.currentVersion)}</p>${toggle('autoCheck','Check for updates when the app opens','打开应用时检查更新')}${toggle('autoDownload','Download updates automatically','自动下载更新')}${toggle('autoInstall','Start installation automatically','自动开始安装')}<p class="muted">${tr('Android asks you to confirm installation. The downloaded package is removed after Android confirms the update.','安卓系统需要你确认安装。安卓系统确认更新成功后会自动删除下载的安装包。')}</p><p class="muted">${tr('System permission and installer dialogs follow your device language.','系统权限和安装器窗口遵循手机系统语言。')}</p><p id="update-status" class="update-status" role="status"></p><div class="actions"><button id="check-update">${tr('Check now','立即检查')}</button><button id="download-update">${tr('Download update','下载更新')}</button><button id="install-update">${tr('Install update','安装更新')}</button></div></section><section class="panel"><h2>${tr('Your records','你的记录')}</h2><p>${tr('Records and photos are stored privately on this phone.','记录和照片保存在此手机的私有存储中。')}</p>${user?`<p>${esc(user.email==='guest@safelease.local'?tr('Guest','访客'):user.email)}</p>`:''}<button id="settings-back">${tr('Back','返回')}</button>${user?.role==='staff'?`<button id="retention-purge">${tr('Remove expired photos','清理到期照片')}</button>`:''}</section>`);
 document.querySelector('#settings-back').onclick=()=>user?home():renderAuth();
 for(const input of document.querySelectorAll('[data-update-pref]'))input.onchange=()=>Native.updatePreference(input.dataset.updatePref,input.checked);
 for(const [id,action]of[['check-update','check'],['download-update','download'],['install-update','install']])document.getElementById(id).onclick=()=>{Native.updateAction(action);updateStatus();};
 document.querySelector('#retention-purge')?.addEventListener('click',async()=>{try{const result=await api('/maintenance/purge',{});notify(tr('Expired photos removed: ','已清理到期照片：')+result.photos_purged);}catch(err){error(err);}});
 updateStatus();
}
function updateStatus(){const box=document.querySelector('#update-status');if(!box)return;const s=JSON.parse(Native.updateStatus());const names={idle:['No update check yet.','尚未检查更新。'],checking:['Checking for updates…','正在检查更新…'],current:['You are using the latest version.','当前已是最新版本。'],available:['An update is available.','发现新版本。'],downloading:['Downloading update…','正在下载更新…'],ready:['Update downloaded and verified.','更新已下载并校验。'],installing:['Follow Android to finish installation.','请按安卓系统提示完成安装。'],permission:['Allow this app to install updates in Android settings.','请在安卓设置中允许此应用安装更新。'],cancelled:['Installation cancelled. The verified package is kept for retry.','安装已取消，已保留通过校验的安装包供重试。'],updated:['Update installed. Downloaded package removed.','更新已安装，下载的安装包已删除。'],failed:['Could not update. Check your connection and try again.','更新未完成，请检查网络后重试。']};box.textContent=tr(...(names[s.state]||names.failed))+(s.versionName?' '+s.versionName:'')+(s.state==='downloading'?' '+s.progress+'%':'')+(s.packageRemoved?'\n'+tr('The downloaded installer has been removed.','下载的安装包已删除。'):'');document.querySelector('#download-update').hidden=!['available','failed'].includes(s.state)||!s.versionName;document.querySelector('#install-update').hidden=!['ready','permission','cancelled'].includes(s.state);}
window.AndroidUI={apply,text,settings,canInstall:()=>!document.querySelector('#camera[open]')&&['home','auth','settings'].includes(view)&&!document.activeElement?.matches('input,textarea,select')};
window.androidExportResult=value=>notify(text(value),{persistent:true});
document.querySelector('#settings').onclick=settings;
document.addEventListener('submit',event=>{
 const form=event.target;if(!(form instanceof HTMLFormElement))return;
 form.querySelectorAll('.field-invalid').forEach(e=>e.classList.remove('field-invalid'));
 const invalid=[...form.elements].find(e=>e.willValidate&&!e.validity.valid);if(!invalid)return;
 event.preventDefault();event.stopImmediatePropagation();invalid.classList.add('field-invalid');
 const v=invalid.validity;let message=v.valueMissing?t('Please complete this field.','请填写此项。'):v.typeMismatch?(invalid.type==='email'?t('Please enter a valid email address.','请输入有效邮箱地址。'):t('Please enter a valid URL.','请输入有效链接。')):v.tooShort?t('This value is too short.','输入内容过短。'):v.rangeUnderflow||v.rangeOverflow?t('Please enter a value within the allowed range.','请输入允许范围内的数值。'):t('Please check this field.','请检查此项。');error(Error('localized_validation'),form);const box=form.querySelector('.form-error p');if(box)box.textContent=message;invalid.focus();
},true);
document.addEventListener('click',async event=>{if(event.target.closest('#guest-login')){const button=event.target.closest('#guest-login');button.disabled=true;try{const result=await api('/guest',{});user=result.user;csrf=result.csrf;await home();}catch(err){error(err,document.querySelector('#login'));}finally{button.disabled=false;}}});
document.addEventListener('input',event=>event.target.classList?.remove('field-invalid'));
setInterval(()=>{if(typeof view!=='undefined'&&view==='settings')updateStatus();},1000);
apply();
})();
