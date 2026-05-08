import crypto from "node:crypto";
import { redisClient } from "./redis_connection.js";

const SESSION_TTL = 7 * 24 * 60 * 60;

const CORTEX_BASE_URL = process.env.CORTEX_BASE_URL;
const CORTEX_CLIENT_ID = process.env.CORTEX_CLIENT_ID;
const CORTEX_CLIENT_SECRET = process.env.CORTEX_CLIENT_SECRET;
const CORTEX_CALLBACK_URL = process.env.CORTEX_CALLBACK_URL;

async function createSession(user) {
  const sessionId = crypto.randomBytes(32).toString("base64url");
  await redisClient.setex(
    `sess:${sessionId}`,
    SESSION_TTL,
    JSON.stringify(user),
  );
  return sessionId;
}

export async function getSession(sessionId) {
  if (!sessionId) return null;
  const raw = await redisClient.get(`sess:${sessionId}`).catch(() => null);
  return raw ? JSON.parse(raw) : null;
}

async function deleteSession(sessionId) {
  if (sessionId) await redisClient.del(`sess:${sessionId}`).catch(() => {});
}

export async function sessionMiddleware(req, _res, next) {
  req.user = await getSession(req.cookies?.checkbox_session).catch(() => null);
  next();
}

export function setupAuthRoutes(app) {
  app.get("/auth/cortex-login", (_req, res) => {
    const state = crypto.randomBytes(16).toString("base64url");

    const params = new URLSearchParams({
      client_id: CORTEX_CLIENT_ID,
      redirect_uri: CORTEX_CALLBACK_URL,
      response_type: "code",
      scope: "openid profile email",
      state,
    });

    res.cookie("oauth_state", state, {
      httpOnly: true,
      maxAge: 10 * 60 * 1000,
      sameSite: "lax",
    });

    res.redirect(`${CORTEX_BASE_URL}/oauth/authorize?${params.toString()}`);
  });

  app.get("/auth/callback", async (req, res) => {
    const { code, state } = req.query;
    const storedState = req.cookies?.oauth_state;

    if (!code || !state || state !== storedState) {
      res.status(400).send("Invalid OAuth state. <a href='/'>Go back</a>");
      return;
    }
    res.clearCookie("oauth_state");

    try {
      const tokenRes = await fetch(`${CORTEX_BASE_URL}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: String(code),
          redirect_uri: CORTEX_CALLBACK_URL,
          client_id: CORTEX_CLIENT_ID,
          client_secret: CORTEX_CLIENT_SECRET,
        }),
      });

      if (!tokenRes.ok) {
        const err = await tokenRes.json().catch(() => ({}));
        console.error("Token exchange failed:", err);
        res.status(500).send("Login failed. <a href='/'>Try again</a>");
        return;
      }

      const tokens = await tokenRes.json();

      const userRes = await fetch(`${CORTEX_BASE_URL}/userinfo`, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });

      if (!userRes.ok) {
        res
          .status(500)
          .send("Failed to get user info. <a href='/'>Try again</a>");
        return;
      }

      const user = await userRes.json();

      const sessionId = await createSession({
        sub: user.sub,
        name: user.name,
        email: user.email,
        picture: user.picture ?? null,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
      });

      res.cookie("checkbox_session", sessionId, {
        httpOnly: true,
        maxAge: SESSION_TTL * 1000,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      });

      res.redirect("/");
    } catch (err) {
      console.error("OAuth callback error:", err);
      res.status(500).send("Login failed. <a href='/'>Try again</a>");
    }
  });

  app.get("/me", (req, res) => {
    if (!req.user) {
      return res.json({ isAuthenticated: false, user: null });
    }
    res.json({
      isAuthenticated: true,
      user: {
        name: req.user.name,
        email: req.user.email,
        picture: req.user.picture ?? null,
      },
    });
  });

  app.get("/auth/logout", async (req, res) => {
    const sessionId = req.cookies?.checkbox_session;
    await deleteSession(sessionId);
    res.clearCookie("checkbox_session");
    res.redirect("/");
  });
}
