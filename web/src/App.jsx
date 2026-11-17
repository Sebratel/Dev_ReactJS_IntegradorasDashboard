import { useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAtualizarAgora, useHealth, useMeta } from './api';
import { useSession } from './auth/session.jsx';
import LoginPage from './auth/LoginPage.jsx';
import { Capa } from './pages/Capa';
import { Matrix } from './pages/Matrix';
import { Native } from './pages/Native';
import { CsatMatrix, CsatNative } from './pages/Csat';
import { Produtividade } from './pages/Produtividade';
import { Quartis } from './pages/Quartis';
import { SupExecutivo } from './pages/SupExecutivo';
import { SupMatrix, SupNative } from './pages/SupPlataforma';
import { AnaliticoAtendimento, AnaliticoCx, AnaliticoHsm } from './pages/Analiticos';
import Configuracoes from './pages/Configuracoes';
import { Loading } from './components/ui';
import { Icone } from './components/Icone';
import { dataBr, haQuanto, horaBr, labelDataHora } from './format';

/**
 * O dashboard hospeda TRÊS relatórios do Power BI, e dois deles têm páginas de
 * mesmo nome (CAPA, MATRIX e NATIVE existem no GERAL e no SUP, com conteúdo
 * diferente). Daí o alternador de relatório: cada um mantém os nomes que o time
 * já conhece, sem "Matrix" repetido na mesma barra.
 *
 * O alternador fica dentro da faixa de navegação (ver `Navegacao`), e não numa
 * faixa própria, porque altura é o recurso escasso: uma terceira faixa sai direto
 * da área útil dos visuais, e em 1366x768 isso já aperta. Ordem das abas = ordem
 * de leitura do `pages.json` de cada relatório.
 *
 * O `tela` de cada página é o id do ACL (ver `server/src/auth/access.js`): é por
 * ele que a navegação esconde o que a pessoa não pode abrir. Esconder o item NÃO
 * é o que protege o dado — cada endpoint confere a permissão de novo.
 */
const RELATORIOS = [
  /**
   * A CAPA é um relatório de uma tela só, e não a primeira página de cada
   * relatório como no Power BI. Decisão do usuário em 08/09/2026: uma capa para
   * todo o dashboard, porque os três relatórios respondem à mesma pergunta em
   * canais diferentes. Sem `paginas` de sub-navegação — a faixa de telas
   * desaparece nela, que é o certo para uma tela única.
   */
  {
    id: 'capa',
    label: 'Capa',
    titulo: 'Atendimento ao Cliente · Suporte Técnico',
    paginas: [
      { path: '/capa', label: 'Capa', tela: 'capa', fim: true },
    ],
  },
  {
    id: 'geral',
    label: 'Geral',
    titulo: 'GERAL - Relatórios Detalhados Integradoras',
    paginas: [
      { path: '/geral/matrix', label: 'Matrix', tela: 'geral-matrix' },
      { path: '/geral/csat-matrix', label: 'CSAT Matrix', tela: 'geral-csat-matrix' },
      { path: '/geral/native', label: 'Native', tela: 'geral-native' },
      { path: '/geral/csat-native', label: 'CSAT Native', tela: 'geral-csat-native' },
      { path: '/geral/produtividade', label: 'Produtividade', tela: 'geral-produtividade' },
      { path: '/geral/quartis', label: 'Quartis', tela: 'geral-quartis' },
    ],
  },
  {
    id: 'sup',
    label: 'Suporte',
    titulo: 'SUP - Indicadores Suporte',
    paginas: [
      { path: '/sup/matrix', label: 'Matrix', tela: 'sup-matrix' },
      { path: '/sup/native', label: 'Native', tela: 'sup-native' },
      { path: '/sup/executivo', label: 'Report Executivo', tela: 'sup-executivo' },
    ],
  },
  {
    // Não vêm de .pbip: são os relatórios que a aplicação dev_ReactJs_DashboardUX
    // mostra hoje raspando a web do MatrixGO e chamando a API do Data Hub. Aqui
    // saem direto do banco, que é onde já estavam.
    id: 'analiticos',
    label: 'Analíticos',
    titulo: 'Relatórios Analíticos de Atendimento e HSM',
    paginas: [
      { path: '/analiticos', label: 'Atendimento', tela: 'analiticos-atendimento', fim: true },
      { path: '/analiticos/hsm', label: 'Mensagens HSM', tela: 'analiticos-hsm' },
      { path: '/analiticos/cx', label: 'CX Pós-Instalação', tela: 'analiticos-cx' },
    ],
  },
];

