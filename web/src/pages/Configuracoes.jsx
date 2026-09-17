/**
 * Configurações do dashboard — quatro abas: quem entra, o que cada um vê, o
 * recorte de datas e o provedor de IA.
 *
 * Portado do `comercial_pbi`, com três diferenças deliberadas:
 *
 * 1. **Sem escopo de dados por equipe.** Lá cada pessoa vê só a fatia dela em
 *    todas as telas; aqui quem abre a tela vê a tela inteira (decisão do usuário
 *    em 07/09/2026). A coluna "Equipes" da matriz não existe.
 * 2. **Sem coluna de power user.** O atributo existe no servidor, mas neste
 *    dashboard nenhuma área o exige ainda — e caixa de marcação que não muda
 *    nada engana quem clica. Volta à tela no dia em que existir uma área técnica.
 * 3. **A aba de datas configura o PEDIDO, não a carga.** Não há ETL aqui: as
 *    consultas vão direto ao banco com o período da tela. Ver `params.js`.
 */
import { useCallback, useEffect, useState } from 'react';
import { apiAdmin } from '../api';
import { useSession } from '../auth/session.jsx';
import { Erro, Loading, useExportavel, Visual } from '../components/ui';
import { Icone } from '../components/Icone';

/*
 * As quatro abas dividem um único `Visual`, mas só uma renderiza por vez —
 * então o cabeçalho nunca mostra o botão de duas ao mesmo tempo. O rótulo que
 * cada uma passa a `useExportavel` existe para o nome do arquivo: sem ele as
 * quatro gerariam `configuracoes-<data>.csv`.
 */

const PAPEL_LABEL = { viewer: 'Visualizador', dev: 'DEV', admin: 'Administrador' };
const PAPEL_AJUDA = {
  viewer: 'Vê as telas liberadas para todos e aquelas em que o e-mail está na lista.',
  admin: 'Gerencia pessoas, acesso por tela, datas e provedor de IA. Vê todas as telas.',
};

const dataHoraBr = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

