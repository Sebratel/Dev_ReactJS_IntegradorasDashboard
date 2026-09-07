/**
 * Verificação do ID token do Firebase — feita AQUI, com a chave pública do
 * Google, em vez de perguntar ao Google a cada login.
 *
 * É esta a diferença que faz um login sobreviver ao firewall corporativo e o
 * outro não. O `access_token` do Google Identity Services é opaco: só o Google
 * sabe de quem é, então a API precisaria chamar `googleapis.com/userinfo` em toda
 * validação — e o `comercial_pbi`, de onde este dashboard herda quase tudo, faz
 * exatamente isso. O ID token do Firebase é um JWT ASSINADO: dentro dele já vem o
 * e-mail, e a assinatura prova que foi o Google que emitiu. Basta ter a chave
 * pública, e ela vale horas.
 *
 * Resultado prático: depois de buscar os certificados uma vez, a API valida login
 * sem tocar na rede. Se a saída para o Google cair, quem já está logado continua
 * trabalhando e quem tem token válido continua entrando.
 *
 * Por que não `firebase-admin`: ele faria exatamente isto, mas arrasta uma árvore
 * grande de dependências (google-auth-library, gcp-metadata, gtoken…) para um
 * servidor que hoje tem seis dependências no total. O que precisamos são estas
 * ~90 linhas de `node:crypto`.
 *
 * Portado de `lakehouse_sebratel/apps/api/src/modules/auth/firebaseToken.ts`.
 */
import { X509Certificate, createVerify } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { config } from '../config.js';

/** Onde o Google publica as chaves públicas que assinam os ID tokens do Firebase. */
const CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

/**
 * Cópia em disco dos certificados. Sem isto, um restart com a saída bloqueada
 * deixaria a API sem conseguir validar NADA — justamente o cenário que este
 * módulo existe para evitar.
 */
const CACHE_FILE = join(tmpdir(), 'native-matrix-firebase-certs.json');

let memo = null;      // { keys, fetchedAt }
let emVoo = null;

const SOFT_TTL_MS = 6 * 60 * 60 * 1000;       // renova depois disso, se der
const HARD_TTL_MS = 30 * 24 * 60 * 60 * 1000; // além disso, não confia mais

function lerDoDisco() {
  try {
    const c = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
    return c?.keys && Object.keys(c.keys).length ? c : null;
  } catch {
    return null;
  }
}

function gravarNoDisco(c) {
  try {
    mkdirSync(dirname(CACHE_FILE), { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(c));
  } catch {
    /* cache é otimização; falhar aqui não pode derrubar login */
  }
}

async function buscarCerts() {
  const r = await fetch(CERTS_URL, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`certificados do Google responderam ${r.status}`);
  const keys = await r.json();
  if (!keys || !Object.keys(keys).length) throw new Error('lista de certificados vazia');
  const c = { keys, fetchedAt: Date.now() };
  gravarNoDisco(c);
  return c;
}

/**
 * Certificados válidos. A ordem importa: serve o que está em memória, renova em
 * segundo plano quando envelhece, e SÓ bloqueia esperando a rede quando não há
 * nada utilizável. Uma renovação que falha não invalida o que já temos.
 */
async function certs() {
  if (!memo) memo = lerDoDisco();

  const idade = memo ? Date.now() - memo.fetchedAt : Infinity;
  if (memo && idade < SOFT_TTL_MS) return memo;

  if (memo && idade < HARD_TTL_MS) {
    // Envelhecido mas ainda utilizável: renova sem segurar o login.
    if (!emVoo) {
      emVoo = buscarCerts()
        .then((c) => { memo = c; return c; })
        .catch((e) => {
          console.warn(`[auth] não consegui renovar os certificados do Google (${e.message}); seguindo com os que estão em cache.`);
          return memo;
        })
        .finally(() => { emVoo = null; });
    }
    return memo;
  }

  // Sem nada utilizável: aqui não tem como não esperar.
  if (!emVoo) {
    emVoo = buscarCerts()
      .then((c) => { memo = c; return c; })
      .finally(() => { emVoo = null; });
  }
  return emVoo;
}

const b64url = (s) => Buffer.from(s, 'base64url');

/**
 * Valida o ID token e devolve as claims, ou null se algo não fecha.
 * Nunca lança por token inválido — só por falha de infraestrutura.
 */
export async function verificarIdToken(token) {
  const projectId = config.auth.firebaseProjectId;
  if (!projectId) return null;

  const partes = String(token || '').split('.');
  if (partes.length !== 3) return null;
  const [cabecalhoCru, payloadCru, assinaturaCrua] = partes;

  let cabecalho;
  let payload;
  try {
    cabecalho = JSON.parse(b64url(cabecalhoCru).toString('utf8'));
    payload = JSON.parse(b64url(payloadCru).toString('utf8'));
  } catch {
    return null;
  }

  // O Firebase assina ID token com RS256. Aceitar o algoritmo que o próprio
  // cabeçalho declara abriria a porta clássica do "alg: none".
  if (cabecalho.alg !== 'RS256' || !cabecalho.kid) return null;

  // Emissor e público têm de ser ESTE projeto: sem isso, um token válido de
  // qualquer outro projeto Firebase do mundo entraria aqui.
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) return null;
  if (payload.aud !== projectId) return null;

  const agora = Math.floor(Date.now() / 1000);
  const exp = Number(payload.exp ?? 0);
  const iat = Number(payload.iat ?? 0);
  if (!exp || exp <= agora) return null;
  // 5 min de tolerância para relógio adiantado do servidor.
  if (iat && iat > agora + 300) return null;

  const guardados = await certs();
  const pem = guardados?.keys?.[cabecalho.kid];
  if (!pem) return null;

  // X509Certificate valida o PEM de verdade; createPublicKey direto no
  // certificado não funciona em todas as versões do Node.
  const ok = createVerify('RSA-SHA256')
    .update(`${cabecalhoCru}.${payloadCru}`)
    .verify(new X509Certificate(pem).publicKey, b64url(assinaturaCrua));
  if (!ok) return null;

  const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
  if (!email) return null;
  if (payload.email_verified === false) return null;

  return {
    email,
    nome: typeof payload.name === 'string' ? payload.name : email,
    foto: typeof payload.picture === 'string' ? payload.picture : null,
  };
}

/** Só para o teste de fumaça: injeta certificados sem tocar na rede. */
export function __certsParaTeste(keys) {
  memo = { keys, fetchedAt: Date.now() };
}
