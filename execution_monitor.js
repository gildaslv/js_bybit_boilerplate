const { parentPort } = require('node:worker_threads');

// WS
const WebSocket = require("ws");
const util = require("util");
const dotenv = require("dotenv");
const crypto = require("crypto")
const promisify = util.promisify;
const PING_INTERVAL = 20*1000;
const HEARTBEAT_INTERVAL = 25*1000;
let pingTrigger;
let heartbeatTrigger;
let subs = [];
const delay = promisify(setTimeout);
let ws;


// LOGGER
const fs = require('fs');
const path = require('path');

const logFilePath = path.join(__dirname, "/logs/session_exec.log");
const logFile = fs.createWriteStream(logFilePath, { flags: 'a' });

const originalConsoleLog = console.log;
console.log = function (...args) {
  const message = args.map(arg => util.format(arg)).join(' ');
  originalConsoleLog.apply(console, args);
  logFile.write(`${message}\n`);
};


// UTILS
const REMINDER_INTERVAL = 10*1000;

let reminderTrigger;
const positionData = [];
const orderData = [];

const updatePositionData = (symbol, data) => {
  positionData[symbol] = data;
};
const updateOrderData = (orderId, data) => {
  orderData[orderId] = data;
};
const removeOrderData = (orderId) => {
  delete orderData[orderId];
};

const statusMap = {"New": 0, "Cancelled": 1, "Filled": 2, "PartiallyFilled": 3, "PartiallyFilledCanceled": 4};

const getDate = () => {
  const now = new Date();
  return now.toISOString().replace('T', ' ').substr(0, 23);
}
const getTimestamp = () => {
  return Date.now()
}

const orderMsg = [
  (data) => {
    // Case New
    orderData.hasOwnProperty(data["orderId"]) ? console.log(`[${getDate()}][EXEC MONITOR]🔂 [id:${ data["orderId"] }] UPDATED ${ data["side"].toUpperCase() } ${ data["symbol"] }  ORDER ${ data["qty"] } @ ${ data["price"] } server feedback latency: ${ getTimestamp() - data["updatedTime"] }ms`) : updateOrderData(data["orderId"], data) & console.log(`[${getDate()}][EXEC MONITOR]${ data["side"] === "Buy" ? "🟢" : "🔴"} [id:${ data["orderId"] }] NEW ${ data["side"].toUpperCase() } ${ data["symbol"] } ORDER ${ data["qty"] } @ ${ data["price"] } server feedback latency: ${ getTimestamp() - data["updatedTime"] }ms`);
  },
  (data) => {
    // Case Cancelled
    removeOrderData(data["orderId"])
    console.log(`[${getDate()}][EXEC MONITOR]⏸️  [id:${ data["orderId"] }] CANCELLED server feedback latency: ${ getTimestamp() - data["updatedTime"] }ms`);
  },
  (data) => {
    // Case Filled
    removeOrderData(data["orderId"])
    console.log(`[${getDate()}][EXEC MONITOR]💥 [id:${ data["orderId"] }] FILLED ${ data["side"].toUpperCase() } ${ data["symbol"] } ${ data["qty"] } @ ${ data["price"] } server feedback latency: ${ getTimestamp() - data["updatedTime"] }ms`);
  },
  (data) => {
    // Case PartiallyFilled
    console.log(`[${getDate()}][EXEC MONITOR]💥 [id:${ data["orderId"] } PARTIALLY FILLED ${ data["side"].toUpperCase() } ${ data["symbol"] } ${ data["cumExecValue"] } / ${ data["qty"] }] server feedback latency: ${ getTimestamp() - data["updatedTime"] }ms`);
  },
  (data) => {
    // Case PartiallyFilledCanceled
    removeOrderData(data["orderId"])
    console.log(`[${getDate()}][EXEC MONITOR]⏸️  [id:${ data["orderId"] } PARTIALLY FILLED CANCELLED ${ data["side"].toUpperCase() } ${ data["symbol"] } ${ data["cumExecValue"] } / ${ data["qty"] }] reason: size too small`);
  }
];

function log_payload(pl) {
  // pl = json payload
  if (pl["op"]) console.log(`[${getDate()}][EXEC MONITOR]🆕 OPERATION: ${ pl["op"] } -> SUCCESS: ${ pl["success"] }`);
  else {
    data = pl["data"][0]
    if (pl["topic"] === "order") orderMsg[statusMap[data["orderStatus"]]](data);
    if (pl["topic"] === "position") updatePositionData(data["symbol"], data) & console.log(`[${getDate()}][EXEC MONITOR]${ data["side"] === "Buy" ? "🟢" : data["side"] === "Sell" ? "🔴" : "⚪" } UPDATED CURRENT POSITION ${ data["symbol"] } ${ data["side"] === "Buy" ? data["size"] : data["size"] * -1 } @ ${ data["entryPrice"] } liqPrice: ${ data["liqPrice"] }`);
  }
}

function display_active_orders_and_positions() {
  console.log(`[${getDate()}][EXEC MONITOR] ACTIVE OPEN ORDERS:`);
  for (const order in orderData) {
    data = orderData[order];
    console.log(`   [id: ${order}]: ${data["side"].toUpperCase()} ${data["symbol"]} ${data["qty"]} @ ${data["price"]}`);
  };
  console.log(`[${getDate()}][EXEC MONITOR] ACTIVE OPEN POSITIONS:`);
  for (const symbol in positionData) {
    data = positionData[symbol];
    console.log(`   [symbol: ${symbol}]: ${data["side"].toUpperCase()} ${data["size"]} ${data["entryPrice"]} ${data["markPrice"]} ${data["liqPrice"]} ${data["positionBalance"]}`);
  };
}

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
    parentPort.postMessage("exec_monitor_alive");
  }, PING_INTERVAL );

  clearInterval(reminderTrigger);
  pingTrigger = setInterval(() => {
    if (!(ws.readyState === WebSocket.OPEN)) return;
    display_active_orders_and_positions();
  }, REMINDER_INTERVAL );
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
  console.log(`[${getDate()}][EXEC MONITOR]🆙 ws connection: [ON] (connection initialized)`);

  // authentication
  const {API, SEC} = process.env;
  const authToken = generateAuthToken({ API, SEC });
  ws.send(authToken);

  if (!(ws.readyState === WebSocket.OPEN) || !subs.length) return;
  ws.send(JSON.stringify({ op: "subscribe", args: subs}));
};

const onPong = () => {
  console.log(`[${getDate()}][EXEC MONITOR]🏸 ws connection: [ACTIVE] (pong received)`);
  clearTimeout(heartbeatTrigger);

  heartbeatTrigger = setTimeout(() => {
    console.log(`[${getDate()}][EXEC MONITOR]💀 HEARTBEAT TRIGGERED ws connection: [DEAD] (restarting)`);
    restart();
  }, HEARTBEAT_INTERVAL);
};

const onMessage = (pl) => {
  log_payload(JSON.parse(pl));
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
  subscribe(["order", "position"]);
})();