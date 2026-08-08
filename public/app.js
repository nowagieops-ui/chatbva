"use strict";
// ── Helpers ───────────────────────────────────────────────────────────────────
const $ = s => document.querySelector(s);
function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function t2m(t){ const [h,m]=String(t).split(":"); return +h*60+ +m; }
function m2t(m){ return String(Math.floor(m/60)).padStart(2,"0")+":"+String(m%60).padStart(2,"0"); }
function today(){ const d=new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
function niceDay(iso){ const [y,mo,d]=iso.split("-"); return new Date(+y,+mo-1,+d).toLocaleDateString(undefined,{weekday:"long",day:"numeric",month:"long"}); }
function ago(ts){ if(!ts) return ""; const m=Math.round((Date.now()-ts)/60000); if(m<1) return "just now"; if(m<60) return m+" min ago"; const h=Math.round(m/60); if(h<24) return h+(h===1?" hour ago":" hours ago"); const dd=Math.round(h/24); return dd+(dd===1?" day ago":" days ago"); }
function flash(el,text,bad){ if(!el) return; el.innerHTML='<div class="msg'+(bad?" bad":"")+'" role="alert">'+esc(text)+'</div>'; if(!bad) setTimeout(()=>{ if(el.firstChild) el.innerHTML=""; },7000); }
function chipGroup(sel,attr,onPick,toggle=false){
  const g=$(sel); if(!g) return;
  g.addEventListener("click",e=>{
    const b=e.target.closest(".chip"); if(!b) return;
    if(toggle){ b.setAttribute("aria-pressed",b.getAttribute("aria-pressed")==="true"?"false":"true"); }
    else{ g.querySelectorAll(".chip").forEach(c=>c.setAttribute("aria-pressed",c===b?"true":"false")); }
    onPick(b.getAttribute(attr), b.getAttribute("aria-pressed")==="true");
  });
}
function refCode(){ const A="ABCDEFGHJKLMNPQRSTUVWXYZ23456789",r=crypto.getRandomValues(new Uint8Array(4)),s=[]; for(let i=0;i<4;i++) s.push(A[r[i]%A.length]); return s.join(""); }
function rescueCode(){ const A="ABCDEFGHJKLMNPQRSTUVWXYZ23456789",r=crypto.getRandomValues(new Uint8Array(12)),o=[]; for(let i=0;i<12;i++) o.push(A[r[i]%A.length]); return o.slice(0,4).join("")+"-"+o.slice(4,8).join("")+"-"+o.slice(8,12).join(""); }
async function sha256hex(str){ const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(str)); return Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,"0")).join(""); }

// ── API calls ─────────────────────────────────────────────────────────────────
async function api(method, path, body){
  const opts = { method, headers:{"Content-Type":"application/json"} };
  if(body) opts.body = JSON.stringify(body);
  const r = await fetch("/api"+path, opts);
  if(!r.ok){ const e=await r.json().catch(()=>({error:"Network error"})); throw new Error(e.error||r.statusText); }
  return r.json();
}

// ── Crypto ────────────────────────────────────────────────────────────────────
const SUB = crypto.subtle;
const b64  = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const ub64 = str => { const s=atob(str),b=new Uint8Array(s.length); for(let i=0;i<s.length;i++) b[i]=s.charCodeAt(i); return b; };
const rand = n => crypto.getRandomValues(new Uint8Array(n));

