import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useHealth, useMeta } from './api';
import { Capa } from './pages/Capa';
import { Matrix } from './pages/Matrix';
import { Native } from './pages/Native';
import { dataBr, horaBr } from './format';

// Ordem de leitura do relatório de origem (pages.json), não ordem alfabética.
const PAGINAS = [
  { path: '/', label: 'Capa' },
  { path: '/matrix', label: 'Matrix' },
  { path: '/native', label: 'Native' },
  // CSAT MATRIX, CSAT NATIVE, PRODUTIVIDADE e QUARTIS entram aqui conforme cada
  // tela fica pronta — nada de aba para tela que não existe.
];

function Topbar() {
  const { isError } = useHealth();
  const { data: meta } = useMeta();
  const ultimo = meta?.ultimoDado;

  return (
    <header className="topbar">
      <div className="logo">
        <img src="/logo-circular-sebratel.png" alt="Sebratel" />
        <span>SEBRATEL</span>
      </div>
      <h1>GERAL - Relatórios Detalhados Integradoras</h1>
      <div className="updated" title="Registro mais recente na base do Native">
        <span className={`live-dot${isError ? ' error' : ultimo ? '' : ' stale'}`} />
        {isError ? 'API indisponível' : ultimo ? <>dado mais recente <b>{dataBr(ultimo)} {horaBr(ultimo)}</b></> : 'conectando…'}
      </div>
    </header>
  );
}

function PageNav() {
  return (
    <nav className="pagenav">
      {PAGINAS.map((p) => (
        <NavLink key={p.path} to={p.path} end={p.path === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
          {p.label}
        </NavLink>
      ))}
    </nav>
  );
}

export default function App() {
  return (
    <>
      <Topbar />
      <PageNav />
      <Routes>
        <Route path="/" element={<Capa />} />
        <Route path="/matrix" element={<Matrix />} />
        <Route path="/native" element={<Native />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
