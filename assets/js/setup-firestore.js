// ════════════════════════════════════════════════════════════════
// SETUP FIRESTORE + RTDB — Crear estructura correcta
// ════════════════════════════════════════════════════════════════

const SetupModule = {
  
  // ✅ Obtener referencias EN CADA MÉTODO
  getDb() {
    return firebase.firestore();
  },
  
  getRtdb() {
    return firebase.database();
  },

const SetupModule = {
  
  // ─────────────────────────────────────────────────────────
  // 1️⃣ ELIMINAR COLECCIONES INCORRECTAS
  // ─────────────────────────────────────────────────────────
  async eliminarColecciones() {
    console.log('🗑️ Eliminando colecciones innecesarias...');
    
    const coleccionesAEliminar = [
      'temp_data',
      'test_collection',
      'backup_reservas_old',
    ];
    
    for (const coleccion of coleccionesAEliminar) {
      try {
        const snap = await db.collection(coleccion).get();
        console.log(`  Buscando "${coleccion}"... encontrados: ${snap.size}`);
        
        const batch = db.batch();
        snap.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        
        console.log(`  �� "${coleccion}" eliminada (${snap.size} documentos)`);
      } catch (e) {
        console.log(`  ℹ️ "${coleccion}" no existe (normal)`);
      }
    }
  },
  
  // ─────────────────────────────────────────────────────────
  // 2️⃣ CREAR ESTRUCTURA CORRECTA DE COLECCIONES
  // ─────────────────────────────────────────────────────────
  async crearColecciones() {
    console.log('\n📁 Creando colecciones en Firestore...\n');
    
    // ── Colección: config ──────────────────────────────────
    console.log('  📝 Creando config/inscripcion...');
    await db.collection('config').doc('inscripcion').set({
      monto: 800,
      descripcion: 'Costo de inscripción',
      vigente_desde: '2026-04-01',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    console.log('     ✅ config/inscripcion creado\n');
    
    console.log('  📝 Creando config/costos_fitness...');
    await db.collection('config').doc('costos_fitness').set({
      d1: 240, p1: 240,
      d2: 480, p2: 480,
      d3: 720, p3: 720,
      d4: 960, p4: 960,
      d5: 1200, p5: 1200,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    console.log('     ✅ config/costos_fitness creado\n');
    
    console.log('  📝 Creando config/costos_gimnasia...');
    await db.collection('config').doc('costos_gimnasia').set({
      d1: 850, p1: 765,
      d2: 1600, p2: 1440,
      d3: 2200, p3: 1980,
      d4: 2750, p4: 2475,
      d5: 3200, p5: 2880,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    console.log('     ✅ config/costos_gimnasia creado\n');
    
    console.log('  📝 Creando config/contador_alumnos...');
    await db.collection('config').doc('contador_alumnos').set({
      ultimo_numero: 0,
      prefijo: 'IBI-GYM',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    console.log('     ✅ config/contador_alumnos creado\n');
    
    console.log('  📝 Creando config/contador_pagos...');
    await db.collection('config').doc('contador_pagos').set({
      ultimo_numero: 0,
      prefijo: 'IBY-PAG-',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    console.log('     ✅ config/contador_pagos creado\n');
  },
  
  // ─────────────────────────────────────────────────────────
  // 3️⃣ CREAR DOCUMENTO TEMPLATE EN CADA COLECCIÓN
  // ─────────────────────────────────────────────────────────
  async crearTemplates() {
    console.log('\n📦 Creando documentos TEMPLATE...\n');
    
    console.log('  📝 Template: catalogo/TEMPLATE-CLASE-01...');
    await db.collection('catalogo').doc('TEMPLATE-CLASE-01').set({
      nombre: '[TEMPLATE] Zumba',
      tipo: 'clase',
      area: 'fitness',
      icon: '🎵',
      dia: 'Lunes',
      diasSemana: ['Lunes'],
      inicio: '18:00',
      fin: '19:00',
      profesor: '[Sin asignar]',
      profesorId: '',
      cupo: 20,
      cupoDisponible: 20,
      precio: 500,
      precioPronto: 450,
      activa: true,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
    console.log('     ✅ Template creado\n');
    
    console.log('  📝 Template: alumnos/TEMPLATE-ALUMNO...');
    await db.collection('alumnos').doc('TEMPLATE-ALUMNO').set({
      nombre: '[TEMPLATE] Nombre Alumno',
      curp: 'XXXX000000HDFRNN00',
      nivel: 'Fitness',
      condicion: 'ALUMNO_REGULAR',
      matricula: 'N/A',
      correo: 'alumno@example.com',
      celular: '+52XXXXXXXXXX',
      fechaRegistro: new Date().toLocaleDateString('es-MX'),
      vencimiento: '2026-05-15',
      estatus: 'ACTIVO',
      pin: 'gymnastics2026',
      password: 'password123',
      inscripcionPagada: false,
      inscripcionExenta: false,
      clasesRestantes: 0,
      clasesPaquete: 0,
      ultimoPago: '',
      fichaMedica: {
        sangre: 'O+',
        alergias: 'Ninguna',
        lesiones: 'Ninguna',
        emergencia: 'Nombre emergencia'
      },
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
    console.log('     ✅ Template creado\n');
    
    console.log('  📝 Template: reservas/TEMPLATE-RESERVA...');
    await db.collection('reservas').doc('TEMPLATE-RESERVA').set({
      alumnoId: 'IBI-GYM000001',
      alumnoNombre: 'Juan García',
      claseId: 'clase-123',
      claseNombre: 'Zumba',
      area: 'fitness',
      folio: 'IBY-PAG-00000001',
      estado: 'confirmada',
      dia: 'Lunes',
      hora: '18:00',
      horaFin: '19:00',
      profesor: 'Carlos',
      profesorId: 'prof-456',
      pasesTotal: 4,
      pasesRestantes: 2,
      asistencia: false,
      falta: false,
      alertaMostrada: false,
      planSemanal: false,
      slotKey: '',
      weekStart: '2026-04-13',
      semanaIndex: 0,
      fechaClase: '2026-04-13',
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
    console.log('     ✅ Template creado\n');
    
    console.log('  📝 Template: asistencias/TEMPLATE-ASISTENCIA...');
    await db.collection('asistencias').doc('TEMPLATE-ASISTENCIA').set({
      alumnoId: 'IBI-GYM000001',
      claseId: 'clase-123',
      fecha: '2026-04-16',
      tipo: 'presente',
      profesorId: 'prof-456',
      profesorNombre: 'Carlos',
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
    console.log('     ✅ Template creado\n');
    
    console.log('  📝 Template: pagos/TEMPLATE-PAGO...');
    await db.collection('pagos').doc('TEMPLATE-PAGO').set({
      alumnoId: 'IBI-GYM000001',
      nombre: 'Juan García',
      monto: 2500,
      detalle: 'Plan semanal 5 semanas',
      folio: 'IBY-PAG-00000001',
      metodo: 'EFECTIVO',
      referencia: '',
      fecha: firebase.firestore.FieldValue.serverTimestamp(),
      fechaString: new Date().toLocaleDateString('es-MX'),
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
    console.log('     ✅ Template creado\n');
    
    console.log('  📝 Template: auditoria_log/TEMPLATE-AUDIT...');
    await db.collection('auditoria_log').doc('TEMPLATE-AUDIT').set({
      accion: 'ASISTENCIA_MARCADA',
      alumnoId: 'IBI-GYM000001',
      claseId: 'clase-123',
      tipo: 'presente',
      profesorId: 'prof-456',
      fecha: '2026-04-16',
      hora: '15:30:45',
      navegador: navigator.userAgent.substring(0, 100),
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
    console.log('     ✅ Template creado\n');
    
    console.log('  📝 Template: historial_pagos/TEMPLATE-HISTORIAL...');
    await db.collection('historial_pagos').doc('TEMPLATE-HISTORIAL').set({
      alumnoId: 'IBI-GYM000001',
      folio: 'IBY-PAG-00000001',
      monto: 2500,
      detalle: 'Plan semanal 5 semanas',
      estado: 'confirmado',
      fecha: '2026-04-16',
      hora: '15:30',
      registradoEn: firebase.firestore.FieldValue.serverTimestamp()
    });
    console.log('     ✅ Template creado\n');
  },
  
  // ─────────────────────────────────────────────────────────
  // 4️⃣ CONFIGURAR RTDB
  // ─────────────────────────────────────────────────────────
  async configurarRTDB() {
    console.log('\n⚙️ Configurando Realtime Database...\n');
    
    try {
      console.log('  📝 Creando estructura RTDB...');
      
      // eventos
      console.log('    - Creando eventos/');
      await rtdb.ref('eventos/TEMPLATE-ALUMNO').set({
        pagos: {
          'IBY-PAG-00000001': {
            folio: 'IBY-PAG-00000001',
            monto: 2500,
            estado: 'confirmado',
            fecha: '2026-04-16',
            timestamp: Date.now()
          }
        },
        descuentos: {
          'clase-123_2026-04-16': {
            claseId: 'clase-123',
            pasesRestantes: 3,
            timestamp: Date.now()
          }
        }
      });
      console.log('    ✅ eventos creado');
      
      // estadisticas
      console.log('    - Creando estadisticas/');
      await rtdb.ref('estadisticas/general').set({
        fecha: new Date().toLocaleDateString('es-MX'),
        ingresoDelDia: 0,
        cobrosDelDia: 0,
        asistenciasRegistradas: 0,
        ultimaActualizacion: Date.now()
      });
      console.log('    ✅ estadisticas creado');
      
      // notificaciones
      console.log('    - Creando notificaciones/');
      await rtdb.ref('notificaciones/TEMPLATE-ALUMNO').set({
        'notif-001': {
          tipo: 'bienvenida',
          mensaje: 'Bienvenido a IBIME Gymnastics Club',
          timestamp: Date.now()
        }
      });
      console.log('    ✅ notificaciones creado');
      
      // admins
      console.log('    - Creando admins/');
      await rtdb.ref('admins/TEMPLATE-ADMIN').set(true);
      console.log('    ✅ admins creado');
      
      console.log('     ✅ RTDB configurada\n');
    } catch (error) {
      console.warn('⚠️ Error configurando RTDB:', error.message);
    }
  },
  
  // ─────────────────────────────────────────────────────────
  // 5️⃣ EJECUTAR TODO
  // ─────────────────────────────────────────────────────────
  async ejecutarSetup() {
    console.clear();
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║ 🚀 SETUP COMPLETO FIRESTORE + RTDB                       ║');
    console.log('║ ⚠️  ADVERTENCIA: Esto creará/eliminará datos              ║');
    console.log('╚═══════════════════════════════════════════════════════════╝\n');
    
    const confirmacion = confirm(
      '⚠️ ¿Estás seguro?\n\n' +
      'Esto va a:\n' +
      '✅ Crear colecciones correctas\n' +
      '✅ Eliminar colecciones innecesarias\n' +
      '✅ Crear documentos TEMPLATE\n' +
      '✅ Configurar RTDB\n\n' +
      '¿Continuar?'
    );
    
    if (!confirmacion) {
      console.log('❌ Operación cancelada');
      return;
    }
    
    try {
      await this.eliminarColecciones();
      await this.crearColecciones();
      await this.crearTemplates();
      await this.configurarRTDB();
      
      console.log('\n╔═══════════════════════════════════════════════════════════╗');
      console.log('║ ✅ SETUP COMPLETADO EXITOSAMENTE                         ║');
      console.log('╚═══════════════════════════════════════════════════════════╝\n');
      
      console.log('📋 PRÓXIMOS PASOS:');
      console.log('  1. Abre Firebase Console → Firestore Database');
      console.log('  2. Verifica que existan todas las colecciones');
      console.log('  3. Elimina los documentos TEMPLATE- si quieres');
      console.log('  4. Ahora puedes usar la app normalmente\n');
      
      alert('✅ Setup completado. Ver console para detalles.');
      
    } catch (error) {
      console.error('❌ ERROR durante setup:', error);
      alert('❌ Error: ' + error.message);
    }
  }
};

// Exportar para usar desde consola
window.SetupModule = SetupModule;
