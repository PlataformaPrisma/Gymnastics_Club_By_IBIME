// ════════════════════════════════════════════════════════════════
// CONFIG
// ════════════════════════════════════════════════════════════════
// Firebase inicializado por assets/js/firebase-init.js
const URL_GAS="https://script.google.com/macros/s/AKfycbwZg7nmuTA27A3rT6Pn6uDyfB4eyzbrFP5js09VNC1L-iMqG__DIvlFS59oH90HHu1Q/exec";
let INSCRIPCION_MONTO=800;
// Paquetes: clases → {n: precio normal, p: precio pronto pago}
// Valores de fallback; se sobreescriben al cargar desde Firebase en cargarPreciosAlumno()
let PAQUETES_FITNESS  ={1:{n:240,p:240},2:{n:480,p:480},3:{n:720,p:720},4:{n:960,p:960},5:{n:1200,p:1200}};
let PAQUETES_GIMNASIA ={1:{n:850,p:765},2:{n:1600,p:1440},3:{n:2200,p:1980},4:{n:2750,p:2475},5:{n:3200,p:2880}};
const PKG_OPTS=[1,2,3,4,5];
const $=id=>document.getElementById(id);

const db=firebase.firestore(),rtdb=firebase.database();

let USER=null,CART=[],CATALOGO=[],MIS_RESERVAS=[],ORDEN_ACTIVA=null;
let AREA_SEL=null,DISCIPS_SEL=new Set(),PKG=1;
// Handle for checkClaseActual periodic timer — stored so it can be cleared on logout
let _checkClaseInterval=null;
// Etapa 2: plan semanal
let PLAN_Y=4; // número de clases por semana seleccionadas
let SLOTS_SEL=[]; // array de slots seleccionados: [{claseId,claseNombre,dia,hora,horaFin,profesor,area,icon}]
let _modifSlotKey=null; // slotKey del slot que se está modificando
let _modifNuevoSlot=null; // nuevo slot seleccionado para aplicar
let _slotAccordion={}; // Estado de acordeones en el selector de slots (paso 3)
let _modifAccordion={}; // Estado de acordeones en el modal de modificación
let _modifEjSlot=null; // slot de referencia activo en el modal de modificación

