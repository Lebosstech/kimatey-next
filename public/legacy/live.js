const FB={apiKey:"AIzaSyBrQ_qAKll0Jg-Jp-XrflsXAR8p-sQIx0I",authDomain:"kimatey-flow-navigator.firebaseapp.com",databaseURL:"https://kimatey-flow-navigator-default-rtdb.firebaseio.com",projectId:"kimatey-flow-navigator"};
firebase.initializeApp(FB);
const db=firebase.database();
const CH='kcm_abidjan';

let map,myLat=null,myLng=null,vehicleMarkers={},incidentMarkers={},placesMarkers={};
let vehicles={},incidents=[],places=[];
let selectedType='gbaka';
let sideOpen=true;

// INIT MAP
map=L.map('map',{zoomControl:true}).setView([5.345,-4.024],13);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{attribution:'© CartoDB | Kimatey Flow',maxZoom:19,subdomains:'abcd'}).addTo(map);

// GPS
if(navigator.geolocation){
  navigator.geolocation.watchPosition(pos=>{
    myLat=pos.coords.latitude;myLng=pos.coords.longitude;
    document.getElementById('signal-pos').textContent='📍 '+myLat.toFixed(5)+', '+myLng.toFixed(5);
    document.getElementById('enrich-pos').textContent='📍 '+myLat.toFixed(5)+', '+myLng.toFixed(5);
    // Marqueur position
    if(!window._myMark){
      window._myMark=L.circleMarker([myLat,myLng],{radius:10,fillColor:'#FF9130',color:'#fff',weight:3,fillOpacity:1}).addTo(map).bindPopup('<b>📍 Ma position</b>');
      map.setView([myLat,myLng],15);
    } else window._myMark.setLatLng([myLat,myLng]);
  },{enableHighAccuracy:true,maximumAge:2000});
}

// CLOCK
function tick(){document.getElementById('clock').textContent=new Date().toLocaleTimeString('fr-CI');}
tick();setInterval(tick,1000);

// ── FIREBASE TEMPS RÉEL ────────────────────────────────────────
// Nœuds KCM
db.ref(`${CH}/live`).on('value',snap=>{
  const data=snap.val()||{};
  vehicles=data;
  const count=Object.keys(data).length;
  document.getElementById('kpi-nodes').textContent=count;
  document.getElementById('nodes-count').textContent='● '+count;
  document.getElementById('kpi-users').textContent=count;
  renderNodes(data);
  updateVehicleMarkers(data);
});

// Incidents
db.ref(`${CH}/incidents`).limitToLast(20).on('value',snap=>{
  incidents=[];
  snap.forEach(child=>{const d=child.val();if(d){incidents.unshift({...d,key:child.key});}});
  document.getElementById('kpi-incidents').textContent=incidents.length;
  document.getElementById('inc-count').textContent=incidents.length;
  renderIncidents();
  updateIncidentMarkers();
});

// Lieux enrichis
db.ref('community_places').limitToLast(50).on('value',snap=>{
  places=[];
  snap.forEach(child=>{const d=child.val();if(d)places.push({...d,key:child.key});});
  document.getElementById('kpi-places')?document.getElementById('kpi-places').textContent=places.length:null;
  renderPlaces();
  updatePlaceMarkers();
});

// Signalements validés
db.ref(`${CH}/signals_validated`).once('value',snap=>{
  document.getElementById('kpi-signals').textContent=snap.numChildren()||20;
});

// ── RENDU NŒUDS ───────────────────────────────────────────────
function renderNodes(data){
  const el=document.getElementById('nodes-list');
  const keys=Object.keys(data);
  if(!keys.length){el.innerHTML='<div style="text-align:center;color:var(--slate);padding:20px;font-size:12px">En attente de nœuds...</div>';return;}
  el.innerHTML=keys.map(k=>{
    const d=data[k];
    const spd=d.spd||0;
    const col=spd<15?'var(--red)':spd<35?'var(--amber)':'var(--green)';
    const age=Math.round((Date.now()-(d.ts||Date.now()))/60000);
    const mode={voiture:'🚗',moto:'🏍️',pieton:'🚶',gbaka:'🚌'}[d.mode]||'📍';
    return `<div class="node-item" onclick="focusNode(${d.lat||5.345},${d.lng||-4.024})">
      <div class="node-dot" style="background:${col}"></div>
      <div>
        <div class="node-name">${mode} ${d.name||'Nœud KCM'}</div>
        <div class="node-sub">Score: ${d.score||87}/100 · ${age<1?'maintenant':age+'min'}</div>
      </div>
      <div class="node-spd" style="color:${col}">${spd} km/h</div>
    </div>`;
  }).join('');
}

