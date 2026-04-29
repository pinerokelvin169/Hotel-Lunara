import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { createRecord, deleteRecord, fetchPaged, getApiErrorDetails, getApiErrorMessage, runAction, updateRecord } from '../app/api';
import { getResourceConfig } from '../app/modules';
import type { ActionConfig, FieldConfig } from '../app/types';
import { ClientValidationError, normalizeClientValues, validateClientForm } from '../app/validation';
import { useAuth } from '../auth/useAuth';
import { Modal } from '../components/Modal';
import { StatusMessage } from '../components/StatusMessage';
import { cloudinaryImage } from '../customer/cloudinary';

type GenericRecord = Record<string, unknown>;

function coerceValue(field: FieldConfig, rawValue: unknown) {
  if (field.type === 'checkbox') {
    return Boolean(rawValue);
  }

  if (rawValue === null || rawValue === undefined) {
    return '';
  }

  if (field.type === 'json' && typeof rawValue !== 'string') {
    return JSON.stringify(rawValue, null, 2);
  }

  if (field.type === 'datetime-local' && typeof rawValue === 'string' && rawValue.length >= 16) {
    return rawValue.slice(0, 16);
  }

  return String(rawValue);
}

function buildInitialState(fields: FieldConfig[], record: GenericRecord | null, defaults: Record<string, unknown>) {
  const base = record ? { ...record } : { ...defaults };

  for (const field of fields) {
    base[field.name] = coerceValue(field, base[field.name]);
  }

  return base;
}

function normalizePayload(fields: FieldConfig[], values: Record<string, unknown>) {
  const payload = { ...values };

  for (const field of fields) {
    const current = payload[field.name];

    if (field.type === 'checkbox') {
      payload[field.name] = Boolean(current);
      continue;
    }

    if (field.type === 'number') {
      payload[field.name] = current === '' || current === null || current === undefined ? null : Number(current);
      continue;
    }

    if (field.type === 'json') {
      payload[field.name] = typeof current === 'string' ? (current.trim() ? JSON.parse(current) : []) : current;
      continue;
    }

    if (current === '') {
      payload[field.name] = null;
      continue;
    }

    payload[field.name] = current;
  }

  return payload;
}

function normalizeReservationFormValues(values: Record<string, unknown>) {
  const habitaciones = values.Habitaciones;

  return {
    ...values,
    Habitaciones: Array.isArray(habitaciones) ? habitaciones : typeof habitaciones === 'string' && habitaciones.trim() ? JSON.parse(habitaciones) : [],
  };
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function formatDateTimeLocal(date: Date) {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(0, 16);
}

function formatDateInput(date: Date) {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(0, 10);
}

function toDateTimeLocalValue(value: unknown) {
  if (!value) {
    return '';
  }

  const text = String(value);
  return text.length >= 16 ? text.slice(0, 16) : text;
}

function generateReservationCode() {
  const now = new Date();
  const stamp = now.toISOString().replace(/\D/g, '').slice(0, 14);
  return `RSV-${stamp.slice(0, 8)}-${stamp.slice(8, 14)}`;
}

function generateTariffCode(tarifas: GenericRecord[]) {
  const today = new Date();
  const datePart = today.toISOString().slice(2, 10).replace(/\D/g, '');
  const prefix = `TAR${datePart}`;
  const sequence = tarifas
    .map((tarifa) => String(tarifa.CodigoTarifa ?? ''))
    .filter((code) => code.startsWith(prefix))
    .map((code) => Number(code.slice(prefix.length)))
    .filter((value) => Number.isFinite(value));
  const next = sequence.length > 0 ? Math.max(...sequence) + 1 : 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}

function recordText(record: GenericRecord, keys: readonly string[], fallbackKey: string) {
  const parts = keys.map((key) => record[key]).filter((value) => value !== null && value !== undefined && String(value).trim() !== '');
  return parts.length > 0 ? parts.map(String).join(' ') : `#${String(record[fallbackKey] ?? '')}`;
}

function extractDataArray(value: unknown): GenericRecord[] {
  if (Array.isArray(value)) {
    return value as GenericRecord[];
  }

  if (value && typeof value === 'object' && Array.isArray((value as GenericRecord).Data)) {
    return (value as { Data: GenericRecord[] }).Data;
  }

  if (value && typeof value === 'object' && Array.isArray((value as GenericRecord).data)) {
    return (value as { data: GenericRecord[] }).data;
  }

  return [];
}

function isPayableInvoice(invoice: GenericRecord) {
  const state = String(invoice.Estado ?? '').toUpperCase();
  const balance = toNumber(invoice.SaldoPendiente);
  return balance > 0 && !['ANU', 'CAN', 'PAG', 'PAGADA'].includes(state);
}

function invoiceLabel(invoice: GenericRecord) {
  const number = String(invoice.NumeroFactura ?? `#${String(invoice.IdFactura ?? '')}`);
  const reserva = invoice.IdReserva ? `Reserva ${String(invoice.IdReserva)}` : 'Sin reserva';
  const balance = toNumber(invoice.SaldoPendiente).toFixed(2);
  const currency = String(invoice.Moneda ?? 'USD');
  return `${number} - ${reserva} - saldo ${currency} ${balance}`;
}

function normalizedState(value: unknown) {
  return String(value ?? '').trim().toUpperCase();
}

function isClosedForRowActions(moduleKey: string, record: GenericRecord) {
  if (moduleKey === 'reservas') {
    return normalizedState(record.EstadoReserva) === 'CON';
  }

  if (moduleKey === 'pagos') {
    return ['AP', 'APR', 'APROBADO'].includes(normalizedState(record.EstadoPago));
  }

  if (moduleKey === 'facturas') {
    return ['PAG', 'PAGADA'].includes(normalizedState(record.Estado));
  }

  return false;
}

function isActionAvailableForRecord(moduleKey: string, action: ActionConfig<GenericRecord>, record: GenericRecord) {
  if (isClosedForRowActions(moduleKey, record)) {
    return false;
  }

  if (moduleKey === 'reservas') {
    const state = normalizedState(record.EstadoReserva);
    if (action.key === 'confirmar') {
      return state === 'PEN';
    }
    if (action.key === 'cancelar') {
      return state === 'PEN';
    }
  }

  if (moduleKey === 'facturas' && action.key === 'anular-factura') {
    return !['PAG', 'PAGADA', 'ANU', 'ANULADA'].includes(normalizedState(record.Estado));
  }

  return true;
}

function floorOptions(habitaciones: GenericRecord[]) {
  const existingFloors = habitaciones
    .map((habitacion) => toNumber(habitacion.Piso, Number.NaN))
    .filter((piso) => Number.isFinite(piso) && piso >= 0);
  const baseFloors = Array.from({ length: 21 }, (_item, index) => index);
  return Array.from(new Set([...baseFloors, ...existingFloors])).sort((left, right) => left - right);
}

function nextRoomNumber(habitaciones: GenericRecord[], idSucursal: unknown, piso: unknown, currentId?: unknown) {
  const selectedSucursal = String(idSucursal ?? '');
  const selectedFloor = toNumber(piso, 0);
  const floorRooms = habitaciones.filter((habitacion) => {
    if (currentId !== undefined && String(habitacion.IdHabitacion ?? '') === String(currentId)) {
      return false;
    }

    return String(habitacion.IdSucursal ?? '') === selectedSucursal && toNumber(habitacion.Piso, 0) === selectedFloor;
  });
  const numericRoomNumbers = floorRooms
    .map((habitacion) => Number(String(habitacion.NumeroHabitacion ?? '').replace(/\D/g, '')))
    .filter((number) => Number.isFinite(number) && number > 0);
  const baseNumber = selectedFloor > 0 ? selectedFloor * 100 : 0;
  const nextNumber = numericRoomNumbers.length > 0 ? Math.max(...numericRoomNumbers) + 1 : baseNumber + 1;
  return String(nextNumber).padStart(selectedFloor > 0 ? 3 : 2, '0');
}

function nextTariffPriority(tarifas: GenericRecord[], idSucursal: unknown, idTipoHabitacion: unknown, currentId?: unknown) {
  const selectedSucursal = String(idSucursal ?? '');
  const selectedType = String(idTipoHabitacion ?? '');
  const priorities = tarifas
    .filter((tarifa) => {
      if (currentId !== undefined && String(tarifa.IdTarifa ?? '') === String(currentId)) {
        return false;
      }

      return String(tarifa.IdSucursal ?? '') === selectedSucursal && String(tarifa.IdTipoHabitacion ?? '') === selectedType;
    })
    .map((tarifa) => toNumber(tarifa.Prioridad, Number.NaN))
    .filter((priority) => Number.isFinite(priority) && priority > 0);

  return priorities.length > 0 ? Math.max(...priorities) + 1 : 1;
}

type ReservationRoomLine = {
  localId: string;
  IdHabitacion: string;
  IdTarifa: string;
  NumAdultos: number;
  NumNinos: number;
  PrecioNocheAplicado: number;
  SubtotalLinea: number;
  ValorIvaLinea: number;
  DescuentoLinea: number;
};

const catalogServiceTypes = [
  { label: 'Amenidad', value: 'AME' },
  { label: 'Servicio', value: 'SRV' },
];

const catalogServiceCategories = [
  { label: 'Habitacion', value: 'HABITACION' },
  { label: 'Alimentos y bebidas', value: 'ALIMENTOS_BEBIDAS' },
  { label: 'Spa y bienestar', value: 'SPA' },
  { label: 'Transporte', value: 'TRANSPORTE' },
  { label: 'Lavanderia', value: 'LAVANDERIA' },
  { label: 'Eventos', value: 'EVENTOS' },
  { label: 'Otros', value: 'OTROS' },
];

const relationLookups = {
  IdCliente: {
    path: '/api/v1/internal/clientes',
    idField: 'IdCliente',
    labelKeys: ['RazonSocial', 'Nombres', 'Apellidos', 'NumeroIdentificacion'],
  },
  IdSucursal: {
    path: '/api/v1/internal/sucursales',
    idField: 'IdSucursal',
    labelKeys: ['NombreSucursal', 'Ciudad'],
  },
  IdTipoHabitacion: {
    path: '/api/v1/internal/tipos-habitacion',
    idField: 'IdTipoHabitacion',
    labelKeys: ['NombreTipoHabitacion', 'TipoCama', 'CapacidadTotal'],
  },
  IdHabitacion: {
    path: '/api/v1/internal/habitaciones',
    idField: 'IdHabitacion',
    labelKeys: ['NumeroHabitacion', 'DescripcionHabitacion', 'EstadoHabitacion'],
  },
  IdFactura: {
    path: '/api/v1/internal/facturas',
    idField: 'IdFactura',
    labelKeys: ['NumeroFactura', 'Estado', 'Total'],
  },
  IdReserva: {
    path: '/api/v1/internal/reservas',
    idField: 'IdReserva',
    labelKeys: ['CodigoReserva', 'EstadoReserva'],
  },
  IdCatalogo: {
    path: '/api/v1/internal/catalogo-servicios',
    idField: 'IdCatalogo',
    labelKeys: ['NombreCatalogo', 'CodigoCatalogo', 'TipoCatalogo'],
  },
  IdUsuario: {
    path: '/api/v1/internal/usuarios',
    idField: 'IdUsuario',
    labelKeys: ['Nombres', 'Apellidos', 'Username'],
  },
  IdRol: {
    path: '/api/v1/internal/roles',
    idField: 'IdRol',
    labelKeys: ['NombreRol', 'DescripcionRol'],
  },
} as const;

type RelationKey = keyof typeof relationLookups;

function isRelationKey(value: string): value is RelationKey {
  return value in relationLookups;
}

function buildLookup(records: GenericRecord[], idField: string, labelKeys: readonly string[]) {
  const lookup = new Map<string, string>();

  for (const record of records) {
    const id = record[idField];
    if (id === null || id === undefined || String(id).trim() === '') {
      continue;
    }

    lookup.set(String(id), recordText(record, labelKeys, idField));
  }

  return lookup;
}

function FormFields({
  fields,
  values,
  errors = {},
  onChange,
}: {
  fields: FieldConfig[];
  values: Record<string, unknown>;
  errors?: Record<string, string>;
  onChange: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
}) {
  return (
    <div className="form-grid">
      {fields.map((field) => {
        const value = values[field.name];
        const commonProps = {
          id: field.name,
          name: field.name,
          required: field.required,
          placeholder: field.placeholder,
        };

        return (
          <label key={field.name} className={`field ${field.type === 'textarea' || field.type === 'json' ? 'field-span-2' : ''}`}>
            <span>{field.label}</span>
            {field.type === 'textarea' ? (
              <textarea
                {...commonProps}
                value={String(value ?? '')}
                onChange={(event) => onChange((previous) => ({ ...previous, [field.name]: event.target.value }))}
                rows={4}
              />
            ) : null}

            {field.type === 'json' ? (
              <textarea
                {...commonProps}
                value={String(value ?? '[]')}
                onChange={(event) => onChange((previous) => ({ ...previous, [field.name]: event.target.value }))}
                rows={8}
              />
            ) : null}

            {field.type === 'select' ? (
              <select
                {...commonProps}
                value={String(value ?? '')}
                onChange={(event) => onChange((previous) => ({ ...previous, [field.name]: event.target.value }))}
              >
                <option value="">Selecciona</option>
                {field.options?.map((option) => (
                  <option key={`${field.name}-${option.value}`} value={String(option.value)}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : null}

            {field.type === 'checkbox' ? (
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={Boolean(value)}
                  onChange={(event) => onChange((previous) => ({ ...previous, [field.name]: event.target.checked }))}
                />
                <span>{field.helpText ?? field.label}</span>
              </label>
            ) : null}

            {!['textarea', 'json', 'select', 'checkbox'].includes(field.type) ? (
              <input
                {...commonProps}
                type={field.type}
                min={field.min}
                max={field.max}
                step={field.step}
                maxLength={field.maxLength}
                value={String(value ?? '')}
                onChange={(event) => onChange((previous) => ({ ...previous, [field.name]: event.target.value }))}
              />
            ) : null}

            {field.helpText && field.type !== 'checkbox' ? <small>{field.helpText}</small> : null}
            {errors[field.name] ? <small className="field-error">{errors[field.name]}</small> : null}
          </label>
        );
      })}
    </div>
  );
}

function ActionForm({
  fields,
  onSubmit,
  isPending,
}: {
  fields: FieldConfig[];
  onSubmit: (values: Record<string, unknown>) => void;
  isPending: boolean;
}) {
  const [values, setValues] = useState(() => buildInitialState(fields, null, {}));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [details, setDetails] = useState<string[]>([]);

  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        setErrors({});
        setDetails([]);
        try {
          const normalized = normalizeClientValues(normalizePayload(fields, values));
          validateClientForm('action', fields, normalized, 'action');
          onSubmit(normalized);
        } catch (error) {
          if (error instanceof ClientValidationError) {
            setErrors(error.fieldErrors);
            setDetails(error.details);
            return;
          }

          throw error;
        }
      }}
    >
      <FormFields fields={fields} values={values} errors={errors} onChange={setValues} />
      {details.length > 0 ? (
        <StatusMessage kind="error" title="Corrige los datos de la accion." details={details} />
      ) : null}
      <button type="submit" className="primary-button" disabled={isPending}>
        {isPending ? 'Procesando...' : 'Guardar accion'}
      </button>
    </form>
  );
}

function ResourceForm({
  fields,
  defaults,
  record,
  onSubmit,
  isPending,
  errors,
}: {
  fields: FieldConfig[];
  defaults: Record<string, unknown>;
  record: GenericRecord | null;
  onSubmit: (values: Record<string, unknown>) => void;
  isPending: boolean;
  errors?: Record<string, string>;
}) {
  const activeFields = useMemo(
    () =>
      fields.filter((field) => {
        if (record && field.createOnly) {
          return false;
        }

        if (!record && field.updateOnly) {
          return false;
        }

        return true;
      }),
    [fields, record],
  );

  const [values, setValues] = useState(() => buildInitialState(activeFields, record, defaults));

  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(values);
      }}
    >
      <FormFields fields={activeFields} values={values} errors={errors} onChange={setValues} />
      <button type="submit" className="primary-button" disabled={isPending}>
        {isPending ? 'Guardando...' : 'Guardar'}
      </button>
    </form>
  );
}

