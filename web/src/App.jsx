import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useHealth, useMeta } from './api';
import { Capa } from './pages/Capa';
import { Matrix } from './pages/Matrix';
import { Native } from './pages/Native';
import { CsatMatrix, CsatNative } from './pages/Csat';
import { Produtividade } from './pages/Produtividade';
import { Quartis } from './pages/Quartis';
import { CapaSup } from './pages/CapaSup';
import { SupExecutivo } from './pages/SupExecutivo';
import { dataBr, horaBr } from './format';

/**
 * O dashboard hospeda DOIS relatórios do Power BI, e os dois têm páginas de mesmo
 * nome (CAPA, MATRIX e NATIVE existem nos dois, com conteúdo diferente). Daí o
 * alternador de relatório: cada um mantém os nomes que o time já conhece, sem
 * "Matrix" repetido na mesma barra.
 *
 * O alternador fica na barra do topo, e não numa faixa própria, porque altura é o
 * recurso escasso: uma terceira faixa sairia direto da área útil dos visuais, e em
 * 1366x768 isso já aperta. Ordem das abas = ordem de leitura do `pages.json` de
 * cada relatório.
 */
const RELATORIOS = [
  {
    id: 'geral',
    label: 'Geral',
    titulo: 'GERAL - Relatórios Detalhados Integradoras',
    paginas: [
      { path: '/geral', label: 'Capa', fim: true },
      { path: '/geral/matrix', label: 'Matrix' },
      { path: '/geral/csat-matrix', label: 'CSAT Matrix' },
      { path: '/geral/native', label: 'Native' },
      { path: '/geral/csat-native', label: 'CSAT Native' },
      { path: '/geral/produtividade', label: 'Produtividade' },
      { path: '/geral/quartis', label: 'Quartis' },
    ],
  },
  {
    id: 'sup',
    label: 'Suporte',
    titulo: 'SUP - Indicadores Suporte',
    paginas: [
      { path: '/sup', label: 'Capa', fim: true },
      { path: '/sup/executivo', label: 'Report Executivo' },
      // MATRIX e NATIVE do SUP entram aqui conforme ficam prontos
    ],
  },
];

function relatorioDaRota(pathname) {
  return RELATORIOS.find((r) => pathname === `/${r.id}` || pathname.startsWith(`/${r.id}/`)) || RELATORIOS[0];
}

function Topbar({ relatorio }) {
  const { isError } = useHealth();
  const { data: meta } = useMeta();
  const ultimo = meta?.ultimoDado;

  return (
    <header className="topbar">
      <div className="logo">
        <img src="/logo-circular-sebratel.png" alt="Sebratel" />
        <span>SEBRATEL</span>
      </div>

      <h1>{relatorio.titulo}</h1>

      <span className="seg seg-relatorio" title="Relatório">
        {RELATORIOS.map((r) => (
          <NavLink
            key={r.id}
            to={r.paginas[0]?.path || `/${r.id}`}
            className={r.id === relatorio.id ? 'on' : ''}
          >
            {r.label}
          </NavLink>
        ))}
      </span>

      <div className="updated" title="Registro mais recente na base do Native">
        <span className={`live-dot${isError ? ' error' : ultimo ? '' : ' stale'}`} />
        {isError ? 'API indisponível' : ultimo ? <>dado <b>{dataBr(ultimo)} {horaBr(ultimo)}</b></> : 'conectando…'}
      </div>
    </header>
  );
}

function PageNav({ relatorio }) {
  if (!relatorio.paginas.length) {
    return (
      <nav className="pagenav">
        <span className="pagenav-vazio">Nenhuma tela deste relatório foi construída ainda.</span>
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
    </nav>
  );
}

export default function App() {
  const { pathname } = useLocation();
  const relatorio = relatorioDaRota(pathname);

  return (
    <>
      <Topbar relatorio={relatorio} />
      <PageNav relatorio={relatorio} />
      <Routes>
        <Route path="/geral" element={<Capa />} />
        <Route path="/geral/matrix" element={<Matrix />} />
        <Route path="/geral/csat-matrix" element={<CsatMatrix />} />
        <Route path="/geral/native" element={<Native />} />
        <Route path="/geral/csat-native" element={<CsatNative />} />
        <Route path="/geral/produtividade" element={<Produtividade />} />
        <Route path="/geral/quartis" element={<Quartis />} />
        <Route path="/sup" element={<CapaSup />} />
        <Route path="/sup/executivo" element={<SupExecutivo />} />
        <Route path="*" element={<Navigate to="/geral" replace />} />
      </Routes>
    </>
  );
}
