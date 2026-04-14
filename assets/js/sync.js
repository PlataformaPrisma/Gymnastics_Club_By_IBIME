// ════════════════════════════════════════════════════════════════
// SYNC MODULE — Sincronización entre portales
// ════════════════════════════════════════════════════════════════

const SyncModule = {
  
  /**
   * Descontar una clase cuando el alumno asiste
   * Se ejecuta cuando: profesor marca presente, o clase termina sin falta
   */
  async descontarClaseAlumno(reservaId, alumnoId) {
    try {
      const reservaRef = db.collection('reservas').doc(reservaId);
      const reservaSnap = await reservaRef.get();
      
      if (!reservaSnap.exists) {
        console.error('Reserva no encontrada:', reservaId);
        return false;
      }
      
      const reservaData = reservaSnap.data();
      const pasesActuales = reservaData.pasesRestantes || 0;
      
      // Solo descontar si hay pases disponibles
      if (pasesActuales > 0) {
        // 1. Descontar pase en la reserva específica
        await reservaRef.update({
          pasesRestantes: firebase.firestore.FieldValue.increment(-1),
          ultimoDesconteFecha: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        // 2. Descontar del total de clases del alumno
        const alumnoRef = db.collection('alumnos').doc(alumnoId);
        const alumnoSnap = await alumnoRef.get();
        
        if (alumnoSnap.exists) {
          const alumnoData = alumnoSnap.data();
          const clasesRestantes = alumnoData.clasesRestantes || 0;
          
          if (clasesRestantes > 0) {
            await alumnoRef.update({
              clasesRestantes: firebase.firestore.FieldValue.increment(-1),
              ultimoDesconteFecha: firebase.firestore.FieldValue.serverTimestamp()
            });
          }
        }
        
        console.log(`✅ Clase descontada para ${alumnoId}. Pases restantes: ${pasesActuales - 1}`);
        return true;
      }
      
      console.warn('No hay pases restantes para descontar');
      return false;
    } catch (e) {
      console.error('Error al descontar clase:', e);
      return false;
    }
  },
  
  /**
   * Marcar asistencia y descontar automáticamente
   * Se ejecuta desde el portal de profesores
   */
  async marcarAsistenciaYDescontar(claseId, alumnoId, tipo = 'presente') {
    try {
      // 1. Registrar en colección asistencias
      const hoy = new Date();
      const fechaStr = hoy.toISOString().split('T')[0];
      const asistenciaRef = db.collection('asistencias').doc(`${alumnoId}_${claseId}_${fechaStr}`);
      
      const asistenciaData = {
        alumnoId,
        claseId,
        fecha: firebase.firestore.Timestamp.fromDate(hoy),
        fechaStr,
        tipo, // 'presente', 'ausente', 'tarde', 'justificado'
        registradoPor: 'profesor',
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      };
      
      await asistenciaRef.set(asistenciaData, { merge: true });
      
      // 2. Buscar la reserva del alumno para esta clase
      const reservasSnap = await db.collection('reservas')
        .where('alumnoId', '==', alumnoId)
        .where('claseId', '==', claseId)
        .where('estado', '==', 'confirmada')
        .limit(1)
        .get();
      
      if (!reservasSnap.empty) {
        const reservaDoc = reservasSnap.docs[0];
        const reservaRef = reservaDoc.ref;
        
        // 3. Actualizar reserva con tipo de asistencia
        const updateData = {
          [tipo]: true, // 'presente': true, 'ausente': true, etc.
          asistenciaRegistrada: true,
          asistenciaFecha: firebase.firestore.Timestamp.fromDate(hoy)
        };
        
        await reservaRef.update(updateData);
        
        // 4. Descontar clase (siempre, incluso si es ausente/tarde)
        await this.descontarClaseAlumno(reservaDoc.id, alumnoId);
        
        console.log(`✅ Asistencia marcada (${tipo}) para ${alumnoId}`);
        return { success: true, reservaId: reservaDoc.id };
      } else {
        console.warn('No se encontró reserva confirmada para este alumno en esta clase');
        return { success: false, error: 'Sin reserva confirmada' };
      }
    } catch (e) {
      console.error('Error al marcar asistencia:', e);
      return { success: false, error: e.message };
    }
  },
  
  /**
   * Descontar clase automáticamente cuando termina sin ser marcada
   * Se ejecuta cada cierto tiempo o al terminar la clase
   */
  async descontarClasesTerminadas() {
    try {
      const ahora = new Date();
      
      // Buscar reservas confirmadas donde la hora de fin ya pasó
      const reservasSnap = await db.collection('reservas')
        .where('estado', '==', 'confirmada')
        .where('endAt', '<=', firebase.firestore.Timestamp.fromDate(ahora))
        .get();
      
      let descuentosRealizados = 0;
      
      for (const doc of reservasSnap.docs) {
        const reserva = doc.data();
        
        // Solo descontar si NO tiene asistencia registrada aún
        if (!reserva.asistencia && !reserva.ausencia && !reserva.falta) {
          // Marcar como falta automática
          await db.collection('reservas').doc(doc.id).update({
            falta: true,
            automatico: true,
            faltaRegistradaAutomaticamente: firebase.firestore.FieldValue.serverTimestamp()
          });
          
          // Descontar clase
          await this.descontarClaseAlumno(doc.id, reserva.alumnoId);
          descuentosRealizados++;
        }
      }
      
      if (descuentosRealizados > 0) {
        console.log(`✅ Se descontaron ${descuentosRealizados} clases por cierre automático`);
      }
      
    } catch (e) {
      console.error('Error al descontar clases terminadas:', e);
    }
  },
  
  /**
   * Quitar alumno de una clase (cancelar reserva)
   * Restaura los pases
   */
  async quitarAlumnoDeClase(reservaId, claseId) {
    try {
      const reservaRef = db.collection('reservas').doc(reservaId);
      const reservaSnap = await reservaRef.get();
      
      if (!reservaSnap.exists) {
        throw new Error('Reserva no encontrada');
      }
      
      const reservaData = reservaSnap.data();
      const alumnoId = reservaData.alumnoId;
      const pasesRestantes = reservaData.pasesRestantes || 0;
      const pasesTotal = reservaData.pasesTotal || 1;
      
      // 1. Marcar como cancelada
      await reservaRef.update({
        estado: 'cancelada',
        canceladaEn: firebase.firestore.FieldValue.serverTimestamp()
      });
      
      // 2. Restaurar pases al alumno (si no fueron usados)
      if (pasesRestantes > 0) {
        await db.collection('alumnos').doc(alumnoId).update({
          clasesRestantes: firebase.firestore.FieldValue.increment(pasesRestantes),
          ultimaCancelacionFecha: firebase.firestore.FieldValue.serverTimestamp()
        });
      }
      
      // 3. Restaurar cupo a la clase
      await db.collection('catalogo').doc(claseId).update({
        cupoDisponible: firebase.firestore.FieldValue.increment(1)
      }).catch(() => {
        // Si la clase no existe, simplemente continuar
      });
      
      console.log(`✅ Alumno quitado de clase. Pases restaurados: ${pasesRestantes}`);
      return { success: true, pasesRestaurados: pasesRestantes };
      
    } catch (e) {
      console.error('Error al quitar alumno de clase:', e);
      throw e;
    }
  },
  
  /**
   * Obtener estado de pases de un alumno
   */
  async obtenerPasesAlumno(alumnoId) {
    try {
      const alumnoSnap = await db.collection('alumnos').doc(alumnoId).get();
      
      if (!alumnoSnap.exists) {
        return null;
      }
      
      const datos = alumnoSnap.data();
      return {
        clasesRestantes: datos.clasesRestantes || 0,
        clasesPaquete: datos.clasesPaquete || 0,
        porciento: (datos.clasesRestantes / (datos.clasesPaquete || 1)) * 100
      };
    } catch (e) {
      console.error('Error al obtener pases:', e);
      return null;
    }
  },
  
  /**
   * Inicializar sincronización periódica (ejecutar cada X minutos)
   */
  iniciarSincronizacion(intervaloMinutos = 5) {
    console.log(`⏲️ Sincronización iniciada cada ${intervaloMinutos} minutos`);
    
    // Ejecutar inmediatamente
    this.descontarClasesTerminadas();
    
    // Repetir periódicamente
    setInterval(() => {
      this.descontarClasesTerminadas();
    }, intervaloMinutos * 60 * 1000);
  },
  
  /**
   * Actualizar estado de reserva después de pago
   */
  async confirmarReservasPorPago(folio) {
    try {
      const reservasSnap = await db.collection('reservas')
        .where('folio', '==', folio)
        .where('estado', '==', 'pendiente_pago')
        .get();
      
      let confirmadas = 0;
      
      for (const doc of reservasSnap.docs) {
        await doc.ref.update({
          estado: 'confirmada',
          confirmadaEn: firebase.firestore.FieldValue.serverTimestamp()
        });
        confirmadas++;
      }
      
      console.log(`✅ ${confirmadas} reservas confirmadas por pago`);
      return confirmadas;
      
    } catch (e) {
      console.error('Error al confirmar reservas:', e);
      return 0;
    }
  }
};

// Iniciar sincronización cuando la app carga
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    // Solo iniciar si estamos en el portal de recepción o profesores
    if (document.getElementById('view-caja') || document.getElementById('view-dashboard')) {
      SyncModule.iniciarSincronizacion(5); // Cada 5 minutos
    }
  });
} else {
  // Si el DOM ya cargó
  if (document.getElementById('view-caja') || document.getElementById('view-dashboard')) {
    SyncModule.iniciarSincronizacion(5);
  }
}
