import axios from 'axios';
import type {
  PublicBranch,
  PublicCustomerAuth,
  PublicCustomerLoginPayload,
  PublicCustomerRegisterPayload,
  PublicPayment,
  PublicPaymentSimulationResult,
  PublicPaymentSimulationPayload,
  PublicReservation,
  PublicReservationPayload,
  PublicRoom,
  PublicService,
} from './types';

const normalizeBaseUrl = (value?: string) => value?.trim().replace(/\/+$/, '');

const configuredApiUrl = normalizeBaseUrl(import.meta.env.VITE_API_URL);
const baseUrls = [
  configuredApiUrl,
  'https://localhost:7019',
  'http://localhost:5133',
  'https://localhost:44358',
].filter((value, index, array): value is string => Boolean(value) && array.indexOf(value) === index);

let activeBaseUrl = baseUrls[0] ?? 'https://localhost:7019';
const customerAuthStorageKey = 'hotel-customer-auth';

async function executePublic<T>(operation: (baseUrl: string) => Promise<T>) {
  let lastError: unknown;

  for (const baseUrl of [activeBaseUrl, ...baseUrls.filter((url) => url !== activeBaseUrl)]) {
    try {
      const result = await operation(baseUrl);
      activeBaseUrl = baseUrl;
      return result;
    } catch (error) {
      lastError = error;
      if (axios.isAxiosError(error) && error.response) {
        throw error;
      }
    }
  }

  throw lastError;
}

async function executePublicEndpoint<T>(paths: string[], options: { params?: Record<string, unknown> } = {}) {
  let lastError: unknown;

  for (const path of paths) {
    try {
      return await executePublic((baseURL) => axios.get<T>(path, { baseURL, params: options.params }));
    } catch (error) {
      lastError = error;
      if (!axios.isAxiosError(error) || !error.response || ![404, 405].includes(error.response.status)) {
        throw error;
      }
    }
  }

  throw lastError;
}

async function postPublicEndpoint<T>(paths: string[], payload: unknown, options: { headers?: Record<string, string> } = {}) {
  let lastError: unknown;

  for (const path of paths) {
    try {
      return await executePublic((baseURL) => axios.post<T>(path, payload, { baseURL, headers: options.headers }));
    } catch (error) {
      lastError = error;
      if (!axios.isAxiosError(error) || !error.response || ![404, 405].includes(error.response.status)) {
        throw error;
      }
    }
  }

  throw lastError;
}

function normalizeObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeObject);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>((accumulator, [key, item]) => {
    accumulator[key.charAt(0).toUpperCase() + key.slice(1)] = normalizeObject(item);
    return accumulator;
  }, {});
}

function readRaw(raw: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    if (raw[key] !== undefined && raw[key] !== null) {
      return raw[key];
    }
  }

  return '';
}

function mapAuth(raw: Record<string, unknown>, cliente?: PublicReservationPayload['Cliente']): PublicCustomerAuth {
  const roles = readRaw(raw, 'roles', 'Roles');
  return {
    usuarioGuid: String(readRaw(raw, 'usuario_guid', 'Usuario_guid', 'UsuarioGuid')),
    username: String(readRaw(raw, 'username', 'Username')),
    correo: String(readRaw(raw, 'correo', 'Correo')),
    nombres: String(readRaw(raw, 'nombres', 'Nombres')),
    accessToken: String(readRaw(raw, 'access_token', 'Access_token', 'Token')),
    refreshToken: String(readRaw(raw, 'refresh_token', 'Refresh_token', 'RefreshToken')),
    expiresIn: Number(readRaw(raw, 'expires_in', 'Expires_in', 'ExpiresIn') || 0),
    roles: Array.isArray(roles) ? roles.map((role) => String(role).toLowerCase()) : [],
    cliente,
  };
}

export function getStoredPublicCustomerAuth() {
  const raw = localStorage.getItem(customerAuthStorageKey);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as PublicCustomerAuth;
    return parsed.accessToken ? parsed : null;
  } catch {
    localStorage.removeItem(customerAuthStorageKey);
    return null;
  }
}

export function storePublicCustomerAuth(auth: PublicCustomerAuth) {
  localStorage.setItem(customerAuthStorageKey, JSON.stringify(auth));
}

export function clearStoredPublicCustomerAuth() {
  localStorage.removeItem(customerAuthStorageKey);
}

function customerAuthHeaders() {
  const auth = getStoredPublicCustomerAuth();
  return auth?.accessToken ? { Authorization: `Bearer ${auth.accessToken}` } : undefined;
}

