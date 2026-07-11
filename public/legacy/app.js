// ── CONFIG ────────────────────────────────────────────────
const FB_CFG = {
  apiKey:"AIzaSyBrQ_qAKll0Jg-Jp-XrflsXAR8p-sQIx0I",
  authDomain:"kimatey-flow-navigator.firebaseapp.com",
  databaseURL:"https://kimatey-flow-navigator-default-rtdb.firebaseio.com",
  projectId:"kimatey-flow-navigator",
  storageBucket:"kimatey-flow-navigator.appspot.com",
  messagingSenderId:"1005097548611",
  appId:"1:1005097548611:web:kimateyflownavigator"
};
firebase.initializeApp(FB_CFG);
const db = firebase.database();
const CHANNEL = 'kcm_abidjan';

// ── STATE ─────────────────────────────────────────────────
let map, userMarker, peerId, currentMode = 'voiture';
let walletPts = 2340, drivingScore = 87;
let gbakaKm = 0, totalSignals = 3, kcmHoursActive = 2.5;
let voiceActive = false, recognition = null;
let incidents = [], kcmNodes = {};
let isOnline = true;

// ── NAVIGATION ────────────────────────────────────────────
function showScreen(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  const s = document.getElementById(id);
  if(s){ s.classList.add('active'); }
}

function showOnboarding(){
  showScreen('s-onboarding');
  buildOnbDots();
  updateOnb(0);
}

// ── ONBOARDING ────────────────────────────────────────────
let onbPage = 0;
const ONB_TOTAL = 4;
function buildOnbDots(){
  const c = document.getElementById('onb-dots');
  c.innerHTML = '';
  for(let i=0;i<ONB_TOTAL;i++){
    const d = document.createElement('div');
    d.className='onb-dot'+(i===0?' active':'');
    d.id='dot-'+i;
    c.appendChild(d);
  }
}
function updateOnb(page){
  document.querySelectorAll('.onb-slide').forEach((s,i)=>{
    s.classList.toggle('active',i===page);
  });
  document.querySelectorAll('.onb-dot').forEach((d,i)=>{
    d.classList.toggle('active',i===page);
  });
  document.getElementById('onb-btn').textContent = page===ONB_TOTAL-1?'Commencer':'Suivant';
}
function onbNext(){
  if(onbPage < ONB_TOTAL-1){ onbPage++; updateOnb(onbPage); }
  else showScreen('s-login');
}

// ── LOGIN ─────────────────────────────────────────────────
function sendOtp(){
  const p = document.getElementById('phone-input').value.trim();
  if(!p){ showToast('Entre ton numéro'); return; }
  document.getElementById('otp-phone').textContent = '+225 '+p;
  openModal('modal-otp');
}
function otpNext(i){
  const v = document.getElementById('otp'+i).value;
  if(v && i<3) document.getElementById('otp'+(i+1)).focus();
  const code = [0,1,2,3].map(j=>document.getElementById('otp'+j).value).join('');
  if(code.length===4) setTimeout(()=>{ if(code==='1234')verifyOtp(); },100);
}
function verifyOtp(){
  const code = [0,1,2,3].map(j=>document.getElementById('otp'+j).value).join('');
  if(code==='1234'){ closeModal('modal-otp'); launchApp(); }
  else showToast('Code incorrect · Utilise 1234 en démo');
}
function loginGuest(){ launchApp(); }

// ── APP LAUNCH ────────────────────────────────────────────
function launchApp(){
  showScreen('s-app');
  initMap();
  initFirebase();
  initAccelerometer();
  initVoice();
  calcEcoCitoyen();
  startKcmBroadcast();
}