function ReservationForm({
  record,
  onSubmit,
  isPending,
  errors,
}: {
  record: GenericRecord | null;
  onSubmit: (values: Record<string, unknown>) => void;
  isPending: boolean;
  errors?: Record<string, string>;
}) {
  const now = useMemo(() => new Date(), []);
  const [values, setValues] = useState<Record<string, unknown>>({
    CodigoReserva: record?.CodigoReserva ?? generateReservationCode(),
    IdCliente: record?.IdCliente ?? '',
    IdSucursal: record?.IdSucursal ?? '',
    FechaReservaUtc: toDateTimeLocalValue(record?.FechaReservaUtc) || formatDateTimeLocal(now),
    FechaInicio: toDateTimeLocalValue(record?.FechaInicio),
    FechaFin: toDateTimeLocalValue(record?.FechaFin),
    SubtotalReserva: record?.SubtotalReserva ?? 0,
    ValorIva: record?.ValorIva ?? 0,
    TotalReserva: record?.TotalReserva ?? 0,
    DescuentoAplicado: record?.DescuentoAplicado ?? 0,
    SaldoPendiente: record?.SaldoPendiente ?? 0,
    OrigenCanalReserva: record?.OrigenCanalReserva ?? 'BACKOFFICE',
    EstadoReserva: record?.EstadoReserva ?? 'PEN',
    Observaciones: record?.Observaciones ?? '',
    EsWalkin: record?.EsWalkin ?? false,
  });
  const [rooms, setRooms] = useState<ReservationRoomLine[]>([
    {
      localId: crypto.randomUUID(),
      IdHabitacion: '',
      IdTarifa: '',
      NumAdultos: 1,
      NumNinos: 0,
      PrecioNocheAplicado: 0,
      SubtotalLinea: 0,
      ValorIvaLinea: 0,
      DescuentoLinea: 0,
    },
  ]);

  const clientesQuery = useQuery({
    queryKey: ['reservation-options', 'clientes'],
    queryFn: () => fetchPaged<GenericRecord>('/api/v1/internal/clientes', 1, 100),
  });
  const sucursalesQuery = useQuery({
    queryKey: ['reservation-options', 'sucursales'],
    queryFn: () => fetchPaged<GenericRecord>('/api/v1/internal/sucursales', 1, 100),
  });
  const habitacionesQuery = useQuery({
    queryKey: ['reservation-options', 'habitaciones'],
    queryFn: () => fetchPaged<GenericRecord>('/api/v1/internal/habitaciones', 1, 100),
  });
  const tarifasQuery = useQuery({
    queryKey: ['reservation-options', 'tarifas'],
    queryFn: () => fetchPaged<GenericRecord>('/api/v1/internal/tarifas', 1, 100),
  });
  const reservationRoomsQuery = useQuery({
    queryKey: ['reservation-options', 'reserva-habitaciones', record?.IdReserva],
    enabled: Boolean(record?.IdReserva),
    queryFn: () => runAction('get', `/api/v1/internal/reservas/${record!.IdReserva}/habitaciones`),
  });

  const clientes = clientesQuery.data?.data ?? [];
  const sucursales = sucursalesQuery.data?.data ?? [];
  const habitaciones = habitacionesQuery.data?.data ?? [];
  const tarifas = tarifasQuery.data?.data ?? [];
  const selectedSucursalId = String(values.IdSucursal ?? '');
  const totalReserva = roundMoney(toNumber(values.SubtotalReserva) + toNumber(values.ValorIva) - toNumber(values.DescuentoAplicado));
  const isLoadingOptions = clientesQuery.isLoading || sucursalesQuery.isLoading || habitacionesQuery.isLoading || tarifasQuery.isLoading;

  useEffect(() => {
    if (!record?.IdReserva || reservationRoomsQuery.isLoading) {
      return;
    }

    const details = extractDataArray(reservationRoomsQuery.data);
    if (details.length === 0) {
      return;
    }

    queueMicrotask(() => {
      setRooms(
        details.map((detail) => ({
          localId: crypto.randomUUID(),
          IdHabitacion: String(detail.IdHabitacion ?? ''),
          IdTarifa: detail.IdTarifa ? String(detail.IdTarifa) : '',
          NumAdultos: toNumber(detail.NumAdultos, 1),
          NumNinos: toNumber(detail.NumNinos),
          PrecioNocheAplicado: toNumber(detail.PrecioNocheAplicado),
          SubtotalLinea: toNumber(detail.SubtotalLinea),
          ValorIvaLinea: toNumber(detail.ValorIvaLinea),
          DescuentoLinea: toNumber(detail.DescuentoLinea),
        })),
      );
    });
  }, [record?.IdReserva, reservationRoomsQuery.data, reservationRoomsQuery.isLoading]);

  const availableRooms = habitaciones.filter((room) => {
    if (selectedSucursalId && String(room.IdSucursal ?? '') !== selectedSucursalId) {
      return false;
    }

    return true;
  });

  const updateRoom = (localId: string, patch: Partial<ReservationRoomLine>) => {
    setRooms((current) =>
      current.map((room) => {
        if (room.localId !== localId) {
          return room;
        }

        const next = { ...room, ...patch };
        const selectedRoom = habitaciones.find((item) => String(item.IdHabitacion ?? '') === String(next.IdHabitacion));
        const selectedRate = tarifas.find((item) => String(item.IdTarifa ?? '') === String(next.IdTarifa));

        if (patch.IdHabitacion !== undefined && !patch.IdTarifa) {
          next.IdTarifa = '';
          next.PrecioNocheAplicado = toNumber(selectedRoom?.PrecioBase);
        }

        if (patch.IdTarifa !== undefined) {
          next.PrecioNocheAplicado = toNumber(selectedRate?.PrecioPorNoche, next.PrecioNocheAplicado);
        }

        return next;
      }),
    );
  };

  const buildRoomsPayload = () =>
    rooms.map((room) => {
      const totalLinea = roundMoney(room.SubtotalLinea + room.ValorIvaLinea - room.DescuentoLinea);
      const selectedRate = tarifas.find((item) => String(item.IdTarifa ?? '') === String(room.IdTarifa));

      return {
        IdHabitacion: Number(room.IdHabitacion),
        IdTarifa: room.IdTarifa ? Number(room.IdTarifa) : null,
        FechaInicio: values.FechaInicio,
        FechaFin: values.FechaFin,
        NumAdultos: Number(room.NumAdultos),
        NumNinos: Number(room.NumNinos),
        PrecioNocheAplicado: Number(room.PrecioNocheAplicado),
        SubtotalLinea: Number(room.SubtotalLinea),
        ValorIvaLinea: Number(room.ValorIvaLinea),
        DescuentoLinea: Number(room.DescuentoLinea),
        TotalLinea: totalLinea,
        EstadoDetalle: 'PEN',
        EstadoTarifa: selectedRate?.EstadoTarifa,
        FechaInicioTarifa: selectedRate?.FechaInicio,
        FechaFinTarifa: selectedRate?.FechaFin,
      };
    });

  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({
          ...values,
          TotalReserva: totalReserva,
          SaldoPendiente: totalReserva,
          Habitaciones: buildRoomsPayload(),
        });
      }}
    >
      {isLoadingOptions || reservationRoomsQuery.isLoading ? (
        <div className="empty-state compact">Cargando clientes, sucursales, habitaciones y tarifas...</div>
      ) : null}

      <div className="form-grid">
        <label className="field">
          <span>Codigo reserva</span>
          <input value={String(values.CodigoReserva)} readOnly />
          <small>{record ? 'Codigo existente de la reserva.' : 'Se genera automaticamente.'}</small>
          {errors?.CodigoReserva ? <small className="field-error">{errors.CodigoReserva}</small> : null}
        </label>

        <label className="field">
          <span>Cliente</span>
          <select
            required
            value={String(values.IdCliente ?? '')}
            onChange={(event) => setValues((previous) => ({ ...previous, IdCliente: event.target.value }))}
          >
            <option value="">Selecciona</option>
            {clientes.map((cliente) => (
              <option key={String(cliente.IdCliente)} value={String(cliente.IdCliente)}>
                {recordText(cliente, ['Nombres', 'Apellidos', 'NumeroIdentificacion'], 'IdCliente')}
              </option>
            ))}
          </select>
          {errors?.IdCliente ? <small className="field-error">{errors.IdCliente}</small> : null}
        </label>

        <label className="field">
          <span>Sucursal</span>
          <select
            required
            value={selectedSucursalId}
            onChange={(event) =>
              setValues((previous) => ({ ...previous, IdSucursal: event.target.value }))
            }
          >
            <option value="">Selecciona</option>
            {sucursales.map((sucursal) => (
              <option key={String(sucursal.IdSucursal)} value={String(sucursal.IdSucursal)}>
                {recordText(sucursal, ['NombreSucursal', 'Ciudad'], 'IdSucursal')}
              </option>
            ))}
          </select>
          {errors?.IdSucursal ? <small className="field-error">{errors.IdSucursal}</small> : null}
        </label>

        <label className="field">
          <span>Fecha reserva UTC</span>
          <input
            type="datetime-local"
            required
            value={String(values.FechaReservaUtc ?? '')}
            onChange={(event) => setValues((previous) => ({ ...previous, FechaReservaUtc: event.target.value }))}
          />
        </label>

        <label className="field">
          <span>Fecha inicio</span>
          <input
            type="datetime-local"
            required
            value={String(values.FechaInicio ?? '')}
            onChange={(event) => setValues((previous) => ({ ...previous, FechaInicio: event.target.value }))}
          />
          {errors?.FechaInicio ? <small className="field-error">{errors.FechaInicio}</small> : null}
        </label>

        <label className="field">
          <span>Fecha fin</span>
          <input
            type="datetime-local"
            required
            value={String(values.FechaFin ?? '')}
            onChange={(event) => setValues((previous) => ({ ...previous, FechaFin: event.target.value }))}
          />
          {errors?.FechaFin ? <small className="field-error">{errors.FechaFin}</small> : null}
        </label>

        <label className="field">
          <span>Canal</span>
          <select
            required
            value={String(values.OrigenCanalReserva ?? '')}
            onChange={(event) => setValues((previous) => ({ ...previous, OrigenCanalReserva: event.target.value }))}
          >
            <option value="BACKOFFICE">Backoffice</option>
            <option value="RECEPCION">Recepcion</option>
            <option value="TELEFONO">Telefono</option>
            <option value="AGENCIA">Agencia</option>
            <option value="OTA">Online travel agency</option>
          </select>
        </label>

        <label className="field">
          <span>Estado</span>
          <select
            required
            value={String(values.EstadoReserva ?? '')}
            onChange={(event) => setValues((previous) => ({ ...previous, EstadoReserva: event.target.value }))}
          >
            <option value="PEN">Pendiente</option>
            <option value="CON">Confirmada</option>
          </select>
        </label>
      </div>

      <div className="reservation-section">
        <div className="section-heading">
          <h3>Habitaciones</h3>
          <button
            type="button"
            className="secondary-button small"
            onClick={() =>
              setRooms((current) => [
                ...current,
                {
                  localId: crypto.randomUUID(),
                  IdHabitacion: '',
                  IdTarifa: '',
                  NumAdultos: 1,
                  NumNinos: 0,
                  PrecioNocheAplicado: 0,
                  SubtotalLinea: 0,
                  ValorIvaLinea: 0,
                  DescuentoLinea: 0,
                },
              ])
            }
          >
            Agregar habitacion
          </button>
        </div>
        {errors?.Habitaciones ? <small className="field-error">{errors.Habitaciones}</small> : null}

        {rooms.map((room, index) => {
          const selectedRoom = habitaciones.find((item) => String(item.IdHabitacion ?? '') === String(room.IdHabitacion));
          const activeRates = tarifas.filter((rate) => {
            const state = String(rate.EstadoTarifa ?? 'ACT').toUpperCase();
            return state === 'ACT' || state === '';
          });
          const branchRates = activeRates.filter((rate) => {
            if (selectedSucursalId && String(rate.IdSucursal ?? '') !== selectedSucursalId) {
              return false;
            }
            return true;
          });
          const roomTypeRates = branchRates.filter((rate) => {
            if (selectedRoom?.IdTipoHabitacion && String(rate.IdTipoHabitacion ?? '') !== String(selectedRoom.IdTipoHabitacion)) {
              return false;
            }
            return true;
          });
          const roomRates = roomTypeRates.length > 0 ? roomTypeRates : branchRates.length > 0 ? branchRates : activeRates;
          const lineTotal = roundMoney(room.SubtotalLinea + room.ValorIvaLinea - room.DescuentoLinea);

          return (
            <div className="reservation-room" key={room.localId}>
              <div className="section-heading">
                <strong>Habitacion {index + 1}</strong>
                {rooms.length > 1 ? (
                  <button type="button" className="danger-button small" onClick={() => setRooms((current) => current.filter((item) => item.localId !== room.localId))}>
                    Quitar
                  </button>
                ) : null}
              </div>

              <div className="form-grid">
                <label className="field">
                  <span>Habitacion</span>
                  <select required value={room.IdHabitacion} onChange={(event) => updateRoom(room.localId, { IdHabitacion: event.target.value })}>
                    <option value="">Selecciona</option>
                    {availableRooms.map((habitacion) => (
                      <option key={String(habitacion.IdHabitacion)} value={String(habitacion.IdHabitacion)}>
                        {recordText(habitacion, ['NumeroHabitacion', 'DescripcionHabitacion', 'EstadoHabitacion'], 'IdHabitacion')}
                      </option>
                    ))}
                  </select>
                  {!habitacionesQuery.isLoading && habitacionesQuery.isError ? <small className="field-error">No se pudieron cargar las habitaciones.</small> : null}
                  {!habitacionesQuery.isLoading && !habitacionesQuery.isError && availableRooms.length === 0 ? (
                    <small>No hay habitaciones registradas para la sucursal seleccionada.</small>
                  ) : null}
                </label>

                <label className="field">
                  <span>Tarifa</span>
                  <select value={room.IdTarifa} onChange={(event) => updateRoom(room.localId, { IdTarifa: event.target.value })}>
                    <option value="">Sin tarifa</option>
                    {roomRates.map((tarifa) => (
                      <option key={String(tarifa.IdTarifa)} value={String(tarifa.IdTarifa)}>
                        {recordText(tarifa, ['NombreTarifa', 'PrecioPorNoche', 'CanalTarifa'], 'IdTarifa')}
                      </option>
                    ))}
                  </select>
                  {!tarifasQuery.isLoading && tarifasQuery.isError ? <small className="field-error">No se pudieron cargar las tarifas.</small> : null}
                  {!tarifasQuery.isLoading && !tarifasQuery.isError && roomRates.length === 0 ? <small>No hay tarifas registradas.</small> : null}
                </label>

                <label className="field">
                  <span>Adultos</span>
                  <input type="number" min={1} value={room.NumAdultos} onChange={(event) => updateRoom(room.localId, { NumAdultos: toNumber(event.target.value, 1) })} />
                </label>

                <label className="field">
                  <span>Ninos</span>
                  <input type="number" min={0} value={room.NumNinos} onChange={(event) => updateRoom(room.localId, { NumNinos: toNumber(event.target.value) })} />
                </label>

                <label className="field">
                  <span>Precio noche</span>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={room.PrecioNocheAplicado}
                    onChange={(event) => updateRoom(room.localId, { PrecioNocheAplicado: toNumber(event.target.value) })}
                  />
                </label>

                <label className="field">
                  <span>Subtotal linea</span>
                  <input type="number" min={0} step={0.01} value={room.SubtotalLinea} onChange={(event) => updateRoom(room.localId, { SubtotalLinea: toNumber(event.target.value) })} />
                </label>

                <label className="field">
                  <span>IVA linea</span>
                  <input type="number" min={0} step={0.01} value={room.ValorIvaLinea} onChange={(event) => updateRoom(room.localId, { ValorIvaLinea: toNumber(event.target.value) })} />
                </label>

                <label className="field">
                  <span>Descuento linea</span>
                  <input type="number" min={0} step={0.01} value={room.DescuentoLinea} onChange={(event) => updateRoom(room.localId, { DescuentoLinea: toNumber(event.target.value) })} />
                </label>

                <label className="field">
                  <span>Total linea</span>
                  <input value={lineTotal.toFixed(2)} readOnly />
                </label>
              </div>
            </div>
          );
        })}
      </div>

      <div className="form-grid">
        <label className="field">
          <span>Subtotal</span>
          <input type="number" min={0} step={0.01} required value={String(values.SubtotalReserva)} onChange={(event) => setValues((previous) => ({ ...previous, SubtotalReserva: toNumber(event.target.value) }))} />
          {errors?.SubtotalReserva ? <small className="field-error">{errors.SubtotalReserva}</small> : null}
        </label>

        <label className="field">
          <span>IVA</span>
          <input type="number" min={0} step={0.01} required value={String(values.ValorIva)} onChange={(event) => setValues((previous) => ({ ...previous, ValorIva: toNumber(event.target.value) }))} />
        </label>

        <label className="field">
          <span>Descuento</span>
          <input type="number" min={0} step={0.01} required value={String(values.DescuentoAplicado)} onChange={(event) => setValues((previous) => ({ ...previous, DescuentoAplicado: toNumber(event.target.value) }))} />
          {errors?.DescuentoAplicado ? <small className="field-error">{errors.DescuentoAplicado}</small> : null}
        </label>

        <label className="field">
          <span>Total</span>
          <input value={totalReserva.toFixed(2)} readOnly />
          {errors?.TotalReserva ? <small className="field-error">{errors.TotalReserva}</small> : null}
        </label>

        <label className="field">
          <span>Saldo pendiente</span>
          <input value={totalReserva.toFixed(2)} readOnly />
        </label>

        <label className="field">
          <span>Es walk-in</span>
          <label className="checkbox-row">
            <input type="checkbox" checked={Boolean(values.EsWalkin)} onChange={(event) => setValues((previous) => ({ ...previous, EsWalkin: event.target.checked }))} />
            <span>Reserva creada en recepcion</span>
          </label>
        </label>

        <label className="field field-span-2">
          <span>Observaciones</span>
          <textarea value={String(values.Observaciones ?? '')} rows={4} onChange={(event) => setValues((previous) => ({ ...previous, Observaciones: event.target.value }))} />
        </label>
      </div>

      <button type="submit" className="primary-button" disabled={isPending || isLoadingOptions || reservationRoomsQuery.isLoading}>
        {isPending ? 'Guardando...' : record ? 'Actualizar reserva' : 'Guardar reserva'}
      </button>
    </form>
  );
}

