// RECIPE: zero-dependency CDP over Node's built-in WebSocket (no npm packages).
// Verified: Node v26.12.0, lightpanda 1.1.0-nightly.11012.
// Usage: lightpanda serve --port 9222 &   then:  node cdp-zero-dep.mjs [url] [port]
const TARGET = process.argv[2] ?? 'https://example.com/';
const PORT = process.argv[3] ?? process.env.LP_PORT ?? '9222';

const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(webSocketDebuggerUrl);
await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = () => no(new Error('connect failed')); });

let seq = 0;
const pending = new Map();
ws.onmessage = ({ data }) => {
  const m = JSON.parse(data);
  const p = m.id && pending.get(m.id);
  if (p) { pending.delete(m.id); m.error ? p.no(new Error(m.error.message)) : p.ok(m.result); }
};
const send = (method, params = {}, sessionId) => new Promise((ok, no) => {
  const id = ++seq;
  pending.set(id, { ok, no });
  ws.send(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }));
});

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);

await send('Page.navigate', { url: TARGET }, sessionId);
for (let i = 0; i < 100; i++) {                       // Page.navigate resolves early: poll readyState
  const { result } = await send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true }, sessionId);
  if (result.value === 'complete') break;
  await new Promise((r) => setTimeout(r, 50));
}
const evaluate = async (expression) => {
  const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
};

console.log('url  :', await evaluate('location.href'));
console.log('title:', await evaluate('document.title'));
console.log('text :', (await evaluate('document.body.innerText')).replace(/\s+/g, ' ').slice(0, 100));
const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
console.log('shot :', Buffer.from(shot.data, 'base64').length, 'bytes (base64 on the wire)');

ws.close();
process.exit(0);   // the native WebSocket keeps the loop alive; exit explicitly
