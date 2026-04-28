import { useState } from 'react';
import type { ComponentType } from 'react';
import {
  BedDouble,
  Building2,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  CreditCard,
  FileText,
  Gauge,
  Hotel,
  Images,
  LogOut,
  Menu,
  Settings2,
  ShieldCheck,
  Star,
  Tags,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { brand } from '../app/brand';
import { API_URL } from '../app/api';
import { getVisibleResources } from '../app/modules';
import { useAuth } from '../auth/useAuth';

const resourceIcons: Record<string, ComponentType<{ size?: number }>> = {
  usuarios: UserRound,
  roles: ShieldCheck,
  clientes: UsersRound,
  sucursales: Building2,
  'tipos-habitacion': BedDouble,
  'tipos-habitacion-imagenes': Images,
  habitaciones: Hotel,
  tarifas: Tags,
  'catalogo-servicios': ClipboardList,
  reservas: CalendarCheck,
  estadias: BedDouble,
  pagos: CreditCard,
  facturas: FileText,
  valoraciones: Star,
};

export function AppLayout() {
  const { user, logout, hasRole } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const resources = getVisibleResources(user?.roles ?? []);
  const shellClassName = `shell ${collapsed ? 'sidebar-collapsed' : ''} ${mobileOpen ? 'mobile-nav-open' : ''}`;

  return (
    <div className={shellClassName}>
      <button type="button" className="mobile-menu-button" onClick={() => setMobileOpen(true)} aria-label="Abrir menu">
        <Menu size={20} />
      </button>
      <div className="sidebar-scrim" onClick={() => setMobileOpen(false)} />
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">{brand.mark}</div>
          <div className="brand-text">
            <strong>{brand.name}</strong>
            <span>{brand.tagline}</span>
          </div>
          <button type="button" className="icon-button sidebar-close" onClick={() => setMobileOpen(false)} aria-label="Cerrar menu">
            <X size={18} />
          </button>
        </div>

        <nav className="nav-section">
          <p className="nav-label">General</p>
          <NavLink to="/dashboard" className="nav-link" onClick={() => setMobileOpen(false)}>
            <Gauge size={18} />
            <span>Dashboard</span>
          </NavLink>
          <NavLink to="/operations" className="nav-link" onClick={() => setMobileOpen(false)}>
            <Settings2 size={18} />
            <span>Operaciones</span>
          </NavLink>
        </nav>

        <nav className="nav-section">
          <p className="nav-label">Modulos</p>
          {resources.map((resource) => {
            const Icon = resourceIcons[resource.key] ?? ClipboardList;
            return (
              <NavLink key={resource.key} to={`/resources/${resource.key}`} className="nav-link" onClick={() => setMobileOpen(false)}>
                <Icon size={18} />
                <span>{resource.title}</span>
              </NavLink>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <span className="environment-tag">{API_URL}</span>
          {hasRole('admin') ? <span className="role-chip">Admin</span> : null}
          {hasRole('vendedor') ? <span className="role-chip">Vendedor</span> : null}
        </div>

        <button type="button" className="collapse-button" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? 'Expandir menu' : 'Contraer menu'}>
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          <span>{collapsed ? 'Expandir' : 'Contraer'}</span>
        </button>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">{brand.shortName} Backoffice</span>
            <h1>Centro operativo</h1>
            <p>Gestiona reservas, habitaciones, cobros y servicio al huesped desde una consola clara.</p>
          </div>
          <div className="topbar-actions">
            <div className="user-card">
              <strong>{user?.nombres || user?.username}</strong>
              <span>{user?.correo}</span>
            </div>
            <button type="button" className="secondary-button icon-text" onClick={logout}>
              <LogOut size={18} />
              <span>Cerrar sesion</span>
            </button>
          </div>
        </header>

        <main className="page-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
