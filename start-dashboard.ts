/**
 * Dashboard Server Standalone Launcher
 */

import { DashboardServer } from './dashboard/DashboardServer.js';

const dashboardServer = new DashboardServer(3456, 1000, 2000);

console.log('Starting Huangdi Dashboard Server...');

try {
  const port = await dashboardServer.start();
  dashboardServer.createWebSocketServer();
  console.log(`Dashboard server started on http://localhost:${port}`);
  console.log('Open your browser to http://localhost:3456');
} catch (error) {
  console.error('Failed to start Dashboard server:', error);
  process.exit(1);
}