// ════════════════════════════════════════════════════════════════
// TOAST
// ════════════════════════════════════════════════════════════════
function toast(msg,ms=3000){const t=$('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),ms);}

// ════════════════════════════════════════════════════════════════
// CARGAR PRECIOS DESDE FIREBASE
// ════════════════════════════════════════════════════════════════
async function cargarPreciosAlumno(){
    try{
        const df=await db.collection('config').doc('costos_fitness').get();
        if(df.exists){const d=df.data();PAQUETES_FITNESS={1:{n:d.d1,p:d.p1},2:{n:d.d2,p:d.p2},3:{n:d.d3,p:d.p3},4:{n:d.d4,p:d.p4},5:{n:d.d5,p:d.p5}};}
    }catch(e){console.warn('No se pudieron cargar costos fitness:',e);}
    try{
        const dg=await db.collection('config').doc('costos_gimnasia').get();
        if(dg.exists){const d=dg.data();PAQUETES_GIMNASIA={1:{n:d.d1,p:d.p1},2:{n:d.d2,p:d.p2},3:{n:d.d3,p:d.p3},4:{n:d.d4,p:d.p4},5:{n:d.d5,p:d.p5}};}
    }catch(e){console.warn('No se pudieron cargar costos gimnasia:',e);}
    try{
        const di=await db.collection('config').doc('inscripcion').get();
        if(di.exists&&di.data().monto)INSCRIPCION_MONTO=Number(di.data().monto)||800;
    }catch(e){console.warn('No se pudo cargar config inscripcion:',e);}
}

// ════════════════════════════════════════════════════════════════
// LOGIN HELPERS
// ════════════════════════════════════════════════════════════════
function switchLTab(t){
    ['login','reset'].forEach(k=>{
        $('ltab-'+k).classList.toggle('active',k===t);
        $('lpanel-'+k).classList.toggle('on',k===t);
    });
}
function toggleEye(id,btn){const i=$( id);const s=i.type==='password';i.type=s?'text':'password';btn.innerHTML=s?'<i class="fa-solid fa-eye-slash"></i>':'<i class="fa-solid fa-eye"></i>';}
function showLErr(panel,msg){const e=$('lerr-'+panel),s=$('lerr-'+panel+'-msg');s.textContent=msg;e.classList.add('on');}
function hideLErr(panel){$('lerr-'+panel).classList.remove('on');}

// ════════════════════════════════════════════════════════════════
// SESIÓN
// ════════════════════════════════════════════════════════════════
let _curpAttempts=0;
const MAX_CURP_ATTEMPTS=5;

window.addEventListener('DOMContentLoaded',async()=>{
    await cargarPreciosAlumno();
    const s=localStorage.getItem('ib_session');
    if(s){
        try{
            const {id}=JSON.parse(s);
            if(id){
                const snap=await db.collection('alumnos').doc(id).get();
                if(snap.exists){USER={id,...snap.data()};delete USER.password;delete USER.pin;delete USER.curp;entrarPortal();}
                else{localStorage.removeItem('ib_session');}
            }
        }catch{localStorage.removeItem('ib_session');}
    }
});

// ════════════════════════════════════════════════════════════════
// SOCIAL LOGIN (Google / Apple) — opcional para alumnos públicos
// ════════════════════════════════════════════════════════════════
let _socialUserPending = null; // Firebase user waiting to be linked

async function loginConGoogle() {
    try {
        const provider = new firebase.auth.GoogleAuthProvider();
        const result = await firebase.auth().signInWithPopup(provider);
        await _procesarLoginSocial(result.user);
    } catch(e) {
        if (e.code !== 'auth/popup-closed-by-user') {
            showLErr('login', 'Error con Google: ' + e.message);
        }
    }
}

async function loginConApple() {
    try {
        const provider = new firebase.auth.OAuthProvider('apple.com');
        provider.addScope('email');
        provider.addScope('name');
        const result = await firebase.auth().signInWithPopup(provider);
        await _procesarLoginSocial(result.user);
    } catch(e) {
        if (e.code !== 'auth/popup-closed-by-user') {
            showLErr('login', 'Error con Apple: ' + e.message);
        }
    }
}

async function _procesarLoginSocial(user) {
    // Check if this UID is already linked to an alumno document
    const snap = await db.collection('alumnos').where('authUID', '==', user.uid).limit(1).get();
    if (!snap.empty) {
        // Already linked — enter portal directly
        const doc = snap.docs[0];
        const data = doc.data();
        localStorage.setItem('ib_session', doc.id);
        USER = { id: doc.id, ...data };
        delete USER.password; delete USER.pin; delete USER.curp;
        entrarPortal();
    } else {
        // First time — show link modal
        _socialUserPending = user;
        document.getElementById('modalVincular').style.display = 'flex';
    }
}

async function confirmarVinculo() {
    const id = document.getElementById('vincularID').value.trim().toUpperCase();
    const errEl = document.getElementById('vincularErr');
    errEl.style.display = 'none';
    if (!id || !_socialUserPending) return;
    try {
        const snap = await db.collection('alumnos').doc(id).get();
        if (!snap.exists) { errEl.textContent = 'ID no encontrado'; errEl.style.display = 'block'; return; }
        // Save authUID to alumno document
        await db.collection('alumnos').doc(id).update({ authUID: _socialUserPending.uid });
        localStorage.setItem('ib_session', id);
        const data = snap.data();
        USER = { id, ...data, authUID: _socialUserPending.uid };
        delete USER.password; delete USER.pin; delete USER.curp;
        document.getElementById('modalVincular').style.display = 'none';
        _socialUserPending = null;
        entrarPortal();
    } catch(e) {
        errEl.textContent = 'Error: ' + e.message; errEl.style.display = 'block';
    }
}

function cancelarVinculo() {
    document.getElementById('modalVincular').style.display = 'none';
    if (_socialUserPending) { firebase.auth().signOut().catch(() => {}); _socialUserPending = null; }
}

// ════════════════════════════════════════════════════════════════
// DO LOGIN
// ════════════════════════════════════════════════════════════════
async function doLogin(){
    const id=$( 'li-id').value.trim().toUpperCase();
    const pass=$( 'li-pass').value.trim();
    const btn=$( 'btn-login');
    if(!id||!pass){showLErr('login','Completa tu ID y contraseña');return;}
    hideLErr('login');
    btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin" style="margin-right:6px"></i>Verificando...';
    try{
        const snap=await db.collection('alumnos').doc(id).get();
        if(!snap.exists){showLErr('login','Matrícula "'+id+'" no encontrada');return;}
        const data=snap.data();
        const passStr=String(pass||'');
        const ok=(String(data.password||'')===passStr)||(String(data.pin||'')===passStr);
        if(!ok){showLErr('login','Contraseña incorrecta');return;}
        USER={id,...data};
        delete USER.password;delete USER.pin;delete USER.curp;
        localStorage.setItem('ib_session',JSON.stringify({id}));
        entrarPortal();
        // ✅ AUDITORÍA
        if (typeof AuditModule !== 'undefined') {
          AuditModule.auditLoginAlumno(id, 'curp_password');
        }
    }catch(e){showLErr('login','Error: '+e.message);}
    finally{btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-arrow-right-to-bracket" style="margin-right:6px"></i>Ingresar';}
}

// ════════════════════════════════════════════════════════════════
// RESTABLECER CONTRASEÑA
// ════════════════════════════════════════════════════════════════
let _rAlumno=null;
async function verificarCURP(){
    if(_curpAttempts>=MAX_CURP_ATTEMPTS){showLErr('reset','Demasiados intentos. Recarga la página.');return;}
    const id=$( 'ri-id').value.trim().toUpperCase();
    const curp=$( 'ri-curp').value.trim().toUpperCase();
    if(!id||curp.length!==18){showLErr('reset','Ingresa ID y CURP de 18 caracteres');return;}
    const btn=$( 'btn-verificar');
    btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin" style="margin-right:6px"></i>Verificando...';
    try{
        const snap=await db.collection('alumnos').doc(id).get();
        if(!snap.exists){_curpAttempts++;showLErr('reset','Matrícula no encontrada');return;}
        const data=snap.data();
        if(String(data.curp||'?').toUpperCase()!==curp){_curpAttempts++;showLErr('reset','CURP no coincide con el registro');return;}
        _rAlumno={id,...data};
        $( 'lerr-reset').classList.remove('on');
        $( 'ri-nueva-wrap').style.display='block';
        btn.style.display='none';
    }catch(e){showLErr('reset','Error: '+e.message);}
    finally{btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-shield-check" style="margin-right:6px"></i>Verificar Identidad';}
}
async function guardarNuevaPass(){
    const p1=$( 'ri-p1').value;const p2=$( 'ri-p2').value;
    if(p1.length<6){showLErr('reset','Mínimo 6 caracteres');return;}
    if(p1!==p2){showLErr('reset','Las contraseñas no coinciden');return;}
    if(!_rAlumno)return;
    await db.collection('alumnos').doc(_rAlumno.id).update({password:p1,pin:p1,primerAcceso:false});
    $( 'lsuccess-msg').textContent='¡Contraseña actualizada! Ya puedes iniciar sesión.';
    $( 'lsuccess-reset').classList.add('on');
    $( 'ri-nueva-wrap').style.display='none';
    setTimeout(()=>{switchLTab('login');$( 'li-id').value=_rAlumno.id;_rAlumno=null;},2000);
}

// ════════════════════════════════════════════════════════════════
// ENTRAR AL PORTAL (animación)
// ════════════════════════════════════════════════════════════════
function entrarPortal(){
    const portal=$( 'screen-portal');
    portal.classList.add('visible');
    iniciarPortal();
}
function logout(){
    if(_checkClaseInterval){clearInterval(_checkClaseInterval);_checkClaseInterval=null;}
    localStorage.removeItem('ib_session');
    location.reload();
}

// ════════════════════════════════════════════════════════════════
// INICIAR PORTAL
// ════════════════════════════════════════════════════════════════
function iniciarPortal(){
    cargarPreciosAlumno();
    // Drawer
    $('drawerNombre').textContent=USER.nombre?.split(' ')[0]||'Alumno';
    $('drawerID').textContent='ID: '+USER.id;
    $('drawerAvatar').textContent=USER.nombre?.charAt(0)||'?';
    // Inscripción
    actualizarInscripcion();
    // Credencial
    renderCredencial();
    // Inscripción automática — costo a partir del 01/04/2026
    const _hoyInsc=new Date();
    const _fechaCargoInsc=new Date('2026-04-01');
    const _cobrarInscripcion=_hoyInsc>=_fechaCargoInsc;
    if(!USER.inscripcionPagada && !USER.inscripcionExenta){
        if(_cobrarInscripcion){
            if(!CART.find(i=>i.tipo==='inscripcion')){
                CART.unshift({id:'INSCRIPCION',nombre:'Inscripción IBIME',precio:INSCRIPCION_MONTO,icon:'⭐',tipo:'inscripcion'});
                actualizarBadge();
            }
        }
        $('alertInsc').style.display='flex';
    }
    // Firebase listeners
    db.collection('catalogo').onSnapshot(snap=>{
        CATALOGO=snap.docs.map(d=>({id:d.id,...d.data()}));
        renderProductos();
    });
    db.collection('reservas').where('alumnoId','==',USER.id).onSnapshot(snap=>{
        MIS_RESERVAS=snap.docs.map(d=>({rid:d.id,...d.data()}));
        renderMisClases();
        const nueva=MIS_RESERVAS.find(r=>r.estado==='confirmada'&&!r.alertaMostrada);
        if(nueva){toast('🎉 Lugar confirmado en '+nueva.claseNombre);db.collection('reservas').doc(nueva.rid).update({alertaMostrada:true}).catch(()=>{});}
    });
    rtdb.ref('estatus_acceso/'+USER.id).on('value',snap=>{
        ORDEN_ACTIVA=snap.val();
        $( 'alertOrden').style.display=(ORDEN_ACTIVA&&ORDEN_ACTIVA.monto>0)?'block':'none';
        if(!ORDEN_ACTIVA)cerrarQR();
    });
    db.collection('alumnos').doc(USER.id).onSnapshot(snap=>{
        if(!snap.exists)return;
        const d=snap.data();
        if(d.fichaMedica){
            const fm=d.fichaMedica;
            $('medSangre').value=fm.sangre||'';
            $('medFechaNac').value=fm.fechaNac||'';
            $('medPeso').value=fm.peso||'';
            $('medEstatura').value=fm.estatura||'';
            $('medIMC').value=fm.imc||'';
            $('medAlergias').value=fm.alergias||'';
            $('medLesiones').value=fm.lesiones||'';
            $('medEnfCronicas').value=fm.enfCronicas||'';
            $('medMedicamentos').value=fm.medicamentos||'';
            $('medCirugias').value=fm.cirugias||'';
            $('medVacunas').value=fm.vacunas||'';
            $('medTieneSeguro').value=fm.tieneSeguro||'';
            $('medAseguradora').value=fm.aseguradora||'';
            $('medPoliza').value=fm.poliza||'';
            $('medMedicoNombre').value=fm.medicoNombre||'';
            $('medMedicoTel').value=fm.medicoTel||'';
            $('medEmergenciaNombre').value=fm.emergenciaNombre||'';
            $('medEmergenciaParentesco').value=fm.emergenciaParentesco||'';
            $('medEmergenciaTel').value=fm.emergenciaTel||'';
            $('medEmergenciaTel2').value=fm.emergenciaTel2||'';
            $('medEmergencia').value=fm.emergencia||'';
            toggleSeguroFields();
        }
        if(d.inscripcionPagada!==undefined){
            USER.inscripcionPagada=d.inscripcionPagada;
            USER.inscripcionExenta=d.inscripcionExenta||false;
            USER.cuponUsado=d.cuponUsado||null;
            actualizarInscripcion();
            if(d.inscripcionPagada||d.inscripcionExenta){
                CART=CART.filter(i=>i.tipo!=='inscripcion');
                actualizarBadge();
                $('alertInsc').style.display='none';
            }
        }
        if(d.estatus)USER.estatus=d.estatus;
        // Contador de clases
        if(d.clasesRestantes!==undefined){
            USER.clasesRestantes=d.clasesRestantes;
            USER.clasesPaquete=d.clasesPaquete||0;
            actualizarContadorClases();
            // Alerta pocas clases
            if(d.clasesRestantes<=2&&d.clasesRestantes>0){
                const alEl=$('alertPocasClases');
                if(alEl){alEl.style.display='block';alEl.querySelector('.pocas-num').textContent=d.clasesRestantes;}
            } else {
                const alEl=$('alertPocasClases');if(alEl)alEl.style.display='none';
            }
        }
    });
    // Primer acceso
        // Primer acceso (solo mostrar una vez por sesión)
    if(!sessionStorage.getItem('ib_modalPass_shown')){
        if(USER.primerAcceso===true||(!USER.password)||(USER.pin&&String(USER.password||'')=== String(USER.pin||''))){
            setTimeout(()=>{
                $('modalPass').classList.add('on');
                sessionStorage.setItem('ib_modalPass_shown','true');
            },800);
        }
    }
   // Notificaciones automáticas cada 60 segundos
    _checkClaseInterval=setInterval(checkClaseActual,60000);
}
// ════════════════════════════════════════════════════════════════
// NAV
// ════════════════════════════════════════════════════════════════
function navTo(id,btn){
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('on'));
    $('view-'+id)?.classList.add('on');
    document.querySelectorAll('.sb-item').forEach(b=>b.classList.remove('on','rojo'));
    if(btn)btn.classList.add('on');
    if(id==='historial')cargarHistorial();
    if(id==='misclases'){}
    const main=$('main');if(main)main.scrollTop=0;
    // Cerrar sidebar en móvil al navegar
    if(window.innerWidth<768)closeSidebar();
}
function closeSidebar(){$('sidebar').classList.remove('open');$('sidebarOverlay').classList.remove('on');}
function toggleSidebar(){
    const sb=$('sidebar'),ov=$('sidebarOverlay');
    const isOpen=sb.classList.contains('open');
    if(isOpen){sb.classList.remove('open');ov.classList.remove('on');}
    else{sb.classList.add('open');ov.classList.add('on');}
}
function toggleDrawer(){toggleSidebar();}

// ════════════════════════════════════════════════════════════════
// MEMBRESÍA
// ════════════════════════════════════════════════════════════════
function actualizarInscripcion(){
    $('memNombre').textContent=USER.nombre||'';
    const inscrita=USER.inscripcionPagada===true || USER.inscripcionExenta===true;
    const hoy=new Date();
    const fechaCargo=new Date('2026-04-01');
    const conCargo=hoy>=fechaCargo;
    // ── Stat card ───────────────────────────────────────────────
    const memE=$('memEstado');
    if(memE){
        memE.textContent=inscrita?'Activa':'Pendiente';
        memE.style.color=inscrita?'#10b981':'#f59e0b';
    }
    // ── Hero card ───────────────────────────────────────────────
    const heroI=$('memIcono');const heroS=$('heroInscStatus');
    if(heroI)heroI.textContent=inscrita?'✅':'⏳';
    if(heroS){
        heroS.textContent=inscrita?'Inscripción Activa':'Inscripción Pendiente';
        heroS.style.color=inscrita?'#6ee7b7':'#fbbf24';
    }
    // ── Sidebar mini ────────────────────────────────────────────
    const sbE=$('sbMemEstado');const sbD=$('sbMemDias');
    if(sbE){
        sbE.textContent=inscrita?'Inscripción Activa':'Inscripción Pendiente';
        sbE.style.color=inscrita?'#6ee7b7':'#fbbf24';
    }
    if(sbD)sbD.textContent=inscrita?'':(conCargo?'Costo: $'+INSCRIPCION_MONTO+' MXN':'¡Inscripción gratuita!');
    const sc=$('statCarrito');if(sc)sc.textContent=CART.length;
}

// ════════════════════════════════════════════════════════════════
// CONTADOR DE CLASES
// ════════════════════════════════════════════════════════════════
function actualizarContadorClases(){
    const restantes=USER.clasesRestantes??null;
    const total=USER.clasesPaquete||0;
    const el=$('contadorClases');
    if(!el||restantes===null)return;
    const pct=total>0?Math.round((restantes/total)*100):0;
    const color=restantes<=2?'#ef4444':restantes<=5?'#f59e0b':'#10b981';
    el.innerHTML=`
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem">
        <p style="font-size:.65rem;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--txt2)">Clases del paquete</p>
        <p style="font-size:1rem;font-weight:900;color:${color}">${restantes}<span style="font-size:.65rem;color:var(--txt2);font-weight:600"> / ${total}</span></p>
      </div>
      <div style="height:8px;border-radius:99px;background:#e2e8f0;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${color};border-radius:99px;transition:width .4s"></div>
      </div>
      <p style="font-size:.6rem;color:${color};font-weight:700;margin-top:.4rem;text-align:right">${restantes} clase${restantes!==1?'s':''} restante${restantes!==1?'s':''}</p>
    `;
}


// ════════════════════════════════════════════════════════════════
function renderCredencial(){
    $( 'cNombre').textContent=USER.nombre||''
    $( 'cNivel').textContent=USER.nivel||''
    $( 'cID').textContent=USER.id||''
    let venceText;
    if (USER.inscripcionPagada) {
        venceText = 'Inscripción Activa ✅';
    } else if (USER.inscripcionExenta) {
        venceText = 'Inscripción Exenta ✅ (' + (USER.cuponUsado||'cupón') + ')';
    } else {
        venceText = 'Inscripción Pendiente ⏳';
    }
    $( 'cVence').textContent=venceText
    const qr=$( 'qrCredencial');qr.innerHTML='';
    new QRCode(qr,{text:USER.id,width:150,height:150,colorDark:'#1e3a6e',colorLight:'#ffffff'});
}
function descargarCredencial(){html2canvas($( 'credencialVisual'),{scale:3,useCORS:true}).then(c=>{const a=document.createElement('a');a.download='IBIME_'+USER.nombre+'.png';a.href=c.toDataURL();a.click();});}
function compartirWA(){const m=`*IBIME GYMNASTICS CLUB*\nHola ${USER.nombre}!\nID: *${USER.id}*\nInscripción: ${USER.inscripcionPagada?'Activa':'Pendiente'}`;window.open('https://wa.me/?text='+encodeURIComponent(m),'_blank');}

// ════════════════════════════════════════════════════════════════
// CLASES — PASOS
// ════════════════════════════════════════════════════════════════
function selArea(area){
    AREA_SEL=area;DISCIPS_SEL.clear();PKG=4;PLAN_Y=4;SLOTS_SEL=[];_slotAccordion={};
    // Reset step indicators
    setStep(2);
    $( 'paso-area').style.display='none';
    $( 'paso-plan').style.display='block';
    $( 'paso-slots').style.display='none';
    $( 'paso-resumen').style.display='none';
    $( 'paso-discip').style.display='none';
    $( 'paso-frec').style.display='none';
    $( 'paso2-titulo').textContent=area==='fitness'?'🏃 Fitness':'🤸 Gimnasia';
    // Color botón ir a horarios
    const esFit=area==='fitness';
    const btnH=$('btnIrHorarios');
    if(btnH)btnH.style.background=esFit?'var(--rojo)':'var(--azul)';
    const pbox=$('precioBox');
    if(pbox)pbox.style.background=esFit?'linear-gradient(135deg,var(--rojo),var(--rojo2,#a02220))':'linear-gradient(135deg,var(--azul),var(--azul2))';
    renderPlanGrid();
}

function renderDiscip(){
    const clases=CATALOGO.filter(i=>i.tipo==='clase'&&i.area===AREA_SEL);
    // Agrupar por nombre disciplina (quitar duplicados de horarios)
    const grupos={};
    clases.forEach(c=>{
        if(!grupos[c.nombre])grupos[c.nombre]={nombre:c.nombre,icon:c.icon||'🏋️',count:0,ids:[]};
        grupos[c.nombre].count++;
        grupos[c.nombre].ids.push(c.id);
    });
    const esFit=AREA_SEL==='fitness';
    $( 'listDiscip').innerHTML=Object.values(grupos).sort((a,b)=>a.nombre.localeCompare(b.nombre)).map(gr=>{
        const sel=gr.ids.some(id=>DISCIPS_SEL.has(id));
        const yaRes=gr.ids.some(id=>MIS_RESERVAS.some(r=>r.claseId===id));
        const cls=sel?(esFit?'sel-fit':'sel-gym'):'';
        const bgSel=sel?(esFit?'background:linear-gradient(135deg,#fff2f1,white);border-color:var(--rojo)':'background:linear-gradient(135deg,#eef3ff,white);border-color:var(--azul)'):'';
        const chkColor=sel?(esFit?'background:var(--rojo);border-color:var(--rojo)':'background:var(--azul);border-color:var(--azul)'):'border:2px solid #cbd5e1';
        return`<div style="display:flex;align-items:center;justify-content:space-between;padding:.9rem 1rem;border-radius:14px;border:2px solid var(--border);background:white;cursor:pointer;transition:all .2s;${bgSel}" onclick="toggleDiscip('${gr.nombre}')">
          <div style="display:flex;align-items:center;gap:.75rem">
            <span style="font-size:1.5rem;width:36px;text-align:center">${gr.icon}</span>
            <div>
              <p style="font-weight:900;font-size:.85rem;text-transform:uppercase;letter-spacing:.02em">${gr.nombre}</p>
              <p style="font-size:.62rem;color:${yaRes?'#059669':sel?'var(--azul)':'var(--txt2)'};font-weight:700;margin-top:1px">${yaRes?'✓ Ya estás inscrito':gr.count+' horario'+(gr.count>1?'s':'')+' disponibles'}</p>
            </div>
          </div>
          <div style="width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .2s;${sel||yaRes?chkColor:(yaRes?'background:#059691;border:none':'border:2px solid #cbd5e1')};color:white;font-size:.65rem">
            ${sel||yaRes?'<i class="fa-solid fa-check"></i>':''}
          </div>
        </div>`;
    }).join('')||'<p style="text-align:center;color:var(--txt2);font-size:.8rem;padding:2rem;font-weight:600">Sin clases disponibles en esta área</p>';
    actualizarContinuarDiscip();
    // Badge contador
    const n=DISCIPS_SEL.size;
    const badge=$('badge-sel-count');
    if(badge){if(n>0){badge.style.display='inline-block';badge.textContent=n+' seleccionada'+(n>1?'s':'');}else badge.style.display='none';}
}

function toggleDiscip(nombre){
    const clases=CATALOGO.filter(i=>i.tipo==='clase'&&i.area===AREA_SEL&&i.nombre===nombre);
    if(!clases.length)return;
    const yaRes=clases.some(c=>MIS_RESERVAS.some(r=>r.claseId===c.id));
    if(yaRes){toast('ℹ️ Ya estás inscrito en esta disciplina');return;}
    // Toggle: si alguno está seleccionado, des-seleccionar todos; si ninguno, seleccionar todos
    const alguno=clases.some(c=>DISCIPS_SEL.has(c.id));
    clases.forEach(c=>alguno?DISCIPS_SEL.delete(c.id):DISCIPS_SEL.add(c.id));
    renderDiscip();
}

function actualizarContinuarDiscip(){
    const btn=$('btn-continuar-discip');
    if(!btn)return;
    const n=DISCIPS_SEL.size;
    const esFit=AREA_SEL==='fitness';
    if(n>0){
        btn.style.display='block';
        btn.textContent='Continuar con '+n+' disciplina'+(n>1?'s':'')+ ' → Elegir paquete';
        btn.style.background=esFit?'var(--rojo)':'var(--azul)';
        btn.style.boxShadow=esFit?'0 4px 16px rgba(200,56,42,.3)':'0 4px 16px rgba(30,58,110,.3)';
    }else btn.style.display='none';
}

function irPasoHorarios(){
    if(!AREA_SEL){toast('Selecciona un área primero');return;}
    setStep(3);
    $('paso-plan').style.display='none';
    $('paso-slots').style.display='block';
    renderSlotPicker();
}

function irPasoResumen(){
    if(SLOTS_SEL.length<PLAN_Y){toast('⚠️ Selecciona '+PLAN_Y+' horarios para continuar');return;}
    setStep(4);
    $('paso-slots').style.display='none';
    $('paso-resumen').style.display='block';
    renderResumen();
}

function volverPaso(n){
    setStep(n);
    $( 'paso-area').style.display=n===1?'block':'none';
    $( 'paso-plan').style.display=n===2?'block':'none';
    $( 'paso-slots').style.display=n===3?'block':'none';
    $( 'paso-resumen').style.display=n===4?'block':'none';
    // Legacy steps
    $( 'paso-discip').style.display='none';
    $( 'paso-frec').style.display='none';
    if(n===2&&AREA_SEL)renderPlanGrid();
    if(n===3)renderSlotPicker();
}

function setStep(active){
    for(let i=1;i<=4;i++){
        const s=$( 'step-'+i);
        if(!s)continue;
        s.classList.toggle('active',i===active);
        s.classList.toggle('done',i<active);
    }
}

function renderPaquetes(){
    const esFit=AREA_SEL==='fitness';
    const tabla=esFit?PAQUETES_FITNESS:PAQUETES_GIMNASIA;
    // Resumen disciplinas
    const nombres=[...new Set([...DISCIPS_SEL].map(id=>{const it=CATALOGO.find(c=>c.id===id);return it?.nombre||'';}))];
    const rEl=$('discip-resumen');
    if(rEl){
        rEl.style.borderColor=esFit?'var(--rojo)':'var(--azul)';
        rEl.style.background=esFit?'linear-gradient(135deg,#fff5f4,white)':'linear-gradient(135deg,#eef3ff,white)';
        const _bg=esFit?'#fff2f1':'#eef3ff';const _icon=esFit?'🏃':'🤸';const _area=esFit?'Fitness':'Gimnasia';
        rEl.innerHTML=`<div style="width:36px;height:36px;border-radius:10px;background:${_bg};display:flex;align-items:center;justify-content:center;font-size:1.2rem">${_icon}</div><div style="flex:1"><p style="font-weight:900;font-size:.78rem;text-transform:uppercase">${_area}</p><p style="font-size:.65rem;color:#64748b;font-weight:600">${nombres.join(' &middot; ')}</p></div><button onclick="volverPaso(2)" style="font-size:.6rem;color:#64748b;background:none;border:1px solid #e2e8f0;border-radius:8px;padding:3px 8px;cursor:pointer">Cambiar</button>`;
    }
    // Botones frecuencia semanal
    let html='';
    for(const n of PKG_OPTS){
        const sel=PKG===n;
        const totalMes=n*4;
        html+=`<button onclick="setPkg(${n})" class="frec-btn ${sel?'on '+(esFit?'fit':'gym'):''}">
          ${n}/sem<span class="frec-sub">${totalMes} cl/mes</span>
        </button>`;
    }
    const fg=$('frecGrid');if(fg)fg.innerHTML=html;
    actualizarPrecio();
    const pbox=$('precioBoxLegacy');
    if(pbox)pbox.style.background=esFit?'linear-gradient(135deg,var(--rojo),var(--rojo2,#a02220))':'linear-gradient(135deg,var(--azul),var(--azul2))';
    const btn=$('btnAddCart');
    if(btn){btn.style.background=esFit?'var(--rojo)':'var(--azul)';btn.style.boxShadow=esFit?'0 4px 16px rgba(200,56,42,.3)':'0 4px 16px rgba(30,58,110,.3)';}
}

function setPkg(n){PKG=n;renderPaquetes();}

function actualizarPrecio(){
    const tabla=AREA_SEL==='fitness'?PAQUETES_FITNESS:PAQUETES_GIMNASIA;
    const c=tabla[PKG]||tabla[4];
    // New plan grid uses same IDs
    const pn=$('precioNormal');const pp=$('precioPromo');
    if(pn)pn.textContent='$'+c.n.toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2});
    if(pp)pp.textContent='$'+c.p.toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2});
    // Legacy
    const pnl=$('precioNormalLegacy');const ppl=$('precioPromoLegacy');
    if(pnl)pnl.textContent='$'+c.n.toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2});
    if(ppl)ppl.textContent='$'+c.p.toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2});
}