const ROTAS = [
  { path: '/capa', tela: 'capa', el: <Capa /> },
  { path: '/geral/matrix', tela: 'geral-matrix', el: <Matrix /> },
  { path: '/geral/csat-matrix', tela: 'geral-csat-matrix', el: <CsatMatrix /> },
  { path: '/geral/native', tela: 'geral-native', el: <Native /> },
  { path: '/geral/csat-native', tela: 'geral-csat-native', el: <CsatNative /> },
  { path: '/geral/produtividade', tela: 'geral-produtividade', el: <Produtividade /> },
  { path: '/geral/quartis', tela: 'geral-quartis', el: <Quartis /> },
  { path: '/sup/matrix', tela: 'sup-matrix', el: <SupMatrix /> },
  { path: '/sup/native', tela: 'sup-native', el: <SupNative /> },
  { path: '/sup/executivo', tela: 'sup-executivo', el: <SupExecutivo /> },
  { path: '/analiticos', tela: 'analiticos-atendimento', el: <AnaliticoAtendimento /> },
  { path: '/analiticos/hsm', tela: 'analiticos-hsm', el: <AnaliticoHsm /> },
  { path: '/analiticos/cx', tela: 'analiticos-cx', el: <AnaliticoCx /> },
];

function relatorioDaRota(pathname, relatorios) {
  return relatorios.find((r) => pathname === `/${r.id}` || pathname.startsWith(`/${r.id}/`)) || relatorios[0];
}

