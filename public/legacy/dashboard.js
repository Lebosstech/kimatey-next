const FB={apiKey:"AIzaSyBrQ_qAKll0Jg-Jp-XrflsXAR8p-sQIx0I",authDomain:"kimatey-flow-navigator.firebaseapp.com",databaseURL:"https://kimatey-flow-navigator-default-rtdb.firebaseio.com",projectId:"kimatey-flow-navigator"};
firebase.initializeApp(FB);
const db=firebase.database();
const CH='kcm_abidjan';

// MAP
const map=L.map('map',{zoomControl:true}).setView([5.345,-4.024],12);
const tileDark=L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',{attribution:'© CartoDB | Kimatey Flow',maxZoom:19,subdomains:'abcd'});
const tileLight=L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',{attribution:'© CartoDB | Kimatey Flow',maxZoom:19,subdomains:'abcd'});
tileDark.addTo(map);
let layers={nodes:true,incidents:true,places:false,heatmap:false};
let vehicleMarkers={},incidentMarkers={},placeMarkers={};

// CLOCK
function tick(){
  const now=new Date();
  document.getElementById('tb-clock').textContent=now.toLocaleTimeString('fr-CI');
  document.getElementById('tb-date').textContent=now.toLocaleDateString('fr-CI',{weekday:'short',day:'numeric',month:'short',year:'numeric'});
}
tick();setInterval(tick,1000);
// Charger l'historique détaillé après 2 secondes
setTimeout(loadDetailedHistory, 2000);
// Rafraîchir toutes les 2 minutes
setInterval(loadDetailedHistory, 120000);

// GRAPHE HEURES
function buildHourGraph(){
  const h=new Date().getHours();
  const bars=document.getElementById('hour-bars');
  if(!bars)return;
  const data=Array.from({length:24},(_,i)=>{
    if(i<5)return Math.random()*10+2;
    if(i<7)return Math.random()*20+10;
    if(i<10)return Math.random()*40+50;
    if(i<12)return Math.random()*20+30;
    if(i<14)return Math.random()*15+25;
    if(i<17)return Math.random()*15+20;
    if(i<20)return Math.random()*40+45;
    if(i<22)return Math.random()*20+20;
    return Math.random()*10+5;
  });
  const max=Math.max(...data);
  bars.innerHTML=data.map((v,i)=>{
    const pct=Math.round((v/max)*100);
    const col=i===h?'var(--or)':pct>70?'var(--rd)':pct>40?'var(--yw)':'var(--gr)';
    return `<div class="hour-bar" style="width:${100/24}%;background:${col};height:${pct}%;" title="${i}h: ${Math.round(v)} incidents"></div>`;
  }).join('');
}
buildHourGraph();

// FIREBASE — NŒUDS
let liveUsersCache={};
let selectedUserId=null;
let userRouteLine=null;
db.ref(`${CH}/live`).on('value',snap=>{
  const data=snap.val()||{};
  liveUsersCache=data;
  const count=Object.keys(data).length;
  document.getElementById('kpi-nodes').textContent=count;
  document.getElementById('kpi-users').textContent=count;
  document.getElementById('kpi-nodes-t').textContent=count>0?'↑ Réseau actif':'– En attente';
  // Retirer les marqueurs des nœuds déconnectés (absents du dernier snapshot ou inactifs > 3 min)
  const now=Date.now();
  Object.keys(vehicleMarkers).forEach(k=>{
    if(!data[k]||(now-(data[k].ts||0))>180000){
      map.removeLayer(vehicleMarkers[k]);
      delete vehicleMarkers[k];
    }
  });
  // Marqueurs + popups (mis à jour à chaque cycle)
  if(layers.nodes){
    Object.keys(data).forEach(k=>{
      const d=data[k];if(!d.lat||!d.lng||(now-(d.ts||0))>180000)return;
      const spd=d.spd||0;
      const col=spd<15?'#E94F37':spd<35?'#FF9130':'#2ECC71';
      const mode={voiture:'🚗',moto:'🏍️',pieton:'🚶',gbaka:'🚌'}[d.mode]||'📡';
      const html=`<div style="background:${col};border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:13px;border:2px solid rgba(255,255,255,.6);box-shadow:0 2px 6px rgba(0,0,0,.4)">${mode}</div>`;
      const popupHtml=`<b>${mode} ${d.name||'Nœud'}</b><br>Vitesse : ${spd} km/h<br>Score : ${d.score||87}/100<br>Mode : ${d.mode||'?'}${d.destName?`<br>🧭 Vers : ${d.destName}`:''}<br><button onclick="openUserModal('${k}')" style="margin-top:6px;background:var(--or);border:none;border-radius:6px;padding:4px 8px;font-size:10px;font-weight:700;color:#fff;cursor:pointer">Voir détails →</button>`;
      if(vehicleMarkers[k]){
        vehicleMarkers[k].setLatLng([d.lat,d.lng]);
        vehicleMarkers[k].setPopupContent(popupHtml);
      } else {
        vehicleMarkers[k]=L.marker([d.lat,d.lng],{icon:L.divIcon({html,iconSize:[26,26],iconAnchor:[13,13],className:''})})
          .addTo(map).bindPopup(popupHtml)
          .on('click',()=>openUserModal(k));
      }
    });
  }
  renderUsersLiveList(data,now);
  // Mise à jour trafic communes (simulé depuis nb nœuds)
  updateCommuneTraffic(count);
});

