'use strict';
// GSAP 3.15.0 is bundled locally. No CDN, telemetry, or remote runtime is used.
// Motion Prompt #049-072 · MIT License (c) 2026 Shohei Ohtaki · https://showheyohtaki.github.io/motion-prompt/#049
// Kit easing port: eo(t)=1-(1-t)^3; eio(t)=4*t^3 / 1-(-2*t+2)^3/2.
const motionEaseOut=t=>1-Math.pow(1-t,3);
const motionEaseInOut=t=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)');
const motionLowFx=(navigator.deviceMemory&&navigator.deviceMemory<=4)||(navigator.hardwareConcurrency&&navigator.hardwareConcurrency<=2);
document.documentElement.classList.add('motion-ready');
document.documentElement.classList.toggle('low-fx',!!motionLowFx);
let motionContext=null;
function motionAllowed(){return !reduceMotion.matches&&!motionLowFx;}
function navPosition(){const bar=$('.nav'),active=$('.nav button.active');return bar&&active?{x:active.getBoundingClientRect().left+active.getBoundingClientRect().width/2-bar.getBoundingClientRect().left-24}:null;}
// Motion Prompt #060 · MIT License (c) 2026 Shohei Ohtaki · https://showheyohtaki.github.io/motion-prompt/#060
// Carry the 0.25s easeInOutCubic selection slide into the real four-tab nav.
function drawNavIndicator(previous){const bar=$('.nav'),current=navPosition();if(!bar||!current)return;bar.querySelector('.nav-indicator')?.remove();const pill=document.createElement('i');pill.className='nav-indicator';pill.setAttribute('aria-hidden','true');pill.style.left=current.x+'px';bar.prepend(pill);if(previous&&motionAllowed())gsap.fromTo(pill,{x:previous.x-current.x},{x:0,duration:.25,ease:motionEaseInOut,overwrite:true});}
const motionRender=render;
render=function(keepScroll=false){const prior=navPosition();motionContext?.revert();motionRender(keepScroll);drawNavIndicator(prior);if(motionAllowed()&&!keepScroll&&!['payee','results','camera','photo-note','pdf','library'].includes(route)){motionContext=gsap.context(()=>{const title=$('.heading,.greeting');if(title)gsap.fromTo(title,{y:6,opacity:0},{y:0,opacity:1,duration:.22,ease:motionEaseOut});const surface=$('.page>.hero');if(surface)gsap.fromTo(surface,{y:8,opacity:0},{y:0,opacity:1,duration:.28,ease:motionEaseOut});});}};
// Motion Prompt #051 · MIT License (c) 2026 Shohei Ohtaki · https://showheyohtaki.github.io/motion-prompt/#051
// The source's 400ms cubic opening and 600ms cubic closing are retained.
// Real sheet height replaces the demo's 136px; actual pointer input replaces its finger.
const motionSheet=sheet;
sheet=function(title,body){motionSheet(title,body);const panel=$('.sheet'),scrim=$('.sheet-scrim');if(motionAllowed()){gsap.fromTo(panel,{yPercent:100},{yPercent:0,duration:.4,ease:motionEaseOut,clearProps:'transform'});gsap.fromTo(scrim,{backgroundColor:'rgba(15,15,20,0)'},{backgroundColor:'rgba(15,15,20,.42)',duration:.4,ease:motionEaseOut});}attachSheetDrag(panel);};
let closingSheetPanel=null;
function dismissAnimated(){const panel=$('.sheet'),scrim=$('.sheet-scrim');if(!panel||closingSheetPanel===panel)return;closingSheetPanel=panel;if(!motionAllowed()){closeSheet();closingSheetPanel=null;return;}gsap.killTweensOf([panel,scrim]);gsap.to(scrim,{backgroundColor:'rgba(15,15,20,0)',duration:.6,ease:motionEaseInOut});gsap.to(panel,{yPercent:100,duration:.6,ease:motionEaseInOut,onComplete:()=>{if($('.sheet')===panel)closeSheet();if(closingSheetPanel===panel)closingSheetPanel=null;}});}
function attachSheetDrag(panel){const handle=panel.querySelector('.grab');if(!handle)return;let start=null,last=null,offset=0;handle.addEventListener('pointerdown',e=>{start={y:e.clientY,time:performance.now()};last=start;offset=0;gsap.killTweensOf(panel);handle.setPointerCapture(e.pointerId);});handle.addEventListener('pointermove',e=>{if(!start)return;offset=Math.max(0,e.clientY-start.y);last={y:e.clientY,time:performance.now()};gsap.set(panel,{y:offset});});function release(){if(!start)return;const velocity=(last.y-start.y)/Math.max(1,last.time-start.time);const close=offset>panel.offsetHeight*.25||velocity>.7;start=null;if(close)dismissAnimated();else gsap.to(panel,{y:0,duration:motionAllowed()?.25:0,ease:motionEaseOut,clearProps:'transform'});}handle.addEventListener('pointerup',release);handle.addEventListener('pointercancel',release);}
document.addEventListener('click',e=>{const target=e.target.closest('[data-act="close-sheet"],[data-act="scrim"]');if(!target)return;if(target.dataset.act==='scrim'&&e.target!==target)return;e.preventDefault();e.stopImmediatePropagation();dismissAnimated();},true);
document.addEventListener('pointerdown',e=>{const button=e.target.closest('.btn,.quick');if(!button||button.disabled||!motionAllowed())return;gsap.to(button,{scale:.98,duration:.09,ease:motionEaseOut,overwrite:true});});
document.addEventListener('pointerup',e=>{const button=e.target.closest('.btn,.quick');if(button)gsap.to(button,{scale:1,duration:motionAllowed()?.16:0,ease:motionEaseOut,overwrite:true,clearProps:'transform'});});
document.addEventListener('pointercancel',()=>{$$('.btn,.quick').forEach(el=>gsap.set(el,{clearProps:'transform'}));});
reduceMotion.addEventListener('change',()=>{motionContext?.revert();gsap.globalTimeline.getChildren().forEach(tween=>tween.progress(1));drawNavIndicator(null);});
window.addEventListener('resize',()=>drawNavIndicator(null));
drawNavIndicator(null);
