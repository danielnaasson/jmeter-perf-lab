// QA Lab API: a tiny shop API used as the system under test for JMeter.
// No dependencies, Node 18+. Start with: node api/server.js
//
// It degrades on purpose under load, so performance tests have something to find:
// every request above CAPACITY concurrent requests adds PENALTY_MS of latency,
// and above HARD_LIMIT concurrent requests the API answers 503.

const http = require('node:http');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const LATENCY_MS = Number(process.env.LATENCY_MS || 20);   // base latency of every request
const CAPACITY = Number(process.env.CAPACITY || 10);       // concurrent requests handled at full speed
const PENALTY_MS = Number(process.env.PENALTY_MS || 15);   // extra latency per request above capacity
const HARD_LIMIT = Number(process.env.HARD_LIMIT || 60);   // above this, answer 503

const users = {
  alice: 'alice123',
  bob: 'bob123',
  carol: 'carol123',
  dave: 'dave123',
  erin: 'erin123',
};

const products = [
  { id: 1, name: 'Mechanical keyboard', price: 89.9, stock: 120 },
  { id: 2, name: 'Wireless mouse', price: 29.5, stock: 300 },
  { id: 3, name: '27" monitor', price: 249.0, stock: 40 },
  { id: 4, name: 'USB-C hub', price: 39.9, stock: 200 },
  { id: 5, name: 'Noise cancelling headset', price: 129.0, stock: 75 },
];

const sessions = new Map(); // token -> username
const orders = [];
let inFlight = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}

function readJson(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(null); // invalid JSON
      }
    });
  });
}

function authUser(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  return sessions.get(token) || null;
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname;

  if (req.method === 'GET' && path === '/health') {
    return send(res, 200, { status: 'ok', inFlight });
  }

  if (req.method === 'POST' && path === '/login') {
    const body = await readJson(req);
    if (!body) return send(res, 400, { error: 'invalid JSON' });
    const { username, password } = body;
    if (!username || users[username] !== password) {
      return send(res, 401, { error: 'invalid credentials' });
    }
    const token = crypto.randomBytes(16).toString('hex');
    sessions.set(token, username);
    return send(res, 200, { token, username });
  }

  if (req.method === 'GET' && path === '/products') {
    return send(res, 200, { total: products.length, items: products });
  }

  const productMatch = path.match(/^\/products\/(\d+)$/);
  if (req.method === 'GET' && productMatch) {
    const product = products.find((p) => p.id === Number(productMatch[1]));
    if (!product) return send(res, 404, { error: 'product not found' });
    return send(res, 200, product);
  }

  if (req.method === 'POST' && path === '/orders') {
    const username = authUser(req);
    if (!username) return send(res, 401, { error: 'missing or invalid token' });
    const body = await readJson(req);
    if (!body) return send(res, 400, { error: 'invalid JSON' });
    const product = products.find((p) => p.id === Number(body.productId));
    const quantity = Number(body.quantity);
    if (!product) return send(res, 400, { error: 'unknown productId' });
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
      return send(res, 400, { error: 'quantity must be an integer from 1 to 10' });
    }
    const order = {
      id: orders.length + 1,
      username,
      productId: product.id,
      quantity,
      total: Number((product.price * quantity).toFixed(2)),
      createdAt: new Date().toISOString(),
    };
    orders.push(order);
    return send(res, 201, order);
  }

  return send(res, 404, { error: 'route not found' });
}

const server = http.createServer(async (req, res) => {
  inFlight++;
  try {
    if (inFlight > HARD_LIMIT && req.url !== '/health') {
      return send(res, 503, { error: 'server overloaded', inFlight });
    }
    const overload = Math.max(0, inFlight - CAPACITY);
    const jitter = Math.random() * LATENCY_MS * 0.3;
    await sleep(LATENCY_MS + jitter + overload * PENALTY_MS);
    await route(req, res);
  } catch (err) {
    send(res, 500, { error: 'internal error', detail: String(err) });
  } finally {
    inFlight--;
  }
});

server.listen(PORT, () => {
  console.log(`QA Lab API on http://localhost:${PORT}`);
  console.log(`latency=${LATENCY_MS}ms capacity=${CAPACITY} penalty=${PENALTY_MS}ms hardLimit=${HARD_LIMIT}`);
});
