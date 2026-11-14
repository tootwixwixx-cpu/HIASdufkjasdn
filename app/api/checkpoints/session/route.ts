// app/api/checkpoints/session/route.ts
import { NextRequest, NextResponse } from "next/server";
import { publicError } from "@/lib/http-errors";
import { dbService } from "@/lib/store";
import { getClientIp } from "@/lib/ip";
import { antiBypassService, verifySignedToken, type GatewayTokenPayload } from "@/lib/anti-bypass";
import { verifyWorkinkToken } from "@/lib/workink";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const userAgent = req.headers.get("user-agent") || "";
    const body = await req.json();
    const { action } = body;
    const hwid = (body.hwid || body.claim_id || "").trim();

    // 1. IP Ban check
    if (await dbService.isIpBanned(ip)) {
      return NextResponse.json(
        {
          success: false,
          error: "Access Denied: Your IP is locked out from claiming keys due to bypass attempts.",
          locked_out: true,
        },
        { status: 403 }
      );
    }

    // 2. HWID Ban check
    if (hwid && (await dbService.isHwidBanned(hwid))) {
      return NextResponse.json(
        {
          success: false,
          error: "Access Denied: Your device (HWID) is locked out from claiming keys due to bypass attempts.",
          locked_out: true,
        },
        { status: 403 }
      );
    }

    // ACTION: START SESSION
    if (action === "start") {
      const { script_slug, script_id } = body;
      let targetScriptId = script_id || "";

      if (!targetScriptId && script_slug) {
        const script = await dbService.getScriptMetaBySlug(script_slug);
        if (script) targetScriptId = script.id;
      }

      if (!targetScriptId) {
        const allScripts = await dbService.getScriptsLite();
        const active = allScripts.filter((s) => s.is_active !== false);
        const preferred =
          active.find((s) => s.slug === "rivals" || s.slug === "atomware-hub" || s.name.toLowerCase().includes("atom")) ||
          active[active.length - 1] ||
          active[0];
        if (preferred) targetScriptId = preferred.id;
      }

      const checkpoints = await dbService.getCheckpoints(targetScriptId || undefined);

      // If no checkpoints configured, return an internal verification step
      const effectiveCheckpoints =
        checkpoints.length > 0
          ? checkpoints
          : [
              {
                id: "default-verification",
                script_id: "all",
                title: "Security Verification",
                url: "https://discord.gg/NdrTc27GxT",
                duration_seconds: 5,
                order: 1,
                created_at: new Date().toISOString(),
              },
            ];

      // Resume the visitor's existing checkpoint session (e.g. coming back from a Work.ink task or
      // reloading). Previously every page load minted a new session, so steps finished under the old
      // one no longer counted and the player was told to redo a task they had already completed.
      // Only resumed if it exists, belongs to this same script and is less than 2 hours old.
      let resumeId: string | undefined;
      const resume = typeof body.resume_session_id === "string" ? body.resume_session_id : "";
      if (resume) {
        const info = await dbService.getCheckpointSessionInfo(resume);
        if (
          info &&
          (info.script_id || "") === (targetScriptId || "") &&
          Date.now() - new Date(info.created_at).getTime() < 2 * 3600 * 1000
        ) {
          resumeId = resume;
        }
      }

      const sessionData = antiBypassService.createSession(
        ip,
        userAgent,
        targetScriptId,
        effectiveCheckpoints,
        resumeId
      );

      if (!resumeId) {
        await dbService.recordCheckpoint("started", ip, targetScriptId, {
          sessionId: sessionData.sessionId,
          stepIndex: 0,
          checkpointTitle: effectiveCheckpoints[0]?.title || "Step 1",
        });
      }

      return NextResponse.json({
        success: true,
        ...sessionData,
        resumed: Boolean(resumeId),
        completed_steps: resumeId ? await dbService.getCompletedSteps(resumeId) : [],
      });
    }

    // ACTION: START STEP (Stamps server start clock and generates active step token)
    if (action === "start_step") {
      const { gatewayToken } = body;

      if (!gatewayToken || typeof gatewayToken !== "string") {
        return NextResponse.json(
          { success: false, error: "Missing required gatewayToken parameter." },
          { status: 400 }
        );
      }

      // SECURITY: every step's gateway token is handed to the client up front, so without this a
      // client could start (and, after the dwell time + PoW, verify) ONLY the last step and be
      // issued a claim token, skipping every earlier checkpoint. Enforce order server-side:
      // step N can only be started once step N-1 has been verified for this same session.
      const gw = verifySignedToken<GatewayTokenPayload>(gatewayToken);
      if (gw.valid && gw.payload && gw.payload.step > 0) {
        const prevDone = await dbService.hasCheckpointLog(gw.payload.sid, "step_completed", gw.payload.step - 1);
        if (!prevDone) {
          return NextResponse.json(
            { success: false, error: "Please complete the previous checkpoint step first." },
            { status: 400 }
          );
        }
      }

      const result = antiBypassService.startStep(gatewayToken, ip);

      if (!result.success) {
        return NextResponse.json(
          { success: false, error: result.error || "Failed to start checkpoint step." },
          { status: 400 }
        );
      }

      return NextResponse.json(result);
    }

    // ACTION: VERIFY STEP (Enforces temporal dwell time and Proof-of-Work)
    if (action === "verify_step") {
      const { activeStepToken, stepToken, powSolution, powNonce, stepIndex, script_id } = body;
      const targetToken = activeStepToken || stepToken;

      if (!targetToken || typeof targetToken !== "string") {
        return NextResponse.json(
          { success: false, error: "Missing active step authorization token." },
          { status: 400 }
        );
      }

      const result = antiBypassService.verifyStep(
        targetToken,
        ip,
        String(powSolution || ""),
        powNonce
      );

      if (!result.success) {
        // Record bypass attempt if intentional bypass or tampering detected
        let lockoutInfo = { lockedOut: false, attemptCount: 0 };
        if (result.bypassDetected) {
          lockoutInfo = await dbService.recordBypassAttempt(
            ip,
            hwid || null,
            script_id || null,
            result.error || "Task dwell time or PoW challenge anomaly",
            typeof stepIndex === "number" ? stepIndex : undefined
          );
        }

        if (lockoutInfo.lockedOut) {
          return NextResponse.json(
            {
              success: false,
              bypassDetected: true,
              locked_out: true,
              attemptCount: lockoutInfo.attemptCount,
              error:
                "Access Denied: You have been permanently locked out (3/3 bypass attempts). Your IP and HWID are blocked.",
            },
            { status: 403 }
          );
        }

        const warningMsg =
          lockoutInfo.attemptCount > 0
            ? `${result.error || "Verification failed."} (Warning: Attempt ${lockoutInfo.attemptCount}/3 â€” 3 attempts results in permanent lockout)`
            : result.error || "Verification failed.";

        return NextResponse.json(
          {
            success: false,
            error: warningMsg,
            bypassDetected: result.bypassDetected,
            remainingSeconds: result.remainingSeconds,
            attemptCount: lockoutInfo.attemptCount,
          },
          { status: result.bypassDetected ? 403 : 400 }
        );
      }

      // Record step progress or completion
      if (result.success) {
        // Record against the server-signed session id / step index (not client-supplied values) so
        // the ordering check in start_step can rely on it.
        const stepMeta = { stepIndex: result.step, sessionId: result.sid };
        if (result.allCompleted) {
          await dbService.recordCheckpoint("completed", ip, script_id || undefined, stepMeta);
        } else {
          await dbService.recordCheckpoint("step_completed", ip, script_id || undefined, stepMeta);
        }
      }

      return NextResponse.json({
        ...result,
      });
    }

    // ACTION: VERIFY WORKINK TOKEN (Strict API validation with ?deleteToken=1)
    if (action === "verify_workink") {
      const { token, sessionId, stepIndex, script_id } = body;

      if (!token || typeof token !== "string") {
        return NextResponse.json(
          { success: false, error: "Missing required Work.ink completion token." },
          { status: 400 }
        );
      }

      // SECURITY: stepIndex / totalSteps / script_id used to be trusted verbatim from the client,
      // so one valid Work.ink token plus `totalSteps: 1` produced a claim token and skipped every
      // other checkpoint. Derive the real totals server-side, require a real checkpoint session,
      // and require earlier steps to be completed first.
      if (!sessionId || typeof sessionId !== "string" || !(await dbService.hasCheckpointLog(sessionId, "started"))) {
        return NextResponse.json(
          { success: false, error: "Checkpoint session not found. Please reload the claim page and start again." },
          { status: 400 }
        );
      }
      let resolvedScriptId: string = typeof script_id === "string" ? script_id : "";
      if (resolvedScriptId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(resolvedScriptId)) {
        const sc = await dbService.getScriptMetaBySlug(resolvedScriptId);
        resolvedScriptId = sc ? sc.id : "";
      }
      const configuredSteps = await dbService.getCheckpoints(resolvedScriptId || undefined);
      const serverTotal = Math.max(1, configuredSteps.length);
      // The server decides which step this token completes: the first step of this session that
      // isn't done yet. (The page's own step counter could drift after a reload, which used to make
      // the server credit the wrong step and ask the player to redo a task they'd finished.)
      const done = await dbService.getCompletedSteps(sessionId);
      let requestedStep = 0;
      while (done.includes(requestedStep)) requestedStep++;
      void stepIndex; // client hint no longer trusted
      if (requestedStep >= serverTotal) {
        return NextResponse.json(
          { success: false, error: "All checkpoint steps are already completed. Use the claim button to get your key." },
          { status: 400 }
        );
      }
      const stepCp = configuredSteps[requestedStep];
      const stepIsWorkink = Boolean(
        stepCp && (Number(stepCp.duration_seconds) === 0 || stepCp.url?.includes("work.ink") || stepCp.url?.includes("workink.net"))
      );
      if (!stepIsWorkink) {
        return NextResponse.json(
          { success: false, error: `Step ${requestedStep + 1} is a timed checkpoint. Please complete it on this page first.` },
          { status: 400 }
        );
      }

      // Verify token with Work.ink API (burns single-use token on Work.ink server)
      const workinkResult = await verifyWorkinkToken(token, ip);
      if (!workinkResult.valid) {
        return NextResponse.json(
          {
            success: false,
            error: workinkResult.error || "Work.ink tasks have not been completed yet. Please finish the tasks to proceed.",
          },
          { status: 400 }
        );
      }

      const currentStep = requestedStep;
      const total = serverTotal;

      const result = antiBypassService.completeWorkinkStep(
        sessionId,
        currentStep,
        total,
        resolvedScriptId || "all",
        ip
      );

      if (result.allCompleted) {
        await dbService.recordCheckpoint("completed", ip, resolvedScriptId || undefined, {
          stepIndex: currentStep,
          checkpointTitle: "Work.ink Task Completed",
          sessionId,
        });
      } else {
        await dbService.recordCheckpoint("step_completed", ip, resolvedScriptId || undefined, {
          stepIndex: currentStep,
          checkpointTitle: "Work.ink Step Completed",
          sessionId,
        });
      }

      return NextResponse.json({
        ...result,
        stepIndex: currentStep, // the step the server credited, so the page marks the right one
        completed_steps: [...done, currentStep],
        message: "Work.ink task verified successfully!",
      });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (err: unknown) {
    const errorMsg = publicError(err, "Error handling checkpoint session");
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}
