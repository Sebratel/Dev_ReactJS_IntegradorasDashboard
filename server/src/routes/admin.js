import { Router } from 'express';
import { config } from '../config.js';
import { exigirAuth } from '../auth/middleware.js';
import {
  definirPapel, definirPowerUser, definirTela, definirTelasDoEmail,
  listarTelas, listarUsuarios, matrizDeAcesso, papelDe, removerUsuario, telasDoUsuario,
} from '../auth/access.js';
import { definirParams, params, restaurarParams } from '../params.js';
import { estatisticasCache, limparCache } from '../core/cache.js';
import { estado as estadoIA, listarModelos, remover as removerIA, salvar as salvarIA, testar as testarIA } from '../ia/registro.js';
import { MODELO_PADRAO, ROTULO_TIPO, TIPOS } from '../ia/provedor.js';
import { listarVisuais } from '../ia/visuais.js';

export const admin = Router();

// ------------------------------------------------------------------ sessão
/**
 * Configuração pública: o front precisa dela para montar o login.
 *
 * Vai sem autenticação de propósito — é o que o cliente lê ANTES de ter token.
 * Não expõe segredo: o `projectId` do Firebase é público por design (vai no
 * bundle do cliente), e é justamente o que o SDK precisa para falar com o Google.
 */
admin.get('/auth/config', (req, res) => {
  res.json({
    habilitado: config.auth.habilitado,
    projectId: config.auth.firebaseProjectId,
    dominio: config.auth.dominio,
  });
});

/** Quem sou eu: papel efetivo + telas que posso abrir. */
admin.get('/me', exigirAuth(), (req, res) => {
  res.json({
    email: req.usuario.email,
    nome: req.usuario.nome,
    foto: req.usuario.foto || null,
    papel: req.usuario.papel,
    powerUser: !!req.usuario.powerUser,
    telas: telasDoUsuario(req.usuario),
  });
});

// ------------------------------------------------------- usuários e papéis
admin.get('/access/users', exigirAuth({ minPapel: 'admin' }), (req, res) => {
  res.json({ usuarios: listarUsuarios(), papeis: ['viewer', 'dev', 'admin'] });
});

admin.put('/access/users/:email', exigirAuth({ minPapel: 'admin' }), (req, res) => {
  try {
    const papel = definirPapel(req.params.email, req.body?.papel);
    res.json({ ok: true, email: req.params.email.toLowerCase(), papel });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/** Atributo de power user — independente do papel, por isso rota própria. */
admin.put('/access/users/:email/poweruser', exigirAuth({ minPapel: 'admin' }), (req, res) => {
  try {
    const powerUser = definirPowerUser(req.params.email, !!req.body?.ativo);
    res.json({ ok: true, email: req.params.email.toLowerCase(), powerUser });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

admin.delete('/access/users/:email', exigirAuth({ minPapel: 'admin' }), (req, res) => {
  const email = String(req.params.email || '').toLowerCase();
  if (email === req.usuario.email && papelDe(email) === 'admin') {
    return res.status(400).json({ error: 'Você não pode remover o seu próprio acesso de administrador.' });
  }
  const removido = removerUsuario(email);
  return res.json({ ok: true, removido });
});

// ------------------------------------------------------------ acesso/telas
admin.get('/access/screens', exigirAuth({ minPapel: 'admin' }), (req, res) => {
  res.json({ telas: listarTelas() });
});

/**
 * A mesma permissão pelo lado da pessoa — é o que a tela de acessos usa.
 *
 * LER e GRAVAR devolvem o MESMO formato, de propósito: o front troca o estado
 * pela resposta, então um GET mais rico que o PUT faria a tela perder informação
 * no primeiro clique.
 */
admin.get('/access/matriz', exigirAuth({ minPapel: 'admin' }), (req, res) => {
  res.json(matrizDeAcesso());
});

admin.put('/access/users/:email/telas', exigirAuth({ minPapel: 'admin' }), (req, res) => {
  try {
    definirTelasDoEmail(req.params.email, req.body?.telas, req.usuario.email);
    res.json(matrizDeAcesso());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

admin.put('/access/screens/:id', exigirAuth({ minPapel: 'admin' }), (req, res) => {
  try {
    const tela = definirTela(req.params.id, {
      modo: req.body?.modo,
      emails: req.body?.emails,
    }, req.usuario.email);
    res.json({ ok: true, tela, matriz: matrizDeAcesso() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ------------------------------------------------------ parâmetros de data
/**
 * Diferente da "janela de dados" do comercial: lá mudar a data obriga a reler a
 * base inteira (existe ETL), aqui não muda nada retroativamente — a próxima
 * consulta já usa o valor novo, porque `core/pedido.js` lê os parâmetros na hora
 * de montar o período. Por isso aqui não há recarga em segundo plano.
 *
 * O cache, porém, guarda respostas montadas com o período antigo. Limpar é o que
 * evita a tela continuar mostrando a janela anterior por até 15 minutos depois
 * de o admin salvar — e ficar parecendo que a configuração não pegou.
 */
admin.get('/params', exigirAuth({ minPapel: 'admin' }), (req, res) => {
  res.json({ ...params(), cache: estatisticasCache() });
});

admin.put('/params', exigirAuth({ minPapel: 'admin' }), (req, res) => {
  try {
    const antes = params();
    const depois = definirParams(req.body || {}, req.usuario.email);
    const mudou = antes.padraoDias !== depois.padraoDias || antes.maxDias !== depois.maxDias;
    if (mudou) {
      console.log(`[params] ${req.usuario.email}: padrão ${antes.padraoDias}→${depois.padraoDias} dias, máximo ${antes.maxDias}→${depois.maxDias} dias`);
      limparCache();
    }
    return res.json({ ...depois, cache: estatisticasCache() });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

admin.post('/params/restaurar', exigirAuth({ minPapel: 'admin' }), (req, res) => {
  const depois = restaurarParams();
  limparCache();
  console.log(`[params] ${req.usuario.email}: voltou para a semente do .env`);
  res.json({ ...depois, cache: estatisticasCache() });
});

/** Botão de atualizar da barra do topo. */
admin.post('/cache/limpar', exigirAuth(), (req, res) => {
  const quantas = limparCache();
  res.json({ ok: true, descartadas: quantas });
});

// ------------------------------------------------------- provedor de IA
admin.get('/ia', exigirAuth({ minPapel: 'admin' }), (req, res) => {
  res.json({
    ...estadoIA(),
    tipos: TIPOS.map((t) => ({ id: t, label: ROTULO_TIPO[t], modeloPadrao: MODELO_PADRAO[t] })),
    visuais: listarVisuais(),
  });
});

admin.put('/ia', exigirAuth({ minPapel: 'admin' }), (req, res) => {
  try {
    res.json(salvarIA(req.body || {}, req.usuario.email));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

admin.delete('/ia', exigirAuth({ minPapel: 'admin' }), (req, res) => {
  res.json(removerIA());
});

admin.post('/ia/modelos', exigirAuth({ minPapel: 'admin' }), async (req, res) => {
  try {
    res.json({ modelos: await listarModelos(req.body || {}) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

admin.post('/ia/testar', exigirAuth({ minPapel: 'admin' }), async (req, res) => {
  try {
    res.json(await testarIA());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
