const readline = require("node:readline");
const { stdin: input, stdout: output } = require("node:process");
const rl = readline.createInterface({ input, output });
const { Worker } = require("node:worker_threads");
const HEARTBEAT_INTERVAL = 25*1000;

const __executionMonitorFilename = "./execution_monitor.js";
const __ressourceMonitorFilename = "./ressource_monitor.js";
let workerThreads = [];
let heartbeatTrigger;

const getDate = () => {
  const now = new Date();
  return now.toISOString().replace('T', ' ').substr(0, 23);
}
  
function launch_worker(filename) {
  const worker = new Worker(filename);
  workerThreads.push(worker);

  worker.on("exit", () => {
      workerThreads.splice(workerThreads.indexOf(worker));
      launch_worker(filename);
  });

  worker.on("message", (message) => {
    if (message === "exec_monitor_alive") clearTimeout(heartbeatTrigger) & console.log(`[${getDate()}][PARENT] execution monitoring worker is active`);
    if (message === "ressource_monitor_alive") clearTimeout(heartbeatTrigger) & console.log(`[${getDate()}][PARENT] ressource monitoring worker is active`);

    heartbeatTrigger = setTimeout(() => {
      console.log(`[${getDate()}][PARENT] heartbeat triggered on ${worker.threadId} [restarting]`);
      worker.terminate();
      launch_worker(filename)
    }, HEARTBEAT_INTERVAL);
  });
}


// CORE LOGIC
(async () => {
  launch_worker(__executionMonitorFilename);
  launch_worker(__ressourceMonitorFilename);
})();

rl.on('SIGINT', () => {
  console.log(`[${getDate()}][PARENT]Terminating...`);
  for (const worker of workerThreads) {
    worker.terminate();
  }
  process.exit(0);
});