// ════════════════════════════════════════════════════════════════
// ETAPA 2 — PLAN SEMANAL
// ════════════════════════════════════════════════════════════════

// ── Utilidades de fecha/hora (zona México) ─────────────────────
function weekStartMX(){
    // Retorna la fecha del lunes de la semana actual en MX (Date, hora local)
    const ahora=ahoraMX();
    const dia=ahora.getDay(); // 0=Dom,1=Lun,...,6=Sáb
    const offsetLunes=dia===0?-6:1-dia; // días hasta el lunes anterior
    const lunes=new Date(ahora);
    lunes.setHours(0,0,0,0);
    lunes.setDate(ahora.getDate()+offsetLunes);
    return lunes;
}
function addDaysMX(date,days){const d=new Date(date);d.setDate(d.getDate()+days);return d;}
function toYYYYMMDD(date){
    const y=date.getFullYear();
    const m=String(date.getMonth()+1).padStart(2,'0');
    const d=String(date.getDate()).padStart(2,'0');
    return`${y}-${m}-${d}`;
}
const DIA_OFFSET_MAP={'Lunes':0,'Martes':1,'Miércoles':2,'Jueves':3,'Viernes':4,'Sábado':5,'Domingo':6};
function fechaParaDia(weekStart,diaNombre){
    const offset=DIA_OFFSET_MAP[diaNombre]??0;
    return addDaysMX(weekStart,offset);
}
function isMXDST(y,mo,d){
    if(mo<4||mo>10)return false;
    if(mo>4&&mo<10)return true;
    if(mo===4){const fs=firstSundayOf(y,4);return d>=fs;}
    if(mo===10){const ls=lastSundayOf(y,10);return d<ls;}
    return false;
}
function firstSundayOf(y,mo){const d=new Date(y,mo-1,1);const day=d.getDay();return day===0?1:1+(7-day);}
function lastSundayOf(y,mo){const days=new Date(y,mo,0).getDate();const d=new Date(y,mo-1,days);return days-(d.getDay()===0?0:d.getDay());}
function mxToTimestamp(dateStr,timeStr){
    const[y,mo,d]=dateStr.split('-').map(Number);
    const[h,mi]=(timeStr||'00:00').split(':').map(Number);
    const offset=isMXDST(y,mo,d)?5:6; // hours to add to convert MX→UTC
    return new Date(Date.UTC(y,mo-1,d,h+offset,mi,0,0));
}
function slotKey(alumnoId,claseId,dia,hora){
    // Genera una clave estable para el slot (mismo horario, diferente semana)
    const safe=s=>String(s||'').replace(/[^a-zA-Z0-9]/g,'_');
    return`${safe(alumnoId)}_${safe(claseId)}_${safe(dia)}_${safe(hora)}`;
}
function planDocId(alumnoId,weekStartStr,claseId,dia,hora){
    const safe=s=>String(s||'').replace(/[^a-zA-Z0-9]/g,'_');
    return`${safe(alumnoId)}_W${safe(weekStartStr)}_${safe(claseId)}_${safe(dia)}_${safe(hora)}`;
}
function cutoffAt(startAtDate){
    return new Date(startAtDate.getTime()-12*60*60*1000); // 12h antes
}
function puedeModificar(startAtDate){
    return ahoraMX()<cutoffAt(startAtDate);
}

/**
 * Determina si una reserva legacy puede cancelarse según la regla de 12 horas.
 * Si hay startAt lo usa directamente; si solo hay dia+hora, verifica si hoy es
 * el día de la clase y si la hora de inicio es más de 12h en el futuro.
 * En cualquier otro caso (sin información de tiempo), permite cancelar.
 */
function canCancelReservation(r){
    if(r.startAt){
        const sat=r.startAt.toDate?r.startAt.toDate():new Date(r.startAt);
        return puedeModificar(sat);
    }
    if(r.dia&&r.hora){
        const ahora=ahoraMX();
        if(diaSemana(ahora).toLowerCase().trim()===String(r.dia||'').toLowerCase().trim()){
            const[hh,mm]=(r.hora||'00:00').split(':').map(Number);
            const ct=new Date(ahora);ct.setHours(hh,mm,0,0);
            return puedeModificar(ct);
        }
    }
    return true;
}

// ── Renderizar grid de plan (paso 2) ───────────────────────────
function renderPlanGrid(){
    const esFit=AREA_SEL==='fitness';
    const tabla=esFit?PAQUETES_FITNESS:PAQUETES_GIMNASIA;
    let html='';
    for(const n of PKG_OPTS){
        const c=tabla[n];
        const sel=PLAN_Y===n;
        html+=`<button onclick="setPlanY(${n})" class="frec-btn ${sel?'on '+(esFit?'fit':'gym'):''}">
          ${n}/sem<span class="frec-sub">${n*4} cl/mes</span>
        </button>`;
    }
    const pg=$('planGrid');if(pg)pg.innerHTML=html;
    actualizarPrecio();
}

function setPlanY(n){
    PLAN_Y=n;PKG=n;
    // Remove slots over the limit if needed
    if(SLOTS_SEL.length>PLAN_Y)SLOTS_SEL=SLOTS_SEL.slice(0,PLAN_Y);
    renderPlanGrid();
}

