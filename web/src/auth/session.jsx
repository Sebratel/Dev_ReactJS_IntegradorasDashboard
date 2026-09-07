/**
 * Sessão do usuário: quem está logado, qual o papel e quais telas ele abre.
 *
 * Quem guarda e renova o token é o SDK do Firebase (ver `firebase.js`), não este
 * arquivo. É a diferença em relação ao `comercial_pbi`, onde 300 linhas cuidam de
 * localStorage, temporizador de renovação e reentrância — tudo isso aqui é
 * `getIdToken()`, que o próprio SDK resolve.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { entrarComGoogle, firebaseConfigurado, observarSessao, sairDoGoogle, tokenAtual } from './firebase';

const Ctx = createContext(null);

/** Encerramentos por token vencido: o `api.js` avisa por aqui. */
const ouvintesFim = new Set();

export function aoEncerrarSessao(fn) {
  ouvintesFim.add(fn);
  return () => ouvintesFim.delete(fn);
}

export function encerrarSessao(motivo = 'expirada', detalhe = null) {
  // deixa rastro: um logout inesperado sem isso vira adivinhação
  console.warn('[sessão] encerrada', { motivo, detalhe });
  ouvintesFim.forEach((fn) => fn(motivo));
}

async function buscarMe() {
  const token = await tokenAtual();
  const res = await fetch('/api/me', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (res.status === 401) {
    /**
     * Uma tentativa com token renovado à força antes de desistir. O 401 aqui pode
     * ser token vencido em cache, e forçar a renovação resolve sem incomodar
     * ninguém.
     */
    const novo = await tokenAtual(true).catch(() => null);
    if (novo) {
      const r2 = await fetch('/api/me', { headers: { Authorization: `Bearer ${novo}` } });
      if (r2.ok) return r2.json();
    }
    return null;
  }
  if (res.status === 403) {
    const corpo = await res.json().catch(() => ({}));
    const err = new Error(corpo.error || 'Sua conta não tem acesso a este dashboard.');
    err.semAcesso = true;
    throw err;
  }
  if (!res.ok) return null;
  return res.json();
}

export function SessionProvider({ children }) {
  const [config, setConfig] = useState(null);   // { habilitado, projectId, dominio }
  const [usuario, setUsuario] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [motivoSaida, setMotivoSaida] = useState(null);
  const qc = useQueryClient();

  /**
   * Sessão encerrada por expiração: volta ao login e joga fora o cache. Sem
   * limpar, quem entrasse depois reencontraria os números da conta anterior.
   */
  useEffect(() => aoEncerrarSessao((motivo) => {
    setUsuario(null);
    setMotivoSaida(motivo);
    qc.clear();
  }), [qc]);

  /**
   * A flag de "ainda montado" é LOCAL do efeito, e não um `useRef`.
   *
   * Com `useRef` isto não funciona: no StrictMode do React 18 o efeito roda
   * monta → desmonta → monta, o cleanup marca o ref como desmontado e o ref
   * SOBREVIVE à remontagem — então todo `setState` seguinte era descartado em
   * silêncio e a tela ficava presa em "Carregando sessão…" para sempre, sem erro
   * nenhum no console. Uma variável do escopo do efeito nasce de novo a cada
   * montagem, que é justamente o que se quer.
   */
  useEffect(() => {
    let ativo = true;
    let cancelarObservador = null;

    (async () => {
      let cfg = null;
      try {
        cfg = await fetch('/api/auth/config').then((r) => r.json());
        if (!ativo) return;
        setConfig(cfg);
      } catch {
        if (ativo) {
          setErro('Não foi possível falar com o servidor. A API está no ar?');
          setCarregando(false);
        }
        return;
      }

      // Servidor com autenticação desligada: entra como admin local. É o modo em
      // que o dashboard roda hoje, antes de existir projeto Firebase.
      if (!cfg.habilitado) {
        setUsuario({ email: 'dev@local', nome: 'Modo sem autenticação', papel: 'admin', powerUser: true, telas: null });
        setCarregando(false);
        return;
      }

      if (!firebaseConfigurado()) {
        setErro(
          'O servidor exige login, mas o front foi construído sem as variáveis VITE_FIREBASE_*. '
          + 'Preencha-as no .env e reconstrua o front (elas entram no build, não em tempo de execução).',
        );
        setCarregando(false);
        return;
      }

      /**
       * Espera o Firebase decidir se havia sessão guardada, em vez de perguntar
       * uma vez e concluir. Na primeira carga `currentUser` ainda é null por
       * alguns milissegundos: perguntar direto manda para o login quem já estava
       * logado.
       */
      try {
        cancelarObservador = await observarSessao(async (fbUser) => {
          if (!ativo) return;
          if (!fbUser) {
            setUsuario(null);
            setCarregando(false);
            return;
          }
          try {
            const me = await buscarMe();
            if (!ativo) return;
            if (me) { setUsuario(me); setErro(null); } else { setUsuario(null); }
          } catch (e) {
            if (ativo) setErro(e.message);
          } finally {
            if (ativo) setCarregando(false);
          }
        });
      } catch (e) {
        if (ativo) { setErro(e.message); setCarregando(false); }
      }
    })();

    return () => {
      ativo = false;
      if (cancelarObservador) cancelarObservador();
    };
  }, []);

  const entrar = useCallback(async () => {
    if (!config?.dominio) throw new Error('Configuração de login não carregada.');
    await entrarComGoogle(config.dominio);
    const me = await buscarMe();
    if (!me) throw new Error('Sua conta não tem acesso a este dashboard.');
    setMotivoSaida(null);
    setErro(null);
    setUsuario(me);
    return me;
  }, [config]);

  const sair = useCallback(async () => {
    await sairDoGoogle().catch(() => {});
    setMotivoSaida(null);
    setUsuario(null);
    qc.clear();
  }, [qc]);

  const valor = useMemo(() => ({
    config,
    usuario,
    carregando,
    erro,
    motivoSaida,
    entrar,
    sair,
    ehAdmin: usuario?.papel === 'admin',
    // Power user corre por fora da hierarquia: quem acumula os dois papéis
    // continua enxergando o que é do DEV.
    ehDev: !!usuario?.powerUser,
    /**
     * `telas: null` significa "sem restrição" (modo sem autenticação). Admin
     * passa em tudo por definição — a mesma regra do servidor, senão a navegação
     * esconderia telas que a API entrega.
     */
    podeVer: (tela) => !usuario?.telas || usuario.papel === 'admin' || usuario.telas.includes(tela),
  }), [config, usuario, carregando, erro, motivoSaida, entrar, sair]);

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export function useSession() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSession fora do SessionProvider');
  return ctx;
}
