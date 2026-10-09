import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

// Primary env home is the repo-root `.env` (see `.env.example`).
dotenv.config();

// Fallback env home is `backend/.env` (see `backend/.env.example`).
// Keys placed there (e.g. PRIMEHIRE_ACCESS_KEY) are honored when the
// root `.env` does not define them, so moving the PrimeHire secret into
// the backend env file keeps the `/api/backend/*` proxy working.
// Root `.env` values always take precedence; nothing here overrides them.
const BACKEND_ENV_KEYS = [
  "BACKEND_URL",
  "PRIMEHIRE_ACCESS_KEY",
  "PRIMEHIRE_SECRET_KEY",
  "PROXY_ORIGIN",
] as const;

// Resolve `backend/.env` relative to this file first (CWD-independent),
// then relative to the process working directory. Records which file
// actually supplied the credentials for /api/health diagnostics.
let primehireEnvSource: "root .env" | "backend/.env" | "missing" =
  (process.env.PRIMEHIRE_ACCESS_KEY || "").trim() &&
  (process.env.PRIMEHIRE_SECRET_KEY || "").trim()
    ? "root .env"
    : "missing";

try {
  const serverDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(serverDir, "backend", ".env"),
    path.join(process.cwd(), "backend", ".env"),
  ];
  for (const backendEnvPath of candidates) {
    if (primehireEnvSource !== "missing") break;
    if (!fs.existsSync(backendEnvPath)) continue;
    const parsed = dotenv.parse(fs.readFileSync(backendEnvPath, "utf8"));
    for (const key of BACKEND_ENV_KEYS) {
      if (!process.env[key] && parsed[key]) {
        process.env[key] = parsed[key];
      }
    }
    if (
      (process.env.PRIMEHIRE_ACCESS_KEY || "").trim() &&
      (process.env.PRIMEHIRE_SECRET_KEY || "").trim()
    ) {
      primehireEnvSource = "backend/.env";
    }
  }
} catch {
  // A malformed backend/.env must never prevent the server from booting;
  // missing credentials are reported per-request as CONFIGURATION_ERROR.
}

function primehireConfigured(): boolean {
  return primehireEnvSource !== "missing";
}

