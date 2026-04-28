import { useState } from 'react';
import type { ComponentType } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CheckCircle2, ClipboardCheck, CreditCard, FileSearch, Hotel, PlusCircle } from 'lucide-react';
import { fetchPaged, getApiErrorDetails, getApiErrorMessage, runAction } from '../app/api';
import { operationsConfig } from '../app/modules';
import type { FieldConfig, OperationConfig } from '../app/types';
import { ClientValidationError, normalizeClientValues, validateClientForm } from '../app/validation';
import { useAuth } from '../auth/useAuth';
import { StatusMessage } from '../components/StatusMessage';

type GenericRecord = Record<string, unknown>;
type SelectOption = { label: string; value: string };
type OperationMeta = {
  category: 'Reservas' | 'Estadias' | 'Facturacion';
  tone: string;
  icon: ComponentType<{ size?: number }>;
};

const operationMeta: Record<string, OperationMeta> = {
  'confirmar-reserva': { category: 'Reservas', tone: 'Reserva pendiente', icon: CheckCircle2 },
  checkin: { category: 'Estadias', tone: 'Llegada de huesped', icon: Hotel },
  'factura-reserva': { category: 'Facturacion', tone: 'Factura inicial', icon: CreditCard },
  'factura-final': { category: 'Facturacion', tone: 'Cierre de estancia', icon: CreditCard },
  'ver-cargos': { category: 'Estadias', tone: 'Consulta de consumos', icon: FileSearch },
  'crear-cargo': { category: 'Estadias', tone: 'Nuevo consumo', icon: PlusCircle },
  'anular-cargo': { category: 'Estadias', tone: 'Correccion operativa', icon: Ban },
};

function defaultFieldValue(field: FieldConfig) {
  if (field.type === 'checkbox') {
    return false;
  }

  if (field.name === 'Cantidad') {
    return 1;
  }

  if (field.name === 'ValorIva') {
    return 0;
  }

  if (field.name === 'EstadoCargo') {
    return 'PEN';
  }

  if (field.name === 'FechaConsumoUtc') {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  }

  return '';
}

