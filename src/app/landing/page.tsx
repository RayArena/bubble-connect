"use client";

import LandingPage from "@/screens/LandingPage";
import { PublicOnlyRoute } from "@/components/auth/RouteGuards";

export default function LandingRoutePage() {
  return (
    <PublicOnlyRoute>
      <LandingPage />
    </PublicOnlyRoute>
  );
}
