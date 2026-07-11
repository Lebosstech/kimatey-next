let dcCurrentTab="dashboard";
let currentUser=null;
const FB={apiKey:"AIzaSyBrQ_qAKll0Jg-Jp-XrflsXAR8p-sQIx0I",authDomain:"kimatey-flow-navigator.firebaseapp.com",databaseURL:"https://kimatey-flow-navigator-default-rtdb.firebaseio.com",projectId:"kimatey-flow-navigator"};
firebase.initializeApp(FB);
const db=firebase.database();
const fbAuth=firebase.auth();

// ═══ SYNCHRONISATION OFFLINE → ONLINE ═══════════════════════════════════
// File d'attente persistante (survit à la fermeture de l'app hors-ligne).
// Chaque action réseau échouée est mise en file ; on la rejoue au retour
// du réseau, sans jamais perdre l'action de l'utilisateur.
function queueOfflineWrite(path,data,pushMode){
  const q=JSON.parse(localStorage.getItem('kfn_pending_sync')||'[]');
  q.push({path,data,pushMode:!!pushMode,ts:Date.now()});
  localStorage.setItem('kfn_pending_sync',JSON.stringify(q));
  updateSyncBadge();
}
// Écriture "sûre" : tente Firebase directement, et si ça échoue
// (hors-ligne, timeout...), la même action part en file d'attente.
function dbWrite(path,data,pushMode){
  if(!navigator.onLine){queueOfflineWrite(path,data,pushMode);return;}
  const ref=db.ref(path);
  const p=pushMode?ref.push(data):ref.set(data);
  p.catch(()=>queueOfflineWrite(path,data,pushMode));
}
async function flushPendingSync(){
  const q=JSON.parse(localStorage.getItem('kfn_pending_sync')||'[]');
  if(q.length===0)return;
  toast(`📡 Synchronisation de ${q.length} action(s) en attente...`);
  const remaining=[];
  for(const item of q){
    try{
      const ref=db.ref(item.path);
      await (item.pushMode?ref.push(item.data):ref.set(item.data));
    }catch(e){ remaining.push(item); } // toujours pas de réseau fiable → on la garde
  }
  localStorage.setItem('kfn_pending_sync',JSON.stringify(remaining));
  updateSyncBadge();
  if(remaining.length===0 && q.length>0) toast('✅ Tout est synchronisé');
}
function updateSyncBadge(){
  const q=JSON.parse(localStorage.getItem('kfn_pending_sync')||'[]');
  const b=document.getElementById('sync-badge');
  if(b) b.style.display=q.length>0?'flex':'none';
  const c=document.getElementById('sync-count');
  if(c) c.textContent=q.length;
}
function updateOnlineStatus(){
  const pill=document.getElementById('offline-pill');
  if(navigator.onLine){
    if(pill)pill.style.display='none';
    flushPendingSync();
  }else{
    if(pill)pill.style.display='flex';
    toast('📴 Mode hors-ligne — tes actions seront synchronisées au retour du réseau');
  }
}
window.addEventListener('online',updateOnlineStatus);
window.addEventListener('offline',updateOnlineStatus);
const CH='kcm_abidjan';
let map,uMark,peerId=null,curMode='voiture';
let walPts=4350,drScore=87,gbKm=0,totalSig=3,kcmH=2.5;
let voiceOn=false,recog=null,incidents=[];
// NAV STATE
let navActive=false,navRoute=null,navLine=null,navSteps=[],navStepIdx=0;
let lastLat=null,lastLng=null,lastTs=null,lastBearing=0;
let totalDist=0,totalCal=0,totalCO2=0,navStartTs=null;
let speedHistory=[],currentSpeed=0;

// CURSEURS SVG PAR MODE
const CURSORS={
  voiture:`<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><circle cx="18" cy="18" r="17" fill="#FF9130" stroke="#fff" stroke-width="2"/><text x="18" y="23" text-anchor="middle" font-size="16">🚗</text></svg>`,
  moto:`<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><circle cx="18" cy="18" r="17" fill="#F97316" stroke="#fff" stroke-width="2"/><text x="18" y="23" text-anchor="middle" font-size="16">🏍️</text></svg>`,
  velo:`<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><circle cx="18" cy="18" r="17" fill="#2ECC71" stroke="#fff" stroke-width="2"/><text x="18" y="23" text-anchor="middle" font-size="16">🚲</text></svg>`,
  pieton:`<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><circle cx="18" cy="18" r="17" fill="#1C6B5C" stroke="#fff" stroke-width="2"/><text x="18" y="23" text-anchor="middle" font-size="16">🚶</text></svg>`,
  course:`<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><circle cx="18" cy="18" r="17" fill="#E94F37" stroke="#fff" stroke-width="2"/><text x="18" y="23" text-anchor="middle" font-size="16">🏃</text></svg>`,
  gbaka:`<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><circle cx="18" cy="18" r="17" fill="#0F3D3E" stroke="#FF9130" stroke-width="2.5"/><text x="18" y="23" text-anchor="middle" font-size="16">🚌</text></svg>`,
};

// MET (metabolic equivalent) par mode — énergie
// MET par mode (metabolic equivalent — énergie humaine)
const MET={voiture:1.3,moto:2.5,pieton:3.5,course:10.0,gbaka:1.3,velo:6.0};
// CO2 kg/km par mode (émissions réelles)
const CO2={voiture:0.192,moto:0.103,pieton:0,course:0,gbaka:0.028,velo:0};
// Consommation carburant L/100km par mode motorisé
const FUEL={voiture:8.0,moto:3.5,gbaka:25.0}; // gbaka total /20 passagers
// Prix carburant Abidjan (FCFA/L) — Super 95
const FUEL_PRICE=695;
// Labels affichage par mode
const MODE_LABELS={voiture:'🚗 Auto',moto:'🏍️ Moto',pieton:'🚶 Piéton',course:'🏃 Course',gbaka:'🚌 Gbaka',velo:'🚲 Vélo'};

function makeCursorIcon(mode){
  const svg=CURSORS[mode]||CURSORS.voiture;
  return L.divIcon({html:svg,iconSize:[36,36],iconAnchor:[18,18],className:''});
}

function calcBearing(lat1,lng1,lat2,lng2){
  const dL=(lng2-lng1)*Math.PI/180;
  const la1=lat1*Math.PI/180,la2=lat2*Math.PI/180;
  const y=Math.sin(dL)*Math.cos(la2);
  const x=Math.cos(la1)*Math.sin(la2)-Math.sin(la1)*Math.cos(la2)*Math.cos(dL);
  return(Math.atan2(y,x)*180/Math.PI+360)%360;
}

function haversine(la1,lo1,la2,lo2){
  const R=6371000;
  const dLa=(la2-la1)*Math.PI/180,dLo=(lo2-lo1)*Math.PI/180;
  const a=Math.sin(dLa/2)**2+Math.cos(la1*Math.PI/180)*Math.cos(la2*Math.PI/180)*Math.sin(dLo/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
const KCM_NODES=[
  {n:'Capteur · Adjamé',spd:12,lat:5.362,lng:-4.018,c:'#E94F37'},
  {n:'Capteur · Plateau',spd:47,lat:5.321,lng:-4.024,c:'#2ECC71'},
  {n:'Point relais · Yopougon',spd:57,lat:5.328,lng:-4.082,c:'#2ECC71'},
  {n:'Point relais · Cocody',spd:4,lat:5.351,lng:-3.992,c:'#E94F37'},
  {n:'Capteur · Marcory',spd:54,lat:5.303,lng:-4.003,c:'#2ECC71'},
];
// SCREENS
function show(id){document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));document.getElementById(id).classList.add('active');}
// ONBOARDING
const ONB=[
  {ico:'fa-bell',title:'On vous prévient avant vous',txt:'Bouchon, accident ou inondation sur votre trajet : l\'alerte arrive avant même que vous ouvriez l\'app.'},
  {ico:'fa-satellite-dish',title:'Réseau KCM — chaque téléphone, un capteur',txt:'Architecture edge computing distribuée : chaque smartphone devient un nœud qui analyse, signale et prédit le trafic en temps réel.'},
  {ico:'fa-microphone',title:'Hey Kimatey — mains libres total',txt:'Parle, l\'IA agit. Signalement vocal en 15 secondes. Dialogue guidé niveau par niveau. 5 langues : FR, Dioula, Baoulé, Bété, Dida.'},
  {ico:'fa-seedling',title:'Tes trajets, un impact réel',txt:'Chaque trajet collectif génère des KimaPoints. Alimente la VIE Foundation et accède au programme CITOYEN-PASS.'},
];
let onbI=0;
function handleStart(){
  // Vérifier session Firebase d'abord
  if(typeof fbAuth !== "undefined" && fbAuth.currentUser){
    gotoApp(); return;
  }
  // Vérifier session localStorage
  const sess=localStorage.getItem("kfn_session");
  if(sess){
    try{
      currentUser=JSON.parse(sess);
      gotoApp();
      return;
    }catch(e){}
  }
  // Pas de session → onboarding
  gotoOnb();
}

function gotoOnb(){show('s-onboarding');buildDots();renderOnb(0);}
function buildDots(){const c=document.getElementById('onb-dots');c.innerHTML='';ONB.forEach((_,i)=>{const d=document.createElement('div');d.className='onb-dot'+(i===0?' active':'');c.appendChild(d);});}
function renderOnb(i){
  document.getElementById('onb-ico').className='fa-solid '+ONB[i].ico;
  document.getElementById('onb-title').textContent=ONB[i].title;
  document.getElementById('onb-text').textContent=ONB[i].txt;
  document.querySelectorAll('.onb-dot').forEach((d,j)=>d.classList.toggle('active',j===i));
  document.getElementById('onb-btn').textContent=i===ONB.length-1?'Commencer':'Suivant';
}
function nextOnb(){if(onbI<ONB.length-1){onbI++;renderOnb(onbI);}else show('s-login');}
// LOGIN

function gotoApp(){
  show('s-app');
  initMap();initFB();initAccel();initVoice();calcEco();startBroadcast();startRealTimeAlerts();setTimeout(initEduModule,2000);
  requestGPS();
  updateSyncBadge();
  initKimiTabs();
  // Demander permission notifications
  const savedNotif=localStorage.getItem('kfn_notif');
  if(savedNotif==='granted') notifPermission='granted';
  else setTimeout(requestNotifPermission, 5000);
  // Charger les lieux communautaires sur la carte
  setTimeout(loadLieuxRecents, 3000);
  if(navigator.onLine)flushPendingSync();
  else{const pill=document.getElementById('offline-pill');if(pill)pill.style.display='flex';}
  // Charger session utilisateur (invité = pas de compte Firebase)
  if(!currentUser){
    const sess=localStorage.getItem('kfn_session');
    if(sess)try{currentUser=JSON.parse(sess);}catch(e){}
  }
  if(currentUser){
    const el=document.getElementById('pr-name');
    if(el)el.textContent=currentUser.name||'Mon profil';
    const av=document.getElementById('av-init');
    if(av)av.textContent=(currentUser.name||'K').charAt(0).toUpperCase();
  }
  // Historique : déjà chargé depuis Firebase par finishAuth() si connecté,
  // sinon on relit le cache local (mode invité)
  if(!fbAuth.currentUser){
    tripHistory=JSON.parse(localStorage.getItem('kfn_history')||'[]');
  }
  renderHistory();
}
// MAP
function initMap(){
  if(map)return;
  map=L.map('map',{zoomControl:true,rotate:false}).setView([5.345,-4.024],15);
  // Tuiles CartoDB Voyager — plus propres pour la navigation
  const tiles = {
    voyager: L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',{
      attribution:'© CartoDB · OSM | Kimatey Flow',maxZoom:19,subdomains:'abcd'
    }),
    dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{
      attribution:'© CartoDB · OSM | Kimatey Flow',maxZoom:19,subdomains:'abcd'
    }),
    osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
      attribution:'© OSM | Kimatey Flow',maxZoom:19
    })
  };
  let currentTile = tiles.voyager;
  currentTile.addTo(map);
  window._mapTiles = tiles;
  window._currentTileKey = 'voyager';
  peerId='kfn_'+Math.random().toString(36).slice(2,7);
  KCM_NODES.forEach(n=>{
    L.circleMarker([n.lat,n.lng],{radius:8,fillColor:n.c,color:'#fff',weight:2,fillOpacity:.9})
      .addTo(map).bindPopup(`<b>📡 ${n.n}</b><br>${n.spd} km/h`);
  });
  renderKCM();
  // GPS géré par requestGPS() — appelé depuis gotoApp()
  // Panel vitesse overlay
  addSpeedPanel();
}

function addSpeedPanel(){
  const panel=document.createElement('div');
  panel.id='speed-panel';
  panel.style.cssText='position:absolute;bottom:260px;left:16px;z-index:500;background:#0F3D3E;border-radius:12px;padding:10px 14px;min-width:90px;display:none';
  panel.innerHTML=`
    <div id="sp-speed" style="font-family:Poppins,sans-serif;font-weight:700;font-size:28px;color:#FF9130;text-align:center;line-height:1">0</div>
    <div style="font-size:9px;color:rgba(255,255,255,.6);text-align:center;margin-bottom:6px">km/h</div>
    <div style="display:flex;justify-content:space-between;font-size:10px;color:rgba(255,255,255,.7)">
      <span>🔥</span><span id="sp-cal">0 kcal</span>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:10px;color:rgba(255,255,255,.7);margin-top:2px">
      <span>🌱</span><span id="sp-co2">0.0 kg</span>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:10px;color:rgba(255,255,255,.7);margin-top:2px">
      <span>📍</span><span id="sp-dist">0 m</span>
    </div>`;
  document.getElementById('p-carte').appendChild(panel);
}

function onGPSUpdate(pos){
  const{latitude:la,longitude:lo,speed:sp,heading:hd}=pos.coords;
  const now=Date.now();

  // Vitesse GPS (m/s → km/h)
  let speedKmh=sp?Math.round(sp*3.6):0;

  // Calcul depuis positions si GPS speed non dispo
  if(lastLat!==null){
    const dist=haversine(lastLat,lastLng,la,lo);
    const dt=(now-lastTs)/1000;
    if(dt>0&&dt<10){
      const calcSpd=(dist/dt)*3.6;
      if(speedKmh===0&&calcSpd>0.5) speedKmh=Math.round(calcSpd);
      // Distance totale
      totalDist+=dist;
      // Énergie — MET * poids(70kg) * heures
      const hrs=dt/3600;
      const met=speedKmh>8&&curMode==='pieton'?MET.course:MET[curMode]||MET.voiture;
      totalCal+=met*70*hrs;
      // CO2
      const co2PerKm=CO2[curMode]||CO2.voiture;
      totalCO2+=co2PerKm*(dist/1000);
    }
    // Bearing
    if(dist>2) lastBearing=calcBearing(lastLat,lastLng,la,lo);
  }
  lastLat=la;lastLng=lo;lastTs=now;
  currentSpeed=speedKmh;
  speedHistory.push(speedKmh);
  if(speedHistory.length>10)speedHistory.shift();

  // Mode auto pieton/course selon vitesse
  let displayMode=curMode;
  if(curMode==='pieton'&&speedKmh>7) displayMode='course';

  // Créer ou mettre à jour le marqueur avec curseur personnalisé
  const icon=makeCursorIcon(displayMode);
  if(!uMark){
    uMark=L.marker([la,lo],{icon,zIndexOffset:1000}).addTo(map);
    map.setView([la,lo],17);
  } else {
    uMark.setLatLng([la,lo]);
    uMark.setIcon(icon);
  }

  // Rotation du curseur selon heading
  const bearing=hd||lastBearing;
  const iconEl=uMark.getElement();
  if(iconEl) iconEl.style.transform+=' rotate('+bearing+'deg)';

  // Centrage carte en navigation
  if(navActive) map.setView([la,lo],17);

  // Mise à jour panel vitesse
  updateSpeedPanel(speedKmh);

  // Push Firebase KCM
  pushNode(la,lo,speedKmh);

  // Navigation — check étape suivante
  if(navActive&&navSteps.length>0) checkNavStep(la,lo);
  checkOffRoute(la,lo);

  // Déviation de route
  checkNavDeviation(la,lo);
  // Score conduite — pénalité si >80km/h
  if(speedKmh>80&&curMode==='voiture'){
    drScore=Math.max(0,drScore-1);
    document.getElementById('k-score').textContent=drScore;
  }
}

