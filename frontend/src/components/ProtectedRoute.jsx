import { Navigate, useLocation } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { useAuthStore } from "../stores/authStore.js";

export default function ProtectedRoute({ children, roles }) {
  const { user, accessToken } = useAuthStore();
  const location = useLocation();

  if (!accessToken || !user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  if (roles && !roles.includes(user.role)) {
    return (
      <div className="flex h-full items-center justify-center bg-background p-8 text-center">
        <div className="max-w-sm animate-fade-in">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <h2 className="mt-3 text-sm font-semibold">Access denied</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Your role ({user.role}) doesn't have permission to view this page.
          </p>
        </div>
      </div>
    );
  }
  return children;
}