// ── Renderizar selector de slots (paso 3) ─────────────────────
function renderSlotPicker(){
    const esFit=AREA_SEL==='fitness';
    const accentColor=esFit?'var(--rojo)':'var(--azul)';
    // Actualizar contador
    const resto=PLAN_Y-SLOTS_SEL.length;
    const cntTxt=$('slots-counter-txt');
    const cntBadge=$('slots-counter-badge');
    const cntNum=$('slots-counter-num');
    const cntTotal=$('slots-counter-total');
    if(cntNum)cntNum.textContent=SLOTS_SEL.length;
    if(cntTotal)cntTotal.textContent=PLAN_Y;
    if(cntBadge)cntBadge.textContent=SLOTS_SEL.length+' / '+PLAN_Y;
    const box=$('slots-counter-box');
    if(box){
        if(SLOTS_SEL.length>=PLAN_Y){
            box.style.background='#dcfce7';box.style.borderColor='#86efac';
            if(cntBadge){cntBadge.style.background='#16a34a';}
            if(cntTxt)cntTxt.style.color='#166534';
        } else {
            box.style.background=esFit?'#fff5f4':'#eef3ff';
            box.style.borderColor=esFit?'#fecaca':'#c7d2fe';
            if(cntBadge){cntBadge.style.background=esFit?'var(--rojo)':'var(--azul)';}
            if(cntTxt)cntTxt.style.color=esFit?'#991b1b':'#1e3a6e';
        }
    }
    const btnRes=$('btn-ir-resumen');
    if(btnRes){
        if(SLOTS_SEL.length>=PLAN_Y){
            btnRes.style.display='block';
            btnRes.style.background=esFit?'var(--rojo)':'var(--azul)';
        } else {
            btnRes.style.display='none';
        }
    }

    // Obtener todas las clases del área
    const clases=CATALOGO.filter(c=>c.tipo==='clase'&&c.area===AREA_SEL);
    const list=$('listSlots');
    if(!list)return;
    if(!clases.length){
        list.innerHTML='<p style="text-align:center;color:var(--txt2);font-size:.8rem;padding:2rem;font-weight:600">Sin clases disponibles para esta área</p>';
        return;
    }
    // Agrupar por nombre de disciplina
    const grupos={};
    clases.forEach(c=>{
        const nombre=c.nombre||c.id;
        if(!grupos[nombre])grupos[nombre]={nombre,icon:c.icon||'🏋️',clases:[]};
        grupos[nombre].clases.push(c);
    });
    let html='';
    Object.values(grupos).sort((a,b)=>a.nombre.localeCompare(b.nombre)).forEach(gr=>{
        // Obtener horarios disponibles
        const horarios=[];
        gr.clases.forEach(cl=>{
            const cupoDisp=cl.cupoDisponible??cl.cupo??0;
            if(cupoDisp<=0&&cl.cupo!=null)return; // sin cupo
            const h={claseId:cl.id,claseNombre:cl.nombre,dia:cl.dia,hora:cl.inicio||'',horaFin:cl.fin||'',profesor:cl.profesor||'',area:cl.area,icon:cl.icon||'🏋️'};
            if(h.dia&&h.hora)horarios.push(h);
        });
        if(!horarios.length)return;
        const selEnGrupo=SLOTS_SEL.filter(s=>horarios.some(h=>h.claseId===s.claseId));
        // Auto-expandir si tiene slots seleccionados y no se ha definido estado aún
        if(selEnGrupo.length>0&&_slotAccordion[gr.nombre]===undefined)_slotAccordion[gr.nombre]=true;
        const abierto=!!_slotAccordion[gr.nombre];
        const nombreEsc=gr.nombre.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
        const badgeSel=selEnGrupo.length>0?`<span style="font-size:.6rem;font-weight:800;background:${accentColor};color:white;border-radius:99px;padding:2px 8px">${selEnGrupo.length} seleccionado/s</span>`:'';
        html+=`<div style="margin-bottom:.5rem">`;
        html+=`<div onclick="toggleSlotAccordion('${nombreEsc}')" style="display:flex;align-items:center;justify-content:space-between;padding:.6rem .75rem;border-radius:10px;background:#f8fafc;border:1px solid #e2e8f0;cursor:pointer;margin-bottom:.3rem">
          <div style="display:flex;align-items:center;gap:.5rem">
            <span style="font-size:1.2rem">${gr.icon}</span>
            <p style="font-weight:900;font-size:.78rem;text-transform:uppercase;color:#1a2540">${gr.nombre}</p>
            ${badgeSel}
          </div>
          <i class="fa-solid fa-chevron-down" style="font-size:.7rem;color:#64748b;transition:transform .2s;transform:rotate(${abierto?'180':'0'}deg)"></i>
        </div>`;
        html+=`<div style="display:${abierto?'block':'none'}">`;
        horarios.forEach(h=>{
            const yaEsta=SLOTS_SEL.some(s=>s.claseId===h.claseId);
            const selStyle=yaEsta?`border-color:${accentColor};background:${esFit?'#fff5f4':'#eef3ff'}`:
                (SLOTS_SEL.length>=PLAN_Y&&!yaEsta?'opacity:.45;cursor:not-allowed':'border-color:#e2e8f0;background:white');
            html+=`<div style="padding:.7rem .9rem;border:2px solid #e2e8f0;border-radius:10px;margin-bottom:.35rem;cursor:pointer;transition:all .2s;${selStyle}" onclick="toggleSlot(${JSON.stringify(h).replace(/"/g,'&quot;')})">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <div>
                  <p style="font-weight:800;font-size:.8rem">${h.dia} · ${h.hora}${h.horaFin?' – '+h.horaFin:''}</p>
                  <p style="font-size:.65rem;color:#64748b;font-weight:600;margin-top:2px">👤 ${h.profesor||'Sin asignar'}</p>
                </div>
                <div style="width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;${yaEsta?`background:${accentColor};border:none;color:white;font-size:.65rem`:'border:2px solid #cbd5e1;background:white'}">
                  ${yaEsta?'<i class="fa-solid fa-check"></i>':''}
                </div>
              </div>
            </div>`;
        });
        html+='</div></div>';
    });
    list.innerHTML=html||'<p style="text-align:center;color:var(--txt2);font-size:.8rem;padding:2rem;font-weight:600">Sin horarios disponibles</p>';
}

function toggleSlot(h){
    const idx=SLOTS_SEL.findIndex(s=>s.claseId===h.claseId);
    if(idx>-1){
        SLOTS_SEL.splice(idx,1);
    } else {
        if(SLOTS_SEL.length>=PLAN_Y){toast('⚠️ Ya tienes '+PLAN_Y+' horarios. Quita uno para agregar otro.');return;}
        SLOTS_SEL.push(h);
    }
    renderSlotPicker();
}

function toggleSlotAccordion(nombre){
    _slotAccordion[nombre]=!_slotAccordion[nombre];
    renderSlotPicker();
}

// ── Renderizar resumen (paso 4) ────────────────────────────────
function renderResumen(){
    const esFit=AREA_SEL==='fitness';
    const tabla=esFit?PAQUETES_FITNESS:PAQUETES_GIMNASIA;
    const precio=tabla[PLAN_Y]||tabla[4];
    const rp=$('resumen-precio');if(rp)rp.textContent='$'+precio.p.toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2});
    const rf=$('resumen-frec');if(rf)rf.innerHTML=`<strong>${PLAN_Y}</strong> clases/semana · ${PLAN_Y*4} al mes`;
    const box=$('resumen-slots-list');
    if(!box)return;
    box.innerHTML=SLOTS_SEL.map((s,i)=>`
      <div style="display:flex;align-items:center;justify-content:space-between;padding:.75rem 1rem;background:#f8fafc;border:1px solid var(--border);border-radius:10px">
        <div style="display:flex;align-items:center;gap:.6rem">
          <span style="font-size:1.3rem">${s.icon}</span>
          <div>
            <p style="font-weight:800;font-size:.82rem">${s.claseNombre}</p>
            <p style="font-size:.65rem;color:#64748b;font-weight:600">${s.dia} · ${s.hora}${s.horaFin?' – '+s.horaFin:''} · 👤 ${s.profesor||'Sin asignar'}</p>
          </div>
        </div>
        <button onclick="SLOTS_SEL.splice(${i},1);setStep(3);$('paso-resumen').style.display='none';$('paso-slots').style.display='block';renderSlotPicker();" style="font-size:.6rem;font-weight:800;color:#ef4444;background:none;border:none;cursor:pointer;padding:4px 8px;border-radius:6px;background:#fef2f2">✕</button>
      </div>`).join('');
}