// ------------------------------------------------------ usuários e papéis
function AbaUsuarios() {
  const { usuario } = useSession();
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(null);
  const [ocupado, setOcupado] = useState(null);
  const [email, setEmail] = useState('');
  const [papel, setPapel] = useState('admin');

  const carregar = useCallback(async () => {
    try {
      setDados(await apiAdmin('/access/users'));
      setErro(null);
    } catch (e) { setErro(e); }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const executar = async (fn, chave) => {
    setOcupado(chave);
    try { await fn(); await carregar(); setErro(null); } catch (e) { setErro(e); } finally { setOcupado(null); }
  };

  // Vale exportar: é a lista de quem tem acesso, que é o que se pede numa
  // auditoria. A coluna de ações não vai — botão não é dado.
  useExportavel('usuarios', () => {
    const linhas = dados?.usuarios || [];
    if (!linhas.length) return null;
    return {
      colunas: [
        { key: 'email', titulo: 'E-mail' },
        { key: 'papel', titulo: 'Papel', fmt: (v) => PAPEL_LABEL[v] || v },
        { key: 'origem', titulo: 'Origem', fmt: (v) => (v === 'env' ? 'semente (.env)' : 'definido na tela') },
      ],
      linhas,
    };
  });

  const conceder = () => {
    const e = email.trim().toLowerCase();
    if (!e.includes('@')) { setErro(new Error('Informe um e-mail válido.')); return; }
    executar(async () => {
      await apiAdmin(`/access/users/${encodeURIComponent(e)}`, { method: 'PUT', body: JSON.stringify({ papel }) });
      setEmail('');
    }, e);
  };

  if (!dados && !erro) return <Loading texto="Carregando usuários…" />;

  return (
    <div className="cfg-bloco">
      {erro && <Erro erro={erro} />}

      <p className="cfg-nota">
        Esta aba define <b>papéis</b>. Quem não está na lista é visualizador e vê as telas
        liberadas — quais telas cada um abre é a aba <b>Telas</b>.
      </p>

      <div className="cfg-form">
        <label>
          <span>E-mail corporativo</span>
          <input
            type="email"
            value={email}
            placeholder="nome@sebratel.com.br"
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') conceder(); }}
          />
        </label>
        <label>
          <span>Papel</span>
          <select value={papel} onChange={(e) => setPapel(e.target.value)}>
            <option value="admin">Administrador</option>
            <option value="viewer">Visualizador</option>
          </select>
        </label>
        <button type="button" className="cfg-botao" onClick={conceder} disabled={!!ocupado}>
          <Icone nome="mais" tamanho={14} /> Conceder
        </button>
      </div>

      <div className="tbl-wrap" style={{ maxHeight: 340 }}>
        <table className="pbi">
          <thead>
            <tr>
              <th className="left">E-mail</th>
              <th className="left">Papel</th>
              <th className="left">Origem</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(dados?.usuarios || []).map((u) => (
              <tr key={u.email}>
                <td className="left">
                  {u.email}
                  {u.email === usuario?.email && <span className="cfg-tag">você</span>}
                </td>
                <td className="left">
                  {u.origem === 'env' ? (
                    <b>{PAPEL_LABEL[u.papel]}</b>
                  ) : (
                    <select
                      value={u.papel}
                      disabled={ocupado === u.email}
                      className="cfg-select-inline"
                      onChange={(e) => executar(
                        () => apiAdmin(`/access/users/${encodeURIComponent(u.email)}`, {
                          method: 'PUT', body: JSON.stringify({ papel: e.target.value }),
                        }),
                        u.email,
                      )}
                    >
                      {['viewer', 'dev', 'admin'].map((p) => (
                        <option key={p} value={p}>{PAPEL_LABEL[p]}</option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="left">
                  {u.origem === 'env'
                    ? <span className="cfg-tag fixo"><Icone nome="cadeado" tamanho={11} /> semente (.env)</span>
                    : <span className="cfg-tag">definido na tela</span>}
                </td>
                <td className="right">
                  {u.origem === 'arquivo' && (
                    <button
                      type="button"
                      className="cfg-remover"
                      title="Remover — volta a ser visualizador"
                      disabled={ocupado === u.email}
                      onClick={() => executar(
                        () => apiAdmin(`/access/users/${encodeURIComponent(u.email)}`, { method: 'DELETE' }),
                        u.email,
                      )}
                    >
                      <Icone nome="fechar" tamanho={13} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {dados && !dados.usuarios.length && (
              <tr>
                <td colSpan={4} style={{ textAlign: 'center', padding: 24, color: 'var(--pbi-muted)' }}>
                  Ninguém com papel elevado ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ul className="cfg-legenda">
        {Object.entries(PAPEL_AJUDA).map(([p, txt]) => (
          <li key={p}><b>{PAPEL_LABEL[p]}:</b> {txt}</li>
        ))}
        <li>
          Papéis de semente vêm de <code>ADMIN_EMAILS</code> no <code>.env</code> e não podem ser
          removidos por aqui — é o que garante que sempre exista um administrador capaz de abrir
          esta tela.
        </li>
      </ul>
    </div>
  );
}

// ------------------------------------------------------------ acesso/telas
function AbaTelas() {
  const { usuario } = useSession();
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [novo, setNovo] = useState('');
  const [pendentes, setPendentes] = useState([]); // e-mails digitados, ainda sem nada
  // rascunho: só o que difere do servidor
  const [rasTelas, setRasTelas] = useState({});   // email -> [telaId]
  const [rasModo, setRasModo] = useState({});     // telaId -> 'todos' | 'lista'

  const carregar = useCallback(async () => {
    try {
      setDados(await apiAdmin('/access/matriz'));
      setErro(null);
    } catch (e) { setErro(e); }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const limparRascunho = () => { setRasTelas({}); setRasModo({}); setPendentes([]); };

  /**
   * O CSV da matriz responde "quem vê o quê" — e diz POR QUÊ, que é o que a
   * tela mostra com ícone em vez de caixa: administrador passa por definição e
   * tela aberta vale para todo o domínio. Exportar só `sim`/`não` esconderia
   * justamente a parte que importa numa auditoria.
   *
   * O gancho fica ANTES do retorno de carregamento: hook não pode ficar depois
   * de um `return` condicional.
   */
  useExportavel('acesso por tela', () => {
    const lista = dados?.telas || [];
    const pessoas = dados?.pessoas || [];
    if (!lista.length || !pessoas.length) return null;
    const modo = (t) => rasModo[t.id] ?? t.modo;
    return {
      colunas: [
        { key: 'email', titulo: 'Pessoa' },
        { key: 'papel', titulo: 'Papel', fmt: (v) => PAPEL_LABEL[v] || v },
        ...lista.map((t) => ({
          key: `tela_${t.id}`,
          titulo: t.label + (modo(t) === 'todos' ? ' (aberta a todos)' : ''),
          fmt: (_v, p) => {
            if (p.veTudo) return 'sim (administrador)';
            if (modo(t) === 'todos') return 'sim (tela aberta)';
            return (rasTelas[p.email] ?? p.telas).includes(t.id) ? 'sim' : 'não';
          },
        })),
      ],
      linhas: pessoas,
    };
  });

  if (!dados && !erro) return <Loading texto="Carregando acessos…" />;

  const telas = dados?.telas || [];
  const pessoasServidor = dados?.pessoas || [];

  // leitura efetiva = rascunho quando existe, servidor quando não
  const modoDe = (t) => rasModo[t.id] ?? t.modo;
  const telasDe = (p) => rasTelas[p.email] ?? p.telas;

  const linhas = [
    ...pessoasServidor,
    ...pendentes
      .filter((e) => !pessoasServidor.some((p) => p.email === e))
      .map((email) => ({ email, papel: 'viewer', telas: [], novo: true })),
  ];

  const alteracoes = Object.keys(rasTelas).length + Object.keys(rasModo).length;

  const alternarTela = (pessoa, telaId) => {
    const atual = new Set(telasDe(pessoa));
    if (atual.has(telaId)) atual.delete(telaId); else atual.add(telaId);
    setRasTelas((r) => ({ ...r, [pessoa.email]: [...atual] }));
    setSalvo(false);
  };

  const trocarModo = (tela) => {
    setRasModo((r) => ({ ...r, [tela.id]: modoDe(tela) === 'todos' ? 'lista' : 'todos' }));
    setSalvo(false);
  };

  const adicionar = () => {
    const e = novo.trim().toLowerCase();
    if (!e.includes('@')) { setErro(new Error('Informe um e-mail válido.')); return; }
    if (!linhas.some((p) => p.email === e)) setPendentes((lista) => [...lista, e]);
    setNovo('');
    setErro(null);
  };

  /**
   * Ordem importa: o modo da tela vai primeiro. `definirTelasDoEmail` ignora tela
   * em modo "todos", então marcar alguém numa tela que só agora virou restrita
   * seria descartado se a gravação viesse antes.
   */
  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      for (const [id, modo] of Object.entries(rasModo)) {
        const tela = telas.find((t) => t.id === id);
        await apiAdmin(`/access/screens/${id}`, {
          method: 'PUT',
          body: JSON.stringify({ modo, emails: modo === 'lista' ? (tela?.emails || []) : [] }),
        });
      }
      for (const [email, lista] of Object.entries(rasTelas)) {
        await apiAdmin(`/access/users/${encodeURIComponent(email)}/telas`, {
          method: 'PUT', body: JSON.stringify({ telas: lista }),
        });
      }
      limparRascunho();
      await carregar();
      setSalvo(true);
      setTimeout(() => setSalvo(false), 3000);
    } catch (e) { setErro(e); } finally { setSalvando(false); }
  };

  const restritas = telas.filter((t) => modoDe(t) === 'lista').length;
  // agrupa o cabeçalho por relatório: são 14 telas em três relatórios, e sem a
  // divisão as três colunas "Capa" e as duas "Matrix" ficam indistinguíveis
  const grupos = telas.reduce((acc, t) => {
    const ultimo = acc[acc.length - 1];
    if (ultimo && ultimo.nome === t.relatorio) ultimo.quantas += 1;
    else acc.push({ nome: t.relatorio, quantas: 1 });
    return acc;
  }, []);

  return (
    <div className="cfg-bloco">
      {erro && <Erro erro={erro} />}

      <p className="cfg-nota">
        Cada coluna é uma tela. Coluna em <b>todos</b> vale para qualquer conta do domínio, então
        aparece preenchida e sem caixa. As telas de <b>Produtividade</b> e <b>Quartis</b> mostram
        desempenho individual por nome — são as que mais pedem restrição.
      </p>

      <div className="cfg-form">
        <label>
          <span>Liberar acesso para</span>
          <input
            type="email"
            value={novo}
            placeholder="nome@sebratel.com.br"
            onChange={(e) => setNovo(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') adicionar(); }}
          />
        </label>
        <button type="button" className="cfg-botao ghost" onClick={adicionar}>
          <Icone nome="mais" tamanho={14} /> Adicionar à matriz
        </button>
        <span className="cfg-aviso">
          {restritas === 0
            ? 'Nenhuma tela está restrita: hoje todo o domínio vê tudo.'
            : `${restritas} de ${telas.length} ${restritas === 1 ? 'tela restrita' : 'telas restritas'}.`}
        </span>
      </div>

      {/* nada é gravado até aqui: o que está pendente fica visível e desfazível */}
      <div className={`ras-barra${alteracoes ? ' ativa' : ''}`}>
        {alteracoes ? (
          <>
            <Icone nome="alerta" tamanho={14} />
            <span>
              <b>{alteracoes}</b> {alteracoes === 1 ? 'alteração não salva' : 'alterações não salvas'}
              {' '}— as células pendentes estão destacadas.
            </span>
            <button type="button" className="cfg-botao ghost" onClick={limparRascunho} disabled={salvando}>
              Descartar
            </button>
            <button type="button" className="cfg-botao" onClick={salvar} disabled={salvando}>
              <Icone nome="ok" tamanho={13} /> {salvando ? 'salvando…' : 'Salvar alterações'}
            </button>
          </>
        ) : (
          <>
            <Icone nome={salvo ? 'ok' : 'cadeado'} tamanho={14} />
            <span>{salvo ? 'Alterações salvas.' : 'Nenhuma alteração pendente.'}</span>
          </>
        )}
      </div>

      <div className="tbl-wrap matriz-wrap">
        <table className="pbi matriz">
          <thead>
            <tr className="tr-grupos">
              <th className="left col-pessoa" rowSpan={2}>Pessoa</th>
              {grupos.map((g) => (
                <th key={g.nome} colSpan={g.quantas} className="col-grupo">{g.nome}</th>
              ))}
            </tr>
            <tr>
              {telas.map((t) => {
                const modo = modoDe(t);
                return (
                  <th key={t.id} className="col-tela" title={`${t.label} — ${t.descricao}`}>
                    <span className="mt-nome">{t.curto || t.label}</span>
                    <button
                      type="button"
                      className={`mt-modo ${modo}${rasModo[t.id] ? ' pendente' : ''}`}
                      title={modo === 'todos'
                        ? 'Visível para todo o domínio. Clique para restringir à lista.'
                        : 'Restrita à lista. Clique para liberar a todo o domínio.'}
                      onClick={() => trocarModo(t)}
                    >
                      {modo === 'todos' ? 'todos' : 'restrita'}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {linhas.map((p) => {
              const minhasTelas = telasDe(p);
              return (
                <tr key={p.email} className={p.novo ? 'linha-nova' : ''}>
                  <td className="left col-pessoa" title={p.email}>
                    <span className="mt-email">
                      {p.email}
                      {p.email === usuario?.email && <span className="cfg-tag">você</span>}
                      {p.papel !== 'viewer' && <span className="cfg-tag">{PAPEL_LABEL[p.papel]}</span>}
                    </span>
                  </td>
                  {telas.map((t) => {
                    const aberta = modoDe(t) === 'todos';
                    const veTudo = p.veTudo;
                    // admin passa por definição, e tela aberta vale para todos:
                    // caixinha nesses casos enganaria quem clica
                    if (veTudo || aberta) {
                      return (
                        <td key={t.id} className="col-tela">
                          <span
                            className={`mt-implicito${veTudo ? ' admin' : ''}`}
                            title={veTudo
                              ? 'Administrador enxerga todas as telas'
                              : 'Tela liberada para todo o domínio'}
                          >
                            <Icone nome="ok" tamanho={12} />
                          </span>
                        </td>
                      );
                    }
                    const marcada = minhasTelas.includes(t.id);
                    const mudou = !!rasTelas[p.email] && p.telas.includes(t.id) !== marcada;
                    return (
                      <td key={t.id} className={`col-tela${mudou ? ' pendente' : ''}`}>
                        <input
                          type="checkbox"
                          className="mt-caixa"
                          checked={marcada}
                          title={`${marcada ? 'Remover' : 'Liberar'} ${t.label} para ${p.email}`}
                          onChange={() => alternarTela(p, t.id)}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {!linhas.length && (
              <tr>
                <td colSpan={telas.length + 1} style={{ textAlign: 'center', padding: 22, color: 'var(--pbi-muted)' }}>
                  Ninguém cadastrado ainda. Adicione um e-mail acima.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ul className="cfg-legenda">
        <li>
          <b>Todos</b> vale para qualquer conta do domínio. <b>Restrita</b> vale só para quem
          estiver marcado — e para os administradores, que entram em tudo.
        </li>
        <li>
          Tela restrita <b>sem ninguém marcado</b> fica só para administradores. É estado válido:
          o contrário faria uma remoção de acesso devolver a tela ao domínio inteiro, ou seja,
          tirar acesso ampliaria o acesso.
        </li>
        <li>
          A permissão é conferida <b>em cada endpoint</b>, não só na navegação: esconder o item do
          menu não é o que protege o dado. Isso inclui o botão de <b>Insights</b> — a IA não vira
          porta lateral para a tela que a permissão fechou.
        </li>
      </ul>
    </div>
  );
}

// ------------------------------------------------------ parâmetros de data
function AbaDatas() {
  const [estado, setEstado] = useState(null);
  const [erro, setErro] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [form, setForm] = useState({ padraoDias: '', maxDias: '' });

  const carregar = useCallback(async () => {
    try {
      const d = await apiAdmin('/params');
      setEstado(d);
      setForm({ padraoDias: String(d.padraoDias), maxDias: String(d.maxDias) });
      setErro(null);
    } catch (e) { setErro(e); }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const gravar = async (fn) => {
    setSalvando(true);
    setErro(null);
    try { await fn(); await carregar(); setSalvo(true); setTimeout(() => setSalvo(false), 3000); }
    catch (e) { setErro(e); } finally { setSalvando(false); }
  };

  const salvar = () => gravar(() => apiAdmin('/params', {
    method: 'PUT',
    body: JSON.stringify({ padraoDias: Number(form.padraoDias), maxDias: Number(form.maxDias) }),
  }));

  const restaurar = () => gravar(() => apiAdmin('/params/restaurar', { method: 'POST' }));

  if (!estado && !erro) return <Loading texto="Carregando parâmetros…" />;

  const mudou = estado
    && (Number(form.padraoDias) !== estado.padraoDias || Number(form.maxDias) !== estado.maxDias);

  return (
    <div className="cfg-bloco">
      {erro && <Erro erro={erro} />}

      <p className="cfg-nota">
        As consultas deste dashboard vão <b>direto ao banco</b> com o período da tela — não existe
        carga em memória para reconstruir. Então mudar estes valores <b>não recalcula nada
        retroativamente</b>: a próxima consulta já usa o valor novo.
      </p>

      <div className="cfg-form">
        <label>
          <span>Período padrão (dias)</span>
          <input
            type="number"
            min="1"
            max={estado?.limiteAbsoluto || 1826}
            value={form.padraoDias}
            onChange={(e) => { setForm({ ...form, padraoDias: e.target.value }); setSalvo(false); }}
          />
        </label>
        <label>
          <span>Janela máxima (dias)</span>
          <input
            type="number"
            min="1"
            max={estado?.limiteAbsoluto || 1826}
            value={form.maxDias}
            onChange={(e) => { setForm({ ...form, maxDias: e.target.value }); setSalvo(false); }}
          />
        </label>
        <button type="button" className="cfg-botao" onClick={salvar} disabled={salvando || !mudou}>
          <Icone nome="ok" tamanho={13} /> {salvando ? 'salvando…' : 'Salvar'}
        </button>
        {estado?.origem === 'tela' && (
          <button type="button" className="cfg-botao ghost" onClick={restaurar} disabled={salvando}>
            <Icone nome="atualizar" tamanho={13} /> Voltar ao .env
          </button>
        )}
        {salvo && <span className="cfg-aviso ok"><Icone nome="ok" tamanho={13} /> salvo</span>}
      </div>

      <div className="cfg-info">
        <div>
          <b>Em vigor</b>
          <span>
            abre com {estado?.padraoDias} dias · máximo {estado?.maxDias} dias
            {' '}({estado?.origem === 'tela' ? 'definido na tela' : 'semente do .env'})
          </span>
        </div>
        <div>
          <b>Cache de consultas</b>
          <span>
            {estado?.cache?.entradas ?? 0} respostas guardadas · taxa de acerto{' '}
            {estado?.cache?.taxa === null || estado?.cache?.taxa === undefined
              ? '—'
              : `${Math.round(estado.cache.taxa * 100)}%`}
          </span>
        </div>
        {estado?.atualizadoEm && (
          <div>
            <b>Última alteração</b>
            <span>{dataHoraBr(estado.atualizadoEm)} por {estado.atualizadoPor || '—'}</span>
          </div>
        )}
      </div>

      <div className="cfg-medicao">
        <h4>Quanto custa esticar a janela</h4>
        <p>
          Medido contra a base de produção em 07/09/2026, comparando 30 dias com 365. É por isso
          que existe um teto — e por isso as quatro consultas de baixo são guardadas em cache por
          mais tempo que as outras.
        </p>
        <table className="pbi">
          <thead>
            <tr><th className="left">Consulta</th><th>30 dias</th><th>365 dias</th><th>fator</th></tr>
          </thead>
          <tbody>
            {[
              ['Quartis', '0,7s', '28,5s', '43x'],
              ['Produtividade · Elleven', '0,7s', '11,2s', '15x'],
              ['Produtividade · Matrix', '3,1s', '11,1s', '3,5x'],
              ['Suporte · acompanhamento', '1,4s', '9,4s', '6,9x'],
              ['Analíticos · atendimento', '0,5s', '4,0s', '7,7x'],
              ['as outras sete', 'até 1,4s', 'até 2,0s', '—'],
            ].map(([nome, a, b, f]) => (
              <tr key={nome}>
                <td className="left">{nome}</td>
                <td>{a}</td>
                <td>{b}</td>
                <td>{f}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="cfg-legenda">
        <li>
          <b>Período padrão</b> é o que a tela abre quando ninguém escolheu data. <b>Janela
          máxima</b> é o teto do que se pode pedir — inclusive digitando na URL.
        </li>
        <li>
          O teto não existe para proibir janela longa, e sim para que um <code>de</code> errado na
          URL não vire varredura de anos no banco de produção. O limite absoluto é{' '}
          {estado?.limiteAbsoluto || 1826} dias.
        </li>
        <li>
          Salvar <b>descarta o cache</b> de respostas. Sem isso a tela continuaria mostrando a
          janela anterior por até 15 minutos e pareceria que a configuração não pegou.
        </li>
      </ul>
    </div>
  );
}

// ------------------------------------------------------------ provedor de IA
function AbaIA() {
  const [estado, setEstado] = useState(null);
  const [erro, setErro] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);
  const [teste, setTeste] = useState(null);
  const [modelos, setModelos] = useState([]);
  const [buscandoModelos, setBuscandoModelos] = useState(false);
  const [form, setForm] = useState({ tipo: 'anthropic', modelo: '', chave: '', baseUrl: '', maxTokens: 4000 });

  const carregar = useCallback(async () => {
    try {
      const d = await apiAdmin('/ia');
      setEstado(d);
      setForm((f) => ({
        ...f,
        tipo: d.tipo || 'anthropic',
        modelo: d.modelo || '',
        baseUrl: d.baseUrl || '',
        maxTokens: d.maxTokens || 4000,
        chave: '',
      }));
      setTeste(d.ultimoTeste || null);
      setErro(null);
    } catch (e) { setErro(e); }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      const corpo = {
        tipo: form.tipo,
        modelo: form.modelo,
        baseUrl: form.baseUrl || null,
        maxTokens: Number(form.maxTokens) || 4000,
      };
      if (form.chave.trim()) corpo.chave = form.chave.trim();
      await apiAdmin('/ia', { method: 'PUT', body: JSON.stringify(corpo) });
      await carregar();
    } catch (e) { setErro(e); } finally { setSalvando(false); }
  };

  const buscarModelos = async () => {
    setBuscandoModelos(true);
    setErro(null);
    try {
      const corpo = { tipo: form.tipo, baseUrl: form.baseUrl || null };
      if (form.chave.trim()) corpo.chave = form.chave.trim();
      const d = await apiAdmin('/ia/modelos', { method: 'POST', body: JSON.stringify(corpo) });
      setModelos(d.modelos || []);
    } catch (e) { setErro(e); } finally { setBuscandoModelos(false); }
  };

  const testar = async () => {
    setTestando(true);
    setErro(null);
    try { setTeste(await apiAdmin('/ia/testar', { method: 'POST' })); }
    catch (e) { setErro(e); } finally { setTestando(false); }
  };

  const remover = async () => {
    setSalvando(true);
    try {
      await apiAdmin('/ia', { method: 'DELETE' });
      setModelos([]);
      setTeste(null);
      await carregar();
    } catch (e) { setErro(e); } finally { setSalvando(false); }
  };

  if (!estado && !erro) return <Loading texto="Carregando configuração…" />;

  const tipoAtual = (estado?.tipos || []).find((t) => t.id === form.tipo);

  return (
    <div className="cfg-bloco">
      {erro && <Erro erro={erro} />}

      <p className="cfg-nota">
        Os números dos gráficos são calculados pelo dashboard, sempre. O provedor cadastrado aqui
        serve só para <b>interpretar</b> o que já está desenhado, no botão <b>Insights</b> do
        cabeçalho dos visuais. <b>Nenhum dado individual de agente é enviado</b> — as telas de
        Produtividade e Quartis não têm o botão, e os visuais do Suporte que trazem nomes têm esse
        bloco descartado antes do envio.
      </p>

      <div className={`ia-estado ${estado?.configurado ? 'ok' : 'vazio'}`}>
        <Icone nome={estado?.configurado ? 'ok' : 'alerta'} tamanho={15} />
        {estado?.configurado ? (
          <span>
            Configurado: <b>{estado.tipo}</b> · <code>{estado.modelo}</code> · chave {estado.dica}
            {estado.origem === 'env' && ' (vindo do .env)'}
            {estado.atualizadoPor && ` · por ${estado.atualizadoPor}`}
          </span>
        ) : (
          <span>
            Nenhuma chave cadastrada. Os {estado?.visuais?.length || 0} visuais com leitura de IA
            mostram o botão só para administradores até existir uma chave.
          </span>
        )}
      </div>

      <div className="ia-form">
        <div className="cfg-form">
          <label>
            <span>Provedor</span>
            <select
              value={form.tipo}
              onChange={(e) => {
                const t = (estado?.tipos || []).find((x) => x.id === e.target.value);
                // troca o modelo junto: o modelo do provedor anterior não existe no novo
                setForm({ ...form, tipo: e.target.value, modelo: t?.modeloPadrao || '' });
                setModelos([]);
              }}
            >
              {(estado?.tipos || []).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>
          <label>
            <span>Chave de API {estado?.configurado && '(em branco mantém a atual)'}</span>
            <input
              type="password"
              autoComplete="off"
              placeholder={estado?.configurado ? `mantém ${estado.dica}` : 'cole a chave aqui'}
              value={form.chave}
              onChange={(e) => setForm({ ...form, chave: e.target.value })}
            />
          </label>
        </div>

        <div className="cfg-form">
          <label>
            <span>Modelo</span>
            {modelos.length ? (
              <select value={form.modelo} onChange={(e) => setForm({ ...form, modelo: e.target.value })}>
                <option value="">selecione…</option>
                {modelos.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            ) : (
              <input
                type="text"
                placeholder={`ex.: ${tipoAtual?.modeloPadrao || 'claude-opus-5'}`}
                value={form.modelo}
                onChange={(e) => setForm({ ...form, modelo: e.target.value })}
              />
            )}
          </label>
          <button type="button" className="cfg-botao ghost" onClick={buscarModelos} disabled={buscandoModelos}>
            <Icone nome="atualizar" tamanho={13} className={buscandoModelos ? 'spin' : ''} />
            {buscandoModelos ? 'buscando…' : 'listar modelos da chave'}
          </button>
        </div>

        <div className="cfg-form">
          <label>
            <span>URL base (opcional — Groq, OpenRouter, Azure, local)</span>
            <input
              type="text"
              placeholder="deixe vazio para o padrão do provedor"
              value={form.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
            />
          </label>
          <label>
            <span>Teto de tokens</span>
            <input
              type="number"
              min="256"
              max="64000"
              value={form.maxTokens}
              onChange={(e) => setForm({ ...form, maxTokens: e.target.value })}
            />
          </label>
        </div>

        <div className="ia-acoes">
          <button type="button" className="cfg-botao" onClick={salvar} disabled={salvando}>
            <Icone nome="ok" tamanho={13} /> Salvar
          </button>
          <button type="button" className="cfg-botao ghost" onClick={testar} disabled={testando || !estado?.configurado}>
            <Icone nome="play" tamanho={13} /> {testando ? 'testando…' : 'Testar conexão'}
          </button>
          {estado?.origem === 'tela' && (
            <button type="button" className="cfg-botao ghost" onClick={remover} disabled={salvando}>
              <Icone nome="fechar" tamanho={13} /> Remover chave
            </button>
          )}
          {teste && (
            <span className={`ia-teste ${teste.ok ? 'ok' : 'falha'}`}>
              {teste.ok
                ? `conexão ok em ${teste.ms} ms — resposta: "${teste.amostra}"`
                : `falhou: ${teste.erro}`}
            </span>
          )}
        </div>
      </div>

      {!!estado?.visuais?.length && (
        <details className="cfg-detalhes">
          <summary>{estado.visuais.length} visuais com leitura de IA</summary>
          <ul className="cfg-visuais">
            {estado.visuais.map((v) => (
              <li key={v.id}><b>{v.titulo}</b> <code>{v.id}</code></li>
            ))}
          </ul>
        </details>
      )}

      <ul className="cfg-legenda">
        <li>A chave é gravada <b>cifrada</b> (AES-256-GCM) e nunca volta numa resposta da API — só os quatro últimos caracteres.</li>
        <li><b>OpenAI e compatíveis</b> cobre Groq, OpenRouter, Azure OpenAI, Together e servidores locais: muda só a URL base.</li>
        <li>
          O cliente manda ao servidor apenas o <b>identificador do visual</b> e os filtros da tela.
          Quem remonta os números é o servidor, pela mesma função que desenha o gráfico — assim a
          leitura não pode divergir da tela nem ser induzida por uma requisição adulterada.
        </li>
        <li>Defina <code>SECRET_KEY</code> no ambiente para controlar a chave de cifra; sem ela, uma é gerada na pasta de dados.</li>
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
const ABAS = [
  { id: 'usuarios', label: 'Usuários', icone: 'pessoas' },
  { id: 'telas', label: 'Telas', icone: 'tela' },
  { id: 'datas', label: 'Datas', icone: 'calendario' },
  { id: 'ia', label: 'Provedor de IA', icone: 'ia' },
];

export default function Configuracoes() {
  const { ehAdmin } = useSession();
  const [aba, setAba] = useState('usuarios');

  if (!ehAdmin) {
    return (
      <div className="page">
        <div className="tela-negada">
          <Icone nome="cadeado" tamanho={30} />
          <h2>Tela restrita</h2>
          <p>Configurações é área de administradores.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <Visual className="v-auto" title="Configurações" sub="Acessos, recorte de datas e provedor de IA">
        <div className="cfg-abas">
          {ABAS.map((a) => (
            <button key={a.id} type="button" className={aba === a.id ? 'on' : ''} onClick={() => setAba(a.id)}>
              <Icone nome={a.icone} tamanho={13} /> {a.label}
            </button>
          ))}
        </div>

        {aba === 'usuarios' && <AbaUsuarios />}
        {aba === 'telas' && <AbaTelas />}
        {aba === 'datas' && <AbaDatas />}
        {aba === 'ia' && <AbaIA />}
      </Visual>
    </div>
  );
}