async function deriveWrapKey(pass, salt){
  const base = await SUB.importKey("raw",new TextEncoder().encode(pass),{name:"PBKDF2"},false,["deriveKey"]);
  return SUB.deriveKey({name:"PBKDF2",salt,iterations:250000,hash:"SHA-256"},base,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
}
async function createVault(pass){
  const salt=rand(16),iv=rand(12);
  const pair = await SUB.generateKey({name:"RSA-OAEP",modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:"SHA-256"},true,["encrypt","decrypt"]);
  const [spki,pkcs8] = await Promise.all([SUB.exportKey("spki",pair.publicKey),SUB.exportKey("pkcs8",pair.privateKey)]);
  const wk = await deriveWrapKey(pass,salt);
  const sealed = await SUB.encrypt({name:"AES-GCM",iv},wk,pkcs8);
  return { vault:{salt:b64(salt),iv:b64(iv),pub:b64(spki),priv:b64(sealed)}, pair };
}
async function openVault(v,pass){
  const wk = await deriveWrapKey(pass, ub64(v.salt));
  const pkcs8 = await SUB.decrypt({name:"AES-GCM",iv:ub64(v.iv)},wk,ub64(v.priv));
  return SUB.importKey("pkcs8",pkcs8,{name:"RSA-OAEP",hash:"SHA-256"},false,["decrypt"]);
}
async function importPub(b){ return SUB.importKey("spki",ub64(b),{name:"RSA-OAEP",hash:"SHA-256"},false,["encrypt"]); }
async function seal(pk, obj){
  const aes = await SUB.generateKey({name:"AES-GCM",length:256},true,["encrypt"]);
  const iv = rand(12);
  const ct = await SUB.encrypt({name:"AES-GCM",iv},aes,new TextEncoder().encode(JSON.stringify(obj)));
  const raw = await SUB.exportKey("raw",aes);
  const wrapped = await SUB.encrypt({name:"RSA-OAEP"},pk,raw);
  return { k:b64(wrapped), iv:b64(iv), c:b64(ct) };
}
async function unseal(sk, blob){
  const raw = await SUB.decrypt({name:"RSA-OAEP"},sk,ub64(blob.k));
  const aes = await SUB.importKey("raw",raw,{name:"AES-GCM"},false,["decrypt"]);
  const pt  = await SUB.decrypt({name:"AES-GCM",iv:ub64(blob.iv)},aes,ub64(blob.c));
  return JSON.parse(new TextDecoder().decode(pt));
}

// ── State ─────────────────────────────────────────────────────────────────────
let settings={}, bookings={}, feedback=[], board=[], me={name:"",email:"",token:{}};
let privKey=null, pubKey=null, plain={};
let ui={ kind:"Opinion", dur:30, mode:"Video call", slot:null, filter:"all", unlocked:false };

// ── LocalStorage for personal state only (name, email, tokens) ────────────────
function loadMe(){ try{ return JSON.parse(localStorage.getItem("bva_me")||"{}"); }catch(e){ return {}; } }
function saveMe(){ localStorage.setItem("bva_me", JSON.stringify(me)); }

// ── Tab routing ───────────────────────────────────────────────────────────────
$(".tabs").addEventListener("click", e=>{
  const b=e.target.closest("button[data-view]"); if(!b) return;
  $(".tabs").querySelectorAll("button").forEach(x=>x.setAttribute("aria-selected",x===b?"true":"false"));
  const v=b.getAttribute("data-view");
  $("#view-staff").hidden  = v!=="staff";
  $("#view-manager").hidden= v!=="manager";
  if(v==="manager"){
    // Show PIN gate; inner content stays hidden until PIN is verified
    if(!window._mgrUnlocked){
      $("#mgr-gate").hidden=false;
      $("#mgr-inner").hidden=true;
    } else {
      refresh().then(gate);
    }
  }
});
document.querySelector(".subtabs").addEventListener("click", e=>{
  const b=e.target.closest("button[data-sub]"); if(!b) return;
  document.querySelector(".subtabs").querySelectorAll("button").forEach(x=>x.setAttribute("aria-selected",x===b?"true":"false"));
  ["inbox","times","diary","setup"].forEach(s=>{ $("#sub-"+s).hidden = s!==b.getAttribute("data-sub"); });
});

// ── Anonymous form ────────────────────────────────────────────────────────────
chipGroup("#kindChips","data-kind", v=>{
  ui.kind=v;
  $("#reportGuide").hidden = v!=="Report";
  $("#anonText").placeholder = v==="Report"
    ? "What happened, when, where, and who was involved. Specifics are what make something actionable."
    : "Write it plainly. Dates, places and what was said are the details that make something actionable.";
});

$("#anonSend").addEventListener("click", async function(){
  const text=$("#anonText").value.trim(), contact=$("#anonContact").value.trim(), btn=this;
  if(!pubKey){ flash($("#anonMsg"),"The channel isn't set up yet.",true); return; }
  if(text.length<3){ flash($("#anonMsg"),"Write your message first.",true); return; }
  btn.disabled=true;
  try{
    const code=refCode();
    const enc = await seal(pubKey, {text, contact});
    await api("POST","/feedback",{ kind:ui.kind, code, day:today(), enc });
    $("#stampCode").textContent=code;
    $("#dropbox").classList.add("sent");
    btn.hidden=true; $("#anonAgain").hidden=false;
    $("#anonText").value=""; $("#anonContact").value="";
    flash($("#anonMsg"),"Sealed and sent. Your reference is "+code+".");
  } catch(e){
    flash($("#anonMsg"),e.message||"Couldn't send. Try again.",true);
    btn.disabled=false;
  }
});
$("#anonAgain").addEventListener("click",function(){
  $("#dropbox").classList.remove("sent");
  this.hidden=true; $("#anonSend").hidden=false; $("#anonSend").disabled=false;
  $("#anonMsg").innerHTML=""; $("#anonText").focus();
});

function renderBoard(){
  const list=board.slice().sort((a,b)=>b.ts-a.ts);
  if(!list.length){ $("#board").innerHTML='<div class="empty">Nothing posted yet.</div>'; return; }
  $("#board").innerHTML=list.map(p=>`
    <div class="note">
      <div class="note-meta"><span class="kind">${esc(p.kind||"Answer")}</span><span class="code">${p.code?"Ref "+esc(p.code):""}</span></div>
      ${p.topic?'<p class="note-body"><b>'+esc(p.topic)+'</b></p>':""}
      <div class="reply"><p>${esc(p.reply)}</p></div>
    </div>`).join("");
}

// ── Booking ───────────────────────────────────────────────────────────────────
chipGroup("#durChips","data-dur", v=>{ ui.dur=+v; ui.slot=null; renderSlots(); });
chipGroup("#modeChips","data-mode", v=>{ ui.mode=v; });
$("#empName").addEventListener("change",function(){ me.name=this.value.trim(); saveMe(); renderSlots(); renderMyBooking(); });
$("#empEmail").addEventListener("change",function(){ me.email=this.value.trim(); saveMe(); });

function allSlots(){
  const out=[], wins=(settings.windows||[]).slice(), t=today();
  wins.sort((a,b)=>(a.date+a.start)<(b.date+b.start)?-1:1);
  wins.forEach(w=>{
    if(w.date<t) return;
    for(let m=t2m(w.start); m+30<=t2m(w.end); m+=30)
      out.push({key:w.date+"T"+m2t(m), date:w.date, time:m2t(m), min:m});
  });
  return out;
}
function free(k){ return !bookings[k]; }
function canBook(list,i){
  if(!free(list[i].key)) return false;
  if(ui.dur===30) return true;
  const n=list[i+1];
  return !!(n && n.date===list[i].date && n.min===list[i].min+30 && free(n.key));
}

function renderMyBooking(){
  const host=$("#myBooking"), mine=me.name.trim().toLowerCase();
  if(!mine){ host.innerHTML=""; return; }
  const key=Object.keys(bookings).find(k=>!bookings[k].spanOf&&String(bookings[k].name).toLowerCase()===mine);
  if(!key){ host.innerHTML=""; return; }
  const b=bookings[key], [date,time]=key.split("T"), owns=me.token[key]&&me.token[key]===b.token;
  host.innerHTML=`<div class="note" style="border-left:4px solid var(--gold)">
    <div class="note-meta"><span>Your booking is confirmed</span><span class="code">${b.code?"Ref "+esc(b.code):""}</span></div>
    <p class="note-body"><b>${esc(niceDay(date))}</b> at <b>${time}</b> · ${b.duration} minutes · ${esc(b.mode)}</p>
    <div class="actions">
      <button class="btn btn-ghost btn-small" data-ics="${key}">Add to calendar</button>
      ${owns?'<button class="btn btn-danger btn-small" data-mycancel="'+key+'">Cancel this slot</button>'
            :'<span class="who">Booked on another device — ask management to change it.</span>'}
    </div></div>`;
}
$("#myBooking").addEventListener("click", async e=>{
  const ic=e.target.closest("[data-ics]");
  if(ic){ downloadIcs(ic.getAttribute("data-ics"), bookings[ic.getAttribute("data-ics")]); return; }
  const cc=e.target.closest("[data-mycancel]");
  if(cc) cancelBooking(cc.getAttribute("data-mycancel"));
});

function icsFor(key,b){
  const [d,st]=key.split("T"), ds=d.replace(/-/g,""), ss=st.replace(":","");
  const en=m2t(t2m(st)+(b.duration||30)).replace(":","");
  return ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//BVA Open Line//EN","BEGIN:VEVENT",
    "UID:"+key+"@bvaopenline","DTSTAMP:"+ds+"T"+ss+"00",
    "DTSTART:"+ds+"T"+ss+"00","DTEND:"+ds+"T"+en+"00",
    "SUMMARY:One to one — "+(b.name||""),
    "DESCRIPTION:"+(b.mode||"")+(b.code?". Ref "+b.code:""),
    "END:VEVENT","END:VCALENDAR"].join("\r\n");
}
function downloadIcs(key,b){
  const blob=new Blob([icsFor(key,b)],{type:"text/calendar"});
  const url=URL.createObjectURL(blob), a=document.createElement("a");
  a.href=url; a.download="one-to-one-"+key.split("T")[0]+".ics";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url),2000);
}

