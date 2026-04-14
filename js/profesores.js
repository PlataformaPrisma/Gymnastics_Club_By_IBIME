
// ─── FIREBASE ────────────────────────────────────
// Inicializado por assets/js/firebase-init.js
const db = firebase.firestore();

// ─── HELPERS ─────────────────────────────────────
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ─── STATE ───────────────────────────────────────
let profesorActual = null;
let clasesProfesor = [];
let claseActual = null;
let alumnosActuales = [];
let asistenciaMap = {};   // alumnoId -> 'presente'|'ausente'|'tarde'|'justificado'
let qrScanner = null;
// Unsubscribe handles for real-time listeners
let _unsubClases = null;
let _unsubClasesFallback = null;
let _unsubAlumnos = null;
// Handle for checkClaseActual interval (not used in this portal, kept for consistency)
let _checkClaseInterval = null;
// Dynamic date — recalculated each call so sessions crossing midnight use the correct date
function getHoy() { return new Date().toISOString().split('T')[0]; }

// ─── CLOCK ───────────────────────────────────────
function updateClock() {
  const now = new Date();
  const t = now.toLocaleTimeString('es-MX', { hour12: false });
  document.getElementById('topbar-clock').textContent = t;
}
setInterval(updateClock, 1000);
updateClock();

// ─── SIDEBAR DATE ─────────────────────────────────
(function setDate() {
  const d = new Date();
  const opts = { weekday: 'long', day: 'numeric', month: 'long' };
  const txt = d.toLocaleDateString('es-MX', opts);
  document.getElementById('sb-date').textContent = txt.charAt(0).toUpperCase() + txt.slice(1);
})();

