// Minimal MQTT 3.1.1 CONNECT over WebSocket against public brokers: measures CONNACK time.
const brokers = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081/mqtt', 'wss://public.mqtthq.com:8084/mqtt'];
const enc = (s) => { const b = new TextEncoder().encode(s); return [b.length >> 8, b.length & 255, ...b]; };
function connectPkt(id) {
  const vh = [...enc('MQTT'), 4, 0x02, 0, 30];
  const pl = enc(id);
  const rest = [...vh, ...pl];
  return new Uint8Array([0x10, rest.length, ...rest]);
}
for (const url of brokers) {
  const t0 = Date.now();
  const r = await new Promise((res) => {
    let done = false;
    const fin = (x) => { if (!done) { done = true; res(x); try { ws.close(); } catch {} } };
    const ws = new WebSocket(url, ['mqtt']);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => ws.send(connectPkt('probe' + Math.random().toString(16).slice(2, 10)));
    ws.onmessage = (e) => { const b = new Uint8Array(e.data); fin(b[0] === 0x20 ? `CONNACK rc=${b[3]}` : 'unexpected ' + b[0]); };
    ws.onerror = () => fin('error');
    setTimeout(() => fin('timeout'), 8000);
  });
  console.log(url.padEnd(40), r, Date.now() - t0 + 'ms');
}