function renderSlots(){
  const list=allSlots(), host=$("#slots");
  if(!list.length){ host.innerHTML='<div class="empty">No times are open yet. Check back soon.</div>'; return; }
  const mine=me.name.trim().toLowerCase();
  const byDay={}, order=[];
  list.forEach((s,i)=>{ if(!byDay[s.date]){ byDay[s.date]=[]; order.push(s.date); } byDay[s.date].push({s,i}); });
  let html='<div class="sheetrows">';
  order.forEach(day=>{
    html+=`<div class="daygroup"><div class="dayhead">${esc(niceDay(day))}</div>`;
    byDay[day].forEach(({s,i})=>{
      const b=bookings[s.key], isMine=b&&mine&&String(b.name).toLowerCase()===mine;
      html+=`<div class="row${b?" taken":""}${isMine?" mine":""}"><span class="t">${s.time}</span>`;
      if(b&&b.spanOf){ html+=`<span class="who">— continued —</span>`; }
      else if(b){
        html+=`<span class="who"><b>${esc(b.name)}</b> · ${b.duration} min · ${esc(b.mode)}</span>`;
        if(isMine&&me.token[s.key]===b.token) html+=`<span class="lead"></span><button class="pick" data-cancel="${s.key}">Cancel</button>`;
      } else {
        html+=`<span class="lead"></span>`;
        html += canBook(list,i)
          ? `<button class="pick" data-book="${s.key}" aria-pressed="${ui.slot===s.key}">${ui.slot===s.key?"Selected":"Take it"}</button>`
          : `<span class="who">not enough room for an hour</span>`;
      }
      html+=`</div>`;
    });
    html+=`</div>`;
  });
  html+=`</div><div class="actions" style="margin-top:18px"><button class="btn" id="confirmBook"${ui.slot?"":" disabled"}>Confirm my slot</button></div>`;
  host.innerHTML=html;
  const cb=$("#confirmBook"); if(cb) cb.addEventListener("click",confirmBooking);
}
$("#slots").addEventListener("click", e=>{
  const bk=e.target.closest("[data-book]");
  if(bk){ const k=bk.getAttribute("data-book"); ui.slot=(ui.slot===k?null:k); renderSlots(); return; }
  const cn=e.target.closest("[data-cancel]");
  if(cn) cancelBooking(cn.getAttribute("data-cancel"));
});

