/* global module */
module.exports = {
  apps: [
    { name: "whatsapp-bridge", cwd: "/var/www/whatsapp", script: "dist/src/server.js", env_file: "/var/www/whatsapp/.env", autorestart: true, max_memory_restart: "350M" },
    { name: "whatsapp-learning-worker", cwd: "/var/www/whatsapp", script: "dist/src/learningWorker.js", env_file: "/var/www/whatsapp/.env", autorestart: true, max_memory_restart: "450M", nice: 10 }
  ]
};