// PANNEAU LATÉRAL — LISTE CLIQUABLE DES UTILISATEURS CONNECTÉS
function renderUsersLiveList(data,now){
  now=now||Date.now();
  const el=document.getElementById('users-live-list');
  const badge=document.getElementById('users-count-badge');
  const keys=Object.keys(data).filter(k=>data[k]&&(now-(data[k].ts||0))<180000);
  if(badge)badge.textContent=keys.length+' en ligne';
  if(!el)return;
  if(!keys.length){el.innerHTML='<div style="font-size:10px;color:var(--sl);text-align:center;padding:10px 0">Aucun utilisateur connecté pour le moment</div>';return;}
  el.innerHTML=keys.map(k=>{
    const d=data[k];
    const spd=d.spd||0;
    const modeIco={voiture:'🚗',moto:'🏍️',pieton:'🚶',gbaka:'🚌'}[d.mode]||'📡';
    const statusCol=spd<2?'var(--sl)':spd<35?'var(--or)':'var(--gr)';
    const statusTxt=d.action==='navigation'&&d.destName?`🧭 Vers ${d.destName}`:(spd<2?'Arrêté':spd+' km/h');
    return `<div class="alert-item" style="border-bottom:1px solid var(--border)" onclick="openUserModal('${k}')">
      <div class="alert-ico" style="background:rgba(16,185,129,.12)">${modeIco}</div>
      <div style="flex:1;min-width:0">
        <div class="alert-title">${d.name||'Utilisateur'}<span class="sev" style="background:rgba(16,185,129,.15);color:#6EE7B7">● live</span></div>
        <div class="alert-meta" style="color:${statusCol}">${statusTxt} · Score ${d.score||87}/100</div>
      </div>
    </div>`;
  }).join('');
}

// MODAL DÉTAIL UTILISATEUR — cliquable depuis la liste ou un marqueur
function openUserModal(uid){
  const d=liveUsersCache[uid];
  if(!d){toast('Utilisateur hors ligne');return;}
  selectedUserId=uid;
  document.getElementById('mu-title').textContent='👤 '+(d.name||'Utilisateur');
  document.getElementById('mu-sub').textContent=`Nœud KCM · ${d.mode||'mode inconnu'} · Vu à l'instant`;
  document.getElementById('mu-speed').textContent=(d.spd||0)+' km/h';
  document.getElementById('mu-score').textContent=(d.score||87)+'/100';
  document.getElementById('mu-dest').textContent=d.destName?`🧭 ${d.destName}`:'Aucune navigation active';
  // Tracer l'itinéraire s'il existe
  if(userRouteLine){map.removeLayer(userRouteLine);userRouteLine=null;}
  if(d.destLat&&d.destLng){
    userRouteLine=L.polyline([[d.lat,d.lng],[d.destLat,d.destLng]],{color:'#F97316',weight:4,opacity:.8,dashArray:'6,6'}).addTo(map);
    map.fitBounds(userRouteLine.getBounds(),{padding:[80,80]});
  } else {
    map.setView([d.lat,d.lng],15);
  }
  // Charger le journal d'activité
  const actEl=document.getElementById('mu-actions');
  actEl.innerHTML='<div style="font-size:10px;color:var(--sl);text-align:center;padding:10px 0">Chargement...</div>';
  db.ref(`${CH}/user_actions/${uid}`).limitToLast(15).once('value',s=>{
    const items=[];
    s.forEach(c=>{const v=c.val();if(v)items.unshift(v);});
    if(!items.length){actEl.innerHTML='<div style="font-size:10px;color:var(--sl);text-align:center;padding:10px 0">Aucune action enregistrée</div>';return;}
    actEl.innerHTML=items.map(a=>{
      const age=Math.round((Date.now()-a.ts)/60000);
      return `<div style="display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:14px">${a.emoji||'📍'}</span>
        <div style="flex:1"><div style="font-size:10px;font-weight:600">${a.label}</div><div style="font-size:8px;color:var(--sl)">${age<60?'il y a '+age+' min':'il y a '+Math.round(age/60)+' h'}</div></div>
      </div>`;
    }).join('');
  });
  document.getElementById('modal-user').classList.add('on');
}
function focusUserOnMap(){
  if(!selectedUserId||!liveUsersCache[selectedUserId])return;
  closeModal('modal-user');
  const d=liveUsersCache[selectedUserId];
  map.setView([d.lat,d.lng],16);
}