// ── Confirmar plan semanal → crear reservas para 5 semanas ────
async function confirmarPlanSemanal(){
    if(SLOTS_SEL.length<PLAN_Y){toast('⚠️ Selecciona '+PLAN_Y+' horarios');return;}
    if(ORDEN_ACTIVA){toast('⚠️ Tienes un pago pendiente. Cancela la orden anterior primero.');return;}
    const btn=$('btn-confirmar-plan');
    if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin" style="margin-right:6px"></i>Creando reservas...';}
    try{
        let folio='';
        let num=1;
        await db.runTransaction(async tx=>{
            const ref=db.collection('config').doc('contador_pagos');
            const s=await tx.get(ref);num=s.exists?(s.data().ultimo_numero||0)+1:1;
            tx.set(ref,{ultimo_numero:num},{merge:true});
        });
        folio='IBY-PAG-'+String(num).padStart(10,'0');

        const esFit=AREA_SEL==='fitness';
        const tabla=esFit?PAQUETES_FITNESS:PAQUETES_GIMNASIA;
        const precio=tabla[PLAN_Y]||tabla[4];

        // Semana de arranque inteligente: si algún slot de la semana actual
        // cae dentro de las próximas 12 horas, empezar desde la semana siguiente.
        const ws0base=weekStartMX();
        const cutoffMs=ahoraMX().getTime()+12*60*60*1000;
        const semanaActualYaBloqueada=SLOTS_SEL.some(slot=>{
            const fechaClase=fechaParaDia(ws0base,slot.dia);
            const startAt=mxToTimestamp(toYYYYMMDD(fechaClase),slot.hora);
            return startAt.getTime()<=cutoffMs;
        });
        const ws0=semanaActualYaBloqueada?addDaysMX(ws0base,7):ws0base;

        const batch=db.batch();

        SLOTS_SEL.forEach(slot=>{
            for(let si=0;si<5;si++){
                const ws=addDaysMX(ws0,si*7);
                const wsStr=toYYYYMMDD(ws);
                const fechaClase=fechaParaDia(ws,slot.dia);
                const fechaClaseStr=toYYYYMMDD(fechaClase);
                const startAtDate=mxToTimestamp(fechaClaseStr,slot.hora);
                const endAtDate=slot.horaFin?mxToTimestamp(fechaClaseStr,slot.horaFin):null;
                const docId=planDocId(USER.id,wsStr,slot.claseId,slot.dia,slot.hora);
                const sk=slotKey(USER.id,slot.claseId,slot.dia,slot.hora);
                const ref=db.collection('reservas').doc(docId);
                const data={
                    alumnoId:USER.id,alumnoNombre:USER.nombre||'',
                    claseId:slot.claseId,claseNombre:slot.claseNombre||'',
                    area:slot.area||AREA_SEL,
                    folio,estado:'pendiente_pago',alertaMostrada:false,
                    timestamp:Date.now(),
                    frecuenciaSem:PLAN_Y,
                    dia:slot.dia||'',hora:slot.hora||'',horaFin:slot.horaFin||'',
                    profesor:slot.profesor||'',
                    pasesTotal:PLAN_Y,pasesRestantes:PLAN_Y,
                    // Campos Etapa 2
                    planSemanal:true,
                    slotKey:sk,
                    weekStart:wsStr,
                    semanaIndex:si,
                    fechaClase:fechaClaseStr,
                    startAt:firebase.firestore.Timestamp.fromDate(startAtDate),
                    endAt:endAtDate?firebase.firestore.Timestamp.fromDate(endAtDate):null
                };
                batch.set(ref,data,{merge:true});
            }
        });
        await batch.commit();

        // Crear orden de pago en RTDB
        const totalMonto=precio.p;
        const detalle=SLOTS_SEL.map(s=>s.claseNombre+' '+s.dia+' '+s.hora).join(', ');
        const orden={id:USER.id,nombre:USER.nombre,monto:totalMonto,detalle,folio,tieneInscripcion:false,fecha:new Date().toLocaleDateString('es-MX'),timestamp:Date.now()};
        await rtdb.ref('estatus_acceso/'+USER.id).set(orden);
        fetch(URL_GAS,{method:'POST',mode:'no-cors',body:JSON.stringify({accion:'REGISTRAR_PAGO',id:USER.id,nombre:USER.nombre,adicionales:detalle,idCarrito:folio,monto:totalMonto,metodo:'APP_PENDIENTE'})}).catch(()=>{});

               // Reset
        SLOTS_SEL=[];AREA_SEL=null;_slotAccordion={};
        volverPaso(1);
        
        // ✅ AUDITORÍA
        if (typeof AuditModule !== 'undefined') {
          const diasSemana = SLOTS_SEL.map(s => s.dia).join(', ');
          AuditModule.auditAlumnoApartado(USER.id, folio, 'multiple_clases', diasSemana);
        }
        
        toast('✅ Reservas creadas para 5 semanas. Paga en recepción para confirmar.',5000);
        navTo('misclases');
    }catch(e){toast('❌ '+e.message,4000);}
    finally{if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-check-circle" style="margin-right:8px"></i>Confirmar y reservar';}}
}

// ── Modificar slot (desde Mis Clases) ─────────────────────────
function abrirModalModificar(sk){
    _modifSlotKey=sk;
    _modifNuevoSlot=null;
    _modifAccordion={};
    // Obtener reservas de este slotKey
    const sesiones=MIS_RESERVAS.filter(r=>r.slotKey===sk);
    if(!sesiones.length){toast('No se encontraron reservas para este slot');return;}
    const ejSlot=sesiones[0];
    // Label
    const lbl=$('modif-slot-lbl');
    if(lbl)lbl.textContent=`${ejSlot.claseNombre||''} · ${ejSlot.dia||''} ${ejSlot.hora||''}`;
    // Aviso semanas bloqueadas
    const aviso=$('modif-semanas-aviso');
    const bloqueadas=sesiones.filter(r=>{
        if(!r.startAt)return false;
        const sat=r.startAt.toDate?r.startAt.toDate():new Date(r.startAt);
        return!puedeModificar(sat);
    });
    const libres=sesiones.filter(r=>{
        if(!r.startAt)return true; // si no tiene startAt, se permite
        const sat=r.startAt.toDate?r.startAt.toDate():new Date(r.startAt);
        return puedeModificar(sat);
    });
    if(bloqueadas.length>0&&aviso){
        aviso.style.display='block';
        aviso.textContent=`⚠️ Semana${bloqueadas.length>1?'s':''} ${bloqueadas.map(r=>'semana '+(r.semanaIndex+1)).join(', ')} ya bloqueada${bloqueadas.length>1?'s':''} (≤12h). Solo se actualizarán semana${libres.length>1?'s':''} ${libres.map(r=>(r.semanaIndex+1)).join(', ')}.`;
    } else if(aviso){
        aviso.style.display='none';
    }
    if(!libres.length){
        toast('⚠️ Todas las sesiones de este slot están dentro de las 12h. No se puede modificar.');
        return;
    }
    // Mostrar opciones de horarios
    _modifEjSlot=ejSlot;
    _renderModifList();
    const btnAplicar=$('btn-aplicar-modif');if(btnAplicar)btnAplicar.disabled=true;
    $('modalModificar').style.display='flex';
}

function _renderModifList(){
    const ejSlot=_modifEjSlot;
    if(!ejSlot)return;
    const area=ejSlot.area||AREA_SEL||'fitness';
    const esFit=area==='fitness';
    const accentColor=esFit?'var(--rojo)':'var(--azul)';
    const clases=CATALOGO.filter(c=>c.tipo==='clase'&&c.area===area);
    const grupos={};
    clases.forEach(c=>{
        const nombre=c.nombre||c.id;
        if(!grupos[nombre])grupos[nombre]={nombre,icon:c.icon||'🏋️',clases:[]};
        grupos[nombre].clases.push(c);
    });
    const list=$('modifSlotsList');
    if(!list)return;
    let html='';
    Object.values(grupos).sort((a,b)=>a.nombre.localeCompare(b.nombre)).forEach(gr=>{
        const horarios=[];
        gr.clases.forEach(cl=>{
            const cupoDisp=cl.cupoDisponible??cl.cupo??1;
            if(cupoDisp<=0&&cl.cupo!=null)return;
            const h={claseId:cl.id,claseNombre:cl.nombre,dia:cl.dia,hora:cl.inicio||'',horaFin:cl.fin||'',profesor:cl.profesor||'',area:cl.area,icon:cl.icon||'🏋️'};
            if(h.dia&&h.hora)horarios.push(h);
        });
        if(!horarios.length)return;
        const abierto=!!_modifAccordion[gr.nombre];
        const nombreEsc=gr.nombre.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
        html+=`<div style="margin-bottom:.5rem">`;
        html+=`<div onclick="toggleModifAccordion('${nombreEsc}')" style="display:flex;align-items:center;justify-content:space-between;padding:.6rem .75rem;border-radius:10px;background:#f8fafc;border:1px solid #e2e8f0;cursor:pointer;margin-bottom:.3rem">
          <div style="display:flex;align-items:center;gap:.5rem">
            <span style="font-size:1.2rem">${gr.icon}</span>
            <p style="font-weight:900;font-size:.78rem;text-transform:uppercase;color:#1a2540">${gr.nombre}</p>
          </div>
          <i class="fa-solid fa-chevron-down" style="font-size:.7rem;color:#64748b;transition:transform .2s;transform:rotate(${abierto?'180':'0'}deg)"></i>
        </div>`;
        html+=`<div style="display:${abierto?'block':'none'}">`;
        horarios.forEach(h=>{
            const isEsLaActual=h.claseId===ejSlot.claseId&&h.dia===ejSlot.dia&&h.hora===ejSlot.hora;
            const isSeleccionado=_modifNuevoSlot&&_modifNuevoSlot.claseId===h.claseId;
            const selStyle=isSeleccionado?`border-color:${accentColor};background:${esFit?'#fff5f4':'#eef3ff'}`:'border-color:#e2e8f0;background:white';
            const esCurrent=isEsLaActual?`<span style="font-size:.55rem;background:#f0fdf4;color:#166534;border-radius:6px;padding:2px 6px;font-weight:700">Actual</span>`:'';
            html+=`<div id="modif-h-${h.claseId}" style="padding:.7rem .9rem;border:2px solid #e2e8f0;border-radius:10px;margin-bottom:.35rem;cursor:pointer;transition:all .2s;${selStyle}" onclick="seleccionarNuevoSlot(${JSON.stringify(h).replace(/"/g,'&quot;')})">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <div><p style="font-weight:800;font-size:.8rem">${h.dia} · ${h.hora}${h.horaFin?' – '+h.horaFin:''} ${esCurrent}</p><p style="font-size:.65rem;color:#64748b;font-weight:600;margin-top:2px">👤 ${h.profesor||'Sin asignar'}</p></div>
                <div style="width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;${isSeleccionado?`background:${accentColor};border:none;color:white;font-size:.65rem`:'border:2px solid #cbd5e1;background:white'}">
                  ${isSeleccionado?'<i class="fa-solid fa-check"></i>':''}
                </div>
              </div>
            </div>`;
        });
        html+='</div></div>';
    });
    list.innerHTML=html||'<p style="text-align:center;color:var(--txt2);font-size:.8rem;padding:2rem">Sin horarios disponibles</p>';
}

function toggleModifAccordion(nombre){
    _modifAccordion[nombre]=!_modifAccordion[nombre];
    _renderModifList();
}

function seleccionarNuevoSlot(h){
    _modifNuevoSlot=h;
    // Actualizar visual
    document.querySelectorAll('[id^="modif-h-"]').forEach(el=>{
        el.style.borderColor='#e2e8f0';el.style.background='white';
        const chk=el.querySelector('div[style*="border-radius:50%"]');
        if(chk){chk.style.background='white';chk.style.border='2px solid #cbd5e1';chk.innerHTML='';}
    });
    const el=document.getElementById('modif-h-'+h.claseId);
    if(el){
        const esFit=(h.area||'')!=='gimnasia';
        const ac=esFit?'var(--rojo)':'var(--azul)';
        el.style.borderColor=ac;el.style.background=esFit?'#fff5f4':'#eef3ff';
        const chk=el.querySelector('div[style*="border-radius:50%"]');
        if(chk){chk.style.background=ac;chk.style.border='none';chk.innerHTML='<i class="fa-solid fa-check" style="font-size:.65rem;color:white"></i>';}
    }
    const btnAplicar=$('btn-aplicar-modif');if(btnAplicar)btnAplicar.disabled=false;
}

function cerrarModalModificar(){
    $('modalModificar').style.display='none';
    _modifSlotKey=null;_modifNuevoSlot=null;_modifEjSlot=null;_modifAccordion={};
}

async function aplicarModificacion(){
    if(!_modifSlotKey||!_modifNuevoSlot){toast('⚠️ Selecciona el nuevo horario');return;}
    const btn=$('btn-aplicar-modif');
    if(btn){btn.disabled=true;btn.innerHTML='<i class="fa-solid fa-spinner fa-spin" style="margin-right:6px"></i>Aplicando...';}
    try{
        const sesiones=MIS_RESERVAS.filter(r=>r.slotKey===_modifSlotKey&&r.planSemanal);
        const h=_modifNuevoSlot;
        const batch=db.batch();
        let semanasActualizadas=0,semanasOmitidas=0;
        for(const r of sesiones){
            // Verificar cutoff
            let sat=null;
            if(r.startAt){sat=r.startAt.toDate?r.startAt.toDate():new Date(r.startAt);}
            if(sat&&!puedeModificar(sat)){semanasOmitidas++;continue;}
            // Calcular nuevos campos de fecha
            const ws=r.weekStart;
            const fechaClaseStr=toYYYYMMDD(fechaParaDia(new Date(ws+'T00:00:00'),h.dia));
            const startAtDate=mxToTimestamp(fechaClaseStr,h.hora);
            const endAtDate=h.horaFin?mxToTimestamp(fechaClaseStr,h.horaFin):null;
            const nuevoSk=slotKey(USER.id,h.claseId,h.dia,h.hora);
            const nuevoDocId=planDocId(USER.id,ws,h.claseId,h.dia,h.hora);
            // Borrar doc antiguo (si cambia docId)
            const oldDocId=planDocId(USER.id,ws,r.claseId,r.dia,r.hora);
            if(oldDocId!==nuevoDocId){
                const oldRef=db.collection('reservas').doc(oldDocId);
                const newRef=db.collection('reservas').doc(nuevoDocId);
                batch.delete(oldRef);
                batch.set(newRef,{
                    ...r,rid:undefined,slotKey:nuevoSk,claseId:h.claseId,claseNombre:h.claseNombre,
                    dia:h.dia,hora:h.hora,horaFin:h.horaFin||'',profesor:h.profesor||'',area:h.area||r.area,
                    fechaClase:fechaClaseStr,
                    startAt:firebase.firestore.Timestamp.fromDate(startAtDate),
                    endAt:endAtDate?firebase.firestore.Timestamp.fromDate(endAtDate):null,
                    modifiedAt:firebase.firestore.FieldValue.serverTimestamp(),
                    modifiedBy:'alumno'
                },{merge:true});
            } else {
                const ref=db.collection('reservas').doc(r.rid);
                batch.update(ref,{
                    claseId:h.claseId,claseNombre:h.claseNombre,slotKey:nuevoSk,
                    dia:h.dia,hora:h.hora,horaFin:h.horaFin||'',profesor:h.profesor||'',area:h.area||r.area,
                    fechaClase:fechaClaseStr,
                    startAt:firebase.firestore.Timestamp.fromDate(startAtDate),
                    endAt:endAtDate?firebase.firestore.Timestamp.fromDate(endAtDate):null,
                    modifiedAt:firebase.firestore.FieldValue.serverTimestamp(),
                    modifiedBy:'alumno'
                });
            }
            semanasActualizadas++;
        }
        await batch.commit();
        let msg=`✅ Horario actualizado en ${semanasActualizadas} semana${semanasActualizadas!==1?'s':''}`;
        if(semanasOmitidas>0)msg+=` (${semanasOmitidas} bloqueada${semanasOmitidas>1?'s':''} por ≤12h)`;
        toast(msg,4000);
        cerrarModalModificar();
    }catch(e){toast('❌ Error al modificar: '+e.message,4000);}
    finally{if(btn){btn.disabled=false;btn.innerHTML='<i class="fa-solid fa-check" style="margin-right:8px"></i>Aplicar cambio';}}
}

function agregarAlCarrito(){
    if(ORDEN_ACTIVA){toast('⚠️ Tienes un pago pendiente');return;}
    if(!DISCIPS_SEL.size){toast('⚠️ Selecciona al menos una disciplina');return;}
    // Obtener horarios disponibles de las disciplinas seleccionadas
    abrirModalHorarios();
}

// ════════════════════════════════════════════════════════════════
// MODAL HORARIOS
// ════════════════════════════════════════════════════════════════
// _horariosSeleccionados: { [disciplinaNombre]: { claseId, dia, hora, horaFin, profesor } }
let _horariosSeleccionados={};

function abrirModalHorarios(){
    _horariosSeleccionados={};
    const lista=$('horariosList');
    lista.innerHTML='';
    const disciplinaIds=[...DISCIPS_SEL];
    let hayHorarios=false;

    // Agrupar los doc IDs por nombre de disciplina
    const porNombre={};
    disciplinaIds.forEach(cid=>{
        const clase=CATALOGO.find(c=>c.id===cid);
        if(!clase)return;
        const nombre=clase.nombre||cid;
        if(!porNombre[nombre])porNombre[nombre]=[];
        porNombre[nombre].push(clase);
    });

    Object.entries(porNombre).forEach(([nombre,clases])=>{
        const primeraCl=clases[0];
        const div=document.createElement('div');
        div.style.cssText='margin-bottom:1.2rem';
        div.innerHTML='<p style="font-weight:900;font-size:.82rem;text-transform:uppercase;margin-bottom:.5rem;color:#1a2540">'+
            (primeraCl.icon||'🏋️')+' '+nombre+'</p>';

        // Construir lista de horarios: primero usar clase.horarios[] si existe,
        // si no, sintetizar un horario desde los campos del documento (dia, inicio, fin).
        const allHorarios=[];
        clases.forEach(cl=>{
            if(cl.horarios&&cl.horarios.length){
                cl.horarios.forEach(h=>allHorarios.push({...h,_claseId:cl.id}));
            } else if(cl.dia&&cl.inicio){
                const cupoDisp=(cl.cupoDisponible!=null?cl.cupoDisponible:cl.cupo)||0;
                const cupoActual=(cl.cupo||0)-cupoDisp;
                allHorarios.push({
                    id:cl.id,
                    dia:cl.dia,
                    hora:cl.inicio,
                    horaFin:cl.fin||'',
                    profesor:cl.profesor||'',
                    cupoMax:cl.cupo||null,
                    cupoActual:cupoActual,
                    _claseId:cl.id
                });
            }
        });

        const disponibles=allHorarios.filter(h=>!h.cupoMax||h.cupoActual<h.cupoMax);

        if(!disponibles.length){
            div.innerHTML+='<p style="font-size:.72rem;color:#64748b;font-style:italic;padding:.5rem;background:#f8f9fa;border-radius:8px">Sin horarios disponibles</p>';
        } else {
            hayHorarios=true;
            disponibles.forEach(h=>{
                const claseId=h._claseId;
                const lleno=h.cupoMax&&h.cupoActual>=h.cupoMax;
                const cupoTexto=h.cupoMax?(h.cupoMax-h.cupoActual)+'/'+h.cupoMax+' lugares':'Cupo disponible';
                const btn=document.createElement('div');
                btn.id='hor-'+claseId+'-'+(h.id||h._claseId);
                btn.style.cssText='padding:.75rem;border:2px solid #e2e8f0;border-radius:10px;margin-bottom:.4rem;cursor:'+(lleno?'not-allowed':'pointer')+';opacity:'+(lleno?'.55':'1')+';transition:all .2s;background:white';
                btn.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center">'
                    +'<div><p style="font-weight:800;font-size:.8rem">'+h.dia+' '+h.hora+(h.horaFin?' – '+h.horaFin:'')+'</p>'
                    +'<p style="font-size:.68rem;color:#64748b;font-weight:600;margin-top:2px">👤 '+(h.profesor||'Sin asignar')+'</p></div>'
                    +'<div style="text-align:right">'+(lleno?'<span style="background:#fef2f2;color:#ef4444;border-radius:6px;padding:2px 7px;font-size:.6rem;font-weight:800">Lleno</span>':'<span style="background:#f0fdf4;color:#16a34a;border-radius:6px;padding:2px 7px;font-size:.6rem;font-weight:700">'+cupoTexto+'</span>')
                    +'</div></div>';
                if(!lleno){
                    btn.onclick=function(){
                        // Deseleccionar otros de esta disciplina
                        clases.forEach(cl=>{
                            document.querySelectorAll('[id^="hor-'+cl.id+'-"]').forEach(el=>{
                                el.style.borderColor='#e2e8f0';el.style.background='white';
                            });
                        });
                        this.style.borderColor='#1e3a6e';this.style.background='#eef3ff';
                        // Clave: nombre de la disciplina
                        _horariosSeleccionados[nombre]={claseId:claseId,horarioId:h.id||claseId,dia:h.dia,hora:h.hora,horaFin:h.horaFin||'',profesor:h.profesor||''};
                        actualizarProgresoHorarios(porNombre);
                    };
                }
                div.appendChild(btn);
            });
        }
        lista.appendChild(div);
    });
    if(!hayHorarios){
        lista.innerHTML='<p style="text-align:center;color:#64748b;font-size:.8rem;padding:2rem">No hay horarios disponibles para las disciplinas seleccionadas.<br>Contacta a recepción para más información.</p>';
    }
    actualizarProgresoHorarios(porNombre);
    $('modalHorarios').classList.add('on');
}

function cerrarModalHorarios(){$('modalHorarios').classList.remove('on');}

function actualizarProgresoHorarios(porNombre){
    const totalDiscips = Object.keys(porNombre).length;
    const seleccionadas = Object.keys(_horariosSeleccionados).length;
    const progEl = $('horariosProgreso');
    if (progEl) {
        progEl.textContent = seleccionadas + ' de ' + totalDiscips + ' horarios seleccionados';
        progEl.style.color = seleccionadas === totalDiscips ? '#059669' : '#f59e0b';
    }
}

function confirmarHorarios(){
    const disciplinaIds=[...DISCIPS_SEL];
    const tabla=AREA_SEL==='fitness'?PAQUETES_FITNESS:PAQUETES_GIMNASIA;
    const c=tabla[PKG]||tabla[4];

    // Calcular nombres únicos de disciplinas seleccionadas
    const nombresUnicos=[...new Set(disciplinaIds.map(id=>{const it=CATALOGO.find(c=>c.id===id);return it?.nombre||'';}))].filter(Boolean);

    // Validar que haya un horario seleccionado por cada disciplina que tenga al menos un slot disponible
    for(const nombre of nombresUnicos){
        // ¿Tiene slots disponibles esta disciplina?
        const tieneSlots=disciplinaIds.some(cid=>{
            const cl=CATALOGO.find(c=>c.id===cid&&(c.nombre||cid)===nombre);
            if(!cl)return false;
            if(cl.horarios&&cl.horarios.length)return cl.horarios.some(h=>!h.cupoMax||h.cupoActual<h.cupoMax);
            return cl.dia&&cl.inicio&&(cl.cupoDisponible??cl.cupo??1)>0;
        });
        if(tieneSlots&&!_horariosSeleccionados[nombre]){
            toast('⚠️ Selecciona un horario para: '+nombre);return;
        }
    }

    // Quitar clases anteriores de esta área del carrito
    CART=CART.filter(x=>!(x.tipo==='clase'&&x.area===AREA_SEL));

    // Agregar un ítem por cada disciplina con su horario seleccionado
    nombresUnicos.forEach(nombre=>{
        const h=_horariosSeleccionados[nombre];
        if(!h)return; // disciplina sin slots, omitir
        const clase=CATALOGO.find(c=>c.id===h.claseId);
        if(!clase)return;
        const nombreClase=nombre+(h?' — '+h.dia+' '+h.hora:'');
        CART.push({
            id:'CLASE_'+h.claseId,
            nombre:nombreClase,
            profesor:h.profesor||'',
            disciplina:nombre,
            horarioId:h.horarioId||h.claseId,
            claseId:h.claseId,
            area:AREA_SEL,
            frecuencia:PKG,
            precio:c.p,
            icon:clase.icon||'🏋️',
            tipo:'clase',
            dia:h.dia||'',
            hora:h.hora||'',
            horaFin:h.horaFin||''
        });
    });
    actualizarBadge();
    cerrarModalHorarios();
    toast('🛒 Clases agregadas al carrito');
    // Volver al paso 1
    volverPaso(1);
    setStep(1);
    $( 'paso-area').style.display='block';
    $( 'paso-discip').style.display='none';
    $( 'paso-frec').style.display='none';
    DISCIPS_SEL.clear();
    abrirCarrito();
}

// ════════════════════════════════════════════════════════════════
// PRODUCTOS
// ════════════════════════════════════════════════════════════════
function renderProductos(){
    const prods=CATALOGO.filter(i=>i.tipo==='producto');
    $( 'gridProductos').innerHTML=prods.length===0?'<p style="text-align:center;color:var(--txt2);font-size:.8rem;font-weight:600;padding:2rem;grid-column:1/-1">Sin productos disponibles</p>':
    prods.map(p=>`<div onclick="toggleProd('${p.id}')" class="card" style="padding:1rem;text-align:center;cursor:pointer;border:2px solid ${CART.some(c=>c.id===p.id)?'var(--azul)':'var(--border)'};background:${CART.some(c=>c.id===p.id)?'#eef3ff':'white'};transition:all .2s">
        <div style="font-size:2rem;margin-bottom:.4rem">${p.icon||'📦'}</div>
        <p style="font-weight:800;font-size:.75rem;text-transform:uppercase;margin-bottom:.3rem">${p.nombre}</p>
        <p style="font-weight:900;font-size:1rem;color:var(--azul)">$${p.precio}</p>
    </div>`).join('');
}

function toggleProd(id){
    if(ORDEN_ACTIVA){toast('⚠️ Tienes un pago pendiente');return;}
    const it=CATALOGO.find(c=>c.id===id);if(!it)return;
    const idx=CART.findIndex(c=>c.id===id);
    if(idx>-1){CART.splice(idx,1);toast(it.nombre+' quitado');}
    else{CART.push({id,nombre:it.nombre,precio:it.precio,icon:it.icon||'📦',tipo:'producto'});toast(it.nombre+' agregado ✅');}
    actualizarBadge();renderProductos();
}

// ════════════════════════════════════════════════════════════════
// CARRITO
// ════════════════════════════════════════════════════════════════
function actualizarBadge(){
    const b=$('cartBadge');const n=CART.length;
    if(b){b.textContent=n;b.style.display=n?'flex':'none';}
    const sc=$('statCarrito');if(sc)sc.textContent=n;
    // Mobile cart badge
    const mb=$('mobileCartBadge');if(mb){mb.textContent=n;mb.style.display=n?'flex':'none';}
}
function abrirCarrito(){
    if(!CART.length){toast('🛒 El carrito está vacío');return;}
    let total=0;
    const tieneClases=CART.some(i=>i.tipo==='clase'||i.tipo==='mensualidad');
    $( 'cartItems').innerHTML=CART.map(i=>{
        total+=i.precio;
        const sub=i.tipo==='mensualidad'?'<p style="font-size:.62rem;color:var(--azul);font-weight:600;margin-top:2px">📅 '+( i.clasesNombres||[]).join(', ')+'</p>':i.tipo==='inscripcion'?'<p style="font-size:.62rem;color:#f59e0b;font-weight:600;margin-top:2px">Cuota única</p>':'';
        return`<div style="display:flex;justify-content:space-between;align-items:start;padding:.7rem .9rem;background:#f8fafc;border-radius:10px;border:1px solid var(--border);margin-bottom:.4rem">
          <div style="display:flex;gap:.6rem;align-items:start">
            <span style="font-size:1.2rem">${i.icon}</span>
            <div><p style="font-weight:800;font-size:.78rem">${i.nombre}</p>${sub}</div>
          </div>
          <p style="font-weight:900;font-size:.9rem;color:var(--azul);white-space:nowrap;margin-left:.5rem">$${i.precio.toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2})}</p>
        </div>`;
    }).join('');
    $( 'cartTotal').textContent='$'+total.toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2});
    $( 'aviso-clases').style.display=tieneClases?'block':'none';
    $( 'modalCart').classList.add('on');
}