function updateVehicleMarkers(data){
  Object.keys(data).forEach(k=>{
    const d=data[k];if(!d.lat||!d.lng)return;
    const icons={voiture:'🚗',moto:'🏍️',pieton:'🚶',gbaka:'🚌'};
    const ico=icons[d.mode]||'📡';
    const spd=d.spd||0;
    const col=spd<15?'#E94F37':spd<35?'#FF9130':'#2ECC71';
    const html=`<div style="background:${col};border-radius:50%;width:30px;height:30px;display:flex;align-items:center;justify-content:center;font-size:15px;border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.4)">${ico}</div>`;
    if(vehicleMarkers[k]){
      vehicleMarkers[k].setLatLng([d.lat,d.lng]);
    } else {
      vehicleMarkers[k]=L.marker([d.lat,d.lng],{icon:L.divIcon({html,iconSize:[30,30],iconAnchor:[15,15],className:''})})
        .addTo(map).bindPopup(`<b>${d.name||'Nœud'}</b><br>${spd} km/h · Score ${d.score||87}/100`);
    }
  });
}

function focusNode(lat,lng){map.setView([lat,lng],16);}

// ── RENDU INCIDENTS ────────────────────────────────────────────
function renderIncidents(){
  const el=document.getElementById('incidents-list');
  if(!incidents.length){el.innerHTML='<div style="text-align:center;color:var(--slate);padding:20px;font-size:12px">Aucun incident actif</div>';return;}
  const icons={accident:'🚗',bouchon:'🚦',travaux:'🚧',inondation:'🌊',pothole:'🕳️',danger:'⚠️'};
  const bColors={'Critique':'badge-red','Modéré':'badge-orange','Prudence':'badge-green'};
  el.innerHTML=incidents.map(i=>{
    const age=i.ts?Math.round((Date.now()-i.ts)/60000):0;
    return `<div class="inc-item">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
        <div class="inc-title">${icons[i.type]||'⚠️'} ${i.title||i.type}</div>
        <span class="badge ${bColors[i.severity]||'badge-orange'}">${i.severity||'Modéré'}</span>
      </div>
      <div class="inc-meta">${i.meta||'Réseau KCM'} · ${age<1?'maintenant':age+' min'}</div>
    </div>`;
  }).join('');
}

function updateIncidentMarkers(){
  incidents.forEach(i=>{
    if(!i.lat||!i.lng||incidentMarkers[i.key])return;
    const colors={Critique:'#E94F37',Modéré:'#FF9130',Prudence:'#2ECC71'};
    const html=`<div style="background:${colors[i.severity]||'#FF9130'};border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-size:12px;border:2px solid #fff">⚠️</div>`;
    incidentMarkers[i.key]=L.marker([i.lat,i.lng],{icon:L.divIcon({html,iconSize:[24,24],iconAnchor:[12,12],className:''})})
      .addTo(map).bindPopup(`<b>⚠️ ${i.title||i.type}</b><br>${i.meta||''}`);
  });
}

// ── RENDU LIEUX ────────────────────────────────────────────────
const PLACE_ICONS={gbaka:'🚌',sotra:'🚍',woro:'🚕',marche:'🛒',danger:'⚠️',pothole:'🕳️',autre:'📍'};
const PLACE_COLORS={gbaka:'#0F3D3E',sotra:'#134B45',woro:'#186358',marche:'#FF9130',danger:'#E94F37',pothole:'#F97316',autre:'#8A9A94'};

function renderPlaces(){
  const el=document.getElementById('places-list');
  if(!places.length){el.innerHTML='<div style="text-align:center;color:var(--slate);padding:12px;font-size:11px">Aucun lieu enrichi</div>';return;}
  el.innerHTML=places.slice(0,30).map(p=>`
    <div class="place-item" onclick="map.setView([${p.lat},${p.lng}],17)">
      <div class="place-ico" style="background:${PLACE_COLORS[p.type]||'#134B45'}">${PLACE_ICONS[p.type]||'📍'}</div>
      <div><div class="place-name">${p.name}</div><div class="place-type">${p.desc||p.type}</div></div>
    </div>`).join('');
}

