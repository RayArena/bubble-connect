"use client";

import ProfilePage from "@/screens/ProfilePage";
import { ProtectedRoute } from "@/components/auth/RouteGuards";

export default function ProfileRoutePage() {
  return (
    <ProtectedRoute>
      <ProfilePage />
    </ProtectedRoute>
  );
}
