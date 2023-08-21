const getDate = () => {
    const now = new Date();
    return now.toISOString().replace('T', ' ').substr(0, 23);
  }
const si = require('systeminformation');
let osu = require('node-os-utils')
let cpu = osu.cpu
const { parentPort } = require('node:worker_threads');
const USAGE_INTERVAL = 30*1000;
let usageTrigger;

// LOGGER
const fs = require('fs');
const path = require('path');
const util = require("util");

const logFilePath = path.join(__dirname, "/logs/session_ressource.log");
const logFile = fs.createWriteStream(logFilePath, { flags: 'a' });

const originalConsoleLog = console.log;
console.log = function (...args) {
  const message = args.map(arg => util.format(arg)).join(' ');
  originalConsoleLog.apply(console, args);
  logFile.write(`${message}\n`);
};

function monitor() {
  clearInterval(usageTrigger);
  usageTrigger = setInterval(() => {
    parentPort.postMessage("ressource_monitor_alive");
    si.mem()
      .then(data => console.log(`[${getDate()}][RESSOURCE MONITOR]memory usage: ${ data["total"] / (data["total"] + data["available"]) * 100 }%`));
    cpu.usage()
      .then(cpuPercentage => console.log(`[${getDate()}][RESSOURCE MONITOR]CPU usage: ${ cpuPercentage }%`));
  }, USAGE_INTERVAL );
}

// CORE LOGIC
(async () => {
    monitor();
  })();