function updateSpeedPanel(spd){
  const badge=document.getElementById('speed-badge');
  if(!badge)return;
  if(spd<1&&!navActive){badge.style.display='none';return;}
  badge.style.display='block';

  // Icône et vitesse
  const modeIco={voiture:'🚗',moto:'🏍️',pieton:'🚶',course:'🏃',gbaka:'🚌',velo:'🚲'};
  const modeEl=document.getElementById('sb-mode');
  const speedEl=document.getElementById('sb-speed');
  const mainEl=document.getElementById('sb-main');
  const secEl=document.getElementById('sb-secondary');
  if(modeEl) modeEl.textContent=modeIco[curMode]||'🚗';
  if(speedEl){
    speedEl.textContent=spd;
    // Rouge si dépassement : voiture>80, moto>90, vélo>25, piéton>8
    const limits={voiture:80,moto:90,pieton:8,course:12,gbaka:60,velo:25};
    const lim=limits[curMode]||80;
    speedEl.style.color=spd>lim?'#E94F37':'var(--amber-500)';
  }

  // Calcul selon le mode
  const isPieton = curMode==='pieton'||curMode==='course'||curMode==='velo';
  const dist_km = totalDist/1000;

  if(isPieton){
    // PIÉTON / VÉLO / COURSE → calories + CO2 économisé
    const cal = Math.round(totalCal);
    const co2Saved = Math.round(dist_km * (CO2.voiture - CO2[curMode]) * 1000); // en grammes
    if(mainEl){
      mainEl.style.color='var(--success)';
      mainEl.textContent=cal+' kcal';
    }
    if(secEl) secEl.textContent=co2Saved>0?'-'+co2Saved+'g CO₂':'0g CO₂';
  } else {
    // MOTORISÉ → CO2 émis + carburant + coût
    const co2_g = Math.round(totalCO2*1000); // grammes
    const fuelPer100 = FUEL[curMode]||8.0;
    const fuelL = dist_km * fuelPer100/100;
    const fuelCost = Math.round(fuelL * FUEL_PRICE);

    if(curMode==='gbaka'){
      // Gbaka : CO2 par passager + économie vs voiture solo
      const co2Saved=Math.round(dist_km*(CO2.voiture-CO2.gbaka)*1000);
      if(mainEl){
        mainEl.style.color='var(--success)';
        mainEl.textContent='-'+co2Saved+'g CO₂';
      }
      if(secEl) secEl.textContent='vs voiture solo';
    } else {
      // Voiture / Moto
      if(mainEl){
        mainEl.style.color=co2_g>500?'#E94F37':'rgba(255,255,255,.8)';
        mainEl.textContent=co2_g+'g CO₂';
      }
      if(secEl) secEl.textContent=fuelL.toFixed(2)+'L · '+fuelCost+' FCFA';
    }
  }

  // Sync KPI min économisées
  if(navActive&&currentSpeed>0){
    const el=document.getElementById('k-min');
    if(el) el.textContent=Math.round(totalDist/1000*2);
  }

  // Push données vers Firebase KCM (pour dashboard + live)
  pushEcoData();
}

// Push données éco vers Firebase pour dashboard et live
function pushEcoData(){
  if(!db||!peerId||totalDist<10)return;
  const isPieton=curMode==='pieton'||curMode==='course'||curMode==='velo';
  const dist_km=totalDist/1000;
  const data={
    ts:Date.now(),
    mode:curMode,
    dist_km:parseFloat(dist_km.toFixed(3)),
    co2_kg:parseFloat(totalCO2.toFixed(4)),
    co2_saved_kg:parseFloat((dist_km*(CO2.voiture-(CO2[curMode]||0))).toFixed(4)),
    fuel_l:isPieton?0:parseFloat((dist_km*(FUEL[curMode]||8)/100).toFixed(3)),
    fuel_cost_fcfa:isPieton?0:Math.round(dist_km*(FUEL[curMode]||8)/100*FUEL_PRICE),
    kcal:isPieton?Math.round(totalCal):0,
    speed:currentSpeed,
    score:drScore
  };
  db.ref(CH+'/eco/'+peerId).set(data);
}
function renderKCM(){
  document.getElementById('kcm-list').innerHTML=KCM_NODES.map(n=>`<div class="kcm-node"><span><i class="fa-solid fa-satellite-dish" style="color:${n.c};margin-right:6px;font-size:9px"></i>${n.n}</span><span class="kcm-spd" style="color:${n.c}">${n.spd} km/h</span></div>`).join('');
  document.getElementById('kcm-count').textContent='● '+KCM_NODES.length+' nœuds';
  document.getElementById('k-inc').textContent=3;
}
function pushNode(la,lo,sp){
  if(!db||!peerId)return;
  db.ref(`${CH}/live/${peerId}`).set({
    lat:la,lng:lo,spd:sp,ts:Date.now(),name:currentUser?.name||'Moi',mode:curMode,score:drScore,
    app:'KimateyFlowNavigator',
    action:navActive?'navigation':'en_ligne',
    destName:navActive?(navDestName||''):'',
    destLat:navActive?(navDestLat||null):null,
    destLng:navActive?(navDestLng||null):null
  });
}
// Journal d'activité — visible en direct dans le Dashboard (clic sur un utilisateur)
function logUserAction(label,emoji){
  if(!db||!peerId)return;
  db.ref(`${CH}/user_actions/${peerId}`).push({
    label,emoji:emoji||'📍',ts:Date.now(),lat:lastLat||null,lng:lastLng||null
  });
  // Ne garder que les 20 dernières actions par utilisateur (nettoyage léger)
  db.ref(`${CH}/user_actions/${peerId}`).limitToLast(21).once('value',snap=>{
    const keys=Object.keys(snap.val()||{});
    if(keys.length>20)db.ref(`${CH}/user_actions/${peerId}/${keys[0]}`).remove();
  });
}
function startBroadcast(){setInterval(()=>{if(uMark){const{lat:la,lng:lo}=uMark.getLatLng();pushNode(la,lo,0);}},30000);}
function initFB(){
  db.ref(`${CH}/live`).on('child_added',snap=>{
    const d=snap.val();if(!d||snap.key===peerId)return;
    L.circleMarker([d.lat,d.lng],{radius:9,fillColor:'#2ECC71',color:'#fff',weight:2,fillOpacity:.9}).addTo(map).bindPopup(`<b>📡 ${d.name||'Nœud KCM'}</b><br>${d.spd||0} km/h`);
  });
}
// MODES
function setMode(m){
  curMode=m;
  ['voiture','moto','velo','pieton','gbaka'].forEach(x=>{
    const el=document.getElementById('m-'+x);
    if(el)el.classList.remove('active');
  });
  const el=document.getElementById('m-'+m);
  if(el)el.classList.add('active');
  if(m==='gbaka'){gbKm+=3;toast('🚌 Mode Gbaka · +10 KimaPoints');walPts+=10;calcEco();}
  if(m==='velo'){toast('🚲 Mode Vélo · +8 KimaPoints · 0g CO₂');walPts+=8;calcEco();}
  if(m==='pieton'){toast('🚶 Mode Piéton · +5 KimaPoints · calories actives');}
}

// SHEET RÉTRACTABLE
let sheetOpen=false;
function toggleSheet(){
  const s=document.getElementById('bottom-sheet');
  sheetOpen=!sheetOpen;
  s.className=sheetOpen?'bs-expanded':'bs-collapsed';
}

// SWITCHER STYLE CARTE
function switchMapStyle(){
  if(!map||!window._mapTiles)return;
  const styles=['voyager','dark','osm'];
  const labels={'voyager':'Carte claire','dark':'Nuit','osm':'Standard'};
  const icons={'voyager':'fa-sun','dark':'fa-moon','osm':'fa-map'};
  const idx=styles.indexOf(window._currentTileKey);
  const next=styles[(idx+1)%styles.length];
  map.removeLayer(window._mapTiles[window._currentTileKey]);
  window._mapTiles[next].addTo(map);
  window._currentTileKey=next;
  const btn=document.getElementById('fab-style');
  if(btn)btn.querySelector('i').className='fa-solid '+icons[next];
  toast('🗺️ '+labels[next]);
}

// CENTRER CARTE
function centerMap(){
  if(lastLat&&map){map.setView([lastLat,lastLng],17);toast('📍 Centré sur ta position');}
  else{toast('GPS pas encore actif');requestGPS();}
}

// GPS POPUP
function requestGPS(){
  if(!navigator.geolocation){
    toast('GPS non disponible sur cet appareil');
    return;
  }
  const popup=document.getElementById('gps-popup');
  if(popup)popup.style.display='none';
  // watchPosition permanent — se déclenche dès que le GPS répond
  navigator.geolocation.watchPosition(
    pos=>{
      // Fermer le popup GPS dès la première position reçue
      const p=document.getElementById('gps-popup');
      if(p)p.style.display='none';
      onGPSUpdate(pos);
      if(!lastLat) toast('📍 GPS activé — position trouvée !');
    },
    err=>{
      // Afficher popup d'aide selon le type d'erreur
      const msgs={
        1:'Autorise la localisation dans les réglages de ton navigateur',
        2:'Signal GPS faible — essaie en extérieur',
        3:'GPS trop lent — réessaie dans quelques secondes'
      };
      const p=document.getElementById('gps-popup');
      if(p)p.style.display='block';
      toast('📍 '+( msgs[err.code]||'Erreur GPS'));
    },
    {enableHighAccuracy:true, maximumAge:2000, timeout:15000}
  );
}

// SEARCH
function openSearch(){
  const o=document.getElementById('search-overlay');
  if(o){
    o.classList.add('open');
    showQuick(true);
    renderHistory();
    setTimeout(()=>{const i=document.getElementById('search-real-inp');if(i)i.focus();},100);
  }
}
function closeSearch(){
  const o=document.getElementById('search-overlay');
  if(o)o.classList.remove('open');
}