// ── MAP ───────────────────────────────────────────────────
function initMap(){
  if(map) return;
  map = L.map('map',{zoomControl:true,attributionControl:true}).setView([5.345,-4.024],13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
    attribution:'© OpenStreetMap | Terra Flow Africa',
    maxZoom:18
  }).addTo(map);
  peerId = 'tfa_'+Math.random().toString(36).slice(2,8);
  if(navigator.geolocation){
    navigator.geolocation.watchPosition(pos=>{
      const{latitude:lat,longitude:lng,speed}=pos.coords;
      const spd = speed?Math.round(speed*3.6):0;
      if(!userMarker){
        userMarker = L.circleMarker([lat,lng],{
          radius:10,fillColor:'#FF9130',color:'#fff',
          weight:3,fillOpacity:1,
          pane:'markerPane'
        }).addTo(map).bindPopup('<b>📍 Moi</b><br>Score: '+drivingScore+'/100');
        map.setView([lat,lng],15);
      } else userMarker.setLatLng([lat,lng]);
      pushKcmNode(lat,lng,spd);
      updateKpiMin();
    },{enableHighAccuracy:true,timeout:10000});
  }
  addSimulatedNodes();
  loadIncidentsFromFb();
}

function addSimulatedNodes(){
  const nodes=[
    {name:'Adjamé',lat:5.362,lng:-4.018,spd:12,color:'#E94F37'},
    {name:'Yopougon',lat:5.328,lng:-4.082,spd:57,color:'#2ECC71'},
    {name:'Cocody',lat:5.351,lng:-3.992,spd:4,color:'#FF9130'},
    {name:'Plateau',lat:5.321,lng:-4.024,spd:47,color:'#2ECC71'},
    {name:'Marcory',lat:5.303,lng:-4.003,spd:54,color:'#2ECC71'},
  ];
  nodes.forEach(n=>{
    L.circleMarker([n.lat,n.lng],{radius:8,fillColor:n.color,color:'#fff',weight:2,fillOpacity:.9})
      .addTo(map).bindPopup(`<b>📡 ${n.name}</b><br>${n.spd} km/h`);
    kcmNodes[n.name]={...n,real:false};
  });
  renderKcmList();
}

function renderKcmList(){
  const el = document.getElementById('kcm-nodes-list');
  const keys = Object.keys(kcmNodes).slice(0,5);
  el.innerHTML = keys.map(k=>{
    const n = kcmNodes[k];
    const spd = n.spd||0;
    const col = spd<15?'#E94F37':spd<30?'#FF9130':'#2ECC71';
    return `<div class="kcm-node">
      <div class="kcm-node-name"><div class="kcm-dot" style="background:${col}"></div>📡 ${n.name||k}</div>
      <div class="kcm-node-speed" style="color:${col}">${spd} km/h</div>
    </div>`;
  }).join('');
}

// ── FIREBASE KCM ──────────────────────────────────────────
function pushKcmNode(lat,lng,spd){
  if(!peerId||!db) return;
  db.ref(`${CHANNEL}/live/${peerId}`).set({
    lat,lng,spd,ts:Date.now(),
    name:'Moi',mode:currentMode,score:drivingScore,
    app:'TerraFlowAfrica'
  });
}

function startKcmBroadcast(){
  setInterval(()=>{
    if(userMarker){
      const{lat,lng}=userMarker.getLatLng();
      pushKcmNode(lat,lng,0);
    }
  },30000);
}

function initFirebase(){
  db.ref(`${CHANNEL}/live`).on('child_added', snap=>{
    const d=snap.val(); if(!d) return;
    const k=snap.key;
    if(k===peerId) return;
    kcmNodes[k]={name:d.name||'Nœud KCM',spd:d.spd||0,lat:d.lat,lng:d.lng,real:true};
    if(d.lat&&d.lng){
      L.circleMarker([d.lat,d.lng],{radius:9,fillColor:'#2ECC71',color:'#fff',weight:2,fillOpacity:.9})
        .addTo(map).bindPopup(`<b>📡 ${d.name||'Nœud'}</b><br>${d.spd||0} km/h`);
    }
    renderKcmList();
    updateKpiInc();
  });
  db.ref(`${CHANNEL}/incidents`).on('child_added', snap=>{
    const d=snap.val(); if(!d) return;
    incidents.unshift(d);
    renderIncidents();
    updateKpiInc();
  });
}

