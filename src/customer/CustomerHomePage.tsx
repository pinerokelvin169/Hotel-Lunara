import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BedDouble,
  CalendarDays,
  ClipboardCheck,
  Clock,
  CreditCard,
  Hotel,
  LogIn,
  LogOut,
  Mail,
  Menu,
  MapPin,
  MessageSquareText,
  Minus,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  UserRound,
  UsersRound,
  Wifi,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { brand } from '../app/brand';
import type { FieldConfig } from '../app/types';
import { ClientValidationError, validateClientForm } from '../app/validation';
import { Modal } from '../components/Modal';
import { StatusMessage } from '../components/StatusMessage';
import { cloudinaryImage } from './cloudinary';
import {
  clearStoredPublicCustomerAuth,
  createPublicReservation,
  getPublicBranches,
  getPublicCustomerReservations,
  getPublicServices,
  getStoredPublicCustomerAuth,
  loginPublicCustomer,
  registerPublicCustomer,
  searchPublicRooms,
  submitPublicReview,
} from './publicApi';
import type { PublicBranch, PublicCustomerAuth, PublicReservation, PublicReservationPayload, PublicReviewPayload, PublicRoom, PublicService } from './types';

function today(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

function money(value: number, currency = 'USD') {
  return new Intl.NumberFormat('es-EC', { style: 'currency', currency }).format(value);
}

function nights(start: string, end: string) {
  const diff = new Date(end).getTime() - new Date(start).getTime();
  return Math.max(1, Math.ceil(diff / 86_400_000));
}

function branchLabel(branch: PublicBranch) {
  return [branch.NombreSucursal, branch.Ciudad].filter(Boolean).join(' - ');
}

const publicBookingFields: FieldConfig[] = [
  { name: 'TipoIdentificacion', label: 'Tipo de identificacion', type: 'select', required: true, options: [
    { label: 'Cedula', value: 'CED' },
    { label: 'RUC', value: 'RUC' },
    { label: 'Pasaporte', value: 'PAS' },
  ] },
  { name: 'NumeroIdentificacion', label: 'Numero de identificacion', type: 'text', required: true, maxLength: 30 },
  { name: 'Nombres', label: 'Nombres', type: 'text', required: true, maxLength: 120 },
  { name: 'Apellidos', label: 'Apellidos', type: 'text', maxLength: 120 },
  { name: 'RazonSocial', label: 'Razon social', type: 'text', maxLength: 180 },
  { name: 'Correo', label: 'Correo', type: 'email', required: true, maxLength: 160 },
  { name: 'Telefono', label: 'Telefono', type: 'text', required: true, maxLength: 30 },
  { name: 'Direccion', label: 'Direccion', type: 'text', required: true, maxLength: 250 },
  { name: 'Observaciones', label: 'Solicitudes especiales', type: 'textarea', maxLength: 2000 },
];

const publicRegisterFields: FieldConfig[] = [
  ...publicBookingFields.filter((field) => field.name !== 'Observaciones'),
  { name: 'Password', label: 'Contrasena', type: 'password', required: true, maxLength: 128 },
];

function readBackendError(error: unknown) {
  const response = (error as { response?: { status?: number; data?: { message?: string; title?: string; error?: string; details?: string[]; errors?: string[] } } })?.response;
  if (response?.status === 404 || response?.status === 405) {
    return {
      message: 'El registro de clientes no esta disponible en la API activa.',
      details: ['Reinicia la API para cargar los endpoints nuevos de /api/v1/auth/registro-cliente.'],
    };
  }

  const backendMessage = response?.data;
  return {
    message: backendMessage?.message ?? backendMessage?.title ?? backendMessage?.error,
    details: backendMessage?.details ?? backendMessage?.errors ?? [],
  };
}

function BranchCard({ branch, active, onSelect }: { branch: PublicBranch; active: boolean; onSelect: (branchGuid: string) => void }) {
  return (
    <button type="button" className={`branch-card ${active ? 'active' : ''}`} onClick={() => onSelect(branch.SucursalGuid)}>
      <span className="eyebrow">{[branch.Ciudad, branch.Pais].filter(Boolean).join(', ')}</span>
      <strong>{branch.NombreSucursal}</strong>
      {branch.DescripcionCorta ? <p>{branch.DescripcionCorta}</p> : null}
      <small><MapPin size={14} /> {branch.Direccion}</small>
    </button>
  );
}

function RoomCard({
  room,
  onReserve,
  reserveLabel = 'Reservar',
}: {
  room: PublicRoom;
  onReserve: (room: PublicRoom) => void;
  reserveLabel?: string;
}) {
  const image = room.Imagenes?.[0] ? cloudinaryImage(room.Imagenes[0], room.NumeroHabitacion ? Number(room.NumeroHabitacion) : 0) : null;
  const services = room.Servicios.slice(0, 4);

  return (
    <article className="customer-room-card">
      <div className="room-media">
        {image ? <img src={image} alt={room.NombreTipoHabitacion} /> : <div className="room-media-empty"><BedDouble size={38} /></div>}
        <span>{room.NombreSucursal}</span>
      </div>
      <div className="room-content">
        <div>
          {room.TipoCama ? <p className="eyebrow">{room.TipoCama}</p> : null}
          <h3>{room.NombreTipoHabitacion}</h3>
          {room.DescripcionHabitacion ? <p>{room.DescripcionHabitacion}</p> : null}
        </div>
        <div className="room-facts">
          <span><UsersRound size={16} /> {room.CapacidadTotal} huespedes</span>
          {room.AreaM2 ? <span><Hotel size={16} /> {room.AreaM2} m2</span> : null}
          {room.Servicios.length > 0 ? <span><Wifi size={16} /> {room.Servicios.length} servicios</span> : null}
        </div>
        {services.length > 0 ? (
          <div className="room-services">
            {services.map((service) => (
              <span key={service.Codigo}>{service.Nombre}</span>
            ))}
          </div>
        ) : null}
        <div className="room-footer">
          <div>
            <small>Desde</small>
            <strong>{money(room.PrecioTotalConImpuestos, room.Moneda)}</strong>
            <small>por noche</small>
          </div>
          <button type="button" className="customer-primary-button" onClick={() => onReserve(room)}>
            {reserveLabel}
          </button>
        </div>
      </div>
    </article>
  );
}

function ServiceCard({ service }: { service: PublicService }) {
  const schedule = service.Disponible24h ? 'Disponible 24h' : [service.HoraInicio, service.HoraFin].filter(Boolean).join(' - ');
  const icon = service.IconoUrl ? cloudinaryImage(service.IconoUrl, 0, 160) : null;

  return (
    <article className="service-card">
      <span>{icon ? <img src={icon} alt={service.Nombre} /> : <Sparkles size={18} />}</span>
      <div>
        <strong>{service.Nombre}</strong>
        {service.Descripcion ? <p>{service.Descripcion}</p> : null}
        <small>{[schedule, service.PrecioBase > 0 ? money(service.PrecioBase) : ''].filter(Boolean).join(' - ')}</small>
      </div>
    </article>
  );
}

function reservationStateLabel(state: string) {
  const normalized = state.toUpperCase();
  if (normalized === 'CON') return 'Confirmada';
  if (normalized === 'PEN') return 'Pendiente';
  if (normalized === 'CAN') return 'Cancelada';
  if (normalized === 'FIN') return 'Finalizada';
  return state || 'Sin estado';
}

function formatShortDate(value: string) {
  if (!value) {
    return '-';
  }

  return new Intl.DateTimeFormat('es-EC', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
}

function CustomerReservationCard({ reservation, onReview }: { reservation: PublicReservation; onReview: (reservation: PublicReservation) => void }) {
  const isConfirmed = reservation.EstadoReserva?.toUpperCase() === 'CON';
  const roomCount = reservation.Habitaciones?.length ?? 0;
  const canReview = ['CON', 'FIN'].includes(reservation.EstadoReserva?.toUpperCase());

  return (
    <article className="customer-reservation-card">
      <div>
        <span className={`reservation-status ${isConfirmed ? 'confirmed' : ''}`}>{reservationStateLabel(reservation.EstadoReserva)}</span>
        <h3>{reservation.CodigoReserva || `Reserva ${reservation.ReservaGuid.slice(0, 8)}`}</h3>
        <p>{formatShortDate(reservation.FechaInicio)} al {formatShortDate(reservation.FechaFin)}</p>
      </div>
      <div className="reservation-card-meta">
        <span><BedDouble size={16} /> {roomCount} habitacion(es)</span>
        <span><CreditCard size={16} /> {money(reservation.TotalReserva, reservation.Factura?.Moneda ?? 'USD')}</span>
        {reservation.Factura ? <span>Factura {reservation.Factura.NumeroFactura}</span> : null}
      </div>
      {canReview ? (
        <button type="button" className="customer-secondary-button icon-text" onClick={() => onReview(reservation)}>
          <MessageSquareText size={17} />
          <span>Valorar estadia</span>
        </button>
      ) : null}
    </article>
  );
}

function ReviewForm({
  reservation,
  onReviewed,
}: {
  reservation: PublicReservation;
  onReviewed: () => void;
}) {
  const [form, setForm] = useState({
    PuntuacionGeneral: 10,
    PuntuacionLimpieza: 10,
    PuntuacionConfort: 10,
    PuntuacionUbicacion: 10,
    PuntuacionInstalaciones: 10,
    PuntuacionPersonal: 10,
    PuntuacionCalidadPrecio: 10,
    TipoViaje: 'PAREJA',
    ComentarioPositivo: '',
    ComentarioNegativo: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const mutation = useMutation({
    mutationFn: () => {
      setError(null);
      setSuccess(false);

      if (form.PuntuacionGeneral < 1 || form.PuntuacionGeneral > 10) {
        throw new ClientValidationError(['La puntuacion general debe estar entre 1 y 10.']);
      }

      const payload: PublicReviewPayload = {
        ReservaGuid: reservation.ReservaGuid,
        ...form,
      };
      return submitPublicReview(payload);
    },
    onError: (requestError) => {
      if (requestError instanceof ClientValidationError) {
        setError(requestError.message);
        return;
      }

      const backend = readBackendError(requestError);
      setError(backend.message ?? (requestError instanceof Error ? requestError.message : 'No pudimos registrar la valoracion.'));
    },
    onSuccess: () => {
      setSuccess(true);
      onReviewed();
    },
  });

  const updateScore = (field: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [field]: Number(value) }));
    setError(null);
  };

  return (
    <form className="customer-booking-form customer-review-form" onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}>
      <div className="booking-summary compact">
        <div>
          <h3>{reservation.CodigoReserva}</h3>
          <p>{formatShortDate(reservation.FechaInicio)} al {formatShortDate(reservation.FechaFin)}</p>
        </div>
      </div>

      <div className="customer-form-grid">
        {[
          ['PuntuacionGeneral', 'General'],
          ['PuntuacionLimpieza', 'Limpieza'],
          ['PuntuacionConfort', 'Confort'],
          ['PuntuacionUbicacion', 'Ubicacion'],
          ['PuntuacionInstalaciones', 'Instalaciones'],
          ['PuntuacionPersonal', 'Personal'],
          ['PuntuacionCalidadPrecio', 'Calidad precio'],
        ].map(([field, label]) => (
          <label key={field}>
            <span>{label}</span>
            <input
              type="number"
              min={1}
              max={10}
              step={0.1}
              value={String(form[field as keyof typeof form])}
              onChange={(event) => updateScore(field as keyof typeof form, event.target.value)}
            />
          </label>
        ))}
        <label>
          <span>Tipo de viaje</span>
          <select value={form.TipoViaje} onChange={(event) => setForm((current) => ({ ...current, TipoViaje: event.target.value }))}>
            <option value="NEGOCIOS">Negocios</option>
            <option value="FAMILIAR">Familiar</option>
            <option value="PAREJA">Pareja</option>
            <option value="SOLO">Solo</option>
            <option value="AMIGOS">Amigos</option>
          </select>
        </label>
        <label className="span-2">
          <span>Que fue lo mejor?</span>
          <textarea maxLength={2000} value={form.ComentarioPositivo} onChange={(event) => setForm((current) => ({ ...current, ComentarioPositivo: event.target.value }))} />
        </label>
        <label className="span-2">
          <span>Que podriamos mejorar?</span>
          <textarea maxLength={2000} value={form.ComentarioNegativo} onChange={(event) => setForm((current) => ({ ...current, ComentarioNegativo: event.target.value }))} />
        </label>
      </div>

      {error ? <StatusMessage kind="error" title={error} /> : null}
      {success ? <StatusMessage kind="success" title="Gracias, recibimos tu valoracion." /> : null}
      <button type="submit" className="customer-primary-button icon-text" disabled={mutation.isPending}>
        <Star size={18} />
        <span>{mutation.isPending ? 'Enviando...' : 'Enviar valoracion'}</span>
      </button>
    </form>
  );
}

