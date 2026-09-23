import { Link, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';

const NAV_LINKS: { to: string; label: string; roles: string[] }[] = [
  { to: '/admin', label: 'Admin', roles: ['admin'] },
  { to: '/staff/kitchen', label: 'Kitchen', roles: ['admin', 'kitchen'] },
  { to: '/staff/bar', label: 'Bar', roles: ['admin', 'bar'] },
  { to: '/staff/waiter', label: 'Waiter', roles: ['admin', 'waiter'] },
];

export function StaffLayout({ title, connected, children }: { title: string; connected?: boolean; children: ReactNode }) {
  const { session, logout } = useAuth();
  const navigate = useNavigate();

  if (!session) return null;

  return (
    <>
      <header>
        <div className="top-bar">
          <h1>{title}</h1>
          <button
            className="secondary"
            onClick={() => {
              logout();
              navigate('/staff/login');
            }}
          >
            Log out
          </button>
        </div>
        <div className="sub">
          {connected !== undefined && (
            <>
              <span className={`conn-dot ${connected ? 'live' : ''}`} />
              {connected ? 'live' : 'reconnecting…'} &middot;{' '}
            </>
          )}
          {session.name} ({session.role})
        </div>
        <nav>
          {NAV_LINKS.filter((l) => l.roles.includes(session.role)).map((l) => (
            <Link key={l.to} to={l.to}>
              {l.label}
            </Link>
          ))}
        </nav>
      </header>
      <main>{children}</main>
    </>
  );
}
