const CAMINHOS = {
  alerta: 'M12 2 1 21h22L12 2Zm0 6v6m0 3.5h.01',
  relogio: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-14v5l3.5 2',
  baixar: 'M12 3v12m0 0-4-4m4 4 4-4M4 20h16',
  cima: 'M6 14 12 8l6 6',
  baixo: 'M6 10 12 16l6-6',
  cadeado: 'M6 11V8a6 6 0 1 1 12 0v3m-14 0h16v9H4v-9Z',
  ok: 'm4 12 6 6L20 6',
  fechar: 'm6 6 12 12M18 6 6 18',
  calendario: 'M7 3v3m10-3v3M4 8h16M5 6h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z',
};

export function Icone({ nome, tamanho = 14, className }) {
  const d = CAMINHOS[nome];
  if (!d) return null;
  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d={d} />
    </svg>
  );
}
