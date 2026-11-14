#!/usr/bin/env bash
# One-time: put tala.hiraia.org on the air once its DNS record exists. Run as root ON THE HOST.
# Mirrors the read.hiraia.org pattern: its own Certbot directory, webroot challenge, own renewal timer.
# Idempotent: safe to run again.
set -euo pipefail
DOMAIN=tala.hiraia.org
CONF=/etc/letsencrypt-tala
WEBROOT=/var/lib/letsencrypt-tala-webroot
SITE=/etc/nginx/sites-available/$DOMAIN
install -d -m 700 "$CONF" /var/lib/letsencrypt-tala /var/log/letsencrypt-tala
install -d -m 755 "$WEBROOT"

if [ ! -s "$CONF/live/$DOMAIN/fullchain.pem" ]; then
  # Bootstrap: answer the challenge on :80 and, because Cloudflare may fetch it over HTTPS, on :443 with a
  # throwaway self-signed certificate. Replaced by the real site below.
  install -d -m 700 /etc/tala/bootstrap-tls
  [ -s /etc/tala/bootstrap-tls/cert.pem ] || openssl req -x509 -newkey rsa:2048 -nodes -days 7 -subj "/CN=$DOMAIN" \
    -keyout /etc/tala/bootstrap-tls/key.pem -out /etc/tala/bootstrap-tls/cert.pem >/dev/null 2>&1
  cat > "$SITE" <<NGINX
server {
    listen 80;
    listen 443 ssl;
    server_name $DOMAIN;
    ssl_certificate /etc/tala/bootstrap-tls/cert.pem;
    ssl_certificate_key /etc/tala/bootstrap-tls/key.pem;
    location ^~ /.well-known/acme-challenge/ { root $WEBROOT; default_type text/plain; try_files \$uri =404; }
    location / { return 503; }
}
NGINX
  ln -sfn "$SITE" /etc/nginx/sites-enabled/$DOMAIN
  nginx -t && systemctl reload nginx
  flock -n /run/lock/ovh-apps-certbot.lock certbot certonly --non-interactive --agree-tos \
    --register-unsafely-without-email --key-type ecdsa --webroot -w "$WEBROOT" \
    --config-dir "$CONF" --work-dir /var/lib/letsencrypt-tala --logs-dir /var/log/letsencrypt-tala \
    --cert-name "$DOMAIN" -d "$DOMAIN"
fi

install -m 644 /opt/tala/tala.hiraia.org.nginx.conf "$SITE"
ln -sfn "$SITE" /etc/nginx/sites-enabled/$DOMAIN
nginx -t && systemctl reload nginx
systemctl daemon-reload
systemctl enable --now tala-cert-renew.timer >/dev/null
echo "==> $DOMAIN is served over HTTPS; certificate expires: $(openssl x509 -enddate -noout -in "$CONF/live/$DOMAIN/fullchain.pem" | cut -d= -f2)"