function RoomForm({
  record,
  onSubmit,
  isPending,
  errors,
}: {
  record: GenericRecord | null;
  onSubmit: (values: Record<string, unknown>) => void;
  isPending: boolean;
  errors?: Record<string, string>;
}) {
  const [values, setValues] = useState<Record<string, unknown>>({
    IdSucursal: record?.IdSucursal ?? '',
    IdTipoHabitacion: record?.IdTipoHabitacion ?? '',
    NumeroHabitacion: record?.NumeroHabitacion ?? '',
    Piso: record?.Piso ?? 1,
    CapacidadHabitacion: record?.CapacidadHabitacion ?? 2,
    PrecioBase: record?.PrecioBase ?? 1,
    DescripcionHabitacion: record?.DescripcionHabitacion ?? '',
    EstadoHabitacion: record?.EstadoHabitacion ?? 'DIS',
  });
  const [autoNumber, setAutoNumber] = useState(!record);

  const sucursalesQuery = useQuery({
    queryKey: ['room-options', 'sucursales'],
    queryFn: () => fetchPaged<GenericRecord>('/api/v1/internal/sucursales', 1, 100),
  });
  const tiposQuery = useQuery({
    queryKey: ['room-options', 'tipos-habitacion'],
    queryFn: () => fetchPaged<GenericRecord>('/api/v1/internal/tipos-habitacion', 1, 100),
  });
  const habitacionesQuery = useQuery({
    queryKey: ['room-options', 'habitaciones'],
    queryFn: () => fetchPaged<GenericRecord>('/api/v1/internal/habitaciones', 1, 100),
  });

  const sucursales = useMemo(() => sucursalesQuery.data?.data ?? [], [sucursalesQuery.data?.data]);
  const tiposHabitacion = useMemo(() => tiposQuery.data?.data ?? [], [tiposQuery.data?.data]);
  const habitaciones = useMemo(() => habitacionesQuery.data?.data ?? [], [habitacionesQuery.data?.data]);
  const selectedType = tiposHabitacion.find((tipo) => String(tipo.IdTipoHabitacion ?? '') === String(values.IdTipoHabitacion ?? ''));
  const suggestedNumber = values.IdSucursal
    ? nextRoomNumber(habitaciones, values.IdSucursal, values.Piso, record?.IdHabitacion)
    : '';
  const isLoadingOptions = sucursalesQuery.isLoading || tiposQuery.isLoading || habitacionesQuery.isLoading;

  const updateValues = (patch: Record<string, unknown>) => {
    setValues((previous) => {
      const next = { ...previous, ...patch };
      if (autoNumber && next.IdSucursal) {
        next.NumeroHabitacion = nextRoomNumber(habitaciones, next.IdSucursal, next.Piso, record?.IdHabitacion);
      }

      return next;
    });
  };

  useEffect(() => {
    if (!autoNumber || !values.IdSucursal || habitacionesQuery.isLoading) {
      return;
    }

    const number = nextRoomNumber(habitaciones, values.IdSucursal, values.Piso, record?.IdHabitacion);
    queueMicrotask(() => {
      setValues((previous) => ({ ...previous, NumeroHabitacion: number }));
    });
  }, [autoNumber, habitaciones, habitacionesQuery.isLoading, record?.IdHabitacion, values.IdSucursal, values.Piso]);

  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(values);
      }}
    >
      {isLoadingOptions ? <div className="empty-state compact">Cargando sucursales, tipos y numeracion...</div> : null}

      <div className="form-grid">
        <label className="field">
          <span>Sucursal</span>
          <select required value={String(values.IdSucursal ?? '')} onChange={(event) => updateValues({ IdSucursal: event.target.value })}>
            <option value="">Selecciona</option>
            {sucursales.map((sucursal) => (
              <option key={String(sucursal.IdSucursal)} value={String(sucursal.IdSucursal)}>
                {recordText(sucursal, ['NombreSucursal', 'Ciudad'], 'IdSucursal')}
              </option>
            ))}
          </select>
          {errors?.IdSucursal ? <small className="field-error">{errors.IdSucursal}</small> : null}
        </label>

        <label className="field">
          <span>Tipo habitacion</span>
          <select
            required
            value={String(values.IdTipoHabitacion ?? '')}
            onChange={(event) => {
              const tipo = tiposHabitacion.find((item) => String(item.IdTipoHabitacion ?? '') === event.target.value);
              updateValues({
                IdTipoHabitacion: event.target.value,
                CapacidadHabitacion: tipo?.CapacidadTotal ?? values.CapacidadHabitacion,
              });
            }}
          >
            <option value="">Selecciona</option>
            {tiposHabitacion.map((tipo) => (
              <option key={String(tipo.IdTipoHabitacion)} value={String(tipo.IdTipoHabitacion)}>
                {recordText(tipo, ['NombreTipoHabitacion', 'TipoCama', 'CapacidadTotal'], 'IdTipoHabitacion')}
              </option>
            ))}
          </select>
          {selectedType ? <small>Capacidad sugerida: {String(selectedType.CapacidadTotal ?? '-')}</small> : null}
          {errors?.IdTipoHabitacion ? <small className="field-error">{errors.IdTipoHabitacion}</small> : null}
        </label>

        <label className="field">
          <span>Piso</span>
          <select value={String(values.Piso ?? 0)} onChange={(event) => updateValues({ Piso: event.target.value })}>
            {floorOptions(habitaciones).map((piso) => (
              <option key={`piso-${piso}`} value={String(piso)}>
                {piso === 0 ? 'Planta baja' : `Piso ${piso}`}
              </option>
            ))}
          </select>
          {errors?.Piso ? <small className="field-error">{errors.Piso}</small> : null}
        </label>

        <label className="field">
          <span>Numero habitacion</span>
          <input
            required
            value={String(values.NumeroHabitacion ?? '')}
            onChange={(event) => {
              setAutoNumber(false);
              setValues((previous) => ({ ...previous, NumeroHabitacion: event.target.value }));
            }}
          />
          {suggestedNumber ? <small>Siguiente sugerido: {suggestedNumber}</small> : null}
          {errors?.NumeroHabitacion ? <small className="field-error">{errors.NumeroHabitacion}</small> : null}
        </label>

        <label className="field">
          <span>Capacidad</span>
          <input
            type="number"
            min={1}
            max={20}
            required
            value={String(values.CapacidadHabitacion ?? '')}
            onChange={(event) => setValues((previous) => ({ ...previous, CapacidadHabitacion: event.target.value }))}
          />
          {errors?.CapacidadHabitacion ? <small className="field-error">{errors.CapacidadHabitacion}</small> : null}
        </label>

        <label className="field">
          <span>Precio base</span>
          <input
            type="number"
            min={0.01}
            max={100000}
            step={0.01}
            required
            value={String(values.PrecioBase ?? '')}
            onChange={(event) => setValues((previous) => ({ ...previous, PrecioBase: event.target.value }))}
          />
          {errors?.PrecioBase ? <small className="field-error">{errors.PrecioBase}</small> : null}
        </label>

        {record ? (
          <label className="field">
            <span>Estado</span>
            <select value={String(values.EstadoHabitacion ?? 'DIS')} onChange={(event) => setValues((previous) => ({ ...previous, EstadoHabitacion: event.target.value }))}>
              <option value="DIS">Disponible</option>
              <option value="OCU">Ocupada</option>
              <option value="MNT">Mantenimiento</option>
              <option value="FDS">Fuera de servicio</option>
              <option value="INA">Inactiva</option>
            </select>
          </label>
        ) : null}

        <label className="field field-span-2">
          <span>Descripcion</span>
          <textarea
            rows={4}
            value={String(values.DescripcionHabitacion ?? '')}
            onChange={(event) => setValues((previous) => ({ ...previous, DescripcionHabitacion: event.target.value }))}
          />
          {errors?.DescripcionHabitacion ? <small className="field-error">{errors.DescripcionHabitacion}</small> : null}
        </label>
      </div>

      <button type="submit" className="primary-button" disabled={isPending || isLoadingOptions}>
        {isPending ? 'Guardando...' : record ? 'Actualizar habitacion' : 'Guardar habitacion'}
      </button>
    </form>
  );
}

