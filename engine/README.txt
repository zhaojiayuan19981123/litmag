LitMag bridge engine v1.0
=========================

Requirements: Node.js 20 or newer. No npm install and no dependencies.

Start
-----
  Windows     : double-click start.cmd   (or: node server.mjs)
  macOS/Linux : sh start.sh             (or: node server.mjs)

Defaults
--------
  engine     http://127.0.0.1:23127
  workbench  http://127.0.0.1:3000

The engine writes ~/.litmag/engine.json with the actual port and a session
token. The Zotero 10 plugin reads that file automatically. Stop with Ctrl+C.

Configuration
-------------
Copy config.example.json to config.json and edit it, or use environment
variables: LITMAG_PORT, LITMAG_WORKBENCH_URL, LITMAG_TOKEN, LITMAG_HOST.

Endpoints
---------
  GET  /                          status page
  GET  /api/litmag/handshake      plugin probe (no token required)
  GET  /api/litmag/status         status (token required)
  GET  /api/litmag/context        last selection (token required)
  POST /api/litmag/context        selection from Zotero (token required)
  GET  /workbench                 reverse proxy to the workbench

Only listens on 127.0.0.1. The original workbench needs no changes.
