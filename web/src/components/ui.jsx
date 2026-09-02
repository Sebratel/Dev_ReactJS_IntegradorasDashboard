import { Icone } from './Icone';

export function Visual({ title, sub, children, flush = false, style, actions, className = 'v-grafico' }) {
  return (
    <section className={`visual ${className}`} style={style}>
      {title && (
        <header>
          <span className="titulo">
            <span>{title}</span>
            {actions}
          </span>
          {sub && <span className="sub">{sub}</span>}
        </header>
      )}
      <div className={`body${flush ? ' flush' : ''}`}>{children}</div>
    </section>
  );
}

export function Segmentado({ valor, opcoes, onChange, titulo }) {
  return (
    <span className="seg" title={titulo}>
      {opcoes.map((o) => (
        <button key={o.id} type="button" className={valor === o.id ? 'on' : ''} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </span>
  );
}

/**
 * `desc` é opcional: uma linha dizendo o que o número mede — nome de KPI raramente
 * basta ("adesão" pode ser lida como % de protocolos ou % de atendimentos).
 */
export function Kpi({ value, label, small = false, desc = null, title = null }) {
  return (
    <div className="kpi" title={title || undefined}>
      <div className={`value${small ? ' sm' : ''}`}>{value}</div>
      <div className="label">{label}</div>
      {desc && <div className="desc">{desc}</div>}
    </div>
  );
}

export function KpiStack({ itens }) {
  return (
    <div className="kpi-stack">
      {itens.map((i) => (
        <Kpi key={i.label} value={i.value} label={i.label} small={i.small} desc={i.desc} title={i.title} />
      ))}
    </div>
  );
}

export function Loading({ texto = 'Carregando…' }) {
  return (
    <div className="loading">
      <div className="spinner" />
      <span>{texto}</span>
    </div>
  );
}

export function Vazio({ texto = 'Sem dados para os filtros selecionados' }) {
  return <div className="empty">{texto}</div>;
}

export function Erro({ erro }) {
  const msg = String(erro?.message || erro);
  return (
    <div className={`banner${erro?.status === 503 ? '' : ' error'}`}>
      <Icone nome={erro?.status === 503 ? 'relogio' : 'alerta'} tamanho={14} />
      {msg}
    </div>
  );
}

/**
 * Marcadores de série. Com `onSelect`, cada item vira botão e filtra a tela (cross-
 * filter, igual à legenda do Power BI); `selecionados` acende o que está filtrando.
 */
export function Legenda({ itens, onSelect = null, selecionados = [] }) {
  const temSelecao = selecionados.length > 0;
  return (
    <div className="legend">
      {itens.map((i) => {
        const marcador = <i style={{ background: i.cor, borderRadius: i.linha ? 8 : 2, height: i.linha ? 3 : 11 }} />;
        if (!onSelect || i.semFiltro) {
          return <span key={i.label}>{marcador}{i.label}</span>;
        }
        const chave = i.valor ?? i.label;
        const aceso = selecionados.includes(chave);
        return (
          <button
            key={i.label}
            type="button"
            className={temSelecao ? (aceso ? 'on' : 'off') : ''}
            onClick={() => onSelect(chave)}
            title={aceso ? `Remover o filtro ${chave}` : `Filtrar a tela por ${chave}`}
          >
            {marcador}
            {i.label}
          </button>
        );
      })}
    </div>
  );
}

export function BotaoExportar({ onExportar, titulo = 'Exportar em CSV', rotulo = 'CSV' }) {
  return (
    <button type="button" className="btn-exportar" onClick={onExportar} title={titulo}>
      <Icone nome="baixar" tamanho={13} />
      {rotulo}
    </button>
  );
}
