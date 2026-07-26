const path = require("path");

// PM2 resolves a relative cwd against this file's directory, not the shell's,
// so anchor it explicitly. This app is standalone: it shares the box (and the
// `deploy` user's PM2 daemon) with the varotranaka stack but nothing else.
const ROOT = path.resolve(__dirname);

module.exports = {
  apps: [
    {
      name: "airemover",
      cwd: ROOT,
      script: ".next/standalone/server.js",
      max_memory_restart: "400M",
      kill_timeout: 10000,
      env: {
        // 3005-3010 belong to the varotranaka apps; this one takes the next slot.
        PORT: 3011,
        HOSTNAME: "127.0.0.1",
        NODE_ENV: "production",
        NODE_OPTIONS: "--max-old-space-size=384",
      },
    },
  ],
};
