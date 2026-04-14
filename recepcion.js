
/* ── SIDEBAR RESPONSIVE TOGGLE ── */
function toggleSidebar(){
  var sb=document.getElementById('sidebar');
  var ov=document.getElementById('sidebar-overlay');
  sb.classList.toggle('open');
  ov.classList.toggle('on');
}
function closeSidebar(){
  var sb=document.getElementById('sidebar');
  var ov=document.getElementById('sidebar-overlay');
  sb.classList.remove('open');
  ov.classList.remove('on');
}
// Close sidebar when a nav item is clicked on mobile
document.addEventListener('DOMContentLoaded',function(){
  document.querySelectorAll('.sb-item').forEach(function(btn){
    btn.addEventListener('click',function(){
      if(window.innerWidth<=1024){closeSidebar();}
    });
  });
});
const URL_GAS="https://script.google.com/macros/s/AKfycbwZg7nmuTA27A3rT6Pn6uDyfB4eyzbrFP5js09VNC1L-iMqG__DIvlFS59oH90HHu1Q/exec";
const PALABRAS_MEMBRESIA=["MENSUALIDAD","CLASE","INSCRIPCION","PLAN","MEMBRESIA","RENOVACION"];
const MEMBRESIA_DIAS=30;
const $=id=>document.getElementById(id);

let INSCRIPCION_PRECIO=800; // fallback; se carga desde config/inscripcion al inicio

async function cargarConfigRecepcion(){
    try{
        const snap=await db.collection('config').doc('inscripcion').get();
        if(snap.exists&&snap.data().monto)INSCRIPCION_PRECIO=Number(snap.data().monto)||800;
    }catch(e){console.warn('No se pudo cargar config inscripcion:',e);}
}

// Firebase inicializado por assets/js/firebase-init.js
const db=firebase.firestore(),rtdb=firebase.database();

let alumnosCached=[],alumnoActualID=null,alumnoExistente=null;
let scannerCaja=null,scannerActivo=false;
let clasesCached=[],claseActualID=null,claseViendoID=null,_unsubInscritosPanel=null;
let alumnoMoverID=null,alumnoMoverReservaID=null;
let areaFiltro='todo';
// Staff session & unsubscribe handles for real-time dashboard listeners
let _staffRol=null;
let _unsubDashboard=null,_unsubOrdenesRtdb=null,_unsubPagosHoy=null,_unsubPreReservas=null;
let _unsubCajaCatalogoPrin=null,_unsubCatalogoModal=null,_unsubCatalogoClases=null;

// ── TOAST ────────────────────────────────────────────────────────
function toast(m,ms=3000){const t=$('toast');t.textContent=m;t.classList.add('on');setTimeout(()=>t.classList.remove('on'),ms);}

// ── NAV ──────────────────────────────────────────────────────────
function showView(id,btn){
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('on'));
    $('view-'+id)?.classList.add('on');
    document.querySelectorAll('.sb-item').forEach(b=>b.classList.remove('on','rojo'));
    if(btn){btn.classList.add('on','rojo');}
    if(id==='alumnos')cargarAlumnos();
    if(id==='clases')renderGridDiscip();
    if(id==='ingresos') {
      const fi = $('filtroMesIngr');
      if (fi && !fi.value) { const n = new Date(); fi.value = n.getFullYear()+'-'+String(n.getMonth()+1).padStart(2,'0'); }
      cargarIngresosHist();
    }
    if(id === 'horario') { setHorarioMañana(); }
}

// ── RELOJ ────────────────────────────────────────────────────────
setInterval(()=>$('reloj').textContent=new Date().toLocaleTimeString('es-MX'),1000);

// ── STAFF AUTH ───────────────────────────────────────────────────
async function doLoginStaff(){
    const email=document.getElementById('staffEmail').value.trim();
    const password=document.getElementById('staffPassword').value;
    const errEl=document.getElementById('staffLoginError');
    errEl.style.display='none';
    if(!email||!password){errEl.style.display='block';return;}
    try{
        await firebase.auth().signInWithEmailAndPassword(email,password);
        // onAuthStateChanged will call _iniciarSesionStaff
    }catch(e){
        console.error('Login staff error:',e);
        errEl.style.display='block';
    }
}

async function _iniciarSesionStaff(user){
    try{
        const snap=await db.collection('usuarios_staff').doc(user.uid).get();
        if(!snap.exists){
            toast('⛔ Tu cuenta no tiene acceso a este panel.');
            await firebase.auth().signOut();return;
        }
        const data=snap.data();
        if(data.rol!=='recepcion'&&data.rol!=='admin'){
            toast('⛔ Rol sin permiso para este portal.');
            await firebase.auth().signOut();return;
        }
        _staffRol=data.rol;
        // Hide login, show app
        const loginEl=document.getElementById('login-screen-staff');
        if(loginEl)loginEl.style.display='none';
        // Unlock "Ingresos" for admin
        const sbIngresos=$('sbIngresos');
        if(sbIngresos&&_staffRol==='admin'){
            sbIngresos.style.opacity='1';sbIngresos.style.cursor='pointer';sbIngresos.style.filter='none';
        }
        // Start real-time listeners now that auth is verified
        initDashboardListeners();
        cargarConfigRecepcion();
        toast('Bienvenido, '+data.nombre);
    }catch(e){
        console.error('Error al verificar staff:',e);
        toast('Error al verificar sesión.');
        await firebase.auth().signOut();
    }
}

function doLogoutStaff(){
    // Cancel all active listeners
    if(_unsubDashboard){_unsubDashboard();_unsubDashboard=null;}
    // RTDB off() removes all listeners on the ref (cleaner than passing the handler)
    if(_unsubOrdenesRtdb){rtdb.ref('estatus_acceso').off();_unsubOrdenesRtdb=null;}
    if(_unsubPagosHoy){_unsubPagosHoy();_unsubPagosHoy=null;}
    if(_unsubPreReservas){_unsubPreReservas();_unsubPreReservas=null;}
    if(_unsubInscritosPanel){_unsubInscritosPanel();_unsubInscritosPanel=null;}
    if(_unsubCatalogoModal){_unsubCatalogoModal();_unsubCatalogoModal=null;}
    if(_unsubCatalogoClases){_unsubCatalogoClases();_unsubCatalogoClases=null;}
    _staffRol=null;
    firebase.auth().signOut().catch(()=>{});
    const loginEl=document.getElementById('login-screen-staff');
    if(loginEl)loginEl.style.display='flex';
}

// Watch auth state to support session restore on page reload
firebase.auth().onAuthStateChanged(function(user){
    if(!user){
        const loginEl=document.getElementById('login-screen-staff');
        if(loginEl)loginEl.style.display='flex';
        return;
    }
    // Already have staff role means we already initialized
    if(_staffRol)return;
    _iniciarSesionStaff(user);
});

