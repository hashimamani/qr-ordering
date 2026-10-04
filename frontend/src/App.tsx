import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { PlatformAdminAuthProvider } from './auth/PlatformAdminAuthContext';
import { PlatformAdminProtectedRoute } from './auth/PlatformAdminProtectedRoute';
import { ToastProvider } from './components/ToastProvider';
import { OrderPage } from './pages/customer/OrderPage';
import { TrackPage } from './pages/customer/TrackPage';
import { ReceiptPage } from './pages/customer/ReceiptPage';
import { LoginPage } from './pages/staff/LoginPage';
import { KitchenPage } from './pages/staff/KitchenPage';
import { BarPage } from './pages/staff/BarPage';
import { WaiterPage } from './pages/staff/WaiterPage';
import { AdminLayout } from './pages/admin/AdminLayout';
import { OverviewSection } from './pages/admin/sections/OverviewSection';
import { StationBoardSection } from './pages/admin/sections/StationBoardSection';
import { FloorSection } from './pages/admin/sections/FloorSection';
import { ManagementSection } from './pages/admin/sections/ManagementSection';
import { PrivacyPage } from './pages/PrivacyPage';
import { PlatformAdminLoginPage } from './pages/platform-admin/PlatformAdminLoginPage';
import { PlatformAdminDashboardPage } from './pages/platform-admin/PlatformAdminDashboardPage';

export function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <PlatformAdminAuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Navigate to="/staff/login" replace />} />
              <Route path="/order" element={<OrderPage />} />
              {/* Public and unauthenticated by necessity: Meta requires a
                  reachable privacy policy URL before the app can go Live. */}
              <Route path="/privacy" element={<PrivacyPage />} />
              <Route path="/track/:token" element={<TrackPage />} />
              {/* Public like the tracking page -- gated by the link plus a
                  challenge, not by a staff session. */}
              <Route path="/receipt/:token" element={<ReceiptPage />} />
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
              {/* Nested rather than tab state so each admin section is
                  deep-linkable and survives a refresh. */}
              <Route
                path="/admin"
                element={
                  <ProtectedRoute allowedRoles={['admin']}>
                    <AdminLayout />
                  </ProtectedRoute>
                }
              >
                <Route index element={<Navigate to="/admin/overview" replace />} />
                <Route path="overview" element={<OverviewSection />} />
                <Route
                  path="kitchen"
                  element={<StationBoardSection destination="kitchen" title="Kitchen" />}
                />
                <Route path="bar" element={<StationBoardSection destination="bar" title="Bar" />} />
                <Route path="floor" element={<FloorSection />} />
                <Route path="management" element={<ManagementSection />} />
              </Route>
              <Route path="/platform-admin/login" element={<PlatformAdminLoginPage />} />
              <Route
                path="/platform-admin"
                element={
                  <PlatformAdminProtectedRoute>
                    <PlatformAdminDashboardPage />
                  </PlatformAdminProtectedRoute>
                }
              />
            </Routes>
          </BrowserRouter>
        </PlatformAdminAuthProvider>
      </AuthProvider>
    </ToastProvider>
  );
}