// FIREBASE — INCIDENTS
db.ref(`${CH}/incidents`).limitToLast(30).on('value',snap=>{
  const items=[];
  snap.forEach(child=>{const d=child.val();if(d)items.unshift({...d,key:child.key});});
  document.getElementById('kpi-incidents').textContent=items.length;
  document.getElementById('kpi-inc-t').textContent=items.length>0?`↑ ${items.length} actifs`:'– Aucun';
  // Live alerts list
  const liveEl=document.getElementById('live-alerts');
  if(liveEl){
    liveEl.innerHTML=items.slice(0,5).map(i=>{
      const icons={accident:'🚗',bouchon:'🚦',travaux:'🚧',inondation:'🌊',pothole:'🕳️',danger:'⚠️'};
      const sevCls={'Critique':'sev-r','Modéré':'sev-o','Prudence':'sev-g'};
      const age=i.ts?Math.round((Date.now()-i.ts)/60000):0;
      return `<div class="alert-item" onclick="i.lat&&map.setView([${i.lat||5.345},${i.lng||-4.024}],15)">
        <div class="alert-ico" style="background:rgba(249,115,22,.15)">${icons[i.type]||'⚠️'}</div>
        <div style="flex:1"><div class="alert-title">${i.title||i.type}<span class="sev ${sevCls[i.severity]||'sev-o'}">${i.severity||'Modéré'}</span></div><div class="alert-meta">${i.meta||'Réseau KCM'} · ${age<1?'maintenant':age+'min'}</div></div>
      </div>`;
    }).join('');
  }
  // Markers incidents
  if(layers.incidents){
    items.forEach(i=>{
      if(!i.lat||!i.lng||incidentMarkers[i.key])return;
      const colors={'Critique':'#EF4444','Modéré':'#FBBF24','Prudence':'#10B981'};
      const html=`<div style="background:${colors[i.severity]||'#FBBF24'};border-radius:6px;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:11px;border:2px solid rgba(255,255,255,.5)">⚠️</div>`;
      incidentMarkers[i.key]=L.marker([i.lat,i.lng],{icon:L.divIcon({html,iconSize:[22,22],iconAnchor:[11,11],className:''})})
        .addTo(map).bindPopup(`<b>⚠️ ${i.title||i.type}</b><br>${i.meta||''}<br>Sévérité : ${i.severity||'Modéré'}`);
    });
  }
  document.getElementById('kpi-signals').textContent=items.filter(i=>i.source==='citizen'||!i.source).length||20;
});

// FIREBASE — LIEUX
db.ref('community_places').limitToLast(50).on('value',snap=>{
  const count=snap.numChildren();
  document.getElementById('kpi-places').textContent=count;
  if(layers.places){
    const icons={gbaka:'🚌',sotra:'🚍',woro:'🚕',marche:'🛒',danger:'⚠️',pothole:'🕳️',autre:'📍'};
    const colors={gbaka:'#0F3D3E',sotra:'#134B45',woro:'#186358',marche:'#FF9130',danger:'#E94F37',pothole:'#F97316',autre:'#64748B'};
    snap.forEach(child=>{
      const p=child.val();if(!p||!p.lat||!p.lng||placeMarkers[child.key])return;
      const html=`<div style="background:${colors[p.type]||'#0F3D3E'};border-radius:8px;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:13px;border:2px solid rgba(255,255,255,.4)">${icons[p.type]||'📍'}</div>`;
      placeMarkers[child.key]=L.marker([p.lat,p.lng],{icon:L.divIcon({html,iconSize:[26,26],iconAnchor:[13,13],className:''})})
        .addTo(map).bindPopup(`<b>${icons[p.type]||'📍'} ${p.name}</b><br>${p.desc||p.type}`);
    });
  }
});

