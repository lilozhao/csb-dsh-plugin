#!/bin/sh
# A2A Server v5 launcher for port 3100
cd /home/node/.openclaw/workspace/csb-a2a-aip
export A2A_PORT=3100
exec node server_v5.js