async function confirmarOrden(){
    if(!CART.length)return;
    const btn=document.querySelector('#modalCart .cart-sheet button:last-child');
    if(btn){btn.disabled=true;btn.textContent='Procesando...';}
    try{
        let num=1;
        await db.runTransaction(async tx=>{
            const ref=db.collection('config').doc('contador_pagos');
            const s=await tx.get(ref);num=s.exists?(s.data().ultimo_numero||0)+1:1;
            tx.set(ref,{ultimo_numero:num},{merge:true});
        });
        const folio='IBY-PAG-'+String(num).padStart(10,'0');
        // Pre-reservar clases tipo 'clase' (flujo normal desde horarios)
        // Se usa una transacción atómica que incluye tanto el decremento de cupo
        // como la creación de la reserva para evitar race conditions.
        for(const item of CART.filter(i=>i.tipo==='clase'&&i.claseId)){
            const cid=item.claseId;
            const cl=CATALOGO.find(x=>x.id===cid);if(!cl)continue;
            const nuevaReservaRef=db.collection('reservas').doc();
            await db.runTransaction(async tx=>{
                const ref=db.collection('catalogo').doc(cid);
                const s=await tx.get(ref);if(!s.exists)return;
                const disp=s.data().cupoDisponible??s.data().cupo??0;
                if(disp>0)tx.update(ref,{cupoDisponible:firebase.firestore.FieldValue.increment(-1)});
                tx.set(nuevaReservaRef,{
                    alumnoId:USER.id,alumnoNombre:USER.nombre,
                    claseId:cid,claseNombre:cl.nombre,area:cl.area||item.area,
                    folio,estado:'pre-reserva',alertaMostrada:false,timestamp:Date.now(),
                    frecuenciaSem:item.frecuencia||null,
                    // Información de horario — compatibilidad con ambos esquemas
                    dia:item.dia||cl.dia||'',
                    hora:item.hora||cl.inicio||'',
                    horaFin:item.horaFin||cl.fin||'',
                    inicio:cl.inicio||'',
                    fin:cl.fin||'',
                    profesor:item.profesor||cl.profesor||'',
                    // Control de pases
                    pasesTotal:item.frecuencia||1,
                    pasesRestantes:item.frecuencia||1
                });
            });
        }
        // Pre-reservar clases de mensualidades (flujo legado)
        for(const item of CART.filter(i=>i.tipo==='mensualidad'&&i.clasesIds)){
            for(const cid of item.clasesIds){
                const cl=CATALOGO.find(x=>x.id===cid);if(!cl)continue;
                const nuevaReservaRef=db.collection('reservas').doc();
                await db.runTransaction(async tx=>{
                    const ref=db.collection('catalogo').doc(cid);
                    const s=await tx.get(ref);if(!s.exists)return;
                    const disp=s.data().cupoDisponible??s.data().cupo??0;
                    if(disp>0)tx.update(ref,{cupoDisponible:firebase.firestore.FieldValue.increment(-1)});
                    tx.set(nuevaReservaRef,{
                        alumnoId:USER.id,alumnoNombre:USER.nombre,
                        claseId:cid,claseNombre:cl.nombre,area:cl.area||item.area,
                        folio,estado:'pre-reserva',alertaMostrada:false,timestamp:Date.now(),
                        frecuenciaSem:item.frecuencia||null,
                        dia:'',hora:'',horaFin:'',inicio:'',fin:'',profesor:'',
                        pasesTotal:item.frecuencia||1,
                        pasesRestantes:item.frecuencia||1
                    });
                });
            }
        }
        const total=CART.reduce((s,i)=>s+i.precio,0);
        const detalle=CART.map(i=>i.nombre).join(', ');
        const tieneInsc=CART.some(i=>i.tipo==='inscripcion');
        const orden={id:USER.id,nombre:USER.nombre,monto:total,detalle,folio,tieneInscripcion:tieneInsc,fecha:new Date().toLocaleDateString('es-MX'),timestamp:Date.now()};
        await rtdb.ref('estatus_acceso/'+USER.id).set(orden);
        fetch(URL_GAS,{method:'POST',mode:'no-cors',body:JSON.stringify({accion:'REGISTRAR_PAGO',id:USER.id,nombre:USER.nombre,adicionales:detalle,idCarrito:folio,monto:total,metodo:'APP_PENDIENTE'})}).catch(()=>{});
        CART=[];actualizarBadge();
        $( 'modalCart').classList.remove('on');
        mostrarQR(orden);
    }catch(e){toast('❌ '+e.message,4000);}
    finally{if(btn){btn.disabled=false;btn.textContent='Confirmar';}}
}

