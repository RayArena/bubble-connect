"use client";

import AuthVerifyPage from "@/screens/AuthVerifyPage";
import { PublicOnlyRoute } from "@/components/auth/RouteGuards";

export default function AuthVerifyRoutePage() {
  return (
    <PublicOnlyRoute>
      <AuthVerifyPage />
    </PublicOnlyRoute>
  );
}
