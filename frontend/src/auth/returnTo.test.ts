import { describe, it, expect } from 'vitest';
import { destinationAfterLogin, platformAdminDestination, ROLE_DESTINATION } from './returnTo';

describe('where a staff login lands', () => {
  it('returns to the page the lapsed session interrupted', () => {
    expect(destinationAfterLogin('kitchen', '/staff/kitchen')).toBe('/staff/kitchen');
    expect(destinationAfterLogin('waiter', '/staff/waiter')).toBe('/staff/waiter');
  });

  it('keeps the query string, so a filtered view comes back filtered', () => {
    expect(destinationAfterLogin('admin', '/admin/overview?from=2026-01-01')).toBe(
      '/admin/overview?from=2026-01-01',
    );
  });

  it('restores nested admin sections via the prefix rule', () => {
    for (const path of ['/admin', '/admin/overview', '/admin/kitchen', '/admin/management']) {
      expect(destinationAfterLogin('admin', path)).toBe(path);
    }
  });

  it('falls back to the role home when there is no remembered path', () => {
    expect(destinationAfterLogin('bar', undefined)).toBe(ROLE_DESTINATION.bar);
    expect(destinationAfterLogin('bar', null)).toBe(ROLE_DESTINATION.bar);
    expect(destinationAfterLogin('bar', '')).toBe(ROLE_DESTINATION.bar);
  });

  // The session that expired is not necessarily the session being
  // created. Honouring the path blindly would hand a bar user the
  // kitchen page and ProtectedRoute would immediately bounce them out.
  it('ignores a destination the new role may not visit', () => {
    expect(destinationAfterLogin('bar', '/staff/kitchen')).toBe(ROLE_DESTINATION.bar);
    expect(destinationAfterLogin('kitchen', '/admin')).toBe(ROLE_DESTINATION.kitchen);
    expect(destinationAfterLogin('waiter', '/admin/overview')).toBe(ROLE_DESTINATION.waiter);
  });

  // admin is allowed on every staff dashboard, per App.tsx.
  it('lets an admin return to any staff dashboard', () => {
    for (const path of ['/staff/kitchen', '/staff/bar', '/staff/waiter']) {
      expect(destinationAfterLogin('admin', path)).toBe(path);
    }
  });

  it('never returns to a login page', () => {
    expect(destinationAfterLogin('admin', '/staff/login')).toBe(ROLE_DESTINATION.admin);
    expect(destinationAfterLogin('admin', '/platform-admin/login')).toBe(ROLE_DESTINATION.admin);
  });

  // Not reachable today (the value travels in router state), but the
  // check has to hold if it is ever moved to a query parameter.
  it('rejects anything that is not an in-app path', () => {
    for (const hostile of [
      'https://evil.example/phish',
      '//evil.example',
      'http://evil.example',
      'javascript:alert(1)',
      'staff/kitchen',
    ]) {
      expect(destinationAfterLogin('kitchen', hostile)).toBe(ROLE_DESTINATION.kitchen);
    }
  });

  it('ignores an unknown in-app path rather than guessing', () => {
    expect(destinationAfterLogin('kitchen', '/track/abc')).toBe(ROLE_DESTINATION.kitchen);
  });

  // A prefix match must not let /adminx through as if it were /admin.
  it('does not treat a lookalike prefix as a match', () => {
    expect(destinationAfterLogin('admin', '/adminx')).toBe(ROLE_DESTINATION.admin);
    expect(destinationAfterLogin('admin', '/admin-secret')).toBe(ROLE_DESTINATION.admin);
  });
});

describe('where a platform-admin login lands', () => {
  it('returns to the interrupted platform-admin page', () => {
    expect(platformAdminDestination('/platform-admin')).toBe('/platform-admin');
  });

  it('falls back when there is nothing remembered', () => {
    expect(platformAdminDestination(undefined)).toBe('/platform-admin');
  });

  it('never returns to its own login page', () => {
    expect(platformAdminDestination('/platform-admin/login')).toBe('/platform-admin');
  });

  // A staff path left in state must not be restored into the
  // platform-admin area, where it would simply 404 or bounce.
  it('refuses a path outside the platform-admin area', () => {
    expect(platformAdminDestination('/staff/kitchen')).toBe('/platform-admin');
    expect(platformAdminDestination('https://evil.example')).toBe('/platform-admin');
    expect(platformAdminDestination('/platform-adminx')).toBe('/platform-admin');
  });
});