function TariffForm({
  record,
  onSubmit,
  isPending,
  errors,
}: {
  record: GenericRecord | null;
  onSubmit: (values: Record<string, unknown>) => void;
  isPending: boolean;
  errors?: Record<string, string>;
}) {
  const today = useMemo(() => new Date(), []);
  const defaultEnd = useMemo(() => {
    const date = new Date(today);
    date.setFullYear(date.getFullYear() + 1);
    return date;
  }, [today]);
  const [values, setValues] = useState<Record<string, unknown>>({
    CodigoTarifa: record?.CodigoTarifa ?? '',
    IdSucursal: record?.IdSucursal ?? '',
    IdTipoHabitacion: record?.IdTipoHabitacion ?? '',
    NombreTarifa: record?.NombreTarifa ?? '',
    CanalTarifa: record?.CanalTarifa ?? 'TODOS',
    FechaInicio: record?.FechaInicio ?? formatDateInput(today),
    FechaFin: record?.FechaFin ?? formatDateInput(defaultEnd),
    PrecioPorNoche: record?.PrecioPorNoche ?? 1,
    PorcentajeIva: record?.PorcentajeIva ?? 15,
    MinNoches: record?.MinNoches ?? 1,
    MaxNoches: record?.MaxNoches ?? '',
    PermitePortalPublico: record?.PermitePortalPublico ?? true,
    Prioridad: record?.Prioridad ?? 1,
    EstadoTarifa: record?.EstadoTarifa ?? 'ACT',
  });
  const [autoCode, setAutoCode] = useState(!record);
  const [autoPriority, setAutoPriority] = useState(!record);

  const sucursalesQuery = useQuery({
    queryKey: ['tariff-options', 'sucursales'],
    queryFn: () => fetchPaged<GenericRecord>('/api/v1/internal/sucursales', 1, 100),
  });
  const tiposQuery = useQuery({
    queryKey: ['tariff-options', 'tipos-habitacion'],
    queryFn: () => fetchPaged<GenericRecord>('/api/v1/internal/tipos-habitacion', 1, 100),
  });
  const tarifasQuery = useQuery({
    queryKey: ['tariff-options', 'tarifas'],
    queryFn: () => fetchPaged<GenericRecord>('/api/v1/internal/tarifas', 1, 100),
  });

  const sucursales = useMemo(() => sucursalesQuery.data?.data ?? [], [sucursalesQuery.data?.data]);
  const tiposHabitacion = useMemo(() => tiposQuery.data?.data ?? [], [tiposQuery.data?.data]);
  const tarifas = useMemo(() => tarifasQuery.data?.data ?? [], [tarifasQuery.data?.data]);
  const selectedType = tiposHabitacion.find((tipo) => String(tipo.IdTipoHabitacion ?? '') === String(values.IdTipoHabitacion ?? ''));
  const selectedSucursal = sucursales.find((sucursal) => String(sucursal.IdSucursal ?? '') === String(values.IdSucursal ?? ''));
  const suggestedCode = generateTariffCode(tarifas);
  const suggestedPriority = nextTariffPriority(tarifas, values.IdSucursal, values.IdTipoHabitacion, record?.IdTarifa);
  const isLoadingOptions = sucursalesQuery.isLoading || tiposQuery.isLoading || tarifasQuery.isLoading;

  const updateValues = (patch: Record<string, unknown>) => {
    setValues((previous) => {
      const next = { ...previous, ...patch };
      const type = tiposHabitacion.find((item) => String(item.IdTipoHabitacion ?? '') === String(next.IdTipoHabitacion ?? ''));

      if (autoCode) {
        next.CodigoTarifa = generateTariffCode(tarifas);
      }

      if (autoPriority && next.IdSucursal && next.IdTipoHabitacion) {
        next.Prioridad = nextTariffPriority(tarifas, next.IdSucursal, next.IdTipoHabitacion, record?.IdTarifa);
      }

      if (!previous.NombreTarifa && type?.NombreTipoHabitacion) {
        next.NombreTarifa = `Tarifa ${String(type.NombreTipoHabitacion)}`;
      }

      return next;
    });
  };

  useEffect(() => {
    if (!autoCode || tarifasQuery.isLoading) {
      return;
    }

    const code = generateTariffCode(tarifas);
    queueMicrotask(() => {
      setValues((previous) => ({ ...previous, CodigoTarifa: code }));
    });
  }, [autoCode, tarifas, tarifasQuery.isLoading]);

  useEffect(() => {
    if (!autoPriority || !values.IdSucursal || !values.IdTipoHabitacion || tarifasQuery.isLoading) {
      return;
    }

    const priority = nextTariffPriority(tarifas, values.IdSucursal, values.IdTipoHabitacion, record?.IdTarifa);
    queueMicrotask(() => {
      setValues((previous) => ({ ...previous, Prioridad: priority }));
    });
  }, [autoPriority, record?.IdTarifa, tarifas, tarifasQuery.isLoading, values.IdSucursal, values.IdTipoHabitacion]);

  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(values);
      }}
    >
      {isLoadingOptions ? <div className="empty-state compact">Cargando sucursales, tipos y tarifas existentes...</div> : null}

      <div className="form-grid">
        <label className="field">
          <span>Codigo</span>
          <input
            required
            value={String(values.CodigoTarifa ?? '')}
            onChange={(event) => {
              setAutoCode(false);
              setValues((previous) => ({ ...previous, CodigoTarifa: event.target.value }));
            }}
          />
          <small>Siguiente sugerido: {suggestedCode}</small>
          {errors?.CodigoTarifa ? <small className="field-error">{errors.CodigoTarifa}</small> : null}
        </label>

        <label className="field">
          <span>Sucursal</span>
          <select required value={String(values.IdSucursal ?? '')} onChange={(event) => updateValues({ IdSucursal: event.target.value })}>
            <option value="">Selecciona</option>
            {sucursales.map((sucursal) => (
              <option key={String(sucursal.IdSucursal)} value={String(sucursal.IdSucursal)}>
                {recordText(sucursal, ['NombreSucursal', 'Ciudad'], 'IdSucursal')}
              </option>
            ))}
          </select>
          {selectedSucursal ? <small>{recordText(selectedSucursal, ['Direccion'], 'IdSucursal')}</small> : null}
          {errors?.IdSucursal ? <small className="field-error">{errors.IdSucursal}</small> : null}
        </label>

        <label className="field">
          <span>Tipo habitacion</span>
          <select required value={String(values.IdTipoHabitacion ?? '')} onChange={(event) => updateValues({ IdTipoHabitacion: event.target.value })}>
            <option value="">Selecciona</option>
            {tiposHabitacion.map((tipo) => (
              <option key={String(tipo.IdTipoHabitacion)} value={String(tipo.IdTipoHabitacion)}>
                {recordText(tipo, ['NombreTipoHabitacion', 'TipoCama', 'CapacidadTotal'], 'IdTipoHabitacion')}
              </option>
            ))}
          </select>
          {selectedType ? <small>Capacidad: {String(selectedType.CapacidadTotal ?? '-')} | Cama: {String(selectedType.TipoCama ?? '-')}</small> : null}
          {errors?.IdTipoHabitacion ? <small className="field-error">{errors.IdTipoHabitacion}</small> : null}
        </label>

        <label className="field">
          <span>Nombre</span>
          <input required value={String(values.NombreTarifa ?? '')} onChange={(event) => setValues((previous) => ({ ...previous, NombreTarifa: event.target.value }))} />
          {errors?.NombreTarifa ? <small className="field-error">{errors.NombreTarifa}</small> : null}
        </label>

        <label className="field">
          <span>Canal</span>
          <select required value={String(values.CanalTarifa ?? 'TODOS')} onChange={(event) => setValues((previous) => ({ ...previous, CanalTarifa: event.target.value }))}>
            <option value="TODOS">Todos</option>
            <option value="BACKOFFICE">Backoffice</option>
            <option value="PUBLICO">Portal publico</option>
            <option value="RECEPCION">Recepcion</option>
            <option value="TELEFONO">Telefono</option>
            <option value="AGENCIA">Agencia</option>
            <option value="OTA">Online travel agency</option>
          </select>
          {errors?.CanalTarifa ? <small className="field-error">{errors.CanalTarifa}</small> : null}
        </label>

        <label className="field">
          <span>Fecha inicio</span>
          <input type="date" required value={String(values.FechaInicio ?? '')} onChange={(event) => setValues((previous) => ({ ...previous, FechaInicio: event.target.value }))} />
          {errors?.FechaInicio ? <small className="field-error">{errors.FechaInicio}</small> : null}
        </label>

        <label className="field">
          <span>Fecha fin</span>
          <input type="date" required value={String(values.FechaFin ?? '')} onChange={(event) => setValues((previous) => ({ ...previous, FechaFin: event.target.value }))} />
          {errors?.FechaFin ? <small className="field-error">{errors.FechaFin}</small> : null}
        </label>

        <label className="field">
          <span>Precio por noche</span>
          <input
            type="number"
            min={0.01}
            max={100000}
            step={0.01}
            required
            value={String(values.PrecioPorNoche ?? '')}
            onChange={(event) => setValues((previous) => ({ ...previous, PrecioPorNoche: event.target.value }))}
          />
          {errors?.PrecioPorNoche ? <small className="field-error">{errors.PrecioPorNoche}</small> : null}
        </label>

        <label className="field">
          <span>IVA %</span>
          <select value={String(values.PorcentajeIva ?? 15)} onChange={(event) => setValues((previous) => ({ ...previous, PorcentajeIva: event.target.value }))}>
            <option value="0">0%</option>
            <option value="12">12%</option>
            <option value="15">15%</option>
          </select>
          {errors?.PorcentajeIva ? <small className="field-error">{errors.PorcentajeIva}</small> : null}
        </label>

        <label className="field">
          <span>Min noches</span>
          <input type="number" min={1} required value={String(values.MinNoches ?? '')} onChange={(event) => setValues((previous) => ({ ...previous, MinNoches: event.target.value }))} />
          {errors?.MinNoches ? <small className="field-error">{errors.MinNoches}</small> : null}
        </label>

        <label className="field">
          <span>Max noches</span>
          <input type="number" min={1} value={String(values.MaxNoches ?? '')} onChange={(event) => setValues((previous) => ({ ...previous, MaxNoches: event.target.value }))} />
          {errors?.MaxNoches ? <small className="field-error">{errors.MaxNoches}</small> : null}
        </label>

        <label className="field">
          <span>Prioridad</span>
          <input
            type="number"
            min={1}
            required
            value={String(values.Prioridad ?? '')}
            onChange={(event) => {
              setAutoPriority(false);
              setValues((previous) => ({ ...previous, Prioridad: event.target.value }));
            }}
          />
          <small>Siguiente sugerida para sucursal/tipo: {suggestedPriority}</small>
          {errors?.Prioridad ? <small className="field-error">{errors.Prioridad}</small> : null}
        </label>

        <label className="field">
          <span>Estado</span>
          <select required value={String(values.EstadoTarifa ?? 'ACT')} onChange={(event) => setValues((previous) => ({ ...previous, EstadoTarifa: event.target.value }))}>
            <option value="ACT">Activa</option>
            <option value="INA">Inactiva</option>
          </select>
        </label>

        <label className="field">
          <span>Portal publico</span>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={Boolean(values.PermitePortalPublico)}
              onChange={(event) => setValues((previous) => ({ ...previous, PermitePortalPublico: event.target.checked }))}
            />
            <span>Visible en portal publico</span>
          </label>
        </label>
      </div>

      <button type="submit" className="primary-button" disabled={isPending || isLoadingOptions}>
        {isPending ? 'Guardando...' : record ? 'Actualizar tarifa' : 'Guardar tarifa'}
      </button>
    </form>
  );
}