function MenuUsuario() {
  const { usuario, sair, ehAdmin } = useSession();
  const [aberto, setAberto] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!aberto) return undefined;
    const fora = (e) => { if (ref.current && !ref.current.contains(e.target)) setAberto(false); };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [aberto]);

  if (!usuario) return null;
  const inicial = (usuario.nome || usuario.email || '?').trim().charAt(0).toUpperCase();

  return (
    <div className="usermenu" ref={ref}>
      <button type="button" onClick={() => setAberto((a) => !a)} title={usuario.email}>
        {usuario.foto
          ? <img src={usuario.foto} alt="" referrerPolicy="no-referrer" />
          : <span className="inicial">{inicial}</span>}
        <span className="nome">{(usuario.nome || '').split(' ')[0]}</span>
        {usuario.papel !== 'viewer' && <span className="papel">{usuario.papel}</span>}
      </button>

      {aberto && (
        <div className="usermenu-pop">
          <div className="quem">
            <b>{usuario.nome}</b>
            <span>{usuario.email}</span>
          </div>
          {ehAdmin && (
            <NavLink to="/configuracoes" onClick={() => setAberto(false)} className="com-icone">
              <Icone nome="config" tamanho={13} /> Configurações
            </NavLink>
          )}
          <button type="button" className="sair" onClick={() => { setAberto(false); sair(); }}>
            <Icone nome="sair" tamanho={13} /> Sair
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Sigla do sistema, como no painel da Manutenção ("MAN · MANUTENÇÃO FTTX"): o topo
 * diz em que sistema a pessoa está, e o título do meio diz em que TELA.
 */
const SISTEMA = 'INT · RELATÓRIOS INTEGRADORAS';

/**
 * Título do meio do topo = relatório · tela ("Geral · Matrix"). O nome longo do
 * relatório de origem ("GERAL - Relatórios Detalhados Integradoras") fica no
 * `title`, para quem procura pelo nome do Power BI.
 */
function tituloDaTela(pathname, relatorio) {
  if (pathname === '/configuracoes') return { texto: 'Configurações', dica: null };
  const pagina = relatorio.paginas.find((p) => (p.fim ? pathname === p.path : pathname.startsWith(p.path)));
  if (!pagina) return { texto: relatorio.titulo, dica: null };
  if (relatorio.paginas.length === 1) return { texto: pagina.label, dica: relatorio.titulo };
  return { texto: `${relatorio.label} · ${pagina.label}`, dica: relatorio.titulo };
}

function Topbar({ relatorio }) {
  const { pathname } = useLocation();
  const { isError } = useHealth();
  const { data: meta } = useMeta();
  const atualizar = useAtualizarAgora();
  const ultimo = meta?.ultimoDado;
  const titulo = tituloDaTela(pathname, relatorio);

  return (
    <header className="topbar">
      <NavLink to="/capa" className="logo" title="Ir para a Capa">
        <img src="/logo-circular-sebratel.png" alt="Sebratel" />
        <span>{SISTEMA}</span>
      </NavLink>

      <h1 title={titulo.dica || undefined}>{titulo.texto}</h1>

      <div className="updated" title={ultimo ? `Registro mais recente: ${labelDataHora(ultimo)}` : undefined}>
        <span className={`live-dot${isError ? ' error' : ultimo ? '' : ' stale'}`} />
        {isError ? 'API indisponível' : ultimo ? <>dado <b>{dataBr(ultimo)} {horaBr(ultimo)}</b></> : 'conectando…'}
        <button
          type="button"
          className="icon-btn"
          title="Atualizar agora — descarta o cache de consultas do servidor"
          disabled={atualizar.isPending}
          onClick={() => atualizar.mutate()}
        >
          <span className={atualizar.isPending ? 'spin' : ''}><Icone nome="atualizar" tamanho={14} /></span>
        </button>
      </div>

      <MenuUsuario />
    </header>
  );
}

/**
 * Navegação numa faixa só, alinhada à esquerda, como no painel da Manutenção:
 *
 *   CAPA │ [Geral | Suporte | Analíticos] │ MATRIX  CSAT MATRIX  NATIVE …   ⚙ CONFIGURAÇÕES
 *
 * Os três relatórios continuam separados — dois deles têm telas de mesmo nome —,
 * mas o alternador virou um controle segmentado dentro da navegação em vez de uma
 * faixa escura própria. A faixa custava 40px de altura útil em toda tela.
 *
 * Relatório sem tela liberada já saiu da lista antes de chegar aqui; com um
 * relatório só, o alternador some e sobram as telas dele.
 */
function Navegacao({ relatorio, relatorios }) {
  const { ehAdmin } = useSession();
  const capa = relatorios.find((r) => r.id === 'capa');
  const outros = relatorios.filter((r) => r.id !== 'capa');
  const telas = relatorio.id !== 'capa' && relatorio.paginas.length > 1 ? relatorio.paginas : [];

  if (!relatorios.length && !ehAdmin) return null;

  return (
    <nav className="pagenav" aria-label="Telas do painel">
      {capa && (
        <NavLink to={capa.paginas[0].path} className={({ isActive }) => (isActive ? 'active' : '')}>
          {capa.label}
        </NavLink>
      )}

      {outros.length > 1 && (
        <span className="relatorios" role="group" aria-label="Relatório">
          {outros.map((r) => (
            <NavLink
              key={r.id}
              to={r.paginas[0]?.path || `/${r.id}`}
              className={r.id === relatorio.id ? 'on' : ''}
              aria-current={r.id === relatorio.id ? 'true' : undefined}
              title={r.titulo}
            >
              {r.label}
            </NavLink>
          ))}
        </span>
      )}

      {telas.length > 0 && <span className="divisor" aria-hidden="true" />}
      {telas.map((p) => (
        <NavLink key={p.path} to={p.path} end={p.fim} className={({ isActive }) => (isActive ? 'active' : '')}>
          {p.label}
        </NavLink>
      ))}

      {!relatorios.length && (
        <span className="pagenav-vazio">Nenhuma tela está liberada para você.</span>
      )}

      {ehAdmin && (
        <NavLink to="/configuracoes" className={({ isActive }) => `com-icone a-direita${isActive ? ' active' : ''}`}>
          <Icone nome="config" tamanho={13} /> Configurações
        </NavLink>
      )}
    </nav>
  );
}

/** Rota de uma tela sem permissão: mensagem em vez de erro cru da API. */
function SemAcesso() {
  return (
    <div className="page">
      <div className="tela-negada">
        <Icone nome="cadeado" tamanho={30} />
        <h2>Tela restrita</h2>
        <p>Você não tem permissão para ver esta tela. Peça a liberação a um administrador.</p>
      </div>
    </div>
  );
}

export default function App() {
  const { pathname } = useLocation();
  const { usuario, carregando, podeVer, ehAdmin } = useSession();

  if (carregando) {
    return <div style={{ height: '100vh' }}><Loading texto="Carregando sessão…" /></div>;
  }
  if (!usuario) return <LoginPage />;

  /**
   * Relatório sem nenhuma tela liberada sai da faixa por inteiro, em vez de virar
   * uma aba que abre vazia. Um relatório inteiro fechado é caso comum aqui — quem
   * cuida só dos Analíticos não precisa ver as abas do SUP.
   */
  const relatorios = RELATORIOS
    .map((r) => ({ ...r, paginas: r.paginas.filter((p) => podeVer(p.tela)) }))
    .filter((r) => r.paginas.length);

  const relatorio = relatorios.length
    ? relatorioDaRota(pathname, relatorios)
    : { id: 'vazio', titulo: 'Sem telas liberadas', paginas: [] };

  const inicial = relatorios[0]?.paginas[0]?.path || (ehAdmin ? '/configuracoes' : null);

  return (
    <>
      <Topbar relatorio={relatorio} />
      <Navegacao relatorio={relatorio} relatorios={relatorios} />
      <Routes>
        {ROTAS.map((r) => (
          <Route key={r.path} path={r.path} element={podeVer(r.tela) ? r.el : <SemAcesso />} />
        ))}
        <Route path="/configuracoes" element={ehAdmin ? <Configuracoes /> : <SemAcesso />} />
        <Route path="*" element={inicial ? <Navigate to={inicial} replace /> : <SemAcesso />} />
      </Routes>
    </>
  );
}
