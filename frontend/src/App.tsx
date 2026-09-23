import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { OrderPage } from './pages/customer/OrderPage';
import { TrackPage } from './pages/customer/TrackPage';
import { LoginPage } from './pages/staff/LoginPage';
import { KitchenPage } from './pages/staff/KitchenPage';
import { BarPage } from './pages/staff/BarPage';
import { WaiterPage } from './pages/staff/WaiterPage';
import { AdminPage } from './pages/admin/AdminPage';

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/staff/login" replace />} />
          <Route path="/order" element={<OrderPage />} />
          <Route path="/track/:token" element={<TrackPage />} />
          <Route path="/staff/login" element={<LoginPage />} />
          <Route
            path="/staff/kitchen"
            element={
              <ProtectedRoute allowedRoles={['admin', 'kitchen']}>
                <KitchenPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/staff/bar"
            element={
              <ProtectedRoute allowedRoles={['admin', 'bar']}>
                <BarPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/staff/waiter"
            element={
              <ProtectedRoute allowedRoles={['admin', 'waiter']}>
                <WaiterPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedRoute allowedRoles={['admin']}>
                <AdminPage />
              </ProtectedRoute>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
