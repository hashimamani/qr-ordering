import { useState } from 'react';
import { StaffLayout } from '../../components/StaffLayout';
import { AdminMenuTab } from './AdminMenuTab';
import { AdminTablesTab } from './AdminTablesTab';
import { AdminStaffTab } from './AdminStaffTab';

type Tab = 'menu' | 'tables' | 'staff';

export function AdminPage() {
  const [tab, setTab] = useState<Tab>('menu');

  return (
    <StaffLayout title="Admin">
      <div className="tabs">
        <button className={tab === 'menu' ? 'active' : ''} onClick={() => setTab('menu')}>
          Menu
        </button>
        <button className={tab === 'tables' ? 'active' : ''} onClick={() => setTab('tables')}>
          Tables &amp; QR codes
        </button>
        <button className={tab === 'staff' ? 'active' : ''} onClick={() => setTab('staff')}>
          Staff
        </button>
      </div>
      {tab === 'menu' && <AdminMenuTab />}
      {tab === 'tables' && <AdminTablesTab />}
      {tab === 'staff' && <AdminStaffTab />}
    </StaffLayout>
  );
}
