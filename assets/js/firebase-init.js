/**
 * firebase-init.js
 * Inicialización centralizada de Firebase.
 * Cargado por las 4 páginas justo después de los scripts CDN de Firebase
 * y antes del script inline de cada página.
 *
 * Requisito: los scripts CDN de Firebase compat ya deben estar
 * cargados ANTES de este archivo en cada HTML:
 *   firebase-app-compat.js
 *   firebase-firestore-compat.js
 *   firebase-database-compat.js
 *   firebase-auth-compat.js  ← requerido para portales de staff y profesores
 *
 * Cada página puede continuar usando `const db = firebase.firestore()`
 * en su propio script; firebase.firestore() devuelve el mismo singleton.
 */
(function () {
  var FIREBASE_CONFIG = {
    apiKey: "AIzaSyBxBmuQY5n5ecf5Vy6vLPu_qKP726IaLzs",
    authDomain: "gymnastics-club-by-ibime.firebaseapp.com",
    databaseURL: "https://gymnastics-club-by-ibime-default-rtdb.firebaseio.com/",
    projectId: "gymnastics-club-by-ibime",
    appId: "1:849277925066:web:6ef91b240277fe24846633"
  };

  if (!firebase.apps.length) {
    firebase.initializeApp(FIREBASE_CONFIG);
  }

  /**
   * Verifica la sesión activa de un usuario de staff en Firebase Auth.
   * Lee el documento `usuarios_staff/{uid}` y valida que el rol esté en la lista.
   *
   * @param {string[]} [rolesPermitidos] - Si se omite, acepta cualquier rol de staff.
   * @returns {Promise<{uid:string, rol:string, nombre:string, correo:string}|null>}
   */
  window.verificarSesionStaff = function (rolesPermitidos) {
    return new Promise(function (resolve) {
      firebase.auth().onAuthStateChanged(async function (user) {
        if (!user) { resolve(null); return; }
        try {
          var snap = await firebase.firestore()
            .collection('usuarios_staff').doc(user.uid).get();
          if (!snap.exists) { resolve(null); return; }
          var data = snap.data();
          if (rolesPermitidos && !rolesPermitidos.includes(data.rol)) {
            resolve(null); return;
          }
          resolve(Object.assign({ uid: user.uid }, data));
        } catch (e) {
          resolve(null);
        }
      });
    });
  };
})();