// ── DASHBOARD LISTENERS (started after auth) ─────────────────────
function initDashboardListeners(){
    // Guard against double-init
    if(_unsubDashboard)return;

    _unsubDashboard=db.collection('alumnos').onSnapshot(snap=>{
    const hoy=new Date();let a=0,v=0;
    snap.forEach(d=>{const vf=d.data().vencimiento?new Date(d.data().vencimiento):new Date(0);vf>hoy?a++:v++;});
    $('dTotal').textContent=snap.size;$('dActivos').textContent=a;$('dVencidos').textContent=v;
    const en7=new Date(hoy);en7.setDate(en7.getDate()+7);
    const prox=snap.docs.filter(d=>{const vf=d.data().vencimiento?new Date(d.data().vencimiento):new Date(0);return vf>hoy&&vf<=en7;});
    $('listaVenc').innerHTML=prox.length===0?'<p style="text-align:center;font-size:.72rem;color:#94a3b8;font-weight:600;padding:1.5rem">Sin vencimientos próximos</p>':
    prox.map(d=>`<div onclick="showView('caja');$('cajaBusca').value='${d.id}';buscarAlumnoCaja('${d.id}')" style="padding:.65rem .9rem;background:#fff7f6;border:1px solid #fecaca;border-radius:10px;cursor:pointer;display:flex;justify-content:space-between;align-items:center">
        <div><p style="font-weight:800;font-size:.75rem;text-transform:uppercase">${d.data().nombre}</p><p style="font-size:.6rem;color:var(--rojo);font-weight:600">Vence: ${d.data().vencimiento}</p></div>
        <i class="fa-solid fa-chevron-right" style="color:#fca5a5;font-size:.7rem"></i></div>`).join('');
    });

    const _ordenesHandler=snap=>{
    const o=snap.val()||{};const keys=Object.keys(o);
    $('dOrdenes').textContent=keys.length;
    // Llenar lista de órdenes en caja
    const cajOrd=$('cajasOrdenes');
    if(cajOrd){
        if(!keys.length){cajOrd.innerHTML='<p style="font-size:.72rem;color:var(--txt2);font-weight:600;text-align:center;padding:1.5rem">Sin órdenes pendientes</p>';}
        else{cajOrd.innerHTML=keys.map(k=>{const ord=o[k];return`<div style="padding:.75rem 1rem;border-radius:12px;background:#f8fafc;border:1.5px solid var(--border);cursor:pointer;transition:all .2s" onclick="buscarAlumnoCaja('${k}')" onmouseover="this.style.borderColor='var(--azul)'" onmouseout="this.style.borderColor='var(--border)'">
            <div style="display:flex;justify-content:space-between;align-items:start">
                <p style="font-weight:900;font-size:.82rem;text-transform:uppercase">${ord.nombre||k}</p>
                <span style="font-weight:900;font-size:.95rem;color:var(--azul)">$${(ord.monto||0).toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
            </div>
            <p style="font-size:.6rem;color:var(--txt2);font-weight:600;margin-top:2px">${ord.folio||''} · ${ord.detalle||''}</p>
            <span style="font-size:.58rem;background:#fef9c3;color:#92400e;padding:1px 7px;border-radius:99px;font-weight:800">⏳ Pendiente — clic para cobrar</span>
        </div>`;}).join('');}
    }
    $('listaOrdenes').innerHTML=keys.length===0?'<p style="text-align:center;font-size:.72rem;color:#94a3b8;font-weight:600;padding:1.5rem">Sin órdenes pendientes</p>':
    keys.map(k=>{const ord=o[k];return`<div onclick="showView('caja');$('cajaBusca').value='${ord.id||k}';buscarAlumnoCaja('${ord.id||k}')" style="padding:.65rem .9rem;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;cursor:pointer;display:flex;justify-content:space-between;align-items:center">
        <div><p style="font-weight:800;font-size:.75rem;text-transform:uppercase">${ord.nombre||k}</p><p style="font-size:.6rem;color:#d97706;font-weight:600">${ord.detalle||''} · $${ord.monto}</p></div>
        <span class="badge badge-amber">Cobrar</span></div>`;}
    ).join('');
    // Caja lateral
    $('cajasOrdenes').innerHTML=keys.length===0?'<p style="text-align:center;font-size:.72rem;color:#94a3b8;font-weight:600;padding:2rem">Sin órdenes activas</p>':
    keys.map(k=>{const ord=o[k];return`<div style="padding:.8rem;background:#fffbeb;border:1.5px solid #fde68a;border-radius:12px">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:.4rem">
          <p style="font-weight:900;font-size:.78rem;text-transform:uppercase">${ord.nombre||k}</p>
          <span style="font-size:1rem;font-weight:900;color:#d97706">$${ord.monto}</span>
        </div>
        <p style="font-size:.62rem;color:#92400e;font-weight:600;margin-bottom:.5rem">${ord.detalle||'Sin detalle'}</p>
        <button onclick="$('cajaBusca').value='${ord.id||k}';buscarAlumnoCaja('${ord.id||k}')" class="btn btn-azul" style="width:100%;justify-content:center;font-size:.65rem"><i class="fa-solid fa-cash-register"></i>Cobrar</button>
    </div>`;}
    ).join('');
    };
    rtdb.ref('estatus_acceso').on('value',_ordenesHandler);
    _unsubOrdenesRtdb=_ordenesHandler;

    // ── INGRESO DEL DÍA (cobros reales) ─────────────────────────────
    const hoyStr=new Date().toLocaleDateString('es-MX');
    _unsubPagosHoy=db.collection('pagos').where('fechaString','==',hoyStr).onSnapshot(snap=>{
    let total=0,ef=0,tf=0;
    snap.forEach(d=>{const p=d.data();total+=(p.monto||0);if(p.metodo==='EFECTIVO')ef+=(p.monto||0);else tf+=(p.monto||0);});
    const fmt=n=>'$'+n.toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2});
    const di=$('dIngreso');if(di)di.textContent=fmt(total);
    const sub=$('dIngresoSub');if(sub)sub.textContent=snap.size+' cobro'+(snap.size!==1?'s':'')+' · 💵'+fmt(ef)+' · 🏦'+fmt(tf-ef<0?0:tf);
    const hc=$('dIngresoHoyCard');if(hc)hc.textContent=fmt(total);
    const choy=$('dCobrosHoy');if(choy)choy.textContent=snap.size;
    // Actualizar panel dashboard cobros de hoy
    const dit=$('dIngresoTotalHoy');const def=$('dIngresoEfectivo');const dtr=$('dIngresoTransf');
    const transfAmt=tf-ef<0?0:tf;
    if(dit)dit.textContent=fmt(total);if(def)def.textContent=fmt(ef);if(dtr)dtr.textContent=fmt(transfAmt);
    const lista=$('listaCobrosHoy');
    if(lista){
        if(snap.empty){lista.innerHTML='<p style="text-align:center;font-size:.72rem;color:var(--txt2);font-weight:600;padding:.5rem">Sin cobros registrados hoy</p>';}
        else{
            const cobros=[];snap.forEach(d=>cobros.push({id:d.id,...d.data()}));
            cobros.sort((a,b)=>(b.fecha?.toMillis?.()||0)-(a.fecha?.toMillis?.()||0));
            lista.innerHTML=cobros.map(p=>{
                const refTag=p.referencia?`<span style="font-size:.55rem;color:var(--azul);background:#eef3ff;padding:1px 5px;border-radius:5px;margin-left:.3rem">REF: ${p.referencia}</span>`:'';
                const metIcon=p.metodo==='EFECTIVO'?'💵':p.metodo==='TRANSFERENCIA'?'🏦':'💳';
                return`<div style="display:flex;align-items:center;justify-content:space-between;padding:.5rem .75rem;background:#f8fafc;border-radius:9px;border:1px solid var(--border)">
                  <div><p style="font-size:.7rem;font-weight:800;color:var(--txt)">${p.nombre||p.alumnoId}</p>
                  <p style="font-size:.6rem;font-weight:600;color:var(--txt2)">${p.detalle||'—'}${refTag}</p></div>
                  <div style="text-align:right"><p style="font-size:.8rem;font-weight:900;color:#059669">$${(p.monto||0).toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2})}</p>
                  <p style="font-size:.6rem;color:var(--txt2)">${metIcon} ${p.metodo||''}</p></div>
                </div>`;
            }).join('');
        }
    }
    });

    _unsubPreReservas=db.collection('reservas').where('estado','==','pre-reserva').onSnapshot(snap=>{
    $('listaPreRes').innerHTML=snap.empty?'<p style="grid-column:1/-1;text-align:center;font-size:.72rem;color:#94a3b8;font-weight:600;padding:1.5rem">Sin pre-reservas</p>':
    snap.docs.map(d=>{const r=d.data();
        const horarioInfo=(r.dia&&r.hora)?`<p style="font-size:.6rem;color:#64748b;font-weight:600;margin-top:1px">📅 ${r.dia} ${r.hora}${r.horaFin?' – '+r.horaFin:''}</p>`:'';
        const pasesInfo=(typeof r.pasesTotal==='number')?`<p style="font-size:.6rem;color:#64748b;font-weight:600">🎫 ${r.pasesTotal} pase(s)</p>`:'';
        return`<div style="padding:.8rem;background:#fffbeb;border:1.5px solid #fde68a;border-radius:12px">
        <p style="font-size:.58rem;font-weight:800;color:#d97706;text-transform:uppercase;margin-bottom:.2rem">⏳ Pre-reserva</p>
        <p style="font-weight:900;font-size:.75rem;text-transform:uppercase">${r.alumnoNombre||r.alumnoId}</p>
        <p style="font-size:.65rem;color:var(--azul);font-weight:700;margin-top:1px">${r.claseNombre}</p>
        ${horarioInfo}${pasesInfo}
        <button onclick="showView('caja');$('cajaBusca').value='${r.alumnoId}';buscarAlumnoCaja('${r.alumnoId}')" class="btn btn-azul" style="width:100%;justify-content:center;font-size:.6rem;padding:.4rem;margin-top:.5rem"><i class="fa-solid fa-cash-register"></i>Cobrar</button>
    </div>`;}
    ).join('');
    });
} // end initDashboardListeners

// ── REGISTRO ─────────────────────────────────────────────────────
function toggleMatricula(){$('campoMatricula').style.display=$('rCondicion').value==='ALUMNO_EXTERNO'?'none':'block';}
function toggleCamposClase(){$('camposClase').style.display=$('catTipo').value==='clase'?'flex':'none';}

async function registrarAlumno(){
    const nombre=$('rNombre').value.trim().toUpperCase();
    const curp=$('rCurp').value.trim().toUpperCase();
    const nivel=$('rNivel').value;
    const cond=$('rCondicion').value;
    const mat=$('rMatricula')?.value.trim()||'N/A';
    const correo=$('rCorreo')?.value.trim().toLowerCase()||'';
    const celular=$('rCelular')?.value.trim()||'';
    if(!nombre){toast('⚠️ Ingresa el nombre completo');return;}
    if(curp.length!==18){$('rCurpErr').style.display='block';return;}
    $('rCurpErr').style.display='none';
    const btn=$('btnRegistrar');btn.textContent='PROCESANDO...';btn.disabled=true;
    try{
        const dup=await db.collection('alumnos').where('curp','==',curp).get();
        if(!dup.empty){alumnoExistente={id:dup.docs[0].id,...dup.docs[0].data()};$('regForm').style.display='none';$('regExistente').style.display='block';return;}
        let num=1;
        await db.runTransaction(async tx=>{const ref=db.collection('config').doc('contador_alumnos');const s=await tx.get(ref);num=s.exists?(s.data().ultimo_numero||0)+1:1;tx.set(ref,{ultimo_numero:num},{merge:true});});
        const nuevoID='IBI-GYM'+String(num).padStart(6,'0');
        const pin='gymnastics2026';
        const hoy=new Date();const venc=new Date(hoy);venc.setDate(venc.getDate()+MEMBRESIA_DIAS);
        const vencStr=venc.toISOString().split('T')[0];
        const montoInscripcion = cuponAplicado ? '0' : String(INSCRIPCION_PRECIO);
        await db.collection('alumnos').doc(nuevoID).set({nombre,curp,nivel,pago:montoInscripcion,pin,condicion:cond,matricula:mat,correo,celular,fechaRegistro:hoy.toLocaleDateString('es-MX'),vencimiento:vencStr,estatus:'INACTIVO',inscripcionPagada:cuponAplicado,inscripcionExenta:cuponAplicado,cuponUsado:cuponAplicado?'APERTURA2026':null,primerAcceso:true,password:pin});
        fetch(URL_GAS,{method:'POST',mode:'no-cors',body:JSON.stringify({accion:'NUEVO_USUARIO',id:nuevoID,nombre,curp,pin,nivel,monto:montoInscripcion,fecha:hoy.toLocaleDateString('es-MX'),condicion:cond,matricula:mat,vencimiento:vencStr})}).catch(()=>{});
        mostrarCredencialReg(nuevoID,nombre,nivel,pin,vencStr);
        cuponAplicado = false;
        if ($('rCupon')) $('rCupon').value = '';
        if ($('cuponEstado')) $('cuponEstado').textContent = '';
        toast('🎉 Alumno registrado: '+nuevoID,5000);
    }catch(e){toast('❌ Error: '+e.message,5000);}
    finally{btn.textContent='Inscribir Alumno';btn.disabled=false;}
}
function mostrarCredencialReg(id,nombre,nivel,pin,vence){
    $('credPlaceholder').style.display='none';$('credResultado').style.display='block';
    $('cpNombre').textContent=nombre;$('cpNivel').textContent=nivel;$('cpID').textContent=id;$('cpVence').textContent=vence;
    const qr=$('credQR');qr.innerHTML='';new QRCode(qr,{text:id+'|'+nombre,width:110,height:110,colorDark:'#1e3a6e'});
    window._credActual={id,nombre,pin,vence};
}
function nuevoRegistro(){
    $('credPlaceholder').style.display='block';$('credResultado').style.display='none';
    $('regForm').style.display='block';$('regExistente').style.display='none';
    ['rNombre','rCurp','rMatricula','rCorreo','rCelular'].forEach(i=>{const el=$(i);if(el)el.value='';});
}
function mostrarCredencialExistente(){
    if(!alumnoExistente)return;const a=alumnoExistente;
    $('cexNombre').textContent=a.nombre;$('cexID').textContent=a.id;$('cexPIN').textContent=a.pin;$('cexVence').textContent=a.vencimiento||'N/A';
    const qr=$('ceQR');qr.innerHTML='';new QRCode(qr,{text:a.id,width:90,height:90,colorDark:'#1e3a6e'});
    $('modalCredExist').style.display='flex';
}
async function buscarPorCurp(){
    const curp=$('rCurpBusca').value.trim().toUpperCase();
    if(curp.length<10){toast('⚠️ CURP inválida');return;}
    const btn=$('btnBuscar');btn.textContent='BUSCANDO...';btn.disabled=true;
    try{
        const snap=await db.collection('alumnos').where('curp','==',curp).get();
        if(snap.empty){toast('❌ No encontrado');return;}
        const d=snap.docs[0];alumnoExistente={id:d.id,...d.data()};mostrarCredencialExistente();
    }catch{toast('❌ Error');}
    finally{btn.textContent='Buscar';btn.disabled=false;}
}
function descargarCredencial(){html2canvas($('credPreview'),{scale:3,useCORS:true}).then(c=>{const a=document.createElement('a');a.download='IBIME_'+window._credActual?.nombre+'.png';a.href=c.toDataURL();a.click();});}
function enviarWhatsApp(){const c=window._credActual||{};const m=`*IBIME GYMNASTICS CLUB*\nBienvenido!\nID: *${c.id}*\nVence: ${c.vence}`;window.open('https://wa.me/?text='+encodeURIComponent(m),'_blank');}