export async function loginPublicCustomer(payload: PublicCustomerLoginPayload) {
  const response = await postPublicEndpoint<{ data: Record<string, unknown> }>(
    ['/api/v1/auth/login', '/api/v1/internal/auth/login'],
    payload,
  );
  const auth = mapAuth(response.data.data);
  storePublicCustomerAuth(auth);
  return auth;
}

export async function registerPublicCustomer(payload: PublicCustomerRegisterPayload) {
  const response = await postPublicEndpoint<{ data: Record<string, unknown> }>(
    ['/api/v1/auth/registro-cliente', '/api/v1/auth/register-cliente', '/api/v1/internal/auth/registro-cliente', '/api/v1/internal/auth/register-cliente'],
    payload,
  );
  const auth = mapAuth(response.data.data, {
    TipoIdentificacion: payload.TipoIdentificacion,
    NumeroIdentificacion: payload.NumeroIdentificacion,
    Nombres: payload.Nombres,
    Apellidos: payload.Apellidos,
    RazonSocial: payload.RazonSocial,
    Correo: payload.Correo,
    Telefono: payload.Telefono,
    Direccion: payload.Direccion,
  });
  storePublicCustomerAuth(auth);
  return auth;
}

export async function getPublicBranches() {
  try {
    const response = await executePublicEndpoint<{ data: PublicBranch[] }>(['/api/v1/public/sucursales']);
    return normalizeObject(response.data.data) as PublicBranch[];
  } catch (error) {
    if (!axios.isAxiosError(error) || !error.response || ![404, 405].includes(error.response.status)) {
      throw error;
    }

    const rooms = await searchPublicRooms({});
    const branches = new Map<string, PublicBranch>();

    for (const room of rooms) {
      if (branches.has(room.SucursalGuid)) {
        continue;
      }

      branches.set(room.SucursalGuid, {
        SucursalGuid: room.SucursalGuid,
        CodigoSucursal: '',
        NombreSucursal: room.NombreSucursal,
        DescripcionSucursal: room.DescripcionSucursal,
        DescripcionCorta: room.DescripcionCortaSucursal,
        TipoAlojamiento: room.TipoAlojamiento,
        Pais: room.Pais,
        Ciudad: room.Ciudad,
        Ubicacion: '',
        Direccion: room.Direccion,
        Telefono: '',
        Correo: '',
        CheckinAnticipado: false,
        CheckoutTardio: false,
        AceptaNinos: true,
        PermiteMascotas: false,
        SePermiteFumar: false,
      });
    }

    return Array.from(branches.values());
  }
}

export async function getPublicServices(sucursalGuid?: string) {
  try {
    const response = await executePublicEndpoint<{ data: PublicService[] }>(
      ['/api/v1/public/servicios'],
      { params: sucursalGuid ? { sucursalGuid } : undefined },
    );
    return normalizeObject(response.data.data) as PublicService[];
  } catch (error) {
    if (!axios.isAxiosError(error) || !error.response || ![404, 405].includes(error.response.status)) {
      throw error;
    }

    const rooms = await searchPublicRooms({ sucursalGuid });
    const services = new Map<string, PublicService>();

    for (const room of rooms) {
      for (const service of room.Servicios ?? []) {
        services.set(service.CatalogoGuid || service.Codigo, service);
      }
    }

    return Array.from(services.values());
  }
}

export async function searchPublicRooms(filters: { fechaInicio?: string; fechaFin?: string; sucursalGuid?: string; adultos?: number; ninos?: number; soloCatalogo?: boolean }) {
  const response = await executePublicEndpoint<{ data: PublicRoom[] }>(
    [
      '/api/v1/public/habitaciones',
      '/api/v1/public/accommodations',
    ],
    { params: filters },
  );
  return normalizeObject(response.data.data) as PublicRoom[];
}

export async function createPublicReservation(payload: PublicReservationPayload) {
  const response = await executePublic((baseURL) => axios.post('/api/v1/public/reservas', payload, { baseURL, headers: customerAuthHeaders() }));
  return normalizeObject(response.data);
}

export async function getPublicReservation(reservaGuid: string) {
  const response = await executePublicEndpoint<{ data: PublicReservation }>([`/api/v1/public/reservas/${reservaGuid}`]);
  return normalizeObject(response.data.data) as PublicReservation;
}

export async function simulatePublicPayment(payload: PublicPaymentSimulationPayload) {
  const response = await executePublic((baseURL) => axios.post<{ data: { pago: PublicPayment; factura: PublicReservation['Factura']; reservaGuid: string } }>(
    '/api/v1/public/pagos/simular',
    payload,
    { baseURL },
  ));
  return normalizeObject(response.data.data) as PublicPaymentSimulationResult;
}