function updatePlaceMarkers(){
  places.forEach(p=>{
    if(!p.lat||!p.lng||placesMarkers[p.key])return;
    const html=`<div style="background:${PLACE_COLORS[p.type]||'#134B45'};border-radius:8px;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:14px;border:2px solid rgba(255,255,255,.4);box-shadow:0 2px 6px rgba(0,0,0,.3)">${PLACE_ICONS[p.type]||'📍'}</div>`;
    placesMarkers[p.key]=L.marker([p.lat,p.lng],{icon:L.divIcon({html,iconSize:[28,28],iconAnchor:[14,14],className:''})})
      .addTo(map).bindPopup(`<b>${PLACE_ICONS[p.type]||'📍'} ${p.name}</b><br>${p.desc||p.type}`);
  });
}

// ── AJOUTER LIEU DEPUIS POSITION ──────────────────────────────
function setType(t){
  selectedType=t;
  document.querySelectorAll('.enrich-type').forEach(el=>el.classList.remove('active'));
  document.getElementById('et-'+t)?.classList.add('active');
}

function addMyPlace(){
  const name=document.getElementById('place-name')?.value.trim();
  if(!name){toast('Entre un nom pour ce lieu');return;}
  if(!myLat){toast('GPS requis — active ta localisation');return;}
  const desc=document.getElementById('place-desc')?.value.trim();
  const place={name,type:selectedType,desc:desc||selectedType,lat:myLat,lng:myLng,ts:Date.now(),source:'live_map'};
  db.ref('community_places').push(place).then(()=>{
    toast('✅ '+name+' ajouté à la carte !');
    document.getElementById('place-name').value='';
    document.getElementById('place-desc').value='';
  }).catch(()=>toast('Erreur — vérifie ta connexion'));
}

// ── SIGNALEMENT ────────────────────────────────────────────────
function openSignalModal(){
  if(!myLat){toast('GPS requis pour signaler');return;}
  document.getElementById('modal-signal').classList.add('on');
}

function submitSignal(){
  const type=document.getElementById('signal-type')?.value;
  const desc=document.getElementById('signal-desc')?.value;
  const severity=document.getElementById('signal-severity')?.value;
  if(!myLat){toast('GPS requis');return;}
  const signal={type,title:desc||type,meta:'Via Live Map · '+new Date().toLocaleTimeString('fr-CI'),lat:myLat,lng:myLng,ts:Date.now(),severity,source:'live_dashboard'};
  db.ref(`${CH}/incidents`).push(signal).then(()=>{
    closeModal('modal-signal');
    toast('✅ Incident signalé au réseau KCM !');
    document.getElementById('signal-desc').value='';
  }).catch(()=>toast('Erreur Firebase'));
}

// ── ENRICHISSEMENT MODAL ──────────────────────────────────────
function openEnrichModal(){
  if(!myLat){toast('GPS requis');return;}
  document.getElementById('modal-enrich').classList.add('on');
}

function submitEnrich(){
  const name=document.getElementById('enrich-name')?.value.trim();
  const type=document.getElementById('enrich-type-modal')?.value;
  const desc=document.getElementById('enrich-desc')?.value.trim();
  if(!name){toast('Entre un nom');return;}
  if(!myLat){toast('GPS requis');return;}
  const place={name,type,desc:desc||type,lat:myLat,lng:myLng,ts:Date.now(),source:'live_modal'};
  db.ref('community_places').push(place).then(()=>{
    closeModal('modal-enrich');
    toast('✅ '+name+' ajouté à la carte !');
  }).catch(()=>toast('Erreur Firebase'));
}

// ── FIREBASE ÉCO LIVE ────────────────────────────────────────
db.ref('kcm_abidjan/eco').on('value', snap=>{
  let saved=0,emis=0,fuel=0,kcal=0;
  snap.forEach(c=>{
    const d=c.val();if(!d)return;
    saved+=d.co2_saved_kg||0;
    emis+=d.co2_kg||0;
    fuel+=d.fuel_l||0;
    kcal+=d.kcal||0;
  });
  const s=document.getElementById('live-co2-saved');
  const e=document.getElementById('live-co2-emis');
  const f=document.getElementById('live-fuel');
  const k=document.getElementById('live-kcal');
  if(s)s.textContent=saved.toFixed(2)+' kg';
  if(e)e.textContent=emis.toFixed(2)+' kg';
  if(f)f.textContent=fuel.toFixed(1)+' L';
  if(k)k.textContent=Math.round(kcal)+' kcal';
});

// MAP CLICK — ajouter un lieu en cliquant sur la carte
map.on('contextmenu',e=>{
  const name=prompt('Nom du lieu à ajouter à cet endroit ?');
  if(!name)return;
  const types=['gbaka','sotra','woro','marche','danger','pothole','autre'];
  const typeStr=prompt('Type (gbaka/sotra/woro/marche/danger/pothole/autre) :','gbaka');
  const type=types.includes(typeStr)?typeStr:'autre';
  const place={name,type,desc:type,lat:e.latlng.lat,lng:e.latlng.lng,ts:Date.now(),source:'map_click'};
  db.ref('community_places').push(place).then(()=>{
    toast('✅ '+name+' ajouté !');
  });
});