// ── ÉCO-STATS FIREBASE TEMPS RÉEL ──────────────────────────
db.ref(CH+'/eco').on('value', snap=>{
  let totalSaved=0, totalEmis=0, totalFuel=0, totalKcal=0;
  const modes={};
  snap.forEach(child=>{
    const d=child.val();if(!d)return;
    totalSaved+=d.co2_saved_kg||0;
    totalEmis+=d.co2_kg||0;
    totalFuel+=d.fuel_l||0;
    totalKcal+=d.kcal||0;
    if(d.mode)modes[d.mode]=(modes[d.mode]||0)+1;
  });
  const saved=document.getElementById('eco-co2-saved');
  const emis=document.getElementById('eco-co2-emis');
  const fuel=document.getElementById('eco-fuel');
  const kcal=document.getElementById('eco-kcal');
  const modesEl=document.getElementById('eco-modes');
  if(saved)saved.textContent=totalSaved.toFixed(2)+' kg';
  if(emis)emis.textContent=totalEmis.toFixed(2)+' kg';
  if(fuel)fuel.textContent=totalFuel.toFixed(1)+' L';
  if(kcal)kcal.textContent=Math.round(totalKcal)+' kcal';
  const modeLabels={voiture:'🚗',moto:'🏍️',velo:'🚲',pieton:'🚶',gbaka:'🚌'};
  if(modesEl)modesEl.textContent=Object.entries(modes).map(([k,v])=>(modeLabels[k]||k)+' x'+v).join(' · ')||'–';
});

// TRAJETS HISTORIQUE (localStorage partagé avec l'app)
const history=JSON.parse(localStorage.getItem('kfn_history')||'[]');
const tripsEl=document.getElementById('trips-list');
if(tripsEl&&history.length){
  tripsEl.innerHTML=history.slice(0,5).map(t=>`
    <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border)">
      <span>${t.name}</span>
      <span style="color:var(--sl)">${t.dist||'?'}km · ${t.dur||'?'}min</span>
    </div>`).join('');
}

// TRAFIC COMMUNES — mise à jour dynamique
function updateCommuneTraffic(nodeCount){
  const hour=new Date().getHours();
  const peak=(hour>=7&&hour<10)||(hour>=17&&hour<20);
  const communes=[
    {id:'adjame',base:75,peak:92,label:peak?'Heure de pointe critique':'Axe principal'},
    {id:'yopo',base:55,peak:78,label:peak?'Congestion':'Modéré'},
    {id:'plateau',base:50,peak:70,label:'Centre des affaires'},
    {id:'abobo',base:45,peak:65,label:'Modéré'},
    {id:'cocody',base:25,peak:45,label:'Fluide'},
    {id:'marcory',base:40,peak:55,label:'Travaux · Modéré'},
  ];
  communes.forEach(c=>{
    const v=peak?c.peak:c.base;
    const fluctu=v+(Math.random()-0.5)*8;
    const pct=Math.round(Math.min(100,Math.max(0,fluctu)));
    const col=pct>70?'var(--rd)':pct>50?'var(--or)':pct>35?'var(--yw)':'var(--gr)';
    const barEl=document.getElementById('bar-'+c.id);
    const pctEl=document.getElementById('pct-'+c.id);
    const subEl=document.getElementById('sub-'+c.id);
    if(barEl){barEl.style.width=pct+'%';barEl.style.background=col;}
    if(pctEl){pctEl.textContent=pct+'%';pctEl.style.color=col;}
    if(subEl)subEl.textContent=c.label;
  });
}
setInterval(()=>updateCommuneTraffic(0),30000);

// LAYERS TOGGLE
function toggleLayer(name){
  layers[name]=!layers[name];
  const btn=document.getElementById('btn-'+name);
  if(btn)btn.classList.toggle('active',layers[name]);
  if(name==='places'){
    Object.values(placeMarkers).forEach(m=>layers.places?map.addLayer(m):map.removeLayer(m));
  }
  if(name==='nodes'){
    Object.values(vehicleMarkers).forEach(m=>layers.nodes?map.addLayer(m):map.removeLayer(m));
  }
  if(name==='incidents'){
    Object.values(incidentMarkers).forEach(m=>layers.incidents?map.addLayer(m):map.removeLayer(m));
  }
  toast(name+' : '+(layers[name]?'visible':'masqué'));
}

function centerAbidjan(){map.setView([5.345,-4.024],12);}

