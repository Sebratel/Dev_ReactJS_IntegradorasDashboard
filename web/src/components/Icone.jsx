/**
 * Ícones em SVG traçado (sem emojis, sem dependência externa).
 * Uso: <Icone nome="alerta" /> — herda a cor do texto via currentColor.
 *
 * Os valores passaram de string para elemento JSX quando entraram os ícones
 * compostos (config, ia, pessoas): eles precisam de mais de um traço, e
 * `<path d={...}/>` só desenha um. Os caminhos simples continuam iguais, então
 * nenhum uso existente muda de desenho.
 */
const CAMINHOS = {
  alerta: <path d="M12 2 1 21h22L12 2Zm0 6v6m0 3.5h.01" />,
  relogio: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-14v5l3.5 2" />,
  baixar: <path d="M12 3v12m0 0-4-4m4 4 4-4M4 20h16" />,
  cima: <path d="M6 14 12 8l6 6" />,
  baixo: <path d="M6 10 12 16l6-6" />,
  cadeado: <path d="M6 11V8a6 6 0 1 1 12 0v3m-14 0h16v9H4v-9Z" />,
  ok: <path d="m4 12 6 6L20 6" />,
  fechar: <path d="m6 6 12 12M18 6 6 18" />,
  calendario: <path d="M7 3v3m10-3v3M4 8h16M5 6h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z" />,
  atualizar: <><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 3v6h-6" /></>,
  config: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.35.4.65.73.85" /></>,
  ia: <><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /><rect x="6.5" y="6.5" width="11" height="11" rx="2.5" /><circle cx="12" cy="12" r="2" /></>,
  pessoas: <><circle cx="9" cy="8" r="3.2" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16.5 5.3a3.2 3.2 0 0 1 0 5.4M18 20a6.5 6.5 0 0 0-2.2-4.9" /></>,
  tela: <><rect x="2.5" y="4" width="19" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></>,
  sair: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></>,
  busca: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  mais: <path d="M12 5v14M5 12h14" />,
  interrogacao: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.2a2.6 2.6 0 0 1 5 .8c0 1.7-2.5 2-2.5 3.5M12 17h.01" /></>,
  play: <path d="M6 4v16l13-8-13-8Z" />,
};

export function Icone({ nome, tamanho = 14, className, style, strokeWidth = 2 }) {
  const d = CAMINHOS[nome];
  if (!d) return null;
  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      {d}
    </svg>
  );
}
