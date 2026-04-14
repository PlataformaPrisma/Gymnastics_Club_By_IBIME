// ── FIREBASE ──────────────────────────────────────────────────────
// Inicializado por assets/js/firebase-init.js
const db=firebase.firestore();

// ── ADMIN AUTH ────────────────────────────────────────────────────
let _adminLoggedIn=false;
let _unsubCatalogo=null,_unsubAlumnosCount=null;
let _unsubProfesores=null;
let _profesoresCached=[];
let _profesorEditandoId=null;
let _pendingProfesorData=null;

async function doLoginAdmin(){
    const email=document.getElementById('adminEmail').value.trim();
    const password=document.getElementById('adminPassword').value;
    const errEl=document.getElementById('adminLoginError');
    errEl.style.display='none';
    if(!email||!password){errEl.style.display='block';return;}
    try{
        await firebase.auth().signInWithEmailAndPassword(email,password);
        // onAuthStateChanged handles the rest
    }catch(e){
        console.error('Admin login error:',e);
        errEl.style.display='block';
    }
}

async function _iniciarSesionAdmin(user){
    try{
        const snap=await db.collection('usuarios_staff').doc(user.uid).get();
        if(!snap.exists||snap.data().rol!=='admin'){
            document.getElementById('adminLoginError').style.display='block';
            await firebase.auth().signOut();return;
        }
        _adminLoggedIn=true;
        const loginEl=document.getElementById('login-screen-admin');
        if(loginEl)loginEl.style.display='none';
        initAdminListeners();
    }catch(e){
        console.error('Error verificando admin:',e);
        await firebase.auth().signOut();
    }
}

function doLogoutAdmin(){
    if(_unsubCatalogo){_unsubCatalogo();_unsubCatalogo=null;}
    if(_unsubAlumnosCount){_unsubAlumnosCount();_unsubAlumnosCount=null;}
    if(_unsubProfesores){_unsubProfesores();_unsubProfesores=null;}
    _adminLoggedIn=false;
    firebase.auth().signOut().catch(()=>{});
    const loginEl=document.getElementById('login-screen-admin');
    if(loginEl)loginEl.style.display='flex';
}

firebase.auth().onAuthStateChanged(function(user){
    if(!user){
        const loginEl=document.getElementById('login-screen-admin');
        if(loginEl)loginEl.style.display='flex';
        return;
    }
    if(_adminLoggedIn)return;
    _iniciarSesionAdmin(user);
});

// ── TOAST ─────────────────────────────────────────────────────────
function toast(m,ms=3000){document.getElementById('toastMsg').innerText=m;const el=document.getElementById('toast');el.classList.add('show');setTimeout(()=>el.classList.remove('show'),ms);}

