/*
 * ASSOLANGE BALLERS — Firebase (sem Node.js, pronto para GitHub Pages)
 * 1. Substitua os valores de firebaseConfig pelos do seu app Web no Firebase.
 * 2. Configure Firestore, Authentication e as regras em firestore.rules.
 * 3. Crie duas contas no Authentication: Admin e Mesário. Cada UID recebe um papel em roles/<UID>.
 * 4. Configure SOMENTE o e-mail público da conta de mesário abaixo. NUNCA a senha.
 * A configuração pública do Firebase NÃO é uma senha; a segurança são as RULES.
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js';
import { getFirestore, collection, doc, onSnapshot, getDoc, setDoc, deleteDoc, runTransaction, writeBatch } from 'https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyAZ3aoR0mnYmqcRh6OrCTUhvj8AwuW4waY",
  authDomain: "assolange-ballers.firebaseapp.com",
  projectId: "assolange-ballers",
  storageBucket: "assolange-ballers.firebasestorage.app",
  messagingSenderId: "579494345946",
  appId: "1:579494345946:web:cc36cb16421fe7d16739e3"
};

// E-mail identificador da conta COLETIVA de mesário criada no Firebase Authentication.
// Este e-mail é público. A senha NÃO aparece no código, não é salva aqui
// e será digitada na tela de acesso do mesário.
export const MESARIO_EMAIL = 'ballers@hotmail.com';
export const mesarioConfigured = MESARIO_EMAIL.includes('@') && !MESARIO_EMAIL.includes('COLE_');

export const configured = !Object.values(firebaseConfig).some(value => /COLE_|SEU-PROJETO|^$/.test(value));
let db = null;
let auth = null;
if (configured) {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);
}

const activeRef = () => doc(db, 'active', 'current');
export const emptyDraft = () => ({status:'setup',teamA:[],teamB:[],stats:{},startedAt:null});
export function subscribe({players, matches, active, error}) {
  if (!configured) return () => {};
  const subs = [
    onSnapshot(collection(db, 'players'), snapshot => {
      players(Object.fromEntries(snapshot.docs.map(d => [d.id, d.data()])));
    }, error),
    onSnapshot(collection(db, 'matches'), snapshot => {
      matches(snapshot.docs.map(d => ({ ...d.data(), id:d.id })));
    }, error),
    onSnapshot(activeRef(), snapshot => {
      active(snapshot.exists() ? snapshot.data() : emptyDraft());
    }, error)
  ];
  return () => subs.forEach(unsub => unsub());
}
export function watchUser(callback) {
  if (!configured) { callback(null, {admin:false, scorer:false}); return () => {}; }
  return onAuthStateChanged(auth, async user => {
    if (!user) return callback(null, {admin:false, scorer:false});
    try {
      const role = await getRole(user.uid);
      // Um login seguido de logout não deve conceder permissões atrasadas.
      if (auth.currentUser?.uid === user.uid) callback(user, role);
    } catch (err) { callback(user, {admin:false,scorer:false}); }
  });
}
async function getRole(uid) {
  const snap = await getDoc(doc(db, 'roles', uid));
  const data = snap.exists() ? snap.data() : {};
  return {admin:data.admin === true, scorer:data.scorer === true || data.admin === true};
}
export async function login(email,password) {
  if (!configured) throw new Error('Preencha o arquivo firebase.js antes de entrar.');
  const credential = await signInWithEmailAndPassword(auth, email, password);
  const role = await getRole(credential.user.uid);
  return {user:credential.user, role};
}
export async function loginScorer(password) {
  if (!mesarioConfigured) throw new Error('Preencha MESARIO_EMAIL no arquivo firebase.js.');
  if (!password) throw new Error('Digite a senha do mesário.');
  const result = await login(MESARIO_EMAIL, password);
  if (result.role.admin || !result.role.scorer) {
    await signOut(auth);
    throw new Error('Esta conta não tem permissão exclusiva de mesário. Verifique o papel scorer no Firestore.');
  }
  return result;
}
export async function logout() {
  if (configured) await signOut(auth);
}
export async function savePlayer(id, data) {
  if (!configured) throw new Error('Firebase ainda não configurado.');
  await setDoc(doc(db,'players',id), data);
}
export async function changeDraft(transform) {
  if (!configured) throw new Error('Firebase ainda não configurado.');
  return runTransaction(db, async tx => {
    const snapshot = await tx.get(activeRef());
    const current = snapshot.exists() ? snapshot.data() : emptyDraft();
    const updated = transform(structuredClone(current));
    if (updated === null) throw new Error('A partida foi alterada em outro celular. Atualize a tela.');
    tx.set(activeRef(), updated);
    return updated;
  });
}
export async function completeMatch(createRecord) {
  if (!configured) throw new Error('Firebase ainda não configurado.');
  return runTransaction(db, async tx => {
    const snapshot = await tx.get(activeRef());
    const current = snapshot.exists() ? snapshot.data() : emptyDraft();
    if (current.status !== 'live') throw new Error('Não existe partida em andamento.');
    const record = createRecord(current);
    tx.set(doc(db,'matches',record.id), record);
    tx.set(activeRef(), emptyDraft());
    return record;
  });
}
export async function removeMatch(id) {
  if (!configured) throw new Error('Firebase ainda não configurado.');
  return deleteDoc(doc(db,'matches',id));
}
export async function importLocal(players, matches) {
  if (!configured) throw new Error('Firebase ainda não configurado.');
  const objects = [
    ...Object.entries(players).map(([id,item]) => ['players', id, item]),
    ...matches.filter(item => !!item.id).map(item => ['matches', item.id, item])
  ];
  // Firestore limita batches; manter bem abaixo do limite.
  for (let i=0; i<objects.length; i+=200) {
    const batch = writeBatch(db);
    for (const [group,id,object] of objects.slice(i,i+200)) batch.set(doc(db,group,id), object);
    await batch.commit();
  }
  return objects.length;
}