// ════════════════════════════════════════════════════════════════
// QR PAGO
// ════════════════════════════════════════════════════════════════
function mostrarQR(data){
    $( 'qrFolio').textContent='FOLIO: '+data.folio;
    $( 'qrMonto').textContent='$'+data.monto.toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2});
    // Show detalle items
    const detalleEl = $('qrDetalle');
    if (detalleEl) {
        detalleEl.textContent = data.detalle || '';
    }
    // Show inscription info if applicable
    const inscEl = $('qrInscInfo');
    if (inscEl) {
        if (data.tieneInscripcion) {
            if (USER.inscripcionExenta && USER.cuponUsado) {
                inscEl.innerHTML = '<span style="color:#059669;font-weight:800">⭐ Inscripción: $0 (Promo '+USER.cuponUsado+')</span>';
            } else {
                inscEl.innerHTML = '<span style="color:#d97706;font-weight:800">⭐ Inscripción incluida</span>';
            }
            inscEl.style.display = 'block';
        } else {
            inscEl.style.display = 'none';
        }
    }
    $( 'qrPagoContainer').innerHTML='';
    $( 'modalQR').classList.add('on');
    setTimeout(()=>new QRCode($( 'qrPagoContainer'),{text:`${data.id}|${data.folio}|${data.monto}`,width:160,height:160}),200);
}
function verQROrden(){if(ORDEN_ACTIVA)mostrarQR(ORDEN_ACTIVA);}
function cerrarQR(){$( 'modalQR').classList.remove('on');$( 'qrPagoContainer').innerHTML='';}
async function cancelarOrden(){if(!confirm('¿Cancelar la orden pendiente?'))return;await rtdb.ref('estatus_acceso/'+USER.id).remove();toast('Orden cancelada');}

