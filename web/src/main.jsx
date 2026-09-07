import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { SessionProvider } from './auth/session.jsx';
import './theme.css';
import './config.css';
import './insights.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: true, retry: 1 },
  },
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* opt-in nas mudanças do react-router v7: sem isso ele avisa no console a
          cada carga, e console sujo esconde o aviso que importa */}
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        {/* O SessionProvider fica DENTRO do QueryClientProvider: ele limpa o cache
            de dados ao encerrar a sessão, então precisa do queryClient em contexto. */}
        <SessionProvider>
          <App />
        </SessionProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