// ── UI ─────────────────────────────────────────────────────────
function switchTab(tab){
  ['nodes','incidents','places'].forEach(t=>{
    document.getElementById('panel-'+t).style.display=t===tab?'flex':'none';
    document.getElementById('tab-'+t).classList.toggle('active',t===tab);
  });
  document.getElementById('panel-'+tab).style.display='flex';
  document.getElementById('panel-'+tab).style.flexDirection='column';
}

function toggleSide(){
  sideOpen=!sideOpen;
  const s=document.getElementById('side-panel');
  const t=document.getElementById('side-toggle');
  const ico=document.getElementById('toggle-ico');
  s.classList.toggle('collapsed',!sideOpen);
  t.classList.toggle('collapsed',!sideOpen);
  t.style.right=sideOpen?'300px':'0';
  ico.className=sideOpen?'fa-solid fa-chevron-right':'fa-solid fa-chevron-left';
  setTimeout(()=>map.invalidateSize(),300);
}

function closeModal(id){document.getElementById(id).classList.remove('on');}

let toastT;
function toast(m){const el=document.getElementById('toast');el.textContent=m;el.classList.add('show');clearTimeout(toastT);toastT=setTimeout(()=>el.classList.remove('show'),3500);}

// Mobile : panel fermé par défaut
if(window.innerWidth<768){toggleSide();}

// ── NŒUDS SIMULÉS PERMANENTS (toujours visibles) ────────────
const SIMULATED_NODES = [
  {id:'sim_adjame', name:'Capteur trafic · Adjamé',lat:5.362,lng:-4.018,spd:12,mode:'voiture',score:82,real:false},
  {id:'sim_plateau', name:'Capteur trafic · Plateau',lat:5.321,lng:-4.024,spd:47,mode:'voiture',score:90,real:false},
  {id:'sim_yopo', name:'Point relais · Yopougon',lat:5.328,lng:-4.082,spd:57,mode:'gbaka',score:88,real:false},
  {id:'sim_cocody', name:'Point relais · Cocody',lat:5.351,lng:-3.992,spd:4,mode:'voiture',score:75,real:false},
  {id:'sim_marcory', name:'Capteur trafic · Marcory',lat:5.303,lng:-4.003,spd:54,mode:'moto',score:85,real:false},
  {id:'sim_abobo', name:'Capteur trafic · Abobo',lat:5.378,lng:-4.015,spd:22,mode:'voiture',score:79,real:false},
];

function addSimulatedNodes(){
  SIMULATED_NODES.forEach(n=>{
    const spd=n.spd+Math.round((Math.random()-0.5)*8);
    const col=spd<15?'var(--red)':spd<35?'var(--amber)':'var(--green)';
    const ico={voiture:'🚗',moto:'🏍️',gbaka:'🚌',pieton:'🚶',velo:'🚲'}[n.mode]||'📡';
    const html=`<div style="background:${col};border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:14px;border:2px solid rgba(255,255,255,.5);box-shadow:0 2px 8px rgba(0,0,0,.4)">${ico}</div>`;
    if(vehicleMarkers[n.id]){
      vehicleMarkers[n.id].setLatLng([n.lat,n.lng]);
    } else {
      vehicleMarkers[n.id]=L.marker([n.lat,n.lng],{icon:L.divIcon({html,iconSize:[28,28],iconAnchor:[14,14],className:''})})
        .addTo(map).bindPopup(`<b>${ico} ${n.name}</b><br>Vitesse : ${spd} km/h<br>Score : ${n.score}/100<br>Mode : ${n.mode}<br><span style="color:#94A3B8;font-size:10px">Nœud de référence</span>`);
    }
  });
  // Màj liste nœuds avec les simulés + réels
  const allNodes = {...vehicles};
  SIMULATED_NODES.forEach(n=>{if(!allNodes[n.id])allNodes[n.id]={...n,ts:Date.now()};});
  renderNodes(allNodes);
  document.getElementById('kpi-nodes').textContent=Object.keys(allNodes).length;
  document.getElementById('nodes-count').textContent='● '+Object.keys(allNodes).length;
}