// ════════════════════════════════════════════════════════════════
// MIS CLASES
// ════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════
// HELPERS DE TIEMPO (zona horaria México)
// ════════════════════════════════════════════════════════════════
function ahoraMX(){
    // Retorna un Date cuya "hora local" equivale a America/Mexico_City
    // Usa Intl.DateTimeFormat con partes para evitar problemas de formato entre navegadores
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Mexico_City',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    }).formatToParts(now);
    const get = type => parts.find(p => p.type === type)?.value || '0';
    const y = parseInt(get('year'));
    const mo = parseInt(get('month')) - 1;
    const d = parseInt(get('day'));
    const h = parseInt(get('hour')) % 24; // algunas implementaciones devuelven 24 para medianoche con hour12:false
    const mi = parseInt(get('minute'));
    const s = parseInt(get('second'));
    return new Date(y, mo, d, h, mi, s, 0);
}
function diaSemana(d){
    // Retorna nombre del día en español
    const dias=['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
    return dias[d.getDay()];
}
function estadoClaseRT(r){
    if(r.asistencia===true)return{txt:'Asistencia registrada',cls:'badge-green',icon:'✅'};
    if(r.falta===true)return{txt:'Falta registrada — pase descontado',cls:'badge-red',icon:'❌'};
    if(r.estado==='pre-reserva'||r.estado==='pendiente_pago')return{txt:'⏳ Pago pendiente',cls:'badge-amber',icon:'⏳'};
    if(r.estado==='cancelada')return{txt:'Cancelada',cls:'badge-red',icon:'🚫'};
    if(r.estado!=='confirmada')return null; // no calcular para no confirmadas

    // Usar startAt (Timestamp) si está disponible para mayor precisión
    if(r.startAt){
        const sat=r.startAt.toDate?r.startAt.toDate():new Date(r.startAt);
        const ahora=ahoraMX();
        let finDate=null;
        if(r.endAt){finDate=r.endAt.toDate?r.endAt.toDate():new Date(r.endAt);}
        else{finDate=new Date(sat.getTime()+60*60*1000);} // default +1h

        // Verificar si es hoy (en MX)
        const hoyStr=toYYYYMMDD(ahora);
        const fechaStr=r.fechaClase||toYYYYMMDD(sat);
        if(hoyStr!==fechaStr){
            const diffDias=Math.ceil((sat-ahora)/86400000);
            if(diffDias>7)return{txt:'Futura ('+r.fechaClase+')',cls:'badge-gray',icon:'📅'};
            return{txt:'Próxima: '+r.dia+' '+r.hora,cls:'badge-gray',icon:'📅'};
        }

        const diffMs=sat-ahora;
        const diffMin=Math.round(diffMs/60000);
        if(ahora>=finDate)return{txt:'Clase terminada — pase descontado',cls:'badge-red',icon:'🕒',extra:'Si no asististe se descuenta igual (política estricta). Consulta al profesor si marcó tu asistencia.'};
        if(diffMin<=0&&ahora<finDate)return{txt:'Tu clase comenzó — ¡entra ya!',cls:'badge-now',icon:'🟢'};
        if(diffMin>0&&diffMin<=30)return{txt:'Tu clase '+(r.claseNombre||'')+' inicia en ~'+diffMin+' min',cls:'badge-now',icon:'🔔'};
        return{txt:'Hoy '+r.hora+(r.horaFin?' – '+r.horaFin:''),cls:'badge-blue',icon:'🔵'};
    }

    // Fallback: usar dia/hora (lógica anterior)
    if(!r.dia||!r.hora)return{txt:'Confirmada',cls:'badge-green',icon:'✅'};
    const ahora=ahoraMX();
    const hoyDia=diaSemana(ahora);
    if(hoyDia.toLowerCase().trim()!==String(r.dia||'').toLowerCase().trim())return{txt:'Próxima sesión: '+r.dia,cls:'badge-gray',icon:'📅'};
    // Misma clase hoy
    const [hh,mm]=(r.hora||'00:00').split(':').map(Number);
    const inicioMin=hh*60+mm;
    const ahoraMin=ahora.getHours()*60+ahora.getMinutes();
    let finMin=inicioMin+60; // default 1 hora
    if(r.horaFin){const[fh,fm]=r.horaFin.split(':').map(Number);finMin=fh*60+fm;}
    const diffInicio=inicioMin-ahoraMin;
    if(ahoraMin>=finMin)return{txt:'Clase terminada — pase descontado',cls:'badge-red',icon:'🕒',extra:'Si no asististe se descuenta igual (política estricta). Consulta al profesor si marcó tu asistencia.'};
    if(diffInicio<=0&&ahoraMin<finMin)return{txt:'Tu clase comenzó — ¡entra ya!',cls:'badge-now',icon:'🟢'};
    if(diffInicio>0&&diffInicio<=30)return{txt:'Tu clase '+(r.claseNombre||'')+(r.hora?' inicia en ~'+diffInicio+' min':''),cls:'badge-now',icon:'🔔'};
    if(diffInicio>30)return{txt:'Hoy '+r.hora+(r.horaFin?' – '+r.horaFin:''),cls:'badge-blue',icon:'🔵'};
    return{txt:'Confirmada',cls:'badge-green',icon:'✅'};
}

function renderMisClases(){
    const sm=$('statMisClases');if(sm)sm.textContent=MIS_RESERVAS.length;
    const l=$('listaMisClases');
    if(!MIS_RESERVAS.length){
        l.innerHTML='<div class="card" style="padding:2rem;text-align:center;"><div style="font-size:2.5rem;margin-bottom:.75rem">📅</div><p style="font-weight:800;font-size:.85rem;color:#64748b">Sin clases reservadas</p><button onclick="navTo(\'clases\')" style="margin-top:.75rem;padding:.6rem 1.2rem;background:#1e3a6e;color:white;border:none;border-radius:10px;font-size:.72rem;font-weight:800;text-transform:uppercase;cursor:pointer">Explorar Clases</button></div>';
        return;
    }

    // Separar reservas plan-semanal de las legacy
    const planReservas=MIS_RESERVAS.filter(r=>r.planSemanal);
    const legacyReservas=MIS_RESERVAS.filter(r=>!r.planSemanal);

    // Agrupar plan reservas por slotKey
    const slotGroups={};
    planReservas.forEach(r=>{
        const sk=r.slotKey||r.claseId+'_'+r.dia+'_'+r.hora;
        if(!slotGroups[sk])slotGroups[sk]=[];
        slotGroups[sk].push(r);
    });
    // Ordenar sesiones dentro de cada grupo por semanaIndex
    Object.values(slotGroups).forEach(g=>g.sort((a,b)=>(a.semanaIndex||0)-(b.semanaIndex||0)));

    let html='';

    // ── Sección de plan semanal ──────────────────────────────────
    if(Object.keys(slotGroups).length>0){
        html+='<p style="font-size:.62rem;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:var(--txt2);margin-bottom:.6rem">📅 Plan Semanal</p>';
        Object.entries(slotGroups).forEach(([sk,sesiones])=>{
            const ej=sesiones[0];
            const esFit=(ej.area||'')==='fitness';
            const icono=ej.icon||(esFit?'🏃':'🤸');
            // Verificar si alguna sesión es modificable
            const haveModifiable=sesiones.some(r=>{
                if(!r.startAt)return true;
                const sat=r.startAt.toDate?r.startAt.toDate():new Date(r.startAt);
                return puedeModificar(sat);
            });
            const modificarBtn=haveModifiable
                ?`<button onclick="abrirModalModificar('${sk.replace(/\\/g,'\\\\').replace(/'/g,'\\\'')}')" style="font-size:.62rem;font-weight:800;background:var(--azul);color:white;border:none;border-radius:8px;padding:4px 10px;cursor:pointer;white-space:nowrap"><i class="fa-solid fa-pen" style="margin-right:4px"></i>Modificar</button>`
                :'<span style="font-size:.62rem;font-weight:700;color:#94a3b8;background:#f1f5f9;border-radius:8px;padding:4px 10px">🔒 Bloqueado</span>';

            html+='<div class="card" style="padding:1rem;margin-bottom:.75rem">'
                +'<div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:.65rem">'
                +'<div style="display:flex;align-items:center;gap:.6rem">'
                +'<div style="width:40px;height:40px;border-radius:10px;background:'+(esFit?'#fff2f1':'#eef3ff')+';display:flex;align-items:center;justify-content:center;font-size:1.3rem;flex-shrink:0">'+icono+'</div>'
                +'<div><p style="font-weight:900;font-size:.85rem;text-transform:uppercase">'+(ej.claseNombre||'Clase')+'</p>'
                +'<p style="font-size:.65rem;font-weight:700;color:#64748b;margin-top:2px">'+ej.dia+' · '+ej.hora+(ej.horaFin?' – '+ej.horaFin:'')+(ej.profesor?' · 👤 '+ej.profesor:'')+'</p>'
                +'</div></div>'
                +modificarBtn
                +'</div>'
                // Semanas
                +'<div style="display:flex;flex-direction:column;gap:.35rem">';
            sesiones.forEach(r=>{
                const rt=estadoClaseRT(r);
                const badgeTxt=rt?rt.icon+' '+rt.txt:'';
                const badgeCls=rt?rt.cls:'badge-gray';
                let satBlocked=false;
                if(r.startAt){const sat=r.startAt.toDate?r.startAt.toDate():new Date(r.startAt);satBlocked=!puedeModificar(sat);}
                const semLbl='Sem '+(r.semanaIndex+1)+(r.fechaClase?' ('+r.fechaClase+')':'');
                html+='<div style="display:flex;align-items:center;justify-content:space-between;background:#f8fafc;border-radius:8px;padding:.5rem .75rem">'
                    +'<div style="display:flex;align-items:center;gap:.5rem">'
                    +(satBlocked?'<i class="fa-solid fa-lock" style="font-size:.6rem;color:#94a3b8"></i>':'<i class="fa-regular fa-calendar" style="font-size:.6rem;color:#64748b"></i>')
                    +'<span style="font-size:.65rem;font-weight:700;color:#475569">'+semLbl+'</span>'
                    +'</div>'
                    +(badgeTxt?'<span class="badge '+badgeCls+'" style="white-space:nowrap;font-size:.58rem">'+badgeTxt+'</span>':'')
                    +'</div>';
            });
            html+='</div></div>';
        });
    }

    // ── Reservas legacy ──────────────────────────────────────────
    if(legacyReservas.length>0){
        if(Object.keys(slotGroups).length>0)html+='<p style="font-size:.62rem;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:var(--txt2);margin-bottom:.6rem;margin-top:.85rem">📋 Otras reservas</p>';
        legacyReservas.forEach(r=>{
            const esFit=(r.area||'')==='fitness';
            const icono=r.icon||(esFit?'🏃':'🤸');
            const rt=estadoClaseRT(r);
            const badgeTxt=rt?rt.icon+' '+rt.txt:'';
            const badgeCls=rt?rt.cls:'';
            const extra=rt?.extra?'<p style="font-size:.6rem;color:#94a3b8;margin-top:.3rem;font-style:italic">'+rt.extra+'</p>':'';
            const preres=r.estado==='pre-reserva'||r.estado==='pendiente_pago';
            const confirmada=r.estado==='confirmada';
            // Determine if modification/cancellation is still allowed (12h rule)
            const puedeCanc=confirmada?canCancelReservation(r):true;
            let cancelBtn='';
            if(preres){
                cancelBtn='<button onclick="cancelarReserva(\''+r.rid+'\',\''+r.claseId+'\')" style="font-size:.6rem;font-weight:800;color:#ef4444;background:none;border:none;cursor:pointer;text-transform:uppercase;padding:0;margin-top:.4rem"><i class="fa-solid fa-trash-can" style="margin-right:3px"></i>Cancelar pre-reserva</button>';
            }else if(confirmada){
                cancelBtn=puedeCanc
                    ?'<button onclick="cancelarClaseConfirmada(\''+r.rid+'\',\''+r.claseId+'\')" style="font-size:.6rem;font-weight:800;color:#ef4444;background:none;border:none;cursor:pointer;text-transform:uppercase;padding:0;margin-top:.4rem"><i class="fa-solid fa-trash-can" style="margin-right:3px"></i>Cancelar clase</button>'
                    :'<span style="font-size:.6rem;font-weight:700;color:#94a3b8;display:block;margin-top:.4rem">🔒 No se puede cancelar — faltan menos de 12 hrs</span>';
            }
            const clasesInfo=(typeof r.pasesRestantes==='number'&&r.pasesTotal)?
                '<p style="font-size:.6rem;font-weight:700;color:#64748b">🎫 '+r.pasesRestantes+'/'+r.pasesTotal+' pases restantes</p>':
                (typeof r.clasesRestantes==='number'&&r.clasesPaquete)?
                '<p style="font-size:.6rem;font-weight:700;color:#64748b">'+r.clasesRestantes+'/'+r.clasesPaquete+' clases restantes</p>':'';
            const horarioInfo=(r.dia&&r.hora)?('<p style="font-size:.65rem;font-weight:700;color:#64748b;margin-top:2px">'+r.dia+' '+r.hora+(r.horaFin?' – '+r.horaFin:'')+(r.profesor?' · 👤 '+r.profesor:'')+'</p>'):'';
            html+='<div class="card" style="padding:1rem;margin-bottom:.6rem">'
                +'<div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:.5rem">'
                +'<div style="display:flex;align-items:center;gap:.6rem">'
                +'<div style="width:40px;height:40px;border-radius:10px;background:'+(esFit?'#fff2f1':'#eef3ff')+';display:flex;align-items:center;justify-content:center;font-size:1.3rem;flex-shrink:0">'+icono+'</div>'
                +'<div><p style="font-weight:900;font-size:.85rem;text-transform:uppercase">'+(r.claseNombre||r.disciplina||'Clase')+'</p>'
                +horarioInfo+clasesInfo+'</div></div>'
                +(badgeTxt?'<span class="badge '+badgeCls+'" style="white-space:nowrap;font-size:.6rem">'+badgeTxt+'</span>':'')
                +'</div>'+extra+cancelBtn+'</div>';
        });
    }
    l.innerHTML=html;
}

// ════════════════════════════════════════════════════════════════
// NOTIFICACIONES AUTOMÁTICAS DE CLASES
// ════════════════════════════════════════════════════════════════
let _notifCache={};
function checkClaseActual(){
    const ahora=ahoraMX();
    const hoyDia=diaSemana(ahora);
    const ahoraMin=ahora.getHours()*60+ahora.getMinutes();
    MIS_RESERVAS.filter(r=>r.estado==='confirmada').forEach(r=>{
        if(!r.dia||!r.hora)return;
        if(hoyDia.toLowerCase().trim()!==String(r.dia||'').toLowerCase().trim())return;
        const[hh,mm]=(r.hora||'00:00').split(':').map(Number);
        const inicioMin=hh*60+mm;
        let finMin=inicioMin+60;
        if(r.horaFin){const[fh,fm]=r.horaFin.split(':').map(Number);finMin=fh*60+fm;}
        const diffInicio=inicioMin-ahoraMin;
        const nombre=r.claseNombre||r.disciplina||'clase';
        const keyProxima=r.rid+'_proxima';
        const keyNow=r.rid+'_now';
        const keyEnd=r.rid+'_end';
        if(diffInicio>=25&&diffInicio<=30&&!_notifCache[keyProxima]){
            _notifCache[keyProxima]=true;
            toast('🔔 Tu clase de '+nombre+' inicia en ~30 min',5000);
        }
        if(diffInicio<=0&&ahoraMin<finMin&&!_notifCache[keyNow]){
            _notifCache[keyNow]=true;
            toast('⏰ ¡Tu clase de '+nombre+' comenzó!',5000);
        }
        if(ahoraMin>=finMin&&!r.asistencia&&!r.falta&&!_notifCache[keyEnd]){
            _notifCache[keyEnd]=true;
            toast('🕒 Tu clase de '+nombre+' terminó. Se descontará un pase de tu paquete.',6000);
        }
    });
    // Re-renderizar para actualizar badges de estado en tiempo real
    renderMisClases();
}

async function cancelarReserva(rid,cid){
    if(!confirm('¿Cancelar esta reserva?'))return;
    try{
        const reservaSnap=await db.collection('reservas').doc(rid).get();
        const reservaData=reservaSnap.exists?reservaSnap.data():{};
        // Solo restaurar cupo para reservas legacy (no plan semanal)
        if(!reservaData.planSemanal){
            await db.collection('catalogo').doc(cid).update({cupoDisponible:firebase.firestore.FieldValue.increment(1)});
        }
        await db.collection('reservas').doc(rid).delete();
        toast('Reserva cancelada');
    }catch{toast('❌ Error al cancelar');}
}

async function cancelarClaseConfirmada(rid,cid){
    if(!confirm('¿Cancelar esta clase? Se liberará el cupo y no se puede deshacer.'))return;
    try{
        await SyncModule.quitarAlumnoDeClase(rid,cid);
        const resultado = await SyncModule.quitarAlumnoDeClase(rid, cid);
        toast(`✅ Clase cancelada. Pases restaurados: ${resultado.pasesRestaurados}`);
        toast('✅ Clase cancelada correctamente');
    }catch(e){toast('❌ Error al cancelar: '+(e.message||e));}
}

// ════════════════════════════════════════════════════════════════
// HISTORIAL
// ════════════════════════════════════════════════════════════════
async function cargarHistorial(){
    const l=$( 'listaHistorial');
    l.innerHTML='<p style="text-align:center;font-size:.75rem;color:var(--txt2);padding:2rem;font-weight:600">Cargando...</p>';
    try{
        const snap=await db.collection('pagos').where('alumnoId','==',USER.id).orderBy('fecha','desc').get();
        if(snap.empty){l.innerHTML='<div class="card" style="padding:2rem;text-align:center"><p style="font-weight:700;font-size:.8rem;color:var(--txt2)">Sin historial de pagos</p></div>';return;}
        l.innerHTML=snap.docs.map(d=>{const p=d.data();return`<div class="card" style="padding:1rem;margin-bottom:.6rem;border-top:3px solid var(--azul)">
          <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:.4rem">
            <p style="font-size:.65rem;font-weight:800;color:var(--azul);text-transform:uppercase">${p.fechaString||'Reciente'}</p>
            <span class="badge badge-green">${p.metodo||'PAGADO'}</span>
          </div>
          <p style="font-weight:700;font-size:.8rem;margin-bottom:.5rem">${p.detalle||'Consumo'}</p>
          <p style="font-weight:900;font-size:1.3rem;color:var(--azul)">$${p.monto}</p>
        </div>`;}).join('');
    }catch{l.innerHTML='<p style="text-align:center;color:#ef4444;font-size:.75rem;padding:1rem">Error — verifica índices en Firebase</p>';}
}

// ════════════════════════════════════════════════════════════════
// FICHA MÉDICA
// ════════════════════════════════════════════════════════════════
async function guardarFicha(){
    const datos={
        sangre:$('medSangre').value.toUpperCase(),
        fechaNac:$('medFechaNac').value,
        peso:$('medPeso').value,
        estatura:$('medEstatura').value,
        imc:$('medIMC').value,
        alergias:$('medAlergias').value,
        lesiones:$('medLesiones').value,
        enfCronicas:$('medEnfCronicas').value,
        medicamentos:$('medMedicamentos').value,
        cirugias:$('medCirugias').value,
        vacunas:$('medVacunas').value,
        tieneSeguro:$('medTieneSeguro').value,
        aseguradora:$('medAseguradora').value,
        poliza:$('medPoliza').value,
        medicoNombre:$('medMedicoNombre').value,
        medicoTel:$('medMedicoTel').value,
        emergenciaNombre:$('medEmergenciaNombre').value,
        emergenciaParentesco:$('medEmergenciaParentesco').value,
        emergenciaTel:$('medEmergenciaTel').value,
        emergenciaTel2:$('medEmergenciaTel2').value,
        emergencia:$('medEmergencia').value
    };
    try{await db.collection('alumnos').doc(USER.id).update({fichaMedica:datos});toast('💉 Ficha guardada');}
    catch{toast('❌ Error al guardar');}
}
function calcularIMC(){
    const p=parseFloat($('medPeso').value);
    const e=parseFloat($('medEstatura').value);
    if(p>0&&e>0){const imc=(p/((e/100)**2)).toFixed(1);$('medIMC').value=imc;}else{$('medIMC').value='';}
}
function toggleSeguroFields(){
    const v=$('medTieneSeguro').value;
    const f=$('seguroFields');
    if(f)f.style.display=v==='si'?'block':'none';
}

// ════════════════════════════════════════════════════════════════
// PRIMER ACCESO — CAMBIO CONTRASEÑA
// ════════════════════════════════════════════════════════════════
async function guardarPrimerPass(){
    const p1=$( 'mp-p1').value,p2=$( 'mp-p2').value;
    const errEl=$( 'passErr'),errMsg=$( 'passErrMsg');
    if(p1.length<6){errMsg.textContent='Mínimo 6 caracteres';errEl.classList.add('on');return;}
    if(p1!==p2){errMsg.textContent='Las contraseñas no coinciden';errEl.classList.add('on');return;}
    errEl.classList.remove('on');
    try{
        await db.collection('alumnos').doc(USER.id).update({password:p1,pin:p1,primerAcceso:false});
        USER.primerAcceso=false;
        localStorage.setItem('ib_session',JSON.stringify({id:USER.id}));
        sessionStorage.removeItem('ib_modalPass_shown'); // Limpiar para la próxima sesión
        $('modalPass').classList.remove('on');
        toast('✅ ¡Contraseña creada exitosamente!',4000);
    }catch(e){errMsg.textContent='Error: '+e.message;errEl.classList.add('on');}
}