function CustomerAuthForm({
  mode,
  onModeChange,
  onAuthenticated,
}: {
  mode: 'login' | 'register';
  onModeChange: (mode: 'login' | 'register') => void;
  onAuthenticated: (auth: PublicCustomerAuth) => void;
}) {
  const [loginForm, setLoginForm] = useState({ usernameOrEmail: '', password: '' });
  const [registerForm, setRegisterForm] = useState({
    TipoIdentificacion: 'CED',
    NumeroIdentificacion: '',
    Nombres: '',
    Apellidos: '',
    RazonSocial: '',
    Correo: '',
    Telefono: '',
    Direccion: '',
    Password: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const clearErrors = () => {
    setError(null);
    setErrorDetails([]);
    setFieldErrors({});
  };

  const loginMutation = useMutation({
    mutationFn: () => {
      clearErrors();
      if (!loginForm.usernameOrEmail.trim() || !loginForm.password) {
        throw new ClientValidationError(['Correo/usuario y contrasena son requeridos.'], {
          usernameOrEmail: !loginForm.usernameOrEmail.trim() ? 'Correo o usuario es requerido.' : '',
          password: !loginForm.password ? 'Contrasena es requerida.' : '',
        });
      }

      return loginPublicCustomer({
        usernameOrEmail: loginForm.usernameOrEmail.trim(),
        password: loginForm.password,
      });
    },
    onError: (requestError) => {
      if (requestError instanceof ClientValidationError) {
        setError(requestError.message);
        setErrorDetails(requestError.details);
        setFieldErrors(requestError.fieldErrors);
        return;
      }

      const backend = readBackendError(requestError);
      setError(backend.message ?? (requestError instanceof Error ? requestError.message : 'No pudimos iniciar sesion.'));
      setErrorDetails(backend.details);
    },
    onSuccess: onAuthenticated,
  });

  const registerMutation = useMutation({
    mutationFn: () => {
      clearErrors();
      validateClientForm('registro-cliente-publico', publicRegisterFields, registerForm);
      return registerPublicCustomer(registerForm);
    },
    onError: (requestError) => {
      if (requestError instanceof ClientValidationError) {
        setError(requestError.message);
        setErrorDetails(requestError.details);
        setFieldErrors(requestError.fieldErrors);
        return;
      }

      const backend = readBackendError(requestError);
      setError(backend.message ?? (requestError instanceof Error ? requestError.message : 'No pudimos crear la cuenta.'));
      setErrorDetails(backend.details);
    },
    onSuccess: onAuthenticated,
  });

  const updateRegisterField = (field: keyof typeof registerForm, value: string) => {
    setRegisterForm((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => {
      if (!current[field]) {
        return current;
      }
      const next = { ...current };
      delete next[field];
      return next;
    });
    setError(null);
    setErrorDetails([]);
  };

  if (mode === 'login') {
    return (
      <form className="customer-auth-form" onSubmit={(event) => { event.preventDefault(); loginMutation.mutate(); }}>
        <div className="auth-mode-switch">
          <button type="button" className="active">Iniciar sesion</button>
          <button type="button" onClick={() => { clearErrors(); onModeChange('register'); }}>Crear cuenta</button>
        </div>
        <label>
          <span>Correo o usuario</span>
          <input
            className={fieldErrors.usernameOrEmail ? 'input-error' : ''}
            value={loginForm.usernameOrEmail}
            onChange={(event) => setLoginForm((current) => ({ ...current, usernameOrEmail: event.target.value }))}
          />
          {fieldErrors.usernameOrEmail ? <small className="field-error">{fieldErrors.usernameOrEmail}</small> : null}
        </label>
        <label>
          <span>Contrasena</span>
          <input
            className={fieldErrors.password ? 'input-error' : ''}
            type="password"
            value={loginForm.password}
            onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
          />
          {fieldErrors.password ? <small className="field-error">{fieldErrors.password}</small> : null}
        </label>
        {error ? <StatusMessage kind="error" title={error} details={errorDetails} /> : null}
        <button type="submit" className="customer-primary-button icon-text" disabled={loginMutation.isPending}>
          <LogIn size={18} />
          <span>{loginMutation.isPending ? 'Entrando...' : 'Entrar y reservar'}</span>
        </button>
      </form>
    );
  }

  return (
    <form className="customer-auth-form" onSubmit={(event) => { event.preventDefault(); registerMutation.mutate(); }}>
      <div className="auth-mode-switch">
        <button type="button" onClick={() => { clearErrors(); onModeChange('login'); }}>Iniciar sesion</button>
        <button type="button" className="active">Crear cuenta</button>
      </div>
      <div className="customer-form-grid">
        <label>
          <span>Tipo de identificacion</span>
          <select className={fieldErrors.TipoIdentificacion ? 'input-error' : ''} value={registerForm.TipoIdentificacion} onChange={(event) => updateRegisterField('TipoIdentificacion', event.target.value)}>
            <option value="CED">Cedula</option>
            <option value="RUC">RUC</option>
            <option value="PAS">Pasaporte</option>
          </select>
          {fieldErrors.TipoIdentificacion ? <small className="field-error">{fieldErrors.TipoIdentificacion}</small> : null}
        </label>
        <label>
          <span>Numero de identificacion</span>
          <input className={fieldErrors.NumeroIdentificacion ? 'input-error' : ''} maxLength={30} value={registerForm.NumeroIdentificacion} onChange={(event) => updateRegisterField('NumeroIdentificacion', event.target.value)} />
          {fieldErrors.NumeroIdentificacion ? <small className="field-error">{fieldErrors.NumeroIdentificacion}</small> : null}
        </label>
        <label>
          <span>Nombres</span>
          <input className={fieldErrors.Nombres ? 'input-error' : ''} maxLength={120} value={registerForm.Nombres} onChange={(event) => updateRegisterField('Nombres', event.target.value)} />
          {fieldErrors.Nombres ? <small className="field-error">{fieldErrors.Nombres}</small> : null}
        </label>
        <label>
          <span>Apellidos</span>
          <input className={fieldErrors.Apellidos ? 'input-error' : ''} maxLength={120} value={registerForm.Apellidos} onChange={(event) => updateRegisterField('Apellidos', event.target.value)} />
          {fieldErrors.Apellidos ? <small className="field-error">{fieldErrors.Apellidos}</small> : null}
        </label>
        <label>
          <span>Correo</span>
          <input className={fieldErrors.Correo ? 'input-error' : ''} type="email" maxLength={160} value={registerForm.Correo} onChange={(event) => updateRegisterField('Correo', event.target.value)} />
          {fieldErrors.Correo ? <small className="field-error">{fieldErrors.Correo}</small> : null}
        </label>
        <label>
          <span>Telefono</span>
          <input className={fieldErrors.Telefono ? 'input-error' : ''} maxLength={30} value={registerForm.Telefono} onChange={(event) => updateRegisterField('Telefono', event.target.value)} />
          {fieldErrors.Telefono ? <small className="field-error">{fieldErrors.Telefono}</small> : null}
        </label>
        <label className="span-2">
          <span>Direccion</span>
          <input className={fieldErrors.Direccion ? 'input-error' : ''} maxLength={250} value={registerForm.Direccion} onChange={(event) => updateRegisterField('Direccion', event.target.value)} />
          {fieldErrors.Direccion ? <small className="field-error">{fieldErrors.Direccion}</small> : null}
        </label>
        <label className="span-2">
          <span>Contrasena</span>
          <input className={fieldErrors.Password ? 'input-error' : ''} type="password" maxLength={128} value={registerForm.Password} onChange={(event) => updateRegisterField('Password', event.target.value)} />
          {fieldErrors.Password ? <small className="field-error">{fieldErrors.Password}</small> : null}
        </label>
      </div>
      {error ? <StatusMessage kind="error" title={error} details={errorDetails} /> : null}
      <button type="submit" className="customer-primary-button icon-text" disabled={registerMutation.isPending}>
        <UserRound size={18} />
        <span>{registerMutation.isPending ? 'Creando cuenta...' : 'Crear cuenta y reservar'}</span>
      </button>
    </form>
  );
}

function BookingForm({
  room,
  dates,
  guests,
  customerAuth,
}: {
  room: PublicRoom;
  dates: { start: string; end: string };
  guests: { adults: number; children: number };
  customerAuth: PublicCustomerAuth | null;
}) {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    TipoIdentificacion: customerAuth?.cliente?.TipoIdentificacion ?? 'CED',
    NumeroIdentificacion: customerAuth?.cliente?.NumeroIdentificacion ?? '',
    Nombres: customerAuth?.cliente?.Nombres ?? customerAuth?.nombres ?? '',
    Apellidos: customerAuth?.cliente?.Apellidos ?? '',
    RazonSocial: customerAuth?.cliente?.RazonSocial ?? '',
    Correo: customerAuth?.cliente?.Correo ?? customerAuth?.correo ?? '',
    Telefono: customerAuth?.cliente?.Telefono ?? '',
    Direccion: customerAuth?.cliente?.Direccion ?? '',
    Observaciones: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const totalNights = nights(dates.start, dates.end);
  const total = totalNights * room.PrecioTotalConImpuestos;
  const image = room.Imagenes?.[0] ? cloudinaryImage(room.Imagenes[0]) : null;

  const updateField = (field: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => {
      if (!current[field]) {
        return current;
      }
      const next = { ...current };
      delete next[field];
      return next;
    });
    setError(null);
    setErrorDetails([]);
  };

  const mutation = useMutation({
    mutationFn: () => {
      setError(null);
      setErrorDetails([]);
      setFieldErrors({});
      validateClientForm('reserva-publica', publicBookingFields, form);
      const payload: PublicReservationPayload = {
        SucursalGuid: room.SucursalGuid,
        Cliente: {
          TipoIdentificacion: form.TipoIdentificacion,
          NumeroIdentificacion: form.NumeroIdentificacion,
          Nombres: form.Nombres,
          Apellidos: form.Apellidos,
          RazonSocial: form.RazonSocial,
          Correo: form.Correo,
          Telefono: form.Telefono,
          Direccion: form.Direccion,
        },
        FechaInicio: `${dates.start}T15:00:00`,
        FechaFin: `${dates.end}T12:00:00`,
        OrigenCanalReserva: 'PUBLIC_WEB',
        Observaciones: form.Observaciones,
        Habitaciones: [{ HabitacionGuid: room.HabitacionGuid, NumAdultos: guests.adults, NumNinos: guests.children }],
      };
      return createPublicReservation(payload);
    },
    onError: (requestError) => {
      if (requestError instanceof ClientValidationError) {
        setError(requestError.message);
        setErrorDetails(requestError.details);
        setFieldErrors(requestError.fieldErrors);
        return;
      }
      const backendMessage = (requestError as { response?: { data?: { message?: string; title?: string; error?: string } } })?.response?.data;
      const detail = backendMessage?.message ?? backendMessage?.title ?? backendMessage?.error;
      setError(detail ?? (requestError instanceof Error ? requestError.message : 'No pudimos crear la reserva. Revisa tus datos e intenta de nuevo.'));
    },
    onSuccess: (result) => {
      const response = result as {
        Data?: { ReservaGuid?: string };
        data?: { ReservaGuid?: string };
        ReservaGuid?: string;
      };
      const reservaGuid = String(response.Data?.ReservaGuid ?? response.data?.ReservaGuid ?? response.ReservaGuid ?? '');
      if (reservaGuid) {
        navigate(`/pago-simulado?reserva=${encodeURIComponent(reservaGuid)}`);
        return;
      }
      setError('La reserva se creo, pero no pudimos abrir la pagina de pago.');
    },
  });

  return (
    <form className="customer-booking-form" onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}>
      <div className="booking-summary">
        {image ? <img src={image} alt={room.NombreTipoHabitacion} /> : null}
        <div>
          <h3>{room.NombreTipoHabitacion}</h3>
          <p>{dates.start} al {dates.end} - {totalNights} noche(s)</p>
          <strong>{money(total, room.Moneda)}</strong>
        </div>
      </div>

      <div className="customer-form-grid">
        <label>
          <span>Tipo de identificacion</span>
          <select className={fieldErrors.TipoIdentificacion ? 'input-error' : ''} value={form.TipoIdentificacion} onChange={(event) => updateField('TipoIdentificacion', event.target.value)}>
            <option value="CED">Cedula</option>
            <option value="RUC">RUC</option>
            <option value="PAS">Pasaporte</option>
          </select>
          {fieldErrors.TipoIdentificacion ? <small className="field-error">{fieldErrors.TipoIdentificacion}</small> : null}
        </label>
        <label>
          <span>Numero de identificacion</span>
          <input className={fieldErrors.NumeroIdentificacion ? 'input-error' : ''} required maxLength={30} value={form.NumeroIdentificacion} onChange={(event) => updateField('NumeroIdentificacion', event.target.value)} />
          {fieldErrors.NumeroIdentificacion ? <small className="field-error">{fieldErrors.NumeroIdentificacion}</small> : null}
        </label>
        <label>
          <span>Nombres</span>
          <input className={fieldErrors.Nombres ? 'input-error' : ''} required maxLength={120} value={form.Nombres} onChange={(event) => updateField('Nombres', event.target.value)} />
          {fieldErrors.Nombres ? <small className="field-error">{fieldErrors.Nombres}</small> : null}
        </label>
        <label>
          <span>Apellidos</span>
          <input className={fieldErrors.Apellidos ? 'input-error' : ''} maxLength={120} value={form.Apellidos} onChange={(event) => updateField('Apellidos', event.target.value)} />
          {fieldErrors.Apellidos ? <small className="field-error">{fieldErrors.Apellidos}</small> : null}
        </label>
        <label className="span-2">
          <span>Razon social</span>
          <input className={fieldErrors.RazonSocial ? 'input-error' : ''} maxLength={180} value={form.RazonSocial} onChange={(event) => updateField('RazonSocial', event.target.value)} />
          {fieldErrors.RazonSocial ? <small className="field-error">{fieldErrors.RazonSocial}</small> : null}
        </label>
        <label>
          <span>Correo</span>
          <input className={fieldErrors.Correo ? 'input-error' : ''} type="email" required maxLength={160} value={form.Correo} onChange={(event) => updateField('Correo', event.target.value)} />
          {fieldErrors.Correo ? <small className="field-error">{fieldErrors.Correo}</small> : null}
        </label>
        <label>
          <span>Telefono</span>
          <input className={fieldErrors.Telefono ? 'input-error' : ''} required maxLength={30} value={form.Telefono} onChange={(event) => updateField('Telefono', event.target.value)} />
          {fieldErrors.Telefono ? <small className="field-error">{fieldErrors.Telefono}</small> : null}
        </label>
        <label className="span-2">
          <span>Direccion</span>
          <input className={fieldErrors.Direccion ? 'input-error' : ''} required maxLength={250} value={form.Direccion} onChange={(event) => updateField('Direccion', event.target.value)} />
          {fieldErrors.Direccion ? <small className="field-error">{fieldErrors.Direccion}</small> : null}
        </label>
        <label className="span-2">
          <span>Solicitudes especiales</span>
          <textarea className={fieldErrors.Observaciones ? 'input-error' : ''} maxLength={2000} value={form.Observaciones} onChange={(event) => updateField('Observaciones', event.target.value)} />
          {fieldErrors.Observaciones ? <small className="field-error">{fieldErrors.Observaciones}</small> : null}
        </label>
      </div>

      {error ? <StatusMessage kind="error" title={error} details={errorDetails} /> : null}
      <button type="submit" className="customer-primary-button" disabled={mutation.isPending}>
        {mutation.isPending ? 'Creando reserva...' : 'Confirmar reserva'}
      </button>
    </form>
  );
}

export function CustomerHomePage() {
  const queryClient = useQueryClient();
  const branchesQuery = useQuery({ queryKey: ['public-branches'], queryFn: getPublicBranches });
  const branches = branchesQuery.data ?? [];
  const [selectedBranchGuid, setSelectedBranchGuid] = useState('');
  const [draft, setDraft] = useState({ start: today(1), end: today(3), adults: 2, children: 0 });
  const [search, setSearch] = useState({ start: today(1), end: today(3), adults: 2, children: 0, branchGuid: '' });
  const [selectedRoom, setSelectedRoom] = useState<PublicRoom | null>(null);
  const [pendingRoom, setPendingRoom] = useState<PublicRoom | null>(null);
  const [customerAuth, setCustomerAuth] = useState<PublicCustomerAuth | null>(() => getStoredPublicCustomerAuth());
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [customerNavOpen, setCustomerNavOpen] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedReviewReservation, setSelectedReviewReservation] = useState<PublicReservation | null>(null);

  const selectedBranch = useMemo(
    () => branches.find((branch) => branch.SucursalGuid === selectedBranchGuid) ?? null,
    [branches, selectedBranchGuid],
  );

  const servicesQuery = useQuery({
    queryKey: ['public-services', search.branchGuid],
    queryFn: () => getPublicServices(search.branchGuid || undefined),
  });

  const showcaseRoomsQuery = useQuery({
    queryKey: ['public-room-showcase'],
    queryFn: () => searchPublicRooms({ soloCatalogo: true }),
  });

  const availabilityRoomsQuery = useQuery({
    queryKey: ['public-room-availability', search],
    queryFn: () =>
      searchPublicRooms({
        fechaInicio: search.start,
        fechaFin: search.end,
        sucursalGuid: search.branchGuid || undefined,
        adultos: search.adults,
        ninos: search.children,
      }),
    enabled: hasSearched,
  });

  const customerReservationsQuery = useQuery({
    queryKey: ['public-customer-reservations', customerAuth?.usuarioGuid],
    queryFn: getPublicCustomerReservations,
    enabled: Boolean(customerAuth),
  });

  const showcaseRooms = showcaseRoomsQuery.data ?? [];
  const rooms = hasSearched ? availabilityRoomsQuery.data ?? [] : showcaseRooms;
  const services = servicesQuery.data ?? [];
  const customerReservations = customerReservationsQuery.data ?? [];
  const confirmedReservations = customerReservations.filter((reservation) => reservation.EstadoReserva?.toUpperCase() === 'CON');
  const activeRoomsQuery = hasSearched ? availabilityRoomsQuery : showcaseRoomsQuery;
  const featuredRoom = showcaseRooms.find((room) => room.Imagenes?.[0]) ?? showcaseRooms[0] ?? null;
  const displayedBranch = selectedBranch ?? branches.find((branch) => branch.SucursalGuid === featuredRoom?.SucursalGuid) ?? branches[0] ?? null;
  const heroDescription = selectedBranch?.DescripcionCorta || selectedBranch?.DescripcionSucursal || featuredRoom?.DescripcionCortaSucursal || featuredRoom?.DescripcionSucursal;
  const heroImage = featuredRoom?.Imagenes?.[0];

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    setSearch({
      start: draft.start,
      end: draft.end,
      adults: draft.adults,
      children: draft.children,
      branchGuid: selectedBranchGuid,
    });
    setHasSearched(true);
  };

  const clearBranch = () => {
    setSelectedBranchGuid('');
    setSearch((current) => ({ ...current, branchGuid: '' }));
  };

  const focusSearch = () => {
    document.getElementById('buscar')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const openCustomerAuth = (mode: 'login' | 'register' = 'login') => {
    setAuthMode(mode);
    setAuthModalOpen(true);
  };

  const handleReserve = (room: PublicRoom) => {
    if (!customerAuth) {
      setPendingRoom(room);
      openCustomerAuth('login');
      return;
    }

    setSelectedRoom(room);
  };

  const handleAuthenticated = (auth: PublicCustomerAuth) => {
    setCustomerAuth(auth);
    setAuthModalOpen(false);
    if (pendingRoom) {
      setSelectedRoom(pendingRoom);
      setPendingRoom(null);
    }
  };

  const logoutCustomer = () => {
    clearStoredPublicCustomerAuth();
    setCustomerAuth(null);
    setSelectedRoom(null);
    setPendingRoom(null);
  };

  return (
    <div className={`customer-site ${customerNavOpen ? 'customer-nav-open' : ''}`}>
      <header className="customer-nav">
        <div className="brand">
          <div className="brand-mark">{brand.mark}</div>
          <div>
            <strong>{brand.name}</strong>
            <span>Reservas en linea</span>
          </div>
        </div>
        <button type="button" className="customer-menu-button" onClick={() => setCustomerNavOpen(true)} aria-label="Abrir menu">
          <Menu size={22} />
        </button>
        <div className="customer-nav-scrim" onClick={() => setCustomerNavOpen(false)} />
        <nav>
          <button type="button" className="customer-nav-close" onClick={() => setCustomerNavOpen(false)} aria-label="Cerrar menu">
            <X size={20} />
          </button>
          <a href="#buscar" onClick={() => setCustomerNavOpen(false)}>Buscar</a>
          <a href="#sucursales" onClick={() => setCustomerNavOpen(false)}>Sucursales</a>
          <a href="#habitaciones" onClick={() => setCustomerNavOpen(false)}>Habitaciones</a>
          <a href="#servicios" onClick={() => setCustomerNavOpen(false)}>Servicios</a>
          {customerAuth ? <a href="#mis-reservas" onClick={() => setCustomerNavOpen(false)}>Mis reservas</a> : null}
          <a href="#contacto" onClick={() => setCustomerNavOpen(false)}>Contacto</a>
          {customerAuth ? (
            <>
              <span className="customer-session"><UserRound size={15} /> {customerAuth.nombres || customerAuth.correo}</span>
              <button type="button" className="customer-secondary-button icon-text" onClick={logoutCustomer}>
                <LogOut size={16} />
                <span>Salir</span>
              </button>
            </>
          ) : (
            <>
              <button type="button" className="customer-secondary-button icon-text" onClick={() => openCustomerAuth('login')}>
                <LogIn size={16} />
                <span>Entrar</span>
              </button>
              <button type="button" className="customer-primary-button icon-text customer-nav-cta" onClick={() => openCustomerAuth('register')}>
                <UserRound size={16} />
                <span>Crear cuenta</span>
              </button>
            </>
          )}
          <a href="/login" onClick={() => setCustomerNavOpen(false)}>Backoffice</a>
        </nav>
      </header>

      <main>
        <section
          className="customer-hero"
          style={heroImage ? { backgroundImage: `linear-gradient(90deg, rgba(10, 32, 30, 0.88), rgba(10, 32, 30, 0.5), rgba(10, 32, 30, 0.18)), url(${cloudinaryImage(heroImage, 0, 1800)})` } : undefined}
        >
          <div className="customer-hero-copy">
            {displayedBranch ? <span className="eyebrow">{[displayedBranch.Ciudad, displayedBranch.Pais].filter(Boolean).join(', ')}</span> : null}
            <h1>{displayedBranch?.NombreSucursal ?? brand.name}</h1>
            {heroDescription ? <p>{heroDescription}</p> : null}
            <div className="hero-highlights">
              <span><CreditCard size={16} /> Reserva directa</span>
              <span><BedDouble size={16} /> {showcaseRooms.length} habitaciones</span>
              <span><Sparkles size={16} /> {services.length} servicios</span>
            </div>
          </div>

          <form id="buscar" className="booking-search" onSubmit={submitSearch}>
            <div className="booking-search-title">
              <span className="eyebrow">Reserva directa</span>
              <strong>Encuentra tu estadia ideal</strong>
            </div>
            <label className="span-all">
              <span>Sucursal</span>
              <select value={selectedBranchGuid} onChange={(event) => setSelectedBranchGuid(event.target.value)}>
                <option value="">{branchesQuery.isLoading ? 'Cargando sucursales...' : 'Todas las sucursales'}</option>
                {branches.map((branch) => (
                  <option key={branch.SucursalGuid} value={branch.SucursalGuid}>{branchLabel(branch)}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Llegada</span>
              <input type="date" value={draft.start} onChange={(event) => setDraft((current) => ({ ...current, start: event.target.value }))} />
            </label>
            <label>
              <span>Salida</span>
              <input type="date" value={draft.end} onChange={(event) => setDraft((current) => ({ ...current, end: event.target.value }))} />
            </label>
            <div className="guest-stepper">
              <span>Adultos</span>
              <button type="button" onClick={() => setDraft((current) => ({ ...current, adults: Math.max(1, current.adults - 1) }))}><Minus size={16} /></button>
              <strong>{draft.adults}</strong>
              <button type="button" onClick={() => setDraft((current) => ({ ...current, adults: current.adults + 1 }))}><Plus size={16} /></button>
            </div>
            <div className="guest-stepper">
              <span>Ninos</span>
              <button type="button" onClick={() => setDraft((current) => ({ ...current, children: Math.max(0, current.children - 1) }))}><Minus size={16} /></button>
              <strong>{draft.children}</strong>
              <button type="button" onClick={() => setDraft((current) => ({ ...current, children: current.children + 1 }))}><Plus size={16} /></button>
            </div>
            <button type="submit" className="customer-primary-button icon-text" disabled={availabilityRoomsQuery.isFetching}>
              <Search size={18} />
              <span>{availabilityRoomsQuery.isFetching ? 'Buscando...' : 'Buscar disponibilidad'}</span>
            </button>
          </form>
        </section>

        <section className="customer-feature-strip">
          <div><MapPin size={22} /><span>{branches.length} sucursales activas</span></div>
          <div><BedDouble size={22} /><span>{showcaseRooms.length} habitaciones y suites</span></div>
          <div><Wifi size={22} /><span>{services.length} servicios para tu estadia</span></div>
          <div><ShieldCheck size={22} /><span>Reservas con confirmacion y pago en linea</span></div>
        </section>

        <section id="sucursales" className="customer-section branch-section">
          <div className="customer-section-header">
            <div>
              <span className="eyebrow">Sucursales</span>
              <h2>Elige tu punto de estadia.</h2>
            </div>
            {selectedBranchGuid ? <button type="button" className="customer-secondary-button" onClick={clearBranch}>Ver todas</button> : null}
          </div>
          <div className="branch-grid">
            {branches.map((branch) => (
              <BranchCard key={branch.SucursalGuid} branch={branch} active={branch.SucursalGuid === selectedBranchGuid} onSelect={setSelectedBranchGuid} />
            ))}
          </div>
        </section>

        <section id="habitaciones" className="customer-section">
          <div className="customer-section-header">
            <div>
              <span className="eyebrow">{hasSearched ? 'Habitaciones disponibles' : 'Habitaciones y suites'}</span>
              <h2>{hasSearched ? selectedBranch ? `Estadias en ${selectedBranch.NombreSucursal}` : 'Opciones para tus fechas.' : 'Habitaciones pensadas para descansar mejor.'}</h2>
            </div>
            <p>{activeRoomsQuery.isFetching ? 'Buscando opciones...' : hasSearched ? `${rooms.length} opciones disponibles` : `${rooms.length} opciones publicadas`}</p>
          </div>

          {activeRoomsQuery.isError ? <StatusMessage kind="error" title="No pudimos cargar las habitaciones." /> : null}
          <div className="customer-room-grid">
            {rooms.map((room) => (
              <RoomCard
                key={room.HabitacionGuid}
                room={room}
                onReserve={hasSearched ? handleReserve : focusSearch}
                reserveLabel={hasSearched ? 'Reservar' : 'Buscar fechas'}
              />
            ))}
          </div>
          {!activeRoomsQuery.isFetching && rooms.length === 0 ? (
            <div className="empty-state">
              {hasSearched ? 'No hay habitaciones disponibles para esos criterios.' : 'Aun no hay habitaciones publicadas para el portal.'}
            </div>
          ) : null}
        </section>

        <section id="servicios" className="customer-section customer-section-alt">
          <div className="customer-section-header">
            <div>
              <span className="eyebrow">Servicios</span>
              <h2>Todo lo disponible durante tu estadia.</h2>
            </div>
            <p>{servicesQuery.isLoading ? 'Cargando servicios...' : `${services.length} servicios`}</p>
          </div>
          <div className="service-grid">
            {services.map((service) => <ServiceCard key={service.CatalogoGuid || service.Codigo} service={service} />)}
          </div>
        </section>

        <section id="mis-reservas" className="customer-section customer-account-section">
          <div className="customer-section-header">
            <div>
              <span className="eyebrow">Area de cliente</span>
              <h2>Tus reservas confirmadas.</h2>
            </div>
            {customerAuth ? <p>{customerReservationsQuery.isFetching ? 'Actualizando reservas...' : `${confirmedReservations.length} confirmada(s)`}</p> : null}
          </div>

          {!customerAuth ? (
            <div className="customer-account-guest">
              <div>
                <ClipboardCheck size={30} />
                <strong>Ingresa para ver tus reservas</strong>
                <p>Al iniciar sesion podras consultar tus reservas confirmadas y dejar una valoracion despues de tu estadia.</p>
              </div>
              <button type="button" className="customer-primary-button icon-text" onClick={() => openCustomerAuth('login')}>
                <LogIn size={18} />
                <span>Entrar a mi cuenta</span>
              </button>
            </div>
          ) : null}

          {customerAuth && customerReservationsQuery.isError ? (
            <StatusMessage
              kind="error"
              title="No pudimos cargar tus reservas."
              details={['Verifica que la API tenga disponible el endpoint publico de reservas del cliente.']}
            />
          ) : null}

          {customerAuth && !customerReservationsQuery.isFetching && confirmedReservations.length === 0 && !customerReservationsQuery.isError ? (
            <div className="empty-state">Aun no tienes reservas confirmadas en esta cuenta.</div>
          ) : null}

          {customerAuth && confirmedReservations.length > 0 ? (
            <div className="customer-reservation-grid">
              {confirmedReservations.map((reservation) => (
                <CustomerReservationCard key={reservation.ReservaGuid} reservation={reservation} onReview={setSelectedReviewReservation} />
              ))}
            </div>
          ) : null}
        </section>

        <section className="experience-section">
          <div>
            <span className="eyebrow">Experiencia</span>
            <h2>Una reserva clara desde la primera busqueda.</h2>
          </div>
          <div className="experience-grid">
            <article><CalendarDays size={24} /><strong>Llegadas sin prisa</strong><p>Ambientes preparados para descansar, trabajar o disfrutar una escapada.</p></article>
            <article><CreditCard size={24} /><strong>Reserva directa</strong><p>Confirma tu habitacion y completa el pago desde el portal del hotel.</p></article>
            <article><Star size={24} /><strong>Detalles de estadia</strong><p>Servicios, ubicacion y contacto visibles para planificar con confianza.</p></article>
          </div>
        </section>

        {displayedBranch ? (
          <section id="contacto" className="customer-detail-band">
            <article>
              <span className="eyebrow">Ubicacion</span>
              <h2>{displayedBranch.Direccion}</h2>
              <p>{[displayedBranch.Ubicacion, displayedBranch.Ciudad, displayedBranch.Provincia, displayedBranch.Pais].filter(Boolean).join(', ')}</p>
            </article>
            <article>
              <span className="eyebrow">Contacto</span>
              <p><Phone size={18} /> {displayedBranch.Telefono}</p>
              <p><Mail size={18} /> {displayedBranch.Correo}</p>
              <p><Clock size={18} /> Check-in {displayedBranch.HoraCheckin || '-'} / Check-out {displayedBranch.HoraCheckout || '-'}</p>
            </article>
          </section>
        ) : null}
      </main>

      <footer className="customer-footer">
        <div className="brand">
          <div className="brand-mark">{brand.mark}</div>
          <div>
            <strong>{brand.name}</strong>
            <span>{brand.tagline}</span>
          </div>
        </div>
        <div className="footer-links">
          <a href="#buscar">Buscar</a>
          <a href="#sucursales">Sucursales</a>
          <a href="#servicios">Servicios</a>
          <a href="/login">Backoffice</a>
        </div>
        {displayedBranch ? <span>{[displayedBranch.NombreSucursal, displayedBranch.Direccion].filter(Boolean).join(' - ')}</span> : null}
      </footer>

      <Modal
        open={Boolean(selectedRoom)}
        title="Completa tu reserva"
        description={selectedRoom ? `${selectedRoom.NombreTipoHabitacion} en ${selectedRoom.NombreSucursal}` : undefined}
        onClose={() => setSelectedRoom(null)}
      >
        {selectedRoom ? <BookingForm room={selectedRoom} dates={{ start: search.start, end: search.end }} guests={{ adults: search.adults, children: search.children }} customerAuth={customerAuth} /> : null}
      </Modal>

      <Modal
        open={authModalOpen}
        title={authMode === 'login' ? 'Ingresa a tu cuenta' : 'Crea tu cuenta de cliente'}
        description={pendingRoom ? `Necesitas una cuenta para reservar ${pendingRoom.NombreTipoHabitacion}.` : 'Accede al portal de clientes para gestionar tus reservas.'}
        onClose={() => { setAuthModalOpen(false); setPendingRoom(null); }}
      >
        <CustomerAuthForm mode={authMode} onModeChange={setAuthMode} onAuthenticated={handleAuthenticated} />
      </Modal>

      <Modal
        open={Boolean(selectedReviewReservation)}
        title="Valora tu estadia"
        description={selectedReviewReservation ? `Reserva ${selectedReviewReservation.CodigoReserva}` : undefined}
        onClose={() => setSelectedReviewReservation(null)}
      >
        {selectedReviewReservation ? (
          <ReviewForm
            reservation={selectedReviewReservation}
            onReviewed={() => {
              queryClient.invalidateQueries({ queryKey: ['public-customer-reservations'] });
            }}
          />
        ) : null}
      </Modal>
    </div>
  );
}