function loadIncidentsFromFb(){
  incidents = [
    {type:'accident',title:'Accident — Carrefour Adj-Plateau',meta:'12 capteurs KCM · Il y a 3 min',severity:'Critique'},
    {type:'travaux',title:'Travaux — Échangeur Marcory',meta:'Voie réduite · Réseau KCM confirmé',severity:'Modéré'},
    {type:'pluie',title:'Pluie — Yopougon Est',meta:'Chaussée glissante · 8 nœuds',severity:'Prudence'},
  ];
  renderIncidents();
  document.getElementById('kpi-inc').textContent = incidents.length;
  document.getElementById('active-badge').textContent = incidents.length+' actives';
}

function renderIncidents(){
  const colors={Critique:'red',Modéré:'orange',Prudence:'blue'};
  const icons={accident:'🚗',travaux:'🚧',pluie:'🌧️',pothole:'🕳️',bouchon:'🚦'};
  document.getElementById('incidents-list').innerHTML = incidents.slice(0,5).map(i=>`
    <div class="alert-card" style="margin-bottom:10px">
      <div class="alert-ico-box alert-ico-${colors[i.severity]||'orange'}">${icons[i.type]||'⚠️'}</div>
      <div style="flex:1"><div class="alert-title">${i.title}</div><div class="alert-meta">${i.meta}</div></div>
      <span class="badge badge-${colors[i.severity]||'grey'}">${i.severity}</span>
    </div>`).join('');
}

// ── MODE TRANSPORT ────────────────────────────────────────
function setMode(mode){
  currentMode = mode;
  document.querySelectorAll('.mode-pill').forEach(p=>p.classList.remove('active'));
  document.getElementById('mode-'+mode).classList.add('active');
  if(mode==='gbaka'){
    gbakaKm += 2;
    showToast('🚌 Mode gbaka · +10 KimaPoints');
    walletPts += 10;
    updateWallet();
    calcEcoCitoyen();
  }
}

// ── NAVIGATION ────────────────────────────────────────────
function startNav(){
  showToast('🚦 Navigation démarrée · Réseau KCM actif');
  document.getElementById('route-card').style.background='var(--success)';
  setTimeout(()=>document.getElementById('route-card').style.background='var(--teal800)',3000);
}

function updateKpiMin(){
  const min = Math.floor(Math.random()*20)+40;
  document.getElementById('kpi-min').textContent = min;
}
function updateKpiInc(){
  document.getElementById('kpi-inc').textContent = incidents.length;
  document.getElementById('active-badge').textContent = incidents.length+' actives';
}

// ── SIGNALEMENT ───────────────────────────────────────────
function openSignal(){ openModal('modal-signal'); }
function reportSignal(type){
  closeModal('modal-signal');
  totalSignals++;
  walletPts += 25;
  incidents.unshift({type,title:type.charAt(0).toUpperCase()+type.slice(1)+' signalé',meta:'Par toi · À l\'instant · En attente confirmation',severity:'Modéré'});
  if(db && peerId){
    db.ref(`${CHANNEL}/incidents`).push({type,title:type+' signalé par TFA',meta:'Via Terra Flow Africa',ts:Date.now(),severity:'Modéré'});
  }
  renderIncidents();
  updateKpiInc();
  updateWallet();
  calcEcoCitoyen();
  showToast('✅ Signalement envoyé · +25 KimaPoints');
}

// ── ASSISTANT IA ──────────────────────────────────────────
async function sendMsg(text){
  const inp = document.getElementById('assistant-input');
  const msg = text || inp.value.trim();
  if(!msg) return;
  inp.value='';
  addMsg(msg,'user');
  const typing = addMsg('...','ai');
  try{
    const r = await fetch('/api/groq',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        model:'llama3-8b-8192',max_tokens:200,
        messages:[
          {role:'system',content:`Tu es l'assistant IA de Terra Flow Africa (by Kimatey Enterprise), app de mobilité urbaine à Abidjan. Réseau KCM: ${Object.keys(kcmNodes).length} nœuds actifs. Score conduite: ${drivingScore}/100. Incidents: ${incidents.length}. Réponds en français ivoirien, concis et utile.`},
          {role:'user',content:msg}
        ]
      })
    });
    const data = await r.json();
    typing.textContent = data.choices?.[0]?.message?.content||'Réseau actif — je traite ta demande.';
  }catch{
    typing.textContent = '📡 Mode offline — réseau KCM local actif. '+getLocalResponse(msg);
  }
  scrollMsgs();
}

