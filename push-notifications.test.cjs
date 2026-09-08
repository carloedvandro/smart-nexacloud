const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");

function load(relativePath, mocks, globals = {}) {
  const source = readFileSync(path.join(__dirname, relativePath), "utf8").replaceAll(
    "import.meta.env",
    "testEnv",
  );
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(output, {
    exports,
    require(name) {
      assert.ok(name in mocks, `Unexpected import: ${name}`);
      return mocks[name];
    },
    console: { warn() {}, error() {} },
    ...globals,
  });
  return exports;
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function browser() {
  let cleanup;
  let tick;
  let nextId = 0;
  const requests = [];
  const document = new EventTarget();
  document.visibilityState = "visible";
  document.hasFocus = () => true;
  const window = new EventTarget();
  window.setInterval = (callback) => {
    tick = callback;
    return 1;
  };
  window.clearInterval = () => {
    tick = undefined;
  };
  const api = load(
    "src/hooks/use-push-notifications.tsx",
    {
      react: {
        useEffect: (callback) => {
          cleanup = callback();
        },
      },
      "@tanstack/react-start": {},
      "@/hooks/use-auth": { useAuth: () => ({ session: { access_token: "test-session" } }) },
      "@/lib/push/push.functions": {},
    },
    {
      document,
      window,
      navigator: {
        serviceWorker: {
          getRegistration: async () => ({
            pushManager: {
              getSubscription: async () => ({ endpoint: "https://push.example/device" }),
            },
          }),
        },
      },
      crypto: { randomUUID: () => `view-${++nextId}` },
      testEnv: {
        VITE_SUPABASE_URL: "https://db.example",
        VITE_SUPABASE_PUBLISHABLE_KEY: "public-test",
      },
      fetch: async (url, options) => {
        requests.push({ url, ...options, body: JSON.parse(options.body) });
        return { ok: true };
      },
    },
  );
  return { api, requests, document, window, stop: () => cleanup?.(), heartbeat: () => tick?.() };
}

test("publishes only a visible thread, clears on background/blur and resumes on focus", async () => {
  const b = browser();
  b.api.useConversationPushPresence("conversation-a");
  await flush();
  assert.equal(b.requests.at(-1).body._conversation_id, "conversation-a");
  assert.equal(b.requests.at(-1).keepalive, true);
  b.document.visibilityState = "hidden";
  b.document.dispatchEvent(new Event("visibilitychange"));
  assert.equal(b.requests.at(-1).body._conversation_id, null);
  const count = b.requests.length;
  b.heartbeat();
  assert.equal(b.requests.length, count);
  b.document.visibilityState = "visible";
  b.window.dispatchEvent(new Event("focus"));
  assert.equal(b.requests.at(-1).body._conversation_id, "conversation-a");
  b.window.dispatchEvent(new Event("blur"));
  assert.equal(b.requests.at(-1).body._conversation_id, null);
  b.stop();
});

test("navigation cleanup cannot overwrite newer presence and pagehide clears it", async () => {
  const b = browser();
  b.api.useConversationPushPresence("conversation-a");
  await flush();
  b.stop();
  const clear = b.requests.at(-1).body;
  b.api.useConversationPushPresence("conversation-b");
  await flush();
  const open = b.requests.at(-1).body;
  assert.equal(open._view_id, clear._view_id);
  assert.ok(open._sequence > clear._sequence);
  assert.equal(open._conversation_id, "conversation-b");
  b.window.dispatchEvent(new Event("pagehide"));
  assert.equal(b.requests.at(-1).body._conversation_id, null);
  const count = b.requests.length;
  b.heartbeat();
  assert.equal(b.requests.length, count);
  b.window.dispatchEvent(new Event("pageshow"));
  assert.equal(b.requests.at(-1).body._conversation_id, "conversation-b");
  b.stop();
});

test("no presence for an unloaded thread or a thread unmounted during subscription lookup", async () => {
  const b = browser();
  b.api.useConversationPushPresence(null);
  await flush();
  assert.equal(b.requests.length, 0);
  b.api.useConversationPushPresence("conversation-a");
  b.stop();
  await flush();
  assert.equal(b.requests.length, 0);
});

function server({ visible = [], presenceError = null } = {}) {
  const delivered = [];
  const lookups = [];
  const rows = ["phone", "desktop"].map((id) => ({
    id,
    endpoint: `https://push.example/${id}`,
    auth: "test",
    p256dh: "test",
  }));
  const supabaseAdmin = {
    from(table) {
      return {
        select() {
          return this;
        },
        update() {
          return this;
        },
        eq() {
          return this;
        },
        in() {
          return Promise.resolve({ data: rows });
        },
        maybeSingle() {
          return Promise.resolve({
            data: {
              id: "conversation-a",
              assigned_user_id: "owner",
              status: "HUMAN_ACTIVE",
              lead: { name: "Test" },
            },
          });
        },
      };
    },
    async rpc(name, args) {
      assert.equal(name, "active_push_conversation_subscriptions");
      lookups.push(args);
      return {
        data: visible.map((subscription_id) => ({ subscription_id })),
        error: presenceError,
      };
    },
  };
  const api = load(
    "src/lib/push/push.server.ts",
    {
      "@block65/webcrypto-web-push": { buildPushPayload: async () => ({ method: "POST" }) },
      "@/integrations/supabase/client.server": { supabaseAdmin },
    },
    {
      process: {
        env: {
          VAPID_SUBJECT: "mailto:test@example.com",
          VAPID_PUBLIC_KEY: "test",
          VAPID_PRIVATE_KEY: "test",
        },
      },
      fetch: async (endpoint) => {
        delivered.push(endpoint);
        return { ok: true };
      },
    },
  );
  return { api, delivered, lookups };
}

test("incoming message skips the viewing device but still notifies the other device", async () => {
  const s = server({ visible: ["phone"] });
  await s.api.notifyInboundMessage({
    companyId: "company-a",
    conversationId: "conversation-a",
    content: "Hello",
  });
  assert.deepEqual(s.delivered, ["https://push.example/desktop"]);
  assert.equal(s.lookups[0]._conversation_id, "conversation-a");
});

test("expired/background/other-conversation presence does not filter any device", async () => {
  const s = server();
  assert.equal(
    await s.api.sendPushToUsers(["owner"], { title: "Test", body: "Hello" }, "conversation-b"),
    2,
  );
  assert.equal(s.delivered.length, 2);
});

test("presence lookup failure keeps notifications enabled", async () => {
  const s = server({ visible: ["phone"], presenceError: { message: "Migration missing" } });
  assert.equal(
    await s.api.sendPushToUsers(["owner"], { title: "Test", body: "Hello" }, "conversation-a"),
    2,
  );
});

test("queue offers and test notifications never use the message visibility filter", async () => {
  const s = server({ visible: ["phone", "desktop"] });
  await s.api.notifyLeadAssigned({
    userId: "owner",
    leadName: "Test",
    conversationId: "conversation-a",
    offer: true,
  });
  assert.equal(s.delivered.length, 2);
  assert.equal(s.lookups.length, 0);
  assert.equal(await s.api.sendPushToUsers(["owner"], { title: "Test", body: "Test" }), 2);
  assert.equal(s.lookups.length, 0);
});
