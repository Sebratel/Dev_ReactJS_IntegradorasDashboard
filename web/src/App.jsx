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
import { CapaSup } from './pages/CapaSup';
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
 * O alternador fica na barra do topo, e não numa faixa própria, porque altura é o
 * recurso escasso: uma terceira faixa sairia direto da área útil dos visuais, e em
 * 1366x768 isso já aperta. Ordem das abas = ordem de leitura do `pages.json` de
 * cada relatório.
 *
 * O `tela` de cada página é o id do ACL (ver `server/src/auth/access.js`): é por
 * ele que a navegação esconde o que a pessoa não pode abrir. Esconder o item NÃO
 * é o que protege o dado — cada endpoint confere a permissão de novo.
 */
const RELATORIOS = [
  {
    id: 'geral',
    label: 'Geral',
    titulo: 'GERAL - Relatórios Detalhados Integradoras',
    paginas: [
      { path: '/geral', label: 'Capa', tela: 'geral-capa', fim: true },
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
      { path: '/sup', label: 'Capa', tela: 'sup-capa', fim: true },
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
  { path: '/geral', tela: 'geral-capa', el: <Capa /> },
  { path: '/geral/matrix', tela: 'geral-matrix', el: <Matrix /> },
  { path: '/geral/csat-matrix', tela: 'geral-csat-matrix', el: <CsatMatrix /> },
  { path: '/geral/native', tela: 'geral-native', el: <Native /> },
  { path: '/geral/csat-native', tela: 'geral-csat-native', el: <CsatNative /> },
  { path: '/geral/produtividade', tela: 'geral-produtividade', el: <Produtividade /> },
  { path: '/geral/quartis', tela: 'geral-quartis', el: <Quartis /> },
  { path: '/sup', tela: 'sup-capa', el: <CapaSup /> },
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

function Topbar({ relatorio }) {
  const { isError } = useHealth();
  const { data: meta } = useMeta();
  const atualizar = useAtualizarAgora();
  const ultimo = meta?.ultimoDado;

  return (
    <header className="topbar">
      <div className="logo">
        <img src="/logo-circular-sebratel.png" alt="Sebratel" />
        <span>SEBRATEL</span>
      </div>

      <h1>{relatorio.titulo}</h1>

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
 * Faixa dos relatórios. Ela existe porque três relatórios diferentes convivem no
 * mesmo dashboard e dois deles têm páginas de mesmo nome — a separação precisa ser
 * estrutural, não um controle discreto no canto. A contagem ao lado do nome dá a
 * dimensão de cada bloco antes de entrar nele.
 */
function BarraRelatorios({ relatorio, relatorios }) {
  return (
    <nav className="barra-relatorios" aria-label="Relatórios">
      {relatorios.map((r) => (
        <NavLink
          key={r.id}
          to={r.paginas[0]?.path || `/${r.id}`}
          className={r.id === relatorio.id ? 'on' : ''}
        >
          {r.label}
          <span className="quantas">{r.paginas.length}</span>
        </NavLink>
      ))}
    </nav>
  );
}

function PageNav({ relatorio }) {
  const { ehAdmin } = useSession();
  if (!relatorio.paginas.length) {
    return (
      <nav className="pagenav">
        <span className="pagenav-vazio">Nenhuma tela deste relatório está liberada para você.</span>
      </nav>
    );
  }
  return (
    <nav className="pagenav">
      {relatorio.paginas.map((p) => (
        <NavLink key={p.path} to={p.path} end={p.fim} className={({ isActive }) => (isActive ? 'active' : '')}>
          {p.label}
        </NavLink>
      ))}
      {ehAdmin && (
        <NavLink to="/configuracoes" className={({ isActive }) => `com-icone${isActive ? ' active' : ''}`}>
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
      {relatorios.length > 1 && <BarraRelatorios relatorio={relatorio} relatorios={relatorios} />}
      <PageNav relatorio={relatorio} />
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
