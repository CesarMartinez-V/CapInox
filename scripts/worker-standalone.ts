import { startWorker, stopWorker } from '../app/backend/src/worker.js';
startWorker();
console.log(JSON.stringify({service:'cap-worker',status:'online'}));
const keepAlive=setInterval(()=>{},60000);
function shutdown(){clearInterval(keepAlive);stopWorker();process.exit(0);}
process.on('SIGINT',shutdown);
process.on('SIGTERM',shutdown);