async function confirmBooking(){
  const name=$("#empName").value.trim(), email=$("#empEmail").value.trim();
  if(!name){ flash($("#bookMsg"),"Add your name before confirming.",true); return; }
  if(!ui.slot){ flash($("#bookMsg"),"Choose a time first.",true); return; }
  me.name=name; me.email=email; saveMe();
  const token="t"+Date.now()+Math.random().toString(36).slice(2,10);
  const code=refCode();
  try{
    await api("POST","/bookings",{ key:ui.slot, name, duration:ui.dur, mode:ui.mode, token, code, email });
    me.token=me.token||{}; me.token[ui.slot]=token; saveMe();
    const b=await api("GET","/bookings");
    bookings=b; ui.slot=null; renderSlots(); renderMyBooking(); renderStats();
    flash($("#bookMsg"),"Confirmed for "+niceDay(ui.slot?.split("T")[0]||"")+"."+(email?" A confirmation email is on its way.":""));
  } catch(e){
    flash($("#bookMsg"),e.message||"Couldn't book. Try again.",true);
  }
}
async function cancelBooking(key, quiet=false){
  const tok=me.token[key]||"";
  try{
    await api("DELETE","/bookings/"+encodeURIComponent(key),{token:tok});
    delete me.token[key]; saveMe();
    const b=await api("GET","/bookings"); bookings=b;
    renderSlots(); renderMyBooking(); renderStats();
    if(!quiet) flash($("#bookMsg"),"Slot released.");
  } catch(e){
    flash($("#bookMsg"),e.message||"Couldn't cancel.",true);
  }
}

// ── Manager PIN gate ─────────────────────────────────────────────────────────
async function checkMgrPin(pin){
  const r = await fetch("/api/settings/pin", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify({pin})
  });
  return r.ok;
}
$("#mgrPinBtn").addEventListener("click", async function(){
  const pin = $("#mgrPin").value;
  if(!pin){ flash($("#mgrPinMsg"),"Enter the PIN.",true); return; }
  const btn=this; btn.disabled=true;
  const ok = await checkMgrPin(pin);
  if(!ok){ flash($("#mgrPinMsg"),"Wrong PIN.",true); btn.disabled=false; $("#mgrPin").value=""; return; }
  window._mgrUnlocked=true;
  $("#mgr-gate").hidden=true;
  $("#mgr-inner").hidden=false;
  btn.disabled=false;
  refresh().then(gate);
});
$("#mgrPin").addEventListener("keydown", e=>{ if(e.key==="Enter") $("#mgrPinBtn").click(); });

