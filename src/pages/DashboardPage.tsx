import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { BadgeDollarSign, BedDouble, CalendarDays, MessageSquareText, UsersRound, UserRoundCheck } from 'lucide-react';
import { fetchPaged } from '../app/api';

const dashboardResources = [
  { key: 'usuarios', title: 'Equipo', path: '/api/v1/internal/usuarios', icon: UserRoundCheck },
  { key: 'clientes', title: 'Huespedes', path: '/api/v1/internal/clientes', icon: UsersRound },
  { key: 'habitaciones', title: 'Habitaciones', path: '/api/v1/internal/habitaciones', icon: BedDouble },
  { key: 'reservas', title: 'Reservas', path: '/api/v1/internal/reservas', icon: CalendarDays },
  { key: 'pagos', title: 'Cobros', path: '/api/v1/internal/pagos', icon: BadgeDollarSign },
  { key: 'valoraciones', title: 'Opiniones', path: '/api/v1/internal/valoraciones', icon: MessageSquareText },
];

export function DashboardPage() {
  const queries = useQueries({
    queries: dashboardResources.map((resource) => ({
      queryKey: ['dashboard', resource.key],
      queryFn: () => fetchPaged<Record<string, unknown>>(resource.path, 1, 5),
    })),
  });

  const cards = useMemo(
    () =>
      dashboardResources.map((resource, index) => {
        const query = queries[index];
        return {
          title: resource.title,
          total: query.data?.metadata.total_resultados ?? 0,
          loading: query.isLoading,
          error: query.isError,
          icon: resource.icon,
        };
      }),
    [queries],
  );

  const recentReservations = queries[3]?.data?.data ?? [];
  const recentPayments = queries[4]?.data?.data ?? [];

  return (
    <div className="page-stack">
      <section className="hero-panel">
        <div>
          <span className="eyebrow">Resumen operativo</span>
          <h2>Todo lo importante del hotel en una sola vista.</h2>
          <p>Consulta actividad reciente, capacidad operativa y senales financieras sin perderte entre modulos.</p>
        </div>
      </section>

      <section className="stats-grid">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
          <article key={card.title} className="stat-card">
            <div className="stat-icon"><Icon size={20} /></div>
            <span>{card.title}</span>
            <strong>{card.loading ? '...' : card.total}</strong>
            <small>{card.error ? 'No pudimos cargar este dato' : 'Registros disponibles'}</small>
          </article>
          );
        })}
      </section>

      <section className="dashboard-grid">
        <article className="panel">
          <div className="panel-header">
            <div>
              <h3>Reservas recientes</h3>
              <p>Movimiento reciente de reservas para seguimiento operativo.</p>
            </div>
          </div>
          <div className="list-rows">
            {recentReservations.length === 0 ? (
              <div className="empty-state compact">No hay reservas para mostrar.</div>
            ) : (
              recentReservations.map((reservation) => (
                <div key={String(reservation.IdReserva)} className="list-row">
                  <div>
                    <strong>{String(reservation.CodigoReserva ?? `Reserva ${reservation.IdReserva}`)}</strong>
                    <span>Sucursal #{String(reservation.IdSucursal ?? '-')}</span>
                  </div>
                  <span className="pill">{String(reservation.EstadoReserva ?? '-')}</span>
                </div>
              ))
            )}
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <div>
              <h3>Pagos recientes</h3>
              <p>Ultimos cobros registrados para conciliacion rapida.</p>
            </div>
          </div>
          <div className="list-rows">
            {recentPayments.length === 0 ? (
              <div className="empty-state compact">No hay pagos para mostrar.</div>
            ) : (
              recentPayments.map((payment) => (
                <div key={String(payment.IdPago)} className="list-row">
                  <div>
                    <strong>{String(payment.MetodoPago ?? 'Pago')}</strong>
                    <span>Reserva #{String(payment.IdReserva ?? '-')}</span>
                  </div>
                  <span className="pill">{String(payment.EstadoPago ?? '-')}</span>
                </div>
              ))
            )}
          </div>
        </article>
      </section>
    </div>
  );
}
