"use client";

import ChatPage from "@/screens/ChatPage";
import { ProtectedRoute } from "@/components/auth/RouteGuards";

export default function ChatRoutePage() {
  return (
    <ProtectedRoute>
      <ChatPage />
    </ProtectedRoute>
  );
}
