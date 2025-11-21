import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";

export function SettingsPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="w-full">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Settings</h1>
      </div>

      <div className="space-y-8">
        <div className="p-6 border rounded-lg">
          <h2 className="text-lg font-semibold mb-4">Account Information</h2>
          {user ? (
            <div className="flex items-center space-x-4">
              <div>
                <p className="text-sm font-medium">{user.username}</p>
                <p className="text-xs text-muted-foreground">{user.userId}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Not logged in.</p>
          )}
          <div className="mt-6">
            <Button onClick={handleLogout} variant="destructive">
              Sign Out
            </Button>
          </div>
        </div>

        <div className="p-6 border rounded-lg">
          <h2 className="text-lg font-semibold mb-4">Theme</h2>
          <p className="text-sm text-muted-foreground">
            Choose your preferred theme for the application.
          </p>
        </div>
      </div>
    </div>
  )
}
