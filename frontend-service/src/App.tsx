// src/App.tsx
import { Routes, Route, Navigate } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { DashboardLayout } from './layouts/DashboardLayout';

function App() {
  // For this test, let's assume we are always logged in
  const isAuthenticated = true;

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      {/* This is the change. We are separating the routes.
        If we are logged in, show the dashboard.
        If not, send to login.
      */}
      {isAuthenticated ? (
        <Route element={<DashboardLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          {/* Add other dashboard routes here */}
        </Route>
      ) : (
        <Route path="*" element={<Navigate to="/login" replace />} />
      )}

      {/* Default redirect. If we land at "/", 
        go to "/dashboard" (which will be caught by the logic above)
      */}
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export default App;