function getLocalResponse(msg){
  const m = msg.toLowerCase();
  if(m.includes('accident')) return 'Accident signalé au carrefour Adj-Plateau. Je recalcule ton itinéraire.';
  if(m.includes('bouchon')||m.includes('trafic')) return 'Adjamé 88% saturé, Yopougon 72%. Itinéraire alternatif via Riviera disponible.';
  if(m.includes('score')) return `Ton score est ${drivingScore}/100. Continue comme ça !`;
  if(m.includes('gbaka')) return 'Mode gbaka activé. La prochaine ligne passe dans 8 min.';
  return 'Réseau KCM actif. Trafic fluide sur 3 communes. Vitesse moyenne : 24 km/h.';
}

function addMsg(text,role){
  const msgs = document.getElementById('assistant-msgs');
  const div = document.createElement('div');
  div.className='msg-bubble msg-'+role;
  div.textContent = text;
  msgs.appendChild(div);
  scrollMsgs();
  return div;
}
function scrollMsgs(){ const m=document.getElementById('assistant-msgs'); m.scrollTop=m.scrollHeight; }

// ── VOIX ──────────────────────────────────────────────────
function initVoice(){
  if(!('webkitSpeechRecognition' in window||'SpeechRecognition' in window)) return;
  const SR = window.SpeechRecognition||window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.lang='fr-FR'; recognition.continuous=false; recognition.interimResults=true;
  recognition.onresult = e=>{
    const t = Array.from(e.results).map(r=>r[0].transcript).join('');
    document.getElementById('voice-transcript').textContent = t;
    if(e.results[0].isFinal){ closeVoice(); sendMsg(t); }
  };
  recognition.onend = ()=>{ voiceActive=false; document.getElementById('voice-modal').classList.remove('open'); };
  // Wake word
  listenWakeWord();
}

function listenWakeWord(){
  if(!recognition) return;
  const wr = window.SpeechRecognition||window.webkitSpeechRecognition;
  const wakeRec = new wr(); wakeRec.lang='fr-FR'; wakeRec.continuous=true;
  wakeRec.onresult = e=>{
    const t = e.results[e.results.length-1][0].transcript.toLowerCase();
    if(t.includes('kimatey')||t.includes('terra')){ openVoice(); wakeRec.stop(); setTimeout(listenWakeWord,5000); }
  };
  try{ wakeRec.start(); }catch(e){}
}