function CatalogServiceForm({
  record,
  onSubmit,
  isPending,
  errors,
}: {
  record: GenericRecord | null;
  onSubmit: (values: Record<string, unknown>) => void;
  isPending: boolean;
  errors?: Record<string, string>;
}) {
  const [values, setValues] = useState<Record<string, unknown>>({
    IdSucursal: record?.IdSucursal ?? '',
    CodigoCatalogo: record?.CodigoCatalogo ?? '',
    NombreCatalogo: record?.NombreCatalogo ?? '',
    TipoCatalogo: record?.TipoCatalogo ?? '',
    CategoriaCatalogo: record?.CategoriaCatalogo ?? '',
    DescripcionCatalogo: record?.DescripcionCatalogo ?? '',
    PrecioBase: record?.PrecioBase ?? 0,
    AplicaIva: record?.AplicaIva ?? false,
    Disponible24h: record?.Disponible24h ?? false,
    HoraInicio: record?.HoraInicio ?? '',
    HoraFin: record?.HoraFin ?? '',
    IconoUrl: record?.IconoUrl ?? '',
    EstadoCatalogo: record?.EstadoCatalogo ?? 'ACT',
  });

  const sucursalesQuery = useQuery({
    queryKey: ['catalog-service-options', 'sucursales'],
    queryFn: () => fetchPaged<GenericRecord>('/api/v1/internal/sucursales', 1, 100),
  });

  const sucursales = sucursalesQuery.data?.data ?? [];
  const selectedSucursal = sucursales.find((sucursal) => String(sucursal.IdSucursal ?? '') === String(values.IdSucursal ?? ''));

  const updateAvailability = (checked: boolean) => {
    setValues((previous) => ({
      ...previous,
      Disponible24h: checked,
      HoraInicio: checked ? '' : previous.HoraInicio,
      HoraFin: checked ? '' : previous.HoraFin,
    }));
  };

  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(values);
      }}
    >
      {sucursalesQuery.isLoading ? <div className="empty-state compact">Cargando sucursales...</div> : null}
      {sucursalesQuery.isError ? <StatusMessage kind="error" title="No se pudieron cargar las sucursales." /> : null}

      <div className="form-grid">
        <label className="field">
          <span>Sucursal</span>
          <select value={String(values.IdSucursal ?? '')} onChange={(event) => setValues((previous) => ({ ...previous, IdSucursal: event.target.value }))}>
            <option value="">Todas las sucursales</option>
            {sucursales.map((sucursal) => (
              <option key={String(sucursal.IdSucursal)} value={String(sucursal.IdSucursal)}>
                {recordText(sucursal, ['NombreSucursal', 'Ciudad'], 'IdSucursal')}
              </option>
            ))}
          </select>
          {selectedSucursal ? <small>{recordText(selectedSucursal, ['Direccion'], 'IdSucursal')}</small> : null}
          {errors?.IdSucursal ? <small className="field-error">{errors.IdSucursal}</small> : null}
        </label>

        <label className="field">
          <span>Codigo</span>
          <input
            required
            maxLength={20}
            value={String(values.CodigoCatalogo ?? '')}
            onChange={(event) => setValues((previous) => ({ ...previous, CodigoCatalogo: event.target.value }))}
          />
          {errors?.CodigoCatalogo ? <small className="field-error">{errors.CodigoCatalogo}</small> : null}
        </label>

        <label className="field">
          <span>Nombre</span>
          <input
            required
            maxLength={150}
            value={String(values.NombreCatalogo ?? '')}
            onChange={(event) => setValues((previous) => ({ ...previous, NombreCatalogo: event.target.value }))}
          />
          {errors?.NombreCatalogo ? <small className="field-error">{errors.NombreCatalogo}</small> : null}
        </label>

        <label className="field">
          <span>Tipo</span>
          <select required value={String(values.TipoCatalogo ?? '')} onChange={(event) => setValues((previous) => ({ ...previous, TipoCatalogo: event.target.value }))}>
            <option value="">Selecciona</option>
            {catalogServiceTypes.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {errors?.TipoCatalogo ? <small className="field-error">{errors.TipoCatalogo}</small> : null}
        </label>

        <label className="field">
          <span>Categoria</span>
          <select
            required
            value={String(values.CategoriaCatalogo ?? '')}
            onChange={(event) => setValues((previous) => ({ ...previous, CategoriaCatalogo: event.target.value }))}
          >
            <option value="">Selecciona</option>
            {catalogServiceCategories.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {errors?.CategoriaCatalogo ? <small className="field-error">{errors.CategoriaCatalogo}</small> : null}
        </label>

        <label className="field">
          <span>Precio base</span>
          <input
            type="number"
            min={0}
            max={100000}
            step={0.01}
            required
            value={String(values.PrecioBase ?? '')}
            onChange={(event) => setValues((previous) => ({ ...previous, PrecioBase: event.target.value }))}
          />
          {errors?.PrecioBase ? <small className="field-error">{errors.PrecioBase}</small> : null}
        </label>

        <label className="field">
          <span>Estado</span>
          <select required value={String(values.EstadoCatalogo ?? 'ACT')} onChange={(event) => setValues((previous) => ({ ...previous, EstadoCatalogo: event.target.value }))}>
            <option value="ACT">Activo</option>
            <option value="INA">Inactivo</option>
          </select>
          {errors?.EstadoCatalogo ? <small className="field-error">{errors.EstadoCatalogo}</small> : null}
        </label>

        <label className="field">
          <span>Aplica IVA</span>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={Boolean(values.AplicaIva)}
              onChange={(event) => setValues((previous) => ({ ...previous, AplicaIva: event.target.checked }))}
            />
            <span>Calcula IVA para este servicio</span>
          </label>
        </label>

        <label className="field">
          <span>Disponibilidad</span>
          <label className="checkbox-row">
            <input type="checkbox" checked={Boolean(values.Disponible24h)} onChange={(event) => updateAvailability(event.target.checked)} />
            <span>Disponible 24h</span>
          </label>
        </label>

        {!values.Disponible24h ? (
          <>
            <label className="field">
              <span>Hora inicio</span>
              <input
                type="time"
                value={String(values.HoraInicio ?? '')}
                onChange={(event) => setValues((previous) => ({ ...previous, HoraInicio: event.target.value }))}
              />
              {errors?.HoraInicio ? <small className="field-error">{errors.HoraInicio}</small> : null}
            </label>

            <label className="field">
              <span>Hora fin</span>
              <input
                type="time"
                value={String(values.HoraFin ?? '')}
                onChange={(event) => setValues((previous) => ({ ...previous, HoraFin: event.target.value }))}
              />
              {errors?.HoraFin ? <small className="field-error">{errors.HoraFin}</small> : null}
            </label>
          </>
        ) : null}

        <label className="field field-span-2">
          <span>Descripcion</span>
          <textarea
            rows={4}
            maxLength={2000}
            value={String(values.DescripcionCatalogo ?? '')}
            onChange={(event) => setValues((previous) => ({ ...previous, DescripcionCatalogo: event.target.value }))}
          />
          {errors?.DescripcionCatalogo ? <small className="field-error">{errors.DescripcionCatalogo}</small> : null}
        </label>

        <label className="field field-span-2">
          <span>Icono Cloudinary</span>
          <input maxLength={500} value={String(values.IconoUrl ?? '')} onChange={(event) => setValues((previous) => ({ ...previous, IconoUrl: event.target.value }))} />
          <small>Pega una URL completa o el Public ID, por ejemplo servicios/spa.</small>
          {errors?.IconoUrl ? <small className="field-error">{errors.IconoUrl}</small> : null}
        </label>
      </div>

      <button type="submit" className="primary-button" disabled={isPending || sucursalesQuery.isLoading}>
        {isPending ? 'Guardando...' : record ? 'Actualizar servicio' : 'Guardar servicio'}
      </button>
    </form>
  );
}

