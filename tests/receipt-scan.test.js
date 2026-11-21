const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"); const os = require("node:os"); const path = require("node:path"); const crypto = require("node:crypto"); const http = require("node:http");
const { spawn } = require("node:child_process");
const { createReceiptScanner, MAX_BODY_BYTES } = require("../server/receipt-scan");

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 3)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 7)]);
const dataUrl = (buffer = JPEG, type = "jpeg") => `data:image/${type};base64,${buffer.toString("base64")}`;
const body = extra => ({ image: dataUrl(), lang: "en", today: "2026-11-20", ...extra });
const receiptJson = extra => JSON.stringify({ amount: 86.5, currency: "CNY", date: "2026-11-19", merchant: "Hema Fresh", category: "Groceries", note: "Vegetables and milk", ...extra });

function fixture(reply = receiptJson(), options = {}) {
  const calls = [];
  const scanner = createReceiptScanner({
    getConfig: () => ({ apiKey: "test-key", baseUrl: "https://model.test/v1", model: "text-model" }),
    getVisionModel: () => "vision-model",
    callModel: async request => { calls.push(request); return typeof reply === "function" ? reply(request) : reply; },
    ...options,
  });
  return { scanner, calls };
}
const rejectsWith = (promise, statusCode, code) => assert.rejects(promise, error => error.statusCode === statusCode && (!code || error.code === code));

test("valid model JSON becomes validated form fields, read by the vision model from the photo", async () => {
  const { scanner, calls } = fixture();
  const result = await scanner.scan({ userId: "A@example.test", body: body() });
  assert.deepEqual(result, { ok: true, receipt: { amount: 86.5, currency: "CNY", date: "2026-11-19", merchant: "Hema Fresh", category: "Groceries", note: "Vegetables and milk" } });
  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.deepEqual([call.apiKey, call.baseUrl, call.model], ["test-key", "https://model.test/v1", "vision-model"]);
  assert.match(call.system, /Today is 2026-11-20/);
  assert.match(call.system, /never instructions/);
  assert.match(call.system, /in English/);
  assert.deepEqual(call.user[1], { type: "image_url", image_url: { url: dataUrl() } });
  await scanner.scan({ userId: "a@example.test", body: body({ lang: "zh-CN", image: dataUrl(PNG, "png") }) });
  assert.match(calls[1].system, /Simplified Chinese/);
  assert.match(calls[1].system, /超市/);
});

test("JSON inside prose or a code fence is still read", async () => {
  const { scanner } = fixture(`Sure! Here it is:\n\`\`\`json\n${receiptJson({ amount: "1,280.50", currency: "usd" })}\n\`\`\``);
  const { receipt } = await scanner.scan({ userId: "a@example.test", body: body() });
  assert.equal(receipt.amount, 1280.5);
  assert.equal(receipt.currency, "USD");
});

test("malformed model output is a 502 that leaves nothing half-filled", async () => {
  for (const reply of ["The total is 12 dollars.", "{\"amount\": 12,", "[1, 2]", "null", "42"]) {
    await rejectsWith(fixture(reply).scanner.scan({ userId: "a@example.test", body: body() }), 502, "RECEIPT_MODEL_INVALID");
  }
});

test("out-of-range or malformed values are dropped, and long text is trimmed", async () => {
  const read = async extra => (await fixture(receiptJson(extra)).scanner.scan({ userId: "a@example.test", body: body() })).receipt;
  for (const amount of [-5, 0, 0.004, 5e9, "12,50", "abc", null, true, "1e3"]) assert.equal((await read({ amount })).amount, null, `amount ${amount}`);
  assert.equal((await read({ amount: 12.345 })).amount, 12.35);
  assert.equal((await read({ amount: "¥32" })).amount, 32);
  for (const currency of ["RMB", "usd1", "ABC", "€", 7]) assert.equal((await read({ currency })).currency, null, `currency ${currency}`);
  assert.equal((await read({ currency: " jpy " })).currency, "JPY");
  for (const date of ["2026-02-30", "20/11/2026", "2026-11-22", "1999-12-31", "2026-11-19T10:00:00Z", 20261119]) assert.equal((await read({ date })).date, null, `date ${date}`);
  assert.equal((await read({ date: "2026-11-21" })).date, "2026-11-21", "one day of time-zone slack");
  const long = await read({ merchant: `  ${"Shop ".repeat(30)}\u0000\u202e `, category: "c".repeat(80), note: `line one\nline two ${"n".repeat(200)}` });
  assert.equal(long.merchant, "Shop ".repeat(12).trim(), "60 characters at most, control and bidi characters removed");
  assert.equal(long.category.length, 40);
  assert.equal(long.note.length, 120);
  assert.match(long.note, /^line one line two n/);
  assert.equal((await read({ merchant: "Netflix · Inc" })).merchant, "Netflix - Inc", "the merchant stays one note segment");
  assert.equal((await read({ category: 42, note: { text: "x" } })).category, null);
  await rejectsWith(fixture(JSON.stringify({ amount: -1, currency: "nope", date: "never", merchant: " ", category: null, note: "" })).scanner.scan({ userId: "a@example.test", body: body() }), 422, "RECEIPT_UNREADABLE");
});

