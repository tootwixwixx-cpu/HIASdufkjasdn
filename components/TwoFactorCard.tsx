// components/TwoFactorCard.tsx — enrol / disable admin 2FA (Authy or any authenticator app)
"use client";

import React, { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, ShieldCheck } from "lucide-react";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Field, Input } from "@/components/ui";

type State = { enabled: boolean; source: "env" | "db" | null; pending: boolean };

export default function TwoFactorCard() {
  const [state, setState] = useState<State | null>(null);
  const [setup, setSetup] = useState<{ secret: string; qr_svg: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const load = async () => {
    try {
      const res = await fetch("/api/auth/2fa");
      if (res.ok) setState(await res.json());
    } catch {
      /* ignore */
    }
  };
  useEffect(() => {
    load();
  }, []);

  const call = async (action: "begin" | "confirm" | "disable") => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/auth/2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong");
      if (action === "begin") {
        setSetup({ secret: data.secret, qr_svg: data.qr_svg });
      } else {
        setSetup(null);
        setCode("");
        setMsg({
          tone: "success",
          text: action === "confirm" ? "2FA is on. You'll be asked for a code at every web sign-in." : "2FA is off.",
        });
        await load();
      }
    } catch (err) {
      setMsg({ tone: "danger", text: err instanceof Error ? err.message : "Something went wrong" });
    } finally {
      setBusy(false);
    }
  };

  const codeInput = (
    <Field label="6-digit code from Authy" htmlFor="totp-code">
      <Input
        id="totp-code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        placeholder="123456"
      />
    </Field>
  );

  return (
    <Card>
      <CardHeader
        divided
        title={
          <span className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> Two-factor authentication
            {state?.enabled ? <Badge tone="success" dot>On</Badge> : <Badge tone="neutral">Off</Badge>}
          </span>
        }
        description="Require a code from Authy (or any authenticator app) when signing in to the web dashboard. The mobile app is not affected; every mobile sign-in sends you a Discord alert instead."
      />
      <CardBody className="space-y-3">
        {msg && (
          <Alert tone={msg.tone} icon={msg.tone === "success" ? <CheckCircle2 /> : <AlertCircle />}>
            {msg.text}
          </Alert>
        )}

        {!state ? (
          <p className="text-body-sm text-fg-muted">Loading…</p>
        ) : state.source === "env" ? (
          <p className="text-body-sm text-fg-muted">
            2FA is managed by the <code>ADMIN_TOTP_SECRET</code> environment variable. Remove it there to manage 2FA from here.
          </p>
        ) : state.enabled ? (
          <div className="space-y-3">
            <p className="text-body-sm text-fg-muted">To turn 2FA off, enter a current code.</p>
            {codeInput}
            <Button variant="danger" onClick={() => call("disable")} loading={busy} disabled={code.length !== 6}>
              Turn off 2FA
            </Button>
          </div>
        ) : setup ? (
          <div className="space-y-3">
            <ol className="list-decimal space-y-1 pl-5 text-body-sm text-fg-muted">
              <li>Open Authy → <b>Add account</b> → <b>Scan QR code</b>.</li>
              <li>Scan the code below (or choose "enter key manually" and paste the key).</li>
              <li>Type the 6-digit code Authy shows to finish.</li>
            </ol>
            <div className="flex flex-col items-start gap-3 sm:flex-row">
              {/* SVG rendered as an image (no HTML injection) on a white tile so phones can scan it */}
              <img
                src={`data:image/svg+xml;utf8,${encodeURIComponent(setup.qr_svg)}`}
                alt="2FA QR code"
                className="h-44 w-44 rounded-md bg-white p-2"
              />
              <div className="min-w-0 space-y-1">
                <p className="text-caption text-fg-subtle">Manual setup key</p>
                <code className="block break-all rounded bg-canvas px-2 py-1 font-data text-caption text-fg">
                  {setup.secret.replace(/(.{4})/g, "$1 ").trim()}
                </code>
                <p className="text-caption text-fg-subtle">Time-based · 6 digits · 30 seconds</p>
              </div>
            </div>
            {codeInput}
            <div className="flex gap-2">
              <Button variant="primary" onClick={() => call("confirm")} loading={busy} disabled={code.length !== 6}>
                Confirm and turn on
              </Button>
              <Button variant="ghost" onClick={() => setSetup(null)} disabled={busy}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="primary" onClick={() => call("begin")} loading={busy}>
            Set up 2FA with Authy
          </Button>
        )}
      </CardBody>
    </Card>
  );
}
