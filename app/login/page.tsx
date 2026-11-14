// app/login/page.tsx
"use client";

import React, { useState } from "react";
import { AlertCircle } from "lucide-react";
import Link from "next/link";
import { Alert, Button, Card, Field, Input, Logo } from "@/components/ui";
import { cn, focusRing } from "@/lib/utils";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [needsTotp, setNeedsTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, totp: totp || undefined }),
      });

      const data = await res.json();
      if (data.totp_required) setNeedsTotp(true);
      if (!res.ok) {
        // First response when 2FA is on: just reveal the code field, don't show it as an error.
        if (data.totp_required && !totp) return;
        throw new Error(data.error || "Invalid username or password");
      }

      window.location.href = data.redirect || "/dashboard/scripts";
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Authentication failed";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col justify-between bg-canvas text-fg">
      <header className="flex h-14 items-center justify-between border-b border-line px-4 sm:px-6">
        <Link href="/" className={cn("rounded-md", focusRing)} aria-label="AtomProtect home">
          <Logo size="md" />
        </Link>
        <Link
          href="/"
          className={cn("rounded-sm text-body-sm text-fg-muted transition-colors hover:text-fg", focusRing)}
        >
          Return to site
        </Link>
      </header>

      <main className="flex flex-1 items-center justify-center bg-grid-matrix p-4">
        <Card className="w-full max-w-sm p-6 shadow-popover">
          <div className="mb-6">
            <h1 className="text-heading font-semibold text-fg">Staff console</h1>
            <p className="mt-1 text-body-sm text-fg-muted">Sign in with your admin credentials.</p>
          </div>

          {error && (
            <Alert tone="danger" icon={<AlertCircle />} className="mb-4">
              {error}
            </Alert>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="Username" htmlFor="login-username">
              <Input
                id="login-username"
                size="lg"
                type="text"
                required
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Admin username"
              />
            </Field>

            <Field label="Password" htmlFor="login-password">
              <Input
                id="login-password"
                size="lg"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
              />
            </Field>

            {needsTotp && (
              <Field label="Authentication code" htmlFor="login-totp">
                <Input
                  id="login-totp"
                  size="lg"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  required
                  autoFocus
                  autoComplete="one-time-code"
                  value={totp}
                  onChange={(e) => setTotp(e.target.value.replace(/\D/g, ""))}
                  placeholder="6-digit code"
                />
              </Field>
            )}

            <Button type="submit" variant="primary" size="lg" loading={submitting} className="mt-2 w-full">
              Sign in
            </Button>
          </form>
        </Card>
      </main>

      <footer className="border-t border-line py-4 text-center text-caption text-fg-subtle">
        Restricted console. IP logging and intrusion detection active.
      </footer>
    </div>
  );
}
