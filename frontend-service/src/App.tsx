// src/App.tsx
import { Routes, Route, Navigate } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { DashboardLayout } from './layouts/DashboardLayout';
import { useAuth } from './contexts/AuthContext.tsx'; // <-- Import the hook
import { RepositoriesPage } from './pages/RepositoriesPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { ReviewDetialsPage } from './pages/ReviewDetailsPage.tsx';

const ProtectedLayout = () => {
  const { user, isLoading } = useAuth(); // <-- Use the real auth state

  if (isLoading) {
    // Show a loading spinner or blank page while we check auth
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        Loading...
      </div>
    );
  }

  if (!user) {
    // If not logged in, send them to the login page
    return <Navigate to="/login" replace />;
  }

  // If logged in, render the main DashboardLayout.
  return <DashboardLayout />;
};

function App() {
  const { isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        Loading...
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedLayout />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/repositories" element={<RepositoriesPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/reviews/:id" element={<ReviewDetialsPage />} />
      </Route>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export default App;