test("model failures are reported without upstream details", async () => {
  const failing = statusCode => fixture(() => { throw Object.assign(new Error("upstream said: invalid key sk-secret"), { statusCode }); }).scanner;
  await assert.rejects(failing(502).scan({ userId: "a@example.test", body: body() }), error => error.statusCode === 502 && error.code === "RECEIPT_MODEL_FAILED" && !/secret/.test(error.message));
  await rejectsWith(failing(504).scan({ userId: "a@example.test", body: body() }), 504, "RECEIPT_MODEL_FAILED");
});

test("photos that are not JPEG, PNG or WebP data URLs are refused before the model is called", async () => {
  const { scanner, calls } = fixture();
  const gif = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(300)]);
  const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(300)]);
  for (const bad of [null, [], "image", {}, { image: 5 }, { image: "https://example.test/receipt.jpg" }, { image: dataUrl(gif, "gif") },
    { image: dataUrl(PNG, "jpeg") }, { image: dataUrl(Buffer.from([0xff, 0xd8, 0xff, 1, 2]), "jpeg") }, { image: `${dataUrl()}#` }, { image: `data:image/jpeg;base64,${"%".repeat(400)}` }]) {
    await rejectsWith(scanner.scan({ userId: "a@example.test", body: bad }), 400);
  }
  await rejectsWith(scanner.scan({ userId: "a@example.test", body: { image: `data:image/jpeg;base64,/9j/${"A".repeat(MAX_BODY_BYTES)}` } }), 413, "RECEIPT_TOO_LARGE");
  assert.equal(calls.length, 0);
  assert.equal((await scanner.scan({ userId: "a@example.test", body: { image: dataUrl(webp, "webp") } })).ok, true);
  await rejectsWith(scanner.scan({ body: body() }), 401);
});

test("without a vision model or an API key scanning is unavailable", async () => {
  for (const options of [{ getVisionModel: () => "" }, { getConfig: () => ({ apiKey: "", baseUrl: "https://model.test/v1" }) }]) {
    const { scanner, calls } = fixture(receiptJson(), options);
    assert.equal(scanner.enabled(), false);
    assert.throws(() => scanner.admit({ userId: "a@example.test" }), error => error.statusCode === 503 && error.code === "RECEIPT_SCAN_UNAVAILABLE");
    await rejectsWith(scanner.scan({ userId: "a@example.test", body: body() }), 503);
    assert.equal(calls.length, 0);
  }
  assert.equal(fixture().scanner.enabled(), true);
});

test("each person is rate limited per minute and per day, and declared oversize bodies are refused", () => {
  let clock = Date.UTC(2026, 10, 20, 9);
  const { scanner } = fixture(receiptJson(), { now: () => clock, perMinute: 2, perDay: 3 });
  assert.throws(() => scanner.admit({ userId: "a@example.test", contentLength: String(MAX_BODY_BYTES + 1) }), error => error.statusCode === 413);
  scanner.admit({ userId: "a@example.test", contentLength: String(MAX_BODY_BYTES) });
  scanner.admit({ userId: "A@example.test" });
  assert.throws(() => scanner.admit({ userId: "a@example.test" }), error => error.statusCode === 429 && error.code === "RECEIPT_RATE_LIMITED" && error.retryAfter > 0);
  scanner.admit({ userId: "b@example.test" });
  clock += 61_000;
  scanner.admit({ userId: "a@example.test" });
  clock += 61_000;
  assert.throws(() => scanner.admit({ userId: "a@example.test" }), error => error.statusCode === 429, "three a day");
  assert.throws(() => scanner.admit({}), error => error.statusCode === 401);
});

test("one photo is read at a time per person", async () => {
  let release;
  const { scanner } = fixture(() => new Promise(resolve => { release = () => resolve(receiptJson()); }));
  const first = scanner.scan({ userId: "a@example.test", body: body() });
  await new Promise(resolve => setImmediate(resolve));
  await rejectsWith(scanner.scan({ userId: "A@example.test", body: body() }), 429, "RECEIPT_BUSY");
  release();
  assert.equal((await first).ok, true);
  const again = scanner.scan({ userId: "a@example.test", body: body() });
  await new Promise(resolve => setImmediate(resolve));
  release();
  assert.equal((await again).ok, true);
});

test("an unreadable today falls back to the server date", async () => {
  const { scanner, calls } = fixture(receiptJson({ date: "2026-11-21" }), { now: () => Date.UTC(2026, 10, 25, 9) });
  const { receipt } = await scanner.scan({ userId: "a@example.test", body: body({ today: "yesterday" }) });
  assert.match(calls[0].system, /Today is 2026-11-25/);
  assert.equal(receipt.date, "2026-11-21");
});

