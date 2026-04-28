import { useState } from 'react';
import { ArrowRight, Building2, LockKeyhole, Mail, Sparkles } from 'lucide-react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { getApiErrorDetails, getApiErrorMessage } from '../app/api';
import { brand } from '../app/brand';
import { ClientValidationError, validateClientForm } from '../app/validation';
import { useAuth } from '../auth/useAuth';
import { StatusMessage } from '../components/StatusMessage';

export function LoginPage() {
  const { isAuthenticated, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [usernameOrEmail, setUsernameOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string[]>([]);

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? '/dashboard';

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setDetails([]);

    try {
      const trimmedUsername = usernameOrEmail.trim();
      const trimmedPassword = password.trim();
      validateClientForm(
        'login',
        [
          { name: 'usernameOrEmail', label: 'Usuario o correo', type: trimmedUsername.includes('@') ? 'email' : 'text', required: true, maxLength: 120 },
          { name: 'password', label: 'Contrasena', type: 'password', required: true, maxLength: 128 },
        ],
        { usernameOrEmail: trimmedUsername, password: trimmedPassword },
        'action',
      );
      await login({ usernameOrEmail: trimmedUsername, password: trimmedPassword });
      navigate(from, { replace: true });
    } catch (submitError) {
      if (submitError instanceof ClientValidationError) {
        setError(submitError.message);
        setDetails(submitError.details);
        return;
      }

      setError(getApiErrorMessage(submitError));
      setDetails(getApiErrorDetails(submitError));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-panel">
        <div className="auth-copy">
          <div className="brand hero-brand">
            <div className="brand-mark">{brand.mark}</div>
            <div>
              <strong>{brand.name}</strong>
              <span>{brand.tagline}</span>
            </div>
          </div>

          <div className="auth-story">
            <span className="eyebrow">Backoffice hotelero</span>
            <h1>Una operacion mas serena empieza aqui.</h1>
            <p>Controla disponibilidad, reservas, pagos y experiencia del huesped con una interfaz pensada para recepcion y administracion.</p>
          </div>

          <div className="auth-highlights">
            <div>
              <Building2 size={20} />
              <span>Inventario centralizado</span>
            </div>
            <div>
              <Sparkles size={20} />
              <span>Flujos operativos guiados</span>
            </div>
          </div>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="form-heading">
            <span className="eyebrow">Acceso interno</span>
            <h2>Inicia sesion</h2>
            <p>Ingresa con tu usuario administrativo para continuar.</p>
          </div>

          <label className="field">
            <span>Usuario o correo</span>
            <div className="input-with-icon">
              <Mail size={18} />
              <input value={usernameOrEmail} onChange={(event) => setUsernameOrEmail(event.target.value)} placeholder="usuario@lunara.com" required />
            </div>
          </label>

          <label className="field">
            <span>Contrasena</span>
            <div className="input-with-icon">
              <LockKeyhole size={18} />
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="********" required />
            </div>
          </label>

          {error ? <StatusMessage kind="error" title={error} details={details} /> : null}

          <button type="submit" className="primary-button icon-text" disabled={isSubmitting}>
            <span>{isSubmitting ? 'Validando acceso...' : 'Entrar al backoffice'}</span>
            <ArrowRight size={18} />
          </button>
        </form>
      </div>
    </div>
  );
}

