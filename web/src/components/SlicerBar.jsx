import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { useMeta } from '../api';
import { Icone } from './Icone';

/** Acima disso o popover ancorado não serve: vira diálogo centralizado. */
const LIMITE_POPOVER = 12;

/**
 * Os filtros vivem na URL, não em estado local: o link continua compartilhável, o
 * botão voltar desfaz a escolha e o cross-filter de um visual escreve no mesmo lugar.
 */
export function useFiltros(padroes = {}) {
  const [params, setParams] = useSearchParams();

  /**
   * `assinatura` entra na dependência do memo porque os padrões deixaram de ser
   * constantes: o período padrão vem do servidor (`usePeriodoPadrao`), e chega
   * uma volta depois da primeira renderização. Com a dependência só em `params`,
   * a tela congelava no valor de fábrica e a configuração de "período padrão"
   * não tinha efeito nenhum — um controle que não fazia nada.
   */
  const assinatura = JSON.stringify(padroes);

  const valores = useMemo(() => {
    const v = { ...padroes };
    for (const [k, valor] of params.entries()) v[k] = valor;
    return v;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, assinatura]);

  const definir = (chave, valor) => {
    const novo = new URLSearchParams(params);
    if (valor === null || valor === undefined || valor === '' || (Array.isArray(valor) && !valor.length)) {
      novo.delete(chave);
    } else {
      novo.set(chave, Array.isArray(valor) ? valor.join(',') : String(valor));
    }
    setParams(novo, { replace: false });
  };

  const limpar = () => setParams(new URLSearchParams());

  const lista = (chave) => (valores[chave] ? String(valores[chave]).split(',').filter(Boolean) : []);

  return { valores, definir, limpar, lista, temFiltro: [...params.keys()].length > 0 };
}

function Marcadores({ opcoes, marcados, alternar, busca }) {
  const filtradas = busca
    ? opcoes.filter((o) => String(o).toLowerCase().includes(busca.toLowerCase()))
    : opcoes;
  if (!filtradas.length) return <div className="nada">Nenhum valor encontrado</div>;
  return filtradas.map((o) => (
    <label key={o}>
      <input type="checkbox" checked={marcados.includes(o)} onChange={() => alternar(o)} />
      <span title={o}>{o}</span>
    </label>
  ));
}