// ── Manager gate ──────────────────────────────────────────────────────────────
function gate(){
  const has=!!(settings.vault?.pub);
  $("#setupScreen").hidden=has;
  $("#lockScreen").hidden=!has||ui.unlocked;
  $("#mgr").hidden=!ui.unlocked;
}

$("#makeKeys").addEventListener("click", async function(){
  const p=$("#newPass").value, p2=$("#newPass2").value, btn=this;
  if(p.length<8){ flash($("#setupMsg"),"Use at least 8 characters.",true); return; }
  if(p!==p2){ flash($("#setupMsg"),"The two passphrases don't match.",true); return; }
  btn.disabled=true;
  const rescue=rescueCode();
  try{
    const {vault:v, pair} = await createVault(p);
    v.rescue = await sha256hex(rescue);
    await api("POST","/settings/vault",{vault:v});
    privKey=pair.privateKey; pubKey=pair.publicKey; settings.vault=v; ui.unlocked=true;
    $("#newPass").value=""; $("#newPass2").value="";
    $("#rescueOut").innerHTML=`<div class="warn" style="margin-top:18px">
      <h4>Write this down now — shown once only</h4>
      <p style="font-family:var(--mono);font-size:20px;letter-spacing:.18em;color:var(--ink)"><b>${rescue}</b></p>
      <p>Without this code, a forgotten passphrase cannot be reset by anyone. Keep it separate from the passphrase itself.</p></div>`;
    btn.disabled=false; gate(); renderManager(); refreshStaffLock();
  } catch(e){ flash($("#setupMsg"),e.message||"Key creation failed.",true); btn.disabled=false; }
});

$("#unlock").addEventListener("click", async function(){
  const v=$("#pass").value, btn=this;
  if(!v){ flash($("#lockMsg"),"Enter your passphrase.",true); return; }
  btn.disabled=true;
  try{
    privKey = await openVault(settings.vault, v);
    pubKey  = await importPub(settings.vault.pub);
    ui.unlocked=true; $("#pass").value=""; btn.disabled=false;
    gate(); renderManager();
  } catch(e){ flash($("#lockMsg"),"That passphrase doesn't open the key.",true); btn.disabled=false; }
});
$("#pass").addEventListener("keydown", e=>{ if(e.key==="Enter") $("#unlock").click(); });

$("#resetKeys").addEventListener("click", async function(){
  const code=$("#rescueIn").value.trim().toUpperCase().replace(/\s/g,"");
  if(!code){ flash($("#lockMsg"),"Enter the recovery code.",true); return; }
  const stored=(settings.vault||{}).rescue;
  if(!stored){ flash($("#lockMsg"),"This key has no recovery code on record.",true); return; }
  const btn=this; btn.disabled=true;
  const h=await sha256hex(code);
  if(h!==stored){ flash($("#lockMsg"),"That recovery code isn't right.",true); btn.disabled=false; return; }
  if(!confirm("Correct code. This permanently deletes every message. Continue?")){ btn.disabled=false; return; }
  try{
    await api("DELETE","/settings/vault");
    settings.vault=null; feedback=[]; privKey=null; pubKey=null; ui.unlocked=false; plain={};
    $("#rescueIn").value=""; btn.disabled=false; gate(); refreshStaffLock();
  } catch(e){ flash($("#lockMsg"),"Reset failed: "+e.message,true); btn.disabled=false; }
});

function renderManager(){ renderInbox(); renderWindows(); renderDiary(); renderStats(); fillSetup(); }

// ── Inbox ─────────────────────────────────────────────────────────────────────
chipGroup("#filterChips","data-filter", v=>{ ui.filter=v; renderInbox(); });

async function decryptAll(){
  if(!privKey) return;
  await Promise.all(feedback.map(async f=>{
    if(plain[f.id]||!f.enc) return;
    try{ plain[f.id]=await unseal(privKey,f.enc); }
    catch(e){ plain[f.id]={text:"[Can't open with current key]",contact:""}; }
  }));
}

