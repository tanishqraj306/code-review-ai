import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { useTheme } from "../components/ThemeProvider";
import { Sun, Moon, Laptop } from "lucide-react";

export function SettingsPage() {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate("/login");
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
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                {user.username.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-medium">{user.username}</p>
                <p className="text-xs text-muted-foreground">
                  Github ID: {user.userId}
                </p>
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
          <div>
            <h2 className="text-lg font-semibold mb-4">Theme</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Choose your preferred theme for the application.
            </p>
          </div>
          <div className="flex flex-wrap gap-4">
            <Button
              variant={theme === "light" ? "default" : "outline"}
              onClick={() => setTheme("light")}
              className="w-32"
            >
              <Sun className="mr-2 h-4 w-4" />
              Light
            </Button>
            <Button
              variant={theme === "dark" ? "default" : "outline"}
              onClick={() => setTheme("dark")}
              className="w-32"
            >
              <Moon className="mr-2 h-4 w-4" />
              Dark
            </Button>
            <Button
              variant={theme === "system" ? "default" : "outline"}
              onClick={() => setTheme("system")}
              className="w-32"
            >
              <Laptop className="mr-2 h-4 w-4" />
              System
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