function PaymentForm({
  record,
  onSubmit,
  isPending,
  errors,
}: {
  record: GenericRecord | null;
  onSubmit: (values: Record<string, unknown>) => void;
  isPending: boolean;
  errors?: Record<string, string>;
}) {
  const now = useMemo(() => new Date(), []);
  const [values, setValues] = useState<Record<string, unknown>>({
    IdFactura: record?.IdFactura ?? '',
    IdReserva: record?.IdReserva ?? '',
    Monto: record?.Monto ?? 1,
    MetodoPago: record?.MetodoPago ?? '',
    EsPagoElectronico: record?.EsPagoElectronico ?? false,
    ProveedorPasarela: record?.ProveedorPasarela ?? '',
    TransaccionExterna: record?.TransaccionExterna ?? '',
    CodigoAutorizacion: record?.CodigoAutorizacion ?? '',
    Referencia: record?.Referencia ?? '',
    EstadoPago: record?.EstadoPago ?? 'APR',
    FechaPagoUtc: toDateTimeLocalValue(record?.FechaPagoUtc) || formatDateTimeLocal(now),
    Moneda: record?.Moneda ?? 'USD',
    TipoCambio: record?.TipoCambio ?? 1,
  });

  const facturasQuery = useQuery({
    queryKey: ['payment-options', 'facturas'],
    queryFn: () => fetchPaged<GenericRecord>('/api/v1/internal/facturas', 1, 100),
  });

  const facturas = facturasQuery.data?.data ?? [];
  const payableInvoices = facturas.filter(isPayableInvoice);
  const selectedInvoice = facturas.find((factura) => String(factura.IdFactura ?? '') === String(values.IdFactura ?? ''));
  const selectedBalance = toNumber(selectedInvoice?.SaldoPendiente);

  const selectInvoice = (idFactura: string) => {
    const invoice = facturas.find((factura) => String(factura.IdFactura ?? '') === idFactura);
    setValues((previous) => ({
      ...previous,
      IdFactura: idFactura,
      IdReserva: invoice?.IdReserva ? String(invoice.IdReserva) : '',
      Monto: invoice?.SaldoPendiente ?? previous.Monto,
      Moneda: invoice?.Moneda ?? previous.Moneda,
    }));
  };

  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(values);
      }}
    >
      {facturasQuery.isLoading ? <div className="empty-state compact">Cargando facturas pendientes...</div> : null}
      {facturasQuery.isError ? <StatusMessage kind="error" title="No se pudieron cargar las facturas." /> : null}

      <div className="form-grid">
        <label className="field field-span-2">
          <span>Factura pendiente</span>
          <select required value={String(values.IdFactura ?? '')} onChange={(event) => selectInvoice(event.target.value)}>
            <option value="">Selecciona</option>
            {payableInvoices.map((factura) => (
              <option key={String(factura.IdFactura)} value={String(factura.IdFactura)}>
                {invoiceLabel(factura)}
              </option>
            ))}
          </select>
          {!facturasQuery.isLoading && payableInvoices.length === 0 ? <small>No hay facturas pendientes de pago.</small> : null}
          {errors?.IdFactura ? <small className="field-error">{errors.IdFactura}</small> : null}
        </label>

        <label className="field">
          <span>Reserva</span>
          <input value={String(values.IdReserva ?? '')} readOnly />
          {errors?.IdReserva ? <small className="field-error">{errors.IdReserva}</small> : null}
        </label>

        <label className="field">
          <span>Monto</span>
          <input
            type="number"
            min={0.01}
            max={selectedBalance || undefined}
            step={0.01}
            required
            value={String(values.Monto ?? '')}
            onChange={(event) => setValues((previous) => ({ ...previous, Monto: event.target.value }))}
          />
          {selectedInvoice ? <small>Saldo disponible: {String(selectedInvoice.Moneda ?? 'USD')} {selectedBalance.toFixed(2)}</small> : null}
          {errors?.Monto ? <small className="field-error">{errors.Monto}</small> : null}
        </label>

        <label className="field">
          <span>Metodo</span>
          <select required value={String(values.MetodoPago ?? '')} onChange={(event) => setValues((previous) => ({ ...previous, MetodoPago: event.target.value }))}>
            <option value="">Selecciona</option>
            <option value="EFECTIVO">Efectivo</option>
            <option value="TARJETA_CREDITO">Tarjeta de credito</option>
            <option value="TARJETA_DEBITO">Tarjeta de debito</option>
            <option value="TRANSFERENCIA">Transferencia</option>
            <option value="DEPOSITO">Deposito</option>
            <option value="PASARELA">Pasarela</option>
          </select>
          {errors?.MetodoPago ? <small className="field-error">{errors.MetodoPago}</small> : null}
        </label>

        <label className="field">
          <span>Estado</span>
          <select required value={String(values.EstadoPago ?? '')} onChange={(event) => setValues((previous) => ({ ...previous, EstadoPago: event.target.value }))}>
            <option value="PEN">Pendiente</option>
            <option value="PRO">Procesando</option>
            <option value="APR">Aprobado</option>
            <option value="REC">Rechazado</option>
            <option value="CAN">Cancelado</option>
          </select>
        </label>

        <label className="field">
          <span>Fecha pago</span>
          <input
            type="datetime-local"
            required
            value={String(values.FechaPagoUtc ?? '')}
            onChange={(event) => setValues((previous) => ({ ...previous, FechaPagoUtc: event.target.value }))}
          />
          {errors?.FechaPagoUtc ? <small className="field-error">{errors.FechaPagoUtc}</small> : null}
        </label>

        <label className="field">
          <span>Moneda</span>
          <select required value={String(values.Moneda ?? 'USD')} onChange={(event) => setValues((previous) => ({ ...previous, Moneda: event.target.value }))}>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
          </select>
        </label>

        <label className="field">
          <span>Tipo cambio</span>
          <input
            type="number"
            min={0.0001}
            step={0.0001}
            required
            value={String(values.TipoCambio ?? 1)}
            onChange={(event) => setValues((previous) => ({ ...previous, TipoCambio: event.target.value }))}
          />
        </label>

        <label className="field">
          <span>Pago electronico</span>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={Boolean(values.EsPagoElectronico)}
              onChange={(event) => setValues((previous) => ({ ...previous, EsPagoElectronico: event.target.checked }))}
            />
            <span>Usa pasarela o referencia externa</span>
          </label>
        </label>

        <label className="field">
          <span>Proveedor pasarela</span>
          <select value={String(values.ProveedorPasarela ?? '')} onChange={(event) => setValues((previous) => ({ ...previous, ProveedorPasarela: event.target.value }))}>
            <option value="">Selecciona</option>
            <option value="DATAFAST">Datafast</option>
            <option value="PAYPHONE">PayPhone</option>
            <option value="KUSHKI">Kushki</option>
            <option value="PAYPAL">PayPal</option>
            <option value="STRIPE">Stripe</option>
          </select>
        </label>

        <label className="field">
          <span>Transaccion externa</span>
          <input value={String(values.TransaccionExterna ?? '')} onChange={(event) => setValues((previous) => ({ ...previous, TransaccionExterna: event.target.value }))} />
          {errors?.TransaccionExterna ? <small className="field-error">{errors.TransaccionExterna}</small> : null}
        </label>

        <label className="field">
          <span>Codigo autorizacion</span>
          <input value={String(values.CodigoAutorizacion ?? '')} onChange={(event) => setValues((previous) => ({ ...previous, CodigoAutorizacion: event.target.value }))} />
          {errors?.CodigoAutorizacion ? <small className="field-error">{errors.CodigoAutorizacion}</small> : null}
        </label>

        <label className="field field-span-2">
          <span>Referencia</span>
          <input value={String(values.Referencia ?? '')} onChange={(event) => setValues((previous) => ({ ...previous, Referencia: event.target.value }))} />
        </label>
      </div>

      <button type="submit" className="primary-button" disabled={isPending || facturasQuery.isLoading || payableInvoices.length === 0}>
        {isPending ? 'Guardando...' : 'Registrar pago'}
      </button>
    </form>
  );
}