async function renderInbox(){
  await decryptAll();
  let list=feedback.slice().sort((a,b)=>b.ts-a.ts);
  if(ui.filter==="new") list=list.filter(f=>f.status==="new");
  else if(ui.filter!=="all") list=list.filter(f=>f.kind===ui.filter);
  if(!list.length){ $("#inbox").innerHTML='<div class="empty">Nothing here yet.</div>'; return; }
  $("#inbox").innerHTML=list.map(f=>{
    const p=plain[f.id]||{text:"…",contact:""}, rep=f.kind==="Report";
    return `<div class="note${rep?" grave":""}">
      <div class="note-meta">
        <span><span class="kind${rep?" report":""}">${esc(f.kind)}</span>${f.status==="new"?" &nbsp;· unread":""}</span>
        <span><span class="code">Ref ${esc(f.code||"—")}</span> &nbsp;· ${esc(niceDay(f.day))}</span>
      </div>
      <p class="note-body">${esc(p.text)}</p>
      ${p.contact?'<p class="note-body" style="margin-top:10px;color:var(--seal)"><b>Contact left:</b> '+esc(p.contact)+'</p>':""}
      <div class="field" style="margin:14px 0 0">
        <label class="lab">Public answer</label>
        <input type="text" data-topic="${f.id}" placeholder="Subject line" style="margin-bottom:8px">
        <textarea rows="2" data-reply="${f.id}" placeholder="Leave blank to not post publicly"></textarea>
      </div>
      <div class="actions">
        <button class="btn btn-small" data-post="${f.id}">Post to board</button>
        ${f.status==="new"?`<button class="btn btn-ghost btn-small" data-read="${f.id}">Mark read</button>`:""}
        <button class="btn btn-danger btn-small" data-del="${f.id}">Delete</button>
      </div></div>`;
  }).join("");
}

$("#inbox").addEventListener("click", async e=>{
  const btn=e.target.closest("button"); if(!btn) return;
  const id=btn.getAttribute("data-post")||btn.getAttribute("data-read")||btn.getAttribute("data-del");
  if(!id) return;
  try{
    if(btn.hasAttribute("data-post")){
      const reply=document.querySelector(`[data-reply="${id}"]`)?.value.trim();
      if(!reply) return;
      const topic=document.querySelector(`[data-topic="${id}"]`)?.value.trim();
      const item=feedback.find(f=>f.id===id);
      await api("POST","/board",{code:item?.code,kind:item?.kind,topic,reply});
      await api("PATCH","/feedback/"+id,{action:"read"});
    } else if(btn.hasAttribute("data-read")){
      await api("PATCH","/feedback/"+id,{action:"read"});
    } else {
      await api("PATCH","/feedback/"+id,{action:"delete"});
    }
    feedback=await api("GET","/feedback");
    board=await api("GET","/board");
    renderInbox(); renderBoard(); renderStats();
  } catch(e){ alert(e.message); }
});

// ── Open times ────────────────────────────────────────────────────────────────
function pickedDows(){
  return Array.from(document.querySelectorAll("#dowChips .chip"))
    .filter(c=>c.getAttribute("aria-pressed")==="true")
    .map(c=>+c.getAttribute("data-dow"));
}
function datesInRange(){
  const a=$("#wDate").value, b=$("#wDateEnd").value||a, dows=pickedDows(), out=[], tod=today();
  if(!a) return out;
  const [y,mo,d]=( a<b?a:b ).split("-").map(Number);
  const [y2,mo2,d2]=( a<b?b:a ).split("-").map(Number);
  let cur=new Date(y,mo-1,d); const end=new Date(y2,mo2-1,d2);
  for(let guard=0; cur<=end && guard<400; guard++, cur.setDate(cur.getDate()+1)){
    const iso=cur.getFullYear()+"-"+String(cur.getMonth()+1).padStart(2,"0")+"-"+String(cur.getDate()).padStart(2,"0");
    if(iso<tod) continue;
    if(dows.includes(cur.getDay())) out.push(iso);
  }
  return out;
}
function updatePreview(){
  const el=$("#preview"); if(!el) return;
  const days=datesInRange(), s=$("#wStart").value, e=$("#wEnd").value;
  if(!days.length){ el.textContent="Nothing selected"; return; }
  if(!s||!e||t2m(e)-t2m(s)<30){ el.textContent="Set a time range first"; return; }
  const per=Math.floor((t2m(e)-t2m(s))/30);
  el.textContent=days.length+(days.length===1?" day":" days")+" · "+(per*days.length)+" slots";
}
document.querySelector("#dowChips").addEventListener("click", e=>{
  const b=e.target.closest(".chip"); if(!b) return;
  b.setAttribute("aria-pressed", b.getAttribute("aria-pressed")==="true"?"false":"true");
  updatePreview();
});
["#wDate","#wDateEnd","#wStart","#wEnd"].forEach(s=>{ const el=$(s); if(el) el.addEventListener("change",updatePreview); });

