// ════════════════════════════════════════════════════════════════
// CLASE SELECTION MODULE — Interfaz mejorada para seleccionar clases
// ════════════════════════════════════════════════════════════════

const ClaseSelectionModule = {
  
  // Cache para evitar queries constantemente
  clasesCache: [],
  unsubscribeClases: null,
  
  /**
   * ESTRUCTURA:
   * Mostrar CLASES con:
   * - Cupo disponible (en vivo desde RTDB)
   * - Nombre, área, horario
   * - Botón para apartar
   * - Indicador % ocupación
   */
  
  // ─────────────────────────────────────────────────────────
  // 1️⃣ CARGAR TODAS LAS CLASES CON STATS EN VIVO
  // ─────────────────────────────────────────────────────────
  async cargarClasesConEstadisticas(area = 'todo') {
    try {
      // 1. Obtener catálogo de Firestore (cambios menos frecuentes)
      let query = db.collection('catalogo').where('tipo', '==', 'clase');
      
      if (area !== 'todo') {
        query = query.where('area', '==', area);
      }
      
      const snap = await query.get();
      this.clasesCache = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      // 2. Para cada clase, obtener estadísticas de RTDB (en vivo)
      const clasesConStats = await Promise.all(
        this.clasesCache.map(async clase => {
          const statsSnap = await rtdb.ref(`estadisticas/clases/${clase.id}`).get();
          const stats = statsSnap.val() || {
            cupoTotal: clase.cupo || 0,
            cupoDisponible: clase.cupoDisponible || 0,
            inscritos: (clase.cupo || 0) - (clase.cupoDisponible || 0),
            porcentajeOcupacion: 0
          };
          
          return { ...clase, ...stats };
        })
      );
      
      return clasesConStats;
      
    } catch (e) {
      console.error('Error cargando clases:', e);
      return [];
    }
  },
  
  // ─────────────────────────────────────────────────────────
  // 2️⃣ ESCUCHAR CAMBIOS EN VIVO (Cupo, inscripción)
  // ─────────────────────────────────────────────────────────
  escucharActualizacionesClases(contenedor, callback) {
    // Escuchar cambios en estadísticas generales de clases
    rtdb.ref(`estadisticas/clases`).on('value', snap => {
      const stats = snap.val() || {};
      
      // Actualizar UI con los nuevos datos
      if (callback) callback(stats);
    });
  },
  
  detenerEscucha() {
    rtdb.ref(`estadisticas/clases`).off();
    if (this.unsubscribeClases) this.unsubscribeClases();
  },
  
  // ─────────────────────────────────────────────────────────
  // 3️⃣ APARTAR CLASE (Crear Pre-reserva)
  // ─────────────────────────────────────────────────────────
  async apartarClase(alumnoId, claseId, claseNombre) {
    try {
      // 1. Validar que hay cupo
      const statsSnap = await rtdb.ref(`estadisticas/clases/${claseId}`).get();
      const stats = statsSnap.val();
      
      if (!stats || stats.cupoDisponible <= 0) {
        throw new Error('❌ Sin cupo disponible en esta clase');
      }
      
      // 2. Crear pre-reserva
      const alumnoSnap = await db.collection('alumnos').doc(alumnoId).get();
      const alumnoData = alumnoSnap.data();
      
      // Generar folio único para este paquete de clases
      let folio = '';
      await db.runTransaction(async tx => {
        const ref = db.collection('config').doc('contador_pagos');
        const s = await tx.get(ref);
        const num = s.exists ? (s.data().ultimo_numero || 0) + 1 : 1;
        folio = 'IBY-' + String(num).padStart(8, '0');
        tx.set(ref, { ultimo_numero: num });
      });
      
      // 3. Crear reserva
      await db.collection('reservas').add({
        alumnoId,
        alumnoNombre: alumnoData.nombre,
        claseId,
        claseNombre,
        area: stats.area || '',
        folio,
        estado: 'pre-reserva', // Espera pago
        dia: stats.dia || '',
        hora: stats.inicio || '',
        horaFin: stats.fin || '',
        profesor: stats.profesor || '',
        pasesTotal: 1,
        pasesRestantes: 1,
        alertaMostrada: false,
        creada: firebase.firestore.FieldValue.serverTimestamp()
      });
      
      // 4. Notificar
      await rtdb.ref(`notificaciones/${alumnoId}`).push({
        tipo: 'clase_apartada',
        mensaje: `✨ ${claseNombre} apartada. Folio: ${folio}`,
        claseId,
        claseNombre,
        folio,
        timestamp: firebase.database.ServerValue.TIMESTAMP
      });
      
      return { success: true, folio };
      
    } catch (e) {
      console.error('Error apartando clase:', e);
      throw e;
    }
  },
  
  // ─────────────────────────────────────────────────────────
  // 4️⃣ CANCELAR APARTADO (Antes de pagar)
  // ─────────────────────────────────────────────────────────
  async cancelarApartado(reservaId, claseId) {
    try {
      // Marcar como cancelada
      await db.collection('reservas').doc(reservaId).update({
        estado: 'cancelada',
        canceladaEn: firebase.firestore.FieldValue.serverTimestamp()
      });
      
      return { success: true };
      
    } catch (e) {
      console.error('Error cancelando apartado:', e);
      throw e;
    }
  }
};
