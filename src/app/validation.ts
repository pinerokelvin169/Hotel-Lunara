import type { FieldConfig } from './types';

export class ClientValidationError extends Error {
  details: string[];
  fieldErrors: Record<string, string>;

  constructor(details: string[], fieldErrors: Record<string, string> = {}) {
    super('Corrige los datos del formulario antes de continuar.');
    this.name = 'ClientValidationError';
    this.details = details;
    this.fieldErrors = fieldErrors;
  }
}

type FormMode = 'create' | 'update' | 'action' | 'operation';

interface ValidationContext {
  existingRecords?: Record<string, unknown>[];
  currentRecordId?: unknown;
  idField?: string;
}

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
const phoneCharactersRegex = /^\+?[0-9\s-]{7,30}$/;
const nameRegex = /^[A-Za-z\u00c1\u00c9\u00cd\u00d3\u00da\u00dc\u00d1\u00e1\u00e9\u00ed\u00f3\u00fa\u00fc\u00f1]+(?:[ '-][A-Za-z\u00c1\u00c9\u00cd\u00d3\u00da\u00dc\u00d1\u00e1\u00e9\u00ed\u00f3\u00fa\u00fc\u00f1]+)*$/;
const passportRegex = /^[A-Za-z0-9-]{5,20}$/;
const absoluteHttpUrlRegex = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;
const cloudinaryPublicIdRegex = /^[A-Za-z0-9_./-]+$/;

const maxLengthByField: Record<string, number> = {
  Username: 50,
  UsernameOrEmail: 120,
  usernameOrEmail: 120,
  Password: 128,
  password: 128,
  RefreshToken: 2048,
  Motivo: 500,
  Usuario: 100,
  Estado: 10,
  TipoIdentificacion: 20,
  NumeroIdentificacion: 30,
  Nombres: 120,
  Apellidos: 120,
  RazonSocial: 180,
  Correo: 160,
  Telefono: 30,
  Direccion: 250,
  CodigoSucursal: 20,
  NombreSucursal: 150,
  DescripcionSucursal: 4000,
  DescripcionCorta: 500,
  TipoAlojamiento: 50,
  CategoriaViaje: 50,
  Pais: 80,
  Provincia: 80,
  Ciudad: 80,
  Ubicacion: 250,
  CodigoPostal: 20,
  CodigoTipoHabitacion: 20,
  NombreTipoHabitacion: 100,
  Descripcion: 1500,
  TipoCama: 60,
  NumeroHabitacion: 20,
  DescripcionHabitacion: 1000,
  CodigoTarifa: 20,
  NombreTarifa: 120,
  CanalTarifa: 40,
  CodigoCatalogo: 20,
  NombreCatalogo: 150,
  TipoCatalogo: 60,
  CategoriaCatalogo: 60,
  DescripcionCatalogo: 2000,
  IconoUrl: 500,
  CodigoReserva: 20,
  OrigenCanalReserva: 40,
  Observaciones: 2000,
  MetodoPago: 50,
  ProveedorPasarela: 80,
  TransaccionExterna: 120,
  CodigoAutorizacion: 80,
  Referencia: 120,
  Moneda: 10,
  ComentarioPositivo: 2000,
  ComentarioNegativo: 2000,
  TipoViaje: 50,
  RespuestaHotel: 2000,
  Respuesta: 2000,
  ObservacionesCheckin: 1000,
  ObservacionesCheckout: 1000,
  DescripcionCargo: 1000,
};

const maxByField: Record<string, number> = {
  Estrellas: 5,
  Latitud: 90,
  Longitud: 180,
  EdadMinimaHuesped: 120,
  AreaM2: 10000,
  CapacidadHabitacion: 20,
  PrecioBase: 100000,
  PrecioPorNoche: 100000,
  PorcentajeIva: 100,
  PuntuacionGeneral: 10,
  PuntuacionLimpieza: 10,
  PuntuacionConfort: 10,
  PuntuacionUbicacion: 10,
  PuntuacionInstalaciones: 10,
  PuntuacionPersonal: 10,
  PuntuacionCalidadPrecio: 10,
};

const positiveFields = new Set([
  'IdCliente',
  'IdSucursal',
  'IdTipoHabitacion',
  'IdHabitacion',
  'IdTarifa',
  'IdFactura',
  'IdReserva',
  'IdEstadia',
  'IdCatalogo',
  'ReservaId',
  'EstadiaId',
  'CargoId',
  'CapacidadAdultos',
  'CapacidadTotal',
  'CapacidadHabitacion',
  'PrecioBase',
  'PrecioPorNoche',
  'MinNoches',
  'MaxNoches',
  'Prioridad',
  'Monto',
  'TipoCambio',
  'Cantidad',
]);

const nonNegativeFields = new Set([
  'CapacidadNinos',
  'AreaM2',
  'Piso',
  'SubtotalReserva',
  'ValorIva',
  'TotalReserva',
  'DescuentoAplicado',
  'SaldoPendiente',
  'PrecioUnitario',
]);

function isBlank(value: unknown) {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

function asNumber(value: unknown) {
  if (isBlank(value)) {
    return null;
  }

  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : Number.NaN;
}

function asDate(value: unknown) {
  if (isBlank(value)) {
    return null;
  }

  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function sameMoney(left: number, right: number) {
  return Math.abs(left - right) <= 0.01;
}

function addError(errors: Record<string, string>, details: string[], field: string, message: string) {
  if (!errors[field]) {
    errors[field] = message;
  }
  details.push(message);
}

function hasValidEcuadorProvince(value: string) {
  const province = Number(value.slice(0, 2));
  return (province >= 1 && province <= 24) || province === 30;
}

function isValidEcuadorCedula(value: string) {
  value = value.replace(/\D/g, '');
  if (!/^\d{10}$/.test(value) || !hasValidEcuadorProvince(value)) {
    return false;
  }

  const thirdDigit = Number(value[2]);
  if (thirdDigit >= 6) {
    return false;
  }

  return true;
}

function isValidEcuadorRuc(value: string) {
  value = value.replace(/\D/g, '');
  if (!/^\d{13}$/.test(value) || !hasValidEcuadorProvince(value) || Number(value.slice(10, 13)) === 0) {
    return false;
  }

  const thirdDigit = Number(value[2]);
  return (thirdDigit >= 0 && thirdDigit <= 6) || thirdDigit === 9;
}

export function normalizeClientValues(values: Record<string, unknown>) {
  return Object.entries(values).reduce<Record<string, unknown>>((accumulator, [key, value]) => {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      accumulator[key] = key.toLowerCase().includes('correo') || key.toLowerCase().includes('email') ? trimmed.toLowerCase() : trimmed;
      return accumulator;
    }

    accumulator[key] = value;
    return accumulator;
  }, {});
}

function validateIdentity(values: Record<string, unknown>, errors: Record<string, string>, details: string[]) {
  const type = String(values.TipoIdentificacion ?? '').trim().toUpperCase();
  const number = String(values.NumeroIdentificacion ?? '').trim();

  if (!type || !number) {
    return;
  }

  if (['CED', 'CEDULA', 'CÉDULA'].includes(type) && !isValidEcuadorCedula(number)) {
    addError(errors, details, 'NumeroIdentificacion', 'La cedula no es valida.');
  }

  if (type === 'RUC' && !isValidEcuadorRuc(number)) {
    addError(errors, details, 'NumeroIdentificacion', 'El RUC no es valido.');
  }

  if (['PAS', 'PASAPORTE'].includes(type) && !passportRegex.test(number)) {
    addError(errors, details, 'NumeroIdentificacion', 'El pasaporte debe ser alfanumerico y tener entre 5 y 20 caracteres.');
  }
}

function isValidEcuadorPhone(value: string) {
  if (!phoneCharactersRegex.test(value)) {
    return false;
  }

  const compact = value.replace(/[\s-]/g, '');

  if (/^09\d{8}$/.test(compact)) {
    return true;
  }

  if (/^0[2-7]\d{7}$/.test(compact)) {
    return true;
  }

  if (/^\+5939\d{8}$/.test(compact)) {
    return true;
  }

  return /^\+593[2-7]\d{7}$/.test(compact);
}

function validateDateRange(
  values: Record<string, unknown>,
  startField: string,
  endField: string,
  errors: Record<string, string>,
  details: string[],
  options: { strict?: boolean; noPastStart?: boolean; maxDays?: number } = {},
) {
  const start = asDate(values[startField]);
  const end = asDate(values[endField]);

  if (!start || !end) {
    return;
  }

  const validOrder = options.strict ? end.getTime() > start.getTime() : end.getTime() >= start.getTime();
  if (!validOrder) {
    addError(errors, details, endField, `${endField} debe ser ${options.strict ? 'mayor' : 'mayor o igual'} que ${startField}.`);
  }

  if (options.noPastStart) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (start.getTime() < today.getTime()) {
      addError(errors, details, startField, `${startField} no puede estar en el pasado.`);
    }
  }

  if (options.maxDays && end.getTime() > start.getTime()) {
    const days = (end.getTime() - start.getTime()) / 86_400_000;
    if (days > options.maxDays) {
      addError(errors, details, endField, `El rango entre ${startField} y ${endField} no puede superar ${options.maxDays} dias.`);
    }
  }
}

function validateHabitacionesJson(values: Record<string, unknown>, errors: Record<string, string>, details: string[]) {
  let habitaciones = values.Habitaciones;

  if (typeof habitaciones === 'string') {
    try {
      habitaciones = JSON.parse(habitaciones);
    } catch {
      addError(errors, details, 'Habitaciones', 'Habitaciones debe tener JSON valido.');
      return;
    }
  }

  if (!Array.isArray(habitaciones)) {
    addError(errors, details, 'Habitaciones', 'Habitaciones debe ser un arreglo JSON valido.');
    return;
  }

  if (habitaciones.length === 0) {
    addError(errors, details, 'Habitaciones', 'Debes registrar al menos una habitacion en la reserva.');
    return;
  }

  const reservaInicio = asDate(values.FechaInicio);
  const reservaFin = asDate(values.FechaFin);

  habitaciones.forEach((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      addError(errors, details, 'Habitaciones', `La habitacion #${index + 1} debe ser un objeto JSON.`);
      return;
    }

    const room = item as Record<string, unknown>;
    const idHabitacion = asNumber(room.IdHabitacion);
    const adultos = asNumber(room.NumAdultos);
    const ninos = asNumber(room.NumNinos);
    const subtotal = asNumber(room.SubtotalLinea) ?? 0;
    const iva = asNumber(room.ValorIvaLinea) ?? 0;
    const descuento = asNumber(room.DescuentoLinea) ?? 0;
    const total = asNumber(room.TotalLinea) ?? 0;
    const inicio = asDate(room.FechaInicio);
    const fin = asDate(room.FechaFin);
    const tarifaInicio = asDate(room.FechaInicioTarifa ?? room.TarifaFechaInicio);
    const tarifaFin = asDate(room.FechaFinTarifa ?? room.TarifaFechaFin);
    const estadoTarifa = String(room.EstadoTarifa ?? room.TarifaEstado ?? '').toUpperCase();
    const tarifaActiva = room.TarifaActiva;

    if (!idHabitacion || idHabitacion <= 0) {
      addError(errors, details, 'Habitaciones', `La habitacion #${index + 1} debe tener IdHabitacion mayor a 0.`);
    }
    if (room.IdTarifa !== undefined && room.IdTarifa !== null && room.IdTarifa !== '' && Number(room.IdTarifa) <= 0) {
      addError(errors, details, 'Habitaciones', `La habitacion #${index + 1} debe tener IdTarifa mayor a 0.`);
    }
    if (!adultos || adultos <= 0) {
      addError(errors, details, 'Habitaciones', `La habitacion #${index + 1} debe tener al menos un adulto.`);
    }
    if (ninos === null || Number.isNaN(ninos) || ninos < 0) {
      addError(errors, details, 'Habitaciones', `La habitacion #${index + 1} no puede tener ninos negativos.`);
    }
    if (adultos && ninos !== null && adultos + ninos > 20) {
      addError(errors, details, 'Habitaciones', `La habitacion #${index + 1} supera la ocupacion maxima de 20 personas.`);
    }
    if (!inicio || !fin || fin.getTime() <= inicio.getTime()) {
      addError(errors, details, 'Habitaciones', `La habitacion #${index + 1} debe tener FechaFin mayor que FechaInicio.`);
    }
    if (reservaInicio && reservaFin && inicio && fin && (inicio < reservaInicio || fin > reservaFin)) {
      addError(errors, details, 'Habitaciones', `Las fechas de la habitacion #${index + 1} deben estar dentro del rango de la reserva.`);
    }
    if (estadoTarifa && estadoTarifa !== 'ACT') {
      addError(errors, details, 'Habitaciones', `La tarifa de la habitacion #${index + 1} debe estar activa.`);
    }
    if (tarifaActiva === false) {
      addError(errors, details, 'Habitaciones', `La tarifa de la habitacion #${index + 1} no puede estar inactiva.`);
    }
    if (inicio && fin && tarifaInicio && tarifaFin && (inicio < tarifaInicio || fin > tarifaFin)) {
      addError(errors, details, 'Habitaciones', `Las fechas de la habitacion #${index + 1} deben estar dentro del rango vigente de la tarifa.`);
    }
    if (descuento > subtotal) {
      addError(errors, details, 'Habitaciones', `El descuento de la habitacion #${index + 1} no puede superar su subtotal.`);
    }
    if (!sameMoney(subtotal + iva - descuento, total)) {
      addError(errors, details, 'Habitaciones', `El total de la habitacion #${index + 1} debe ser SubtotalLinea + ValorIvaLinea - DescuentoLinea.`);
    }
  });
}

function validatePaymentDuplicates(
  values: Record<string, unknown>,
  errors: Record<string, string>,
  details: string[],
  context: ValidationContext,
) {
  if (!context.existingRecords?.length) {
    return;
  }

  const externalTransaction = String(values.TransaccionExterna ?? '').trim().toLowerCase();
  const authorizationCode = String(values.CodigoAutorizacion ?? '').trim().toLowerCase();

  if (!externalTransaction && !authorizationCode) {
    return;
  }

  const hasDuplicateExternalTransaction = context.existingRecords.some((record) => {
    const recordId = context.idField ? record[context.idField] : undefined;
    if (context.currentRecordId !== undefined && String(recordId) === String(context.currentRecordId)) {
      return false;
    }

    const recordExternalTransaction = String(record.TransaccionExterna ?? '').trim().toLowerCase();
    return Boolean(externalTransaction && recordExternalTransaction === externalTransaction);
  });

  const hasDuplicateAuthorizationCode = context.existingRecords.some((record) => {
    const recordId = context.idField ? record[context.idField] : undefined;
    if (context.currentRecordId !== undefined && String(recordId) === String(context.currentRecordId)) {
      return false;
    }

    const recordAuthorizationCode = String(record.CodigoAutorizacion ?? '').trim().toLowerCase();
    return Boolean(authorizationCode && recordAuthorizationCode === authorizationCode);
  });

  if (hasDuplicateExternalTransaction) {
    addError(errors, details, 'TransaccionExterna', 'Ya existe un pago visible con la misma transaccion externa.');
  }

  if (hasDuplicateAuthorizationCode) {
    addError(errors, details, 'CodigoAutorizacion', 'Ya existe un pago visible con el mismo codigo de autorizacion.');
  }
}

function validateBusinessRules(
  scope: string,
  values: Record<string, unknown>,
  errors: Record<string, string>,
  details: string[],
  context: ValidationContext,
) {
  validateIdentity(values, errors, details);

  if ('FechaInicio' in values && 'FechaFin' in values) {
    validateDateRange(values, 'FechaInicio', 'FechaFin', errors, details, {
      strict: ['reservas'].includes(scope),
      noPastStart: ['reservas'].includes(scope),
      maxDays: ['reservas'].includes(scope) ? 365 : undefined,
    });
  }

  if (scope === 'tarifas') {
    validateDateRange(values, 'FechaInicio', 'FechaFin', errors, details);
    const min = asNumber(values.MinNoches);
    const max = asNumber(values.MaxNoches);
    if (min && max && max < min) {
      addError(errors, details, 'MaxNoches', 'Max noches debe ser mayor o igual a Min noches.');
    }
  }

  if (scope === 'tipos-habitacion') {
    const adultos = asNumber(values.CapacidadAdultos) ?? 0;
    const ninos = asNumber(values.CapacidadNinos) ?? 0;
    const total = asNumber(values.CapacidadTotal) ?? 0;
    if (total < adultos + ninos) {
      addError(errors, details, 'CapacidadTotal', 'La capacidad total debe ser mayor o igual a adultos + ninos.');
    }
  }

  if (scope === 'catalogo-servicios') {
    if (values.IconoUrl && !absoluteHttpUrlRegex.test(String(values.IconoUrl)) && !cloudinaryPublicIdRegex.test(String(values.IconoUrl))) {
      addError(errors, details, 'IconoUrl', 'Icono URL debe ser una URL absoluta http/https o un Public ID de Cloudinary.');
    }

    if (values.Disponible24h && (values.HoraInicio || values.HoraFin)) {
      addError(errors, details, 'HoraInicio', 'Si el servicio esta disponible 24h no debes indicar hora inicio o fin.');
    }

    if (!values.Disponible24h && (!values.HoraInicio || !values.HoraFin)) {
      addError(errors, details, 'HoraInicio', 'Si el servicio no es 24h debes indicar hora inicio y hora fin.');
    }

    if (!values.Disponible24h && values.HoraInicio && values.HoraFin && String(values.HoraFin) <= String(values.HoraInicio)) {
      addError(errors, details, 'HoraFin', 'Hora fin debe ser mayor que Hora inicio.');
    }
  }

  if (scope === 'reservas') {
    validateHabitacionesJson(values, errors, details);
    const subtotal = asNumber(values.SubtotalReserva) ?? 0;
    const iva = asNumber(values.ValorIva) ?? 0;
    const descuento = asNumber(values.DescuentoAplicado) ?? 0;
    const total = asNumber(values.TotalReserva) ?? 0;
    const saldo = asNumber(values.SaldoPendiente) ?? 0;

    if (descuento > subtotal) {
      addError(errors, details, 'DescuentoAplicado', 'El descuento no puede superar el subtotal de la reserva.');
    }
    if (!sameMoney(subtotal + iva - descuento, total)) {
      addError(errors, details, 'TotalReserva', 'Total reserva debe ser Subtotal + IVA - Descuento.');
    }
    if (saldo > total) {
      addError(errors, details, 'SaldoPendiente', 'El saldo pendiente no puede superar el total de la reserva.');
    }
  }

  if (scope === 'pagos') {
    validatePaymentDuplicates(values, errors, details, context);

    const fechaPago = asDate(values.FechaPagoUtc);
    if (fechaPago && fechaPago.getTime() > Date.now()) {
      addError(errors, details, 'FechaPagoUtc', 'La fecha de pago no puede estar en el futuro.');
    }

    if (values.Moneda && !['USD', 'EUR'].includes(String(values.Moneda).toUpperCase())) {
      addError(errors, details, 'Moneda', 'La moneda debe estar en el catalogo permitido: USD o EUR.');
    }
  }

  if (scope === 'crear-cargo') {
    const fechaConsumo = asDate(values.FechaConsumoUtc);
    if (fechaConsumo && fechaConsumo.getTime() > Date.now()) {
      addError(errors, details, 'FechaConsumoUtc', 'La fecha de consumo no puede estar en el futuro.');
    }
  }
}

export function validateClientForm(
  scope: string,
  fields: FieldConfig[],
  values: Record<string, unknown>,
  mode: FormMode = 'create',
  context: ValidationContext = {},
) {
  void mode;
  const errors: Record<string, string> = {};
  const details: string[] = [];

  for (const field of fields) {
    const value = values[field.name];

    if (field.required && isBlank(value)) {
      addError(errors, details, field.name, `${field.label} es requerido.`);
      continue;
    }

    if (isBlank(value)) {
      continue;
    }

    const maxLength = field.maxLength ?? maxLengthByField[field.name];
    if (maxLength && String(value).trim().length > maxLength) {
      addError(errors, details, field.name, `${field.label} no puede superar ${maxLength} caracteres.`);
    }

    if (field.type === 'email' && !emailRegex.test(String(value).trim())) {
      addError(errors, details, field.name, `${field.label} debe ser un correo valido.`);
    }

    if (field.type === 'number') {
      const numberValue = asNumber(value);
      if (numberValue === null || Number.isNaN(numberValue)) {
        addError(errors, details, field.name, `${field.label} debe ser un numero valido.`);
        continue;
      }

      const min = field.min ?? (positiveFields.has(field.name) ? 0 : nonNegativeFields.has(field.name) ? 0 : undefined);
      const max = field.max ?? maxByField[field.name];
      const allowsZero = scope === 'catalogo-servicios' && field.name === 'PrecioBase';
      if (positiveFields.has(field.name) && !allowsZero && numberValue <= 0) {
        addError(errors, details, field.name, `${field.label} debe ser mayor a 0.`);
      } else if (min !== undefined && numberValue < min) {
        addError(errors, details, field.name, `${field.label} debe ser mayor o igual a ${min}.`);
      }
      if (max !== undefined && numberValue > max) {
        addError(errors, details, field.name, `${field.label} no puede ser mayor a ${max}.`);
      }
    }

    if ((field.type === 'date' || field.type === 'datetime-local') && !asDate(value)) {
      addError(errors, details, field.name, `${field.label} debe tener una fecha valida.`);
    }

    if (field.type === 'select' && field.options?.length && !field.options.some((option) => String(option.value) === String(value))) {
      addError(errors, details, field.name, `${field.label} no tiene un valor permitido.`);
    }

    if (field.type === 'json') {
      try {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        if (!Array.isArray(parsed)) {
          addError(errors, details, field.name, `${field.label} debe ser un arreglo JSON.`);
        }
      } catch {
        addError(errors, details, field.name, `${field.label} debe tener JSON valido.`);
      }
    }

    if ((field.name === 'Nombres' || field.name === 'Apellidos') && !nameRegex.test(String(value).trim())) {
      addError(errors, details, field.name, `${field.label} solo debe contener nombres validos.`);
    }

    if (field.name === 'Telefono' && !isValidEcuadorPhone(String(value).trim())) {
      addError(errors, details, field.name, 'Telefono debe ser ecuatoriano valido: 09XXXXXXXX, 0[2-7]XXXXXXX o +593...');
    }
  }

  if (values.Password && String(values.Password) !== String(values.Password).trim()) {
    addError(errors, details, 'Password', 'La contrasena no puede tener espacios al inicio o al final.');
  }

  if (values.Password && String(values.Password).length < 8) {
    addError(errors, details, 'Password', 'La contrasena debe tener al menos 8 caracteres.');
  }

  if (values.Password && !/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s]).{8,128}$/.test(String(values.Password))) {
    addError(errors, details, 'Password', 'La contrasena debe tener mayuscula, minuscula, numero y simbolo.');
  }

  if (values.Password && values.Username && String(values.Password).toLowerCase() === String(values.Username).toLowerCase()) {
    addError(errors, details, 'Password', 'La contrasena no puede ser igual al usuario.');
  }

  if (values.Password && values.Correo && String(values.Password).toLowerCase() === String(values.Correo).toLowerCase()) {
    addError(errors, details, 'Password', 'La contrasena no puede ser igual al correo.');
  }

  validateBusinessRules(scope, values, errors, details, context);

  if (details.length > 0) {
    throw new ClientValidationError(details, errors);
  }
}
