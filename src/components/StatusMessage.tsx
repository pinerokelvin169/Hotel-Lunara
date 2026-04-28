import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import type { ReactNode } from 'react';

type StatusKind = 'error' | 'success' | 'info';

const icons: Record<StatusKind, ReactNode> = {
  error: <AlertCircle size={20} />,
  success: <CheckCircle2 size={20} />,
  info: <Info size={20} />,
};

function friendlyMessage(message: string, kind: StatusKind) {
  if (/failed to fetch|network|conectarse/i.test(message)) {
    return 'No pudimos conectar con el servidor. Revisa que la API este encendida e intenta de nuevo.';
  }

  if (/400|bad request|parametros invalidos/i.test(message)) {
    return 'Hay datos que necesitan correccion antes de continuar.';
  }

  if (/401|unauthorized|token/i.test(message)) {
    return 'Tu sesion no pudo validarse. Vuelve a iniciar sesion para continuar.';
  }

  if (/404|not found|no encontrado/i.test(message)) {
    return 'No encontramos el registro seleccionado. Actualiza la lista y vuelve a intentarlo.';
  }

  if (/concurrency|modified or deleted|expected to affect/i.test(message)) {
    return 'El registro cambio mientras trabajabas. Actualiza la pantalla y repite la operacion.';
  }

  if (kind === 'error' && message.trim() === '') {
    return 'No pudimos completar la accion. Revisa los datos e intenta de nuevo.';
  }

  return message;
}

export function StatusMessage({
  kind,
  title,
  details = [],
  children,
}: {
  kind: StatusKind;
  title: string;
  details?: string[];
  children?: ReactNode;
}) {
  const visibleTitle = friendlyMessage(title, kind);

  return (
    <div className={`alert ${kind}`}>
      <div className="alert-icon">{icons[kind]}</div>
      <div className="alert-body">
        <strong>{visibleTitle}</strong>
        {details.length > 0 ? (
          <ul>
            {details.map((detail) => (
              <li key={detail}>{friendlyMessage(detail, kind)}</li>
            ))}
          </ul>
        ) : null}
        {children}
      </div>
    </div>
  );
}