// ─── TOAST ───────────────────────────────────────
function toast(msg, type = 'info', icon = null) {
  const icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', info: 'fa-info-circle' };
  const ic = icon || icons[type] || 'fa-info-circle';
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<i class="fas ${ic} toast-icon"></i><span>${msg}</span>`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => {
    el.style.animation = 'slideOutRight .3s ease forwards';
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

// ─── LOAD PROFESSORS ─────────────────────────────
async function loadProfesores() {
  const sel = document.getElementById('sel-profesor');
  sel.innerHTML = '<option value="">— Selecciona tu nombre —</option>';
  try {
    const snap = await db.collection('profesores').orderBy('nombre').get();
    if (snap.empty) {
      sel.innerHTML = '<option value="">— Sin profesores. Usa "Importar" —</option>';
      return;
    }
    snap.forEach(doc => {
      const op = document.createElement('option');
      op.value = doc.id;
      op.textContent = doc.data().nombre;
      sel.appendChild(op);
    });
  } catch (e) {
    console.error('Error cargando profesores:', e);
    toast('Error cargando profesores: ' + e.message, 'error');
  }
}

// ─── IMPORT PROFESSORS ───────────────────────────
async function importarProfesores() {
  try {
    toast('Importando profesores desde catálogo...', 'info', 'fa-sync-alt');
    const snap = await db.collection('catalogo').where('tipo', '==', 'clase').get();
    if (snap.empty) { toast('No hay clases en el catálogo', 'error'); return; }
    const nombres = new Set();
    snap.forEach(d => { if (d.data().profesor) nombres.add(d.data().profesor.trim()); });
    if (!nombres.size) { toast('No se encontraron profesores en las clases', 'error'); return; }
    let creados = 0;
    for (const nombre of nombres) {
      const id = nombre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      const ref = db.collection('profesores').doc(id);
      const exists = await ref.get();
      if (!exists.exists) {
        await ref.set({ nombre, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        creados++;
      }
    }
    toast(`Importación completa. ${creados} nuevo(s) creado(s)`, 'success');
    await loadProfesores();
  } catch (e) {
    console.error('Error importando:', e);
    toast('Error en importación: ' + e.message, 'error');
  }
}

// ─── LOGIN ───────────────────────────────────────
async function doLogin() {
  const sel = document.getElementById('sel-profesor');
  const pwd = document.getElementById('inp-password');
  const errEl = document.getElementById('login-error');
  errEl.style.display = 'none';

  if (!sel.value) { toast('Por favor selecciona tu nombre', 'error'); return; }
  if (!pwd.value) { toast('Ingresa tu contraseña', 'error'); return; }

  // Build internal email: profe.{profesorId}@prisma.com
  const emailInterno = 'profe.' + sel.value + '@prisma.com';

  try {
    await firebase.auth().signInWithEmailAndPassword(emailInterno, pwd.value);
    // onAuthStateChanged will call _iniciarSesionProfesor after successful auth
  } catch (e) {
    console.error('Error en login:', e);
    errEl.style.display = 'block';
  }
}

async function _iniciarSesionProfesor(profesorId) {
  try {
    const snap = await db.collection('profesores').doc(profesorId).get();
    if (!snap.exists) { toast('Profesor no encontrado en la base de datos', 'error'); await firebase.auth().signOut(); return; }
    profesorActual = { id: snap.id, ...snap.data() };

    // Aplicar contraseña pendiente si existe
    if (profesorActual.passwordPendiente) {
      try {
        await firebase.auth().currentUser.updatePassword(profesorActual.passwordPendiente);
        await db.collection('profesores').doc(profesorId).update({
          passwordPendiente: firebase.firestore.FieldValue.delete()
        });
      } catch(e) {
        console.warn('No se pudo aplicar contraseña pendiente:', e);
        // No bloquear el acceso — el profesor ya está autenticado
      }
    }

    // Update sidebar
    const inicial = profesorActual.nombre.charAt(0).toUpperCase();
    document.getElementById('prof-avatar').textContent = inicial;
    document.getElementById('prof-name').textContent = profesorActual.nombre;

    // Hide login, show app
    document.getElementById('login-screen').style.display = 'none';
    const appEl = document.getElementById('app');
    appEl.classList.add('visible');

    toast(`Bienvenido, ${profesorActual.nombre}!`, 'success');
    loadClasesProfesor(); // inicia listener en tiempo real (no necesita await)
  } catch (e) {
    console.error('Error al iniciar sesión de profesor:', e);
    toast('Error al iniciar sesión: ' + e.message, 'error');
  }
}

// Observe Firebase Auth state to support session restore across page loads
firebase.auth().onAuthStateChanged(async (user) => {
  if (!user) {
    // No active session — show login
    document.getElementById('login-screen').style.display = 'flex';
    const appEl = document.getElementById('app');
    if (appEl) appEl.classList.remove('visible');
    return;
  }
  // Extract profesorId from internal email (profe.{id}@prisma.com)
  const match = user.email && user.email.match(/^profe\.(.+)@prisma\.com$/);
  if (match) {
    const profesorId = match[1];
    if (!profesorActual) {
      await _iniciarSesionProfesor(profesorId);
    }
  } else {
    // Email doesn't match expected professor format — sign out
    await firebase.auth().signOut();
  }
});

// ─── LOGOUT ──────────────────────────────────────
function doLogout() {
  // Cancelar listeners en tiempo real
  if (_unsubClases) { _unsubClases(); _unsubClases = null; }
  if (_unsubClasesFallback) { _unsubClasesFallback(); _unsubClasesFallback = null; }
  if (_unsubAlumnos) { _unsubAlumnos(); _unsubAlumnos = null; }
  profesorActual = null;
  clasesProfesor = [];
  claseActual = null;
  asistenciaMap = {};
  document.getElementById('app').classList.remove('visible');
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('sel-profesor').value = '';
  document.getElementById('inp-password').value = '';
  showView('dashboard');
  firebase.auth().signOut().catch(() => {});
  toast('Sesión cerrada', 'info');
}

// ─── LOAD CLASSES (real-time) ─────────────────────
function loadClasesProfesor() {
  const sbEl = document.getElementById('sb-classes');
  const dashEl = document.getElementById('dashboard-classes');
  sbEl.innerHTML = '<div class="loading"><i class="fas fa-circle-notch spin"></i></div>';
  dashEl.innerHTML = '<div class="loading"><i class="fas fa-circle-notch spin"></i></div>';

  // Cancelar listener anterior si existe
  if (_unsubClasesFallback) { _unsubClasesFallback(); _unsubClasesFallback = null; }
  if (_unsubClases) { _unsubClases(); _unsubClases = null; }

  _unsubClases = db.collection('catalogo')
    .where('tipo', '==', 'clase')
    .where('profesorId', '==', profesorActual.id)
    .onSnapshot(snap => {
      if (!snap.empty) {
        // Cancel fallback listener if primary has data
        if (_unsubClasesFallback) { _unsubClasesFallback(); _unsubClasesFallback = null; }
        clasesProfesor = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        _renderClasesProfesor(sbEl, dashEl);
        loadDashboardStats();
      } else {
        // Fallback: buscar por nombre para clases legacy sin profesorId (reactivo)
        if (_unsubClasesFallback) { _unsubClasesFallback(); _unsubClasesFallback = null; }
        _unsubClasesFallback = db.collection('catalogo')
          .where('tipo', '==', 'clase')
          .where('profesor', '==', profesorActual.nombre)
          .onSnapshot(snap2 => {
            clasesProfesor = snap2.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            _renderClasesProfesor(sbEl, dashEl);
            loadDashboardStats();
          });
      }
    }, err => {
      console.error('Error cargando clases:', err);
      toast('Error cargando clases: ' + err.message, 'error');
      sbEl.innerHTML = '<div class="sb-empty">Error al cargar</div>';
    });
}

function _renderClasesProfesor(sbEl, dashEl) {
  if (clasesProfesor.length === 0) {
    sbEl.innerHTML = '<div class="sb-empty"><i class="fas fa-calendar-times" style="display:block;font-size:1.5rem;margin-bottom:8px;opacity:.4"></i>Sin clases asignadas</div>';
    dashEl.innerHTML = '<div class="student-empty">No tienes clases asignadas. Verifica con el administrador.</div>';
    return;
  }

  // Día de hoy en español para comparar con c.dia
  const diasES = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const hoyDia = diasES[new Date().getDay()];

  sbEl.innerHTML = '';
  clasesProfesor.forEach(c => {
    const inscritos = (c.cupo || 0) - (c.cupoDisponible || 0);
    const esHoy = (c.dia || '') === hoyDia;
    sbEl.innerHTML += `
      <div class="sb-class-item${esHoy ? ' active' : ''}" id="sb-item-${esc(c.id)}" onclick="selectClass('${esc(c.id)}')">
        <div class="sb-class-icon">${esc(c.icon) || '🏋️'}</div>
        <div class="sb-class-info">
          <div class="sb-class-name">${esc(c.nombre) || 'Sin nombre'}${esHoy ? ' <span style="font-size:.55rem;background:rgba(16,185,129,.2);color:#34d399;border-radius:4px;padding:1px 5px;font-weight:700">HOY</span>' : ''}</div>
          <div class="sb-class-meta">${esc(c.dia)} · ${esc(c.inicio)}–${esc(c.fin)}</div>
        </div>
        <div class="sb-class-badge">${inscritos}</div>
      </div>`;
  });

  dashEl.innerHTML = '';
  clasesProfesor.forEach(c => {
    const inscritos = (c.cupo || 0) - (c.cupoDisponible || 0);
    const pct = c.cupo ? Math.round((inscritos / c.cupo) * 100) : 0;
    const esHoy = (c.dia || '') === hoyDia;
    dashEl.innerHTML += `
      <div class="class-card fade-up${esHoy ? ' class-card-hoy' : ''}" onclick="selectClass('${esc(c.id)}')" style="${esHoy ? 'border-color:rgba(16,185,129,.4);' : ''}">
        <div class="class-card-top">
          <div class="class-card-icon">${esc(c.icon) || '🏋️'}</div>
          <div class="class-card-badge" style="${esHoy ? 'background:rgba(16,185,129,.25);border-color:rgba(16,185,129,.4);color:#34d399' : ''}">${esHoy ? '📅 Hoy · ' : ''}${inscritos} inscritos</div>
        </div>
        <div class="class-card-name">${esc(c.nombre) || 'Sin nombre'}</div>
        <div class="class-card-meta">
          <span><i class="fas fa-calendar-week"></i>${esc(c.dia) || '—'}</span>
          <span><i class="fas fa-clock"></i>${esc(c.inicio) || '?'}–${esc(c.fin) || '?'}</span>
        </div>
        <div class="class-card-footer">
          <div style="font-size:.75rem;color:var(--txt2)">${pct}% ocupación</div>
          <button class="class-card-btn">Ver detalle →</button>
        </div>
      </div>`;
  });
  // Actualizar el estado activo del sidebar si hay una clase seleccionada
  if (claseActual) {
    const sbItem = document.getElementById('sb-item-' + claseActual.id);
    if (sbItem) sbItem.classList.add('active');
  }
}

// ─── DASHBOARD STATS ──────────────────────────────
async function loadDashboardStats() {
  try {
    // Total alumnos
    let totalAlumnos = 0;
    clasesProfesor.forEach(c => totalAlumnos += (c.cupo || 0) - (c.cupoDisponible || 0));
    document.getElementById('stat-alumnos').textContent = totalAlumnos;
    document.getElementById('stat-clases').textContent = clasesProfesor.length;

    // Asistencias hoy
    const nombresClases = clasesProfesor.map(c => c.nombre).filter(Boolean);
    if (nombresClases.length) {
      let count = 0;
      for (const nombre of nombresClases) {
        const snap = await db.collection('asistencias')
          .where('fecha', '==', getHoy())
          .where('claseNombre', '==', nombre)
          .get();
        count += snap.size;
      }
      document.getElementById('stat-asistencias').textContent = count;
    }
  } catch (e) {
    console.error('Error stats:', e);
  }
}

// ─── SELECT CLASS ─────────────────────────────────
async function selectClass(claseId) {
  claseActual = clasesProfesor.find(c => c.id === claseId);
  if (!claseActual) return;

  asistenciaMap = {};

  // Sidebar active state
  document.querySelectorAll('.sb-class-item').forEach(el => el.classList.remove('active'));
  const sbItem = document.getElementById('sb-item-' + claseId);
  if (sbItem) sbItem.classList.add('active');

  // Close sidebar on mobile
  closeSidebar();

  // Populate header
  const inscritos = (claseActual.cupo || 0) - (claseActual.cupoDisponible || 0);
  const pct = claseActual.cupo ? Math.round((inscritos / claseActual.cupo) * 100) : 0;
  document.getElementById('det-icon').textContent = claseActual.icon || '🏋️';
  document.getElementById('det-name').textContent = claseActual.nombre;
  document.getElementById('det-dia').textContent = claseActual.dia || '—';
  document.getElementById('det-horario').textContent = `${claseActual.inicio || '?'} – ${claseActual.fin || '?'}`;
  document.getElementById('det-inscritos').textContent = `${inscritos} / ${claseActual.cupo || '?'} alumnos`;
  document.getElementById('det-pct').textContent = pct + '%';
  document.getElementById('det-progress').style.width = pct + '%';
  document.getElementById('topbar-title').textContent = claseActual.nombre;

  showView('detail');

  // Reset counters
  resetCounters();
  clearComments();

  loadAlumnos(claseId); // listener en tiempo real (no necesita await)
  await loadCommentHistory(claseId);
}

// ─── LOAD STUDENTS ────────────────────────────────
function loadAlumnos(claseId) {
  const cont = document.getElementById('students-container');
  cont.innerHTML = '<div class="student-empty"><i class="fas fa-circle-notch spin"></i> Cargando alumnos...</div>';

  // Cancelar listener anterior
  if (_unsubAlumnos) { _unsubAlumnos(); _unsubAlumnos = null; }

  // Obtener fecha de hoy y fecha límite (+7 días) en MX para filtrar sesiones del plan semanal
  const hoyMX = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' }); // YYYY-MM-DD
  const fechaLimite = new Date(new Date().getTime() + 7 * 24 * 60 * 60 * 1000)
    .toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' }); // YYYY-MM-DD

  _unsubAlumnos = db.collection('reservas')
    .where('claseId', '==', claseId)
    .where('estado', '==', 'confirmada')
    .onSnapshot(snap => {
      // Filtrar: si la reserva tiene fechaClase (plan semanal), mostrar solo la de hoy.
      // Si no tiene fechaClase (legacy), mostrarla siempre.
      const todas = [];
      snap.forEach(doc => todas.push({ id: doc.id, ...doc.data() }));
      alumnosActuales = todas.filter(a => !a.fechaClase || (a.fechaClase >= hoyMX && a.fechaClase <= fechaLimite));

      document.getElementById('student-count').textContent = `${alumnosActuales.length} alumno${alumnosActuales.length !== 1 ? 's' : ''}`;

      if (!alumnosActuales.length) {
        cont.innerHTML = '<div class="student-empty"><i class="fas fa-user-slash" style="font-size:1.5rem;opacity:.4;display:block;margin-bottom:8px"></i>No hay alumnos para la sesión de hoy con estado confirmado</div>';
        return;
      }

      cont.innerHTML = '';
      alumnosActuales.forEach(a => {
        const aId = esc(a.alumnoId || a.id);
        const rawId = a.alumnoId || a.id;
        const inicial = (a.alumnoNombre || 'A').charAt(0).toUpperCase();
        // Preservar asistencia ya marcada en esta sesión
        if (asistenciaMap[rawId] === undefined) asistenciaMap[rawId] = null;
        const horarioMeta = (a.dia && a.hora)
          ? `<div class="student-id" style="margin-top:2px">📅 ${esc(a.dia)} ${esc(a.hora)}${a.horaFin?' – '+esc(a.horaFin):''}</div>`
          : '';
        const fechaMeta = a.fechaClase
          ? `<div class="student-id" style="margin-top:2px;color:#6366f1">📆 Sesión: ${esc(a.fechaClase)}</div>`
          : '';
        const pasesInfo = (typeof a.pasesRestantes === 'number' && a.pasesTotal)
          ? `<div class="student-id" style="color:#f59e0b">🎫 ${a.pasesRestantes}/${a.pasesTotal} pases</div>`
          : '';
        cont.innerHTML += `
          <div class="student-row" id="row-${aId}">
            <div class="student-avatar">${esc(inicial)}</div>
            <div class="student-info">
              <div class="student-name">${esc(a.alumnoNombre) || 'Sin nombre'}</div>
              <div class="student-id">ID: ${aId}</div>
              ${horarioMeta}
              ${fechaMeta}
              ${pasesInfo}
            </div>
            <div class="student-badges">
              <div class="badge badge-presente${asistenciaMap[rawId]==='presente'?' active':''}" onclick="setAsistencia('${aId}','presente',this)">✓ Presente</div>
              <div class="badge badge-ausente${asistenciaMap[rawId]==='ausente'?' active':''}" onclick="setAsistencia('${aId}','ausente',this)">✗ Ausente</div>
              <div class="badge badge-tarde${asistenciaMap[rawId]==='tarde'?' active':''}" onclick="setAsistencia('${aId}','tarde',this)">⏰ Tarde</div>
              <div class="badge badge-justificado${asistenciaMap[rawId]==='justificado'?' active':''}" onclick="setAsistencia('${aId}','justificado',this)">📋 Justificado</div>
            </div>
          </div>`;
      });

      updateCounters();
      loadDashboardStats();
    }, err => {
      console.error('Error cargando alumnos:', err);
      toast('Error cargando alumnos: ' + err.message, 'error');
      cont.innerHTML = '<div class="student-empty">Error al cargar alumnos</div>';
    });
}

// ─── ATTENDANCE BADGE ─────────────────────────────
function setAsistencia(alumnoId, tipo, clickedEl) {
  const row = document.getElementById('row-' + alumnoId);
  if (!row) return;
  // Remove active from all badges in this row
  row.querySelectorAll('.badge').forEach(b => b.classList.remove('active'));
  // Toggle: if same type, deselect
  if (asistenciaMap[alumnoId] === tipo) {
    asistenciaMap[alumnoId] = null;
  } else {
    asistenciaMap[alumnoId] = tipo;
    clickedEl.classList.add('active');
  }
  updateCounters();
}

function resetCounters() {
  ['presente','ausente','tarde','justificado'].forEach(t => {
    document.getElementById('cnt-' + t).textContent = '0';
  });
}

function updateCounters() {
  const counts = { presente: 0, ausente: 0, tarde: 0, justificado: 0 };
  Object.values(asistenciaMap).forEach(v => { if (v && counts[v] !== undefined) counts[v]++; });
  Object.entries(counts).forEach(([k, v]) => {
    document.getElementById('cnt-' + k).textContent = v;
  });
}

// ─── MARK ALL PRESENT ─────────────────────────────
function markAllPresent() {
  alumnosActuales.forEach(a => {
    const id = a.alumnoId || a.id;
    asistenciaMap[id] = 'presente';
    const row = document.getElementById('row-' + id);
    if (row) {
      row.querySelectorAll('.badge').forEach(b => b.classList.remove('active'));
      const presEl = row.querySelector('.badge-presente');
      if (presEl) presEl.classList.add('active');
    }
  });
  updateCounters();
  toast('Todos marcados como presentes', 'success');
}

// ─── SAVE ATTENDANCE ──────────────────────────────
async function saveAttendance() {
  if (!claseActual || !profesorActual) return;
  const hora = new Date().toLocaleTimeString('es-MX', { hour12: false });
  let saved = 0;
  try {
    const batch = db.batch();
    alumnosActuales.forEach(a => {
      const id = a.alumnoId || a.id;
      const tipo = asistenciaMap[id];
      if (!tipo) return;
      // Registrar asistencia
      const ref = db.collection('asistencias').doc();
      batch.set(ref, {
        alumnoId: id,
        alumnoNombre: a.alumnoNombre || '',
        claseId: claseActual.id,
        claseNombre: claseActual.nombre || '',
        profesorId: profesorActual.id,
        profesorNombre: profesorActual.nombre,
        fecha: getHoy(),
        hora,
        tipo,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });
      // Descontar 1 pase de la reserva (política estricta: se descuenta siempre,
      // asistió o no asistió). Actualizar también el flag de asistencia/falta.
      // asistencia=true si presente o tarde; falta=true si ausente o justificado.
      const reservaRef = db.collection('reservas').doc(a.id);
      const asistioFlag = tipo === 'presente' || tipo === 'tarde';
      batch.update(reservaRef, {
        pasesRestantes: firebase.firestore.FieldValue.increment(-1),
        asistencia: asistioFlag,
        falta: !asistioFlag
      });
      // Decrementar clasesRestantes del alumno para que su panel refleje el consumo
      if (asistioFlag) {
        batch.update(db.collection('alumnos').doc(id), {
          clasesRestantes: firebase.firestore.FieldValue.increment(-1)
        });
      }
      saved++;
    });
    await batch.commit();
    toast(`✅ Asistencia guardada (${saved} registros)`, 'success');
    await loadDashboardStats();
  } catch (e) {
    console.error('Error guardando asistencia:', e);
    toast('Error al guardar: ' + e.message, 'error');
  }
}

// ─── COMMENTS ─────────────────────────────────────
function clearComments() {
  ['temas','observaciones','incidencias'].forEach(f => {
    document.getElementById('txt-' + f).value = '';
  });
}

async function saveComments() {
  if (!claseActual || !profesorActual) return;
  const temas = document.getElementById('txt-temas').value.trim();
  const obs = document.getElementById('txt-observaciones').value.trim();
  const inc = document.getElementById('txt-incidencias').value.trim();
  if (!temas && !obs && !inc) { toast('Por favor escribe al menos un comentario', 'error'); return; }
  try {
    await db.collection('comentarios_clases').add({
      claseId: claseActual.id,
      claseNombre: claseActual.nombre || '',
      profesorId: profesorActual.id,
      profesorNombre: profesorActual.nombre,
      fecha: getHoy(),
      temas,
      observaciones: obs,
      incidencias: inc,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
    toast('Comentarios guardados correctamente', 'success');
    clearComments();
    await loadCommentHistory(claseActual.id);
  } catch (e) {
    console.error('Error guardando comentarios:', e);
    toast('Error al guardar: ' + e.message, 'error');
  }
}

async function loadCommentHistory(claseId) {
  const cont = document.getElementById('comments-history');
  cont.innerHTML = '<div class="student-empty"><i class="fas fa-circle-notch spin"></i></div>';
  try {
    const snap = await db.collection('comentarios_clases')
      .where('claseId', '==', claseId)
      .orderBy('timestamp', 'desc')
      .limit(10)
      .get();
    if (snap.empty) {
      cont.innerHTML = '<div class="student-empty">No hay comentarios anteriores</div>';
      return;
    }
    cont.innerHTML = '';
    snap.forEach(doc => {
      const d = doc.data();
      const fecha = esc(d.fecha || (d.timestamp ? d.timestamp.toDate().toLocaleDateString('es-MX') : '—'));
      cont.innerHTML += `
        <div class="history-item">
          <div class="history-date"><i class="fas fa-calendar-check"></i> ${fecha} · ${esc(d.profesorNombre)}</div>
          ${d.temas ? `<div class="history-field"><div class="history-field-lbl">Temas</div><div class="history-field-val">${esc(d.temas)}</div></div>` : ''}
          ${d.observaciones ? `<div class="history-field"><div class="history-field-lbl">Observaciones</div><div class="history-field-val">${esc(d.observaciones)}</div></div>` : ''}
          ${d.incidencias ? `<div class="history-field"><div class="history-field-lbl">Incidencias</div><div class="history-field-val">${esc(d.incidencias)}</div></div>` : ''}
        </div>`;
    });
  } catch (e) {
    // Possibly missing index - show message
    cont.innerHTML = '<div class="student-empty">Historial no disponible (puede requerir índice en Firebase)</div>';
  }
}

// ─── QR SCANNER ───────────────────────────────────
function openScanner() {
  document.getElementById('qr-overlay').classList.add('open');
  document.getElementById('qr-result').style.display = 'none';
  try {
    qrScanner = new Html5Qrcode('qr-reader');
    const config = { fps: 10, qrbox: { width: 250, height: 250 } };
    qrScanner.start({ facingMode: 'environment' }, config, onQrSuccess, (err) => {}).catch(e => {
      toast('No se pudo acceder a la cámara: ' + e.message, 'error');
    });
  } catch (e) {
    toast('Error iniciando escáner: ' + e.message, 'error');
  }
}

function closeScanner() {
  if (qrScanner) {
    qrScanner.stop().then(() => { qrScanner = null; }).catch(() => {});
  }
  document.getElementById('qr-overlay').classList.remove('open');
  document.getElementById('qr-reader').innerHTML = '';
}

function onQrSuccess(decodedText) {
  // Try to extract alumnoId from QR
  let alumnoId = decodedText.trim();
  // Support JSON QR codes: { alumnoId: "..." }
  try {
    const parsed = JSON.parse(decodedText);
    if (parsed.alumnoId) alumnoId = parsed.alumnoId;
    else if (parsed.id) alumnoId = parsed.id;
  } catch (_) {}

  const alumno = alumnosActuales.find(a => (a.alumnoId || a.id) === alumnoId);
  const resultEl = document.getElementById('qr-result');
  resultEl.style.display = 'block';

  if (!alumno) {
    resultEl.className = 'qr-result err';
    resultEl.innerHTML = '<i class="fas fa-times-circle"></i> Alumno no encontrado en esta clase';
    return;
  }

  const id = alumno.alumnoId || alumno.id;
  asistenciaMap[id] = 'presente';

  const row = document.getElementById('row-' + id);
  if (row) {
    row.querySelectorAll('.badge').forEach(b => b.classList.remove('active'));
    const presEl = row.querySelector('.badge-presente');
    if (presEl) presEl.classList.add('active');
  }

  updateCounters();

  resultEl.className = 'qr-result ok';
  resultEl.innerHTML = `<i class="fas fa-check-circle"></i> ✅ ${esc(alumno.alumnoNombre) || esc(alumnoId)} — Presente`;

  setTimeout(() => closeScanner(), 1500);
}

// ─── VIEWS ───────────────────────────────────────
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  if (name === 'dashboard') {
    document.getElementById('topbar-title').textContent = 'Dashboard';
    document.querySelectorAll('.sb-class-item').forEach(el => el.classList.remove('active'));
  }
}

// ─── SIDEBAR TOGGLE ───────────────────────────────
function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('sidebar-overlay');
  sb.classList.toggle('open');
  ov.classList.toggle('open');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');
}

// ─── INIT ────────────────────────────────────────
loadProfesores();
