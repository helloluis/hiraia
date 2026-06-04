#!/usr/bin/env bash
cd /root/hiraia/packages/web || exit 1
export HIRAIA_DB_PATH=/var/lib/hiraia/hiraia.db
export NODE_ENV=production
exec node node_modules/next/dist/bin/next start -p 3005 -H 0.0.0.0