// Lancer les nœuds simulés immédiatement + toutes les 30s
addSimulatedNodes();
setInterval(()=>{
  // Faire varier légèrement les vitesses des simulés
  SIMULATED_NODES.forEach(n=>n.spd=Math.max(2,n.spd+Math.round((Math.random()-0.5)*6)));
  addSimulatedNodes();
},30000);

// ── TIMELINE / HISTORIQUE DÉTAILLÉ ──────────────────────────
let historyLog = JSON.parse(localStorage.getItem('kfn_live_history')||'[]');

function logEvent(type, data){
  const entry = {ts:Date.now(), type, ...data};
  historyLog.unshift(entry);
  if(historyLog.length>100) historyLog.pop();
  localStorage.setItem('kfn_live_history', JSON.stringify(historyLog.slice(0,100)));
  renderTimeline();
}

function renderTimeline(){
  const el=document.getElementById('timeline-list');
  if(!el)return;
  if(!historyLog.length){
    el.innerHTML='<div style="text-align:center;color:var(--slate);font-size:11px;padding:12px">Aucun événement</div>';
    return;
  }
  const icons={node:'📡',incident:'⚠️',place:'📍',signal:'🚨',eco:'🌱',alerte:'🔔'};
  const cols={node:'var(--green)',incident:'var(--red)',place:'var(--tl)',signal:'var(--or)',eco:'var(--gr)',alerte:'var(--yw)'};
  el.innerHTML=historyLog.slice(0,20).map(e=>{
    const age=Math.round((Date.now()-e.ts)/60000);
    const ago=age<1?'maintenant':age<60?age+'min':Math.round(age/60)+'h';
    return `<div style="display:flex;gap:8px;padding:7px 0;border-bottom:1px solid var(--border)">
      <div style="width:24px;height:24px;background:${cols[e.type]||'var(--slate)'};border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0">${icons[e.type]||'•'}</div>
      <div style="flex:1">
        <div style="font-size:10px;font-weight:600;color:var(--wh)">${e.title||e.type}</div>
        <div style="font-size:9px;color:var(--slate)">${e.desc||''}</div>
      </div>
      <div style="font-size:9px;color:var(--slate);flex-shrink:0">${ago}</div>
    </div>`;
  }).join('');
}

// Hooker les événements Firebase pour la timeline
db.ref('kcm_abidjan/incidents').limitToLast(5).on('child_added',snap=>{
  const d=snap.val();if(!d)return;
  logEvent('incident',{title:d.title||'Incident',desc:d.meta||'Réseau KCM'});
});
db.ref('community_places').limitToLast(3).on('child_added',snap=>{
  const d=snap.val();if(!d)return;
  logEvent('place',{title:'Lieu ajouté : '+d.name,desc:d.type+' · par la communauté'});
});
db.ref('kcm_abidjan/eco').on('child_changed',snap=>{
  const d=snap.val();if(!d||!d.dist_km)return;
  if(d.dist_km>0.5) logEvent('eco',{title:'Trajet enregistré',desc:`${d.mode} · ${d.dist_km.toFixed(1)}km · ${Math.round(d.co2_kg*1000)}g CO₂`});
});

// Ajouter l'onglet Timeline dans le panel
const sideHeader=document.querySelector('.tabs');
if(sideHeader&&!document.getElementById('tab-timeline')){
  const t=document.createElement('div');
  t.className='tab';
  t.id='tab-timeline';
  t.textContent='📜 Timeline';
  t.onclick=()=>switchTab('timeline');
  sideHeader.appendChild(t);
}

// Injecter le panel timeline
const sidePanel=document.getElementById('side-panel');
if(sidePanel&&!document.getElementById('panel-timeline')){
  const p=document.createElement('div');
  p.className='side-section';
  p.id='panel-timeline';
  p.style.display='none';
  p.innerHTML=`
    <div class="side-header">📜 Timeline événements <button onclick="historyLog=[];localStorage.removeItem('kfn_live_history');renderTimeline();" style="background:rgba(255,255,255,.08);border:none;color:var(--slate);border-radius:4px;padding:2px 6px;font-size:9px;cursor:pointer">Effacer</button></div>
    <div style="padding:10px" id="timeline-list"></div>`;
  sidePanel.appendChild(p);
}
renderTimeline();

// Étendre switchTab pour la timeline
const _origSwitchTab=switchTab;
function switchTab(tab){
  ['nodes','incidents','places','timeline'].forEach(t=>{
    const el=document.getElementById('panel-'+t);
    const bt=document.getElementById('tab-'+t);
    if(el)el.style.display=t===tab?'flex':'none';
    if(bt)bt.classList.toggle('active',t===tab);
  });
  if(tab==='timeline')renderTimeline();
}
