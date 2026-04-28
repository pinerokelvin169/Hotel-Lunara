import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter as Router, Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { brand } from './app/brand';
import { AppLayout } from './components/AppLayout';
import { AuthProvider } from './auth/AuthContext';
import { useAuth } from './auth/useAuth';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { OperationsPage } from './pages/OperationsPage';
import { ResourcePage } from './pages/ResourcePage';
import { CustomerHomePage } from './customer/CustomerHomePage';
import { CustomerPaymentPage } from './customer/CustomerPaymentPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function ProtectedShell() {
  const { isAuthenticated, hasRole } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (!hasRole('admin', 'vendedor')) {
    return (
      <div className="auth-screen">
        <div className="auth-panel single">
          <div className="auth-copy">
            <div className="brand hero-brand">
              <div className="brand-mark">{brand.mark}</div>
              <div>
                <strong>{brand.name}</strong>
                <span>{brand.tagline}</span>
              </div>
            </div>
            <ShieldAlert size={42} />
            <span className="eyebrow">Acceso restringido</span>
            <h1>Tu usuario no tiene permisos para usar el backoffice.</h1>
            <p>Este portal esta reservado para perfiles administrativos y operativos.</p>
            <NavLink to="/login" className="primary-button icon-text">
              Volver al login
            </NavLink>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/operations" element={<OperationsPage />} />
        <Route path="/resources/:moduleKey" element={<ResourcePage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Router>
          <Routes>
            <Route path="/" element={<CustomerHomePage />} />
            <Route path="/hotel" element={<CustomerHomePage />} />
            <Route path="/pago-simulado" element={<CustomerPaymentPage />} />
            <Route path="/hotel/pago-simulado" element={<CustomerPaymentPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/*" element={<ProtectedShell />} />
          </Routes>
        </Router>
      </AuthProvider>
    </QueryClientProvider>
  );
}
