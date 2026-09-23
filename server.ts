import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Body parsing middleware
  app.use(express.json());

  // API routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Proxy to ZeptoMail
  app.post("/api/send-email", async (req, res) => {
    const { toEmail, toName, subject, htmlBody } = req.body;
    
    const apiKey = process.env.ZEPTOMAIL_API_KEY;
    if (!apiKey) {
      console.error("[Email Proxy Error] ZeptoMail API key is missing in environment variables.");
      return res.status(500).json({ error: "ZeptoMail API key is missing on the server." });
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
    if (process.env.PROXY_ORIGIN) {
      headers["Origin"] = process.env.PROXY_ORIGIN;
    }

    // Detailed logging for request body
    if (["POST", "PUT", "PATCH"].includes(req.method) && req.body && Object.keys(req.body).length > 0) {
      console.log(`[Request Payload] ↓↓↓`);
      console.log(JSON.stringify(req.body, null, 2));
      console.log(`[Request Payload] ↑↑↑`);
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
