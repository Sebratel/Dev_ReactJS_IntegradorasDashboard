/**
 * Cliente do Firebase Authentication.
 *
 * O SDK vem do npm e entra no BUNDLE — é essa a diferença que faz o login
 * sobreviver ao firewall corporativo. O `comercial_pbi` usa Google Identity
 * Services, que baixa `accounts.google.com/gsi/client` em tempo de execução: com
 * o domínio bloqueado, o botão de login simplesmente não reage, e a tela de erro
 * precisaria exatamente do domínio bloqueado para funcionar.
 *
 * O import é DINÂMICO de propósito. Sem `VITE_FIREBASE_*` configurado o
 * dashboard roda em modo sem autenticação, e nesse caso nem faz sentido puxar
 * ~120 KB de SDK para o navegador de quem não vai logar.
 */

const cfg = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

/** Dá para logar? Sem projeto configurado, não. */
export const firebaseConfigurado = () => !!(cfg.apiKey && cfg.authDomain && cfg.projectId);

export const projetoConfigurado = () => cfg.projectId || null;

let authPromise = null;

async function obterAuth() {
  if (!firebaseConfigurado()) {
    throw new Error(
      'Login não configurado neste ambiente: faltam as variáveis VITE_FIREBASE_* no .env. '
      + 'Elas entram no build, então mudar o .env exige reconstruir o front.',
    );
  }
  if (authPromise) return authPromise;
  authPromise = (async () => {
    const [{ initializeApp, getApps }, auth] = await Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
    ]);
    const app = getApps().length ? getApps()[0] : initializeApp(cfg);
    const inst = auth.getAuth(app);
    // Sessão sobrevive a fechar a aba. `catch` vazio porque em janela privada o
    // navegador recusa a persistência — e isso não pode impedir o login.
    await auth.setPersistence(inst, auth.browserLocalPersistence).catch(() => {});
    return { auth, inst };
  })();
  return authPromise;
}

/** Abre o popup do Google e devolve o usuário do Firebase. */
export async function entrarComGoogle(dominio) {
  const { auth, inst } = await obterAuth();
  const provider = new auth.GoogleAuthProvider();
  // `hd` só filtra o seletor de contas para não aparecer a conta pessoal. NÃO é
  // controle de acesso: quem valida o domínio é o servidor, sempre.
  if (dominio) provider.setCustomParameters({ hd: dominio });
  const cred = await auth.signInWithPopup(inst, provider);
  return cred.user;
}

export async function sairDoGoogle() {
  if (!firebaseConfigurado()) return;
  const { auth, inst } = await obterAuth();
  await auth.signOut(inst);
}

/**
 * Token para a requisição atual.
 *
 * Chama `getIdToken()` sempre, em vez de guardar o token numa variável: o SDK
 * devolve o que está em memória e só vai à rede quando falta pouco para vencer
 * (o ID token dura ~1h). Guardar e reusar é o caminho garantido para o 401 no
 * meio do expediente.
 */
export async function tokenAtual(forcar = false) {
  if (!firebaseConfigurado()) return null;
  const { inst } = await obterAuth();
  const u = inst.currentUser;
  if (!u) return null;
  return u.getIdToken(forcar);
}

/** Avisa quando o Firebase termina de restaurar (ou perder) a sessão. */
export async function observarSessao(callback) {
  const { auth, inst } = await obterAuth();
  return auth.onAuthStateChanged(inst, callback);
}