/** Um filtro de lista. Popover para listas curtas, diálogo para as longas. */
export function Filtro({ nome, opcoes = [], marcados = [], onChange }) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const [rascunho, setRascunho] = useState(marcados);
  const ref = useRef(null);
  const usaDialogo = opcoes.length > LIMITE_POPOVER;

  useEffect(() => setRascunho(marcados), [marcados.join(',')]);

  useEffect(() => {
    if (!aberto || usaDialogo) return undefined;
    const fora = (e) => { if (ref.current && !ref.current.contains(e.target)) setAberto(false); };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [aberto, usaDialogo]);

  useEffect(() => {
    if (!aberto) return undefined;
    const esc = (e) => { if (e.key === 'Escape') setAberto(false); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [aberto]);

  const alternarPopover = (o) => {
    const novo = marcados.includes(o) ? marcados.filter((x) => x !== o) : [...marcados, o];
    onChange(novo);
  };
  const alternarRascunho = (o) => {
    setRascunho((r) => (r.includes(o) ? r.filter((x) => x !== o) : [...r, o]));
  };

  const rotulo = marcados.length === 1 ? marcados[0] : marcados.length ? `${marcados.length} selecionados` : 'Todos';

  const abrir = () => { setRascunho(marcados); setBusca(''); setAberto(true); };

  return (
    <div className={`filtro${marcados.length ? ' ativo' : ''}`} ref={ref}>
      <button type="button" onClick={() => (aberto ? setAberto(false) : abrir())}>
        <span className="nome">{nome}</span>
        <span className="valor">{rotulo}</span>
        {marcados.length > 1 && <span className="contador">{marcados.length}</span>}
        <span className="seta">▾</span>
      </button>

      {aberto && !usaDialogo && (
        <div className="pop">
          <div className="lista">
            <Marcadores opcoes={opcoes} marcados={marcados} alternar={alternarPopover} busca="" />
          </div>
          <div className="acoes">
            <span>{marcados.length ? `${marcados.length} de ${opcoes.length}` : `${opcoes.length} valores`}</span>
            <button type="button" onClick={() => onChange([])}>Limpar</button>
          </div>
        </div>
      )}

      {aberto && usaDialogo && createPortal(
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setAberto(false)}>
          <div className="dialogo" role="dialog" aria-label={nome}>
            <header>
              {nome}
              <button type="button" className="fechar" onClick={() => setAberto(false)} title="Fechar">
                <Icone nome="fechar" tamanho={15} />
              </button>
            </header>
            <input
              className="busca-dialogo"
              placeholder="Buscar…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              autoFocus
            />
            <div className="itens">
              <Marcadores opcoes={opcoes} marcados={rascunho} alternar={alternarRascunho} busca={busca} />
            </div>
            <footer>
              <span className="contagem">{rascunho.length} de {opcoes.length} selecionados</span>
              <button type="button" onClick={() => setRascunho([])}>Limpar</button>
              <button type="button" className="principal" onClick={() => { onChange(rascunho); setAberto(false); }}>
                Aplicar
              </button>
            </footer>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

const hoje = () => new Date();
const iso = (d) => d.toISOString().slice(0, 10);
const menosDias = (n) => new Date(Date.now() - n * 864e5);

const PRESETS = [
  { id: '7d', label: 'Últimos 7 dias', de: () => iso(menosDias(6)), ate: () => iso(hoje()) },
  { id: '30d', label: 'Últimos 30 dias', de: () => iso(menosDias(29)), ate: () => iso(hoje()) },
  {
    id: 'mes',
    label: 'Este mês',
    de: () => iso(new Date(hoje().getFullYear(), hoje().getMonth(), 1)),
    ate: () => iso(hoje()),
  },
  {
    id: 'mespassado',
    label: 'Mês passado',
    de: () => iso(new Date(hoje().getFullYear(), hoje().getMonth() - 1, 1)),
    ate: () => iso(new Date(hoje().getFullYear(), hoje().getMonth(), 0)),
  },
];

/** Período com presets — quase ninguém quer digitar data. */
export function FiltroPeriodo({ de, ate, onChange }) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!aberto) return undefined;
    const fora = (e) => { if (ref.current && !ref.current.contains(e.target)) setAberto(false); };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [aberto]);

  const rotulo = `${de.split('-').reverse().join('/')} — ${ate.split('-').reverse().join('/')}`;

  return (
    <div className="filtro ativo" ref={ref}>
      <button type="button" onClick={() => setAberto((a) => !a)}>
        <span className="nome">Data</span>
        <span className="valor" style={{ maxWidth: 180 }}>{rotulo}</span>
        <span className="seta">▾</span>
      </button>
      {aberto && (
        <div className="pop pop-periodo">
          <div className="datas">
            <input type="date" value={de} max={ate} onChange={(e) => onChange(e.target.value, ate)} />
            <span>até</span>
            <input type="date" value={ate} min={de} onChange={(e) => onChange(de, e.target.value)} />
          </div>
          <div className="presets">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={de === p.de() && ate === p.ate() ? 'on' : ''}
                onClick={() => { onChange(p.de(), p.ate()); setAberto(false); }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Período com que a tela abre.
 *
 * Vem do servidor (`/meta` → `periodo.padraoDias`), definido em Configurações →
 * Datas. Era uma constante de 30 dias aqui, e isso tornava a configuração
 * decorativa: o admin salvava 90 dias, o servidor passava a aceitar 90, e as
 * telas continuavam pedindo 30 porque mandavam `de`/`ate` explícitos calculados
 * deste lado.
 *
 * Os 30 dias seguem como valor de fábrica para a primeira renderização, antes de
 * `/meta` responder — é o mesmo padrão de `params.js`, então na configuração de
 * fábrica nada pisca.
 */
export function usePeriodoPadrao() {
  const { data: meta } = useMeta();
  const dias = meta?.periodo?.padraoDias || 30;
  return useMemo(() => ({ de: iso(menosDias(dias - 1)), ate: iso(hoje()) }), [dias]);
}