// DÉPLOYER ALERTE
function deployAlert(){
  const type=document.getElementById('alert-type-sel')?.value;
  const msg=document.getElementById('alert-msg')?.value;
  const zone=document.getElementById('alert-zone')?.value;
  const sev=document.getElementById('alert-sev')?.value;
  if(!msg){toast('Entre un message');return;}
  const alert={type,title:msg,meta:`Dashboard AMUGA · ${zone==='all'?'Tout Abidjan':zone}`,ts:Date.now(),severity:sev,source:'dashboard'};
  db.ref(`${CH}/incidents`).push(alert).then(()=>{
    closeModal('modal-alert');
    toast('✅ Alerte déployée sur le réseau KCM !');
  }).catch(()=>toast('Erreur Firebase'));
}

// EXPORT CSV
function exportData(){
  const now=new Date().toISOString().slice(0,10);
  const time=new Date().toLocaleTimeString('fr-CI');
  
  // Récupérer toutes les données Firebase pour l'export
  const CH='kcm_abidjan';
  Promise.all([
    db.ref(CH+'/incidents').limitToLast(50).once('value'),
    db.ref(CH+'/live').once('value'),
    db.ref(CH+'/eco').once('value'),
    db.ref('community_places').limitToLast(30).once('value'),
  ]).then(([incSnap,liveSnap,ecoSnap,placesSnap])=>{
    let csv='=== KIMATEY FLOW NAVIGATOR — Export AMUGA ===\n';
    csv+=`Date: ${now} ${time}\n\n`;
    
    // Incidents
    csv+='--- INCIDENTS ---\nTitre,Type,Sévérité,Timestamp,Lat,Lng\n';
    incSnap.forEach(c=>{
      const d=c.val();if(!d)return;
      csv+=`"${d.title||''}","${d.type||''}","${d.severity||''}","${new Date(d.ts||0).toLocaleString('fr-CI')}","${d.lat||''}","${d.lng||''}"\n`;
    });
    
    // Nœuds actifs
    csv+='\n--- NOEUDS KCM ACTIFS ---\nNom,Mode,Vitesse,Score,Lat,Lng,Timestamp\n';
    liveSnap.forEach(c=>{
      const d=c.val();if(!d)return;
      csv+=`"${d.name||c.key}","${d.mode||''}",${d.spd||0},${d.score||0},"${d.lat||''}","${d.lng||''}","${new Date(d.ts||0).toLocaleString('fr-CI')}"\n`;
    });
    
    // Données éco
    csv+='\n--- ECO-STATS PAR NOEUD ---\nMode,Distance_km,CO2_kg,CO2_economise_kg,Carburant_L,Cout_FCFA,Calories\n';
    ecoSnap.forEach(c=>{
      const d=c.val();if(!d)return;
      csv+=`"${d.mode||''}",${d.dist_km||0},${d.co2_kg||0},${d.co2_saved_kg||0},${d.fuel_l||0},${d.fuel_cost_fcfa||0},${d.kcal||0}\n`;
    });
    
    // Lieux communautaires
    csv+='\n--- LIEUX COMMUNAUTAIRES ---\nNom,Type,Description,Lat,Lng,Date\n';
    placesSnap.forEach(c=>{
      const d=c.val();if(!d)return;
      csv+=`"${d.name||''}","${d.type||''}","${d.desc||''}","${d.lat||''}","${d.lng||''}","${new Date(d.ts||0).toLocaleString('fr-CI')}"\n`;
    });
    
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download=`kimatey_flow_export_${now}.csv`;
    a.click();
    toast('✅ Export complet CSV téléchargé !');
  }).catch(()=>toast('Erreur lors de l export'));
}