function RoomImageForm({
  record,
  onSubmit,
  isPending,
  errors,
}: {
  record: GenericRecord | null;
  onSubmit: (values: Record<string, unknown>) => void;
  isPending: boolean;
  errors?: Record<string, string>;
}) {
  const [values, setValues] = useState<Record<string, unknown>>({
    IdTipoHabitacion: record?.IdTipoHabitacion ?? '',
    UrlImagen: record?.UrlImagen ?? '',
    DescripcionImagen: record?.DescripcionImagen ?? '',
    OrdenVisualizacion: record?.OrdenVisualizacion ?? 1,
    EsPrincipal: record?.EsPrincipal ?? true,
  });

  const tiposQuery = useQuery({
    queryKey: ['room-image-options', 'tipos-habitacion'],
    queryFn: () => fetchPaged<GenericRecord>('/api/v1/internal/tipos-habitacion', 1, 100),
  });

  const tiposHabitacion = tiposQuery.data?.data ?? [];
  const selectedType = tiposHabitacion.find((tipo) => String(tipo.IdTipoHabitacion ?? '') === String(values.IdTipoHabitacion ?? ''));
  const previewSource = String(values.UrlImagen ?? '').trim();

  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(values);
      }}
    >
      <div className="form-grid">
        <label className="field field-span-2">
          <span>Tipo habitacion</span>
          <select
            required
            value={String(values.IdTipoHabitacion ?? '')}
            onChange={(event) => setValues((previous) => ({ ...previous, IdTipoHabitacion: event.target.value }))}
          >
            <option value="">{tiposQuery.isLoading ? 'Cargando tipos...' : 'Selecciona'}</option>
            {tiposHabitacion.map((tipo) => (
              <option key={String(tipo.IdTipoHabitacion)} value={String(tipo.IdTipoHabitacion)}>
                {recordText(tipo, ['CodigoTipoHabitacion', 'NombreTipoHabitacion', 'TipoCama'], 'IdTipoHabitacion')}
              </option>
            ))}
          </select>
          {selectedType ? <small>Se enviara el ID {String(selectedType.IdTipoHabitacion)} al guardar.</small> : null}
          {!tiposQuery.isLoading && tiposHabitacion.length === 0 ? <small>No hay tipos de habitacion registrados.</small> : null}
          {errors?.IdTipoHabitacion ? <small className="field-error">{errors.IdTipoHabitacion}</small> : null}
        </label>

        <label className="field field-span-2">
          <span>Public ID o URL Cloudinary</span>
          <input
            required
            maxLength={500}
            value={String(values.UrlImagen ?? '')}
            placeholder="gsaxbnwvncx5svjz2oor"
            onChange={(event) => setValues((previous) => ({ ...previous, UrlImagen: event.target.value }))}
          />
          <small>Recomendado: guarda solo el Public ID. Tambien puedes pegar la URL completa.</small>
          {errors?.UrlImagen ? <small className="field-error">{errors.UrlImagen}</small> : null}
        </label>

        {previewSource ? (
          <div className="field field-span-2">
            <span>Vista previa</span>
            <img
              src={cloudinaryImage(previewSource, toNumber(values.OrdenVisualizacion), 640)}
              alt="Vista previa de habitacion"
              style={{ width: '100%', maxHeight: 260, objectFit: 'cover', borderRadius: 8 }}
            />
          </div>
        ) : null}

        <label className="field field-span-2">
          <span>Descripcion</span>
          <input
            maxLength={255}
            value={String(values.DescripcionImagen ?? '')}
            onChange={(event) => setValues((previous) => ({ ...previous, DescripcionImagen: event.target.value }))}
          />
          {errors?.DescripcionImagen ? <small className="field-error">{errors.DescripcionImagen}</small> : null}
        </label>

        <label className="field">
          <span>Orden</span>
          <input
            type="number"
            min={1}
            required
            value={String(values.OrdenVisualizacion ?? 1)}
            onChange={(event) => setValues((previous) => ({ ...previous, OrdenVisualizacion: event.target.value }))}
          />
          {errors?.OrdenVisualizacion ? <small className="field-error">{errors.OrdenVisualizacion}</small> : null}
        </label>

        <label className="field">
          <span>Imagen principal</span>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={Boolean(values.EsPrincipal)}
              onChange={(event) => setValues((previous) => ({ ...previous, EsPrincipal: event.target.checked }))}
            />
            <span>Mostrar primero en el portal</span>
          </label>
        </label>
      </div>

      <button type="submit" className="primary-button" disabled={isPending || tiposQuery.isLoading || tiposHabitacion.length === 0}>
        {isPending ? 'Guardando...' : record ? 'Actualizar imagen' : 'Guardar imagen'}
      </button>
    </form>
  );
}

