const fs = require('node:fs');
const path = require('node:path');

function createLogger(logPath = path.join(process.cwd(), 'router.log.jsonl')) {
  return {
    log(event) {
      const record = {
        ts: new Date().toISOString(),
        ...event,
      };
      fs.appendFileSync(logPath, JSON.stringify(record) + '\n', 'utf8');
      return record;
    },
  };
}

module.exports = { createLogger };