function toggleVoice(){ voiceActive?closeVoice():openVoice(); }
function openVoice(){
  document.getElementById('voice-modal').classList.add('open');
  document.getElementById('voice-transcript').textContent='';
  voiceActive=true;
  if(recognition){ try{recognition.start();}catch(e){} }
  speak('Je t\'écoute');
}
function closeVoice(){
  document.getElementById('voice-modal').classList.remove('open');
  voiceActive=false;
  if(recognition){ try{recognition.stop();}catch(e){} }
}
function speak(text){
  if(!window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang='fr-FR'; u.rate=0.9;
  window.speechSynthesis.speak(u);
}

// ── ACCÉLÉROMÈTRE ─────────────────────────────────────────
function initAccelerometer(){
  if(!window.DeviceMotionEvent) return;
  window.addEventListener('devicemotion',e=>{
    const a = e.accelerationIncludingGravity;
    if(!a) return;
    const mag = Math.sqrt(a.x**2+a.y**2+a.z**2);
    if(mag>25){
      reportSignal('pothole');
      speak('J\'ai détecté un nid-de-poule. Je signale ?');
    }
  });
}

// ── ÉCO-SCORE + CITOYEN-PASS ─────────────────────────────
function calcEcoCitoyen(){
  const kmGbaka = gbakaKm||2.4;
  const co2Voiture = (kmGbaka+5)*0.192;
  const co2Reel = kmGbaka*0.028;
  const co2Evite = Math.max(0,co2Voiture-co2Reel).toFixed(1);
  const trajets = Math.max(1,Math.round(kmGbaka/4));
  const pct = Math.min(100,(co2Evite/10)*100);
  document.getElementById('eco-co2').textContent = co2Evite;
  document.getElementById('eco-traj').textContent = trajets;
  document.getElementById('eco-bar').style.width = pct+'%';
  document.getElementById('eco-vs').textContent =
    parseFloat(co2Evite)>0
      ?`🌍 ${co2Evite} kg CO₂ évités vs voiture individuelle`
      :'🚌 Prends le gbaka pour générer ton éco-score';
  const ptsGbaka=trajets*10, ptsSignal=totalSignals*25;
  const ptsScore=drivingScore>=80?5:0, ptsKcm=Math.floor(kcmHoursActive)*2;
  const ptsEco=Math.floor(parseFloat(co2Evite));
  const total=ptsGbaka+ptsSignal+ptsScore+ptsKcm+ptsEco;
  document.getElementById('cp-pts').textContent=total;
  document.getElementById('cp-gbaka').textContent='+'+ptsGbaka+' pts';
  document.getElementById('cp-signal').textContent='+'+ptsSignal+' pts';
  document.getElementById('cp-score').textContent='+'+ptsScore+' pts/j';
  document.getElementById('cp-kcm').textContent='+'+ptsKcm+' pts';
  const droits=[{id:'d-eau',seuil:300},{id:'d-transport',seuil:500},{id:'d-formation',seuil:750}];
  droits.forEach(d=>{
    const el=document.getElementById(d.id);
    if(el){el.textContent=total>=d.seuil?'✅ Disponible':'🔒 encore '+(d.seuil-total)+' pts';
      el.style.color=total>=d.seuil?'var(--success)':'rgba(255,255,255,.35)';}
  });
  walletPts = Math.max(walletPts,total+2340);
  updateWallet();
}

function updateWallet(){
  document.getElementById('wallet-bal').textContent=walletPts.toLocaleString('fr-FR');
  document.getElementById('vie-contrib').textContent=Math.round(walletPts*.1)+' pts contribués ce mois';
}

// ── SOS ───────────────────────────────────────────────────
function triggerSOS(){
  showToast('🆘 SOS envoyé · Secours prévenus');
  speak('SOS déclenché. Les secours sont prévenus. Reste en ligne.');
  if(db&&peerId){
    db.ref(`${CHANNEL}/sos/${peerId}`).set({ts:Date.now(),lat:userMarker?userMarker.getLatLng().lat:5.345,lng:userMarker?userMarker.getLatLng().lng:-4.024});
  }
}

// ── PAGE NAVIGATION ───────────────────────────────────────
function goPage(page){
  document.querySelectorAll('.app-page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  document.getElementById('p-'+page).classList.add('active');
  document.getElementById('nav-'+page).classList.add('active');
  if(page==='wallet') calcEcoCitoyen();
  if(page==='carte'&&map) setTimeout(()=>map.invalidateSize(),100);
}

// ── SETTINGS ─────────────────────────────────────────────
function toggleSetting(key){
  const el=document.getElementById('toggle-'+key);
  el.classList.toggle('on');
  const on=el.classList.contains('on');
  if(key==='voice'){ if(on)listenWakeWord(); showToast(on?'🎙️ Hey Kimatey activé':'Voix désactivée'); }
  if(key==='offline') showToast(on?'🗺️ Cartes offline prêtes (48MB)':'Mode en ligne');
  if(key==='kcm') showToast(on?'📡 Nœud KCM actif':'KCM désactivé');
}

// ── UTILS ─────────────────────────────────────────────────
let toastTimer;
function showToast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>t.classList.remove('show'),3000);
}
function openModal(id){ document.getElementById(id).classList.add('open'); }
function closeModal(id){ document.getElementById(id).classList.remove('open'); }