export function ResourcePage() {
  const { moduleKey = '' } = useParams();
  const { user, hasRole } = useAuth();
  const queryClient = useQueryClient();
  const config = getResourceConfig(moduleKey);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<GenericRecord | null>(null);
  const [actionState, setActionState] = useState<{ config: ActionConfig<GenericRecord>; record: GenericRecord } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string[]>([]);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const pageSize = 20;

  const query = useQuery({
    queryKey: ['resource', moduleKey, page],
    enabled: !!config,
    queryFn: () => fetchPaged<GenericRecord>(config!.path, page, pageSize),
  });

  const relatedColumnKeys = useMemo(() => {
    const keys = new Set<RelationKey>();

    if (!config) {
      return keys;
    }

    for (const column of config.columns) {
      const key = String(column.key);
      if (key !== String(config.idField) && isRelationKey(key)) {
        keys.add(key);
      }
    }

    return keys;
  }, [config]);

  const clientesLookupQuery = useQuery({
    queryKey: ['resource-lookup', 'clientes'],
    enabled: relatedColumnKeys.has('IdCliente'),
    queryFn: () => fetchPaged<GenericRecord>(relationLookups.IdCliente.path, 1, 200),
  });
  const sucursalesLookupQuery = useQuery({
    queryKey: ['resource-lookup', 'sucursales'],
    enabled: relatedColumnKeys.has('IdSucursal'),
    queryFn: () => fetchPaged<GenericRecord>(relationLookups.IdSucursal.path, 1, 200),
  });
  const tiposHabitacionLookupQuery = useQuery({
    queryKey: ['resource-lookup', 'tipos-habitacion'],
    enabled: relatedColumnKeys.has('IdTipoHabitacion'),
    queryFn: () => fetchPaged<GenericRecord>(relationLookups.IdTipoHabitacion.path, 1, 200),
  });
  const habitacionesLookupQuery = useQuery({
    queryKey: ['resource-lookup', 'habitaciones'],
    enabled: relatedColumnKeys.has('IdHabitacion'),
    queryFn: () => fetchPaged<GenericRecord>(relationLookups.IdHabitacion.path, 1, 200),
  });
  const facturasLookupQuery = useQuery({
    queryKey: ['resource-lookup', 'facturas'],
    enabled: relatedColumnKeys.has('IdFactura'),
    queryFn: () => fetchPaged<GenericRecord>(relationLookups.IdFactura.path, 1, 200),
  });
  const reservasLookupQuery = useQuery({
    queryKey: ['resource-lookup', 'reservas'],
    enabled: relatedColumnKeys.has('IdReserva'),
    queryFn: () => fetchPaged<GenericRecord>(relationLookups.IdReserva.path, 1, 200),
  });
  const catalogoLookupQuery = useQuery({
    queryKey: ['resource-lookup', 'catalogo-servicios'],
    enabled: relatedColumnKeys.has('IdCatalogo'),
    queryFn: () => fetchPaged<GenericRecord>(relationLookups.IdCatalogo.path, 1, 200),
  });
  const usuariosLookupQuery = useQuery({
    queryKey: ['resource-lookup', 'usuarios'],
    enabled: relatedColumnKeys.has('IdUsuario'),
    queryFn: () => fetchPaged<GenericRecord>(relationLookups.IdUsuario.path, 1, 200),
  });
  const rolesLookupQuery = useQuery({
    queryKey: ['resource-lookup', 'roles'],
    enabled: relatedColumnKeys.has('IdRol'),
    queryFn: () => fetchPaged<GenericRecord>(relationLookups.IdRol.path, 1, 200),
  });

  const relationMaps = useMemo<Record<RelationKey, Map<string, string>>>(
    () => ({
      IdCliente: buildLookup(clientesLookupQuery.data?.data ?? [], relationLookups.IdCliente.idField, relationLookups.IdCliente.labelKeys),
      IdSucursal: buildLookup(sucursalesLookupQuery.data?.data ?? [], relationLookups.IdSucursal.idField, relationLookups.IdSucursal.labelKeys),
      IdTipoHabitacion: buildLookup(
        tiposHabitacionLookupQuery.data?.data ?? [],
        relationLookups.IdTipoHabitacion.idField,
        relationLookups.IdTipoHabitacion.labelKeys,
      ),
      IdHabitacion: buildLookup(habitacionesLookupQuery.data?.data ?? [], relationLookups.IdHabitacion.idField, relationLookups.IdHabitacion.labelKeys),
      IdFactura: buildLookup(facturasLookupQuery.data?.data ?? [], relationLookups.IdFactura.idField, relationLookups.IdFactura.labelKeys),
      IdReserva: buildLookup(reservasLookupQuery.data?.data ?? [], relationLookups.IdReserva.idField, relationLookups.IdReserva.labelKeys),
      IdCatalogo: buildLookup(catalogoLookupQuery.data?.data ?? [], relationLookups.IdCatalogo.idField, relationLookups.IdCatalogo.labelKeys),
      IdUsuario: buildLookup(usuariosLookupQuery.data?.data ?? [], relationLookups.IdUsuario.idField, relationLookups.IdUsuario.labelKeys),
      IdRol: buildLookup(rolesLookupQuery.data?.data ?? [], relationLookups.IdRol.idField, relationLookups.IdRol.labelKeys),
    }),
    [
      catalogoLookupQuery.data?.data,
      clientesLookupQuery.data?.data,
      facturasLookupQuery.data?.data,
      habitacionesLookupQuery.data?.data,
      reservasLookupQuery.data?.data,
      rolesLookupQuery.data?.data,
      sucursalesLookupQuery.data?.data,
      tiposHabitacionLookupQuery.data?.data,
      usuariosLookupQuery.data?.data,
    ],
  );

  const createMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => createRecord(config!.path, payload),
    onSuccess: () => {
      setFormOpen(false);
      setEditingRecord(null);
      queryClient.invalidateQueries({ queryKey: ['resource', moduleKey] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string | number; payload: Record<string, unknown> }) => updateRecord(config!.path, id, payload),
    onSuccess: () => {
      setFormOpen(false);
      setEditingRecord(null);
      queryClient.invalidateQueries({ queryKey: ['resource', moduleKey] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string | number) => deleteRecord(config!.path, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['resource', moduleKey] }),
  });

  const actionMutation = useMutation({
    mutationFn: ({ action, record, values }: { action: ActionConfig<GenericRecord>; record: GenericRecord; values: Record<string, unknown> }) =>
      runAction(action.method, action.endpoint(record), action.buildPayload?.(values, record, user?.username ?? '') ?? values),
    onSuccess: () => {
      setActionState(null);
      queryClient.invalidateQueries({ queryKey: ['resource', moduleKey] });
    },
  });

  if (!config) {
    return <div className="empty-state">No existe el modulo solicitado.</div>;
  }

  if (!user || !config.roles.some((role) => hasRole(role))) {
    return <div className="empty-state">No tienes permisos para ver este modulo.</div>;
  }

  const list = query.data?.data ?? [];
  const getColumnDisplayText = (record: GenericRecord, columnKey: string) => {
    const rawValue = record[columnKey];
    if (rawValue === null || rawValue === undefined || String(rawValue).trim() === '') {
      return '-';
    }

    if (columnKey !== String(config.idField) && isRelationKey(columnKey)) {
      return relationMaps[columnKey].get(String(rawValue)) ?? `#${String(rawValue)}`;
    }

    return String(rawValue);
  };

  const renderCellValue = (record: GenericRecord, columnKey: string) => {
    const rawValue = record[columnKey];
    const text = getColumnDisplayText(record, columnKey);

    if (columnKey !== String(config.idField) && isRelationKey(columnKey) && text !== '-' && rawValue !== null && rawValue !== undefined) {
      return <span title={`ID ${String(rawValue)}`}>{text}</span>;
    }

    return text;
  };

  const filteredRecords = list.filter((record) =>
    search.trim() === ''
      ? true
      : config.columns.some((column) => {
          const key = String(column.key);
          const value = getColumnDisplayText(record, key);
          return value.toLowerCase().includes(search.toLowerCase());
        }),
  );

  const visibleCreate = config.capabilities.create && hasRole('admin', 'vendedor');
  const visibleUpdate = config.capabilities.update && hasRole('admin', 'vendedor');
  const visibleDelete = config.capabilities.delete && hasRole('admin');

  const openCreate = () => {
    setErrorMessage(null);
    setErrorDetails([]);
    setFormErrors({});
    setEditingRecord(null);
    setFormOpen(true);
  };

  const openEdit = (record: GenericRecord) => {
    setErrorMessage(null);
    setErrorDetails([]);
    setFormErrors({});
    setEditingRecord(record);
    setFormOpen(true);
  };

  const submitForm = async (values: Record<string, unknown>) => {
    setErrorMessage(null);
    setErrorDetails([]);
    setFormErrors({});

    try {
      const activeFields = config.fields.filter((field) => {
        if (editingRecord && field.createOnly) {
          return false;
        }

        if (!editingRecord && field.updateOnly) {
          return false;
        }

        return true;
      });
      const validationContext = {
        existingRecords: list,
        currentRecordId: editingRecord?.[String(config.idField)],
        idField: String(config.idField),
      };
      const rawValues = config.key === 'reservas' ? normalizeReservationFormValues(values) : values;
      validateClientForm(config.key, activeFields, normalizeClientValues(rawValues), editingRecord ? 'update' : 'create', validationContext);
      const normalized = normalizeClientValues(normalizePayload(activeFields, rawValues));
      if (config.key === 'reservas') {
        normalized.Habitaciones = Array.isArray(rawValues.Habitaciones) ? rawValues.Habitaciones : normalized.Habitaciones;
      }
      validateClientForm(config.key, activeFields, normalized, editingRecord ? 'update' : 'create', validationContext);

      if (editingRecord) {
        const payload = config.prepareUpdatePayload
          ? config.prepareUpdatePayload({ ...editingRecord, ...normalized }, user.username)
          : { ...editingRecord, ...normalized, [config.updateAuditField ?? 'ModificadoPorUsuario']: user.username };

        await updateMutation.mutateAsync({
          id: editingRecord[String(config.idField)] as string | number,
          payload,
        });
        return;
      }

      const payload = config.prepareCreatePayload
        ? config.prepareCreatePayload(normalized, user.username)
        : { ...normalized, [config.createAuditField ?? 'CreadoPorUsuario']: user.username };

      await createMutation.mutateAsync(payload);
    } catch (error) {
      if (error instanceof ClientValidationError) {
        setErrorMessage(error.message);
        setErrorDetails(error.details);
        setFormErrors(error.fieldErrors);
        return;
      }

      setErrorMessage(getApiErrorMessage(error));
      setErrorDetails(getApiErrorDetails(error));
    }
  };

  const handleDelete = async (record: GenericRecord) => {
    if (!window.confirm(`Se eliminara el registro ${record[String(config.idField)]}. Deseas continuar?`)) {
      return;
    }

    try {
      setErrorMessage(null);
      setErrorDetails([]);
      await deleteMutation.mutateAsync(record[String(config.idField)] as string | number);
    } catch (error) {
      setErrorMessage(getApiErrorMessage(error));
      setErrorDetails(getApiErrorDetails(error));
    }
  };

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>{config.title}</h2>
            <p>{config.description}</p>
          </div>
          <div className="toolbar">
            <input className="search-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar en la pagina actual" />
            {visibleCreate ? (
              <button type="button" className="primary-button icon-text" onClick={openCreate}>
                <Plus size={18} />
                <span>Nuevo registro</span>
              </button>
            ) : null}
          </div>
        </div>

        {errorMessage ? (
          <StatusMessage kind="error" title={errorMessage} details={errorDetails} />
        ) : null}

        {query.isLoading ? <div className="empty-state">Cargando registros...</div> : null}
        {query.isError ? <div className="empty-state">No se pudo cargar el modulo.</div> : null}

        {!query.isLoading && !query.isError ? (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    {config.columns.map((column) => (
                      <th key={String(column.key)}>{column.label}</th>
                    ))}
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecords.length === 0 ? (
                    <tr>
                      <td colSpan={config.columns.length + 1}>
                        <div className="empty-state compact">No hay registros en esta pagina.</div>
                      </td>
                    </tr>
                  ) : (
                    filteredRecords.map((record) => {
                      const rowClosed = isClosedForRowActions(config.key, record);
                      const rowActions =
                        config.actions?.filter(
                          (action) =>
                            action.roles.some((role) => hasRole(role)) &&
                            (action.variant !== 'danger' || hasRole('admin')) &&
                            isActionAvailableForRecord(config.key, action, record),
                        ) ?? [];
                      const canEditRow = visibleUpdate && !rowClosed;
                      const canDeleteRow = visibleDelete && !rowClosed;
                      const hasRowActions = canEditRow || canDeleteRow || rowActions.length > 0;

                      return (
                        <tr key={String(record[String(config.idField)])}>
                          {config.columns.map((column) => (
                            <td key={`${String(record[String(config.idField)])}-${String(column.key)}`}>
                              {column.render ? column.render(record) : renderCellValue(record, String(column.key))}
                            </td>
                          ))}
                          <td>
                            <div className="row-actions">
                              {canEditRow ? (
                                <button type="button" className="secondary-button small icon-text" onClick={() => openEdit(record)}>
                                  <Pencil size={16} />
                                  <span>Editar</span>
                                </button>
                              ) : null}
                              {canDeleteRow ? (
                                <button type="button" className="danger-button small icon-text" onClick={() => void handleDelete(record)}>
                                  <Trash2 size={16} />
                                  <span>Eliminar</span>
                                </button>
                              ) : null}
                              {rowActions.map((action) => (
                                <button
                                  key={action.key}
                                  type="button"
                                  className={`${action.variant === 'danger' ? 'danger-button' : 'secondary-button'} small`}
                                  onClick={() => setActionState({ config: action, record })}
                                >
                                  {action.label}
                                </button>
                              ))}
                              {!hasRowActions ? <span className="muted-cell">Sin acciones</span> : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="pager">
              <button type="button" className="secondary-button icon-text" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
                <ChevronLeft size={18} />
                <span>Anterior</span>
              </button>
              <span>
                Pagina {query.data?.metadata.pagina_actual ?? page} de {query.data?.metadata.total_paginas ?? 1}
              </span>
              <button
                type="button"
                className="secondary-button icon-text"
                disabled={!query.data?.metadata.tiene_siguiente}
                onClick={() => setPage((current) => current + 1)}
              >
                <span>Siguiente</span>
                <ChevronRight size={18} />
              </button>
            </div>
          </>
        ) : null}
      </section>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editingRecord ? `Editar ${config.title}` : `Nuevo ${config.title}`}
        description={editingRecord ? 'Modifica los datos necesarios y guarda los cambios.' : 'Completa la informacion del nuevo registro.'}
      >
        {config.key === 'reservas' ? (
          <ReservationForm
            record={editingRecord}
            onSubmit={submitForm}
            isPending={createMutation.isPending || updateMutation.isPending}
            errors={formErrors}
          />
        ) : config.key === 'habitaciones' ? (
          <RoomForm
            record={editingRecord}
            onSubmit={submitForm}
            isPending={createMutation.isPending || updateMutation.isPending}
            errors={formErrors}
          />
        ) : config.key === 'tarifas' ? (
          <TariffForm
            record={editingRecord}
            onSubmit={submitForm}
            isPending={createMutation.isPending || updateMutation.isPending}
            errors={formErrors}
          />
        ) : config.key === 'catalogo-servicios' ? (
          <CatalogServiceForm
            record={editingRecord}
            onSubmit={submitForm}
            isPending={createMutation.isPending || updateMutation.isPending}
            errors={formErrors}
          />
        ) : config.key === 'pagos' ? (
          <PaymentForm
            record={editingRecord}
            onSubmit={submitForm}
            isPending={createMutation.isPending || updateMutation.isPending}
            errors={formErrors}
          />
        ) : config.key === 'tipos-habitacion-imagenes' ? (
          <RoomImageForm
            record={editingRecord}
            onSubmit={submitForm}
            isPending={createMutation.isPending || updateMutation.isPending}
            errors={formErrors}
          />
        ) : (
          <ResourceForm
            fields={config.fields}
            defaults={config.initialValues}
            record={editingRecord}
            onSubmit={submitForm}
            isPending={createMutation.isPending || updateMutation.isPending}
            errors={formErrors}
          />
        )}
      </Modal>

      <Modal
        open={!!actionState}
        onClose={() => setActionState(null)}
        title={actionState?.config.label ?? 'Accion'}
        description={actionState ? `Registro #${String(actionState.record[String(config.idField)])}` : undefined}
      >
        {actionState ? (
          <ActionForm
            fields={actionState.config.fields ?? []}
            isPending={actionMutation.isPending}
            onSubmit={(values) => actionMutation.mutate({ action: actionState.config, record: actionState.record, values })}
          />
        ) : null}
      </Modal>
    </div>
  );
}