// Startup validation (presence only — values are never logged).
{
  if (primehireConfigured()) {
    console.log(
      `[Config] PrimeHire credentials: configured via ${primehireEnvSource} (held server-side only, never logged).`
    );
  } else {
    console.warn(
      "[Config] PrimeHire credentials: MISSING — /api/backend/* will return " +
        "CONFIGURATION_ERROR until PRIMEHIRE_ACCESS_KEY / PRIMEHIRE_SECRET_KEY " +
        "are set in .env (or backend/.env) and the server is restarted."
    );
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Body parsing middleware
  app.use(express.json());

  // API routes
  app.get("/api/health", (req, res) => {
    // Presence-only diagnostics: never includes key material.
    res.json({
      status: "ok",
      primehire: { configured: primehireConfigured(), source: primehireEnvSource },
    });
  });

  // In-memory rate limiting and allowlist rules
  const PROXY_ROUTE_ALLOWLIST = [
    { method: 'POST', pattern: /^\/assessment\/?$/ },
    { method: 'GET', pattern: /^\/assessment\/[a-zA-Z0-9_\-]+\/?$/ },
    { method: 'POST', pattern: /^\/interview\/?$/ },
    { method: 'PUT', pattern: /^\/interview\/[a-zA-Z0-9_\-]+\/reschedule\/?$/ },
    { method: 'GET', pattern: /^\/interview\/[a-zA-Z0-9_\-]+\/status\/?$/ },
    { method: 'GET', pattern: /^\/interview\/[a-zA-Z0-9_\-]+\/report\/?$/ },
    { method: 'GET', pattern: /^\/response\/report-not-generated\/?$/ },
    { method: 'PUT', pattern: /^\/candidate\/[a-zA-Z0-9_\-]+\/password\/?$/ },
  ];

  function isProxyRouteAllowed(method: string, path: string): boolean {
    const normPath = path.startsWith('/') ? path : `/${path}`;
    return PROXY_ROUTE_ALLOWLIST.some(
      r => r.method === method.toUpperCase() && r.pattern.test(normPath)
    );
  }

  // Proxy to ZeptoMail
  app.post("/api/send-email", async (req, res) => {
    const { toEmail, toName, subject, htmlBody } = req.body;
    
    const apiKey = process.env.ZEPTOMAIL_API_KEY;
    if (!apiKey) {
      console.error("[Email Proxy Error] ZeptoMail API key is missing in environment variables.");
      return res.status(500).json({ error: "ZeptoMail API key is missing on the server." });
    }

    if (!toEmail || !subject || !htmlBody) {
      return res.status(400).json({ error: "Missing required fields: toEmail, subject, htmlBody" });
    }

    // Anti-open-relay protections
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(toEmail)) {
      return res.status(400).json({ error: "Invalid recipient email address format" });
    }

    const allowedSubjectPattern = /primehire|assessment|interview|invitation|reminder|evaluation|credentials/i;
    if (!allowedSubjectPattern.test(subject)) {
      return res.status(403).json({ error: "Subject does not match permitted recruiting communications template" });
    }

    try {
      console.log(`[Email Proxy] Dispatching email to ${toEmail} (${toName})...`);
      
      const payload = {
        from: { address: "noreply@nxtagent.ai", name: "PrimeHire Careers" },
        to: [{ email_address: { address: toEmail, name: toName || "" } }],
        subject,
        htmlbody: htmlBody
      };

      const response = await fetch("https://api.zeptomail.in/v1.1/email", {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json",
          "Authorization": apiKey
        },
        body: JSON.stringify(payload)
      });

      console.log(`[Email Proxy Response] Status: ${response.status} ${response.statusText}`);
      const bodyText = await response.text();
      console.log(`[Email Proxy Response Body]`, bodyText);

      if (response.ok) {
        res.json({ success: true, details: bodyText });
      } else {
        res.status(response.status).json({ success: false, error: bodyText });
      }
    } catch (error: any) {
      console.error("[Email Proxy Error] Failed to transmit email:", error.message);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Proxy to PrimeHire (local-dev mirror of the Cloudflare Pages Function
  // at functions/api/backend/[[path]].ts). Serves both the current
  // "/api/backend/*" namespace and the legacy "/api/primehire/*" namespace.
  app.all(["/api/primehire/*", "/api/backend/*"], async (req, res) => {
    const startTime = Date.now();

    // Extract the relative subpath (e.g. "/assessment" from "/api/backend/assessment")
    const prefix = req.path.startsWith("/api/backend") ? "/api/backend" : "/api/primehire";
    const subpath = req.path.substring(prefix.length);
    const queryString = req.url.includes("?") ? req.url.substring(req.url.indexOf("?")) : "";

    // Route & method allowlist guard
    if (!isProxyRouteAllowed(req.method, subpath)) {
      console.warn(`[Proxy Guard] Blocked unauthorized route/method: ${req.method} ${subpath}`);
      return res.status(403).json({
        error: "Forbidden: Endpoint or HTTP method not permitted on PrimeHire proxy allowlist",
        path: subpath,
        method: req.method,
      });
    }

    const backendBase = (process.env.BACKEND_URL || "https://api.placement.vils.ai/primehire/api/v1").replace(/\/+$/, "");
    const targetUrl = `${backendBase}${subpath}${queryString}`;

    // Validate credentials BEFORE proxying so a missing .env produces an
    // actionable error instead of a cryptic upstream "401: Invalid Credentials".
    const accessKey = (process.env.PRIMEHIRE_ACCESS_KEY || "").trim();
    const secretKey = (process.env.PRIMEHIRE_SECRET_KEY || "").trim();
    const hasCredentials = !!accessKey && !!secretKey;
    console.log(`\n${'='.repeat(70)}`);
    console.log(`[Proxy] ${req.method} ${req.url} -> ${targetUrl}`);
    console.log(`[Auth] Credentials: ${hasCredentials ? '✓ PRESENT' : '✗ MISSING'}`);

    if (!hasCredentials) {
      console.error(
        `[Auth Error] PRIMEHIRE_ACCESS_KEY / PRIMEHIRE_SECRET_KEY are missing or empty. ` +
        `Create a .env file (see .env.example) and restart the server.`
      );
      console.log(`${'='.repeat(70)}\n`);
      return res.status(500).json({
        status: "ERROR",
        type: "CONFIGURATION_ERROR",
        message:
          "PrimeHire credentials are not configured on the server (missing PRIMEHIRE_ACCESS_KEY / PRIMEHIRE_SECRET_KEY in .env or backend/.env). Add them and restart the server, then retry. Check GET /api/health for which env file supplied the credentials.",
      });
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-access-key": accessKey,
      "x-secret-key": secretKey,
    };

    // Forward the caller's Authorization when present (Bearer flows), mirroring
    // the Cloudflare Pages Function. The Origin override below mirrors
    // PROXY_ORIGIN for backends that expect a specific origin.
    if (req.headers.authorization) {
      headers["Authorization"] = req.headers.authorization as string;
    }
    if (process.env.PROXY_ORIGIN) {
      headers["Origin"] = process.env.PROXY_ORIGIN;
    }

    // Detailed logging for request body
    if (["POST", "PUT", "PATCH"].includes(req.method) && req.body && Object.keys(req.body).length > 0) {
      console.log(`[Request Payload] ↓↓↓`);
      console.log(JSON.stringify(req.body, null, 2));
      console.log(`[Request Payload] ↑↑↑`);
    }

    // ── Interview time validation (Requirement 9) ──────────────────────
    // Reject past-start or invalid-window requests BEFORE they reach PrimeHire
    // so the operator gets a clear, actionable error.
    const isInterviewCreate = req.method === 'POST' && /^\/interview\/?$/.test(subpath);
    const isInterviewReschedule = req.method === 'PUT' && /^\/interview\/[^/]+\/reschedule\/?$/.test(subpath);

    if ((isInterviewCreate || isInterviewReschedule) && req.body) {
      const nowUtc = new Date();

      if (isInterviewCreate && Array.isArray(req.body.candidates)) {
        for (const cand of req.body.candidates) {
          const start = cand.start_time ? new Date(cand.start_time) : null;
          const end = cand.end_time ? new Date(cand.end_time) : null;

          if (start && !isNaN(start.getTime()) && start.getTime() <= nowUtc.getTime()) {
            console.warn(`[Proxy Validation] Blocked: start_time in the past for candidate ${cand.candidate_id}`);
            return res.status(422).json({
              code: "INTERVIEW_START_IN_PAST",
              message: `Interview start time must be in the future (start_time: ${cand.start_time}, server now: ${nowUtc.toISOString()})`,
            });
          }
          if (start && end && !isNaN(start.getTime()) && !isNaN(end.getTime()) && end.getTime() <= start.getTime()) {
            console.warn(`[Proxy Validation] Blocked: end_time <= start_time for candidate ${cand.candidate_id}`);
            return res.status(422).json({
              code: "INTERVIEW_END_BEFORE_START",
              message: "Interview end time must be after start time",
            });
          }
        }
      }

      if (isInterviewReschedule) {
        const start = req.body.start_time ? new Date(req.body.start_time) : null;
        const end = req.body.end_time ? new Date(req.body.end_time) : null;

        if (start && !isNaN(start.getTime()) && start.getTime() <= nowUtc.getTime()) {
          console.warn(`[Proxy Validation] Blocked: rescheduled start_time in the past`);
          return res.status(422).json({
            code: "INTERVIEW_START_IN_PAST",
            message: `Interview start time must be in the future (start_time: ${req.body.start_time}, server now: ${nowUtc.toISOString()})`,
          });
        }
        if (start && end && !isNaN(start.getTime()) && !isNaN(end.getTime()) && end.getTime() <= start.getTime()) {
          console.warn(`[Proxy Validation] Blocked: rescheduled end_time <= start_time`);
          return res.status(422).json({
            code: "INTERVIEW_END_BEFORE_START",
            message: "Interview end time must be after start time",
          });
        }
      }
    }

    // ── Assessment question duration validation (Bug #7) ───────────────
    const isAssessmentWrite = (req.method === 'POST' || req.method === 'PUT') && /^\/assessment\/?$/.test(subpath);
    if (isAssessmentWrite && req.body && Array.isArray(req.body.questions)) {
      for (let i = 0; i < req.body.questions.length; i++) {
        const q = req.body.questions[i];
        const dur = Number(q.max_duration ?? q.maxDuration);
        if (!Number.isFinite(dur) || dur < 1 || dur > 120) {
          console.warn(`[Proxy Validation] Blocked: question #${i + 1} max_duration out of range (${dur})`);
          return res.status(422).json({
            code: "INVALID_MAX_DURATION",
            message: `Question #${i + 1} max_duration must be between 1 and 120 seconds`,
          });
        }
      }
    }

    try {
      const options: RequestInit = {
        method: req.method,
        headers,
      };

      if (["POST", "PUT", "PATCH"].includes(req.method) && req.body && Object.keys(req.body).length > 0) {
        options.body = JSON.stringify(req.body);
      }

      const response = await fetch(targetUrl, options);
      const elapsed = Date.now() - startTime;
      
      // Log response status code
      const statusIcon = response.ok ? '✓' : '✗';
      console.log(`[Response] ${statusIcon} ${response.status} ${response.statusText} (${elapsed}ms)`);
      
      // Attempt to read the response body as JSON
      const contentType = response.headers.get("content-type") || "";
      let responseBody: any;
      
      if (contentType.includes("application/json")) {
        responseBody = await response.json();
      } else {
        const text = await response.text();
        try {
          responseBody = JSON.parse(text);
        } catch {
          responseBody = { text };
        }
      }

      // Detailed response logging
      console.log(`[Response Body] ↓↓↓`);
      console.log(JSON.stringify(responseBody, null, 2));
      console.log(`[Response Body] ↑↑↑`);

      if (response.status === 401) {
        console.error(
          `[Auth Hint] Upstream PrimeHire API returned 401 Invalid Credentials. ` +
          `Verify PRIMEHIRE_ACCESS_KEY / PRIMEHIRE_SECRET_KEY values in .env are correct ` +
          `and restart the server. Request: ${req.method} ${subpath}`
        );
      }

      console.log(`${'='.repeat(70)}\n`);

      res.status(response.status).json(responseBody);
    } catch (error: any) {
      const elapsed = Date.now() - startTime;
      console.error(`[Proxy Error] (${elapsed}ms) Failed to forward request to PrimeHire API:`, error.message);
      console.log(`${'='.repeat(70)}\n`);
      res.status(500).json({
        success: false,
        error: "Failed to proxy request to PrimeHire API",
        details: error.message,
      });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
