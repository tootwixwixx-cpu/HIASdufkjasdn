// components/LogoutButton.tsx
"use client";

import React from "react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui";

export default function LogoutButton() {
  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      window.location.href = "/login";
    } catch {
      window.location.href = "/login";
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleLogout}
      className="w-full justify-start hover:bg-danger/10 hover:text-danger-text"
      title="Sign out of admin session"
    >
      <LogOut />
      <span>Sign out</span>
    </Button>
  );
}
