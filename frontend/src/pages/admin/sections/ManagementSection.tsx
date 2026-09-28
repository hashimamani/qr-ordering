import { useState } from 'react';
import { AdminMenuTab } from '../AdminMenuTab';
import { AdminTablesTab } from '../AdminTablesTab';
import { AdminStaffTab } from '../AdminStaffTab';
import { ActivityTab } from './ActivityTab';
import { BrandingTab } from './BrandingTab';

type ManagementTab = 'menu' | 'tables' | 'staff' | 'branding' | 'activity';

const TABS: { key: ManagementTab; label: string }[] = [
  { key: 'menu', label: 'Menu' },
  { key: 'tables', label: 'Tables & QR codes' },
  { key: 'staff', label: 'Staff' },
  { key: 'branding', label: 'Branding' },
  { key: 'activity', label: 'Activity log' },
];

/**
 * The configuration surface. The first three panels are the original
 * admin tabs, reused unchanged -- this section is a new home for them,
 * not a rewrite.
 */
export function ManagementSection() {
  const [tab, setTab] = useState<ManagementTab>('menu');

  return (
    <>
      <div className="admin-section-header">
        <div>
          <h2>Management</h2>
          <p className="sub">Menu, tables, staff accounts, branding and the status-change audit trail.</p>
        </div>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'menu' && <AdminMenuTab />}
      {tab === 'tables' && <AdminTablesTab />}
      {tab === 'staff' && <AdminStaffTab />}
      {tab === 'branding' && <BrandingTab />}
      {tab === 'activity' && <ActivityTab />}
    </>
  );
}
