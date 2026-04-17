// ════════════════════════════════════════════════════════════════
// AUDIT MODULE — Registrar todas las acciones importantes
// Para 1000+ usuarios sin afectar performance
// ════════════════════════════════════════════════════════════════

const AuditModule = {
  
  /**
   * Registrar acciones sin bloquear el flujo
   * Usa batch writes para no saturar base de datos
   */
  async registrarAccion(tipo, datos) {
    try {
      // No esperar a que termine (fire and forget)
      // Así no ralentiza la app
      db.collection('auditoria_log').add({
        accion: tipo,
        ...datos,
        timestamp: firebase.firestore.FieldValue.serverTimestamp(),
        // Metadatos útiles
        navegador: navigator.userAgent.substring(0, 100),
        ip: 'obtener_del_backend' // Backend debe hacerlo
      }).catch(e => console.warn('Audit error:', e));
      
    } catch (e) {
      console.error('Error registrando auditoría:', e);
      // NO interrumpir la operación principal
    }
  },
  
  // ─────────────────────────────────────────────────────────
  // ACCIONES PRINCIPALES A AUDITAR
  // ─────────────────────────────────────────────────────────
  
  async auditAsistenciaMarcada(alumnoId, claseId, tipo, profesorId) {
    await this.registrarAccion('ASISTENCIA_MARCADA', {
      alumnoId,
      claseId,
      tipo, // presente, ausente, tarde, justificado
      profesorId,
      fecha: new Date().toLocaleDateString('es-MX'),
      hora: new Date().toLocaleTimeString('es-MX')
    });
  },
  
  async auditPagoProcesado(alumnoId, folio, monto, detalle, metodo) {
    await this.registrarAccion('PAGO_PROCESADO', {
      alumnoId,
      folio,
      monto,
      detalle,
      metodo, // EFECTIVO, TRANSFERENCIA, TARJETA
      fecha: new Date().toLocaleDateString('es-MX'),
      hora: new Date().toLocaleTimeString('es-MX')
    });
  },
  
  async auditReservaConfirmada(alumnoId, claseId, folio, reservasConfirmadas) {
    await this.registrarAccion('RESERVA_CONFIRMADA', {
      alumnoId,
      claseId,
      folio,
      reservasConfirmadas,
      fecha: new Date().toLocaleDateString('es-MX')
    });
  },
  
  async auditClaseCancelada(alumnoId, claseId, razon) {
    await this.registrarAccion('CLASE_CANCELADA', {
      alumnoId,
      claseId,
      razon, // "solicitud_alumno", "50_horas_cutoff", "manual_admin"
      fecha: new Date().toLocaleDateString('es-MX')
    });
  },
  
  async auditAlumnoApartado(alumnoId, claseId, folio, diasSemana) {
    await this.registrarAccion('CLASE_APARTADA', {
      alumnoId,
      claseId,
      folio,
      diasSemana,
      fecha: new Date().toLocaleDateString('es-MX')
    });
  },
  
  async auditLoginAlumno(alumnoId, metodo) {
    await this.registrarAccion('LOGIN_ALUMNO', {
      alumnoId,
      metodo, // "curp_password", "google", "apple"
      fecha: new Date().toLocaleDateString('es-MX'),
      hora: new Date().toLocaleTimeString('es-MX')
    });
  },
  
  async auditLoginStaff(userId, rol, tipo) {
    await this.registrarAccion('LOGIN_STAFF', {
      userId,
      rol, // recepcion, profesor, admin
      tipo, // email/password
      fecha: new Date().toLocaleDateString('es-MX'),
      hora: new Date().toLocaleTimeString('es-MX')
    });
  },
  
  async auditMovimientoClase(alumnoId, claseOrigen, claseDestino) {
    await this.registrarAccion('MOVIMIENTO_CLASE', {
      alumnoId,
      claseOrigen,
      claseDestino,
      fecha: new Date().toLocaleDateString('es-MX'),
      hora: new Date().toLocaleTimeString('es-MX')
    });
  },
  
  async auditActualizacionDatos(alumnoId, tipoActualizacion, detalles) {
    await this.registrarAccion('ACTUALIZACION_DATOS', {
      alumnoId,
      tipoActualizacion, // "ficha_medica", "datos_personales", "contraseña"
      detalles,
      fecha: new Date().toLocaleDateString('es-MX')
    });
  },
  
  async auditErrorCritico(tipo, alumnoId, mensaje, stackTrace) {
    await this.registrarAccion('ERROR_CRITICO', {
      tipo,
      alumnoId,
      mensaje,
      stackTrace: stackTrace.substring(0, 500), // Limitar tamaño
      fecha: new Date().toLocaleDateString('es-MX'),
      hora: new Date().toLocaleTimeString('es-MX')
    });
  }
};
