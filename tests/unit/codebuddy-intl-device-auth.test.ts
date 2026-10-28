// Phase E — CodeBuddy International device login, refresh and dated lockout.
//
// Captured login: `POST /v2/plugin/auth/state?platform=CLI` with a literal `{}`
// body, and a polling loop that answers code 11217 ("login ing...") until the
// user authorizes. 11217 must surface as PENDING, not as a failure.
import test from "node:test";
import assert from "node:assert/strict";

import {
  CODEBUDDY_LOGIN_PENDING_CODE,
  normalizeCodeBuddyPollResponse,
  buildCodeBuddyStateRequestBody,
  requestDeviceCode,
  pollToken,
  type CodeBuddyDeviceCodeConfig,
  type CodeBuddyPollResult,
} from "../../src/lib/oauth/providers/codebuddyDeviceAuth.ts";
import { CODEBUDDY_CN_CONFIG, CODEBUDDY_INTL_CONFIG } from "../../src/lib/oauth/constants/oauth.ts";

test("the login state request body is the literal empty object", () => {
  const body = buildCodeBuddyStateRequestBody();
  assert.equal(body, "{}");
  assert.equal(new TextEncoder().encode(body).byteLength, 2);
});

test("code 11217 is a pending login, never an error", () => {
  const result = normalizeCodeBuddyPollResponse({
    code: CODEBUDDY_LOGIN_PENDING_CODE,
    msg: "login ing...",
  });

  assert.equal(result.ok, false);
  assert.equal(result.data.error, "authorization_pending");
  assert.equal(result.data.pending, true);
});

test("an authorized response yields the captured token payload", () => {
  const result = normalizeCodeBuddyPollResponse({
    code: 0,
    data: { accessToken: "at", refreshToken: "rt", tokenType: "Bearer", expiresIn: 86400 },
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.access_token, "at");
  assert.equal(result.data.refresh_token, "rt");
});

test("a genuine failure stays a failure", () => {
  const result = normalizeCodeBuddyPollResponse({ code: 40001, msg: "denied" });
  assert.equal(result.ok, false);
  assert.equal(result.data.pending, undefined);
  assert.equal(result.data.error, 40001);
});

test("a pending response with no message still maps to pending", () => {
  const result = normalizeCodeBuddyPollResponse({ code: CODEBUDDY_LOGIN_PENDING_CODE });
  assert.equal(result.data.pending, true);
});

// The device-auth module is shared with codebuddy-cn (copilot.tencent.com),
// whose login was never captured with the `{}` body. The empty state body is
// therefore an intl-only opt-in; CN keeps sending `{"platform": ...}`.
type FetchCall = { url: string; init?: RequestInit };

async function captureStateRequest(config: CodeBuddyDeviceCodeConfig): Promise<FetchCall> {
  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ code: 0, data: { state: "s-1", authUrl: "https://x" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  try {
    await requestDeviceCode(config);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(calls.length, 1);
  return calls[0];
}

async function capturePoll(
  config: CodeBuddyDeviceCodeConfig,
  envelope: Record<string, unknown>
): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(envelope), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
  try {
    const result: CodeBuddyPollResult = await pollToken(config, "s-1");
    return { ok: result.ok, data: result.data as Record<string, unknown> };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("intl sends the captured literal {} state body", async () => {
  const call = await captureStateRequest(CODEBUDDY_INTL_CONFIG);
  assert.equal(call.init?.body, "{}");
});

test("codebuddy-cn keeps its platform state body (the {} capture is intl-only)", async () => {
  const call = await captureStateRequest(CODEBUDDY_CN_CONFIG);
  assert.match(
    call.url,
    /^https:\/\/copilot\.tencent\.com\/v2\/plugin\/auth\/state\?platform=CLI$/
  );
  assert.equal(call.init?.body, JSON.stringify({ platform: CODEBUDDY_CN_CONFIG.platform }));
});

test("codebuddy-cn poll: 11217 is pending and a failure carries an error code", async () => {
  // Shared normalization is safe for CN: before it, a CN 11217 envelope came back
  // without `error`, so pollForToken() aborted the login as "no_access_token".
  const pending = await capturePoll(CODEBUDDY_CN_CONFIG, {
    code: CODEBUDDY_LOGIN_PENDING_CODE,
    msg: "login ing...",
  });
  assert.equal(pending.ok, false);
  assert.equal(pending.data.error, "authorization_pending");

  const denied = await capturePoll(CODEBUDDY_CN_CONFIG, { code: 40001, msg: "denied" });
  assert.equal(denied.ok, false);
  assert.equal(denied.data.error, 40001);
  assert.equal(denied.data.pending, undefined);

  const ok = await capturePoll(CODEBUDDY_CN_CONFIG, {
    code: 0,
    data: { accessToken: "at", refreshToken: "rt" },
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.data.access_token, "at");
});
