import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, BadgeCheck, CreditCard, LockKeyhole, Receipt, ShieldCheck, Sparkles } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { brand } from '../app/brand';
import { StatusMessage } from '../components/StatusMessage';
import { getPublicReservation, simulatePublicPayment } from './publicApi';

function money(value: number, currency = 'USD') {
  return new Intl.NumberFormat('es-EC', { style: 'currency', currency }).format(value);
}

function formatCardNumber(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 16);
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
}

function formatExpiry(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) {
    return digits;
  }
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

function isFutureExpiry(value: string) {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 4) {
    return false;
  }

  const month = Number(digits.slice(0, 2));
  const year = 2000 + Number(digits.slice(2));
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  return month >= 1 && month <= 12 && (year > currentYear || (year === currentYear && month > currentMonth));
}

function maskCardNumber(value: string) {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 4) {
    return '**** **** **** ****';
  }
  return `**** **** **** ${digits.slice(-4)}`;
}

function generateReference() {
  return `PAY-${Math.random().toString(36).slice(2, 8).toUpperCase()}-${Date.now().toString().slice(-6)}`;
}

export function CustomerPaymentPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const reservaGuid = searchParams.get('reserva') ?? '';
  const [form, setForm] = useState({
    cardholder: '',
    cardNumber: '',
    expiry: '',
    cvv: '',
    reference: generateReference(),
  });
  const [error, setError] = useState<string | null>(null);

  const reservationQuery = useQuery({
    queryKey: ['public-reservation', reservaGuid],
    queryFn: () => getPublicReservation(reservaGuid),
    enabled: Boolean(reservaGuid),
  });

  const reservation = reservationQuery.data;
  const invoice = reservation?.Factura;
  const isPaid = invoice?.SaldoPendiente === 0 || invoice?.Estado === 'PAG';

  useEffect(() => {
    setForm((current) => ({ ...current, reference: generateReference() }));
  }, [reservaGuid]);

  const paymentReady =
    form.cardholder.trim().length >= 4 &&
    form.cardNumber.replace(/\D/g, '').length === 16 &&
    form.expiry.replace(/\D/g, '').length === 4 &&
    isFutureExpiry(form.expiry) &&
    form.cvv.replace(/\D/g, '').length >= 3;
  const expiryComplete = form.expiry.replace(/\D/g, '').length === 4;
  const expiryInvalid = expiryComplete && !isFutureExpiry(form.expiry);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!invoice) {
        throw new Error('No encontramos una factura pendiente para esta reserva.');
      }

      if (!paymentReady) {
        throw new Error(expiryInvalid ? 'La fecha de vencimiento debe ser posterior al mes actual.' : 'Completa los datos de la tarjeta para continuar.');
      }

      setError(null);
      return simulatePublicPayment({
        FacturaGuid: invoice.FacturaGuid,
        MetodoPago: 'TARJETA',
        TitularPago: form.cardholder.trim(),
        Referencia: form.reference,
        Moneda: invoice.Moneda,
      });
    },
    onError: (requestError) => {
      setError(requestError instanceof Error ? requestError.message : 'No pudimos procesar el pago.');
    },
    onSuccess: () => {
      reservationQuery.refetch();
    },
  });

  const lineItems = useMemo(() => reservation?.Habitaciones ?? [], [reservation]);
  const stayLabel = reservation ? `${reservation.FechaInicio.slice(0, 10)} al ${reservation.FechaFin.slice(0, 10)}` : '';
  const cardBrand = form.cardNumber.startsWith('4') ? 'Visa' : form.cardNumber.startsWith('5') ? 'Mastercard' : 'Tarjeta';

  if (!reservaGuid) {
    return (
      <div className="customer-site payment-site">
        <main className="customer-section">
          <StatusMessage kind="error" title="No encontramos una reserva para pagar." />
          <Link to="/" className="customer-secondary-button">Volver al hotel</Link>
        </main>
      </div>
    );
  }

  return (
    <div className="customer-site payment-site">
      <header className="customer-nav">
        <div className="brand">
          <div className="brand-mark">{brand.mark}</div>
          <div>
            <strong>{brand.name}</strong>
            <span>Checkout seguro</span>
          </div>
        </div>
        <nav>
          <button type="button" className="customer-secondary-button icon-text" onClick={() => navigate('/')}>
            <ArrowLeft size={16} />
            <span>Volver al hotel</span>
          </button>
        </nav>
      </header>

      <main className="customer-section payment-layout polished">
        <section className="payment-panel payment-main-panel">
          <div className="payment-intro">
            <span className="eyebrow">Pago de reserva</span>
            <h1>Finaliza tu confirmacion.</h1>
            <p>Tu habitacion ya quedo apartada y la factura de reserva esta emitida. Completa el pago con tarjeta para dejar tu estadia confirmada.</p>
          </div>

          {reservationQuery.isLoading ? <div className="empty-state">Cargando informacion de la reserva...</div> : null}
          {reservationQuery.isError ? <StatusMessage kind="error" title="No pudimos cargar la reserva para pago." /> : null}

          {reservation ? (
            <div className="payment-summary-card refined">
              <div>
                <small>Reserva</small>
                <strong>{reservation.CodigoReserva}</strong>
              </div>
              <div>
                <small>Factura</small>
                <strong>{invoice?.NumeroFactura ?? 'Pendiente'}</strong>
              </div>
              <div>
                <small>Estadia</small>
                <strong>{stayLabel}</strong>
              </div>
              <div>
                <small>Total</small>
                <strong>{money(invoice?.Total ?? reservation.TotalReserva, invoice?.Moneda ?? 'USD')}</strong>
              </div>
            </div>
          ) : null}

          {mutation.isSuccess ? (
            <div className="payment-success-card deluxe">
              <div className="success-mark"><BadgeCheck size={34} /></div>
              <span className="eyebrow">Pago aprobado</span>
              <h2>Tu reserva quedo pagada.</h2>
              <p>Registramos el pago con exito y la factura ya no tiene saldo pendiente. En recepcion veran la reserva lista para tu llegada.</p>
              <div className="payment-success-meta">
                <span>Referencia: {mutation.data.Pago.Referencia}</span>
                <span>Transaccion: {mutation.data.Pago.TransaccionExterna}</span>
                <span>Autorizacion: {mutation.data.Pago.CodigoAutorizacion}</span>
              </div>
              <div className="payment-actions">
                <button type="button" className="customer-primary-button" onClick={() => reservationQuery.refetch()}>
                  Ver resumen actualizado
                </button>
                <Link to="/" className="customer-secondary-button">Volver al hotel</Link>
              </div>
            </div>
          ) : invoice && !isPaid ? (
            <div className="payment-checkout-grid">
              <form className="payment-form deluxe" onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}>
                <div className="payment-form-header">
                  <div>
                    <span className="eyebrow">Tarjeta</span>
                    <h2>Datos de pago</h2>
                  </div>
                  <span className="payment-lock"><LockKeyhole size={14} /> Pago seguro</span>
                </div>

                <label className="span-2">
                  <span>Nombre del titular</span>
                  <input
                    value={form.cardholder}
                    onChange={(event) => setForm((current) => ({ ...current, cardholder: event.target.value }))}
                    placeholder="Como aparece en la tarjeta"
                  />
                </label>

                <label className="span-2">
                  <span>Numero de tarjeta</span>
                  <input
                    inputMode="numeric"
                    value={form.cardNumber}
                    onChange={(event) => setForm((current) => ({ ...current, cardNumber: formatCardNumber(event.target.value) }))}
                    placeholder="1234 5678 9012 3456"
                  />
                </label>

                <label>
                  <span>Expiracion</span>
                  <input
                    className={expiryInvalid ? 'input-error' : ''}
                    inputMode="numeric"
                    value={form.expiry}
                    onChange={(event) => setForm((current) => ({ ...current, expiry: formatExpiry(event.target.value) }))}
                    placeholder="MM/AA"
                  />
                  {expiryInvalid ? <small className="field-error">Debe ser posterior al mes actual.</small> : null}
                </label>

                <label>
                  <span>CVV</span>
                  <input
                    inputMode="numeric"
                    value={form.cvv}
                    onChange={(event) => setForm((current) => ({ ...current, cvv: event.target.value.replace(/\D/g, '').slice(0, 4) }))}
                    placeholder="123"
                  />
                </label>

                <label className="span-2">
                  <span>Referencia de pago</span>
                  <input value={form.reference} readOnly />
                </label>

                {error ? <StatusMessage kind="error" title={error} /> : null}

                <button type="submit" className="customer-primary-button icon-text" disabled={mutation.isPending || !paymentReady}>
                  <CreditCard size={18} />
                  <span>{mutation.isPending ? 'Procesando pago...' : `Pagar ${money(invoice.SaldoPendiente, invoice.Moneda)}`}</span>
                </button>
              </form>

              <aside className="payment-card-stage">
                <div className="payment-card-preview">
                  <div className="payment-card-top">
                    <span>{cardBrand}</span>
                    <Sparkles size={16} />
                  </div>
                  <strong>{maskCardNumber(form.cardNumber)}</strong>
                  <div className="payment-card-bottom">
                    <div>
                      <small>Titular</small>
                      <span>{form.cardholder || 'Nombre del titular'}</span>
                    </div>
                    <div>
                      <small>Expira</small>
                      <span>{form.expiry || 'MM/AA'}</span>
                    </div>
                  </div>
                </div>

                <div className="payment-side-note">
                  <article>
                    <ShieldCheck size={18} />
                    <div>
                      <strong>Factura emitida</strong>
                      <p>{invoice.NumeroFactura}</p>
                    </div>
                  </article>
                  <article>
                    <Receipt size={18} />
                    <div>
                      <strong>Saldo actual</strong>
                      <p>{money(invoice.SaldoPendiente, invoice.Moneda)}</p>
                    </div>
                  </article>
                </div>
              </aside>
            </div>
          ) : null}

          {invoice && isPaid && !mutation.isSuccess ? (
            <div className="payment-success-card">
              <ShieldCheck size={42} />
              <h2>Factura pagada</h2>
              <p>Esta reserva ya no tiene valores pendientes.</p>
              <Link to="/" className="customer-secondary-button">Volver al hotel</Link>
            </div>
          ) : null}
        </section>

        <aside className="payment-sidebar">
          <article>
            <Receipt size={22} />
            <div>
              <strong>Resumen de reserva</strong>
              <p>{reservation?.CodigoReserva ?? 'Reserva en proceso'}{stayLabel ? ` - ${stayLabel}` : ''}</p>
            </div>
          </article>
          <article>
            <CreditCard size={22} />
            <div>
              <strong>Total a pagar</strong>
              <p>{invoice ? money(invoice.SaldoPendiente, invoice.Moneda) : 'Calculando importe pendiente'}</p>
            </div>
          </article>
          <article>
            <LockKeyhole size={22} />
            <div>
              <strong>Pago con tarjeta</strong>
              <p>Usa una tarjeta vigente. Al aprobarse, tu reserva queda lista para recepcion.</p>
            </div>
          </article>
        </aside>

        {lineItems.length > 0 ? (
          <section className="payment-lines">
            <div className="customer-section-header">
              <div>
                <span className="eyebrow">Detalle</span>
                <h2>Habitaciones reservadas</h2>
              </div>
            </div>
            <div className="payment-line-list">
              {lineItems.map((line) => (
                <article key={line.ReservaHabitacionGuid}>
                  <strong>Habitacion {line.HabitacionGuid.slice(0, 8)}</strong>
                  <span>{line.NumAdultos} adulto(s) - {line.NumNinos} nino(s)</span>
                  <strong>{money(line.TotalLinea, invoice?.Moneda ?? 'USD')}</strong>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