$("#addWindow").addEventListener("click", async function(){
  const s=$("#wStart").value, e=$("#wEnd").value, days=datesInRange();
  if(!s||!e){ flash($("#winMsg"),"Set the times.",true); return; }
  if(t2m(e)-t2m(s)<30){ flash($("#winMsg"),"Needs to be at least 30 minutes.",true); return; }
  if(!days.length){ flash($("#winMsg"),"No days match in that range.",true); return; }
  let added=0, skipped=0;
  for(const date of days){
    const dup=(settings.windows||[]).some(w=>w.date===date&&w.start===s&&w.end===e);
    if(dup){ skipped++; continue; }
    try{ const r=await api("POST","/settings/windows",{date,start:s,end:e}); settings.windows=(settings.windows||[]); settings.windows.push({id:r.id,date,start:s,end:e}); added++; }
    catch(e){ /* continue */ }
  }
  settings=await api("GET","/settings");
  renderWindows(); renderSlots(); renderStats(); updatePreview();
  flash($("#winMsg"), added+(added===1?" window added.":" windows added.")+(skipped?" "+skipped+" skipped — already there.":""));
});

$("#clearWins").addEventListener("click", async function(){
  if(!confirm("Remove every upcoming window?")) return;
  await api("DELETE","/settings/windows");
  settings=await api("GET","/settings");
  renderWindows(); renderSlots(); renderStats();
  flash($("#winMsg"),"All upcoming windows removed.");
});

$("#windows").addEventListener("click", async e=>{
  const b=e.target.closest("[data-rmwin]"); if(!b) return;
  await api("DELETE","/settings/windows/"+b.getAttribute("data-rmwin"));
  settings=await api("GET","/settings");
  renderWindows(); renderSlots(); renderStats();
});

function renderWindows(){
  const w=(settings.windows||[]).filter(x=>x.date>=today()).sort((a,b)=>(a.date+a.start)<(b.date+b.start)?-1:1);
  $("#clearWrap").hidden=!w.length;
  if(!w.length){ $("#windows").innerHTML='<div class="empty">No open times yet.</div>'; return; }
  const taken=x=>{ let n=0; for(let m=t2m(x.start);m+30<=t2m(x.end);m+=30) if(bookings[x.date+"T"+m2t(m)]) n++; return n; };
  $("#windows").innerHTML='<div class="sheetrows">'+w.map(x=>{
    const n=Math.floor((t2m(x.end)-t2m(x.start))/30), tk=taken(x);
    return `<div class="row"><span class="t" style="min-width:190px">${esc(niceDay(x.date))}</span>
      <span class="who">${x.start} – ${x.end} · ${n} slots${tk?' · <b>'+tk+' booked</b>':''}</span>
      <span class="lead"></span><button class="pick" data-rmwin="${x.id}">Remove</button></div>`;
  }).join("")+'</div>';
}

// ── Diary ─────────────────────────────────────────────────────────────────────
function renderDiary(){
  const keys=Object.keys(bookings).filter(k=>!bookings[k].spanOf).sort();
  const unseen=keys.filter(k=>!bookings[k].seen).length;
  if(!keys.length){ $("#diary").innerHTML='<div class="empty">Nobody has booked yet.</div>'; return; }
  $("#diary").innerHTML=
    (unseen?`<div class="actions" style="margin:0 0 16px"><button class="btn btn-small" id="markSeen">Mark all ${unseen} as seen</button></div>`:"")+
    '<div class="sheetrows">'+keys.map(k=>{
      const b=bookings[k], [date,time]=k.split("T");
      return `<div class="row${b.seen?"":" mine"}">
        <span class="t" style="min-width:190px">${esc(niceDay(date))}</span>
        <span class="t">${time}</span>
        <span class="who">${b.seen?"":"<b style='color:var(--gold-deep)'>NEW</b> · "}<b>${esc(b.name)}</b> · ${b.duration} min · ${esc(b.mode)}
          <br><span style="font-family:var(--mono);font-size:10.5px;letter-spacing:.1em;text-transform:uppercase">Ref ${esc(b.code||"—")} · booked ${ago(b.ts)}</span>
        </span>
        <span class="lead"></span>
        <button class="pick" data-dics="${k}">Calendar</button>
        <button class="pick" data-rmbook="${k}">Cancel</button></div>`;
    }).join("")+'</div>';
  const ms=$("#markSeen");
  if(ms) ms.addEventListener("click", async ()=>{
    await api("PATCH","/bookings/seen");
    bookings=await api("GET","/bookings");
    renderDiary(); renderStats();
  });
}
$("#diary").addEventListener("click", async e=>{
  const dc=e.target.closest("[data-dics]");
  if(dc){ downloadIcs(dc.getAttribute("data-dics"), bookings[dc.getAttribute("data-dics")]); return; }
  const rc=e.target.closest("[data-rmbook]"); if(!rc) return;
  const key=rc.getAttribute("data-rmbook");
  // manager cancel: use the stored token if we have it, otherwise send a sentinel
  const tok=me.token[key]||bookings[key]?.token||"manager";
  await api("DELETE","/bookings/"+encodeURIComponent(key),{token:tok});
  bookings=await api("GET","/bookings");
  renderDiary(); renderStats();
});

