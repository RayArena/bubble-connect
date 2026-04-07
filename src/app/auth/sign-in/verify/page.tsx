"use client";

import AuthSignInVerifyPage from "@/screens/AuthSignInVerifyPage";
import { PublicOnlyRoute } from "@/components/auth/RouteGuards";

export default function AuthSignInVerifyRoutePage() {
  return (
    <PublicOnlyRoute>
      <AuthSignInVerifyPage />
    </PublicOnlyRoute>
  );
}
