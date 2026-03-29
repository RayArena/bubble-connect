"use client";

import AuthPage from "@/screens/AuthPage";
import { PublicOnlyRoute } from "@/components/auth/RouteGuards";

export default function AuthRoutePage() {
  return (
    <PublicOnlyRoute>
      <AuthPage />
    </PublicOnlyRoute>
  );
}