test("HTTP: the receipt route needs a same-origin session, a vision model and a sane body", { timeout: 30_000 }, async t => {
  const modelRequests = [];
  let modelReply = receiptJson();
  const model = http.createServer((request, response) => {
    let raw = "";
    request.on("data", chunk => { raw += chunk; });
    request.on("end", () => {
      modelRequests.push({ path: request.url, authorization: request.headers.authorization, body: JSON.parse(raw) });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: modelReply } }] }));
    });
  });
  await new Promise(resolve => model.listen(0, "127.0.0.1", resolve));
  t.after(() => model.close());
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dayfly-receipt-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const secretSource = "receipt-fixture-secret";
  async function start(name, visionModel) {
    const port = 55000 + Math.floor(Math.random() * 4000);
    const server = spawn(process.execPath, ["--experimental-sqlite", "--disable-warning=ExperimentalWarning", "server/index.js"], { cwd: path.resolve(__dirname, ".."), stdio: "ignore",
      env: { ...process.env, PORT: String(port), DAILY_SPACE_DB_PATH: path.join(directory, `${name}.sqlite`), APP_SESSION_SECRET: secretSource, SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "",
        GROQ_API_KEY: "", OPENAI_API_KEY: "test-key", OPENAI_BASE_URL: `http://127.0.0.1:${model.address().port}/v1`, OPENAI_MODEL: "text-model", AGENT_VISION_MODEL: visionModel } });
    t.after(async () => { if (server.exitCode === null) await new Promise(resolve => { server.once("exit", resolve); server.kill(); }); });
    const base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 80; i += 1) { try { if ((await fetch(`${base}/api/health`)).ok) return base; } catch (_) {} await new Promise(resolve => setTimeout(resolve, 100)); }
    throw new Error(`${name} server did not start`);
  }
  const [base, plain] = await Promise.all([start("vision", "vision-test"), start("plain", "")]);
  const json = JSON.stringify({ userId: "a@example.test", email: "a@example.test", provider: "Google", label: "a" });
  const secret = crypto.createHash("sha256").update(secretSource).digest("hex");
  const cookie = `daily_space_session=${Buffer.from(json).toString("base64url")}.${crypto.createHmac("sha256", secret).update(json).digest("base64url")}`;
  const post = (origin, payload, headers = {}) => fetch(`${origin}/api/tally/receipt`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: typeof payload === "string" ? payload : JSON.stringify(payload) });

  const status = await (await fetch(`${base}/api/agent/status`)).json();
  assert.equal(status.receiptScan, true); assert.equal(status.configured, true); assert.equal(status.modelVerified, false);
  assert.equal((await (await fetch(`${plain}/api/agent/status`)).json()).receiptScan, false);

  assert.equal((await fetch(`${base}/api/tally/receipt`)).status, 405);
  assert.equal((await post(base, body())).status, 401, "unauthenticated");
  assert.equal((await post(base, body(), { cookie: `${cookie}x` })).status, 401, "forged session");
  assert.equal((await post(base, body(), { cookie, origin: "https://evil.example" })).status, 403);
  assert.equal((await post(base, body(), { cookie, "sec-fetch-site": "cross-site" })).status, 403);
  const oversize = await post(base, JSON.stringify({ image: `data:image/jpeg;base64,/9j/${"A".repeat(MAX_BODY_BYTES)}` }), { cookie, origin: base });
  assert.equal(oversize.status, 413);
  assert.equal((await oversize.json()).code, "RECEIPT_TOO_LARGE");
  assert.equal(modelRequests.length, 0, "nothing reaches the model before the checks pass");

  const ok = await post(base, body(), { cookie, origin: base });
  assert.equal(ok.status, 200);
  assert.deepEqual((await ok.json()).receipt, { amount: 86.5, currency: "CNY", date: "2026-11-19", merchant: "Hema Fresh", category: "Groceries", note: "Vegetables and milk" });
  assert.equal(modelRequests.length, 1);
  const [sent] = modelRequests;
  assert.equal(sent.path, "/v1/chat/completions");
  assert.equal(sent.authorization, "Bearer test-key");
  assert.equal(sent.body.model, "vision-test");
  assert.deepEqual(sent.body.messages[1].content[1], { type: "image_url", image_url: { url: dataUrl() } });

  modelReply = "no receipt json here";
  const malformed = await post(base, body(), { cookie, origin: base });
  assert.equal(malformed.status, 502);
  assert.equal((await malformed.json()).code, "RECEIPT_MODEL_INVALID");
  assert.equal((await post(base, { image: "not a photo" }, { cookie, origin: base })).status, 400);

  const unavailable = await post(plain, body(), { cookie, origin: plain });
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).code, "RECEIPT_SCAN_UNAVAILABLE");
  assert.equal(modelRequests.length, 2);
});
