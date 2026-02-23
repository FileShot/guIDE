const fs = require('fs');
const path = require('path');

// Parse .env.local file
const envPath = path.join(__dirname, '.env.local');
const envVars = {};
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        envVars[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
      }
    }
  }
}

module.exports = {
  apps: [
    {
      name: 'graysoft',
      script: '.next-ready/standalone/server.js',
      cwd: path.join(__dirname),
      env: {
        NODE_ENV: 'production',
        PORT: 3200,
        ...envVars,
      },
    },
  ],
};
