#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const configPath = path.resolve(__dirname, '..', 'config', 'config.json');
const projectConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const runnerConfig = projectConfig.runner || {};
const resolvedWorkers = Number(runnerConfig.workers ?? 1);

const pad = (value) => value.toString().padStart(2, '0');

const now = new Date();
const stamp = `${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${now.getFullYear()}_${pad(now.getHours())}:${pad(now.getMinutes())}`;

const env = {
  ...process.env,
  RESULT_RUN_STAMP: process.env.RESULT_RUN_STAMP || stamp
};

const args = ['playwright', 'test', ...process.argv.slice(2)];

if (Number.isFinite(resolvedWorkers)) {
  args.push('--workers', String(resolvedWorkers));
}

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const child = spawn(command, args, {
  stdio: 'inherit',
  cwd: path.resolve(__dirname, '..'),
  env
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code);
  }
});
