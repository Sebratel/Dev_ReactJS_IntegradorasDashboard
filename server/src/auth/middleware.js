import { config } from '../config.js';
import { verificarIdToken } from './firebaseToken.js';
import { ehPowerUser, papelDe, peloMenos, podeVerTela } from './access.js';

/**
 * Autenticação + autorização.
 *   minPapel:  'viewer' (padrão) | 'dev' | 'admin' — hierárquico
 *   powerUser: exige o atributo de power user, que corre por fora da hierarquia
 *   tela:      id da tela cujo ACL deve ser respeitado
 *
 * Com AUTH_ENABLED=false o middleware libera tudo — é o modo em que o dashboard
 * roda hoje, e continua sendo o padrão até alguém preencher FIREBASE_PROJECT_ID.
 * Nunca em produção exposta.
 */
export function exigirAuth({ minPapel = 'viewer', powerUser = false, tela = null } = {}) {
  return async (req, res, next) => {
    if (!config.auth.habilitado) {
      req.usuario = {
        email: 'dev@local',
        nome: 'Modo sem autenticação',
        papel: 'admin',
        powerUser: true,
      };
      return next();
    }

    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (!m) return res.status(401).json({ error: 'Faça login para acessar o dashboard.' });

    let usuario = null;
    try {
      usuario = await verificarIdToken(m[1]);
    } catch (err) {
      // Falha de INFRAESTRUTURA (não deu para buscar os certificados do Google) é
      // diferente de token inválido, e a resposta precisa diferenciar: 401 faria
      // o cliente achar que a sessão morreu e mandar a pessoa para o login, que
      // pelo mesmo motivo também não funcionaria.
      console.error('[auth] falha ao verificar o token:', err.message);
      return res.status(503).json({ error: 'Não foi possível validar a sessão agora. Tente novamente em instantes.' });
    }
    if (!usuario) return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });

    if (config.auth.dominio && !usuario.email.endsWith(`@${config.auth.dominio}`)) {
      return res.status(403).json({ error: `Acesso restrito a contas @${config.auth.dominio}.` });
    }

    const papel = papelDe(usuario.email);
    const power = ehPowerUser(usuario.email);
    req.usuario = { ...usuario, papel, powerUser: power };

    if (powerUser && !power) {
      return res.status(403).json({
        error: 'Área exclusiva de power users (DEV). Peça a um administrador para marcar o seu e-mail como power user.',
      });
    }

    if (!peloMenos(papel, minPapel)) {
      const rotulo = minPapel === 'admin' ? 'administradores' : 'usuários DEV';
      return res.status(403).json({ error: `Área restrita a ${rotulo}. Seu perfil é "${papel}".` });
    }

    if (tela && !podeVerTela(req.usuario, tela)) {
      return res.status(403).json({ error: 'Você não tem acesso a esta tela. Fale com um administrador.' });
    }

    return next();
  };
}