// ── HISTORIQUE DÉTAILLÉ FIREBASE ─────────────────────────────
function loadDetailedHistory(){
  const el=document.getElementById('detailed-history');
  if(!el)return;
  el.innerHTML='<div style="color:var(--sl);font-size:10px;padding:8px">Chargement...</div>';
  
  // Charger les 20 derniers incidents + éco + lieux
  Promise.all([
    db.ref('kcm_abidjan/incidents').limitToLast(10).once('value'),
    db.ref('community_places').limitToLast(5).once('value'),
    db.ref('kcm_abidjan/eco').once('value'),
  ]).then(([incSnap,placesSnap,ecoSnap])=>{
    const events=[];
    
    incSnap.forEach(c=>{
      const d=c.val();if(!d)return;
      events.push({ts:d.ts||0,type:'incident',title:d.title||'Incident',
        desc:d.severity+' · '+(d.meta||'KCM'),icon:'⚠️',col:'#EF4444'});
    });
    
    placesSnap.forEach(c=>{
      const d=c.val();if(!d)return;
      const ico={gbaka:'🚌',woro:'🚕',sotra:'🚍',marche:'🛒',danger:'⚠️',pothole:'🕳️',autre:'📍'}[d.type]||'📍';
      events.push({ts:d.ts||0,type:'place',title:ico+' '+d.name,
        desc:d.type+' · '+(d.desc||''),icon:ico,col:'#06B6D4'});
    });
    
    // Stats éco globales
    let totalCO2s=0,totalCO2e=0,totalFuel=0,totalKcal=0,totalDist=0;
    const modeCount={};
    ecoSnap.forEach(c=>{
      const d=c.val();if(!d)return;
      totalCO2s+=d.co2_saved_kg||0;
      totalCO2e+=d.co2_kg||0;
      totalFuel+=d.fuel_l||0;
      totalKcal+=d.kcal||0;
      totalDist+=d.dist_km||0;
      if(d.mode)modeCount[d.mode]=(modeCount[d.mode]||0)+1;
    });
    
    events.sort((a,b)=>b.ts-a.ts);
    
    const modeIco={voiture:'🚗',moto:'🏍️',gbaka:'🚌',pieton:'🚶',velo:'🚲'};
    
    el.innerHTML=`
      <!-- Résumé éco -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px">
        <div style="background:rgba(16,185,129,.1);border-radius:8px;padding:8px;text-align:center">
          <div style="font-size:16px;font-weight:800;color:#10B981">${totalCO2s.toFixed(2)}</div>
          <div style="font-size:8px;color:var(--sl)">kg CO₂ économisés</div>
        </div>
        <div style="background:rgba(239,68,68,.08);border-radius:8px;padding:8px;text-align:center">
          <div style="font-size:16px;font-weight:800;color:#EF4444">${totalCO2e.toFixed(2)}</div>
          <div style="font-size:8px;color:var(--sl)">kg CO₂ émis</div>
        </div>
        <div style="background:rgba(251,191,36,.08);border-radius:8px;padding:8px;text-align:center">
          <div style="font-size:16px;font-weight:800;color:#FBBF24">${totalFuel.toFixed(1)}L</div>
          <div style="font-size:8px;color:var(--sl)">Carburant estimé</div>
        </div>
        <div style="background:rgba(6,182,212,.08);border-radius:8px;padding:8px;text-align:center">
          <div style="font-size:16px;font-weight:800;color:#06B6D4">${Math.round(totalKcal)}</div>
          <div style="font-size:8px;color:var(--sl)">kcal piétons</div>
        </div>
      </div>
      <!-- Modes actifs -->
      <div style="margin-bottom:8px;font-size:9px;color:var(--sl)">
        ${Object.entries(modeCount).map(([m,c])=>`${modeIco[m]||'?'} ${m} ×${c}`).join(' · ')||'Aucun trajet'}
      </div>
      <!-- Timeline événements -->
      <div style="font-size:9px;font-weight:700;color:var(--sl);text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px">Événements récents</div>
      ${events.length?events.map(e=>{
        const age=Math.round((Date.now()-e.ts)/60000);
        const ago=age<1?'maintenant':age<60?age+'min':`${Math.round(age/60)}h`;
        return `<div style="display:flex;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
          <div style="width:20px;height:20px;background:${e.col};border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;flex-shrink:0">${e.icon}</div>
          <div style="flex:1">
            <div style="font-size:10px;font-weight:600;color:var(--wh)">${e.title}</div>
            <div style="font-size:9px;color:var(--sl)">${e.desc}</div>
          </div>
          <div style="font-size:9px;color:var(--sl);flex-shrink:0">${ago}</div>
        </div>`;
      }).join(''):'<div style="color:var(--sl);font-size:10px;text-align:center;padding:10px">Aucun événement récent</div>'}`;
  }).catch(()=>{el.innerHTML='<div style="color:var(--sl);font-size:10px">Erreur de chargement</div>';});
}

function openAlertModal(){document.getElementById('modal-alert').classList.add('on');}
function closeModal(id){document.getElementById(id).classList.remove('on');}

let toastT;
function toast(m){const el=document.getElementById('toast');el.textContent=m;el.classList.add('show');clearTimeout(toastT);toastT=setTimeout(()=>el.classList.remove('show'),3500);}