// ── Settings tab ──────────────────────────────────────────────────────────────
function fillSetup(){
  if($("#ownerInput")) $("#ownerInput").value=settings.owner||"";
  if($("#escInput")) $("#escInput").value=settings.escalate||"";
}
$("#saveSetup").addEventListener("click", async function(){
  const o=$("#ownerInput").value.trim(), es=$("#escInput").value.trim();
  try{
    await api("PATCH","/settings",{owner:o,escalate:es});
    settings.owner=o; settings.escalate=es;
    refreshStaffLock(); flash($("#setupMsg2"),"Saved.");
  } catch(e){ flash($("#setupMsg2"),e.message,true); }
});

function refreshStaffLock(){
  const name=settings.owner||"management";
  if($("#ownerName")) $("#ownerName").textContent=name;
  if($("#ownerName2")) $("#ownerName2").textContent=name;
  const esc2=settings.escalate;
  if($("#escalateLine")) $("#escalateLine").innerHTML = esc2
    ? "If your concern is about "+esc(name)+", do not use this box — go to "+esc(esc2)+" instead."
    : "If your concern is about "+esc(name)+", this box may not be the right route. Ask for an alternative contact.";
  const has=!!(settings.vault?.pub);
  if($("#noKeys")) $("#noKeys").hidden=has;
  if($("#anonForm")) $("#anonForm").hidden=!has;
  if(has&&!pubKey) importPub(settings.vault.pub).then(k=>{ pubKey=k; }).catch(()=>{});
}

function renderStats(){
  const list=allSlots();
  const open=list.filter(s=>!bookings[s.key]).length;
  const booked=Object.keys(bookings).filter(k=>!bookings[k].spanOf).length;
  const unseen=Object.keys(bookings).filter(k=>!bookings[k].spanOf&&!bookings[k].seen).length;
  const unread=feedback.filter(f=>f.status==="new").length;
  if($("#statNew")) $("#statNew").textContent=unread;
  if($("#statRep")) $("#statRep").textContent=feedback.filter(f=>f.kind==="Report").length;
  if($("#statBooked")) $("#statBooked").textContent=booked;
  if($("#statOpen")) $("#statOpen").textContent=open;
  const dt=document.querySelector('.subtabs button[data-sub="diary"]');
  if(dt) dt.textContent=unseen?"Diary · "+unseen+" new":"Diary";
}

// ── Boot ──────────────────────────────────────────────────────────────────────
async function refresh(){
  const [s,b,f,bo] = await Promise.all([
    api("GET","/settings"), api("GET","/bookings"),
    api("GET","/feedback"), api("GET","/board")
  ]);
  settings=s; bookings=b; feedback=f; board=bo;
}

(async function boot(){
  me = { ...{name:"",email:"",token:{}}, ...loadMe() };
  if(me.name) $("#empName").value=me.name;
  if(me.email) $("#empEmail").value=me.email;
  $("#wDate").value=today();
  const wk=new Date(); wk.setDate(wk.getDate()+13);
  $("#wDateEnd").value=wk.getFullYear()+"-"+String(wk.getMonth()+1).padStart(2,"0")+"-"+String(wk.getDate()).padStart(2,"0");
  try{
    await refresh();
    refreshStaffLock(); renderSlots(); renderMyBooking(); renderBoard(); renderStats(); gate();
    $("#footState").textContent = settings.vault?.pub ? "Messages are end-to-end sealed" : "Lock not set up yet";
  } catch(e){
    $("#footState").textContent = "Could not reach server";
    console.error(e);
  }
  setInterval(async ()=>{
    if(document.hidden) return;
    try{
      await refresh();
      renderBoard(); renderStats(); refreshStaffLock();
      if(!$("#view-staff").hidden&&!ui.slot){ renderSlots(); renderMyBooking(); }
      if(ui.unlocked&&!$("#view-manager").hidden){ renderInbox(); renderWindows(); renderDiary(); }
    } catch(e){ /* silent */ }
  }, 20000);
})();
