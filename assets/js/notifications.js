// ════════════════════════════════════════════════════════════════
// NOTIFICATIONS MODULE — Sincronización RTDB + Firestore
// Para +1000 usuarios con actualización en tiempo real
// ══════��═════════════════════════════════════════════════════════

const NotificationsModule = {
  
  /**
   * ESTRUCTURA RTDB (Actualización Real-time)
   * /eventos/{alumnoId}/pagos → Notificación pago
   * /eventos/{alumnoId}/clases → Cambios en clases
   * /eventos/{alumnoId}/descuentos → Descuento de pase
   * /estadisticas/clases/{claseId} → Cupo/inscripción en vivo
   * /estadisticas/general → Totales del día
   */
  
  // ─────────────────────────────────────────────────────────
  // 1️⃣ PAGO CONFIRMADO → Sincronizar Reservas + Notificación
  // ─────────────────────────────────────────────────────────
 async registrarPagoProcesado(alumnoId, folio, monto, detalle, metodo = 'EFECTIVO') {
    try {
      const ahora = new Date();
      const fechaStr = ahora.toLocaleDateString('es-MX');
      
      // 0. AUDITORÍA
      if (typeof AuditModule !== 'undefined') {
        AuditModule.auditPagoProcesado(alumnoId, folio, monto, detalle, metodo);
      }
      
      // 1. Crear evento en RTDB
      const eventoRef = rtdb.ref(`eventos/${alumnoId}/pagos/${folio}`);
      await eventoRef.set({
        folio,
        monto,
        detalle,
        estado: 'confirmado',
        fecha: fechaStr,
        hora: ahora.toLocaleTimeString('es-MX'),
        timestamp: firebase.database.ServerValue.TIMESTAMP
      });
      
      // 2. Guardar en Firestore para historial (Permanente)
      await db.collection('historial_pagos').add({
        alumnoId,
        folio,
        monto,
        detalle,
        estado: 'confirmado',
        fecha: fechaStr,
        hora: ahora.toLocaleTimeString('es-MX'),
        registradoEn: firebase.firestore.FieldValue.serverTimestamp()
      });
      
      // 3. Confirmar todas las reservas con este folio
      const reservasSnap = await db.collection('reservas')
        .where('folio', '==', folio)
        .where('estado', '==', 'pre-reserva')
        .get();
      
      let confirmadas = 0;
      const batch = db.batch();
      
      for (const doc of reservasSnap.docs) {
        batch.update(doc.ref, {
          estado: 'confirmada',
          confirmadaEn: firebase.firestore.FieldValue.serverTimestamp()
        });
        confirmadas++;
        
        // Actualizar estadística en RTDB
        const claseId = doc.data().claseId;
        await this.actualizarEstadisticaClase(claseId);
      }
      
      await batch.commit();
      
      // 4. Notificar al alumno
      await rtdb.ref(`notificaciones/${alumnoId}`).push({
        tipo: 'pago_confirmado',
        mensaje: `✅ Pago de $${monto} confirmado. ${confirmadas} clase(s) asegurada(s)`,
        folio,
        clases_confirmadas: confirmadas,
        timestamp: firebase.database.ServerValue.TIMESTAMP
      });
      
      console.log(`✅ Pago ${folio} procesado para ${alumnoId}`);
      return { success: true, confirmadas };
      
    } catch (e) {
      console.error('Error registrando pago:', e);
      throw e;
    }
  },
  
  // ─────────────────────────────────────────────────────────
  // 2️⃣ ASISTENCIA MARCADA → Descontar + Notificación
  // ─────────────────────────────────────────────────────────
 async registrarAsistenciaMarcada(claseId, alumnoId, tipo, profesorId) {
    try {
      const ahora = new Date();
      const fechaStr = ahora.toISOString().split('T')[0];
      
      // 0. AUDITORÍA
      if (typeof AuditModule !== 'undefined') {
        AuditModule.auditAsistenciaMarcada(alumnoId, claseId, tipo, profesorId);
      }
      
      // 1. Marcar asistencia en Firestore
      await db.collection('asistencias').add({
        claseId,
        alumnoId,
        fecha: fechaStr,
        hora: ahora.toLocaleTimeString('es-MX'),
        tipo, // presente, ausente, tarde, justificado
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });
      
      // 2. Buscar y actualizar reserva
      const reservasSnap = await db.collection('reservas')
        .where('alumnoId', '==', alumnoId)
        .where('claseId', '==', claseId)
        .where('estado', '==', 'confirmada')
        .limit(1)
        .get();
      
      if (!reservasSnap.empty) {
        const reservaDoc = reservasSnap.docs[0];
        const reservaData = reservaDoc.data();
        
        // 3. Descontar pase
        const pasesRestantes = (reservaData.pasesRestantes || 1) - 1;
        
        await db.collection('reservas').doc(reservaDoc.id).update({
          pasesRestantes,
          asistencia: true,
          asistenciaFecha: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        // 4. Descontar del alumno
        const alumnoRef = db.collection('alumnos').doc(alumnoId);
        const alumnoSnap = await alumnoRef.get();
        
        if (alumnoSnap.exists) {
          const clasesRestantes = (alumnoSnap.data().clasesRestantes || 0) - 1;
          await alumnoRef.update({
            clasesRestantes,
            ultimoDesconteFecha: firebase.firestore.FieldValue.serverTimestamp()
          });
          
          // 5. Guardar descuento en RTDB
          const claseNombre = reservaData.claseNombre || 'Clase';
          await rtdb.ref(`eventos/${alumnoId}/descuentos/${claseId}_${fechaStr}`).set({
            claseId,
            claseNombre,
            tipo,
            pasesRestantes,
            clasesRestantes,
            fecha: fechaStr,
            timestamp: firebase.database.ServerValue.TIMESTAMP
          });
          
          // 6. Notificar al alumno
          await rtdb.ref(`notificaciones/${alumnoId}`).push({
            tipo: 'descuento_clase',
            mensaje: `📍 Asistencia registrada en ${claseNombre}. Pases restantes: ${pasesRestantes}`,
            claseId,
            claseNombre,
            pasesRestantes,
            timestamp: firebase.database.ServerValue.TIMESTAMP
          });
          
          // 7. Actualizar estadísticas
          await this.actualizarEstadisticaClase(claseId);
          await this.actualizarEstadisticasGenerales();
        }
      }
      
      console.log(`✅ Asistencia registrada: ${alumnoId} en ${claseId}`);
      return { success: true };
      
    } catch (e) {
      console.error('Error registrando asistencia:', e);
      throw e;
    }
  },
  
  // ─────────────────────────────────────────────────────────
  // 3️⃣ ACTUALIZAR ESTADÍSTICA DE CLASE (Cupo en vivo)
  // ─────────────────────────────────────────────────────────
  async actualizarEstadisticaClase(claseId) {
    try {
      const claseSnap = await db.collection('catalogo').doc(claseId).get();
      if (!claseSnap.exists) return;
      
      const claseData = claseSnap.data();
      const cupoTotal = claseData.cupo || 0;
      const cupoDisp = claseData.cupoDisponible || 0;
      const inscritos = cupoTotal - cupoDisp;
      const pct = cupoTotal > 0 ? Math.round((inscritos / cupoTotal) * 100) : 0;
      
      // Guardar en RTDB para actualización en vivo
      await rtdb.ref(`estadisticas/clases/${claseId}`).set({
        nombre: claseData.nombre || '',
        area: claseData.area || '',
        profesor: claseData.profesor || '',
        cupoTotal,
        cupoDisponible: cupoDisp,
        inscritos,
        porcentajeOcupacion: pct,
        dia: claseData.dia || '',
        inicio: claseData.inicio || '',
        fin: claseData.fin || '',
        ultimaActualizacion: firebase.database.ServerValue.TIMESTAMP
      });
      
    } catch (e) {
      console.error('Error actualizando estadística de clase:', e);
    }
  },
  
  // ─────────────────────────────────────────────────────────
  // 4️⃣ ACTUALIZAR ESTADÍSTICAS GENERALES
  // ─────────────────────────────────────────────────────────
  async actualizarEstadisticasGenerales() {
    try {
      const hoyStr = new Date().toLocaleDateString('es-MX');
      
      // Contar pagos de hoy
      const pagosSnap = await db.collection('pagos')
        .where('fechaString', '==', hoyStr)
        .get();
      
      let ingresoHoy = 0;
      pagosSnap.forEach(doc => {
        ingresoHoy += (doc.data().monto || 0);
      });
      
      // Contar asistencias de hoy
      const asistSnap = await db.collection('asistencias')
        .where('fecha', '==', hoyStr)
        .get();
      
      // Guardar en RTDB
      await rtdb.ref(`estadisticas/general`).set({
        fecha: hoyStr,
        ingresoDelDia: ingresoHoy,
        cobrosDelDia: pagosSnap.size,
        asistenciasRegistradas: asistSnap.size,
        ultimaActualizacion: firebase.database.ServerValue.TIMESTAMP
      });
      
    } catch (e) {
      console.error('Error actualizando estadísticas generales:', e);
    }
  },
  
  // ─────────────────────────────────────────────────────────
  // 5️⃣ ESCUCHAR CAMBIOS EN CLASES (Para Recepción/Alumno)
  // ─────────────────────────────────────────────────────────
  escucharCambiosClase(claseId, callback) {
    return rtdb.ref(`estadisticas/clases/${claseId}`).on('value', snap => {
      const datos = snap.val();
      if (datos) callback(datos);
    });
  },
  
  detenerEscuchaClase(claseId) {
    rtdb.ref(`estadisticas/clases/${claseId}`).off();
  },
  
  // ─────────────────────────────────────────────────────────
  // 6️⃣ ESCUCHAR NOTIFICACIONES DEL ALUMNO
  // ─────────────────────────────────────────────────────────
  escucharNotificacionesAlumno(alumnoId, callback) {
    return rtdb.ref(`notificaciones/${alumnoId}`).limitToLast(10).on('child_added', snap => {
      const notif = snap.val();
      if (notif) callback({ id: snap.key, ...notif });
    });
  },
  
  detenerEscuchaNotificaciones(alumnoId) {
    rtdb.ref(`notificaciones/${alumnoId}`).off();
  },
  
  // ─────────────────────────────────────────────────────────
  // 7️⃣ LIMPIAR NOTIFICACIONES ANTIGUAS (Cada 24h)
  // ─────────────────────────────────────────────────────────
  async limpiarNotificacionesAntiguas(alumnoId, diasRetener = 7) {
    try {
      const ahora = Date.now();
      const limiteMs = 1000 * 60 * 60 * 24 * diasRetener;
      
      const notifRef = rtdb.ref(`notificaciones/${alumnoId}`);
      const snap = await notifRef.get();
      
      if (snap.exists()) {
        const updates = {};
        snap.forEach(child => {
          if ((ahora - (child.val().timestamp || 0)) > limiteMs) {
            updates[child.key] = null; // Marcar para eliminar
          }
        });
        
        if (Object.keys(updates).length > 0) {
          await notifRef.update(updates);
          console.log(`🧹 Notificaciones antiguas limpiadas para ${alumnoId}`);
        }
      }
    } catch (e) {
      console.error('Error limpiando notificaciones:', e);
    }
  },
  
  // ─────────────────────────────────────────────────────────
  // 8️⃣ INICIALIZAR SINCRONIZACIÓN (Llamar al cargar app)
  // ─────────────────────────────────────────────────────────
  iniciarSincronizacion() {
    console.log('⏲️ Módulo de notificaciones iniciado');
    
    // Limpiar notificaciones antiguas cada 24h
    setInterval(() => {
      if (typeof USER !== 'undefined' && USER.id) {
        this.limpiarNotificacionesAntiguas(USER.id);
      }
    }, 24 * 60 * 60 * 1000);
  }
};

// Iniciar cuando la app carga
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    NotificationsModule.iniciarSincronizacion();
  });
} else {
  NotificationsModule.iniciarSincronizacion();
}