// ── CAJA ─────────────────────────────────────────────────────────
let alumnoEnCaja=null;
async function buscarAlumnoCaja(id){
    _cajaCartItems={};_cajaInscCheck=false;
    const idU=String(id||'').trim().toUpperCase();if(!idU)return;
    try{
        const snap=await db.collection('alumnos').doc(idU).get();
        if(!snap.exists){toast('❌ Alumno no encontrado');return;}
        alumnoEnCaja={id:idU,...snap.data()};
        $('cajaSinAlumno').style.display='none';$('cajaConAlumno').style.display='block';
        $('btnToggleCarrito').style.display='block';
        $('cajaNombreLetra').textContent=alumnoEnCaja.nombre?.charAt(0)||'?';
        $('cajaNombre').textContent=alumnoEnCaja.nombre||'';$('cajaIDAlumno').textContent=idU;
        const vf=alumnoEnCaja.vencimiento?new Date(alumnoEnCaja.vencimiento):new Date(0);
        const dias=Math.ceil((vf-new Date())/86400000);
        const vEl=$('cajaVence');vEl.textContent=dias>0?`Membresía activa — ${dias} días`:'⚠️ Membresía vencida';
        vEl.style.color=dias>0?'#059669':'#dc2626';
        const rtSnap=await rtdb.ref('estatus_acceso/'+idU).get();const orden=rtSnap.val();
        let folio='',monto='',detalle='';
        if(orden&&orden.monto){folio=orden.folio||'';monto=orden.monto;detalle=orden.detalle||'';}
        let numFolio=1;
        if(!folio){await db.runTransaction(async tx=>{const ref=db.collection('config').doc('contador_pagos');const s=await tx.get(ref);numFolio=s.exists?(s.data().ultimo_numero||0)+1:1;tx.set(ref,{ultimo_numero:numFolio},{merge:true});});folio='IBY-PAG-'+String(numFolio).padStart(10,'0');}
        $('cajaFolio').textContent=folio;$('cajaMonto').value=monto||'';$('cajaDetalle').value=detalle||'';
        if(scannerActivo)toggleScannerCaja();
        cargarPagosRecientes(idU);
    }catch(e){toast('❌ '+e.message);}
}
function resetCaja(){alumnoEnCaja=null;$('cajaSinAlumno').style.display='block';$('cajaConAlumno').style.display='none';$('cajaMonto').value='';$('cajaDetalle').value='';$('cajaRefTransf').value='';$('campoRefTransf').style.display='none';$('cajaMetodo').value='EFECTIVO';
  // Reset carrito
  _cajaCartItems={};_cajaInscCheck=false;
  $('cajaCarrito').style.display='none';
  $('btnToggleCarrito').style.display='none';
  window._cajaPendingClases=null;window._cajaPendingInsc=false;
  if(_unsubCajaCatalogo){_unsubCajaCatalogo();_unsubCajaCatalogo=null;}
}
async function registrarCobro(){
    if(!alumnoEnCaja)return;
    const btn=$('btnCobrar');const folio=$('cajaFolio').textContent;
    const monto=parseFloat($('cajaMonto').value);const detalle=$('cajaDetalle').value.toUpperCase();const metodo=$('cajaMetodo').value;
    if(!monto||monto<=0){toast('⚠️ Ingresa un monto válido');return;}
    btn.textContent='PROCESANDO...';btn.disabled=true;
    try{
        let upd={ultimoPago:new Date().toLocaleDateString('es-MX')};
        const esInsc=detalle.includes('INSCRIPCION')||detalle.includes('INSCRIPCI');
        const esMemb=PALABRAS_MEMBRESIA.some(p=>detalle.includes(p));
        if(esInsc){upd.inscripcionPagada=true;upd.estatus='ACTIVO';}
        if(esMemb){
            upd.estatus='ACTIVO';
            let base=new Date();
            if(alumnoEnCaja.vencimiento){const v=new Date(alumnoEnCaja.vencimiento);if(v>base)base=v;}
            base.setDate(base.getDate()+MEMBRESIA_DIAS);
            upd.vencimiento=base.toISOString().split('T')[0];
        }
        if(!esInsc&&!esMemb)upd.estatus='ACTIVO';
        await db.collection('alumnos').doc(alumnoEnCaja.id).update(upd);
        const referencia=metodo==='TRANSFERENCIA'?($('cajaRefTransf').value.trim()||'S/REF'):'';
        const pagoData={alumnoId:alumnoEnCaja.id,nombre:alumnoEnCaja.nombre,monto,detalle,folio,fecha:new Date(),fechaString:new Date().toLocaleDateString('es-MX'),metodo};
        if(referencia)pagoData.referencia=referencia;
        await db.collection('pagos').add(pagoData);
        if (typeof rtdb !== 'undefined') {
          try { const safeId = alumnoEnCaja.id.replace(/[.#$/[\]]/g,'_'); rtdb.ref('notificaciones/' + safeId).push({ tipo:'recibo', folio, monto, detalle, fecha: new Date().toLocaleDateString('es-MX'), metodo }); } catch(e) { console.warn('RTDB notification failed:', e); }
        }
        const syncResult=await SyncModule.confirmarReservasPendientes(alumnoEnCaja.id,folio);
        const todosLosDocs={length:syncResult.confirmadas};
        // Si hay clases desde el carrito de recepción, crear reservas confirmadas directamente
        if (window._cajaPendingClases && window._cajaPendingClases.length) {
          const batch2 = db.batch();
          for (const cl of window._cajaPendingClases) {
            const resRef = db.collection('reservas').doc();
            batch2.set(resRef, {
              alumnoId: alumnoEnCaja.id, alumnoNombre: alumnoEnCaja.nombre,
              claseId: cl.claseId, claseNombre: cl.claseNombre, area: cl.area||'',
              folio, estado: 'confirmada', alertaMostrada: false,
              fechaConfirmacion: new Date().toLocaleDateString('es-MX'),
              timestamp: Date.now(),
              dia: cl.dia||'', hora: cl.hora||'', horaFin: cl.horaFin||'', profesor: cl.profesor||'',
              pasesTotal: 1, pasesRestantes: 1
            });
            batch2.update(db.collection('catalogo').doc(cl.claseId), {
              cupoDisponible: firebase.firestore.FieldValue.increment(-1)
            });
          }
          await batch2.commit();
          if (window._cajaPendingInsc) {
            await db.collection('alumnos').doc(alumnoEnCaja.id).update({ inscripcionPagada: true, estatus: 'ACTIVO' });
          }
          window._cajaPendingClases = null;
          window._cajaPendingInsc = false;
        }
        fetch(URL_GAS,{method:'POST',mode:'no-cors',body:JSON.stringify({accion:'REGISTRAR_PAGO',id:alumnoEnCaja.id,nombre:alumnoEnCaja.nombre,idCarrito:folio,carrito:detalle,monto,metodo,fecha:new Date().toLocaleString('es-MX')})}).catch(()=>{});
        await rtdb.ref('estatus_acceso/'+alumnoEnCaja.id).remove();
        let msg=esMemb?'✅ MEMBRESÍA RENOVADA':'✅ PAGO REGISTRADO';
        if(todosLosDocs.length>0)msg+=` · ${todosLosDocs.length} clase(s) confirmada(s)`;
        toast(msg,5000);resetCaja();
    }catch(e){toast('❌ '+e.message);}
    finally{btn.textContent='Confirmar Pago';btn.disabled=false;}
}
function toggleRefTransf(){
    const m=$('cajaMetodo').value;
    $('campoRefTransf').style.display=m==='TRANSFERENCIA'?'block':'none';
    if(m!=='TRANSFERENCIA')$('cajaRefTransf').value='';
}

// ── CARRITO POR ID ────────────────────────────────────────────
let _cajaCartArea = 'todo', _cajaCartItems = {}, _cajaInscCheck = false;
let _unsubCajaCatalogo = null;

function toggleCarritoPanel() {
  const p = $('cajaCarrito');
  const btn = $('btnToggleCarrito');
  const visible = p.style.display !== 'none';
  p.style.display = visible ? 'none' : 'block';
  btn.innerHTML = visible ? '<i class="fa-solid fa-cart-shopping"></i> Armar carrito de clases' : '<i class="fa-solid fa-xmark"></i> Cerrar carrito';
  if (!visible) cargarCajaCatalogo();
}

function cargarCajaCatalogo() {
  if (_unsubCajaCatalogo) { _unsubCajaCatalogo(); _unsubCajaCatalogo = null; }
  _unsubCajaCatalogo = db.collection('catalogo').where('tipo','==','clase').onSnapshot(snap => {
    _cajaCatalogoCached = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderCajaCatalogo();
  });
  if (alumnoEnCaja && !alumnoEnCaja.inscripcionPagada) {
    $('cajaInscRow').style.display = 'block';
  }
}

let _cajaCatalogoCached = [];

function filtrarCartArea(area) {
  _cajaCartArea = area;
  ['todo','fitness','gimnasia'].forEach(a => {
    const btn = $('cfa-' + a);
    if (btn) { btn.className = a === area ? 'btn btn-azul' : 'btn btn-ghost'; if (a==='fitness') btn.style.color=a===area?'':'var(--rojo)'; if(a==='gimnasia') btn.style.color=a===area?'':'var(--azul)'; }
  });
  renderCajaCatalogo();
}

function renderCajaCatalogo() {
  const clases = _cajaCatalogoCached.filter(c => _cajaCartArea === 'todo' || c.area === _cajaCartArea);
  const cont = $('cajaCatalogo');
  if (!clases.length) { cont.innerHTML = '<p style="text-align:center;font-size:.7rem;color:#94a3b8;font-weight:600;padding:1rem">Sin clases disponibles</p>'; return; }
  cont.innerHTML = clases.map(c => {
    const sel = !!_cajaCartItems[c.id];
    return `<div onclick="toggleCajaCartItem('${c.id}')" style="padding:.6rem .8rem;border:2px solid ${sel?'var(--azul)':'var(--border)'};border-radius:10px;cursor:pointer;background:${sel?'#eef3ff':'white'};display:flex;align-items:center;justify-content:space-between;transition:all .15s">
      <div style="display:flex;align-items:center;gap:.5rem">
        <span style="font-size:1.1rem">${c.icon||'📚'}</span>
        <div>
          <p style="font-size:.72rem;font-weight:800;text-transform:uppercase">${c.nombre}</p>
          <p style="font-size:.6rem;color:var(--txt2);font-weight:600">${c.inicio||''}${c.fin?' – '+c.fin:''} · ${c.dia||''} · ${c.profesor||'Sin profesor'}</p>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:.5rem">
        <p style="font-weight:900;font-size:.8rem;color:var(--azul)">$${c.precio||0}</p>
        <div style="width:20px;height:20px;border-radius:50%;border:2px solid ${sel?'var(--azul)':'#cbd5e1'};background:${sel?'var(--azul)':'transparent'};display:flex;align-items:center;justify-content:center;color:white;font-size:.55rem">${sel?'✓':''}</div>
      </div>
    </div>`;
  }).join('');
  actualizarCajaCarritoTotal();
}

function toggleCajaCartItem(id) {
  if (_cajaCartItems[id]) { delete _cajaCartItems[id]; } else {
    const c = _cajaCatalogoCached.find(x => x.id === id);
    if (c) _cajaCartItems[id] = c;
  }
  renderCajaCatalogo();
}

function toggleCarritoInsc() {
  _cajaInscCheck = !_cajaInscCheck;
  const chk = $('cajaInscCheck');
  if (chk) { chk.textContent = _cajaInscCheck ? '✓' : ''; chk.style.background = _cajaInscCheck ? '#d97706' : 'transparent'; }
  actualizarCajaCarritoTotal();
}

function actualizarCajaCarritoTotal() {
  let total = 0;
  if (_cajaInscCheck) total += INSCRIPCION_PRECIO;
  Object.values(_cajaCartItems).forEach(c => total += (c.precio || 0));
  const totalEl = $('cajaCartTotalVal');
  if (totalEl) totalEl.textContent = '$' + total.toLocaleString('es-MX', {minimumFractionDigits:2,maximumFractionDigits:2});
  const totalRow = $('cajaCarritoTotal');
  if (totalRow) totalRow.style.display = total > 0 ? 'flex' : 'none';
}

function aplicarCarritoACaja() {
  const clases = Object.values(_cajaCartItems);
  const items = [];
  if (_cajaInscCheck) items.push('INSCRIPCION');
  clases.forEach(c => items.push(c.nombre));
  if (!items.length) { toast('⚠️ Selecciona al menos un item'); return; }
  let total = _cajaInscCheck ? INSCRIPCION_PRECIO : 0;
  clases.forEach(c => total += (c.precio || 0));
  $('cajaMonto').value = total;
  $('cajaDetalle').value = items.join(', ');
  window._cajaPendingClases = clases.map(c => ({
    claseId: c.id, claseNombre: c.nombre, area: c.area, dia: c.dia||'', hora: c.inicio||'', horaFin: c.fin||'', profesor: c.profesor||'',
    precio: c.precio||0, icon: c.icon||'📚'
  }));
  window._cajaPendingInsc = _cajaInscCheck;
  toast('✅ Carrito aplicado al cobro');
  $('cajaCarrito').style.display = 'none';
  $('btnToggleCarrito').innerHTML = '<i class="fa-solid fa-cart-shopping"></i> Armar carrito de clases';
}

function toggleScannerCaja(){
    const btn=$('btnScanCaja');
    if(!scannerActivo){
        scannerCaja=new Html5Qrcode('cajaScanner');
        scannerCaja.start({facingMode:'environment'},{fps:10,qrbox:180},txt=>{const id=txt.split('|')[0];buscarAlumnoCaja(id);}).catch(e=>toast('❌ Cámara: '+e));
        scannerActivo=true;btn.innerHTML='<i class="fa-solid fa-stop"></i>';
    }else{scannerCaja?.stop().catch(()=>{});scannerActivo=false;btn.innerHTML='<i class="fa-solid fa-qrcode"></i>';}
}

// ── CATÁLOGO ─────────────────────────────────────────────────────
async function publicarItem(){
    const tipo=$('catTipo').value;
    const payload={nombre:$('catNombre').value.trim().toUpperCase(),precio:parseFloat($('catPrecio').value)||0,icon:$('catIcon').value||'📦',tipo};
    if(!payload.nombre){toast('⚠️ Ingresa un nombre');return;}
    if(tipo==='clase'){payload.inicio=$('catInicio').value;payload.fin=$('catFin').value;const cupo=parseInt($('catCupo').value)||30;payload.cupo=cupo;payload.cupoDisponible=cupo;}
    try{await db.collection('catalogo').add(payload);toast('✅ Publicado en catálogo');['catNombre','catPrecio','catIcon'].forEach(i=>$(i).value='');}
    catch(e){toast('❌ '+e.message);}
}
if(!_unsubCatalogoModal)_unsubCatalogoModal=db.collection('catalogo').onSnapshot(snap=>{
    $('gridCatalogo').innerHTML=snap.empty?'<p style="text-align:center;font-size:.72rem;color:#94a3b8;font-weight:600;padding:2rem">Catálogo vacío</p>':
    snap.docs.map(d=>{const i=d.data();return`<div style="display:flex;justify-content:space-between;align-items:center;padding:.7rem .9rem;background:#f8fafc;border:1px solid var(--border);border-radius:10px">
        <div style="display:flex;align-items:center;gap:.7rem">
            <span style="font-size:1.3rem">${i.icon||'📦'}</span>
            <div><p style="font-weight:800;font-size:.75rem;text-transform:uppercase">${i.nombre}</p>
            <p style="font-size:.6rem;color:var(--azul);font-weight:700">$${i.precio}${i.tipo==='clase'?' · '+i.inicio+'-'+i.fin+' · '+(i.cupoDisponible??i.cupo??0)+' lugares':''}</p></div>
        </div>
        <button onclick="db.collection('catalogo').doc('${d.id}').delete()" style="color:#94a3b8;border:none;background:none;cursor:pointer;padding:.3rem" onmouseover="this.style.color='#ef4444'" onmouseout="this.style.color='#94a3b8'"><i class="fa-solid fa-trash-can"></i></button>
    </div>`;}
    ).join('');
});

// ── ALUMNOS ───────────────────────────────────────────────────────
let alumnosFiltrados=[];
async function cargarAlumnos(){
    const snap=await db.collection('alumnos').orderBy('nombre').get();
    alumnosCached=snap.docs.map(d=>{return{id:d.id,...d.data()}});
    alumnosFiltrados=[...alumnosCached];renderListaAlumnos();
}
function filtrarAlumnos(){
    const q=$('buscarAlumnoInput').value.toLowerCase();
    alumnosFiltrados=alumnosCached.filter(a=>(a.nombre||'').toLowerCase().includes(q)||a.id.toLowerCase().includes(q));
    renderListaAlumnos();
}
function renderListaAlumnos(){
    const l=$('listaAlumnos');const hoy=new Date();
    l.innerHTML=alumnosFiltrados.length===0?'<p style="text-align:center;font-size:.7rem;color:#94a3b8;font-weight:600;padding:1rem">Sin resultados</p>':
    alumnosFiltrados.map(a=>{
        const vf=a.vencimiento?new Date(a.vencimiento):new Date(0);const dias=Math.ceil((vf-hoy)/86400000);
        const col=dias>7?'#10b981':dias>0?'#f59e0b':'#ef4444';
        return`<div onclick="seleccionarAlumno('${a.id}')" style="padding:.6rem .8rem;border-radius:10px;border-left:3px solid ${col};background:${alumnoActualID===a.id?'#eef3ff':'#f8fafc'};cursor:pointer;border-top:1px solid var(--border);border-right:1px solid var(--border);border-bottom:1px solid var(--border);transition:all .2s" onmouseover="this.style.background='#eef3ff'" onmouseout="this.style.background='${alumnoActualID===a.id?'#eef3ff':'#f8fafc'}'">
            <p style="font-weight:800;font-size:.75rem;text-transform:uppercase;line-height:1.2">${a.nombre}</p>
            <p style="font-size:.6rem;color:var(--azul);font-family:monospace;font-weight:700">${a.id}</p>
            <p style="font-size:.58rem;color:#94a3b8;font-weight:600">${a.nivel||''} · ${dias>0?dias+' días':'VENCIDO'}</p>
        </div>`;
    }).join('');
}
function seleccionarAlumno(id){
    const a=alumnosCached.find(x=>x.id===id);if(!a)return;
    alumnoActualID=id;
    $('alumnoSinSel').style.display='none';$('alumnoDetalle').style.display='block';
    $('alumnoAvatar').textContent=a.nombre?.charAt(0)||'?';
    $('alumnoNombreTit').textContent=a.nombre||'';$('alumnoIDTit').textContent=id;
    $('alumnoNivelTit').textContent=(a.nivel||'')+' · '+(a.estatus||'');
    $('eNombre').value=a.nombre||'';$('eCurp').value=a.curp||'';$('eNivel').value=a.nivel||'Fitness';
    $('eVencimiento').value=a.vencimiento||'';$('eEstatus').value=a.estatus||'ACTIVO';
    $('ePin').value=a.pin||'';$('eCorreo').value=a.correo||'';$('eCelular').value=a.celular||'';
    const fm=a.fichaMedica||{};
    $('mSangre').value=fm.sangre||'';$('mAlergias').value=fm.alergias||'';
    $('mEmergencia').value=fm.emergencia||'';$('mLesiones').value=fm.lesiones||'';
    renderListaAlumnos();
}
function switchAlumnoTab(tab){
    ['datos','medica','clases'].forEach(t=>{
        const el=$(('tab'+t.charAt(0).toUpperCase()+t.slice(1)));
        if(el)el.style.display=t===tab?'grid':'none';
        const btn=$('at'+t.charAt(0).toUpperCase()+t.slice(1));
        if(btn)btn.classList.toggle('on',t===tab);
    });
    if(tab==='medica')$('tabMedica').style.display='flex';
    if(tab==='clases')cargarClasesDeAlumno(alumnoActualID);
}
async function guardarAlumno(){
    if(!alumnoActualID){toast('⚠️ Selecciona un alumno');return;}
    const datos={
        nombre:$('eNombre').value.trim().toUpperCase(),curp:$('eCurp').value.trim().toUpperCase(),
        nivel:$('eNivel').value,vencimiento:$('eVencimiento').value,estatus:$('eEstatus').value,
        pin:$('ePin').value,correo:$('eCorreo').value.trim().toLowerCase(),celular:$('eCelular').value.trim(),
        fichaMedica:{sangre:$('mSangre').value.toUpperCase(),alergias:$('mAlergias').value,emergencia:$('mEmergencia').value,lesiones:$('mLesiones').value}
    };
    try{
        await db.collection('alumnos').doc(alumnoActualID).update(datos);
        const idx=alumnosCached.findIndex(a=>a.id===alumnoActualID);
        if(idx>-1)alumnosCached[idx]={...alumnosCached[idx],...datos};
        toast('✅ Alumno actualizado');renderListaAlumnos();
    }catch(e){toast('❌ '+e.message);}
}
async function cargarClasesDeAlumno(id){
    if(!id)return;
    const snap=await db.collection('reservas').where('alumnoId','==',id).get();
    const res=snap.docs.map(d=>d.data());
    const el=$('alumnoClasesList');
    if(!res.length){el.innerHTML='<p style="font-size:.75rem;color:#94a3b8;font-weight:600;text-align:center;padding:1.5rem">Sin clases inscritas</p>';return;}
    const porEstado={confirmada:res.filter(r=>r.estado==='confirmada'),prereserva:res.filter(r=>r.estado==='pre-reserva')};
    el.innerHTML=(porEstado.confirmada.length?'<p style="font-size:.6rem;font-weight:800;text-transform:uppercase;color:#059669;margin-bottom:.4rem">✅ Confirmadas</p>'+porEstado.confirmada.map(r=>`<div class="alumno-clases-card"><p style="font-weight:800;font-size:.8rem;text-transform:uppercase">${r.claseNombre}</p><span style="font-size:.6rem;color:#64748b;font-weight:600">${r.area||''}</span></div>`).join(''):'')
    +(porEstado.prereserva.length?'<p style="font-size:.6rem;font-weight:800;text-transform:uppercase;color:#d97706;margin:.8rem 0 .4rem">⏳ Pre-reservas</p>'+porEstado.prereserva.map(r=>`<div class="alumno-clases-card"><p style="font-weight:800;font-size:.8rem;text-transform:uppercase">${r.claseNombre}</p><span style="font-size:.6rem;color:#64748b;font-weight:600">${r.area||''}</span></div>`).join(''):'');
}

// ── CLASES ADMIN ─────────────────────────────────────────────────
db.collection('catalogo').where('tipo','==','clase').onSnapshot(snap=>{
    clasesCached=snap.docs.map(d=>{return{id:d.id,...d.data()}});
    actualizarStatsClases();
    renderGridDiscip();
    renderListaClasesEditar();
});

function actualizarStatsClases(){
    $('cadTotal').textContent=clasesCached.length;
    $('cadFitness').textContent=clasesCached.filter(c=>c.area==='fitness').length;
    $('cadGimnasia').textContent=clasesCached.filter(c=>c.area==='gimnasia').length;
    // Count disciplinas with at least 1 reserva
    db.collection('reservas').where('estado','==','confirmada').get().then(snap=>{
        const discips=new Set(snap.docs.map(d=>d.data().claseNombre));
        $('cadConAlumnos').textContent=discips.size;
    }).catch(()=>{$('cadConAlumnos').textContent='—';});
}

function filtrarArea(area){
    areaFiltro=area;
    ['todo','fitness','gimnasia'].forEach(a=>{
        const b=$('fa-'+a);if(!b)return;
        if(a===area){b.className='btn btn-azul';b.style.color='';}
        else{b.className='btn btn-ghost';b.style.color=a==='fitness'?'var(--rojo)':a==='gimnasia'?'var(--azul)':'';}
    });
    renderGridDiscip();
}

function switchVistaClases(v){} // Legacy - kept for compatibility
function showPanel(panelId, btnId) {
    ['inscritos','mover','editar','asistencia'].forEach(k=>{
        const el = $('spanel-'+k); if(el) el.style.display='none';
        const btn = $('pbtn-'+k); if(btn) btn.classList.remove('on');
    });
    const el = $(panelId); if(el) el.style.display='block';
    const btn = $(btnId); if(btn) btn.classList.add('on');
    if(panelId==='spanel-asistencia'){const t=$('asistFecha');if(t&&!t.value){const d=new Date();t.value=d.toISOString().split('T')[0];}cargarAsistenciaClase();}
}
function switchPanel(p){
    ['inscritos','mover','editar','asistencia'].forEach(k=>{
        const el=$('spanel-'+k);if(el)el.style.display=k===p?'block':'none';
        const btn=$('pbtn-'+k);if(btn)btn.classList.toggle('on',k===p);
    });
    if(p==='mover')renderMoverList();
    if(p==='editar')rellenarEditarPanel();
}
function rellenarEditarPanel(){
    if(!claseViendoID)return;
    const clase=clasesCached.find(c=>c.id===claseViendoID);if(!clase)return;
    claseActualID=claseViendoID;
    $('ceNombre').value=clase.nombre||'';
    $('ceArea').value=clase.area||'fitness';
    $('ceIcono').value=clase.icon||'🏋️';
    $('ceInicio').value=clase.inicio||'';
    $('ceFin').value=clase.fin||'';
    $('cePrecio').value=clase.precio||'';
    $('ceCupo').value=clase.cupo||'';
    document.querySelectorAll('.dia-chk').forEach(cb=>{
        cb.checked=(clase.diasSemana||[]).includes(cb.value);
    });
}
function cerrarPanel(){
    $('panelVacio').style.display='block';
    $('panelContenido').style.display='none';
    claseViendoID=null;
    if(_unsubInscritosPanel){_unsubInscritosPanel();_unsubInscritosPanel=null;}
    renderGridDiscip();
}
function filtrarClaseInput(){
    const q=$('buscarClaseInput').value.toLowerCase();
    document.querySelectorAll('#gridDiscip .discip-card').forEach(el=>{
        el.style.display=(el.dataset.nombre||'').toLowerCase().includes(q)?'block':'none';
    });
}

function renderGridDiscip(){
    // Agrupar clases por nombre (disciplina)
    let clases=areaFiltro==='todo'?clasesCached:clasesCached.filter(c=>c.area===areaFiltro);
    const grupos={};
    clases.forEach(c=>{
        const k=c.nombre;
        if(!grupos[k])grupos[k]={nombre:k,icon:c.icon||'🏋️',area:c.area||'',horarios:[]};
        grupos[k].horarios.push(c);
    });
    const g=$('gridDiscip');
    if(!Object.keys(grupos).length){g.innerHTML='<p style="grid-column:1/-1;text-align:center;font-size:.8rem;color:#94a3b8;font-weight:600;padding:2rem">Sin clases en esta área</p>';return;}
    g.innerHTML=Object.values(grupos).sort((a,b)=>a.nombre.localeCompare(b.nombre)).map(gr=>{
        const total=gr.horarios.reduce((s,h)=>s+(h.cupo||0),0);
        const disp=gr.horarios.reduce((s,h)=>s+(h.cupoDisponible??h.cupo??0),0);
        const ocupados=total-disp;
        const pct=total>0?Math.round((ocupados/total)*100):0;
        const col=gr.area==='fitness'?'var(--rojo)':'var(--azul)';
        const isSel=claseViendoID&&gr.horarios.some(h=>h.id===claseViendoID);
        return`<div class="discip-card ${isSel?'sel':''} ${gr.area}" data-nombre="${gr.nombre.toLowerCase()}" onclick="verDiscip('${gr.horarios[0].id}','${gr.nombre}')">
          <div class="dc-badge"><span style="font-size:.58rem;font-weight:800;padding:2px 7px;border-radius:99px;background:${gr.area==='fitness'?'#fff2f1':'#eef3ff'};color:${col}">${gr.area}</span></div>
          <span class="dc-icon">${gr.icon}</span>
          <p class="dc-name">${gr.nombre}</p>
          <p class="dc-sub">${gr.horarios.length} horario${gr.horarios.length>1?'s':''} · ${disp} lugares libres</p>
          ${gr.horarios.slice(0,2).map(h=>`<p style="font-size:.55rem;font-weight:700;color:${col};opacity:.8;line-height:1.4">${h.diasSemana&&h.diasSemana.length?h.diasSemana.join(', '):(h.dia||'')} ${h.inicio?'⏰'+h.inicio+(h.fin?'–'+h.fin:''):''}</p>`).join('')}
          <div class="dc-ocupacion"><div class="dc-ocupacion-fill" style="width:${pct}%;background:${pct>80?'#ef4444':pct>50?'#f59e0b':col}"></div></div>
          <p style="font-size:.58rem;font-weight:700;color:#94a3b8;margin-top:.3rem">${ocupados}/${total} lugares usados</p>
        </div>`;
    }).join('');
}

async function verDiscip(claseId,nombre){
    claseViendoID=claseId;
    renderGridDiscip();
    const clase=clasesCached.find(c=>c.id===claseId)||{};
    const esFit=(clase.area||'')=='fitness';
    $('panelVacio').style.display='none';
    $('panelContenido').style.display='block';
    $('pNombre').textContent=nombre;
    $('pIcon').textContent=clase.icon||'🏋️';
    $('pIcon').style.background=esFit?'#fff2f1':'#eef3ff';
    switchPanel('inscritos');
    $('pSub').textContent=(clase.area||'').toUpperCase()+' · '+(clase.diasSemana||[]).join(', ')+' · '+( clase.inicio||'--')+' – '+(clase.fin||'--');
    if ($('pProfesor')) $('pProfesor').textContent = (clase.profesor ? '👤 ' + clase.profesor : '') + (clase.inicio ? ' · ⏰ ' + clase.inicio + ' – ' + clase.fin : '');
    // Barra ocupación — agrupar todos los horarios de esta disciplina
    const grHors=clasesCached.filter(x=>x.nombre===nombre);
    const totalC=grHors.reduce((s,h)=>s+(h.cupo||0),0);
    const dispC=grHors.reduce((s,h)=>s+(h.cupoDisponible??h.cupo??0),0);
    const ocupC=totalC-dispC;const pctC=totalC>0?Math.round((ocupC/totalC)*100):0;
    const barColor=pctC>80?'#ef4444':pctC>50?'#f59e0b':(esFit?'var(--rojo)':'var(--azul)');
    $('pOcupBar').style.width=pctC+'%';$('pOcupBar').style.background=barColor;
    $('pOcupTxt').textContent=ocupC+'/'+totalC+' lugares usados';
    cargarInscritosDiscip(claseId);
    // Scroll to panel
    $('panelDetalle').scrollIntoView({behavior:'smooth',block:'start'});
}

function cerrarPanelDiscip(){$('panelContenido').style.display='none';claseViendoID=null;if(_unsubInscritosPanel){_unsubInscritosPanel();_unsubInscritosPanel=null;}renderGridDiscip();}

function abrirEditar(id){
    switchVistaClases('editar');
    if(id)seleccionarClaseEditar(id);
}

function switchSubTab(tab){switchPanel(tab);} function _legacySwitchSubTab_unused(tab){
    $('spanel-inscritos').style.display=tab==='inscritos'?'block':'none';
    $('spanel-mover').style.display=tab==='mover'?'block':'none';
    $('pbtn-inscritos').classList.toggle('on',tab==='inscritos');
    $('pbtn-mover').classList.toggle('on',tab==='mover');
    if(tab==='mover')renderListaMoverDiscip();
}

function cargarInscritosDiscip(claseId){
    // Cancelar listener anterior si existe
    if(_unsubInscritosPanel){_unsubInscritosPanel();_unsubInscritosPanel=null;}
    $('listaInscritosDiscip').innerHTML='<p style="text-align:center;font-size:.72rem;color:#94a3b8;font-weight:600;padding:1rem"><i class="fa-solid fa-circle-notch fa-spin"></i> Cargando...</p>';

    // Mostrar filtros de horario si la disciplina tiene múltiples schedules
    const claseActual=clasesCached.find(c=>c.id===claseId);
    const nombre=claseActual?.nombre;
    const horariosClase=nombre?clasesCached.filter(c=>c.nombre===nombre):[];
    const horarioFiltEl=$('filtroHorarioInsc');
    if(horariosClase.length>1){
        horarioFiltEl.style.display='block';
        horarioFiltEl.innerHTML='<p style="font-size:.6rem;font-weight:800;color:var(--txt2);text-transform:uppercase;margin-bottom:.3rem">Filtrar por horario:</p>'
            +'<div style="display:flex;flex-wrap:wrap;gap:.3rem">'
            +'<button onclick="filtrarInscHorario(null,\''+claseId+'\')" id="hor-filt-all" class="btn btn-azul" style="font-size:.6rem;padding:.25rem .55rem">Todos</button>'
            +horariosClase.map(h=>`<button onclick="filtrarInscHorario('${h.id}','${claseId}')" id="hor-filt-${h.id}" class="btn btn-ghost" style="font-size:.6rem;padding:.25rem .55rem">${h.dia||'?'} ${h.inicio||'?'}</button>`).join('')
            +'</div>';
    } else {
        horarioFiltEl.style.display='none';
    }
    window._inscritosHorFiltro=null;

    _unsubInscritosPanel=db.collection('reservas').where('claseId','==',claseId).where('estado','==','confirmada').onSnapshot(snap=>{
        const inscritos=snap.docs.map(d=>({rid:d.id,...d.data()}));
        window._inscritosActuales=inscritos;
        renderListaInscritosDiscip(inscritos,claseId);
    },err=>{
        $('listaInscritosDiscip').innerHTML='<p style="text-align:center;font-size:.72rem;color:#ef4444;font-weight:600;padding:1rem">Error al cargar</p>';
        console.error(err);
    });
}

function filtrarInscHorario(horarioId,claseId){
    window._inscritosHorFiltro=horarioId;
    // Update button styles
    document.querySelectorAll('[id^="hor-filt-"]').forEach(b=>{b.className='btn btn-ghost';b.style.color='';});
    const activeBtn=horarioId?$('hor-filt-'+horarioId):$('hor-filt-all');
    if(activeBtn){activeBtn.className='btn btn-azul';}
    if(horarioId){
        // Load students for this specific schedule
        if(_unsubInscritosPanel){_unsubInscritosPanel();_unsubInscritosPanel=null;}
        _unsubInscritosPanel=db.collection('reservas').where('claseId','==',horarioId).where('estado','==','confirmada').onSnapshot(snap=>{
            const inscritos=snap.docs.map(d=>({rid:d.id,...d.data()}));
            window._inscritosActuales=inscritos;
            renderListaInscritosDiscip(inscritos,horarioId);
        });
    } else {
        cargarInscritosDiscip(claseId);
    }
}

function renderListaInscritosDiscip(inscritos,claseId){
    const countEl=$('pInscritosCount');
    if(countEl)countEl.textContent='('+inscritos.length+')';
    $('listaInscritosDiscip').innerHTML=inscritos.length===0?'<p style="text-align:center;font-size:.72rem;color:#94a3b8;font-weight:600;padding:1.5rem">Sin alumnos confirmados</p>':
    inscritos.map(r=>`<div class="alumno-en-clase">
        <div style="display:flex;align-items:center;gap:.7rem">
          <div class="ac-avatar">${r.alumnoNombre?.charAt(0)||'?'}</div>
          <div class="ac-info"><p>${r.alumnoNombre||r.alumnoId}</p><span>${r.alumnoId}</span>${r.dia||r.hora?`<span style="font-size:.58rem;color:var(--azul);font-weight:700">${r.dia||''} ${r.hora||''}${r.horaFin?' – '+r.horaFin:''}</span>`:''}
          </div>
        </div>
        <div style="display:flex;gap:.4rem">
          <button onclick="iniciarMover('${r.alumnoId}','${r.alumnoNombre||r.alumnoId}','${r.rid}')" class="btn btn-ghost" style="font-size:.6rem;padding:.35rem .6rem;color:#7c3aed"><i class="fa-solid fa-right-left"></i></button>
          <button onclick="quitarDeClase('${r.rid}','${claseId||claseViendoID}')" class="btn btn-ghost" style="font-size:.6rem;padding:.35rem .6rem;color:#ef4444"><i class="fa-solid fa-user-minus"></i></button>
          <button onclick="showView('alumnos');seleccionarAlumno('${r.alumnoId}')" class="btn btn-ghost" style="font-size:.6rem;padding:.35rem .6rem"><i class="fa-solid fa-user"></i></button>
        </div>
    </div>`).join('');
}

function renderListaMoverDiscip(){
    const ins=window._inscritosActuales||[];
    $('listaMoverDiscip').innerHTML=ins.length===0?'<p style="text-align:center;font-size:.72rem;color:#94a3b8;font-weight:600;padding:1rem">Sin alumnos</p>':
    ins.map(r=>`<div onclick="iniciarMover('${r.alumnoId}','${r.alumnoNombre||r.alumnoId}','${r.rid}')" class="alumno-en-clase" style="cursor:pointer">
        <div style="display:flex;align-items:center;gap:.7rem">
          <div class="ac-avatar">${r.alumnoNombre?.charAt(0)||'?'}</div>
          <div class="ac-info"><p>${r.alumnoNombre||r.alumnoId}</p><span>Click para seleccionar y mover</span></div>
        </div>
        <i class="fa-solid fa-chevron-right" style="color:#94a3b8;font-size:.7rem"></i>
    </div>`).join('');
}

function iniciarMover(alumnoId,nombre,reservaId){
    alumnoMoverID=alumnoId;alumnoMoverReservaID=reservaId;
    $('moverAlumnoNombre').textContent=nombre;
    // Poblar select
    const sel=$('selectDestino');
    sel.innerHTML='<option value="">— Selecciona clase destino —</option>'+
        clasesCached.filter(c=>c.id!==claseViendoID).map(c=>`<option value="${c.id}">${c.nombre} (${c.inicio||'--'}–${c.fin||'--'}) · ${c.cupoDisponible??0} lugares</option>`).join('');
    $('moverForm').style.display='block';
    switchSubTab('mover');
}
function cancelarMover(){alumnoMoverID=null;alumnoMoverReservaID=null;$('moverForm').style.display='none';}

async function ejecutarMover(){
    const destId=$('selectDestino').value;
    if(!destId||!alumnoMoverID||!alumnoMoverReservaID){toast('⚠️ Selecciona la clase destino');return;}
    const dest=clasesCached.find(c=>c.id===destId);
    if(!dest){toast('❌ Clase no encontrada');return;}
    if((dest.cupoDisponible??dest.cupo??0)<=0){toast('🔴 Sin lugares en clase destino');return;}
    try{
        await SyncModule.moverAlumnoDeClase(alumnoMoverReservaID,claseViendoID,destId,dest);
        toast('🔄 Movido a '+dest.nombre,4000);cancelarMover();
        cargarInscritosDiscip(claseViendoID);
    }catch(e){toast('❌ '+e.message);}
}

async function quitarDeClase(reservaId,claseId){
    // Detectar si la reserva tiene plan semanal para ofrecer eliminar todas las sesiones
    let esPlan=false;
    try{
        const snap=await db.collection('reservas').doc(reservaId).get();
        if(snap.exists)esPlan=!!(snap.data().planSemanal&&snap.data().slotKey);
    }catch(_){}
    let eliminarTodoElPlan=false;
    if(esPlan){
        const resp=confirm('Este alumno tiene un plan semanal.\n\n¿Eliminar TODAS las sesiones del plan (toda la semana)?\n\nAcepta = Eliminar todas · Cancela = Solo esta sesión');
        if(resp===null)return; // usuario cerró el diálogo de plan (no se usa aquí, pero por claridad)
        eliminarTodoElPlan=resp;
        if(!confirm(eliminarTodoElPlan?'¿Confirmas eliminar TODAS las sesiones del plan semanal?':'¿Quitar al alumno solo de esta clase?'))return;
    }else{
        if(!confirm('¿Quitar al alumno de esta clase?'))return;
    }
    try{
        const resultado=await SyncModule.quitarAlumnoDeClase(reservaId,claseId,{eliminarTodoElPlan});
        toast('🗑️ '+(resultado.eliminadas>1?resultado.eliminadas+' sesiones eliminadas':'Alumno removido'));
        cargarInscritosDiscip(claseId);
    }catch(e){toast('❌ '+e.message);}
}

// Vista Por Alumno
async function buscarAlumnoEnClases(){
    const q=$('buscarAlumnoClases').value.trim().toLowerCase();
    if(q.length<2){$('resultadoAlumnoClases').innerHTML='';return;}
    const resultados=alumnosCached.filter(a=>(a.nombre||'').toLowerCase().includes(q)||a.id.toLowerCase().includes(q));
    if(!resultados.length){$('resultadoAlumnoClases').innerHTML='<p style="font-size:.75rem;color:#94a3b8;font-weight:600">Sin resultados</p>';return;}
    $('resultadoAlumnoClases').innerHTML='<p style="font-size:.6rem;font-weight:800;text-transform:uppercase;color:#94a3b8;margin-bottom:.6rem">'+resultados.length+' alumnos encontrados — click para ver sus clases</p>'+
    resultados.slice(0,10).map(a=>`<div class="alumno-en-clase" style="margin-bottom:.4rem;cursor:pointer" onclick="expandirAlumnoEnClases('${a.id}','${a.nombre}',this)">
        <div style="display:flex;align-items:center;gap:.7rem">
          <div class="ac-avatar">${a.nombre?.charAt(0)||'?'}</div>
          <div class="ac-info"><p>${a.nombre}</p><span>${a.id}</span></div>
        </div>
        <i class="fa-solid fa-chevron-down" style="color:#94a3b8;font-size:.75rem"></i>
    </div><div id="aclases-${a.id}" style="display:none;padding:.5rem .5rem .5rem 3rem"></div>`).join('');
}

async function expandirAlumnoEnClases(id,nombre,row){
    const panel=$('aclases-'+id);
    if(panel.style.display==='block'){panel.style.display='none';return;}
    panel.style.display='block';
    panel.innerHTML='<p style="font-size:.65rem;color:#94a3b8">Cargando...</p>';
    const snap=await db.collection('reservas').where('alumnoId','==',id).get();
    const res=snap.docs.map(d=>d.data());
    if(!res.length){panel.innerHTML='<p style="font-size:.7rem;color:#94a3b8;font-weight:600;padding:.5rem 0">Sin clases inscritas</p>';return;}
    panel.innerHTML=res.map(r=>`<span class="ac-clase-pill" style="background:${r.estado==='confirmada'?'#dcfce7':'#fef9c3'};color:${r.estado==='confirmada'?'#166534':'#92400e'}">${r.claseNombre} ${r.estado==='confirmada'?'✅':'⏳'}</span>`).join('');
}

// Editar clase
function renderListaClasesEditar(){
    let clases=clasesCached;
    $('listaClasesEditar').innerHTML=clases.length===0?'<p style="font-size:.7rem;color:#94a3b8;font-weight:600;text-align:center;padding:1rem">Sin clases</p>':
    clases.sort((a,b)=>a.nombre.localeCompare(b.nombre)).map(c=>{
        const esFit=c.area==='fitness';
        return`<div onclick="seleccionarClaseEditar('${c.id}')" style="padding:.6rem .8rem;border-radius:10px;border:1.5px solid ${claseActualID===c.id?(esFit?'var(--rojo)':'var(--azul)'):'var(--border)'};background:${claseActualID===c.id?'#f0f4ff':'#f8fafc'};cursor:pointer;margin-bottom:.3rem;transition:all .2s">
            <div style="display:flex;align-items:center;gap:.5rem">
              <span style="font-size:1.1rem">${c.icon||'🏋️'}</span>
              <div>
                <p style="font-weight:800;font-size:.75rem;text-transform:uppercase;line-height:1.2">${c.nombre}</p>
                <p style="font-size:.58rem;color:#94a3b8;font-weight:600">${c.inicio||'--'}–${c.fin||'--'} · ${(c.cupoDisponible??c.cupo??0)} lugares</p>
              </div>
            </div>
        </div>`;
    }).join('');
}

function seleccionarClaseEditar(id){
    const c=clasesCached.find(x=>x.id===id);if(!c)return;
    claseActualID=id;
    $('editarSinSel').style.display='none';$('editarForm').style.display='block';
    $('editarTitulo').textContent=c.icon+' '+c.nombre;
    $('ceNombre').value=c.nombre||'';$('ceArea').value=c.area||'fitness';
    $('ceInicio').value=c.inicio||'';$('ceFin').value=c.fin||'';
    $('cePrecio').value=c.precio||0;$('ceCupo').value=c.cupo||20;
    $('ceIcono').value=c.icon||'🏋️';
    $('ceDisponible').textContent=(c.cupoDisponible??c.cupo??0)+' lugares';
    document.querySelectorAll('.dia-chk').forEach(chk=>{chk.checked=(c.diasSemana||[]).includes(chk.value);});
    renderListaClasesEditar();
}

async function guardarClaseEdit(){
    if(!claseActualID){toast('⚠️ Selecciona una clase');return;}
    const dias=Array.from(document.querySelectorAll('.dia-chk:checked')).map(c=>c.value);
    const datos={
        nombre:$('ceNombre').value.trim().toUpperCase(),area:$('ceArea').value,
        inicio:$('ceInicio').value,fin:$('ceFin').value,
        precio:parseFloat($('cePrecio').value)||0,cupo:parseInt($('ceCupo').value)||20,
        icon:$('ceIcono').value||'🏋️',diasSemana:dias
    };
    if(!datos.nombre){toast('⚠️ El nombre es obligatorio');return;}
    try{await db.collection('catalogo').doc(claseActualID).update(datos);toast('✅ Clase actualizada');}
    catch(e){toast('❌ '+e.message);}
}

async function eliminarClaseEdit(){
    if(!claseActualID)return;
    const clase=clasesCached.find(c=>c.id===claseActualID);
    if(!confirm(`¿Eliminar "${clase?.nombre}"? También se borrarán sus reservas.`))return;
    try{
        const snap=await db.collection('reservas').where('claseId','==',claseActualID).get();
        const batch=db.batch();snap.docs.forEach(d=>batch.delete(d.ref));
        batch.delete(db.collection('catalogo').doc(claseActualID));
        await batch.commit();
        claseActualID=null;$('editarSinSel').style.display='block';$('editarForm').style.display='none';
        toast('🗑️ Clase eliminada');
    }catch(e){toast('❌ '+e.message);}
}

// ── INGRESOS HISTÓRICOS ───────────────────────────────────────────
async function cargarIngresosHist() {
  const mes = $('filtroMesIngr').value;
  if (!mes) return;
  const [y, m] = mes.split('-');
  $('tablaIngresos').innerHTML = '<p style="text-align:center;font-size:.72rem;color:#94a3b8;padding:1rem">Cargando...</p>';
  try {
    const snap = await db.collection('pagos').get();
    const porDia = {};
    snap.forEach(d => {
      const p = d.data();
      const f = p.fechaString || '';
      const parts = f.split('/');
      if (parts.length === 3) {
        const mm = parts[1].padStart(2,'0'), yy = parts[2];
        if (mm === m && yy === y) {
          if (!porDia[f]) porDia[f] = { total:0, ef:0, tf:0, cobros:[] };
          porDia[f].total += (p.monto||0);
          if (p.metodo === 'EFECTIVO') porDia[f].ef += (p.monto||0);
          else porDia[f].tf += (p.monto||0);
          porDia[f].cobros.push({...p, id: d.id});
        }
      }
    });
    const dias = Object.keys(porDia).sort((a,b) => new Date(b.split('/').reverse().join('-')) - new Date(a.split('/').reverse().join('-')));
    if (!dias.length) { $('tablaIngresos').innerHTML = '<p style="text-align:center;font-size:.72rem;color:#94a3b8;padding:1.5rem">Sin cobros en este mes</p>'; $('detalleIngreso').style.display='none'; return; }
    const totalMes = dias.reduce((s, d) => s + porDia[d].total, 0);
    const fmt = n => '$' + n.toLocaleString('es-MX', {minimumFractionDigits:2, maximumFractionDigits:2});
    const dIngresoMes = $('dIngresoMes'); if (dIngresoMes) dIngresoMes.textContent = fmt(totalMes);
    window._ingresosCache = porDia;
    $('tablaIngresos').innerHTML = dias.map(dia => `
      <div onclick="mostrarDetalleDia('${dia.replace(/\\/g,'\\\\').replace(/'/g,"\\'")}')"
           style="display:flex;justify-content:space-between;align-items:center;padding:.75rem 1rem;background:#f8fafc;border:1.5px solid var(--border);border-radius:12px;cursor:pointer;transition:all .2s"
           onmouseover="this.style.borderColor='#94a3b8'" onmouseout="this.style.borderColor='var(--border)'">
        <div>
          <p style="font-weight:800;font-size:.8rem">${dia}</p>
          <p style="font-size:.6rem;color:var(--txt2);font-weight:600">${porDia[dia].cobros.length} cobro(s) · 💵${fmt(porDia[dia].ef)} · 🏦${fmt(porDia[dia].tf)}</p>
        </div>
        <p style="font-size:1rem;font-weight:900;color:#059669">${fmt(porDia[dia].total)}</p>
      </div>`).join('');
    $('detalleIngreso').style.display = 'none';
  } catch(e) { toast('❌ ' + e.message); }
}

function mostrarDetalleDia(dia) {
  const porDia = window._ingresosCache || {};
  const cobros = (porDia[dia] && porDia[dia].cobros) ? porDia[dia].cobros : [];
  $('detalleIngresoTitulo').textContent = '📋 Recibos del ' + dia;
  $('detalleIngreso').style.display = 'block';
  const fmt = n => '$' + n.toLocaleString('es-MX', {minimumFractionDigits:2, maximumFractionDigits:2});
  $('listaDetalleIngreso').innerHTML = cobros.map(p => {
    const metIcon = p.metodo==='EFECTIVO'?'💵':p.metodo==='TRANSFERENCIA'?'🏦':'💳';
    const refTag = p.referencia ? `<span style="font-size:.55rem;color:var(--azul);background:#eef3ff;padding:1px 5px;border-radius:5px;margin-left:.3rem">REF: ${p.referencia}</span>` : '';
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:.75rem 1rem;background:#f8fafc;border:1px solid var(--border);border-radius:10px">
      <div>
        <p style="font-weight:900;font-size:.78rem;text-transform:uppercase">${p.nombre||p.alumnoId||'—'}</p>
        <p style="font-size:.6rem;font-weight:700;color:var(--azul)">${p.folio||'S/F'}</p>
        <p style="font-size:.6rem;font-weight:600;color:var(--txt2)">${p.detalle||'—'}${refTag}</p>
      </div>
      <div style="text-align:right">
        <p style="font-size:.9rem;font-weight:900;color:#059669">${fmt(p.monto||0)}</p>
        <p style="font-size:.6rem;color:var(--txt2)">${metIcon} ${p.metodo||''}</p>
      </div>
    </div>`;
  }).join('') || '<p style="text-align:center;font-size:.72rem;color:#94a3b8;padding:1rem">Sin recibos</p>';
  $('detalleIngreso').scrollIntoView({behavior:'smooth', block:'start'});
}
// Inicializar filtro de mes al cargar
window.addEventListener('DOMContentLoaded',()=>{
    cargarConfigRecepcion();
    const hoy=new Date();
    const mesActual=hoy.getFullYear()+'-'+String(hoy.getMonth()+1).padStart(2,'0');
    const fi=$('filtroMesIngr');if(fi)fi.value=mesActual;
    setInterval(()=>$('reloj').textContent=new Date().toLocaleTimeString('es-MX'),1000);
});
let ingresosDesbloqueado = false; // kept for backward-compat, no longer used directly
function abrirIngresos() {
  // Ingresos solo visible para admins — verificado por rol de Firebase Auth
  if (_staffRol === 'admin') {
    showView('ingresos', document.getElementById('sbIngresos'));
  } else {
    toast('⛔ Solo el administrador puede ver los ingresos.');
  }
}
// Kept for backwards compatibility — no longer uses a hardcoded PIN
function verificarPinIngresos() {
  abrirIngresos();
}

let cuponAplicado = false;
const CUPON_VALIDO = 'APERTURA2026';
const FECHA_FIN_CUPON = new Date('2026-04-01');

function verificarCupon() {
  const val = $('rCupon').value.trim().toUpperCase();
  const hoy = new Date();
  if (val === CUPON_VALIDO && hoy < FECHA_FIN_CUPON) {
    cuponAplicado = true;
    $('cuponEstado').textContent = '✅ Inscripción GRATIS';
    $('cuponEstado').style.color = '#059669';
  } else if (val === CUPON_VALIDO && hoy >= FECHA_FIN_CUPON) {
    cuponAplicado = false;
    $('cuponEstado').textContent = '⏰ Cupón expirado';
    $('cuponEstado').style.color = '#d97706';
  } else if (val) {
    cuponAplicado = false;
    $('cuponEstado').textContent = '❌ Cupón inválido';
    $('cuponEstado').style.color = '#dc2626';
  } else {
    cuponAplicado = false;
    $('cuponEstado').textContent = '';
  }
}

async function cargarPagosRecientes(alumnoId) {
  const cajaPagos = $('cajaPagosRecientes');
  if (!cajaPagos) return;
  try {
    const snap = await db.collection('pagos').where('alumnoId','==',alumnoId).orderBy('fecha','desc').limit(5).get().catch(async () => {
      // Fallback if composite index not yet created: query without orderBy
      return db.collection('pagos').where('alumnoId','==',alumnoId).limit(10).get();
    });
    const fmt = n => '$' + n.toLocaleString('es-MX',{minimumFractionDigits:2,maximumFractionDigits:2});
    if (snap.empty) { cajaPagos.innerHTML = '<p style="font-size:.65rem;color:var(--txt2);text-align:center;padding:.5rem">Sin pagos registrados</p>'; return; }
    cajaPagos.innerHTML = snap.docs.map(d => {
      const p = d.data();
      const metIcon = p.metodo==='EFECTIVO'?'💵':p.metodo==='TRANSFERENCIA'?'🏦':'💳';
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:.4rem .65rem;background:#f8fafc;border-radius:8px;border:1px solid var(--border)">
        <div><p style="font-size:.7rem;font-weight:800">${p.detalle||'—'}</p><p style="font-size:.58rem;color:var(--txt2)">${p.fechaString||''} · ${metIcon} ${p.metodo||''}</p></div>
        <p style="font-size:.78rem;font-weight:900;color:#059669">${fmt(p.monto||0)}</p>
      </div>`;
    }).join('');
  } catch(e) { cajaPagos.innerHTML = '<p style="font-size:.65rem;color:var(--txt2);text-align:center">Error al cargar</p>'; }
}

let asistenciaTemp = {};
let asistenciaNombres = {};

async function cargarAsistenciaClase() {
  if (!claseActualID) return;
  const fecha = $('asistFecha').value;
  if (!fecha) return;
  const snap = await db.collection('reservas').where('claseId','==',claseActualID).where('estado','==','confirmada').get();
  const asistSnap = await db.collection('asistencias').where('claseId','==',claseActualID).where('fecha','==',fecha).get();
  const asistMap = {};
  asistSnap.docs.forEach(d => { asistMap[d.data().alumnoId] = d.data().tipo; });
  asistenciaTemp = {};
  asistenciaNombres = {};
  if (snap.empty) { $('listaAsistencia').innerHTML = '<p style="text-align:center;font-size:.72rem;color:#94a3b8;padding:1.5rem">Sin alumnos inscritos</p>'; return; }
  snap.docs.forEach(d => {
    const aid = d.data().alumnoId;
    asistenciaTemp[aid] = asistMap[aid] || 'ausente';
    asistenciaNombres[aid] = d.data().alumnoNombre || aid;
  });
  $('listaAsistencia').innerHTML = snap.docs.map(d => {
    const aid = d.data().alumnoId;
    const nombre = d.data().alumnoNombre || aid;
    const est = asistenciaTemp[aid] || 'ausente';
    return `<div id="ar-${aid}" style="display:flex;align-items:center;justify-content:space-between;padding:.6rem .8rem;border-radius:10px;border:1px solid var(--border);background:white">
      <div style="display:flex;align-items:center;gap:.6rem">
        <div style="width:32px;height:32px;border-radius:8px;background:var(--azul);color:white;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:.85rem">${nombre.charAt(0)}</div>
        <div><p style="font-weight:800;font-size:.75rem;text-transform:uppercase">${nombre}</p><p style="font-size:.58rem;color:var(--txt2);font-family:monospace">${aid}</p></div>
      </div>
      <div style="display:flex;gap:.3rem">
        <button onclick="setAsistencia('${aid}','presente')" id="ab-p-${aid}" class="btn" style="font-size:.65rem;padding:.3rem .5rem;background:${est==='presente'?'#10b981':'#f1f5f9'};color:${est==='presente'?'white':'var(--txt2)'}">✅</button>
        <button onclick="setAsistencia('${aid}','tarde')" id="ab-t-${aid}" class="btn" style="font-size:.65rem;padding:.3rem .5rem;background:${est==='tarde'?'#f59e0b':'#f1f5f9'};color:${est==='tarde'?'white':'var(--txt2)'}">⏰</button>
        <button onclick="setAsistencia('${aid}','ausente')" id="ab-a-${aid}" class="btn" style="font-size:.65rem;padding:.3rem .5rem;background:${est==='ausente'?'#ef4444':'#f1f5f9'};color:${est==='ausente'?'white':'var(--txt2)'}">❌</button>
      </div>
    </div>`;
  }).join('');
}

function setAsistencia(aid, tipo) {
  asistenciaTemp[aid] = tipo;
  const colores = { presente:'#10b981', tarde:'#f59e0b', ausente:'#ef4444' };
  ['presente','tarde','ausente'].forEach(t => {
    const btn = $('ab-' + t.charAt(0) + '-' + aid);
    if (btn) { btn.style.background = tipo===t ? colores[t] : '#f1f5f9'; btn.style.color = tipo===t ? 'white' : 'var(--txt2)'; }
  });
}

async function guardarAsistencia() {
  const fecha = $('asistFecha').value;
  if (!fecha || !claseActualID) return;
  const clase = clasesCached.find(c => c.id === claseActualID);
  const batch = db.batch();
  for (const [aid, tipo] of Object.entries(asistenciaTemp)) {
    const nombre = asistenciaNombres[aid] || aid;
    const ref = db.collection('asistencias').doc(claseActualID + '_' + fecha + '_' + aid);
    batch.set(ref, { claseId: claseActualID, claseNombre: clase?.nombre||'', alumnoId: aid, alumnoNombre: nombre, fecha, tipo, registradoEn: new Date() });
  }
  try { await batch.commit(); toast('✅ Asistencia guardada'); } catch(e) { toast('❌ ' + e.message); }
}

function setHorarioMañana() {
  const d = new Date(); d.setDate(d.getDate() + 1);
  $('horarioDia').value = d.toISOString().split('T')[0];
  cargarHorarioDia();
}

async function cargarHorarioDia() {
  const fecha = $('horarioDia').value;
  if (!fecha) return;
  const d = new Date(fecha + 'T12:00:00');
  const diasNombre = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const diaNombre = diasNombre[d.getDay()];
  $('horarioClases').innerHTML = '<p style="text-align:center;font-size:.72rem;color:#94a3b8;padding:2rem">Cargando...</p>';
  try {
    const snap = await db.collection('catalogo').where('tipo','==','clase').where('activa','==',true).get();
    const clasesDia = snap.docs
      .filter(doc => { const ds = doc.data().diasSemana||[doc.data().dia||'']; return ds.includes(diaNombre) || ds.includes(diaNombre.toLowerCase()); })
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .sort((a,b) => (a.inicio||'').localeCompare(b.inicio||''));
    $('horarioResumen').innerHTML = `
      <div class="stat-card"><div class="accent" style="background:var(--azul)"></div><p class="stat-lbl">Clases del día</p><p class="stat-val">${clasesDia.length}</p></div>
      <div class="stat-card"><div class="accent" style="background:#10b981"></div><p class="stat-lbl">Con profesor</p><p class="stat-val" style="color:#059669">${clasesDia.filter(c=>c.profesor).length}</p></div>
      <div class="stat-card"><div class="accent" style="background:#f59e0b"></div><p class="stat-lbl">Sin asignar</p><p class="stat-val" style="color:#d97706">${clasesDia.filter(c=>!c.profesor).length}</p></div>
    `;
    if (!clasesDia.length) {
      $('horarioClases').innerHTML = `<div class="card" style="padding:3rem;text-align:center;color:var(--txt2)"><i class="fa-solid fa-calendar-xmark" style="font-size:2rem;opacity:.2;display:block;margin-bottom:1rem"></i><p style="font-weight:800;font-size:.85rem;text-transform:uppercase">Sin clases para ${diaNombre}</p></div>`;
      return;
    }
    const clasesConInscritos = await Promise.all(clasesDia.map(async clase => {
      const resSnap = await db.collection('reservas').where('claseId','==',clase.id).where('estado','==','confirmada').get();
      return { ...clase, inscritos: resSnap.size, alumnosLista: resSnap.docs.map(d => ({ id: d.data().alumnoId, nombre: d.data().alumnoNombre||d.data().alumnoId })) };
    }));
    $('horarioClases').innerHTML = clasesConInscritos.map(clase => `
      <div class="card" style="padding:1.2rem">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.75rem">
          <div style="display:flex;align-items:center;gap:.75rem">
            <div style="width:44px;height:44px;border-radius:12px;background:${clase.area==='fitness'?'var(--rojo)':'var(--azul)'};color:white;display:flex;align-items:center;justify-content:center;font-size:1.3rem">${clase.icon||'📚'}</div>
            <div>
              <p style="font-weight:900;font-size:.9rem;text-transform:uppercase">${clase.nombre}</p>
              <p style="font-size:.65rem;font-weight:700;color:var(--txt2)">⏰ ${clase.inicio||'--'} – ${clase.fin||'--'} · ${diaNombre}</p>
              <p style="font-size:.65rem;font-weight:700;color:${clase.profesor?'var(--azul)':'#f59e0b'}">👤 ${clase.profesor||'⚠️ Sin profesor asignado'}</p>
            </div>
          </div>
          <div style="text-align:right">
            <p style="font-size:1.5rem;font-weight:900;color:var(--azul)">${clase.inscritos}</p>
            <p style="font-size:.55rem;font-weight:800;color:var(--txt2);text-transform:uppercase">inscritos</p>
            <p style="font-size:.58rem;color:var(--txt2)">${clase.cupoDisponible??clase.cupo??'—'} lugares</p>
          </div>
        </div>
        ${clase.alumnosLista.length ? `
        <details style="margin-top:.5rem">
          <summary style="font-size:.65rem;font-weight:800;color:var(--azul);cursor:pointer;text-transform:uppercase;letter-spacing:.05em">Ver lista de alumnos (${clase.alumnosLista.length})</summary>
          <div style="display:flex;flex-direction:column;gap:.3rem;margin-top:.5rem;max-height:200px;overflow-y:auto">
            ${clase.alumnosLista.map((a,i) => `
              <div style="display:flex;align-items:center;gap:.5rem;padding:.4rem .7rem;background:#f8fafc;border-radius:8px">
                <span style="font-size:.65rem;font-weight:900;color:var(--txt2);width:20px">${i+1}.</span>
                <span style="font-size:.72rem;font-weight:800;text-transform:uppercase">${a.nombre}</span>
                <span style="font-size:.58rem;color:var(--txt2);font-family:monospace;margin-left:auto">${a.id}</span>
              </div>`).join('')}
          </div>
        </details>` : '<p style="font-size:.65rem;color:#94a3b8;font-weight:600;margin-top:.3rem">Sin alumnos inscritos aún</p>'}
        ${!clase.profesor ? '<div style="margin-top:.5rem;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:.5rem .75rem;font-size:.65rem;font-weight:700;color:#d97706">⚠️ Esta clase no tiene profesor asignado. Asignar desde el panel de clases.</div>' : ''}
      </div>
    `).join('');
  } catch(e) { toast('❌ ' + e.message); $('horarioClases').innerHTML = ''; }
}
