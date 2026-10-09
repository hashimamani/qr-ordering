import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useBrandColor } from '../../hooks/useBrandColor';
import {
  ChefHatIcon,
  GlassIcon,
  LayoutFloorIcon,
  LayoutGridIcon,
  LogOutIcon,
  MenuIcon,
  SlidersIcon,
  SparklesIcon,
  EyeIcon,
  XIcon,
} from '../../components/icons';

const SECTIONS = [
  { to: '/admin/overview', label: 'Overview', icon: LayoutGridIcon },
  { to: '/admin/kitchen', label: 'Kitchen', icon: ChefHatIcon },
  { to: '/admin/bar', label: 'Bar', icon: GlassIcon },
  { to: '/admin/services', label: 'Services', icon: SparklesIcon },
  { to: '/admin/floor', label: 'Floor', icon: LayoutFloorIcon },
  { to: '/admin/management', label: 'Management', icon: SlidersIcon },
];

/**
 * The admin's own shell, deliberately not StaffLayout: the dark bar that
 * sits across the top for kitchen/bar/waiter becomes a fixed sidebar
 * here, so the back-office reads as a different surface from the
 * station screens while staying on the same palette.
 *
 * Sections are real nested routes rather than local tab state, so an
 * admin can deep-link to (and refresh on) a board without losing their
 * place.
 */
export function AdminLayout() {
  const { session, logout } = useAuth();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);
  useBrandColor(session?.brandColor);

  if (!session) return null;

  return (
    <div className="admin-shell-wrap">
      {/* Always visible, never dismissible. Someone looking at a tenant's
          data needs to know whose data it is and that they are a guest in
          it -- and why the buttons they expect are missing. */}
      {session.readOnly && (
        <div className="readonly-banner" role="status">
          <EyeIcon size={15} />
          <span>
            Read-only view of <strong>{session.restaurantName}</strong> — you cannot make changes.
          </span>
          <button
            className="readonly-banner-exit"
            onClick={() => {
              logout();
              navigate('/platform-admin');
            }}
          >
            Leave
          </button>
        </div>
      )}
      <div className="admin-shell">
      <button
        className="admin-drawer-toggle"
        onClick={() => setDrawerOpen(true)}
        aria-label="Open navigation"
      >
        <MenuIcon size={20} />
      </button>

      {drawerOpen && <div className="admin-scrim" onClick={() => setDrawerOpen(false)} />}

      <aside className={`admin-sidebar ${drawerOpen ? 'open' : ''}`}>
        <div className="admin-brand">
          <span className="admin-brand-mark" aria-hidden="true" />
          <span className="admin-brand-text">
            <strong>{session.restaurantName || 'Admin'}</strong>
            <small>Tab admin</small>
          </span>
          <button
            className="admin-drawer-close"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close navigation"
          >
            <XIcon size={18} />
          </button>
        </div>

        <nav className="admin-nav">
          {SECTIONS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => (isActive ? 'active' : '')}
              onClick={() => setDrawerOpen(false)}
            >
              <Icon size={17} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="admin-sidebar-footer">
          <div className="admin-user">
            <span className="admin-user-name">{session.name}</span>
            <span className="admin-user-role">{session.role}</span>
          </div>
          <button
            className="admin-logout"
            onClick={() => {
              logout();
              navigate('/staff/login');
            }}
          >
            <LogOutIcon size={15} />
            Log out
          </button>
        </div>
      </aside>

      <main className="admin-content">
        <Outlet />
      </main>
      </div>
    </div>
  );
}
