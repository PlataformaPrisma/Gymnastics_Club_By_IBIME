/**
 * sync.js — Módulo central de sincronización entre portales
 *
 * Centraliza la lógica compartida de pagos, reservas y cupos para los portales
 * de alumno (alumno.js) y recepción (recepcion.js).
 *
 * Requiere: `db` (Firestore) y `firebase` disponibles en el contexto global.
 * Expone: window.SyncModule
 */
(function () {
  'use strict';

  /**
   * Valida que db esté disponible antes de ejecutar operaciones.
   * @throws {Error} Si db no está inicializado.
   */
  function _requireDb() {
    if (typeof db === 'undefined' || !db) {
      throw new Error('Firestore (db) no está disponible. Verifica firebase-init.js.');
    }
  }

  /**
   * Confirma todas las reservas pendientes de un alumno.
   *
   * Estrategia:
   *  1. Busca reservas con `alumnoId` + `folio` exacto en estados 'pre-reserva' y 'pendiente_pago'.
   *  2. Si no encuentra nada (folio de recepción ≠ folio generado por el alumno en plan semanal),
   *     busca solo por `alumnoId` + estado, sin filtro de folio.
   *  3. Actualiza todas las reservas encontradas a estado 'confirmada' y sincroniza su folio al
   *     folio de recepción para mantener consistencia en el historial.
   *
   * @param {string} alumnoId - ID del alumno en Firestore.
   * @param {string} folioRecepcion - Folio generado por recepción al momento del cobro.
   * @returns {Promise<{confirmadas: number, folioAlumno: string|null}>}
   */
  async function confirmarReservasPendientes(alumnoId, folioRecepcion) {
    _requireDb();
    try {
      const col = db.collection('reservas');
      const fechaConfirmacion = new Date().toLocaleDateString('es-MX');

      // --- Intento 1: búsqueda exacta por folio ---
      const [s1, s2] = await Promise.all([
        col.where('alumnoId', '==', alumnoId).where('folio', '==', folioRecepcion).where('estado', '==', 'pre-reserva').get(),
        col.where('alumnoId', '==', alumnoId).where('folio', '==', folioRecepcion).where('estado', '==', 'pendiente_pago').get()
      ]);
      let docs = [...s1.docs, ...s2.docs];

      let folioAlumno = folioRecepcion;

      // --- Intento 2: búsqueda solo por alumnoId si no se encontró nada ---
      if (docs.length === 0) {
        const [s3, s4] = await Promise.all([
          col.where('alumnoId', '==', alumnoId).where('estado', '==', 'pre-reserva').get(),
          col.where('alumnoId', '==', alumnoId).where('estado', '==', 'pendiente_pago').get()
        ]);
        docs = [...s3.docs, ...s4.docs];

        // Registrar el folio original del alumno (para devolverlo al llamador)
        if (docs.length > 0 && docs[0].data().folio) {
          folioAlumno = docs[0].data().folio;
        }
      }

      if (docs.length === 0) {
        return { confirmadas: 0, folioAlumno: null };
      }

      // Confirmar todas las reservas encontradas y alinear su folio al de recepción
      await Promise.all(
        docs.map(d =>
          db.collection('reservas').doc(d.id).update({
            estado: 'confirmada',
            alertaMostrada: false,
            fechaConfirmacion,
            folio: folioRecepcion
          })
        )
      );

      return { confirmadas: docs.length, folioAlumno };
    } catch (e) {
      console.error('[SyncModule] confirmarReservasPendientes error for alumno:', alumnoId, 'folio:', folioRecepcion, e);
      throw e;
    }
  }

  /**
   * Mueve a un alumno de una clase origen a una clase destino.
   *
   * Lee la reserva original para preservar TODOS los campos del plan semanal,
   * luego en un batch atómico:
   *  - Borra la reserva original.
   *  - Crea la nueva reserva en el destino (heredando los campos del plan semanal).
   *  - Actualiza cupoDisponible en origen (+1) y destino (-1).
   *  - Si es planSemanal, recalcula el slotKey con el nuevo claseId/dia/hora.
   *
   * @param {string} reservaId - ID de la reserva a mover.
   * @param {string} origenClaseId - ID de la clase origen.
   * @param {string} destinoClaseId - ID de la clase destino.
   * @param {Object} destinoClaseData - Datos de la clase destino (nombre, area, dia, hora, horaFin, profesor, etc.)
   * @returns {Promise<{ok: boolean, nuevaReservaId: string}>}
   */
  async function moverAlumnoDeClase(reservaId, origenClaseId, destinoClaseId, destinoClaseData) {
    _requireDb();
    try {
      // Leer la reserva original para obtener TODOS sus campos
      const reservaSnap = await db.collection('reservas').doc(reservaId).get();
      if (!reservaSnap.exists) {
        throw new Error('La reserva indicada no existe.');
      }
      const reservaData = reservaSnap.data();

      // Construir la nueva reserva: base = todos los campos del original
      const nuevaReserva = Object.assign({}, reservaData, {
        claseId: destinoClaseId,
        claseNombre: destinoClaseData.nombre || destinoClaseData.claseNombre || '',
        area: destinoClaseData.area || '',
        estado: 'confirmada',
        alertaMostrada: true,
        timestamp: Date.now()
      });

      // Sobrescribir campos de horario si el destino los provee
      if (destinoClaseData.dia)     nuevaReserva.dia     = destinoClaseData.dia;
      if (destinoClaseData.hora)    nuevaReserva.hora    = destinoClaseData.hora;
      if (destinoClaseData.horaFin) nuevaReserva.horaFin = destinoClaseData.horaFin;
      if (destinoClaseData.profesor) nuevaReserva.profesor = destinoClaseData.profesor;

      // Si es plan semanal, recalcular el slotKey con los nuevos datos
      if (reservaData.planSemanal && reservaData.alumnoId) {
        const dia   = nuevaReserva.dia  || reservaData.dia  || '';
        const hora  = nuevaReserva.hora || reservaData.hora || '';
        nuevaReserva.slotKey = reservaData.alumnoId + '_' + destinoClaseId + '_' + dia + '_' + hora;
      }

      const batch = db.batch();

      // Liberar cupo en origen
      batch.update(db.collection('catalogo').doc(origenClaseId), {
        cupoDisponible: firebase.firestore.FieldValue.increment(1)
      });

      // Borrar reserva original
      batch.delete(db.collection('reservas').doc(reservaId));

      // Crear nueva reserva en destino
      const nuevaRef = db.collection('reservas').doc();
      batch.set(nuevaRef, nuevaReserva);

      // Decrementar cupo en destino
      batch.update(db.collection('catalogo').doc(destinoClaseId), {
        cupoDisponible: firebase.firestore.FieldValue.increment(-1)
      });

      await batch.commit();

      return { ok: true, nuevaReservaId: nuevaRef.id };
    } catch (e) {
      console.error('[SyncModule] moverAlumnoDeClase error moving reservation:', reservaId, 'from:', origenClaseId, 'to:', destinoClaseId, e);
      throw e;
    }
  }

  /**
   * Quita a un alumno de una clase.
   *
   * - `eliminarTodoElPlan: false` (default): borra solo la reserva indicada y libera 1 cupo.
   * - `eliminarTodoElPlan: true`: lee el slotKey de la reserva, busca TODAS las reservas
   *   con ese slotKey del mismo alumno, las borra en batch y libera N cupos.
   *
   * @param {string} reservaId - ID de la reserva a eliminar.
   * @param {string} claseId - ID de la clase de la que se quita al alumno.
   * @param {{ eliminarTodoElPlan?: boolean }} [opciones={}]
   * @returns {Promise<{eliminadas: number}>}
   */
  async function quitarAlumnoDeClase(reservaId, claseId, opciones) {
    _requireDb();
    opciones = opciones || {};
    try {
      if (opciones.eliminarTodoElPlan) {
        // Leer la reserva para obtener el slotKey
        const reservaSnap = await db.collection('reservas').doc(reservaId).get();
        if (!reservaSnap.exists) {
          throw new Error('La reserva indicada no existe.');
        }
        const reservaData = reservaSnap.data();
        const sk = reservaData.slotKey;
        const alumnoId = reservaData.alumnoId;

        if (!sk || !alumnoId) {
          // No hay slotKey — degradar a eliminación individual
          await db.collection('catalogo').doc(claseId).update({
            cupoDisponible: firebase.firestore.FieldValue.increment(1)
          });
          await db.collection('reservas').doc(reservaId).delete();
          return { eliminadas: 1 };
        }

        // Buscar todas las reservas del mismo slotKey
        const snapSlot = await db.collection('reservas')
          .where('alumnoId', '==', alumnoId)
          .where('slotKey', '==', sk)
          .get();

        if (snapSlot.empty) {
          // Fallback: eliminar solo la indicada
          await db.collection('catalogo').doc(claseId).update({
            cupoDisponible: firebase.firestore.FieldValue.increment(1)
          });
          await db.collection('reservas').doc(reservaId).delete();
          return { eliminadas: 1 };
        }

        const n = snapSlot.size;
        const batch = db.batch();

        // Borrar todas las reservas del slot
        snapSlot.docs.forEach(d => batch.delete(d.ref));

        // Restaurar cupos agrupando por claseId, ya que un plan semanal puede
        // tener sesiones en múltiples clases distintas.
        const cuposPorClase = {};
        snapSlot.docs.forEach(d => {
          const cid = d.data().claseId;
          cuposPorClase[cid] = (cuposPorClase[cid] || 0) + 1;
        });
        Object.entries(cuposPorClase).forEach(([cid, count]) => {
          batch.update(db.collection('catalogo').doc(cid), {
            cupoDisponible: firebase.firestore.FieldValue.increment(count)
          });
        });

        await batch.commit();
        return { eliminadas: n };
      } else {
        // Modo individual: eliminar solo la reserva indicada
        await db.collection('catalogo').doc(claseId).update({
          cupoDisponible: firebase.firestore.FieldValue.increment(1)
        });
        await db.collection('reservas').doc(reservaId).delete();
        return { eliminadas: 1 };
      }
    } catch (e) {
      console.error('[SyncModule] quitarAlumnoDeClase error for reservation:', reservaId, 'class:', claseId, e);
      throw e;
    }
  }

  /**
   * Recalcula el cupoDisponible de una clase a partir de las reservas confirmadas reales.
   * Útil para corrección de cupos desincronizados.
   *
   * @param {string} claseId - ID de la clase en la colección `catalogo`.
   * @returns {Promise<{cupoAntes: number, cupoAhora: number}>}
   */
  async function sincronizarCupo(claseId) {
    _requireDb();
    try {
      const [claseSnap, reservasSnap] = await Promise.all([
        db.collection('catalogo').doc(claseId).get(),
        db.collection('reservas').where('claseId', '==', claseId).where('estado', '==', 'confirmada').get()
      ]);

      if (!claseSnap.exists) {
        throw new Error('Clase no encontrada: ' + claseId);
      }

      const claseData = claseSnap.data();
      const cupoTotal  = claseData.cupo ?? 0;
      const cupoAntes  = claseData.cupoDisponible ?? cupoTotal;
      const confirmadas = reservasSnap.size;
      const cupoAhora  = Math.max(0, cupoTotal - confirmadas);

      await db.collection('catalogo').doc(claseId).update({ cupoDisponible: cupoAhora });

      return { cupoAntes, cupoAhora };
    } catch (e) {
      console.error('[SyncModule] sincronizarCupo error for class:', claseId, e);
      throw e;
    }
  }

  // ── Exponer como módulo global ──────────────────────────────────
  window.SyncModule = {
    confirmarReservasPendientes,
    moverAlumnoDeClase,
    quitarAlumnoDeClase,
    sincronizarCupo
  };
})();