// CHAT FLOTTANT SUR CARTE
function toggleMapChat(){
  const c=document.getElementById('map-chat');
  if(c)c.style.display=c.style.display==='none'?'block':'none';
}
function mapChatSend(){
  const inp=document.getElementById('map-chat-inp');
  const msg=inp?.value.trim();if(!msg)return;
  inp.value='';
  const msgs=document.getElementById('map-chat-msgs');
  const d=document.createElement('div');d.className='bubble user';d.textContent=msg;msgs?.appendChild(d);
  const r=document.createElement('div');r.className='bubble ai';r.textContent='…';msgs?.appendChild(r);
  msgs.scrollTop=9999;
  setTimeout(()=>{r.textContent=localResp(msg);msgs.scrollTop=9999;speak(r.textContent.replace(/[^a-zA-ZÀ-ÿ0-9 ,.'-]/g,'').slice(0,80));},500);
}
// ── NAVIGATION OSRM ──────────────────────────────────────────
async function startNav(){
  if(!lastLat){toast('📍 GPS requis — active la localisation');return;}
  // Destination par défaut : Plateau centre
  const dest=[5.3211,-4.0156];
  toast('📡 Calcul de l\'itinéraire...');
  try{
    const url=`https://router.project-osrm.org/route/v1/driving/${lastLng},${lastLat};${dest[1]},${dest[0]}?overview=full&geometries=geojson&steps=true`;
    const r=await fetch(url);
    const data=await r.json();
    if(!data.routes||!data.routes[0])throw new Error('No route');
    const route=data.routes[0];
    const coords=route.geometry.coordinates.map(c=>[c[1],c[0]]);
    navSteps=route.legs[0].steps||[];
    navStepIdx=0;
    if(navLine)map.removeLayer(navLine);
    navLine=L.polyline(coords,{color:'#FF9130',weight:5,opacity:.85}).addTo(map);
    map.fitBounds(navLine.getBounds(),{padding:[60,60]});
    navActive=true;
    navStartTs=Date.now();
    totalDist=0;totalCal=0;totalCO2=0;
    const durMin=Math.round(route.duration/60);
    const distKm=(route.distance/1000).toFixed(1);
    document.getElementById('r-via').textContent=navSteps[0]?.name||'Itinéraire calculé';
    document.getElementById('r-time').innerHTML=`${durMin} min · ${distKm} km · <span class="route-ok">Fluide</span>`;
    toast(`🚦 Navigation démarrée · ${durMin} min · ${distKm} km`);
    speak(`Navigation démarrée. Distance : ${distKm} kilomètres. Durée estimée : ${durMin} minutes.`);
    showNavBar();
  }catch(e){
    // Fallback offline — route simulée
    navActive=true;navStartTs=Date.now();
    toast('🗺️ Mode offline — routage local activé');
    speak('Navigation démarrée en mode hors ligne.');
    showNavBar();
  }
}

function showNavBar(){
  let bar=document.getElementById('nav-bar');
  if(!bar){
    bar=document.createElement('div');
    bar.id='nav-bar';
    bar.style.cssText='position:absolute;top:130px;left:12px;right:12px;z-index:500;background:#E94F37;border-radius:16px;padding:12px 14px;display:flex;align-items:center;gap:10px';
    bar.innerHTML=`<i class="fa-solid fa-triangle-exclamation" style="color:#fff;font-size:18px"></i>
      <div style="flex:1"><div id="nav-instruction" style="font-size:13px;font-weight:700;color:#fff">Navigation en cours...</div>
      <div id="nav-next" style="font-size:11px;color:#FCE7E3;margin-top:2px">Réseau KCM actif</div></div>
      <button onclick="stopNav()" style="background:rgba(0,0,0,.25);color:#fff;border:none;border-radius:20px;padding:6px 12px;font-size:11px;font-weight:700;cursor:pointer">Arrêt</button>`;
    document.getElementById('p-carte').appendChild(bar);
  }
  bar.style.display='flex';
}

function checkNavStep(la,lo){
  if(!navSteps[navStepIdx])return;
  const step=navSteps[navStepIdx];
  const stepLat=step.maneuver?.location[1];
  const stepLng=step.maneuver?.location[0];
  if(!stepLat)return;
  const d=haversine(la,lo,stepLat,stepLng);
  const instr=document.getElementById('nav-instruction');
  const nxt=document.getElementById('nav-next');
  if(d<30){
    navStepIdx++;
    if(navStepIdx<navSteps.length){
      const ns=navSteps[navStepIdx];
      const txt=ns.maneuver?.modifier?`Tournez ${ns.maneuver.modifier}`:'Continuez tout droit';
      if(instr)instr.textContent=txt;
      if(nxt)nxt.textContent='Dans '+(ns.distance<1000?Math.round(ns.distance)+' m':(ns.distance/1000).toFixed(1)+' km')+' — '+ns.name;
      speak(txt+' dans '+(ns.distance<1000?Math.round(ns.distance)+' mètres':(ns.distance/1000).toFixed(1)+' kilomètres'));
    } else {
      stopNav();toast('✅ Destination atteinte !');speak('Vous êtes arrivé à destination.');
    }
  } else {
    if(instr)instr.textContent=step.maneuver?.modifier?('Tournez '+step.maneuver.modifier):(step.name?('Direction '+step.name):'Navigation en cours');
    if(nxt)nxt.textContent='Dans '+(d<1000?Math.round(d)+' m':(d/1000).toFixed(1)+' km')+' · '+currentSpeed+' km/h';
  }
}

function stopNav(){
  navActive=false;
  if(navLine){map.removeLayer(navLine);navLine=null;}
  const bar=document.getElementById('nav-bar');
  if(bar)bar.style.display='none';
  toast('Navigation arrêtée');
  speak('Navigation arrêtée.');
  // Stats du trajet
  if(totalDist>10){
    const distKm=(totalDist/1000).toFixed(2);
    const cal=Math.round(totalCal);
    const mins=Math.round((Date.now()-navStartTs)/60000);
    addMsg(`📊 Trajet terminé — ${distKm} km en ${mins} min · ${cal} kcal · CO₂ : ${totalCO2.toFixed(3)} kg · +${Math.ceil(totalDist/400)} KimaPoints`,'ai');
    walPts+=Math.ceil(totalDist/400);
    gbKm+=parseFloat(distKm);
    // Sauvegarder en historique
    if(navDestName){
      saveTripToHistory(navDestName,navDestLat,navDestLng,distKm,mins);
      logUserAction(`Trajet terminé vers ${navDestName} — ${distKm} km en ${mins} min`,'🏁');
    }
    calcEco();
  }
  if(lastLat)pushNode(lastLat,lastLng,0);
}

// Destination rapide depuis le chat
function setNavDest(name,lat,lng){
  const go=async()=>{
    if(!lastLat){toast('GPS requis');return;}
    const url=`https://router.project-osrm.org/route/v1/${curMode==='voiture'||curMode==='gbaka'?'driving':'foot'}/${lastLng},${lastLat};${lng},${lat}?overview=full&geometries=geojson&steps=true`;
    try{
      const r=await fetch(url);const data=await r.json();
      if(!data.routes?.[0])throw new Error();
      const coords=data.routes[0].geometry.coordinates.map(c=>[c[1],c[0]]);
      navSteps=data.routes[0].legs[0].steps||[];navStepIdx=0;
      if(navLine)map.removeLayer(navLine);
      navLine=L.polyline(coords,{color:'#FF9130',weight:5,opacity:.85}).addTo(map);
      map.fitBounds(navLine.getBounds(),{padding:[60,60]});
      navActive=true;navStartTs=Date.now();totalDist=0;totalCal=0;totalCO2=0;
      navDestName=name;navDestLat=lat;navDestLng=lng;
      const dur=Math.round(data.routes[0].duration/60);
      const dist=(data.routes[0].distance/1000).toFixed(1);
      toast(`🚦 Vers ${name} · ${dur} min · ${dist} km`);
      speak(`Navigation vers ${name}. ${dur} minutes.`);
      logUserAction(`A démarré une navigation vers ${name} (${dist} km · ${dur} min)`,'🧭');
      if(lastLat)pushNode(lastLat,lastLng,currentSpeed);
      showNavBar();goPage('carte');
    }catch{toast('Mode offline — GPS insuffisant');}
  };
  go();
}
// PAGES
function goPage(p){
  document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.navitem').forEach(x=>x.classList.remove('active'));
  document.getElementById('p-'+p).classList.add('active');
  document.getElementById('n-'+p).classList.add('active');
  if(p==='wallet')calcEco();
  if(p==='carte'&&map)setTimeout(()=>map.invalidateSize(),100);
  if(p==='alertes')clearAlertBadge();
  if(p==='lieux')loadLieuxPage();
  if(p==='edu'){showSavoirDuJour();renderMissions();renderBadges();}
  if(p==='profil'){
    renderHistory();
    updateDashboardCitoyen();
    dcTab('dashboard');
  }
  // Kimi fab visible partout
  const fab=document.getElementById('kimi-fab');
  if(fab)fab.style.display='flex';
}
// ── BADGE NOTIFICATION — ALERTES (nav bar) ─────────────────────
let unreadAlertes=0;
function bumpAlertBadge(){
  unreadAlertes++;
  const b=document.getElementById('alertes-badge');
  if(!b)return;
  b.textContent=unreadAlertes>9?'9+':unreadAlertes;
  b.classList.add('show');
}
function clearAlertBadge(){
  unreadAlertes=0;
  const b=document.getElementById('alertes-badge');
  if(b)b.classList.remove('show');
}
// SIGNAL
function openSignal(){openOv('ov-signal');}
function doSignal(type,ico,name){
  closeOv('ov-signal');
  const pts={accident:50,bouchon:30,inondation:40,controle:20,pothole:25,travaux:20}[type]||25;
  totalSig++;walPts+=pts;
  const el=document.getElementById('inc-list');
  const div=document.createElement('div');
  div.className='alert-card';div.style.marginTop='8px';
  div.innerHTML=`<div class="alert-ico" style="background:var(--coral-100)"><i class="fa-solid ${ico}" style="color:var(--coral-600)"></i></div><div style="flex:1"><div class="alert-title">${name} signalé — Position actuelle</div><div class="alert-meta">Par toi · À l'instant · En attente confirmation KCM</div></div><span class="pill pill-orange">En cours</span>`;
  el.prepend(div);
  document.getElementById('inc-badge').textContent=(3+totalSig-3)+' actives';
  if(peerId)dbWrite(`${CH}/incidents`,{type,title:name+' — Réseau KCM',ts:Date.now(),severity:'Modéré',lat:lastLat||null,lng:lastLng||null},true);
  logUserAction(`A signalé : ${name}`,ico?'⚠️':'📍');
  calcEco();toast(`✅ ${name} signalé · +${pts} KimaPoints`);
}
// ── IA AUTONOME EMBARQUÉE — zéro dépendance réseau ─────────
const IA_KB = [
  {k:['accident','collision','choc','crash'],r:'⚠️ Accident confirmé — Carrefour Adj-Plateau. 12 nœuds KCM ont détecté l\'incident il y a 3 min. Itinéraire alternatif calculé : Via Riviera → Cocody → Pont De Gaulle (+6 min, fluide). Veux-tu que je lance la navigation ?'},
  {k:['bouchon','embouteillage','trafic','congestion','saturé'],r:'📡 État du réseau KCM en temps réel — Adjamé : 88% saturé (axe principal critique), Yopougon : 72% (heure de pointe), Plateau : 65% (ralentissement centre), Abobo : 58%, Cocody : 32% (fluide), Marcory : 45% (travaux). Meilleure route : Pont De Gaulle via Riviera.'},
  {k:['gbaka','bus','sotra','transport','collectif','woro'],r:'🚌 Mode gbaka activé ! Prochaine ligne Adjamé → Plateau dans ~8 min, arrêt Marché Adjamé. Mode collectif = +10 KimaPoints + éco-score CO₂. Les gbaka et woro-woro desservent 80% des Abidjanais — c\'est notre cœur de cible, là où Waze et Yango ne vont pas.'},
  {k:['score','conduite','point','comportement'],r:`⭐ Ton score de conduite est ${drScore}/100 — excellent niveau ! Critères : freinages brusques (2 cette semaine), vitesse respectée 94%, signalements validés par le réseau KCM. À ce niveau, tu es éligible à −20% sur l'assurance et +5 KimaPoints par jour.`},
  {k:['partir','heure','moment','quand','horaire'],r:'⏰ Meilleures heures pour partir — Matin : avant 7h00 (fluide) ou après 10h00. Soir : avant 16h30 ou après 20h00. Pic critique : 7h30-9h30 (Adjamé, pont FHB) et 17h00-19h30 (tous axes). Le réseau KCM prédit une amélioration d\'ici 45 min.'},
  {k:['pothole','nid','route','dégradé','danger'],r:'🕳️ Nid-de-poule détecté et signalé automatiquement via l\'accéléromètre. 23 confirmations sur la Route de Bingerville (Km 12). Signalement transmis au réseau KCM — les autres conducteurs sont alertés. Ce rapport sera agrégé pour l\'AGEROUTE.'},
  {k:['kcm','réseau','nœud','capteur','computing'],r:`📡 Réseau KCM (Kimatey Computing Mobile) — ${KCM_NODES.length} nœuds actifs en ce moment. Chaque smartphone devient un capteur edge computing : il analyse le trafic localement, confirme les incidents des pairs, et synchronise vers Firebase. Même sans internet, le daemon local continue à fonctionner.`},
  {k:['offline','hors ligne','sans réseau','connexion'],r:'🗺️ Mode offline actif — 48 MB de tuiles du Grand Abidjan pré-cachées. Routage Dijkstra 100% local (aucun serveur nécessaire). Le daemon KCM continue d\'analyser les données des capteurs. C\'est notre avantage clé vs Waze et Yango qui nécessitent une connexion permanente.'},
  {k:['co2','carbone','environnement','éco','pollution','écolo'],r:'🌱 Éco-Score actuel : trajets en gbaka évitent en moyenne 0.164 kg CO₂/km vs voiture solo (0.192 kg/km voiture − 0.028 kg/km gbaka). Thème du VIBEATHON 2026 : "IA et environnement". Chaque kg CO₂ évité génère aussi 1 KimaPoint CITOYEN-PASS.'},
  {k:['citoyen','pass','droit','social','vie','foundation'],r:'🎖️ CITOYEN-PASS — programme pilote Kimatey Enterprise & VIE Foundation. Tes KimaPoints civiques se convertissent en droits : 300 pts = Pack Eau VIE, 500 pts = Crédit Transport, 750 pts = Formation Kimatey. Mécanisme vérifiable grâce à la confirmation pair-à-pair du réseau KCM.'},
  {k:['inondation','pluie','eau','route inondée'],r:'🌊 Alerte inondation — Yopougon Est : chaussée glissante, 8 nœuds KCM confirmés il y a 18 min. Route de Bingerville : passage déconseillé après 22h en saison des pluies. Réduction de vitesse recommandée : 30 km/h max sur voies mouillées.'},
  {k:['sos','urgence','secours','accident grave','blessé'],r:'🆘 Mode SOS activé ! Position GPS transmise aux secours et au contact de confiance. Données horodatées enregistrées comme preuve numérique (témoin d\'accident). SAMU : 185 · Police : 111 · Pompiers : 180. Reste en ligne, les secours arrivent.'},
  {k:['waze','google','yango','concurrent','comparaison'],r:'🆚 Waze/Google Maps/Yango optimisent pour la voiture individuelle. Kimatey Flow Navigator est la seule app gbaka-first : lignes de transport collectif, offline-first pour zones à faible connectivité, réseau KCM de capteurs citoyens, éco-score CO₂, et données souveraines ivoiriennes. Nous servons les 80% que ces apps ignorent.'},
  {k:['plateau','aller','vers','naviguer','itinéraire'],r:'🗺️ Navigation vers le Plateau lancée !',fn:()=>setNavDest('Plateau',5.3211,-4.0156)},
  {k:['cocody','riviera','angré'],r:'🗺️ Navigation vers Cocody lancée !',fn:()=>setNavDest('Cocody',5.3516,-3.9921)},
  {k:['yopougon','banco'],r:'🗺️ Navigation vers Yopougon lancée !',fn:()=>setNavDest('Yopougon',5.3282,-4.0824)},
  {k:['adjamé','marché'],r:'🗺️ Navigation vers Adjamé lancée !',fn:()=>setNavDest('Adjamé',5.3623,-4.0180)},
  {k:['marcory','treichville'],r:'🗺️ Navigation vers Marcory lancée !',fn:()=>setNavDest('Marcory',5.3032,-4.0033)},
  {k:['wallet','kima','point','récompense','bonus'],r:`💰 Ton portefeuille : ${walPts.toLocaleString('fr-FR')} KimaPoints. Sources actives : signalements validés (+25-50 pts), trajets gbaka (+10 pts), score conduite ≥80 (+5 pts/jour), nœud KCM actif (+2 pts/h), CO₂ évité (+1 pt/kg). 10% sont automatiquement contribués à la VIE Foundation.`},
  {k:['navigation','itinéraire','aller','route','chemin','comment'],r:'🗺️ Navigation en cours — itinéraire optimal calculé. Via Riviera → Cocody → Pont De Gaulle (+6 min, fluide). Le réseau KCM surveille ton trajet en temps réel. En cas d\'incident détecté, je recalcule automatiquement. Dis "GO" ou appuie sur le bouton pour démarrer.'},
];

function localResp(m){
  const ml=m.toLowerCase();
  for(const kb of IA_KB){
    if(kb.k.some(k=>ml.includes(k))){
      if(kb.fn) setTimeout(kb.fn,300);
      return kb.r;
    }
  }
  // Détection destination libre — "aller à X", "emmène-moi à X", "route vers X"
  const destPatterns=[/(?:aller?|emmène-?moi|conduis-?moi|route|direction|vers)\s+[aà]\s+(.+)/i,/(?:je veux aller|je vais)\s+(?:[aà]\s+)?(.+)/i];
  for(const pat of destPatterns){
    const match=m.match(pat);
    if(match&&match[1]){
      const dest=match[1].trim().replace(/[!?.]/g,'');
      setTimeout(()=>searchPlaces(dest).then(()=>{
        const results=document.getElementById('search-results');
        if(results&&results.children.length>0)results.children[0].click();
        else toast('Destination "'+dest+'" introuvable — essaie la recherche');
      }),400);
      return '🗺️ Je cherche "'+dest+'" — un instant...';
    }
  }
  const hour=new Date().getHours();
  const trafic=hour>=7&&hour<10?'heure de pointe — Adjamé et Yopougon saturés':hour>=17&&hour<20?'heure de pointe soir — tous axes chargés':'trafic modéré sur le réseau';
  return '📡 Réseau KCM actif — '+KCM_NODES.length+' nœuds. '+trafic+'. Navigation, trafic, signalement, score, gbaka, Eco-Score.';
}

async function ask(t){
  const inp=document.getElementById('msg-inp');
  const msg=t||inp.value.trim();if(!msg)return;
  inp.value='';addMsg(msg,'user');
  const typing=addMsg('…','ai');
  await new Promise(r=>setTimeout(r,400));
  typing.textContent=localResp(msg);
  document.getElementById('msgs').scrollTop=9999;
  speak(typing.textContent.replace(/[🚌⚠️📡🗺️⭐⏰🕳️🌊🆘🌱🎖️🆚💰]/g,'').slice(0,80));
}
function addMsg(t,r){const c=document.getElementById('msgs');const d=document.createElement('div');d.className='bubble '+r;d.textContent=t;c.appendChild(d);c.scrollTop=9999;return d;}
// VOIX
function initVoice(){
  if(!('webkitSpeechRecognition'in window||'SpeechRecognition'in window)){return;}
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  recog=new SR();recog.lang='fr-FR';recog.continuous=false;recog.interimResults=true;
  recog.onresult=e=>{
    const t=Array.from(e.results).map(r=>r[0].transcript).join('');
    const tr=document.getElementById('ia-transcript');
    if(tr)tr.textContent=t;
    if(e.results[0].isFinal){
      closeVoice();
      const msgs=document.getElementById('map-chat-msgs');
      if(msgs){
        const d=document.createElement('div');d.className='bubble user';d.textContent=t;
        msgs.appendChild(d);msgs.scrollTop=9999;
        document.getElementById('map-chat').style.display='block';
      }
      const resp=localResp(t);
      setTimeout(()=>{
        if(msgs){const r=document.createElement('div');r.className='bubble ai';r.textContent=resp;msgs.appendChild(r);msgs.scrollTop=9999;}
        speak(resp.replace(/[^a-zA-Z\u00C0-\u017E0-9 ,.'-]/g,'').slice(0,120));
      },300);
      for(const kb of IA_KB){if(kb.k.some(k=>t.toLowerCase().includes(k))&&kb.fn){setTimeout(kb.fn,500);break;}}
    }
  };
  recog.onerror=()=>{closeVoiceUI();};
  recog.onend=()=>{voiceOn=false;closeVoiceUI();wwRestartT=setTimeout(listenWW,800);};
  listenWW();
}

// Écoute continue du mot d'activation "Hey Kimatey / Kimi" — auto-réparante,
// pensée pour le mode conduite (mains libres, sans jamais toucher l'écran).
let wwEnabled=true;   // passe à false uniquement si le micro est refusé
let wwRestartT=null;
function listenWW(){
  if(!('webkitSpeechRecognition'in window||'SpeechRecognition'in window))return;
  if(!wwEnabled||voiceOn)return; // on n'écoute pas le wake-word pendant une commande active
  clearTimeout(wwRestartT);
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  const wr=new SR();wr.lang='fr-FR';wr.continuous=true;wr.interimResults=false;
  wr.onresult=e=>{
    const t=e.results[e.results.length-1][0].transcript.toLowerCase();
    if(t.includes('kimatey')||t.includes('kimi')||t.includes('terra flow')){
      try{wr.stop();}catch(err){}
      openVoice();
    }
  };
  wr.onerror=e=>{
    // Permission refusée : on arrête d'essayer pour ne pas spammer le navigateur
    if(e.error==='not-allowed'||e.error==='service-not-allowed'){wwEnabled=false;setWWIndicator(false);}
  };
  // Le navigateur coupe parfois la reconnaissance continue au bout de quelques dizaines
  // de secondes sans que ce soit une erreur : on la relance systématiquement ici.
  wr.onend=()=>{
    setWWIndicator(false);
    if(wwEnabled&&!voiceOn)wwRestartT=setTimeout(listenWW,700);
  };
  try{wr.start();setWWIndicator(true);}catch(e){wwRestartT=setTimeout(listenWW,2000);}
}

// Petit voyant discret sur la bulle Kimi pour indiquer que l'écoute
// "Hey Kimatey" est active en arrière-plan (utile en conduite, sans les mains).
function setWWIndicator(on){
  const fab=document.getElementById('kimi-fab');
  if(fab)fab.classList.toggle('kimi-ww-on',on);
}

function openVoice(){
  voiceOn=true;
  const pill=document.getElementById('ia-listening');
  if(pill)pill.style.display='flex';
  const tr=document.getElementById('ia-transcript');
  if(tr)tr.textContent='';
  const btn=document.getElementById('fab-voice');
  if(btn){btn.style.background='var(--amber-500)';btn.querySelector('i').style.color='#221200';}
  const fab=document.getElementById('kimi-fab');
  if(fab){fab.classList.remove('kimi-ww-on');fab.classList.add('kimi-active-listen');}
  if(recog){try{recog.abort();setTimeout(()=>recog.start(),100);}catch(e){}}
  speak("Je t'ecoute");
}

function closeVoice(){
  if(recog){try{recog.stop();}catch(e){}}
  voiceOn=false;closeVoiceUI();
  // Reprendre l'écoute du mot d'activation dès que la commande vocale est terminée
  wwRestartT=setTimeout(listenWW,800);
}

function closeVoiceUI(){
  const pill=document.getElementById('ia-listening');
  if(pill)pill.style.display='none';
  const btn=document.getElementById('fab-voice');
  if(btn){btn.style.background='#fff';const ic=btn.querySelector('i');if(ic)ic.style.color='var(--teal-700)';}
  const fab=document.getElementById('kimi-fab');
  if(fab)fab.classList.remove('kimi-active-listen');
}

function speak(t){
  if(!window.speechSynthesis)return;
  window.speechSynthesis.cancel();
  const u=new SpeechSynthesisUtterance(t);
  u.lang='fr-FR';u.rate=0.88;u.pitch=1.0;
  window.speechSynthesis.speak(u);
}
// ACCÉLÉRO
function initAccel(){
  if(!window.DeviceMotionEvent)return;
  window.addEventListener('devicemotion',e=>{const a=e.accelerationIncludingGravity;if(!a)return;if(Math.sqrt(a.x**2+a.y**2+a.z**2)>25){doSignal('pothole','fa-road-circle-exclamation','Nid-de-poule (auto-détecté)');speak('Nid-de-poule détecté automatiquement. Signalement envoyé.');}});
}
// ÉCO + CITOYEN-PASS
function calcEco(){
  const kmG=Math.max(gbKm,2.4);
  const co2Evi=Math.max(0,(kmG+5)*0.192-kmG*0.028).toFixed(1);
  const traj=Math.max(1,Math.round(kmG/4));
  const pct=Math.min(100,(parseFloat(co2Evi)/10)*100);
  document.getElementById('eco-co2').textContent=co2Evi;
  document.getElementById('eco-traj').textContent=traj;
  document.getElementById('eco-bar').style.width=pct+'%';
  document.getElementById('eco-vs').textContent=parseFloat(co2Evi)>0?`🌍 ${co2Evi} kg CO₂ évités vs voiture individuelle`:'🚌 Prends le gbaka pour générer ton éco-score';
  const pG=traj*10,pS=totalSig*25,pSc=drScore>=80?5:0,pK=Math.floor(kcmH)*2,pE=Math.floor(parseFloat(co2Evi));
  const tot=pG+pS+pSc+pK+pE;
  document.getElementById('cp-pts').textContent=tot;
  document.getElementById('cp-gb').textContent='+'+pG+' pts';
  document.getElementById('cp-sg').textContent='+'+pS+' pts';
  document.getElementById('cp-sc').textContent='+'+pSc+' pts/j';
  document.getElementById('cp-kc').textContent='+'+pK+' pts';
  [{id:'d-ea',s:300},{id:'d-tr',s:500},{id:'d-fo',s:750}].forEach(d=>{
    const el=document.getElementById(d.id);if(!el)return;
    el.textContent=tot>=d.s?'✅ Disponible':'🔒 encore '+(d.s-tot)+' pts';
    el.style.color=tot>=d.s?'var(--success)':'rgba(255,255,255,.35)';
  });
  walPts=Math.max(walPts,tot+4350);
  if(dcCurrentTab==='dashboard'||dcCurrentTab==='energie')updateDashboardCitoyen();
  document.getElementById('w-bal').textContent=walPts.toLocaleString('fr-FR')+' pts';
  document.getElementById('vie-sub').textContent=Math.round(walPts*.1)+' pts contribués ce mois';
}
// SOS
function triggerSOS(){toast('🆘 SOS envoyé · Secours prévenus');speak('SOS déclenché. Les secours sont prévenus.');if(peerId)dbWrite(`${CH}/sos/${peerId}`,{ts:Date.now()});}
// SETTINGS
function toggleSet(k){const el=document.getElementById('t-'+k);if(!el)return;el.classList.toggle('on');const on=el.classList.contains('on');if(k==='voice')toast(on?'🎙️ Hey Kimatey activé':'Voix désactivée');if(k==='offline')toast(on?'🗺️ Cartes offline prêtes (48 MB)':'Mode en ligne uniquement');if(k==='kcm')toast(on?'📡 Nœud KCM actif':'KCM désactivé');}
// UTILS
let toastT;
function toast(m){const el=document.getElementById('toast-el');el.textContent=m;el.classList.add('show');clearTimeout(toastT);toastT=setTimeout(()=>el.classList.remove('show'),3000);}
function openOv(id){document.getElementById(id).classList.add('open');}
function closeOv(id){document.getElementById(id).classList.remove('open');}


// ── LOGIN TABS ────────────────────────────────────────────────
function togglePass(){
  const p=document.getElementById('pass-inp');
  if(p)p.type=p.type==='password'?'text':'password';
}
async function authWithEmailPassword(email,pwd,name,tel){
  try{
    await fbAuth.signInWithEmailAndPassword(email,pwd);
    toast('Bienvenue !');
    finishAuth();
  }catch(err){
    if(err.code==='auth/user-not-found'||err.code==='auth/invalid-credential'||err.code==='auth/invalid-login-credentials'){
      try{
        const cred=await fbAuth.createUserWithEmailAndPassword(email,pwd);
        if(name)try{await cred.user.updateProfile({displayName:name});}catch(e){}
        // Profil étendu (téléphone, etc.) sur Realtime Database
        db.ref(`users/${cred.user.uid}/profile`).set({name:name||'',tel:tel||'',email,createdAt:Date.now()});
        toast('Compte créé ! Bienvenue '+(name||'')+' 🎉');
        finishAuth();
      }catch(err2){console.error('[Kimatey Auth] createUserWithEmailAndPassword a échoué:',err2.code,err2.message);toast(authErrorToFr(err2.code));}
    }else{
      console.error('[Kimatey Auth] signInWithEmailAndPassword a échoué:',err.code,err.message);
      toast(authErrorToFr(err.code));
    }
  }
}
function authErrorToFr(code){
  const map={
    'auth/wrong-password':'Mot de passe incorrect',
    'auth/weak-password':'Mot de passe trop faible (6 caractères min.)',
    'auth/email-already-in-use':'Ce compte existe déjà — vérifie ton mot de passe',
    'auth/popup-closed-by-user':'Connexion Google annulée',
    'auth/popup-blocked':'Popup Google bloquée par le navigateur — autorise les popups',
    'auth/network-request-failed':'Pas de connexion internet',
    'auth/invalid-email':'Email invalide',
    'auth/unauthorized-domain':'⚠️ Ce domaine n\'est pas autorisé dans Firebase (Authentication → Settings → Authorized domains)',
    'auth/operation-not-allowed':'⚠️ Cette méthode de connexion est désactivée côté Firebase (Authentication → Sign-in method)'
  };
  return map[code]||('Erreur de connexion ('+(code||'inconnue')+') — réessaie');
}
async function finishAuth(){
  const user=fbAuth.currentUser;
  if(!user)return;
  // Récupère le profil étendu (prénom/téléphone) depuis Realtime DB
  let profile={};
  try{
    const snap=await db.ref(`users/${user.uid}/profile`).once('value');
    profile=snap.val()||{};
  }catch(e){}
  currentUser={name:user.displayName||profile.name||'Conducteur',email:user.email||'',tel:profile.tel||''};
  localStorage.setItem('kfn_session',JSON.stringify(currentUser)); // cache local pour affichage instantané
  await loadTripHistoryFromFirebase();
  gotoApp();
}
function loginEmail(){
  const e=document.getElementById('email-inp')?.value.trim();
  const p=document.getElementById('pass-inp')?.value;
  if(!e||!p){toast('Remplis email et mot de passe');return;}
  if(!e.includes('@')){toast('Email invalide');return;}
  if(p.length<6){toast('Mot de passe trop court (min 6 car.)');return;}
  authWithEmailPassword(e,p,null,null);
}
function createAccount(){
  const name=document.getElementById('name-inp')?.value.trim();
  const tel=document.getElementById('tel-create-inp')?.value.trim();
  const email=document.getElementById('email-create-inp')?.value.trim();
  const pass=document.getElementById('pass-create-inp')?.value;
  if(!name){toast('Ton prénom est requis');return;}
  if(!tel||tel.length<8){toast('Numéro de téléphone invalide');return;}
  if(!pass||pass.length<6){toast('Mot de passe requis (min 6 car.)');return;}
  const finalEmail=email||('225'+tel.replace(/\s/g,'')+'@kimateyflow.local');
  authWithEmailPassword(finalEmail,pass,name,tel);
}
function doPhoneAuth(){
  const fn=document.getElementById('tel-fn-inp')?.value.trim();
  const ph=document.getElementById('ph-inp')?.value.trim().replace(/\s/g,'');
  const pwd=document.getElementById('tel-pass-inp')?.value;
  if(!fn){toast('Entre ton prénom');return;}
  if(!ph||ph.length<8){toast('Numéro de téléphone invalide');return;}
  if(!pwd||pwd.length<6){toast('Mot de passe requis (min 6 car.)');return;}
  const syntheticEmail='225'+ph+'@kimateyflow.local';
  authWithEmailPassword(syntheticEmail,pwd,fn,'+225 '+ph);
}
async function loginGoogle(){
  try{
    const provider=new firebase.auth.GoogleAuthProvider();
    await fbAuth.signInWithPopup(provider);
    finishAuth();
  }catch(err){
    console.error('[Kimatey Auth] signInWithPopup (Google) a échoué:',err.code,err.message);
    toast(authErrorToFr(err.code));
  }
}
// currentUser déclaré en tête de script

// ── HISTORIQUE TRAJETS ────────────────────────────────────────
// Synchronisé sur Firebase (users/{uid}/trips) si connecté, sinon localStorage seul (invité)
let tripHistory = JSON.parse(localStorage.getItem('kfn_history')||'[]');

function saveTripToHistory(name,lat,lng,dist,dur){
  const trip={name,lat,lng,dist,dur,ts:Date.now(),date:new Date().toLocaleDateString('fr-CI')};
  tripHistory.unshift(trip);
  if(tripHistory.length>20)tripHistory=tripHistory.slice(0,20);
  localStorage.setItem('kfn_history',JSON.stringify(tripHistory)); // cache local instantané
  const user=fbAuth.currentUser;
  if(user){
    dbWrite(`users/${user.uid}/trips`,trip,true); // sync multi-appareils, avec repli offline
  }
}
async function loadTripHistoryFromFirebase(){
  const user=fbAuth.currentUser;
  if(!user)return;
  try{
    const snap=await db.ref(`users/${user.uid}/trips`).orderByChild('ts').limitToLast(20).once('value');
    const data=snap.val();
    if(data){
      tripHistory=Object.values(data).sort((a,b)=>b.ts-a.ts);
      localStorage.setItem('kfn_history',JSON.stringify(tripHistory));
    }
  }catch(e){console.log('Historique Firebase indisponible, cache local utilisé',e);}
}

function renderHistory(){
  // Remplir les deux endroits : search-overlay + modal
  const list=document.getElementById('history-list');
  const section=document.getElementById('history-section');
  const modalList=document.getElementById('history-list-modal');
  if(modalList&&tripHistory.length>0){
    modalList.innerHTML=tripHistory.map(t=>`
      <div class="search-dest" onclick="navTo('${t.name.replace(/'/g,"\'")}',${t.lat},${t.lng});closeOv('ov-history')">
        <div style="width:36px;height:36px;background:var(--mint-100);border-radius:10px;display:flex;align-items:center;justify-content:center">
          <i class="fa-solid fa-clock-rotate-left" style="color:var(--teal-700)"></i></div>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600">${t.name}</div>
          <div style="font-size:11px;color:var(--ink-400)">${t.date} · ${t.dist||'?'} km · ${t.dur||'?'} min</div>
        </div>
        <i class="fa-solid fa-arrow-up-right-from-square" style="color:var(--ink-300);font-size:12px"></i>
      </div>`).join('');
  }
  if(!list||!section)return;
  if(tripHistory.length===0){section.style.display='none';return;}
  section.style.display='block';
  list.innerHTML=tripHistory.slice(0,5).map(t=>`
    <div class="search-dest" onclick="navTo('${t.name}',${t.lat},${t.lng})">
      <div style="width:36px;height:36px;background:var(--cloud-50);border-radius:10px;display:flex;align-items:center;justify-content:center">
        <i class="fa-solid fa-clock-rotate-left" style="color:var(--ink-400)"></i>
      </div>
      <div style="flex:1">
        <div style="font-size:14px;font-weight:600">${t.name}</div>
        <div style="font-size:11px;color:var(--ink-400)">${t.date} · ${t.dist||'?'} km · ${t.dur||'?'} min</div>
      </div>
      <i class="fa-solid fa-arrow-up-right-from-square" style="color:var(--ink-300);font-size:12px"></i>
    </div>`).join('');
}

// ── RECHERCHE NOMINATIM ───────────────────────────────────────
let searchTimer = null;

function showQuick(show){
  const q=document.getElementById('quick-dests');
  const r=document.getElementById('search-results');
  if(q)q.style.display=show?'block':'none';
  if(r)r.style.display=show?'none':'block';
}

async function searchPlaces(query){
  if(!query||query.length<3){showQuick(true);return;}
  showQuick(false);
  clearTimeout(searchTimer);
  const results=document.getElementById('search-results');
  if(results)results.innerHTML='<div style="padding:20px;text-align:center;color:var(--ink-400)"><i class="fa-solid fa-spinner fa-spin"></i> Recherche...</div>';
  searchTimer=setTimeout(async()=>{
    try{
      const url=`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query+' Abidjan Côte d\'Ivoire')}&format=json&limit=6&countrycodes=ci&addressdetails=1`;
      const r=await fetch(url,{headers:{'Accept-Language':'fr','User-Agent':'KimateyFlowNavigator/1.0'}});
      const data=await r.json();
      if(!data.length){
        if(results)results.innerHTML='<div style="padding:20px;text-align:center;color:var(--ink-400)">Aucun résultat — essaie un autre terme</div>';
        return;
      }
      if(results)results.innerHTML=data.map(p=>{
        const name=p.display_name.split(',').slice(0,2).join(', ');
        const addr=p.address?.suburb||p.address?.city_district||p.address?.city||'Abidjan';
        return `<div class="search-dest" onclick="navTo('${name.replace(/'/g,"\'")}',${p.lat},${p.lon})">
          <div style="width:36px;height:36px;background:var(--mint-100);border-radius:10px;display:flex;align-items:center;justify-content:center"><i class="fa-solid fa-location-dot" style="color:var(--teal-700)"></i></div>
          <div><div style="font-size:13px;font-weight:600">${name}</div><div style="font-size:11px;color:var(--ink-400)">${addr}</div></div>
        </div>`;
      }).join('');
    }catch(e){
      if(results)results.innerHTML='<div style="padding:20px;text-align:center;color:var(--ink-400)">Erreur réseau — utilise les destinations rapides</div>';
    }
  },600);
}

// ── NAVIGATION VERS DESTINATION ───────────────────────────────
async function navTo(name,lat,lng){
  closeSearch();
  goPage('carte');
  if(!lastLat){toast('📍 GPS requis pour naviguer');requestGPS();return;}
  toast('📡 Calcul itinéraire vers '+name+'...');
  const mode=curMode==='pieton'||curMode==='course'?'foot':'driving';
  try{
    const url=`https://router.project-osrm.org/route/v1/${mode}/${lastLng},${lastLat};${lng},${lat}?overview=full&geometries=geojson&steps=true`;
    const r=await fetch(url);
    const data=await r.json();
    if(!data.routes?.[0])throw new Error('no route');
    const route=data.routes[0];
    const coords=route.geometry.coordinates.map(c=>[c[1],c[0]]);
    navSteps=route.legs[0].steps||[];navStepIdx=0;
    if(navLine)map.removeLayer(navLine);
    navLine=L.polyline(coords,{color:'#FF9130',weight:6,opacity:.9}).addTo(map);
    // Marqueur destination
    L.marker([lat,lng],{icon:L.divIcon({html:'<div style="background:#E94F37;color:#fff;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:16px;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3)">📍</div>',iconSize:[32,32],iconAnchor:[16,32],className:''})}).addTo(map).bindPopup(name);
    map.fitBounds(navLine.getBounds(),{padding:[80,80]});
    navActive=true;navStartTs=Date.now();navDestName=name;navDestLat=lat;navDestLng=lng;
    userStats.navLaunched=(userStats.navLaunched||0)+1;saveUserStats();checkBadges();
    totalDist=0;totalCal=0;totalCO2=0;
    const durMin=Math.round(route.duration/60);
    const distKm=(route.distance/1000).toFixed(1);
    document.getElementById('r-via').textContent='Vers '+name;
    document.getElementById('r-time').innerHTML=`${durMin} min · ${distKm} km · <span style="color:var(--success)">Fluide</span>`;
    showNavBar();
    toast('🚦 Navigation vers '+name+' · '+durMin+' min · '+distKm+' km');
    speak('Navigation vers '+name+'. '+durMin+' minutes, '+distKm+' kilomètres. C\'est parti !');
    // Sauvegarder en historique
    saveTripToHistory(name,lat,lng,distKm,durMin);
  }catch(e){
    toast('Mode offline — GPS insuffisant pour calculer la route');
    speak('Impossible de calculer. Vérifie ta connexion.');
  }
}

// Variables destination courante
let navDestName='',navDestLat=0,navDestLng=0;

// ── RECALCUL SI HORS ROUTE ────────────────────────────────────
let offRouteCount=0;
function checkOffRoute(la,lo){
  if(!navLine||!navActive||!navDestLat)return;
  // Calculer distance à la ligne de route
  const bounds=navLine.getBounds();
  const nearRoute=bounds.pad(0.002).contains([la,lo]);
  if(!nearRoute){
    offRouteCount++;
    if(offRouteCount>=3){
      offRouteCount=0;
      toast('🔄 Hors itinéraire — recalcul en cours...');
      speak('Recalcul en cours.');
      navTo(navDestName,navDestLat,navDestLng);
    }
  } else offRouteCount=0;
}

// ── SWITCH TABS LOGIN ─────────────────────────────────────────
function switchTab(tab){
  ['tel','email','create'].forEach(t=>{
    const panel=document.getElementById('panel-'+t);
    const btn=document.getElementById('tab-'+t);
    if(panel)panel.style.display=t===tab?'block':'none';
    if(btn)btn.classList.toggle('active',t===tab);
  });
}

// ── LOGOUT ────────────────────────────────────────────────────
function doLogout(){
  if(!confirm('Voulez-vous vraiment vous déconnecter ?'))return;
  try{ if(fbAuth.currentUser) fbAuth.signOut(); }catch(e){}
  localStorage.removeItem('kfn_session');
  currentUser=null;
  show('s-login');
  toast('👋 Déconnecté');
}

// ── HISTORIQUE TRAJETS OVERLAY ────────────────────────────────
function openTripHistory(){
  renderHistory();
  const ov=document.getElementById('ov-history');
  if(ov)ov.classList.add('open');
}

// ── CHAT KIMI — BULLE FLOTTANTE ───────────────────────────────
let kimiOpen=false;
const KIMI_SVG_ICON='<svg width="28" height="28" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13 3.5 L18 13 L13 22.5 L8 13 Z" fill="var(--amber-500)"/><circle cx="13" cy="13" r="2.6" fill="#0F3D3E"/></svg>';
function toggleKimi(){
  kimiOpen=!kimiOpen;
  // Effacer le badge de notification
  const nb=document.getElementById('kimi-notif');
  if(nb)nb.style.display='none';
  const chat=document.getElementById('kimi-chat');
  const icon=document.getElementById('kimi-fab-icon');
  if(chat)chat.style.display=kimiOpen?'flex':'none';
  if(icon){
    icon.innerHTML=kimiOpen
      ?'<i class="fa-solid fa-xmark" style="font-size:20px;color:#fff"></i>'
      :KIMI_SVG_ICON;
  }
  if(kimiOpen){
    const inp=document.getElementById('kimi-inp');
    if(inp)inp.focus();
    // Message d'accueil si vide
    const msgs=document.getElementById('kimi-msgs');
    if(msgs&&msgs.children.length===0){
      addKimiMsg('Bonjour ! Je suis Kimi, votre assistant mobilité Abidjan 🚦 Comment puis-je vous aider ?','ai');
    }
  }
}

function addKimiMsg(text,role){
  const msgs=document.getElementById('kimi-msgs');
  if(!msgs)return;
  const d=document.createElement('div');
  d.style.cssText=`max-width:85%;padding:9px 12px;border-radius:14px;font-size:12px;line-height:1.5;margin-bottom:6px;align-self:${role==='user'?'flex-end':'flex-start'};background:${role==='user'?'var(--teal-800)':'#f0f4f2'};color:${role==='user'?'#fff':'var(--ink-900)'};${role==='user'?'border-bottom-right-radius:3px':'border-bottom-left-radius:3px'}`;
  d.textContent=text;
  msgs.appendChild(d);
  msgs.scrollTop=9999;
  return d;
}

// (kimiSend est défini plus bas — version unique, branchée sur Gemini)

// ── ALERTES PRÉDICTIVES TEMPS RÉEL ───────────────────────────
let alertsStarted=false;
function startRealTimeAlerts(){
  if(alertsStarted)return;
  alertsStarted=true;
  // Écouter les incidents Firebase
  db.ref(`${CH}/incidents`).on('child_added',snap=>{
    const d=snap.val();if(!d)return;
    const age=(Date.now()-(d.ts||0))/60000;
    if(age<5){ // Alerte si moins de 5 min
      showPredictAlert(d.title||'Incident signalé',d.severity||'Modéré',d.type||'warning');
    }
  });
  // Alertes prédictives toutes les 3 min basées sur l'heure
  setInterval(()=>{
    const h=new Date().getHours();
    if((h>=7&&h<10)||(h>=17&&h<20)){
      const zones=['Adjamé','Plateau','Yopougon','Marcory'];
      const z=zones[Math.floor(Math.random()*zones.length)];
      showPredictAlert(`Congestion prévue — ${z} dans 10 min`,'Prudence','traffic');
    }
  },180000);
}

function showPredictAlert(title,severity,type){
  // Notification système
  sendNotif('⚠️ '+title, severity+' · Kimatey Flow Navigator', '⚠️');
  // Badge notif sur Kimi
  const nb=document.getElementById('kimi-notif');
  if(nb&&!kimiOpen){nb.style.display='flex';}
  // Badge notif sur l'onglet Alertes (barre du bas)
  if(document.getElementById('p-alertes')&&!document.getElementById('p-alertes').classList.contains('active')){bumpAlertBadge();}
  const icons={accident:'🚗',traffic:'🚦',inondation:'🌊',warning:'⚠️',travaux:'🚧'};
  const colors={Critique:'var(--coral-500)',Modéré:'var(--amber-500)',Prudence:'var(--teal-600)'};
  // Toast spécial alerte
  const el=document.getElementById('toast-el');
  if(el){
    el.style.background=colors[severity]||'var(--ink-900)';
    el.textContent=(icons[type]||'⚠️')+' '+title;
    el.classList.add('show');
    clearTimeout(window._alertT);
    window._alertT=setTimeout(()=>{el.classList.remove('show');el.style.background='';},5000);
  }
  // Ajouter au chat Kimi si ouvert
  if(kimiOpen){addKimiMsg('🚨 Alerte : '+title,'ai');}
  // Ajouter aux incidents
  incidents.unshift({type,title,meta:'Prédiction IA · À l\'instant',severity});
  renderIncidents();
  updateKpiInc();
}

// ── BRANCHER checkOffRoute dans onGPSUpdate ───────────────────
// (appelé depuis onGPSUpdate existant)
function checkNavDeviation(la,lo){
  if(!navActive||!navDestLat)return;
  checkOffRoute(la,lo);
}

// ── SESSION AUTO-LOGIN ────────────────────────────────────────
function checkSession(){
  // Source de vérité : Firebase Auth (vraie session persistante et sécurisée)
  if(fbAuth.currentUser){
    finishAuth();
    return true;
  }
  // Repli : cache local (mode invité, ou Firebase pas encore restauré)
  const sess=localStorage.getItem('kfn_session');
  if(sess){
    try{
      currentUser=JSON.parse(sess);
      gotoApp();
      return true;
    }catch(e){}
  }
  return false;
}



// ── DASHBOARD CITOYEN ─────────────────────────────────────────
dcCurrentTab = 'dashboard';

function dcTab(tab){
  dcCurrentTab = tab;
  ['dashboard','trajets','energie','securite','settings'].forEach(t=>{
    const panel = document.getElementById('dcp-'+t);
    const btn = document.getElementById('dct-'+t);
    if(panel) panel.style.display = t===tab ? 'block' : 'none';
    if(btn) btn.classList.toggle('active', t===tab);
  });
  if(tab==='energie') updateEnergiePanel();
  if(tab==='trajets') updateTrajetsPanel();
}

function updateDashboardCitoyen(){
  // ID citoyen unique
  const userId = currentUser?.tel || currentUser?.email || 'DEMO';
  const hash = userId.replace(/[^0-9a-zA-Z]/g,'').slice(0,8).toUpperCase().padEnd(8,'0');
  const cidId = 'KFN-'+hash+'-CP'+Math.floor(Math.random()*9000+1000);
  const el = document.getElementById('cid-id');
  if(el && !el.textContent.includes('KFN-0')) {} else if(el) el.textContent = cidId;
  
  // Signature
  const sig = document.getElementById('cid-sig');
  if(sig) sig.textContent = 'SIG-'+hash+'-KFN · DRIF 2026';

  // Avatar et username
  const name = currentUser?.name || 'Citoyen KFN';
  const initials = name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  const avEl = document.getElementById('dc-av');
  if(avEl) avEl.textContent = initials;
  const unEl = document.getElementById('dc-username');
  if(unEl) unEl.textContent = name.split(' ')[0];

  // Mode badge
  const modeBadges = {voiture:'🚗 Mode Auto actif',moto:'🏍️ Mode Moto actif',pieton:'🚶 Mode Piéton actif',gbaka:'🚌 Mode Gbaka actif'};
  const mb = document.getElementById('mode-badge-display');
  if(mb) mb.textContent = modeBadges[curMode]||'🚗 Mode Auto actif';

  // KimaPoints cercle
  const pts = parseInt(document.getElementById('cp-pts')?.textContent||'0');
  const ptsEl = document.getElementById('cid-kpts');
  if(ptsEl) ptsEl.textContent = pts;
  // Arc progress (213.6 = circonférence pour r=34)
  const arc = document.getElementById('cid-progress');
  if(arc){
    const max = 1000;
    const offset = 213.6 - (213.6 * Math.min(pts,max) / max);
    arc.setAttribute('stroke-dashoffset', offset.toFixed(1));
  }

  // Stats
  const sigEl = document.getElementById('cid-signals');
  if(sigEl) sigEl.textContent = totalSig;
  const kcmEl = document.getElementById('cid-kcm');
  if(kcmEl) kcmEl.textContent = Math.floor(kcmH)+'h';
  const co2El = document.getElementById('cid-co2');
  if(co2El) co2El.textContent = totalCO2.toFixed(2)+' kg';
  const scoreEl = document.getElementById('cid-score');
  if(scoreEl) scoreEl.textContent = drScore;

  // Score arc sécurité
  const scoreArc = document.getElementById('score-arc');
  if(scoreArc){
    const off = 364.4 - (364.4 * drScore / 100);
    scoreArc.setAttribute('stroke-dashoffset', off.toFixed(1));
  }
  const scoreArcVal = document.getElementById('score-arc-val');
  if(scoreArcVal) scoreArcVal.textContent = drScore;

  // Rang
  const ranks = [{min:0,label:'🌱 Explorateur'},{min:100,label:'🚶 Marcheur'},{min:300,label:'🚌 Citoyen'},{min:600,label:'⭐ Ambassadeur'},{min:1000,label:'🏆 Champion'}];
  const rank = [...ranks].reverse().find(r=>pts>=r.min)||ranks[0];
  const rankEl = document.getElementById('cid-rank');
  if(rankEl) rankEl.textContent = rank.label;

  // KPI trajets
  const hist = JSON.parse(localStorage.getItem('kfn_history')||'[]');
  const trEl = document.getElementById('kpi-trips');
  if(trEl) trEl.textContent = hist.length;
  const kmEl = document.getElementById('kpi-km-user');
  if(kmEl){
    const tot = hist.reduce((a,t)=>a+(parseFloat(t.dist)||0),0);
    kmEl.textContent = tot.toFixed(1)+' km parcourus';
  }
  const tEl = document.getElementById('kpi-time-saved');
  if(tEl) tEl.textContent = (hist.length*6||0)+' min';

  // CITOYEN-PASS droits mini
  const droits = [{id:'cp-d-eau',seuil:300},{id:'cp-d-tr',seuil:500},{id:'cp-d-fo',seuil:750}];
  droits.forEach(d=>{
    const el = document.getElementById(d.id);
    if(el){
      el.textContent = pts>=d.seuil ? '✅ Disponible' : d.seuil+' pts';
      el.style.color = pts>=d.seuil ? 'var(--success)' : 'rgba(255,255,255,.35)';
    }
  });

  // VIE Foundation
  const vieEl = document.getElementById('vie-sub');
  if(vieEl) vieEl.textContent = Math.round(pts*0.1)+' pts contribués ce mois';
}

function updateTrajetsPanel(){
  const hist = JSON.parse(localStorage.getItem('kfn_history')||'[]');
  const el = document.getElementById('dc-history-list');
  const cnt = document.getElementById('trips-count');
  if(cnt) cnt.textContent = '('+hist.length+' trajet'+(hist.length>1?'s':'')+')';
  if(!el) return;
  if(!hist.length){
    el.innerHTML = '<div style="text-align:center;color:var(--ink-400);padding:20px;font-size:12px">Aucun trajet enregistré<br><span style="font-size:10px">Lance une navigation pour commencer</span></div>';
    return;
  }
  const modeIco = {voiture:'🚗',moto:'🏍️',pieton:'🚶',gbaka:'🚌'};
  const modeColors = {voiture:'var(--amber-100)',moto:'#FCE7E3',pieton:'var(--mint-100)',gbaka:'var(--mint-100)'};
  el.innerHTML = hist.map(t=>`
    <div class="hist-row" onclick="navTo('${(t.name||'').replace(/'/g,"\'")}',${t.lat||5.345},${t.lng||-4.024})">
      <div class="hist-ico" style="background:${modeColors[t.mode]||'var(--cloud-50)'}">
        ${modeIco[t.mode]||'📍'}
      </div>
      <div style="flex:1">
        <div class="hist-name">${t.name||'Destination'}</div>
        <div class="hist-meta">${t.date||''} · ${t.dist||'?'} km · ${t.dur||'?'} min</div>
      </div>
      <div class="hist-pts">+${Math.ceil((parseFloat(t.dist)||1)*2)} pts</div>
    </div>`).join('');
}

function updateEnergiePanel(){
  const isWalker = curMode==='pieton'||curMode==='course';
  const badge = document.getElementById('energie-mode-badge');
  const note = document.getElementById('energie-mode-note');
  const data = document.getElementById('energie-data');
  const modeBadges = {voiture:'🚗 Mode Auto',moto:'🏍️ Mode Moto',pieton:'🚶 Mode Piéton',gbaka:'🚌 Mode Gbaka'};
  if(badge) badge.textContent = modeBadges[curMode]||'🚗 Mode Auto';
  if(note){
    note.textContent = isWalker
      ? 'Compteur actif — tes données en temps réel :'
      : 'En mode '+curMode+', le compteur de calories n\'est pas pertinent. Passe en mode Piéton pour l\'activer.';
    note.style.color = isWalker ? 'var(--success)' : 'var(--ink-400)';
  }
  if(data) data.style.display = isWalker ? 'block' : 'none';
  if(isWalker){
    const calEl = document.getElementById('e-cal');
    if(calEl) calEl.textContent = Math.round(totalCal)+' kcal';
    const calBar = document.getElementById('e-cal-bar');
    if(calBar) calBar.style.width = Math.min(100,(totalCal/300)*100)+'%';
    const distEl = document.getElementById('e-dist');
    if(distEl) distEl.textContent = totalDist>1000?(totalDist/1000).toFixed(2)+' km':Math.round(totalDist)+' m';
    const distBar = document.getElementById('e-dist-bar');
    if(distBar) distBar.style.width = Math.min(100,(totalDist/7000)*100)+'%';
    const spdEl = document.getElementById('e-spd');
    if(spdEl) spdEl.textContent = currentSpeed+' km/h';
    const metEl = document.getElementById('e-met');
    if(metEl) metEl.textContent = 'MET '+(currentSpeed>8?'10.0':'3.5');
    const co2El = document.getElementById('e-co2-walk');
    if(co2El) co2El.textContent = Math.round(totalDist/1000*192)+' g';
  }
}

function copyId(){
  const el = document.getElementById('cid-id');
  if(el) navigator.clipboard?.writeText(el.textContent).then(()=>toast('ID copié !')).catch(()=>toast(el.textContent));
  else toast('ID non disponible');
}



// ══════════════════════════════════════════════════════════════
// MODULE ÉDUCATIF & LUDIQUE — Kimi Savoir + Badges + Missions
// ══════════════════════════════════════════════════════════════

// ── SAVOIRS DU JOUR ───────────────────────────────────────────
const SAVOIRS = [
  // SÉCURITÉ ROUTIÈRE
  {cat:'🚦 Sécurité routière', ico:'🚦',
   titre:'La distance de sécurité',
   texte:'En ville à 50 km/h, il faut 28 mètres pour s\'arrêter. Garde toujours 2 secondes de distance avec le véhicule devant toi.',
   quiz:{q:'Quelle distance minimale à 50 km/h ?',r:['14 m','28 m','50 m'],correct:1},
   pts:15, odb:'ODD 3 · Bonne santé'},
  {cat:'🚦 Sécurité routière', ico:'🏍️',
   titre:'Les motos et angles morts',
   texte:'40% des accidents à Abidjan impliquent des motos. Vérifie toujours tes rétroviseurs avant de changer de voie.',
   quiz:{q:'Quel % d\'accidents implique les motos à Abidjan ?',r:['20%','40%','60%'],correct:1},
   pts:15, odb:'ODD 3 · Sécurité'},
  {cat:'🚦 Sécurité routière', ico:'📱',
   titre:'Téléphone au volant',
   texte:'Conduire en téléphonant multiplie le risque d\'accident par 4. Hey Kimatey est là pour que tu n\'aies pas à toucher ton écran.',
   quiz:{q:'Téléphoner au volant multiplie le risque par ?',r:['2','4','6'],correct:1},
   pts:20, odb:'ODD 3 · Sécurité'},
  // CIVISME
  {cat:'🏙️ Civisme & mobilité', ico:'🚌',
   titre:'Le gbaka : héros méconnu',
   texte:'Un gbaka transporte en moyenne 20 personnes là où 20 voitures prendraient la même route. Prendre le collectif réduit les bouchons de 60%.',
   quiz:{q:'Un gbaka remplace combien de voitures individuelles ?',r:['5','20','50'],correct:1},
   pts:10, odb:'ODD 11 · Villes durables'},
  {cat:'🏙️ Civisme & mobilité', ico:'📍',
   titre:'Signaler un nid-de-poule',
   texte:'Un nid-de-poule non signalé peut provoquer un accident. Chaque signalement dans le réseau KCM protège des milliers de conducteurs.',
   quiz:{q:'Que fais-tu si tu vois un nid-de-poule ?',r:['Je l\'ignore','Je le signale','J\'attends'],correct:1},
   pts:25, odb:'ODD 11 · Infrastructure'},
  {cat:'🏙️ Civisme & mobilité', ico:'🤝',
   titre:'La priorité à droite',
   texte:'En Côte d\'Ivoire comme partout, la priorité va à droite aux intersections sans signalisation. Respecter cette règle évite 30% des accidents urbains.',
   quiz:{q:'Qui a la priorité à une intersection sans panneau ?',r:['Celui qui roule vite','Celui venant de droite','Le plus grand véhicule'],correct:1},
   pts:15, odb:'ODD 11 · Sécurité'},
  // ENVIRONNEMENT
  {cat:'🌱 Environnement', ico:'🌍',
   titre:'CO₂ et transport',
   texte:'Une voiture émet 192g de CO₂ par km. Un gbaka plein n\'émet que 28g par passager. Chaque trajet collectif compte pour le climat.',
   quiz:{q:'Le gbaka émet combien de CO₂ par passager/km ?',r:['192g','28g','100g'],correct:1},
   pts:20, odb:'ODD 13 · Action climatique'},
  {cat:'🌱 Environnement', ico:'🌧️',
   titre:'Inondations et déchets',
   texte:'70% des inondations à Abidjan sont aggravées par les déchets qui bouchent les caniveaux. Un déchet jeté = une route inondée demain.',
   quiz:{q:'Quelle % des inondations est aggravée par les déchets ?',r:['30%','70%','50%'],correct:1},
   pts:15, odb:'ODD 13 · Climat'},
  {cat:'🌱 Environnement', ico:'🚶',
   titre:'Marcher, c\'est investir',
   texte:'30 minutes de marche par jour réduit le risque de maladies cardiovasculaires de 35% ET économise du carburant. Kimatey compte tes pas.',
   quiz:{q:'La marche réduit le risque cardiovasculaire de ?',r:['10%','35%','5%'],correct:1},
   pts:10, odb:'ODD 3 · Santé'},
  // ÉDUCATION NUMÉRIQUE
  {cat:'💻 Éducation numérique', ico:'🔐',
   titre:'Protection des données',
   texte:'Tes données GPS sont anonymisées dans le réseau KCM. La loi ivoirienne n°2013-450 protège tes informations personnelles.',
   quiz:{q:'Quelle loi protège tes données en CI ?',r:['Loi 2013-450','Loi 2020-100','RGPD'],correct:0},
   pts:15, odb:'ODD 16 · Justice'},
  {cat:'💻 Éducation numérique', ico:'📡',
   titre:'Edge computing = intelligence locale',
   texte:'Kimatey Flow traite les données directement sur ton téléphone. Pas de serveur distant nécessaire — c\'est l\'edge computing africain.',
   quiz:{q:'Où le réseau KCM traite-t-il les données ?',r:['Sur un serveur aux USA','Localement sur ton téléphone','Dans le cloud'],correct:1},
   pts:20, odb:'ODD 9 · Innovation'},
];

// ── SYSTÈME DE BADGES ─────────────────────────────────────────
const BADGES_DEF = [
  {id:'first_signal', ico:'📍', name:'Premier Signalement', desc:'Tu as signalé ton premier incident', seuil:()=>totalSig>=1},
  {id:'gbaka_lover', ico:'🚌', name:'Ami du Gbaka', desc:'5 trajets en transport collectif', seuil:()=>gbKm>=20},
  {id:'eco_hero', ico:'🌱', name:'Héros Éco', desc:'1 kg de CO₂ évité', seuil:()=>totalCO2>=1},
  {id:'savoir_master', ico:'🎓', name:'Savoir Master', desc:'5 quiz réussis', seuil:()=>(userStats.quizCorrect||0)>=5},
  {id:'kcm_node', ico:'📡', name:'Nœud KCM', desc:'2h actif sur le réseau', seuil:()=>kcmH>=2},
  {id:'score_pro', ico:'⭐', name:'Conducteur Pro', desc:'Score conduite ≥ 90', seuil:()=>drScore>=90},
  {id:'mission_3', ico:'🏆', name:'Citoyen Actif', desc:'3 missions complétées', seuil:()=>(userStats.missionsCompleted||0)>=3},
  {id:'kimi_chat', ico:'🤖', name:'Ami de Kimi', desc:'10 messages avec Kimi', seuil:()=>(userStats.kimiChats||0)>=10},
  {id:'safe_driver', ico:'🛡️', name:'Conducteur Sûr', desc:'Mode Trajet Sûr activé 3 fois', seuil:()=>(userStats.safeMode||0)>=3},
  {id:'quiz_first', ico:'✨', name:'Première Question', desc:'Ton premier quiz réussi', seuil:()=>(userStats.quizCorrect||0)>=1},
  {id:'reporter', ico:'📸', name:'Reporter KCM', desc:'3 signalements validés', seuil:()=>totalSig>=3},
  {id:'explorer', ico:'🗺️', name:'Explorateur', desc:'Ton premier trajet navigué', seuil:()=>totalDist>=100},
];

// Stats utilisateur persistantes
let userStats = JSON.parse(localStorage.getItem('kfn_userstats') || '{}');

function saveUserStats() {
  localStorage.setItem('kfn_userstats', JSON.stringify(userStats));
}

function checkBadges() {
  const earned = JSON.parse(localStorage.getItem('kfn_badges') || '[]');
  let newBadge = false;
  BADGES_DEF.forEach(b => {
    if (!earned.includes(b.id) && b.seuil()) {
      earned.push(b.id);
      newBadge = true;
      // Notifier
      setTimeout(() => {
        toast('🏅 Nouveau badge : ' + b.ico + ' ' + b.name + ' !');
        speak('Félicitations ! Tu as débloqué le badge ' + b.name);
        addKimiMsg('🏅 Badge débloqué : ' + b.ico + ' **' + b.name + '** — ' + b.desc, 'ai');
        if(kimiOpen) {} else toggleKimi();
      }, 1000);
    }
  });
  if (newBadge) localStorage.setItem('kfn_badges', JSON.stringify(earned));
  return earned;
}

// ── MISSIONS DU JOUR ──────────────────────────────────────────
const MISSIONS = [
  {id:'m_signal', ico:'📍', name:'Signaler un incident', desc:'Signale 1 incident sur ta route', target:1, getter:()=>totalSig, pts:50},
  {id:'m_gbaka', ico:'🚌', name:'Prendre le collectif', desc:'1 trajet en gbaka ou SOTRA', target:1, getter:()=>Math.round(gbKm/4), pts:40},
  {id:'m_quiz', ico:'🧠', name:'Apprendre avec Kimi', desc:'Réponds à 1 quiz correctement', target:1, getter:()=>userStats.quizCorrect||0, pts:30},
  {id:'m_nav', ico:'🗺️', name:'Naviguer', desc:'Lance 1 navigation', target:1, getter:()=>userStats.navLaunched||0, pts:25},
  {id:'m_kcm', ico:'📡', name:'Activer le réseau KCM', desc:'Reste actif 30 min sur le réseau', target:1, getter:()=>kcmH>=0.5?1:0, pts:20},
];

// ── SAVOIR DU JOUR — affichage ─────────────────────────────────
let currentSavoir = null;
let quizAnswered = false;

function getSavoirDuJour() {
  const day = new Date().getDate();
  return SAVOIRS[day % SAVOIRS.length];
}

function showSavoirDuJour() {
  currentSavoir = getSavoirDuJour();
  quizAnswered = false;

  const html = `
    <div style="background:linear-gradient(135deg,#0F3D3E,#1C6B5C);border-radius:16px;padding:16px;margin-bottom:12px">
      <div style="font-size:10px;font-weight:700;color:var(--amber-500);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">${currentSavoir.cat} · ${currentSavoir.odb}</div>
      <div style="font-size:24px;margin-bottom:6px">${currentSavoir.ico}</div>
      <div style="font-size:14px;font-weight:700;color:#fff;margin-bottom:8px">${currentSavoir.titre}</div>
      <div style="font-size:12px;color:rgba(255,255,255,.8);line-height:1.6;margin-bottom:14px">${currentSavoir.texte}</div>
      <div style="font-size:12px;font-weight:700;color:var(--amber-500);margin-bottom:10px">🧠 ${currentSavoir.quiz.q}</div>
      <div id="quiz-answers" style="display:flex;flex-direction:column;gap:6px">
        ${currentSavoir.quiz.r.map((r,i) => `
          <button onclick="answerQuiz(${i})" style="background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);border-radius:10px;padding:10px 14px;color:#fff;font-size:12px;font-weight:600;cursor:pointer;text-align:left;font-family:Inter,sans-serif">
            ${['A','B','C'][i]}. ${r}
          </button>`).join('')}
      </div>
      <div id="quiz-result" style="display:none;margin-top:10px"></div>
    </div>`;

  const container = document.getElementById('edu-savoir-container');
  if (container) container.innerHTML = html;
}

function answerQuiz(idx) {
  if (quizAnswered) return;
  quizAnswered = true;
  const savoir = currentSavoir;
  const correct = idx === savoir.quiz.correct;

  // Feedback visuel sur les boutons
  const btns = document.querySelectorAll('#quiz-answers button');
  btns.forEach((btn, i) => {
    btn.disabled = true;
    if (i === savoir.quiz.correct) btn.style.background = 'rgba(46,204,113,.3)';
    else if (i === idx && !correct) btn.style.background = 'rgba(233,79,55,.3)';
  });

  // Résultat
  const resultEl = document.getElementById('quiz-result');
  if (resultEl) {
    resultEl.style.display = 'block';
    resultEl.innerHTML = correct
      ? `<div style="background:rgba(46,204,113,.2);border-radius:10px;padding:10px;font-size:12px;color:var(--success)">✅ Bonne réponse ! +${savoir.pts} KimaPoints gagnés</div>`
      : `<div style="background:rgba(233,79,55,.15);border-radius:10px;padding:10px;font-size:12px;color:#FCA5A5">❌ Pas tout à fait — la bonne réponse était : <b>${savoir.quiz.r[savoir.quiz.correct]}</b></div>`;
  }

  if (correct) {
    userStats.quizCorrect = (userStats.quizCorrect || 0) + 1;
    walPts += savoir.pts;
    updateWallet();
    saveUserStats();
    toast('🧠 +' + savoir.pts + ' KimaPoints · Bien joué !');
    speak('Bravo ! Bonne réponse. ' + savoir.pts + ' KimaPoints gagnés.');
  } else {
    speak('Pas tout à fait. La bonne réponse était : ' + savoir.quiz.r[savoir.quiz.correct]);
  }
  checkBadges();
}

// ── MISSIONS — affichage ──────────────────────────────────────
function renderMissions() {
  const el = document.getElementById('edu-missions-list');
  if (!el) return;
  el.innerHTML = MISSIONS.map(m => {
    const progress = Math.min(m.target, m.getter());
    const done = progress >= m.target;
    const pct = (progress / m.target) * 100;
    return `
      <div style="background:${done ? 'rgba(46,204,113,.08)' : '#fff'};border:1.5px solid ${done ? 'rgba(46,204,113,.3)' : 'var(--border)'};border-radius:14px;padding:12px;margin-bottom:8px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:20px">${m.ico}</span>
            <div>
              <div style="font-size:13px;font-weight:700;color:var(--ink-900)">${m.name}</div>
              <div style="font-size:10px;color:var(--ink-400)">${m.desc}</div>
            </div>
          </div>
          <div style="text-align:right">
            <div style="font-size:12px;font-weight:700;color:${done ? 'var(--success)' : 'var(--amber-500)'}">+${m.pts} pts</div>
            <div style="font-size:10px;color:var(--ink-400)">${progress}/${m.target}</div>
          </div>
        </div>
        <div style="background:var(--cloud-50);border-radius:6px;height:5px">
          <div style="background:${done ? 'var(--success)' : 'var(--amber-500)'};border-radius:6px;height:5px;width:${pct}%;transition:width .6s"></div>
        </div>
        ${done ? '<div style="font-size:10px;color:var(--success);margin-top:4px;font-weight:700">✅ Mission accomplie !</div>' : ''}
      </div>`;
  }).join('');
}

// ── BADGES — affichage ─────────────────────────────────────────
function renderBadges() {
  const el = document.getElementById('edu-badges-list');
  if (!el) return;
  const earned = JSON.parse(localStorage.getItem('kfn_badges') || '[]');
  el.innerHTML = BADGES_DEF.map(b => {
    const has = earned.includes(b.id);
    return `
      <div style="background:${has ? 'rgba(46,204,113,.08)' : 'var(--cloud-50)'};border:1.5px solid ${has ? 'rgba(46,204,113,.25)' : 'var(--border)'};border-radius:12px;padding:12px;text-align:center;opacity:${has ? '1' : '.5'}">
        <div style="font-size:24px;margin-bottom:4px">${has ? b.ico : '🔒'}</div>
        <div style="font-size:10px;font-weight:700;color:var(--ink-900)">${b.name}</div>
        <div style="font-size:9px;color:var(--ink-400);margin-top:2px">${b.desc}</div>
      </div>`;
  }).join('');
}

// ── GEMINI IA ─────────────────────────────────────────────────
async function askGemini(message) {
  try {
    const r = await fetch('/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        context: `${KCM_NODES.length} nœuds KCM, mode ${curMode}, vitesse ${currentSpeed}km/h, score ${drScore}/100, ${incidents.length} incidents`
      })
    });
    const data = await r.json();
    return data.text || localResp(message);
  } catch {
    return localResp(message);
  }
}

// Mettre à jour kimiSend pour utiliser Gemini en priorité
async function kimiSend() {
  const inp = document.getElementById('kimi-inp');
  const msg = inp?.value.trim();
  if (!msg) return;
  inp.value = '';
  addKimiMsg(msg, 'user');
  const typing = addKimiMsg('…', 'ai');

  // Stats
  userStats.kimiChats = (userStats.kimiChats || 0) + 1;
  saveUserStats();

  // Appeler fn navigation si destination détectée
  for (const kb of IA_KB) {
    if (kb.k.some(k => msg.toLowerCase().includes(k)) && kb.fn) {
      setTimeout(kb.fn, 400); break;
    }
  }

  const resp = await askGemini(msg);
  if (typing) typing.textContent = resp;
  speak(resp.replace(/[^a-zA-ZÀ-ÿ0-9 ,.!?'-]/g, '').slice(0, 120));
  checkBadges();
}

// ── INIT ÉDUCATIF ─────────────────────────────────────────────
function initEduModule() {
  showSavoirDuJour();
  renderMissions();
  renderBadges();
  // Afficher le savoir du jour dans Kimi au démarrage
  setTimeout(() => {
    const s = getSavoirDuJour();
    addKimiMsg('📚 Savoir du jour — ' + s.ico + ' **' + s.titre + '** : ' + s.texte.slice(0, 80) + '... Ouvre l\'onglet Éduquer pour le quiz !', 'ai');
  }, 3000);
}


// ── NAVIGATION PAGE ÉDU ──────────────────────────────────────
function eduTab(tab) {
  ['savoir','missions','badges','odd'].forEach(t => {
    const p = document.getElementById('edu-panel-'+t);
    const b = document.getElementById('edut-'+t);
    if(p) p.style.display = t===tab ? 'block' : 'none';
    if(b) b.classList.toggle('active', t===tab);
  });
  if(tab === 'badges') {
    renderBadges();
    const earned = JSON.parse(localStorage.getItem('kfn_badges')||'[]');
    const prog = document.getElementById('badges-progress-text');
    if(prog) prog.textContent = earned.length + '/' + BADGES_DEF.length + ' badges débloqués · Continue comme ça !';
  }
  if(tab === 'missions') {
    userStats.navLaunched = (userStats.navLaunched||0) + (navActive?1:0);
    renderMissions();
  }
}


// ── DONNÉES TRANSPORT ABIDJAN ────────────────────────────────
const TRANSPORT_LINES = [
  {id:'g1',type:'gbaka',ligne:'Adjamé Marché → Plateau',tarif:150,duree:'15-25 min',emoji:'🚌'},
  {id:'g2',type:'gbaka',ligne:'Yopougon → Adjamé',tarif:200,duree:'20-40 min',emoji:'🚌'},
  {id:'g3',type:'gbaka',ligne:'Abobo → Adjamé',tarif:250,duree:'30-50 min',emoji:'🚌'},
  {id:'g4',type:'gbaka',ligne:'Cocody Riviera → Plateau',tarif:300,duree:'20-35 min',emoji:'🚌'},
  {id:'g5',type:'gbaka',ligne:'Marcory → Plateau',tarif:200,duree:'15-30 min',emoji:'🚌'},
  {id:'w1',type:'woro',ligne:'Cocody → Plateau (woro)',tarif:500,duree:'10-20 min',emoji:'🚕'},
  {id:'w2',type:'woro',ligne:'Yopougon → Plateau (woro)',tarif:700,duree:'20-35 min',emoji:'🚕'},
  {id:'w3',type:'woro',ligne:'Abobo → Adjamé (woro)',tarif:600,duree:'25-40 min',emoji:'🚕'},
  {id:'s1',type:'sotra',ligne:'Bus SOTRA ligne 1 — Centre',tarif:300,duree:'Variable',emoji:'🚍'},
  {id:'s2',type:'sotra',ligne:'Bus SOTRA Yopougon Express',tarif:300,duree:'Variable',emoji:'🚍'},
];

// Types de lieux
const LIEU_TYPES = {
  gbaka:   {ico:'🚌', col:'#0F3D3E', label:'Station Gbaka'},
  woro:    {ico:'🚕', col:'#F97316', label:'Point Woro-Woro'},
  sotra:   {ico:'🚍', col:'#134B45', label:'Arrêt SOTRA'},
  marche:  {ico:'🛒', col:'#FF9130', label:'Marché'},
  danger:  {ico:'⚠️', col:'#E94F37', label:'Zone dangereuse'},
  pothole: {ico:'🕳️', col:'#8A9A94', label:'Nid-de-poule'},
  carburant:{ico:'⛽',col:'#FBBF24', label:'Station carburant'},
  autre:   {ico:'📍', col:'#64748B', label:'Point d\'intérêt'},
};

// ── ONGLETS KIMI ──────────────────────────────────────────────
let kimiCurrentTab = 'chat';
function kimiTab(tab){
  kimiCurrentTab = tab;
  ['chat','lieux','transport','alertes'].forEach(t=>{
    const p=document.getElementById('kp-'+t);
    const b=document.getElementById('kt-'+t);
    if(p)p.style.display=t===tab?'flex':'none';
    if(b){
      b.style.color=t===tab?'var(--teal-700)':'var(--ink-400)';
      b.style.borderBottom=t===tab?'2px solid var(--teal-700)':'none';
      b.style.fontWeight=t===tab?'700':'600';
    }
  });
  if(tab==='lieux')loadLieuxRecents();
  if(tab==='transport')renderTransport();
  if(tab==='alertes')loadKimiAlertes();
}

// Fix: kp-chat doit être flex par défaut
function initKimiTabs(){
  const c=document.getElementById('kp-chat');
  if(c)c.style.display='flex';
}

// ── LIEUX — AJOUTER DEPUIS KIMI ───────────────────────────────
function addLieuKimi(){
  const name=document.getElementById('lieu-name')?.value.trim();
  const type=document.getElementById('lieu-type')?.value||'autre';
  const desc=document.getElementById('lieu-desc')?.value.trim();
  if(!name){toast('Entre un nom pour ce lieu');return;}
  if(!lastLat){toast('GPS requis — active ta localisation');return;}
  
  const place={
    name, type, desc:desc||LIEU_TYPES[type]?.label||type,
    lat:lastLat, lng:lastLng, ts:Date.now(),
    source:'kimi_app', user:currentUser?.tel||'anonymous'
  };
  
  db.ref('community_places').push(place).then(()=>{
    // Ajouter sur la carte
    addPlaceMarker(place);
    toast('✅ '+LIEU_TYPES[type]?.ico+' '+name+' ajouté à la carte communautaire !');
    speak('Lieu ajouté. Merci pour ta contribution au réseau.');
    document.getElementById('lieu-name').value='';
    document.getElementById('lieu-desc').value='';
    loadLieuxRecents();
    logUserAction(`A référencé un lieu : ${name} (${LIEU_TYPES[type]?.label||type})`,LIEU_TYPES[type]?.ico||'📍');
    // Points civiques
    walPts+=15;
    userStats.placesAdded=(userStats.placesAdded||0)+1;
    saveUserStats();
    checkBadges();
  }).catch(()=>toast('Erreur — vérifie ta connexion'));
}

function addPlaceMarker(place){
  if(!map||!place.lat||!place.lng)return;
  const t=LIEU_TYPES[place.type]||LIEU_TYPES.autre;
  const html=`<div style="background:${t.col};border-radius:8px;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:14px;border:2px solid rgba(255,255,255,.5);box-shadow:0 2px 6px rgba(0,0,0,.3)">${t.ico}</div>`;
  L.marker([place.lat,place.lng],{icon:L.divIcon({html,iconSize:[28,28],iconAnchor:[14,14],className:''})})
    .addTo(map).bindPopup(`<b>${t.ico} ${place.name}</b><br>${place.desc||t.label}`);
}

// ── PAGE DÉDIÉE — LIEUX & TRANSPORT (barre de navigation) ──────
let lpCache=[];
let lpActiveType='all';
function loadLieuxPage(){
  const el=document.getElementById('lp-lieux-list');
  if(!el)return;
  buildLieuxFilterChips();
  db.ref('community_places').limitToLast(50).once('value',snap=>{
    const items=[];
    snap.forEach(c=>{const d=c.val();if(d)items.unshift(d);});
    lpCache=items;
    renderLieuxPage();
    items.forEach(p=>addPlaceMarker(p));
  }).catch(()=>{el.innerHTML='<div style="text-align:center;color:var(--ink-400);padding:20px;font-size:12px">Erreur réseau — vérifie ta connexion</div>';});
}
function buildLieuxFilterChips(){
  const el=document.getElementById('lp-filter-chips');
  if(!el||el.dataset.built)return;
  el.dataset.built='1';
  const types=[['all','🗂️ Tous']].concat(Object.entries(LIEU_TYPES).map(([k,v])=>[k,v.ico+' '+v.label]));
  el.innerHTML=types.map(([k,label],i)=>`<div class="chip" data-type="${k}" style="${i===0?'background:var(--teal-800);color:#fff;border-color:var(--teal-800)':''}">${label}</div>`).join('');
  el.querySelectorAll('.chip').forEach(chip=>{
    chip.addEventListener('click',()=>{
      lpActiveType=chip.dataset.type;
      el.querySelectorAll('.chip').forEach(c=>{c.style.background='';c.style.color='';c.style.borderColor='';});
      chip.style.background='var(--teal-800)';chip.style.color='#fff';chip.style.borderColor='var(--teal-800)';
      renderLieuxPage();
    });
  });
}
function renderLieuxPage(){
  const el=document.getElementById('lp-lieux-list');
  if(!el)return;
  const q=(document.getElementById('lp-search')?.value||'').toLowerCase().trim();
  let items=lpCache;
  if(lpActiveType!=='all')items=items.filter(p=>p.type===lpActiveType);
  if(q)items=items.filter(p=>(p.name||'').toLowerCase().includes(q)||(p.desc||'').toLowerCase().includes(q));
  if(!items.length){el.innerHTML='<div style="text-align:center;color:var(--ink-400);padding:30px 10px;font-size:12px">Aucun lieu trouvé — sois le premier à en référencer un ici !</div>';return;}
  el.innerHTML='';
  items.forEach(p=>{
    const t=LIEU_TYPES[p.type]||LIEU_TYPES.autre;
    const age=Math.round((Date.now()-p.ts)/60000);
    const row=document.createElement('div');
    row.style.cssText='display:flex;align-items:center;gap:10px;background:#fff;border:1.5px solid var(--border);border-radius:14px;padding:12px;margin-bottom:8px';
    row.innerHTML=`<div style="width:38px;height:38px;flex-shrink:0;border-radius:10px;background:${t.col}22;display:flex;align-items:center;justify-content:center;font-size:18px">${t.ico}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700;color:var(--ink-900)">${p.name}</div>
        <div style="font-size:11px;color:var(--ink-400)">${p.desc||t.label} · ${age<60?age+' min':Math.round(age/60)+' h'}</div>
      </div>
      <button data-go style="background:var(--teal-800);color:#fff;border:none;border-radius:16px;padding:8px 12px;font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;flex-shrink:0">➤ Y aller</button>`;
    row.querySelector('[data-go]').addEventListener('click',()=>setNavDest(p.name,p.lat,p.lng));
    el.appendChild(row);
  });
}
function addLieuPage(){
  const name=document.getElementById('lp-lieu-name')?.value.trim();
  const type=document.getElementById('lp-lieu-type')?.value||'autre';
  const desc=document.getElementById('lp-lieu-desc')?.value.trim();
  if(!name){toast('Entre un nom pour ce lieu');return;}
  if(!lastLat){toast('📍 GPS requis — active ta localisation');return;}
  const place={name,type,desc:desc||LIEU_TYPES[type]?.label||type,lat:lastLat,lng:lastLng,ts:Date.now(),source:'kimi_page',user:currentUser?.tel||'anonymous'};
  db.ref('community_places').push(place).then(()=>{
    addPlaceMarker(place);
    toast('✅ '+(LIEU_TYPES[type]?.ico||'📍')+' '+name+' ajouté à la carte communautaire !');
    speak('Lieu ajouté. Merci pour ta contribution au réseau.');
    document.getElementById('lp-lieu-name').value='';
    document.getElementById('lp-lieu-desc').value='';
    loadLieuxPage();
    logUserAction(`A référencé un lieu : ${name} (${LIEU_TYPES[type]?.label||type})`,LIEU_TYPES[type]?.ico||'📍');
    walPts+=15;
    userStats.placesAdded=(userStats.placesAdded||0)+1;
    saveUserStats();
    checkBadges();
  }).catch(()=>toast('Erreur — vérifie ta connexion'));
}
function lieuxPageTab(tab){
  ['lieux','transport'].forEach(t=>{
    const p=document.getElementById('lp-panel-'+t);
    const b=document.getElementById('lpt-'+t);
    if(p)p.style.display=t===tab?'block':'none';
    if(b){
      b.style.color=t===tab?'var(--teal-700)':'var(--ink-400)';
      b.style.borderBottom=t===tab?'2px solid var(--teal-700)':'2px solid transparent';
      b.style.fontWeight=t===tab?'700':'600';
    }
  });
  if(tab==='transport')renderTransportPage();
}
function renderTransportPage(){
  const el=document.getElementById('lp-transport-list');
  if(!el)return;
  el.innerHTML=TRANSPORT_LINES.map(l=>`
    <div style="display:flex;align-items:center;gap:10px;background:#fff;border:1.5px solid var(--border);border-radius:14px;padding:12px;margin-bottom:8px">
      <span style="font-size:18px">${l.emoji}</span>
      <div style="flex:1"><div style="font-size:13px;font-weight:700;color:var(--ink-900)">${l.ligne}</div><div style="font-size:11px;color:var(--ink-400)">${l.duree}</div></div>
      <div style="font-size:15px;font-weight:800;color:var(--amber-500)">${l.tarif} F</div>
    </div>`).join('');
  db.ref('transport_community').limitToLast(20).once('value',snap=>{
    snap.forEach(c=>{
      const d=c.val();if(!d)return;
      const ico=d.type==='gbaka'?'🚌':d.type==='woro'?'🚕':'🚍';
      el.innerHTML+=`<div style="display:flex;align-items:center;gap:10px;background:#fff;border:1.5px solid var(--border);border-radius:14px;padding:12px;margin-bottom:8px">
        <span style="font-size:18px">${ico}</span>
        <div style="flex:1"><div style="font-size:13px;font-weight:700;color:var(--ink-900)">${d.ligne}</div><div style="font-size:11px;color:var(--success)">Partagé par la communauté</div></div>
        <div style="font-size:15px;font-weight:800;color:var(--amber-500)">${d.tarif} F</div>
      </div>`;
    });
  });
}
function addTransportPage(){
  const ligne=document.getElementById('lp-t-ligne')?.value.trim();
  const tarif=document.getElementById('lp-t-tarif')?.value;
  const type=document.getElementById('lp-t-type')?.value||'gbaka';
  if(!ligne||!tarif){toast('Remplis la ligne et le tarif');return;}
  db.ref('transport_community').push({ligne,tarif:parseInt(tarif),type,ts:Date.now(),user:currentUser?.tel||'anon'})
    .then(()=>{
      toast('✅ Tarif partagé avec la communauté ! +10 pts');
      walPts+=10;
      document.getElementById('lp-t-ligne').value='';
      document.getElementById('lp-t-tarif').value='';
      logUserAction(`A partagé un tarif : ${ligne} — ${tarif} FCFA`,'🚌');
      renderTransportPage();
    }).catch(()=>toast('Erreur Firebase'));
}

let lieuxCache=[];
function loadLieuxRecents(){
  const el=document.getElementById('lieux-recents');
  if(!el)return;
  db.ref('community_places').limitToLast(20).once('value',snap=>{
    const items=[];
    snap.forEach(c=>{const d=c.val();if(d)items.unshift(d);});
    lieuxCache=items;
    renderLieuxList(items);
    // Charger aussi les marqueurs sur la carte
    items.forEach(p=>addPlaceMarker(p));
  });
}

function renderLieuxList(items){
  const el=document.getElementById('lieux-recents');
  if(!el)return;
  if(!items.length){el.innerHTML='<div style="color:var(--ink-400);font-size:11px">Aucun lieu encore — sois le premier à en ajouter !</div>';return;}
  el.innerHTML='';
  items.forEach((p,idx)=>{
    const t=LIEU_TYPES[p.type]||LIEU_TYPES.autre;
    const age=Math.round((Date.now()-p.ts)/60000);
    const row=document.createElement('div');
    row.style.cssText='display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)';
    row.innerHTML=`<span style="font-size:16px">${t.ico}</span>
      <div style="flex:1;cursor:pointer" data-center="${idx}"><div style="font-size:11px;font-weight:600;color:var(--ink-900)">${p.name}</div>
      <div style="font-size:9px;color:var(--ink-400)">${p.desc||t.label} · ${age<60?age+'min':Math.round(age/60)+'h'}</div></div>
      <button data-go="${idx}" style="background:var(--teal-800);color:#fff;border:none;border-radius:14px;padding:5px 9px;font-size:9px;font-weight:700;cursor:pointer;white-space:nowrap">➤ Y aller</button>`;
    row.querySelector('[data-center]').addEventListener('click',()=>{map&&map.setView([p.lat,p.lng],16);toggleKimi();});
    row.querySelector('[data-go]').addEventListener('click',()=>{setNavDest(p.name,p.lat,p.lng);toggleKimi();});
    el.appendChild(row);
  });
}

function filterLieux(q){
  q=(q||'').toLowerCase().trim();
  if(!q){renderLieuxList(lieuxCache);return;}
  renderLieuxList(lieuxCache.filter(p=>(p.name||'').toLowerCase().includes(q)||(p.desc||'').toLowerCase().includes(q)));
}

// ── TRANSPORT — AFFICHAGE ET AJOUT ────────────────────────────
function renderTransport(){
  const el=document.getElementById('transport-list');
  if(!el)return;
  // D'abord les lignes hardcodées
  let html=TRANSPORT_LINES.map(l=>`
    <div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border)">
      <span style="font-size:16px">${l.emoji}</span>
      <div style="flex:1">
        <div style="font-size:11px;font-weight:600;color:var(--ink-900)">${l.ligne}</div>
        <div style="font-size:10px;color:var(--ink-400)">${l.duree}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:13px;font-weight:800;color:var(--amber-500)">${l.tarif} F</div>
        <div style="font-size:9px;color:var(--ink-400)">FCFA</div>
      </div>
    </div>`).join('');
  el.innerHTML=html;
  // Puis les lignes communautaires depuis Firebase
  db.ref('transport_community').limitToLast(10).once('value',snap=>{
    snap.forEach(c=>{
      const d=c.val();if(!d)return;
      const ico=d.type==='gbaka'?'🚌':d.type==='woro'?'🚕':'🚍';
      el.innerHTML+=`<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:16px">${ico}</span>
        <div style="flex:1">
          <div style="font-size:11px;font-weight:600;color:var(--ink-900)">${d.ligne}</div>
          <div style="font-size:10px;color:var(--success)">Partagé par la communauté</div>
        </div>
        <div style="font-size:13px;font-weight:800;color:var(--amber-500)">${d.tarif} F</div>
      </div>`;
    });
  });
}

function addTransportInfo(){
  const ligne=document.getElementById('t-ligne')?.value.trim();
  const tarif=document.getElementById('t-tarif')?.value;
  const type=document.getElementById('t-type')?.value||'gbaka';
  if(!ligne||!tarif){toast('Remplis la ligne et le tarif');return;}
  db.ref('transport_community').push({ligne,tarif:parseInt(tarif),type,ts:Date.now(),user:currentUser?.tel||'anon'})
    .then(()=>{
      toast('✅ Tarif partagé avec la communauté ! +10 pts');
      walPts+=10;
      document.getElementById('t-ligne').value='';
      document.getElementById('t-tarif').value='';
      renderTransport();
    }).catch(()=>toast('Erreur Firebase'));
}

// ── ALERTES KIMI + SOURCES INTERNET ──────────────────────────
const EXTERNAL_ALERT_SOURCES = [
  // Sources RSS/API publiques accessibles sans auth
  {name:'OSER CI', url:'https://www.oser.ci', type:'scrape'},
  {name:'Météo CI (OpenMeteo)', url:`https://api.open-meteo.com/v1/forecast?latitude=5.345&longitude=-4.024&current=precipitation,weathercode&timezone=Africa/Abidjan`, type:'api'},
];

async function fetchExternalAlerts(){
  const el=document.getElementById('kimi-alertes-list');
  if(!el)return;
  el.innerHTML='<div style="text-align:center;padding:12px;font-size:12px;color:var(--ink-400)">🔄 Récupération en cours...</div>';
  
  const alerts=[];
  
  // 1. Météo via OpenMeteo (sans clé API)
  try{
    const r=await fetch('https://api.open-meteo.com/v1/forecast?latitude=5.345&longitude=-4.024&current=precipitation,weathercode,windspeed_10m&timezone=Africa%2FAbidjan');
    const d=await r.json();
    const prec=d.current?.precipitation||0;
    const wc=d.current?.weathercode||0;
    const wind=d.current?.windspeed_10m||0;
    if(prec>0.5){
      alerts.push({type:'meteo',title:'🌧️ Pluie à Abidjan',desc:`Précipitations: ${prec}mm · Vent: ${wind}km/h`,severity:'Prudence',source:'OpenMeteo'});
    }
    if(wc>=95){
      alerts.push({type:'meteo',title:'⛈️ Orage en cours',desc:'Conditions météo sévères — réduire la vitesse',severity:'Critique',source:'OpenMeteo'});
    } else {
      alerts.push({type:'meteo',title:'☀️ Météo Abidjan',desc:`Conditions: ${wc<3?'Ciel dégagé':wc<50?'Nuageux':'Pluvieux'} · Vent: ${wind}km/h`,severity:'Info',source:'OpenMeteo'});
    }
  }catch(e){alerts.push({type:'meteo',title:'🌤️ Météo indisponible',desc:'Mode offline — vérifiez manuellement',severity:'Info',source:'Local'});}

  // 2. Incidents Firebase récents
  db.ref('kcm_abidjan/incidents').limitToLast(5).once('value',snap=>{
    snap.forEach(c=>{
      const d=c.val();if(!d)return;
      const age=Math.round((Date.now()-(d.ts||0))/60000);
      if(age<120){
        alerts.push({type:d.type||'incident',title:d.title||'Incident',desc:d.meta||'Réseau KCM · '+age+'min',severity:d.severity||'Modéré',source:'KCM'});
      }
    });
    
    // Trier : Critique d'abord
    alerts.sort((a,b)=>a.severity==='Critique'?-1:b.severity==='Critique'?1:0);
    
    const sevColors={Critique:'var(--coral-100)',Modéré:'var(--amber-100)',Prudence:'var(--mint-100)',Info:'var(--cloud-50)'};
    const sevTxt={Critique:'var(--coral-600)',Modéré:'var(--amber-600)',Prudence:'var(--teal-700)',Info:'var(--ink-600)'};
    
    el.innerHTML=alerts.length?alerts.map(a=>`
      <div style="background:${sevColors[a.severity]||'var(--cloud-50)'};border-radius:10px;padding:10px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">
          <div style="font-size:12px;font-weight:700;color:var(--ink-900)">${a.title}</div>
          <span style="font-size:9px;font-weight:700;color:${sevTxt[a.severity]||'var(--ink-600)'};background:rgba(0,0,0,.05);border-radius:6px;padding:2px 6px">${a.severity}</span>
        </div>
        <div style="font-size:10px;color:var(--ink-600)">${a.desc}</div>
        <div style="font-size:9px;color:var(--ink-400);margin-top:3px">Source: ${a.source}</div>
      </div>`).join('')
    :'<div style="text-align:center;color:var(--ink-400);padding:12px;font-size:11px">✅ Aucune alerte critique en ce moment</div>';
  });
}

function loadKimiAlertes(){
  fetchExternalAlerts();
}

// ── NOTIFICATIONS SYSTÈME ─────────────────────────────────────
let notifPermission = 'default';
function requestNotifPermission(){
  if(!('Notification' in window))return;
  Notification.requestPermission().then(p=>{
    notifPermission=p;
    if(p==='granted'){
      toast('🔔 Notifications activées !');
      localStorage.setItem('kfn_notif','granted');
    }
  });
}

function sendNotif(title, body, icon='🚦'){
  if(notifPermission!=='granted'||!('Notification'in window))return;
  try{new Notification(title,{body,icon:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"><text y="14" font-size="14">'+icon+'</text></svg>'});}catch(e){}
}

// Enrichir showPredictAlert pour envoyer une notif système
// showPredictAlert enrichi ci-dessus

// MODE DEMO JURY
function demoJury(){
  gotoApp();
  setTimeout(()=>{
    toast('Mode Demo Jury active - donnees KCM simulees stables');
    document.getElementById('k-min').textContent='60';
    document.getElementById('k-inc').textContent='3';
    document.getElementById('k-score').textContent='87';
    gbKm=12; totalSig=8; kcmH=4.5; walPts=4350;
    calcEco();
    addMsg('Mode Demo Jury active. Reseau KCM : 5 noeuds stables, 3 incidents actifs, vitesse moyenne 24 km/h. Toutes les fonctionnalites sont operationnelles.','ai');
    speak('Mode demonstration jury active. Reseau Kimatey Computing Mobile operationnel.');
  },1000);
}
// SW — l'enregistrement est géré par le composant ServiceWorkerRegister (Next.js).
// L'ancien bloc de désenregistrement a été retiré lors de la migration PWA.

// Entrées vers les nouvelles pages "Trajets" (notifications prédictives, §6) et
// "Réseau" (mesh offline). Réutilisent le style des boutons de nav existants.
(function addFeatureEntries(){
  try{
    var ref=document.querySelector('[onclick*="/dashboard"]');
    if(!ref||!ref.parentNode)return;
    function mk(id,icon,label,href){
      if(document.getElementById(id))return null;
      var b=document.createElement('button');
      b.id=id;b.className=ref.className;
      if(ref.getAttribute('style'))b.setAttribute('style',ref.getAttribute('style'));
      b.innerHTML='<i class="fa-solid '+icon+'"></i> '+label;
      b.onclick=function(){window.location=href;};
      return b;
    }
    var t=mk('kfn-trajets-btn','fa-bell','Trajets','/trajets');
    if(t)ref.parentNode.insertBefore(t,ref.nextSibling);
    var r=mk('kfn-reseau-btn','fa-diagram-project','Réseau','/reseau');
    if(r)ref.parentNode.insertBefore(r,(t||ref).nextSibling);
  }catch(e){}
})();