// ── DATOS BASE ────────────────────────────────────────────────────
const DIAS=['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];

// Costos mutables (se cargan desde Firebase si existen)
let COSTOS_FITNESS        = {1:60, 2:120,  3:180,  4:240, 5:300};
let COSTOS_GIMNASIA       = {1:800,    2:1440,  3:1920,  4:2400,    5:2800};
let COSTOS_FITNESS_PRONTO = {1:60, 2:120,  3:180,  4:240, 5:300};
let COSTOS_GIMNASIA_PRONTO= {1:720,    2:1296,  3:1728,  4:2160,    5:2520};

const ICONO_CLASE={
  'yoga':'🧘','step':'👟','dance fit':'💃','pilates mat':'🏃','gap':'⚡',
  'power jump':'🦘','pole dance':'🎭','heel dance':'👠','sculpt':'🏋️',
  'baby gym':'👶','baby telas':'👶','gaf':'🏅','gr':'🎀','telas':'🎭',
  'parkour':'🏃','gav':'🤸','gimnasia':'🤸','adultos':'👩','default':'🏋️'
};
function getIcono(nombre){const n=nombre.toLowerCase();for(const[k,v]of Object.entries(ICONO_CLASE)){if(n.includes(k))return v;}return'🏋️';}

function getChipClass(nombre){
  const n=nombre.toLowerCase();
  if(n.includes('yoga'))return'chip-yoga';
  if(n.includes('step'))return'chip-step';
  if(n.includes('dance fit'))return'chip-dancefit';
  if(n.includes('pilates'))return'chip-pilates';
  if(n.includes('gap'))return'chip-gap';
  if(n.includes('power jump'))return'chip-powerjump';
  if(n.includes('pole dance'))return'chip-poledance';
  if(n.includes('heel dance'))return'chip-heeldance';
  if(n.includes('sculpt'))return'chip-sculpt';
  if(n.includes('baby'))return'chip-babygym';
  if(n.includes('gaf')||n.includes('gimnasia artística'))return'chip-gaf';
  if(n.includes('gr ')||n.includes('rítmica')||n.includes('ritmica'))return'chip-gr';
  if(n.includes('telas')||n.includes('aro'))return'chip-telas';
  if(n.includes('parkour'))return'chip-parkour';
  if(n.includes('gav')||n.includes('varonil'))return'chip-gav';
  if(n.includes('adult')||n.includes('adulto'))return'chip-adultgym';
  return'chip-default';
}

// ── HORARIOS BASE (plantillas iniciales) ──────────────────────────
const HORARIO_FITNESS_BASE=[
  {hora:"07:00-08:00",dias:{Lunes:["Yoga","Power Jump"],Martes:["Step","Yoga"],Miércoles:["Yoga","Power Jump"],Jueves:["Step","Pilates Mat"],Viernes:["Yoga","Power Jump"]}},
  {hora:"08:00-09:00",dias:{Lunes:["GAP","Pilates Mat"],Martes:["Pilates Mat","Dance Fit"],Miércoles:["Sculpt","Pilates Mat"],Jueves:["GAP","Dance Fit"],Viernes:["GAP","Pilates Mat"]}},
  {hora:"09:00-10:00",dias:{Lunes:["Dance Fit","Pole Dance"],Martes:["Power Jump","Heel Dance"],Miércoles:["Pole Dance","Dance Fit"],Jueves:["Power Jump","Heel Dance"],Viernes:["Step","Pole Dance"],Sábado:["Power Jump","Step"]}},
  {hora:"10:00-11:00",dias:{Lunes:["Step","Heel Dance"],Martes:["GAP","Pole Dance"],Miércoles:["GAP","Heel Dance"],Jueves:["Pole Dance","Sculpt"],Viernes:["Dance Fit","Heel Dance"],Sábado:["Dance Fit","GAP"]}},
  {hora:"11:00-12:00",dias:{Sábado:["Pole Dance","Pilates Mat"]}},
  {hora:"17:00-18:00",dias:{Lunes:["Step","Pilates Mat"],Martes:["Pilates Mat","Power Jump"],Miércoles:["Pole Dance","Pilates Mat"],Jueves:["Pilates Mat","Power Jump"],Viernes:["Step","Pole Dance"]}},
  {hora:"18:00-19:00",dias:{Lunes:["Dance Fit","Power Jump"],Martes:["Dance Fit","GAP"],Miércoles:["Sculpt","Heel Dance"],Jueves:["GAP","Step"],Viernes:["GAP","Sculpt"]}},
  {hora:"19:00-20:00",dias:{Lunes:["Sculpt","Pole Dance"],Martes:["Step","Pole Dance"],Miércoles:["Dance Fit","Power Jump"],Jueves:["Sculpt","Pole Dance"],Viernes:["Dance Fit","Power Jump"]}},
  {hora:"20:00-21:00",dias:{Lunes:["GAP","Heel Dance"],Martes:["Heel Dance","Yoga"],Miércoles:["GAP","Step"],Jueves:["Heel Dance","Power Jump"],Viernes:["GAP","Yoga"]}},
];
const HORARIO_GIMNASIA_BASE=[
  {hora:"15:00-16:00",dias:{Lunes:["Baby Gym","Baby Telas"],Martes:["Baby Gym"],Miércoles:["Baby Gym","Baby Telas"],Jueves:["Baby Gym"],Viernes:["Baby Gym","Baby Telas"]}},
  {hora:"16:00-17:00",dias:{Lunes:["GAF PN 0 Iniciación","GAF Nivel 1","GAF Nivel 2","GAF Nivel 3,4,5","Parkour","Telas-Aro"],Martes:["GAF PN 0 Iniciación","GAF Nivel 1","GAF Nivel 2","GAF Nivel 3,4,5","GR S-9","GAV","6TR"],Miércoles:["GAF PN 0 Iniciación","GAF Nivel 1","GAF Nivel 2","GAF Nivel 3,4,5","GR S-9","Parkour","Telas-Aro"],Jueves:["GAF PN 0 Iniciación","GAF Nivel 1","GAF Nivel 2","GAF Nivel 3,4,5","GR S-9","GAV","6TR"],Viernes:["GAF PN 0 Iniciación","GAF Nivel 1","GAF Nivel 2","GAF Nivel 3,4,5","Parkour","Telas-Aro"]}},
  {hora:"17:00-18:00",dias:{Lunes:["GAF PN 0 Iniciación","GAF Nivel 1","GAF Nivel 2","GAF Nivel 3,4,5","Parkour","Telas-Aro"],Martes:["GAF PN 0 Iniciación","GAF Nivel 1","GAF Nivel 2","GAF Nivel 3,4,5","GR S-9","GAV","6TR"],Miércoles:["GAF PN 0 Iniciación","GAF Nivel 1","GAF Nivel 2","GAF Nivel 3,4,5","GR S-9","GAV","6TR"],Jueves:["GAF PN 0 Iniciación","GAF Nivel 1","GAF Nivel 2","GAF Nivel 3,4,5","GR S-9","GAV","6TR"],Viernes:["GAF PN 0 Iniciación","GAF Nivel 1","GAF Nivel 2","GAF Nivel 3,4,5","Parkour","Telas-Aro"]}},
  {hora:"18:00-19:00",dias:{Lunes:["GAF PN 0 Iniciación","GAF Nivel 2","GAF Nivel 3,4,5","Parkour","Telas-Aro"],Martes:["GAF PN 0 Iniciación","GAF Nivel 1","GAF Nivel 2","GAF Nivel 3,4,5","GAV Todos","6PT"],Miércoles:["GAF PN 0 Iniciación","GAF Nivel 1","GAF Nivel 2","GAF Nivel 3,4,5","Telas-Aro"],Jueves:["GAF PN 0 Iniciación","GAF Nivel 1","GAF Nivel 2","GAF Nivel 3,4,5","GAV Todos","6PT"],Viernes:["GAF PN 0 Iniciación","GAF Nivel 2","GAF Nivel 3,4,5","Parkour","Telas-Aro"]}},
  {hora:"19:00-20:00",dias:{Lunes:["GAF PN 0 Iniciación","GAF Nivel 1","GAF Nivel 2","GAF Nivel 3,4,5","Gimnasia para Adultos"],Martes:["GAF PN 0 Iniciación","GAF Nivel 1","GAF Nivel 2","GAF Nivel 3,4,5","Gimnasia Adultos"],Miércoles:["GAF PN 0 Iniciación","GAF Nivel 1","GAF Nivel 2","GAF Nivel 3,4,5","Gimnasia para Adultos"],Jueves:["GAF PN 0 Iniciación","GAF Nivel 1","GAF Nivel 2","GAF Nivel 3,4,5","Gimnasia Adultos"]}},
  {hora:"09:00-10:00",dias:{Sábado:["GAF PN 0 Iniciación","GAF Nivel 1","GAF Nivel 2","GAF Nivel 3,4,5","Parkour","Telas-Aro","GR"]}},
  {hora:"10:00-11:00",dias:{Sábado:["GAF PN 0 Iniciación","GAF Nivel 1","GAF Nivel 2","GAF Nivel 3,4,5","Parkour","Telas-Aro","GR"]}},
  {hora:"11:00-12:00",dias:{Sábado:["GAF PN 0 Iniciación","GAF Nivel 1","GAF Nivel 2","GAF Nivel 3,4,5","Parkour","Telas-Aro","7TR"]}},
  {hora:"12:00-13:00",dias:{Sábado:["GAF PN 0 Iniciación","GAF Nivel 1","GAF Nivel 3,4,5","Telas-Aro","GR","6TR"]}},
];

// Clones editables
let HORARIO_FITNESS  = JSON.parse(JSON.stringify(HORARIO_FITNESS_BASE));
let HORARIO_GIMNASIA = JSON.parse(JSON.stringify(HORARIO_GIMNASIA_BASE));

// cupos por celda (clave: "hora|dia")
const cuposLocales={};
function getCupo(hora,dia){return cuposLocales[hora+'|'+dia]||20;}
function setCupo(hora,dia,val){cuposLocales[hora+'|'+dia]=val;}

// costos y cupos individuales por clase (clave: fbKey)
const preciosClase={};  // key → { precio, precioPronto }
const cuposClase={};    // key → number

// Profesores locales (antes de publicar): "nombre|hora|dia" → string
const profesoresLocal={};
function fbKey(nombre,hora,dia){return nombre+'|'+hora+'|'+dia;}
function getProf(nombre,hora,dia){
  const k=fbKey(nombre,hora,dia);
  if(fbDocsMap.has(k))return fbDocsMap.get(k).profesor||'';
  return profesoresLocal[k]||'';
}

// ── FIREBASE DOCS MAP ─────────────────────────────────────────────
// Clave: "nombre|inicio-fin|dia" → {id, ...docData}
let fbDocsMap=new Map();
let clasesEnFirebase=new Set();
let firebaseInited=false;

// ── CELDA ACTIVA ─────────────────────────────────────────────────
let celdaActiva=null;

// ── COSTOS: cargar y guardar ──────────────────────────────────────
async function cargarCostos(){
  try{
    const df=await db.collection('config').doc('costos_fitness').get();
    if(df.exists){
      const d=df.data();
      COSTOS_FITNESS={1:d.d1,2:d.d2,3:d.d3,4:d.d4,5:d.d5};
      COSTOS_FITNESS_PRONTO={1:d.p1,2:d.p2,3:d.p3,4:d.p4,5:d.p5};
      actualizarInputsCostos('fitness');
    }
  }catch(e){console.warn('No se pudieron cargar costos fitness',e);}
  try{
    const dg=await db.collection('config').doc('costos_gimnasia').get();
    if(dg.exists){
      const d=dg.data();
      COSTOS_GIMNASIA={1:d.d1,2:d.d2,3:d.d3,4:d.d4,5:d.d5};
      COSTOS_GIMNASIA_PRONTO={1:d.p1,2:d.p2,3:d.p3,4:d.p4,5:d.p5};
      actualizarInputsCostos('gimnasia');
    }
  }catch(e){console.warn('No se pudieron cargar costos gimnasia',e);}
}

function actualizarInputsCostos(area){
  const costos=area==='fitness'?COSTOS_FITNESS:COSTOS_GIMNASIA;
  const pronto=area==='fitness'?COSTOS_FITNESS_PRONTO:COSTOS_GIMNASIA_PRONTO;
  const p=area==='fitness'?'f':'g';
  [1,2,3,4,5].forEach(n=>{
    const r=document.getElementById('c'+p+'r'+n);
    const pp=document.getElementById('c'+p+'p'+n);
    if(r)r.value=costos[n];
    if(pp)pp.value=pronto[n];
  });
}

function leerInputsCostos(area){
  const p=area==='fitness'?'f':'g';
  const reg={},pronto={};
  [1,2,3,4,5].forEach(n=>{
    reg[n]=parseFloat(document.getElementById('c'+p+'r'+n)?.value||0);
    pronto[n]=parseFloat(document.getElementById('c'+p+'p'+n)?.value||0);
  });
  return{regular:reg,pronto};
}

async function guardarCostos(area){
  const{regular,pronto}=leerInputsCostos(area);
  const data={
    d1:regular[1],d2:regular[2],d3:regular[3],d4:regular[4],d5:regular[5],
    p1:pronto[1], p2:pronto[2], p3:pronto[3], p4:pronto[4], p5:pronto[5],
    updatedAt:firebase.firestore.FieldValue.serverTimestamp()
  };
  try{
    await db.collection('config').doc('costos_'+area).set(data);
    if(area==='fitness'){
      COSTOS_FITNESS=regular;
      COSTOS_FITNESS_PRONTO=pronto;
    }else{
      COSTOS_GIMNASIA=regular;
      COSTOS_GIMNASIA_PRONTO=pronto;
    }
    toast('✅ Costos '+area+' guardados en Firebase');
  }catch(e){toast('❌ '+e.message);}
}

// ── INIT HORARIOS DESDE FIREBASE ──────────────────────────────────
function initHorariosFromFirebase(){
  const fitDocs=[...fbDocsMap.values()].filter(d=>d.area==='fitness');
  const gymDocs=[...fbDocsMap.values()].filter(d=>d.area==='gimnasia');
  if(fitDocs.length>0)HORARIO_FITNESS=buildHorarioFromDocs(fitDocs);
  if(gymDocs.length>0)HORARIO_GIMNASIA=buildHorarioFromDocs(gymDocs);
  // Also sync cupos from Firebase
  fbDocsMap.forEach((d,k)=>{
    if(d.cupo)setCupo(d.inicio+'-'+d.fin,d.dia,d.cupo);
  });
}

function buildHorarioFromDocs(docs){
  const map={};
  for(const d of docs){
    const hora=d.inicio+'-'+d.fin;
    if(!map[hora])map[hora]={hora,dias:{}};
    if(!map[hora].dias[d.dia])map[hora].dias[d.dia]=[];
    if(!map[hora].dias[d.dia].includes(d.nombre))map[hora].dias[d.dia].push(d.nombre);
  }
  return Object.values(map).sort((a,b)=>a.hora.localeCompare(b.hora));
}

// ── RENDER GRILLA ─────────────────────────────────────────────────
function renderGrid(horario,contenedorId,area){
  const cont=document.getElementById(contenedorId);
  let html='<div class="gh-cell gh-head">Hora</div>';
  DIAS.forEach(d=>html+=`<div class="gh-cell gh-head">${d}</div>`);
  horario.forEach((franja,fi)=>{
    html+=`<div class="gh-cell gh-hora">${franja.hora}</div>`;
    DIAS.forEach(dia=>{
      const clases=franja.dias[dia]||[];
      const enFB=clases.some(c=>clasesEnFirebase.has(fbKey(c,franja.hora,dia)));
      const isActiva=celdaActiva&&celdaActiva.hora===franja.hora&&celdaActiva.dia===dia&&celdaActiva.area===area;
      html+=`<div class="gh-cell ${enFB?'celda-fb':''}">
        <div class="clases-celda ${isActiva?(area==='fitness'?'editando-fit':'editando'):''}"
             onclick="abrirCelda('${franja.hora}','${dia}','${area}',${fi})" title="${franja.hora} · ${dia}"
             ondragover="cellDragOver(event,this)"
             ondragleave="cellDragLeave(this)"
             ondrop="cellDrop(event,'${franja.hora}','${dia}','${area}',${fi})">
          ${clases.length===0?`<div class="chip-add">+ agregar</div>`:
            clases.map(c=>{
              const prof=getProf(c,franja.hora,dia);
              const cSafe=c.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
              return`<div class="clase-chip ${getChipClass(c)}" draggable="true" ondragstart="chipDragStart(event,'${cSafe}','${franja.hora}','${dia}','${area}',${fi})" ondragend="chipDragEnd(event)">${getIcono(c)} ${c}${prof?`<span class="chip-prof">👤 ${prof}</span>`:''}</div>`;
            }).join('')}
        </div>
      </div>`;
    });
  });
  cont.innerHTML=html;
}

// ── ABRIR CELDA ───────────────────────────────────────────────────
function abrirCelda(hora,dia,area,franjaIdx){
  celdaActiva={hora,dia,area,franjaIdx};
  renderGrid(area==='fitness'?HORARIO_FITNESS:HORARIO_GIMNASIA,
             area==='fitness'?'gridFitness':'gridGimnasia',area);
  renderEditPanel(hora,dia,area,franjaIdx);
}

function renderEditPanel(hora,dia,area,franjaIdx){
  const horario=area==='fitness'?HORARIO_FITNESS:HORARIO_GIMNASIA;
  const franja=horario[franjaIdx];
  if(!franja){console.warn('Franja not found for index:', franjaIdx);cerrarCelda();return;}
  if(!franja.dias[dia])franja.dias[dia]=[];
  const clases=franja.dias[dia];
  const color=area==='fitness'?'var(--fitness)':'var(--gimnasia)';
  const panelId='editPanel'+(area==='fitness'?'Fitness':'Gimnasia');

  const todas=area==='fitness'
    ?['Yoga','Power Jump','Step','Pilates Mat','Dance Fit','GAP','Sculpt','Pole Dance','Heel Dance']
    :['GAF PN 0 Iniciación','GAF Nivel 1','GAF Nivel 2','GAF Nivel 3,4,5','GR S-9','GR','GAV','GAV Todos','Parkour','Telas-Aro','Baby Gym','Baby Telas','Gimnasia para Adultos','6TR','6PT','7TR'];
  const sugeridas=todas.filter(s=>!clases.includes(s));
  const cupo=getCupo(hora,dia);

  // Build all available hours for the move selector
  const horasDisponibles=[...new Set([
    ...(area==='fitness'?HORARIO_FITNESS:HORARIO_GIMNASIA).map(f=>f.hora),
    ...HORARIO_FITNESS_BASE.map(f=>f.hora),
    ...HORARIO_GIMNASIA_BASE.map(f=>f.hora)
  ])].sort();

  // Build chips HTML
  let chipsHTML='';
  if(clases.length===0){
    chipsHTML='<p style="font-size:.65rem;color:var(--muted);padding:.4rem">Sin disciplinas — agrega abajo</p>';
  }else{
    chipsHTML=clases.map((c,i)=>{
      const prof=getProf(c,hora,dia);
      const k=fbKey(c,hora,dia);
      const enFB=clasesEnFirebase.has(k);
      const sn=c.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
      const kSafe=k.replace(/"/g,'&quot;');
      const profSafe=(prof||'').replace(/"/g,'&quot;');
      const docData=enFB?fbDocsMap.get(k):null;
      const currentPrecio=(preciosClase[k]?.precio!=null)?preciosClase[k].precio:(docData?.precio??(area==='fitness'?COSTOS_FITNESS[1]:COSTOS_GIMNASIA[1]));
      const currentPP=(preciosClase[k]?.precioPronto!=null)?preciosClase[k].precioPronto:(docData?.precioPronto??(area==='fitness'?COSTOS_FITNESS_PRONTO[1]:COSTOS_GIMNASIA_PRONTO[1]));
      const currentCupo=cuposClase[k]!=null?cuposClase[k]:(docData?.cupo??getCupo(hora,dia));
      return`<div style="background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:7px;padding:.4rem .5rem;margin-bottom:.35rem">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:.3rem">
          <div class="edit-chip ${getChipClass(c)}" style="cursor:default;flex:1;min-width:0;overflow:hidden">
            ${getIcono(c)} ${c}${enFB?'<span style="color:var(--accent2);font-size:.5rem;margin-left:3px">✓</span>':''}
          </div>
          <div style="display:flex;gap:3px;flex-shrink:0">
            <button onclick="mostrarMoverClase('${sn}','${hora}','${dia}','${area}',${franjaIdx},${i})" style="background:rgba(165,180,252,.12);color:#a5b4fc;border:1px solid rgba(165,180,252,.25);border-radius:4px;padding:2px 5px;font-size:.55rem;font-weight:700;cursor:pointer" title="Mover clase">↕</button>
            <button onclick="quitarClase('${hora}','${dia}','${area}',${franjaIdx},${i})" style="background:rgba(239,68,68,.1);color:var(--danger);border:1px solid rgba(239,68,68,.2);border-radius:4px;padding:2px 5px;font-size:.55rem;font-weight:700;cursor:pointer" title="Quitar">✕</button>
          </div>
        </div>
        <div style="margin-top:.28rem">
          <input type="text" class="prof-input"
            data-clave="${kSafe}" data-enfb="${enFB?'1':'0'}"
            value="${profSafe}"
            placeholder="👤 Nombre del profesor..."
            onblur="onProfBlur(this)">
        </div>
        <div class="clase-edit-field">
          <div>
            <label>Precio</label>
            <input type="number" step="0.01" min="0"
              data-clave="${kSafe}" data-field="precio" data-enfb="${enFB?'1':'0'}"
              value="${currentPrecio}"
              placeholder="Precio..."
              onblur="onCostoClaseBlur(this)">
          </div>
          <div>
            <label>Pronto Pago</label>
            <input type="number" step="0.01" min="0"
              data-clave="${kSafe}" data-field="precioPronto" data-enfb="${enFB?'1':'0'}"
              value="${currentPP}"
              placeholder="Pronto pago..."
              onblur="onCostoClaseBlur(this)">
          </div>
        </div>
        <div class="clase-cupo-row">
          <label>Cupo individual</label>
          <div class="clase-cupo-ctrl">
            <button data-key="${kSafe}" data-enfb="${enFB?'1':'0'}" onclick="cambiarCupoClase(this,-1)">−</button>
            <span class="cupo-num">${currentCupo}</span>
            <button data-key="${kSafe}" data-enfb="${enFB?'1':'0'}" onclick="cambiarCupoClase(this,1)">+</button>
          </div>
        </div>
        <div id="moveForm_${area}_${i}" style="display:none"></div>
      </div>`;
    }).join('');
  }

  document.getElementById(panelId).innerHTML=`
    <div style="margin-bottom:.7rem">
      <p style="font-size:.58rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:${color};margin-bottom:.3rem">${dia} · ${hora}</p>
      <p style="font-size:.62rem;color:var(--muted);font-weight:600">${clases.length} disciplina${clases.length!==1?'s':''}</p>
    </div>

    <div style="margin-bottom:.6rem">
      <p style="font-size:.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin-bottom:.4rem">Disciplinas</p>
      <div id="chipsActuales_${area}">${chipsHTML}</div>
    </div>

    <div style="margin-bottom:.5rem">
      <p style="font-size:.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin-bottom:.4rem">Agregar disciplina</p>
      <div class="add-row">
        <input type="text" id="inputNueva_${area}" placeholder="Nombre de la clase..." onkeydown="if(event.key==='Enter')agregarClase('${hora}','${dia}','${area}',${franjaIdx})">
        <button onclick="agregarClase('${hora}','${dia}','${area}',${franjaIdx})" style="background:${color};color:white">+ Agregar</button>
      </div>
    </div>

    ${sugeridas.length?`
    <div style="margin-bottom:.8rem">
      <p style="font-size:.58rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin-bottom:.35rem">Sugerencias rápidas</p>
      <div class="sugerencias">
        ${sugeridas.map(s=>`<button class="sug-chip" onclick="agregarSugerida('${hora}','${dia}','${area}',${franjaIdx},'${s.replace(/\\/g,'\\\\').replace(/'/g,"\\'")}')">+ ${s}</button>`).join('')}
      </div>
    </div>`:''}

    <div class="cupo-row">
      <label>Cupo por clase</label>
      <div class="cupo-ctrl">
        <button onclick="cambiarCupo('${hora}','${dia}',-5)">−</button>
        <span id="cupoVal_${hora}_${dia}">${cupo}</span>
        <button onclick="cambiarCupo('${hora}','${dia}',5)">+</button>
      </div>
    </div>

    <button class="pub-celda-btn" style="background:${color};color:white;margin-bottom:.4rem"
      onclick="publicarCelda('${hora}','${dia}','${area}',${franjaIdx})">
      <i class="fa-solid fa-cloud-arrow-up"></i> Publicar / Actualizar celda
    </button>
    <button class="pub-celda-btn btn-ghost" onclick="cerrarCelda()">
      <i class="fa-solid fa-xmark"></i> Cerrar
    </button>
  `;
}

// ── PROFESOR ONBLUR HANDLER ───────────────────────────────────────
function onProfBlur(el){
  const k=el.dataset.clave;
  const val=el.value;
  profesoresLocal[k]=val;
  if(el.dataset.enfb==='1'){
    actualizarProfesorFirebase(k,val);
  }
}

async function actualizarProfesorFirebase(key,profesor){
  if(!fbDocsMap.has(key))return;
  const docData=fbDocsMap.get(key);
  try{
    await db.collection('catalogo').doc(docData.id).update({profesor});
  }catch(e){console.warn('Error actualizando profesor:',e);}
}

// ── EDICIÓN INLINE DE COSTOS POR CLASE ───────────────────────────
function onCostoClaseBlur(el){
  const k=el.dataset.clave;
  const field=el.dataset.field;
  const val=parseFloat(el.value)||0;
  if(!preciosClase[k])preciosClase[k]={};
  preciosClase[k][field]=val;
  if(el.dataset.enfb==='1'&&fbDocsMap.has(k)){
    const update={};update[field]=val;
    db.collection('catalogo').doc(fbDocsMap.get(k).id).update(update).catch(e=>console.warn(e));
  }
}

function cambiarCupoClase(btn,delta){
  const k=btn.dataset.key;
  const ctrl=btn.closest('.clase-cupo-ctrl');
  const span=ctrl&&ctrl.querySelector('.cupo-num');
  if(!span)return;
  const cur=parseInt(span.textContent)||1;
  const nuevo=Math.max(1,Math.min(200,cur+delta));
  span.textContent=nuevo;
  cuposClase[k]=nuevo;
  if(btn.dataset.enfb==='1'&&fbDocsMap.has(k)){
    db.collection('catalogo').doc(fbDocsMap.get(k).id)
      .update({cupo:nuevo,cupoDisponible:nuevo}).catch(e=>console.warn(e));
  }
}

// ── DRAG & DROP ───────────────────────────────────────────────────
let dragSource=null;

function chipDragStart(event,nombre,hora,dia,area,fi){
  dragSource={nombre,hora,dia,area,fi};
  event.dataTransfer.effectAllowed='move';
  event.dataTransfer.setData('text/plain',nombre);
  event.currentTarget.classList.add('dragging');
}

function chipDragEnd(event){
  event.currentTarget.classList.remove('dragging');
  document.querySelectorAll('.drag-over').forEach(el=>el.classList.remove('drag-over'));
}

function cellDragOver(event,cell){
  event.preventDefault();
  event.dataTransfer.dropEffect='move';
  cell.classList.add('drag-over');
}

function cellDragLeave(cell){
  cell.classList.remove('drag-over');
}

async function cellDrop(event,hora,dia,area,fi){
  event.preventDefault();
  const cell=event.currentTarget;
  cell.classList.remove('drag-over');
  if(!dragSource)return;
  const{nombre,hora:oldHora,dia:oldDia,area:oldArea,fi:oldFi}=dragSource;
  dragSource=null;
  if(oldHora===hora&&oldDia===dia&&oldArea===area)return;

  const srcHorario=oldArea==='fitness'?HORARIO_FITNESS:HORARIO_GIMNASIA;
  const idx=srcHorario[oldFi]?.dias[oldDia]?.indexOf(nombre)??-1;
  if(idx===-1)return;
  srcHorario[oldFi].dias[oldDia].splice(idx,1);

  const dstHorario=area==='fitness'?HORARIO_FITNESS:HORARIO_GIMNASIA;
  let dstFi=fi;
  if(!dstHorario[dstFi]){dstHorario.push({hora,dias:{}});dstFi=dstHorario.length-1;}
  if(!dstHorario[dstFi].dias[dia])dstHorario[dstFi].dias[dia]=[];
  if(!dstHorario[dstFi].dias[dia].includes(nombre))dstHorario[dstFi].dias[dia].push(nombre);

  const oldK=fbKey(nombre,oldHora,oldDia);
  if(fbDocsMap.has(oldK)){
    const docData=fbDocsMap.get(oldK);
    const[newInicio,newFin]=hora.split('-');
    try{
      await db.collection('catalogo').doc(docData.id).update({dia,inicio:newInicio,fin:newFin,diasSemana:[dia]});
      toast('✅ "'+nombre+'" movida a '+dia+' '+hora);
    }catch(e){toast('❌ '+e.message);}
  }else{
    toast('✅ "'+nombre+'" movida localmente a '+dia+' '+hora);
  }
  const newK=fbKey(nombre,hora,dia);
  if(profesoresLocal[oldK]){profesoresLocal[newK]=profesoresLocal[oldK];delete profesoresLocal[oldK];}
  if(preciosClase[oldK]){preciosClase[newK]=preciosClase[oldK];delete preciosClase[oldK];}
  if(cuposClase[oldK]!=null){cuposClase[newK]=cuposClase[oldK];delete cuposClase[oldK];}

  if(oldArea!==area){
    renderGrid(oldArea==='fitness'?HORARIO_FITNESS:HORARIO_GIMNASIA,
               oldArea==='fitness'?'gridFitness':'gridGimnasia',oldArea);
  }
  renderGrid(dstHorario,area==='fitness'?'gridFitness':'gridGimnasia',area);
  if(celdaActiva){
    renderEditPanel(celdaActiva.hora,celdaActiva.dia,celdaActiva.area,celdaActiva.franjaIdx);
  }
}

// ── MOVER CLASE ───────────────────────────────────────────────────
function mostrarMoverClase(nombre,hora,dia,area,fi,idx){
  const divId='moveForm_'+area+'_'+idx;
  const div=document.getElementById(divId);
  if(!div)return;

  const horario=area==='fitness'?HORARIO_FITNESS:HORARIO_GIMNASIA;
  const todasHoras=[...new Set([
    ...horario.map(f=>f.hora),
    ...HORARIO_FITNESS_BASE.map(f=>f.hora),
    ...HORARIO_GIMNASIA_BASE.map(f=>f.hora)
  ])].sort();

  const sn=nombre.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
  div.style.display='block';
  div.innerHTML=`
    <div class="move-form">
      <p style="font-size:.58rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#a5b4fc;margin-bottom:.4rem">↕ Mover a:</p>
      <label>Día destino</label>
      <select id="moveDia_${area}_${idx}">
        ${DIAS.map(d=>`<option value="${d}" ${d===dia?'selected':''}>${d}</option>`).join('')}
      </select>
      <label>Hora destino</label>
      <select id="moveHora_${area}_${idx}">
        ${todasHoras.map(h=>`<option value="${h}" ${h===hora?'selected':''}>${h}</option>`).join('')}
      </select>
      <button class="btn-confirmar-mover" onclick="confirmarMover('${sn}','${hora}','${dia}','${area}',${fi},${idx},document.getElementById('moveDia_${area}_${idx}').value,document.getElementById('moveHora_${area}_${idx}').value)">✅ Confirmar</button>
      <button class="btn-cancelar-mover" onclick="document.getElementById('${divId}').style.display='none'">Cancelar</button>
    </div>`;
}

async function confirmarMover(nombre,oldHora,oldDia,area,oldFi,idx,newDia,newHora){
  if(oldHora===newHora&&oldDia===newDia){toast('⚠️ Misma celda, elige un destino diferente');return;}

  const horario=area==='fitness'?HORARIO_FITNESS:HORARIO_GIMNASIA;
  // Remove from old cell
  horario[oldFi].dias[oldDia]=horario[oldFi].dias[oldDia].filter((_,i)=>i!==idx);

  // Find or create target franja
  let targetFi=horario.findIndex(f=>f.hora===newHora);
  if(targetFi===-1){horario.push({hora:newHora,dias:{}});targetFi=horario.length-1;}
  if(!horario[targetFi].dias[newDia])horario[targetFi].dias[newDia]=[];
  if(!horario[targetFi].dias[newDia].includes(nombre))horario[targetFi].dias[newDia].push(nombre);

  // If class is in Firebase, update the doc
  const oldK=fbKey(nombre,oldHora,oldDia);
  if(fbDocsMap.has(oldK)){
    const docData=fbDocsMap.get(oldK);
    const [newInicio,newFin]=newHora.split('-');
    try{
      await db.collection('catalogo').doc(docData.id).update({
        dia:newDia,inicio:newInicio,fin:newFin,diasSemana:[newDia]
      });
      toast('✅ "'+nombre+'" movida a '+newDia+' '+newHora);
    }catch(e){toast('❌ '+e.message);}
  }else{
    toast('✅ "'+nombre+'" movida localmente a '+newDia+' '+newHora);
  }

  // Move professor local if exists
  const newK=fbKey(nombre,newHora,newDia);
  if(profesoresLocal[oldK]){profesoresLocal[newK]=profesoresLocal[oldK];delete profesoresLocal[oldK];}

  // Re-render targeting the new cell
  celdaActiva={hora:newHora,dia:newDia,area,franjaIdx:targetFi};
  renderGrid(horario,area==='fitness'?'gridFitness':'gridGimnasia',area);
  renderEditPanel(newHora,newDia,area,targetFi);
}

function cerrarCelda(){
  celdaActiva=null;
  renderGrid(HORARIO_FITNESS,'gridFitness','fitness');
  renderGrid(HORARIO_GIMNASIA,'gridGimnasia','gimnasia');
  document.getElementById('editPanelFitness').innerHTML='<p style="font-size:.7rem;color:var(--muted);text-align:center;padding:1.5rem 0;line-height:1.6">Haz click en cualquier<br>celda de la grilla para<br>editar sus disciplinas</p>';
  document.getElementById('editPanelGimnasia').innerHTML='<p style="font-size:.7rem;color:var(--muted);text-align:center;padding:1.5rem 0;line-height:1.6">Haz click en cualquier<br>celda de la grilla para<br>editar sus disciplinas</p>';
}

// ── EDICIÓN DE CELDA ─────────────────────────────────────────────
function agregarClase(hora,dia,area,fi){
  const id='inputNueva_'+area;
  const val=document.getElementById(id)?.value.trim();
  if(!val){toast('⚠️ Escribe el nombre de la clase');return;}
  const horario=area==='fitness'?HORARIO_FITNESS:HORARIO_GIMNASIA;
  if(!horario[fi].dias[dia])horario[fi].dias[dia]=[];
  if(horario[fi].dias[dia].includes(val)){toast('Ya existe en esta celda');return;}
  horario[fi].dias[dia].push(val);
  document.getElementById(id).value='';
  renderGrid(area==='fitness'?HORARIO_FITNESS:HORARIO_GIMNASIA,
             area==='fitness'?'gridFitness':'gridGimnasia',area);
  renderEditPanel(hora,dia,area,fi);
  toast('✅ '+val+' agregada');
}

function agregarSugerida(hora,dia,area,fi,nombre){
  const horario=area==='fitness'?HORARIO_FITNESS:HORARIO_GIMNASIA;
  if(!horario[fi].dias[dia])horario[fi].dias[dia]=[];
  if(horario[fi].dias[dia].includes(nombre)){toast('Ya existe');return;}
  horario[fi].dias[dia].push(nombre);
  renderGrid(area==='fitness'?HORARIO_FITNESS:HORARIO_GIMNASIA,
             area==='fitness'?'gridFitness':'gridGimnasia',area);
  renderEditPanel(hora,dia,area,fi);
}

function quitarClase(hora,dia,area,fi,idx){
  const horario=area==='fitness'?HORARIO_FITNESS:HORARIO_GIMNASIA;
  const nombre=horario[fi].dias[dia][idx];
  horario[fi].dias[dia].splice(idx,1);
  renderGrid(area==='fitness'?HORARIO_FITNESS:HORARIO_GIMNASIA,
             area==='fitness'?'gridFitness':'gridGimnasia',area);
  renderEditPanel(hora,dia,area,fi);
  toast('🗑️ '+nombre+' quitada');
}

function cambiarCupo(hora,dia,delta){
  const cur=getCupo(hora,dia);
  const nuevo=Math.max(5,Math.min(50,cur+delta));
  setCupo(hora,dia,nuevo);
  const el=document.getElementById('cupoVal_'+hora+'_'+dia);
  if(el)el.textContent=nuevo;
  // If the class is already in Firebase, update cupo for all classes in this cell
  if(celdaActiva&&celdaActiva.hora===hora&&celdaActiva.dia===dia){
    const horario=celdaActiva.area==='fitness'?HORARIO_FITNESS:HORARIO_GIMNASIA;
    const franja=horario[celdaActiva.franjaIdx];
    const clases=(franja&&franja.dias[dia])||[];
    clases.forEach(nombre=>{
      const k=fbKey(nombre,hora,dia);
      if(fbDocsMap.has(k)){
        db.collection('catalogo').doc(fbDocsMap.get(k).id).update({cupo:nuevo,cupoDisponible:nuevo}).catch(()=>{});
      }
    });
  }
}

// ── PUBLICAR CELDA ────────────────────────────────────────────────
async function publicarCelda(hora,dia,area,fi){
  const horario=area==='fitness'?HORARIO_FITNESS:HORARIO_GIMNASIA;
  const clases=horario[fi].dias[dia]||[];
  if(!clases.length){toast('⚠️ No hay disciplinas en esta celda');return;}
  const [inicio,fin]=hora.split('-');
  const cupo=getCupo(hora,dia);
  const costos=area==='fitness'?COSTOS_FITNESS:COSTOS_GIMNASIA;
  const pronto=area==='fitness'?COSTOS_FITNESS_PRONTO:COSTOS_GIMNASIA_PRONTO;
  let ok=0,upd=0;
  for(const nombre of clases){
    const k=fbKey(nombre,hora,dia);
    const profesor=profesoresLocal[k]||fbDocsMap.get(k)?.profesor||'';
    const profesorId=profesor?generarIdProfesor(profesor):'';
    const payload={
      nombre,tipo:'clase',area,inicio,fin,dia,
      diasSemana:[dia],cupo,cupoDisponible:cupo,
      precio:costos[1],precioPronto:pronto[1],
      icon:getIcono(nombre),profesor,profesorId,activa:true,
      timestamp:firebase.firestore.FieldValue.serverTimestamp()
    };
    try{
      if(clasesEnFirebase.has(k)){
        await db.collection('catalogo').doc(fbDocsMap.get(k).id).update(payload);
        upd++;
      }else{
        await db.collection('catalogo').add(payload);
        ok++;
      }
    }catch(e){toast('❌ '+nombre+': '+e.message);}
  }
  const msg=[];
  if(ok)msg.push('✅ '+ok+' publicada'+(ok!==1?'s':''));
  if(upd)msg.push('🔄 '+upd+' actualizada'+(upd!==1?'s':''));
  toast(msg.join(' · ')+' — '+dia+' '+hora);
}

// ── PUBLICAR ÁREA COMPLETA ────────────────────────────────────────
async function publicarArea(area){
  const horario=area==='fitness'?HORARIO_FITNESS:HORARIO_GIMNASIA;
  const costos=area==='fitness'?COSTOS_FITNESS:COSTOS_GIMNASIA;
  const pronto=area==='fitness'?COSTOS_FITNESS_PRONTO:COSTOS_GIMNASIA_PRONTO;
  let ok=0,upd=0;
  for(const franja of horario){
    const [inicio,fin]=franja.hora.split('-');
    for(const [dia,clases] of Object.entries(franja.dias)){
      const cupo=getCupo(franja.hora,dia);
      for(const nombre of clases){
        const k=fbKey(nombre,franja.hora,dia);
        const profesor=profesoresLocal[k]||fbDocsMap.get(k)?.profesor||'';
        const profesorId=profesor?generarIdProfesor(profesor):'';
        const payload={
          nombre,tipo:'clase',area,inicio,fin,dia,
          diasSemana:[dia],cupo,cupoDisponible:cupo,
          precio:costos[1],precioPronto:pronto[1],
          icon:getIcono(nombre),profesor,profesorId,activa:true,
          timestamp:firebase.firestore.FieldValue.serverTimestamp()
        };
        try{
          if(clasesEnFirebase.has(k)){
            await db.collection('catalogo').doc(fbDocsMap.get(k).id).update(payload);
            upd++;
          }else{
            await db.collection('catalogo').add(payload);
            ok++;
          }
        }catch(e){}
      }
    }
  }
  toast('✅ '+ok+' publicadas · �� '+upd+' actualizadas',5000);
}

// ── GENERAR LISTA PLANA ───────────────────────────────────────────
function generarClasesPlanas(horario,area){
  const mapa={};
  for(const franja of horario){
    const [ini,fin]=franja.hora.split('-');
    for(const [dia,clases] of Object.entries(franja.dias)){
      for(const nombre of clases){
        const key=nombre+'|'+franja.hora+'|'+dia;
        if(!mapa[key])mapa[key]={nombre,inicio:ini,fin,area,dia,dias:[dia],icono:getIcono(nombre),hora:franja.hora};
      }
    }
  }
  return Object.values(mapa);
}

// ── PUBLICAR TODO / PUB GRID ─────────────────────────────────────
let clasesPlanas=[];
function recalcPlanas(){
  clasesPlanas=[
    ...generarClasesPlanas(HORARIO_FITNESS,'fitness'),
    ...generarClasesPlanas(HORARIO_GIMNASIA,'gimnasia')
  ];
  document.getElementById('totalClasesCount').innerText=clasesPlanas.length;
  document.getElementById('hPendientes').innerText=clasesPlanas.filter(c=>!clasesEnFirebase.has(fbKey(c.nombre,c.hora,c.dia))).length;
}

function renderPubGrid(){
  recalcPlanas();
  const cupo=parseInt(document.getElementById('cupoPredeterminado')?.value||20);
  document.getElementById('pubGrid').innerHTML=clasesPlanas.map((c,i)=>{
    const k=fbKey(c.nombre,c.hora,c.dia);
    const enFB=clasesEnFirebase.has(k);
    const area=c.area;
    const prof=enFB?(fbDocsMap.get(k)?.profesor||''):(profesoresLocal[k]||'');
    return`<div class="pub-card ${enFB?'en-fb':''}">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:.5rem">
        <div style="display:flex;align-items:start;gap:.5rem">
          <input type="checkbox" class="pub-select" id="pub-check-${i}" style="margin-top:.15rem;cursor:pointer;accent-color:var(--accent2);width:14px;height:14px">
          <div>
            <div class="pub-nombre">${getIcono(c.nombre)} ${c.nombre}</div>
            <div style="font-size:.58rem;font-weight:700;padding:2px 6px;border-radius:4px;margin-top:3px;display:inline-block;background:${area==='fitness'?'rgba(249,115,22,.15)':'rgba(99,102,241,.15)'};color:${area==='fitness'?'var(--fitness)':'var(--gimnasia)'}">${area}</div>
            ${prof?`<div style="font-size:.55rem;color:var(--muted);margin-top:3px">👤 ${prof}</div>`:''}
          </div>
        </div>
        ${enFB?'<span style="color:var(--accent2);font-size:.62rem;font-weight:700">✅ En Firebase</span>':''}
      </div>
      <div class="pub-dias"><span class="dia-chip">${c.dia}</span></div>
      <div class="pub-info">
        <div><div style="font-size:.58rem;color:var(--muted);font-weight:700">Horario</div><div style="font-weight:700;font-size:.72rem">${c.inicio} – ${c.fin}</div></div>
        <div>
          <div class="pub-precio">$${(area==='fitness'?COSTOS_FITNESS[1]:COSTOS_GIMNASIA[1]).toLocaleString('es-MX')}</div>
          <div style="font-size:.57rem;color:var(--accent2);font-weight:700">Pronto: $${(area==='fitness'?COSTOS_FITNESS_PRONTO[1]:COSTOS_GIMNASIA_PRONTO[1]).toLocaleString('es-MX')}</div>
        </div>
      </div>
      <div class="pub-cupo-sel"><span>Cupo:</span>
        <select id="cupo-${i}" style="background:var(--surface);border:1px solid var(--border);color:white;padding:2px 5px;border-radius:4px;font-size:.63rem">
          ${[5,10,15,20,25,30].map(n=>`<option value="${n}" ${n===cupo?'selected':''}>${n}</option>`).join('')}
        </select>
      </div>
      <button class="pub-btn ${enFB?'publicada':'publicar'}" ${enFB?'disabled':''} onclick="publicarUna(${i})">
        ${enFB?'✅ Ya publicada':'🚀 Publicar'}
      </button>
    </div>`;
  }).join('');
}

async function publicarUna(i){
  const c=clasesPlanas[i];
  const cupo=parseInt(document.getElementById('cupo-'+i)?.value||20);
  const costos=c.area==='fitness'?COSTOS_FITNESS:COSTOS_GIMNASIA;
  const pronto=c.area==='fitness'?COSTOS_FITNESS_PRONTO:COSTOS_GIMNASIA_PRONTO;
  const k=fbKey(c.nombre,c.hora,c.dia);
  const profesor=profesoresLocal[k]||fbDocsMap.get(k)?.profesor||'';
  const profesorId=profesor?generarIdProfesor(profesor):'';
  const payload={
    nombre:c.nombre,tipo:'clase',area:c.area,inicio:c.inicio,fin:c.fin,
    dia:c.dia,diasSemana:[c.dia],cupo,cupoDisponible:cupo,
    precio:costos[1],precioPronto:pronto[1],
    icon:c.icono,profesor,profesorId,activa:true,
    timestamp:firebase.firestore.FieldValue.serverTimestamp()
  };
  try{
    if(clasesEnFirebase.has(k)){
      await db.collection('catalogo').doc(fbDocsMap.get(k).id).update(payload);
      toast('🔄 '+c.nombre+' — '+c.dia+' actualizada');
    }else{
      await db.collection('catalogo').add(payload);
      toast('✅ '+c.nombre+' — '+c.dia+' publicada');
    }
  }catch(e){toast('❌ '+e.message);}
}

async function publicarTodo(){
  const cupo=parseInt(document.getElementById('cupoPredeterminado').value||20);
  let ok=0,upd=0,err=0;
  for(let i=0;i<clasesPlanas.length;i++){
    const c=clasesPlanas[i];
    const k=fbKey(c.nombre,c.hora,c.dia);
    const costos=c.area==='fitness'?COSTOS_FITNESS:COSTOS_GIMNASIA;
    const pronto=c.area==='fitness'?COSTOS_FITNESS_PRONTO:COSTOS_GIMNASIA_PRONTO;
    const profesor=profesoresLocal[k]||fbDocsMap.get(k)?.profesor||'';
    const profesorId=profesor?generarIdProfesor(profesor):'';
    const payload={
      nombre:c.nombre,tipo:'clase',area:c.area,inicio:c.inicio,fin:c.fin,
      dia:c.dia,diasSemana:[c.dia],cupo,cupoDisponible:cupo,
      precio:costos[1],precioPronto:pronto[1],
      icon:c.icono,profesor,profesorId,activa:true,
      timestamp:firebase.firestore.FieldValue.serverTimestamp()
    };
    try{
      if(clasesEnFirebase.has(k)){
        await db.collection('catalogo').doc(fbDocsMap.get(k).id).update(payload);
        upd++;
      }else{
        await db.collection('catalogo').add(payload);
        ok++;
      }
    }catch(e){err++;}
  }
  toast('🎉 '+ok+' nuevas · 🔄 '+upd+' actualizadas · ❌ '+err+' errores',5000);
}

// ── CARGA MASIVA ─────────────────────────────────────────────────
async function importarTodas(){
  recalcPlanas();
  const cupo=20;
  document.getElementById('importProgress').style.display='block';
  const log=document.getElementById('importLog');
  let ok=0,upd=0,err=0,pen=clasesPlanas.length;
  document.getElementById('logPen').innerText=pen;
  log.innerHTML='';
  for(const c of clasesPlanas){
    const costos=c.area==='fitness'?COSTOS_FITNESS:COSTOS_GIMNASIA;
    const pronto=c.area==='fitness'?COSTOS_FITNESS_PRONTO:COSTOS_GIMNASIA_PRONTO;
    const k=fbKey(c.nombre,c.hora,c.dia);
    const profesor=profesoresLocal[k]||fbDocsMap.get(k)?.profesor||'';
    const profesorId=profesor?generarIdProfesor(profesor):'';
    const row=document.createElement('div');
    row.className='prog-item';
    row.innerHTML=`<span>${getIcono(c.nombre)} ${c.nombre} · ${c.dia} ${c.inicio}-${c.fin}</span><span class="prog-pen">⏳</span>`;
    log.appendChild(row);
    const payload={
      nombre:c.nombre,tipo:'clase',area:c.area,inicio:c.inicio,fin:c.fin,
      dia:c.dia,diasSemana:[c.dia],cupo,cupoDisponible:cupo,
      precio:costos[1],precioPronto:pronto[1],
      icon:c.icono,profesor,profesorId,activa:true,
      timestamp:firebase.firestore.FieldValue.serverTimestamp()
    };
    try{
      if(clasesEnFirebase.has(k)){
        const docRef=fbDocsMap.get(k);
        if(docRef?.id)await db.collection('catalogo').doc(docRef.id).update(payload);
        row.querySelector('span:last-child').innerHTML='<span class="prog-ok">🔄</span>';upd++;
      }else{
        await db.collection('catalogo').add(payload);
        row.querySelector('span:last-child').innerHTML='<span class="prog-ok">✅</span>';ok++;
      }
    }catch(e){
      row.querySelector('span:last-child').innerHTML='<span class="prog-err">❌</span>';err++;
    }
    pen--;
    document.getElementById('logOk').innerText=ok+upd;
    document.getElementById('logErr').innerText=err;
    document.getElementById('logPen').innerText=pen;
    log.scrollTop=log.scrollHeight;
  }
  toast('🎉 '+ok+' nuevas · 🔄 '+upd+' actualizadas · ❌ '+err+' errores',6000);
}

async function limpiarFirebase(){
  if(!confirm('⚠️ ¿Eliminar TODAS las clases del catálogo? Esta acción no se puede deshacer.'))return;
  const snap=await db.collection('catalogo').where('tipo','==','clase').get();
  const batch=db.batch();
  snap.docs.forEach(d=>batch.delete(d.ref));
  await batch.commit();
  // Reset local horarios to base templates
  HORARIO_FITNESS=JSON.parse(JSON.stringify(HORARIO_FITNESS_BASE));
  HORARIO_GIMNASIA=JSON.parse(JSON.stringify(HORARIO_GIMNASIA_BASE));
  firebaseInited=false;
  toast('🗑️ '+snap.size+' clases eliminadas');
}

// ── NAV ───────────────────────────────────────────────────────────
function switchTab(id,btn){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById('view-'+id).classList.add('active');
  document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  if(id==='publicar')renderPubGrid();
  if(id==='alumno')renderVistaAlumno();
  if(id==='profesores')cargarDisciplinasEnSelect('profDisciplina');
}


// ── Exponer al scope global para onclick handlers del HTML ──────────
window.doLoginAdmin          = doLoginAdmin;
window.doLogoutAdmin         = doLogoutAdmin;
window.toast                 = toast;
window.switchTab             = switchTab;
window.renderGrid            = renderGrid;
window.renderPubGrid         = renderPubGrid;
window.recalcPlanas          = recalcPlanas;
window.abrirCelda            = abrirCelda;
window.cerrarCelda           = cerrarCelda;
window.agregarClase          = agregarClase;
window.agregarSugerida       = agregarSugerida;
window.quitarClase           = quitarClase;
window.cambiarCupo           = cambiarCupo;
window.publicarCelda         = publicarCelda;
window.publicarTodo          = publicarTodo;
window.publicarArea          = publicarArea;
window.importarTodas         = importarTodas;
window.limpiarFirebase       = limpiarFirebase;
window.guardarCostos         = guardarCostos;
window.cargarCostos          = cargarCostos;
window.mostrarMoverClase     = mostrarMoverClase;
window.confirmarMover        = confirmarMover;
window.cambiarCupoClase      = cambiarCupoClase;
window.onProfBlur            = onProfBlur;
window.onCostoClaseBlur      = onCostoClaseBlur;
window.publicarUna           = publicarUna;
window.chipDragStart         = chipDragStart;
window.chipDragEnd           = chipDragEnd;
window.cellDragOver          = cellDragOver;
window.cellDragLeave         = cellDragLeave;
window.cellDrop              = cellDrop;
window.publicarSeleccionadas = publicarSeleccionadas;
window.eliminarSeleccionadas = eliminarSeleccionadas;
window.eliminarTodoFirebase  = eliminarTodoFirebase;
window.actualizarEnFirebase  = actualizarEnFirebase;
window.renderVistaAlumno     = renderVistaAlumno;
window.filtrarProfesores     = filtrarProfesores;
window.emailPreviewProfesor  = emailPreviewProfesor;
window.crearProfesor         = crearProfesor;
window.confirmarCreacionProfesor = confirmarCreacionProfesor;
window.cancelarCreacionProfesor  = cancelarCreacionProfesor;
window.abrirEdicionProfesor  = abrirEdicionProfesor;
window.guardarEdicionProfesor    = guardarEdicionProfesor;
window.cambiarPasswordProfesor   = cambiarPasswordProfesor;
window.eliminarProfesor      = eliminarProfesor;
window.cargarDisciplinasEnSelect = cargarDisciplinasEnSelect;

// ── INIT ADMIN LISTENERS ─────────────────────────────────────────────────
function initAdminListeners(){
    if(_unsubCatalogo)return;
    _unsubCatalogo=db.collection('catalogo').where('tipo','==','clase').onSnapshot(snap=>{
        // ── Procesar snapshot de catálogo ──────────────────────────────────
        fbDocsMap=new Map();
        snap.docs.forEach(d=>{
            const x=d.data();
            const k=fbKey(x.nombre,x.inicio+'-'+x.fin,x.dia||'');
            fbDocsMap.set(k,{...x,id:d.id});
            // Sync professor from Firebase to local
            if(x.profesor)profesoresLocal[k]=x.profesor;
        });
        clasesEnFirebase=new Set(fbDocsMap.keys());
        document.getElementById('hTotalClases').innerText=snap.size;
        // First snapshot with data: rebuild local horarios from Firebase
        if(!firebaseInited&&snap.size>0){
            initHorariosFromFirebase();
        }
        firebaseInited=true;
        renderGrid(HORARIO_FITNESS,'gridFitness','fitness');
        renderGrid(HORARIO_GIMNASIA,'gridGimnasia','gimnasia');
        recalcPlanas();
        // Re-render active edit panel if open
        if(celdaActiva){
            renderEditPanel(celdaActiva.hora,celdaActiva.dia,celdaActiva.area,celdaActiva.franjaIdx);
        }
    });
    _unsubAlumnosCount=db.collection('alumnos').onSnapshot(s=>document.getElementById('hTotalAlumnos').innerText=s.size);
    cargarListaProfesores();
    cargarCostos();
} // end initAdminListeners

// ── PUBLICAR / ELIMINAR SELECCIONADAS ────────────────────────────
async function publicarSeleccionadas(){
  const checks=[...document.querySelectorAll('.pub-select:checked')];
  if(!checks.length){toast('⚠️ Selecciona al menos una clase');return;}
  const cupo=parseInt(document.getElementById('cupoPredeterminado').value||20);
  let ok=0,upd=0,err=0;
  for(const cb of checks){
    const i=parseInt(cb.id.replace('pub-check-',''));
    const c=clasesPlanas[i];if(!c)continue;
    const k=fbKey(c.nombre,c.hora,c.dia);
    const costos=c.area==='fitness'?COSTOS_FITNESS:COSTOS_GIMNASIA;
    const pronto=c.area==='fitness'?COSTOS_FITNESS_PRONTO:COSTOS_GIMNASIA_PRONTO;
    const profesor=profesoresLocal[k]||fbDocsMap.get(k)?.profesor||'';
    const profesorId=profesor?generarIdProfesor(profesor):'';
    const payload={
      nombre:c.nombre,tipo:'clase',area:c.area,inicio:c.inicio,fin:c.fin,
      dia:c.dia,diasSemana:[c.dia],cupo,cupoDisponible:cupo,
      precio:costos[1],precioPronto:pronto[1],
      icon:c.icono,profesor,profesorId,activa:true,
      timestamp:firebase.firestore.FieldValue.serverTimestamp()
    };
    try{
      if(clasesEnFirebase.has(k)){
        const docRef=fbDocsMap.get(k);
        if(docRef?.id)await db.collection('catalogo').doc(docRef.id).update(payload);
        upd++;
      }else{
        await db.collection('catalogo').add(payload);ok++;
      }
    }catch(e){err++;}
  }
  toast('✅ '+ok+' publicadas · 🔄 '+upd+' actualizadas · ❌ '+err+' errores',5000);
}

async function eliminarSeleccionadas(){
  const checks=[...document.querySelectorAll('.pub-select:checked')];
  const enFB=checks.filter(cb=>{
    const i=parseInt(cb.id.replace('pub-check-',''));
    const c=clasesPlanas[i];
    return c&&clasesEnFirebase.has(fbKey(c.nombre,c.hora,c.dia));
  });
  if(!enFB.length){toast('⚠️ Ninguna clase seleccionada está en Firebase');return;}
  if(!confirm('¿Eliminar '+enFB.length+' clase(s) seleccionadas de Firebase?'))return;
  const batch=db.batch();
  for(const cb of enFB){
    const i=parseInt(cb.id.replace('pub-check-',''));
    const c=clasesPlanas[i];
    const k=fbKey(c.nombre,c.hora,c.dia);
    const docData=fbDocsMap.get(k);
    if(docData)batch.delete(db.collection('catalogo').doc(docData.id));
  }
  await batch.commit();
  toast('🗑️ '+enFB.length+' clases eliminadas de Firebase');
}

async function eliminarTodoFirebase(){
  if(!confirm('⚠️ ¿Eliminar TODAS las clases del catálogo? Esta acción no se puede deshacer.'))return;
  const snap=await db.collection('catalogo').where('tipo','==','clase').get();
  const batch=db.batch();
  snap.docs.forEach(d=>batch.delete(d.ref));
  await batch.commit();
  HORARIO_FITNESS=JSON.parse(JSON.stringify(HORARIO_FITNESS_BASE));
  HORARIO_GIMNASIA=JSON.parse(JSON.stringify(HORARIO_GIMNASIA_BASE));
  firebaseInited=false;
  toast('🗑️ '+snap.size+' clases eliminadas');
}

// ── ACTUALIZAR MASIVO EN FIREBASE ─────────────────────────────────
async function actualizarEnFirebase(){
  if(!clasesEnFirebase.size){toast('⚠️ No hay clases en Firebase para actualizar');return;}
  if(!confirm('¿Actualizar '+clasesEnFirebase.size+' clases en Firebase con los datos actuales?'))return;
  document.getElementById('importProgress').style.display='block';
  const log=document.getElementById('importLog');
  let ok=0,err=0,pen=fbDocsMap.size;
  document.getElementById('logPen').innerText=pen;
  log.innerHTML='';
  for(const[k,docData]of fbDocsMap){
    const row=document.createElement('div');
    row.className='prog-item';
    row.innerHTML=`<span>${getIcono(docData.nombre)} ${docData.nombre} · ${docData.dia} ${docData.inicio}-${docData.fin}</span><span class="prog-pen">⏳</span>`;
    log.appendChild(row);
    const area=docData.area;
    const costos=area==='fitness'?COSTOS_FITNESS:COSTOS_GIMNASIA;
    const pronto=area==='fitness'?COSTOS_FITNESS_PRONTO:COSTOS_GIMNASIA_PRONTO;
    const profesor=profesoresLocal[k]||docData.profesor||'';
    const cupo=cuposClase[k]??docData.cupo??getCupo(docData.inicio+'-'+docData.fin,docData.dia);
    const precio=(preciosClase[k]?.precio!=null)?preciosClase[k].precio:(docData.precio??costos[1]);
    const precioPronto=(preciosClase[k]?.precioPronto!=null)?preciosClase[k].precioPronto:(docData.precioPronto??pronto[1]);
    try{
      await db.collection('catalogo').doc(docData.id).update({
        profesor,cupo,cupoDisponible:cupo,precio,precioPronto,
        updatedAt:firebase.firestore.FieldValue.serverTimestamp()
      });
      row.querySelector('span:last-child').innerHTML='<span class="prog-ok">✅</span>';ok++;
    }catch(e){
      row.querySelector('span:last-child').innerHTML='<span class="prog-err">❌</span>';err++;
    }
    pen--;
    document.getElementById('logOk').innerText=ok;
    document.getElementById('logErr').innerText=err;
    document.getElementById('logPen').innerText=pen;
    log.scrollTop=log.scrollHeight;
  }
  toast('🎉 Actualización completa: '+ok+' clases',6000);
}

// ── VISTA ALUMNO ─────────────────────────────────────────────────
let _vaArea='fitness';

function renderVistaAlumno(area){
  _vaArea=area||_vaArea;
  document.getElementById('btnVaFit').style.opacity=_vaArea==='fitness'?'1':'.5';
  document.getElementById('btnVaGym').style.opacity=_vaArea==='gimnasia'?'1':'.5';

  const horario=_vaArea==='fitness'?HORARIO_FITNESS:HORARIO_GIMNASIA;
  const color=_vaArea==='fitness'?'var(--fitness)':'var(--gimnasia)';

  // Agrupar por disciplina: nombre → { porDia: {dia:[{hora,inicio,fin}]}, profesores: Set }
  const disciplinas={};
  for(const franja of horario){
    const [ini,fin]=franja.hora.split('-');
    for(const [dia,clases] of Object.entries(franja.dias)){
      for(const nombre of clases){
        if(!disciplinas[nombre])disciplinas[nombre]={porDia:{},profesores:new Set()};
        if(!disciplinas[nombre].porDia[dia])disciplinas[nombre].porDia[dia]=[];
        disciplinas[nombre].porDia[dia].push({hora:franja.hora,inicio:ini,fin});
        const prof=getProf(nombre,franja.hora,dia);
        if(prof)disciplinas[nombre].profesores.add(prof);
      }
    }
  }

  const ORDEN_DIAS=['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];

  const html=Object.entries(disciplinas).sort((a,b)=>a[0].localeCompare(b[0])).map(([nombre,info])=>{
    const cc=getChipClass(nombre);
    const icono=getIcono(nombre);
    const porDia=info.porDia;
    const totalSlots=Object.values(porDia).reduce((s,h)=>s+h.length,0);
    const diasCount=Object.keys(porDia).length;
    const profesores=[...info.profesores].join(', ');

    const diasHtml=ORDEN_DIAS.filter(d=>porDia[d]).map(dia=>{
      const horas=porDia[dia];
      return`
        <div style="margin-bottom:.5rem">
          <p style="font-size:.58rem;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:${color};margin-bottom:.25rem">${dia}</p>
          <div style="display:flex;flex-wrap:wrap;gap:3px">
            ${horas.map(h=>`<span style="font-size:.62rem;font-weight:700;padding:2px 8px;border-radius:5px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:var(--txt)">${h.inicio}–${h.fin}</span>`).join('')}
          </div>
        </div>`;
    }).join('');

    return`<div style="background:var(--surface);border:1.5px solid var(--border);border-radius:14px;padding:1.1rem;transition:all .2s" onmouseover="this.style.borderColor='${color}'" onmouseout="this.style.borderColor='var(--border)'">
      <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.9rem">
        <div class="clase-chip ${cc}" style="padding:4px 10px;font-size:.65rem">${icono} ${nombre}</div>
        <div style="margin-left:auto;text-align:right">
          <p style="font-size:.8rem;font-weight:900;font-family:'Bebas Neue';letter-spacing:1px;color:${color}">${diasCount} día${diasCount!==1?'s':''}/sem</p>
          <p style="font-size:.55rem;color:var(--muted);font-weight:600">${totalSlots} horario${totalSlots!==1?'s':''}</p>
        </div>
      </div>
      ${profesores?`<div style="font-size:.58rem;color:var(--muted);font-weight:600;margin-bottom:.6rem;padding:.3rem .5rem;background:rgba(255,255,255,.03);border-radius:5px">👤 ${profesores}</div>`:''}
      <div style="border-top:1px solid var(--border);padding-top:.7rem">
        ${diasHtml}
      </div>
    </div>`;
  }).join('');

  document.getElementById('vistaAlumnoGrid').innerHTML=html||
    '<p style="color:var(--muted);font-size:.8rem;font-weight:600;padding:2rem;grid-column:1/-1;text-align:center">Sin clases configuradas</p>';
}

// ── PROFESORES ────────────────────────────────────────────────────

function _esc(str){
  if(!str)return'';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function generarIdProfesor(nombre){
  return nombre.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/\s+/g,'-')
    .replace(/[^a-z0-9-]/g,'')
    .replace(/-+/g,'-')
    .replace(/^-|-$/g,'');
}

function emailPreviewProfesor(){
  const nombre=document.getElementById('profNombre').value;
  const id=generarIdProfesor(nombre);
  const email=id?'profe.'+id+'@prisma.com':'—';
  const el=document.getElementById('profEmailPreview');
  if(el)el.textContent=email;
}

async function crearProfesor(){
  const nombre=(document.getElementById('profNombre').value||'').trim();
  const celular=(document.getElementById('profCelular').value||'').trim();
  const disciplina=document.getElementById('profDisciplina').value||'';
  const password=document.getElementById('profPassword').value||'';
  if(!nombre){toast('⚠️ Ingresa el nombre del profesor');return;}
  if(!celular){toast('⚠️ Ingresa el celular del profesor');return;}
  if(password.length<6){toast('⚠️ La contraseña debe tener al menos 6 caracteres');return;}
  const profesorId=generarIdProfesor(nombre);
  if(!profesorId){toast('⚠️ Nombre inválido para generar ID');return;}
  const emailInterno='profe.'+profesorId+'@prisma.com';
  // Check if profesor doc already exists
  try{
    const snap=await db.collection('profesores').doc(profesorId).get();
    if(snap.exists){toast('⚠️ Ya existe un profesor con ese nombre/ID: '+profesorId);return;}
  }catch(e){toast('❌ Error al verificar: '+e.message);return;}
  _pendingProfesorData={nombre,celular,disciplina,profesorId,emailInterno,password};
  document.getElementById('adminPwdConfirm').value='';
  document.getElementById('modalConfirmAdminPwd').style.display='flex';
}

async function confirmarCreacionProfesor(){
  const adminPwd=document.getElementById('adminPwdConfirm').value;
  if(!adminPwd){toast('Ingresa tu contraseña de admin');return;}
  const{nombre,celular,disciplina,profesorId,emailInterno,password}=_pendingProfesorData;
  const adminEmail=firebase.auth().currentUser.email;
  document.getElementById('modalConfirmAdminPwd').style.display='none';
  toast('⏳ Creando usuario...');
  let profesorUID=null;
  try{
    const cred=await firebase.auth().createUserWithEmailAndPassword(emailInterno,password);
    profesorUID=cred.user.uid;
    await firebase.auth().signOut();
    await firebase.auth().signInWithEmailAndPassword(adminEmail,adminPwd);
    await db.collection('profesores').doc(profesorId).set({
      nombre,celular,
      disciplina:disciplina||'',
      authUID:profesorUID,
      correo:emailInterno,
      createdAt:firebase.firestore.FieldValue.serverTimestamp()
    });
    if(disciplina){
      const snapCat=await db.collection('catalogo')
        .where('tipo','==','clase')
        .where('nombre','==',disciplina).get();
      const batch=db.batch();
      snapCat.docs.forEach(d=>batch.update(d.ref,{profesor:nombre,profesorId}));
      if(!snapCat.empty)await batch.commit();
    }
    document.getElementById('profNombre').value='';
    document.getElementById('profCelular').value='';
    document.getElementById('profDisciplina').value='';
    document.getElementById('profPassword').value='';
    document.getElementById('profEmailPreview').textContent='—';
    _pendingProfesorData=null;
    toast('✅ Profesor '+nombre+' creado correctamente');
  }catch(e){
    console.error('Error creando profesor:',e);
    if(profesorUID&&!firebase.auth().currentUser){
      try{await firebase.auth().signInWithEmailAndPassword(adminEmail,adminPwd);}catch(_){}
    }
    toast('❌ Error: '+(e.message||'Error desconocido'));
  }
}

function cancelarCreacionProfesor(){
  document.getElementById('modalConfirmAdminPwd').style.display='none';
  document.getElementById('adminPwdConfirm').value='';
  _pendingProfesorData=null;
}

function cargarListaProfesores(){
  if(_unsubProfesores){_unsubProfesores();_unsubProfesores=null;}
  _unsubProfesores=db.collection('profesores').orderBy('nombre').onSnapshot(snap=>{
    _profesoresCached=snap.docs.map(d=>({id:d.id,...d.data()}));
    const countEl=document.getElementById('profCount');
    if(countEl)countEl.textContent=_profesoresCached.length+' profesores';
    renderListaProfesores(_profesoresCached);
    cargarDisciplinasEnSelect('profDisciplina');
    cargarDisciplinasEnSelect('editProfDisciplina');
  },err=>{
    console.error('Error cargando profesores:',err);
  });
}

function renderListaProfesores(lista){
  const cont=document.getElementById('listaProfesores');
  if(!cont)return;
  if(!lista||lista.length===0){
    cont.innerHTML='<p style="font-size:.7rem;color:var(--muted);text-align:center;padding:1.5rem 0">Sin profesores registrados</p>';
    return;
  }
  cont.innerHTML=lista.map(p=>{
    const inicial=(p.nombre||'?').charAt(0).toUpperCase();
    const idEsc=_esc(p.id);
    return`<div style="background:rgba(255,255,255,.03);border:1px solid var(--border);border-radius:7px;padding:.6rem .8rem;margin-bottom:.4rem;display:flex;align-items:center;gap:.7rem">
      <div style="width:34px;height:34px;border-radius:50%;background:rgba(165,180,252,.2);border:1px solid rgba(165,180,252,.35);display:flex;align-items:center;justify-content:center;font-weight:900;font-size:.9rem;color:#a5b4fc;flex-shrink:0">${_esc(inicial)}</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:.78rem;margin-bottom:.15rem">${_esc(p.nombre)||'—'}</div>
        <div style="font-size:.62rem;color:var(--muted)">📱 ${_esc(p.celular)||'—'} · 🎯 ${_esc(p.disciplina)||'Sin disciplina'}</div>
        <div style="font-size:.58rem;color:var(--muted);margin-top:.1rem">📧 ${_esc(p.correo||'profe.'+p.id+'@prisma.com')}</div>
      </div>
      <button onclick="abrirEdicionProfesor('${idEsc}')"
        style="background:rgba(165,180,252,.12);color:#a5b4fc;border:1px solid rgba(165,180,252,.25);border-radius:6px;padding:.3rem .7rem;font-size:.62rem;font-weight:700;cursor:pointer;flex-shrink:0">✏️ Editar</button>
    </div>`;
  }).join('');
}

function filtrarProfesores(query){
  const q=(query||'').toLowerCase();
  const filtrado=q?_profesoresCached.filter(p=>(p.nombre||'').toLowerCase().includes(q)):_profesoresCached;
  renderListaProfesores(filtrado);
}

function cargarDisciplinasEnSelect(selectId){
  const sel=document.getElementById(selectId);
  if(!sel)return;
  const nombres=new Set();
  fbDocsMap.forEach(d=>{if(d.nombre)nombres.add(d.nombre);});
  const sorted=[...nombres].sort();
  const current=sel.value;
  sel.innerHTML='<option value="">— Sin disciplina asignada —</option>';
  sorted.forEach(n=>{
    const op=document.createElement('option');
    op.value=n;op.textContent=n;
    sel.appendChild(op);
  });
  if(current)sel.value=current;
}

function abrirEdicionProfesor(id){
  _profesorEditandoId=id;
  const prof=_profesoresCached.find(p=>p.id===id);
  if(!prof){document.getElementById('profEditPanel').innerHTML='<p style="font-size:.7rem;color:var(--muted);text-align:center;padding:1.5rem 0">Profesor no encontrado</p>';return;}
  const inputStyle='width:100%;background:rgba(255,255,255,.05);border:1px solid var(--border);border-radius:7px;padding:.45rem .6rem;color:var(--txt);font-size:.73rem;font-family:\'DM Sans\',sans-serif;outline:none;box-sizing:border-box;margin-bottom:.5rem';
  const labelStyle='font-size:.56rem;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);display:block;margin-bottom:.2rem';
  document.getElementById('profEditPanel').innerHTML=`
    <div style="font-size:.7rem;font-weight:700;color:#a5b4fc;margin-bottom:.8rem;padding:.4rem .6rem;background:rgba(165,180,252,.08);border-radius:6px">${_esc(prof.nombre)}</div>
    <label style="${labelStyle}">Nombre</label>
    <input id="editProfNombre" type="text" value="${_esc(prof.nombre||'')}" style="${inputStyle}">
    <label style="${labelStyle}">Celular</label>
    <input id="editProfCelular" type="text" value="${_esc(prof.celular||'')}" style="${inputStyle}">
    <label style="${labelStyle}">Disciplina asignada</label>
    <select id="editProfDisciplina" style="${inputStyle};padding:.45rem .5rem">
      <option value="">— Sin disciplina asignada —</option>
    </select>
    <button onclick="guardarEdicionProfesor()" class="btn" style="width:100%;background:rgba(165,180,252,.18);color:#a5b4fc;border:1px solid rgba(165,180,252,.35);margin-bottom:.8rem">💾 Guardar cambios</button>
    <div style="border-top:1px solid var(--border);padding-top:.8rem;margin-bottom:.8rem">
      <label style="${labelStyle}">Nueva contraseña (mín. 6 chars)</label>
      <div style="position:relative;margin-bottom:.5rem">
        <input id="editProfNewPwd" type="password" placeholder="••••••••" style="${inputStyle};margin-bottom:0;padding-right:2rem">
        <button onclick="this.previousElementSibling.type=this.previousElementSibling.type==='password'?'text':'password'"
          style="position:absolute;right:.4rem;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--muted);cursor:pointer;font-size:.75rem;padding:0">👁</button>
      </div>
      <button onclick="cambiarPasswordProfesor()" class="btn btn-ghost" style="width:100%;margin-bottom:.8rem">🔑 Actualizar contraseña</button>
    </div>
    <div style="border-top:1px solid var(--border);padding-top:.8rem">
      <button onclick="eliminarProfesor()" class="btn-danger-sm" style="width:100%">🗑️ Eliminar profesor</button>
    </div>
  `;
  // Populate disciplinas in edit select and set current value
  cargarDisciplinasEnSelect('editProfDisciplina');
  const editSel=document.getElementById('editProfDisciplina');
  if(editSel&&prof.disciplina)editSel.value=prof.disciplina;
}

async function guardarEdicionProfesor(){
  if(!_profesorEditandoId)return;
  const nombre=(document.getElementById('editProfNombre').value||'').trim();
  const celular=(document.getElementById('editProfCelular').value||'').trim();
  const disciplina=document.getElementById('editProfDisciplina').value||'';
  if(!nombre){toast('⚠️ El nombre es requerido');return;}
  const prof=_profesoresCached.find(p=>p.id===_profesorEditandoId);
  const oldDisciplina=prof?prof.disciplina||'':'';
  try{
    await db.collection('profesores').doc(_profesorEditandoId).update({nombre,celular,disciplina});
    // Update catalogo: remove from old discipline, assign to new
    if(oldDisciplina&&oldDisciplina!==disciplina){
      const snapOld=await db.collection('catalogo')
        .where('tipo','==','clase')
        .where('profesorId','==',_profesorEditandoId).get();
      if(!snapOld.empty){
        const batch=db.batch();
        snapOld.docs.forEach(d=>batch.update(d.ref,{profesor:'',profesorId:''}));
        await batch.commit();
      }
    }
    if(disciplina){
      const snapNew=await db.collection('catalogo')
        .where('tipo','==','clase')
        .where('nombre','==',disciplina).get();
      if(!snapNew.empty){
        const batch=db.batch();
        snapNew.docs.forEach(d=>batch.update(d.ref,{profesor:nombre,profesorId:_profesorEditandoId}));
        await batch.commit();
      }
    }
    toast('✅ Profesor actualizado correctamente');
  }catch(e){
    toast('❌ Error: '+e.message);
  }
}

async function cambiarPasswordProfesor(){
  if(!_profesorEditandoId)return;
  const pwd=(document.getElementById('editProfNewPwd').value||'').trim();
  if(pwd.length<6){toast('⚠️ La contraseña debe tener al menos 6 caracteres');return;}
  try{
    await db.collection('profesores').doc(_profesorEditandoId).update({passwordPendiente:pwd});
    document.getElementById('editProfNewPwd').value='';
    toast('✅ Contraseña actualizada. Se aplicará en el próximo inicio de sesión del profesor.');
  }catch(e){
    toast('❌ Error: '+e.message);
  }
}

async function eliminarProfesor(){
  if(!_profesorEditandoId)return;
  const prof=_profesoresCached.find(p=>p.id===_profesorEditandoId);
  if(!confirm('¿Eliminar al profesor '+(prof?.nombre||_profesorEditandoId)+'?\n\nEsta acción no se puede deshacer. Las clases asignadas a este profesor quedarán sin profesor asignado.'))return;
  try{
    const snapCat=await db.collection('catalogo')
      .where('profesorId','==',_profesorEditandoId).get();
    if(!snapCat.empty){
      const batch=db.batch();
      snapCat.docs.forEach(d=>batch.update(d.ref,{profesor:'',profesorId:''}));
      await batch.commit();
    }
    await db.collection('profesores').doc(_profesorEditandoId).delete();
    _profesorEditandoId=null;
    const panel=document.getElementById('profEditPanel');
    if(panel)panel.innerHTML='<p style="font-size:.7rem;color:var(--muted);text-align:center;padding:1.5rem 0">Selecciona un profesor para editarlo</p>';
    toast('🗑️ Profesor eliminado. Nota: el acceso en Firebase Auth debe eliminarse manualmente en la consola de Firebase.');
  }catch(e){
    toast('❌ Error: '+e.message);
  }
}