function normalizeFieldValues(fields: FieldConfig[], values: Record<string, unknown>) {
  const normalized = { ...values };

  for (const field of fields) {
    const current = normalized[field.name];

    if (field.type === 'checkbox') {
      normalized[field.name] = Boolean(current);
      continue;
    }

    if (field.type === 'number') {
      normalized[field.name] = current === '' || current === null || current === undefined ? null : Number(current);
      continue;
    }

    if (current === '') {
      normalized[field.name] = null;
    }
  }

  return normalized;
}

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatShortDate(value: unknown) {
  if (!value) {
    return '';
  }

  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleDateString('es-EC', { day: '2-digit', month: '2-digit', year: 'numeric' });
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

function getEnvelopeMessage(value: unknown) {
  if (value && typeof value === 'object') {
    const record = value as GenericRecord;
    return record.Message ?? record.message;
  }

  return undefined;
}

function reservaLabel(reserva: GenericRecord) {
  const code = String(reserva.CodigoReserva ?? `#${String(reserva.IdReserva ?? '')}`);
  const range = [formatShortDate(reserva.FechaInicio), formatShortDate(reserva.FechaFin)].filter(Boolean).join(' - ');
  const total = toNumber(reserva.TotalReserva).toFixed(2);
  return `${code} | ${range || 'Sin fechas'} | ${String(reserva.EstadoReserva ?? '-') } | USD ${total}`;
}

function estadiaLabel(estadia: GenericRecord) {
  const id = String(estadia.IdEstadia ?? '');
  const habitacion = String(estadia.IdHabitacion ?? '-');
  const cliente = String(estadia.IdCliente ?? '-');
  const estado = String(estadia.EstadoEstadia ?? '-');
  return `Estadia #${id} | Habitacion ${habitacion} | Cliente ${cliente} | ${estado}`;
}

function catalogoLabel(catalogo: GenericRecord) {
  const name = String(catalogo.NombreCatalogo ?? `#${String(catalogo.IdCatalogo ?? '')}`);
  const type = String(catalogo.TipoCatalogo ?? '-');
  const price = toNumber(catalogo.PrecioBase).toFixed(2);
  return `${name} | ${type} | USD ${price}`;
}

function cargoLabel(cargo: GenericRecord) {
  const id = String(cargo.IdCargoEstadia ?? '');
  const description = String(cargo.DescripcionCargo ?? `Cargo #${id}`);
  const total = toNumber(cargo.TotalCargo).toFixed(2);
  const state = String(cargo.EstadoCargo ?? '-');
  return `#${id} | ${description} | ${state} | USD ${total}`;
}

function OperationDataView({ data }: { data: unknown }) {
  const rows = extractDataArray(data);

  if (rows.length === 0) {
    return <p>No hay registros para mostrar.</p>;
  }

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Cargo</th>
            <th>Descripcion</th>
            <th>Cantidad</th>
            <th>Precio</th>
            <th>IVA</th>
            <th>Total</th>
            <th>Estado</th>
            <th>Fecha</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row.IdCargoEstadia ?? row.CargoGuid ?? row.DescripcionCargo)}>
              <td>{String(row.IdCargoEstadia ?? '-')}</td>
              <td>{String(row.DescripcionCargo ?? '-')}</td>
              <td>{String(row.Cantidad ?? '-')}</td>
              <td>USD {toNumber(row.PrecioUnitario).toFixed(2)}</td>
              <td>USD {toNumber(row.ValorIva).toFixed(2)}</td>
              <td>USD {toNumber(row.TotalCargo).toFixed(2)}</td>
              <td>{String(row.EstadoCargo ?? '-')}</td>
              <td>{formatShortDate(row.FechaConsumoUtc)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OperationCard({ operation }: { operation: OperationConfig }) {
  const meta = operationMeta[operation.key];
  const Icon = meta?.icon ?? ClipboardCheck;
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, unknown>>(
    operation.fields.reduce<Record<string, unknown>>((accumulator, field) => {
      accumulator[field.name] = defaultFieldValue(field);
      return accumulator;
    }, {}),
  );
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string; details?: string[]; data?: unknown } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const needsReservaOptions = operation.fields.some((field) => field.name === 'ReservaId');
  const needsEstadiaOptions = operation.fields.some((field) => field.name === 'EstadiaId');
  const needsCatalogoOptions = operation.fields.some((field) => field.name === 'IdCatalogo');
  const needsCargoOptions = operation.fields.some((field) => field.name === 'CargoId');
  const needsFacturaOptions = operation.key === 'factura-reserva';

  const reservasQuery = useQuery({
    queryKey: ['operation-options', operation.key, 'reservas'],
    enabled: needsReservaOptions,
    queryFn: () => fetchPaged<GenericRecord>('/api/v1/internal/reservas', 1, 100),
  });
  const estadiasQuery = useQuery({
    queryKey: ['operation-options', operation.key, 'estadias'],
    enabled: needsEstadiaOptions,
    queryFn: () => fetchPaged<GenericRecord>('/api/v1/internal/estadias', 1, 100),
  });
  const catalogoQuery = useQuery({
    queryKey: ['operation-options', operation.key, 'catalogo-servicios'],
    enabled: needsCatalogoOptions,
    queryFn: () => fetchPaged<GenericRecord>('/api/v1/internal/catalogo-servicios', 1, 100),
  });
  const cargosQuery = useQuery({
    queryKey: ['operation-options', operation.key, 'cargos', values.EstadiaId],
    enabled: needsCargoOptions && Boolean(values.EstadiaId),
    queryFn: () => runAction('get', `/api/v1/internal/estadias/${values.EstadiaId}/cargos`),
  });
  const facturasQuery = useQuery({
    queryKey: ['operation-options', operation.key, 'facturas'],
    enabled: needsFacturaOptions,
    queryFn: () => fetchPaged<GenericRecord>('/api/v1/internal/facturas', 1, 100),
  });

  const reservas = reservasQuery.data?.data ?? [];
  const estadias = estadiasQuery.data?.data ?? [];
  const catalogos = catalogoQuery.data?.data ?? [];
  const cargos = extractDataArray(cargosQuery.data).filter((cargo) => String(cargo.EstadoCargo ?? '').toUpperCase() !== 'ANU');
  const facturas = facturasQuery.data?.data ?? [];
  const reservasConFacturaReserva = new Set(
    facturas
      .filter((factura) => String(factura.TipoFactura ?? 'RESERVA').toUpperCase() === 'RESERVA' && String(factura.Estado ?? '').toUpperCase() !== 'ANU')
      .map((factura) => String(factura.IdReserva ?? '')),
  );
  const isLoadingOptions = reservasQuery.isLoading || estadiasQuery.isLoading || catalogoQuery.isLoading || cargosQuery.isLoading || facturasQuery.isLoading;

  const dynamicOptions = (field: FieldConfig): SelectOption[] | null => {
    if (field.name === 'ReservaId') {
      const filteredReservas = reservas.filter((reserva) => {
        const state = String(reserva.EstadoReserva ?? '').toUpperCase();
        if (operation.key === 'confirmar-reserva') {
          return state === 'PEN';
        }

        if (operation.key === 'checkin') {
          return state === 'CON';
        }

        if (operation.key === 'factura-reserva') {
          return state === 'CON' && !reservasConFacturaReserva.has(String(reserva.IdReserva ?? ''));
        }

        return !['CAN'].includes(state);
      });
      return filteredReservas.map((reserva) => ({
        value: String(reserva.IdReserva ?? ''),
        label: reservaLabel(reserva),
      }));
    }

    if (field.name === 'EstadiaId') {
      const filteredEstadias = operation.key === 'crear-cargo'
        ? estadias.filter((estadia) => String(estadia.EstadoEstadia ?? '').toUpperCase() !== 'FIN')
        : estadias;
      return filteredEstadias.map((estadia) => ({
        value: String(estadia.IdEstadia ?? ''),
        label: estadiaLabel(estadia),
      }));
    }

    if (field.name === 'IdCatalogo') {
      return catalogos
        .filter((catalogo) => String(catalogo.EstadoCatalogo ?? '').toUpperCase() !== 'INA')
        .map((catalogo) => ({
          value: String(catalogo.IdCatalogo ?? ''),
          label: catalogoLabel(catalogo),
        }));
    }

    if (field.name === 'CargoId') {
      return cargos.map((cargo) => ({
        value: String(cargo.IdCargoEstadia ?? ''),
        label: cargoLabel(cargo),
      }));
    }

    return null;
  };

  const updateFieldValue = (field: FieldConfig, value: string) => {
    setValues((previous) => {
      const next: Record<string, unknown> = {
        ...previous,
        [field.name]: value,
        ...(field.name === 'EstadiaId' ? { CargoId: '' } : {}),
      };

      if (field.name === 'IdCatalogo') {
        const catalogo = catalogos.find((item) => String(item.IdCatalogo ?? '') === value);
        if (catalogo) {
          next.DescripcionCargo = previous.DescripcionCargo || catalogo.NombreCatalogo || '';
          next.PrecioUnitario = catalogo.PrecioBase ?? previous.PrecioUnitario;
          next.ValorIva = catalogo.AplicaIva ? Math.round(toNumber(catalogo.PrecioBase) * 0.15 * 100) / 100 : 0;
        }
      }

      return next;
    });
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const normalized = normalizeClientValues(normalizeFieldValues(operation.fields, values));
      validateClientForm(operation.key, operation.fields, normalized, 'operation');
      const payload = operation.buildPayload?.(normalized, user?.username ?? '') ?? normalized;
      return runAction(operation.method, operation.path(normalized), payload);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['operation-options'] });
      setFeedback({
        kind: 'success',
        message: String(getEnvelopeMessage(data) ?? operation.successMessage),
        data: operation.responseMode === 'data' ? data : undefined,
      });
    },
    onError: (error) => {
      if (error instanceof ClientValidationError) {
        setFieldErrors(error.fieldErrors);
        setFeedback({
          kind: 'error',
          message: error.message,
          details: error.details,
        });
        return;
      }

      setFeedback({
        kind: 'error',
        message: getApiErrorMessage(error),
        details: getApiErrorDetails(error),
      });
    },
  });

  return (
    <article className="panel">
      <div className="panel-header">
        <div className="operation-title">
          <span className="operation-icon"><Icon size={20} /></span>
          <div>
          <span className="eyebrow">{meta?.tone ?? 'Operacion'}</span>
          <h3>{operation.title}</h3>
          <p>{operation.description}</p>
          </div>
        </div>
      </div>

      <form
        className="stack-form"
        onSubmit={(event) => {
          event.preventDefault();
          setFieldErrors({});
          mutation.mutate();
        }}
      >
        <div className="form-grid">
          {operation.fields.map((field) => {
            const options = dynamicOptions(field);
            const disabledSelect = field.name === 'CargoId' && !values.EstadiaId;

            return (
              <label key={field.name} className={`field ${field.type === 'textarea' ? 'field-span-2' : ''}`}>
                <span>{field.label}</span>
                {options ? (
                  <select
                    required={field.required}
                    value={String(values[field.name] ?? '')}
                    disabled={disabledSelect}
                    onChange={(event) => updateFieldValue(field, event.target.value)}
                  >
                    <option value="">{disabledSelect ? 'Selecciona primero una estadia' : 'Selecciona'}</option>
                    {options.map((option) => (
                      <option key={`${field.name}-${option.value}`} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : null}

                {field.type === 'textarea' ? (
                  <textarea
                    value={String(values[field.name] ?? '')}
                    rows={4}
                    onChange={(event) => updateFieldValue(field, event.target.value)}
                  />
                ) : null}

                {!options && field.type === 'select' ? (
                  <select value={String(values[field.name] ?? '')} onChange={(event) => updateFieldValue(field, event.target.value)}>
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
                      checked={Boolean(values[field.name])}
                      onChange={(event) => setValues((previous) => ({ ...previous, [field.name]: event.target.checked }))}
                    />
                    <span>{field.label}</span>
                  </label>
                ) : null}

                {!options && !['textarea', 'select', 'checkbox'].includes(field.type) ? (
                  <input
                    type={field.type}
                    required={field.required}
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    maxLength={field.maxLength}
                    value={String(values[field.name] ?? '')}
                    onChange={(event) => updateFieldValue(field, event.target.value)}
                  />
                ) : null}
                {options && options.length === 0 && !isLoadingOptions ? <small>No hay opciones disponibles para este campo.</small> : null}
                {fieldErrors[field.name] ? <small className="field-error">{fieldErrors[field.name]}</small> : null}
              </label>
            );
          })}
        </div>

        <button type="submit" className="primary-button" disabled={mutation.isPending || isLoadingOptions}>
          {mutation.isPending ? 'Procesando...' : operation.title}
        </button>
      </form>

      {feedback ? (
        <StatusMessage kind={feedback.kind} title={feedback.message} details={feedback.details}>
          {feedback.data ? <OperationDataView data={feedback.data} /> : null}
        </StatusMessage>
      ) : null}
    </article>
  );
}

export function OperationsPage() {
  const { hasRole } = useAuth();
  const allowedOperations = operationsConfig.filter((operation) => operation.roles.some((role) => hasRole(role)));
  const [selectedKey, setSelectedKey] = useState(allowedOperations[0]?.key ?? '');
  const selectedOperation = allowedOperations.find((operation) => operation.key === selectedKey) ?? allowedOperations[0];
  const categories = Array.from(new Set(allowedOperations.map((operation) => operationMeta[operation.key]?.category ?? 'Reservas')));

  return (
    <div className="page-stack">
      <section className="hero-panel">
        <div>
          <span className="eyebrow">Operaciones especiales</span>
          <h2>Ejecuta acciones criticas sin perder contexto.</h2>
          <p>Selecciona una accion, revisa sus campos y completa solo lo necesario. Las listas se filtran para reducir errores operativos.</p>
        </div>
      </section>

      <section className="operations-layout">
        <aside className="operation-menu panel">
          {categories.map((category) => (
            <div key={category} className="operation-group">
              <p className="nav-label">{category}</p>
              {allowedOperations
                .filter((operation) => (operationMeta[operation.key]?.category ?? 'Reservas') === category)
                .map((operation) => {
                  const meta = operationMeta[operation.key];
                  const Icon = meta?.icon ?? ClipboardCheck;
                  return (
                    <button
                      key={operation.key}
                      type="button"
                      className={`operation-button ${selectedOperation?.key === operation.key ? 'active' : ''}`}
                      onClick={() => setSelectedKey(operation.key)}
                    >
                      <Icon size={18} />
                      <span>{operation.title}</span>
                    </button>
                  );
                })}
            </div>
          ))}
        </aside>

        <div className="operation-workspace">
          {selectedOperation ? <OperationCard key={selectedOperation.key} operation={selectedOperation} /> : null}
        </div>
      </section>
    </div>
  );
}
