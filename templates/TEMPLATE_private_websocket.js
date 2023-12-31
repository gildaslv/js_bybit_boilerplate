const WebSocket = require("ws");
const util = require("util");
const dotenv = require("dotenv");
const crypto = require("crypto")
const promisify = util.promisify;
const PING_INTERVAL = 20*1000;
const HEARTBEAT_INTERVAL = 25*1000
let pingTrigger;
let heartbeatTrigger;
let subs = [];

const delay = promisify(setTimeout);
let ws;

// MAIN FUNCTIONS
function restart() {
  if (ws) ws.terminate();

  ws = new WebSocket("wss://stream-testnet.bybit.com/v5/private");
  ws.on("open", onOpen);
  ws.on("message", onMessage);
  ws.on("error", onError);
  ws.on("pong", onPong);

  clearInterval(pingTrigger);
  pingTrigger = setInterval(() => {
    if (!(ws.readyState === WebSocket.OPEN)) return;
    ws.ping()
  }, PING_INTERVAL );
}

function subscribe(topics) {
  // topics = []
  subs = topics;
  if (!(ws.readyState === WebSocket.OPEN)) return;
  ws.send(JSON.stringify({ op: "subscribe", args: topics}));
}

function unsubscribe(topics) {
  // topics = []
  subs = subs.filter(d => !topics.include(d));
  if (!(ws.readyState === WebSocket.OPEN)) return;
  ws.send(JSON.stringify({ op: "unsubscribe", args: topics}));
}

function generateAuthToken({ API, SEC }) {
  const expires = new Date().getTime() + 10000;
  const signature = crypto
    .createHmac("sha256", SEC)
    .update("GET/realtime" + expires)
    .digest("hex");
  const payload = { op: "auth", args: [API, expires.toFixed(), signature] };
  return JSON.stringify(payload);
}

// CONTROL FRAMES
const onOpen = () => {
  console.log("WS OPEN");

  // authentication
  const {API, SEC} = process.env;
  const authToken = generateAuthToken({ API, SEC });
  ws.send(authToken);

  if (!(ws.readyState === WebSocket.OPEN) || !subs.length) return;
  ws.send(JSON.stringify({ op: "subscribe", args: subs}));
};

const onPong = () => {
  console.log("WS PONG RECEIVED");
  clearTimeout(heartbeatTrigger);

  heartbeatTrigger = setTimeout(() => {
    console.log('HEARTBEAT TRIGGERED');
    restart();
  }, HEARTBEAT_INTERVAL);
};

const onMessage = (pl) => {
  console.log(pl.toString());
};

const onError = async (err) => {
  console.log(err);
  await delay(5000);
  restart()
};

// CORE LOGIC
(async () => {
  dotenv.config();
  restart();
  subscribe(["order"]);
})();