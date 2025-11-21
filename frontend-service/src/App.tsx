import { Routes, Route, Navigate } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { DashboardLayout } from './layouts/DashboardLayout';
import { useAuth } from './contexts/AuthContext.tsx'; // <-- Import the hook
import { RepositoriesPage } from './pages/RepositoriesPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { ReviewDetialsPage } from './pages/ReviewDetailsPage.tsx';
import { ReviewsPage } from './pages/ReviewsPage.tsx';

const ProtectedLayout = () => {
  const { user, isLoading } = useAuth(); // <-- Use the real auth state

  if (isLoading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        Loading...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

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
        <Route path="/reviews" element={<ReviewsPage />} />
      </Route>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export default App;
