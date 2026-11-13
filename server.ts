import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Body parsing middleware
  app.use('/api/resume-intake', express.json({limit: '512kb'}));
  app.use(express.json());

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Proxy to the local FastAPI backend (auth + future /api/* routes).
  // Forwards to FASTAPI_URL (default http://127.0.0.1:8000). Cookies are
  // forwarded so the httpOnly refresh-token flow works same-origin.
  app.all("/api/auth/*", async (req, res) => {
    const fastApiBase = (process.env.FASTAPI_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");
    const queryString = req.url.includes("?") ? req.url.substring(req.url.indexOf("?")) : "";
    const targetUrl = `${fastApiBase}${req.path}${queryString}`;
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (req.headers.authorization) headers["Authorization"] = req.headers.authorization as string;
      if (req.headers['idempotency-key']) headers['Idempotency-Key'] = req.headers['idempotency-key'] as string;
      if (req.headers.cookie) headers["Cookie"] = req.headers.cookie as string;
      if (req.headers.origin) headers["Origin"] = req.headers.origin as string;
      const options: RequestInit = { method: req.method, headers };
      if (["POST", "PUT", "PATCH"].includes(req.method) && req.body && Object.keys(req.body).length > 0) {
        options.body = JSON.stringify(req.body);
      }
      const response = await fetch(targetUrl, options);
      const setCookie = response.headers.get("set-cookie");
      if (setCookie) res.setHeader("set-cookie", setCookie);
      const text = await response.text();
      res.status(response.status);
      try {
        res.json(JSON.parse(text));
      } catch {
        res.send(text);
      }
    } catch (error: any) {
      console.error("[Auth Proxy Error] FastAPI unreachable:", error.message);
      res.status(502).json({ detail: "FastAPI backend unreachable. Start it on :8000." });
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
          "PrimeHire credentials are not configured on the server (.env missing PRIMEHIRE_ACCESS_KEY / PRIMEHIRE_SECRET_KEY). Add them and restart the server, then retry.",
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
    if (req.headers['idempotency-key']) headers['Idempotency-Key'] = req.headers['idempotency-key'] as string;
    if (process.env.PROXY_ORIGIN) {
      headers["Origin"] = process.env.PROXY_ORIGIN;
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
      
      // Metadata-only logging (§2.6 of ENGINEERING_STANDARDS)
      const statusIcon = response.ok ? '✓' : '✗';
      console.log(`[Proxy] ${statusIcon} ${req.method} ${subpath} -> ${response.status} (${elapsed}ms)`);
      
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

      if (response.status === 401) {
        console.error(
          `[Auth Hint] Upstream PrimeHire API returned 401 Invalid Credentials. ` +
          `Verify PRIMEHIRE_ACCESS_KEY / PRIMEHIRE_SECRET_KEY values in .env are correct ` +
          `and restart the server. Request: ${req.method} ${subpath}`
        );
      }

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

  // Generic FastAPI passthrough for every other /api/* route
  // (assessments, candidates, users, jobs, resumes, ...). Registered AFTER
  // the specific handlers above so /api/health,
  // /api/auth/* and /api/primehire|backend/* keep their behavior.
  // Forwards auth + cookies (httpOnly refresh flow) and streams raw
  // bodies so multipart resume uploads and file downloads also work.
  app.all("/api/*", async (req, res) => {
    const fastApiBase = (process.env.FASTAPI_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");
    const queryString = req.url.includes("?") ? req.url.substring(req.url.indexOf("?")) : "";
    const targetUrl = `${fastApiBase}${req.path}${queryString}`;
    try {
      const headers: Record<string, string> = {};
      const controller = new AbortController();
      res.on('close', () => { if (!res.writableEnded) controller.abort(); });
      if (req.headers.authorization) headers["Authorization"] = req.headers.authorization as string;
      if (req.headers.cookie) headers["Cookie"] = req.headers.cookie as string;
      const contentType = req.headers["content-type"] as string | undefined;
      if (req.headers['idempotency-key']) headers['Idempotency-Key'] = req.headers['idempotency-key'] as string;
      if (contentType) headers["Content-Type"] = contentType;

      let body: string | undefined;
      let streamBody = false;
      if (!["GET", "HEAD"].includes(req.method)) {
        if (req.body && Object.keys(req.body).length > 0) {
          body = JSON.stringify(req.body);
        } else if (contentType && !contentType.includes("application/json")) {
          // express.json() leaves non-JSON streams (e.g. multipart) unread.
          streamBody = true;
        }
      }
      const options: RequestInit & { duplex?: "half" } = { method: req.method, headers, redirect: 'manual', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(600000)]) };
      if (body !== undefined) {
        options.body = body;
      } else if (streamBody) {
        options.body = req as unknown as BodyInit;
        options.duplex = "half";
      }
      const response = await fetch(targetUrl, options);
      const getSetCookie = (response.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
      const setCookies = typeof getSetCookie === "function" ? getSetCookie.call(response.headers) : [];
      if (setCookies && setCookies.length > 0) {
        res.setHeader("set-cookie", setCookies);
      } else {
        const singleCookie = response.headers.get("set-cookie");
        if (singleCookie) res.setHeader("set-cookie", singleCookie);
      }
      const upstreamType = response.headers.get("content-type");
      res.status(response.status);
      if (upstreamType) res.setHeader("content-type", upstreamType);
      for (const name of ['content-disposition', 'cache-control', 'x-total-count', 'retry-after', 'location', 'referrer-policy']) {
        const value = response.headers.get(name);
        if (value) res.setHeader(name, value);
      }
      if (response.body && !['HEAD'].includes(req.method) && response.status !== 204) {
        await pipeline(Readable.fromWeb(response.body as any), res);
      } else res.end();
    } catch (error: any) {
      console.error("[API Proxy Error] FastAPI unreachable:", error.message);
      if (res.headersSent) res.destroy();
      else res.status(502).json({ detail: "FastAPI backend unreachable. Start it on :8000." });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      configFile: path.join(process.cwd(), 'frontend', 'vite.config.ts'),
      server: { middlewareMode: true, allowedHosts: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "frontend", "dist");
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
