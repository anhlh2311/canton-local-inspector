#!/bin/sh
# Generate a Caddyfile from env and exec Caddy.
# Unprefixed routes use LEDGER_*/VALIDATOR_*/AUTH_*.
# Path prefixes: GATEWAY_TENANTS=kairo,sanctum,mcph
# Incomplete tenants are skipped so the default Angelhack routes still start.
set -eu

env_val() {
	eval "printf '%s' \"\${$1-}\""
}

normalize_tenant() {
	printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9'
}

tenant_complete() {
	name=$1
	upper=$(printf '%s' "$name" | tr '[:lower:]' '[:upper:]')
	for suffix in \
		LEDGER_UPSTREAM LEDGER_UPSTREAM_HOST \
		VALIDATOR_UPSTREAM VALIDATOR_UPSTREAM_HOST \
		AUTH_UPSTREAM AUTH_UPSTREAM_HOST
	do
		if [ -z "$(env_val "${upper}_${suffix}")" ]; then
			echo "skipping tenant ${name}: missing ${upper}_${suffix}" >&2
			return 1
		fi
	done
	return 0
}

OUT=/tmp/Caddyfile
: >"$OUT"

append() {
	printf '%s\n' "$1" >>"$OUT"
}

COMPLETE=""
old_ifs=$IFS
IFS=,
# shellcheck disable=SC2086
set -- ${GATEWAY_TENANTS:-}
IFS=$old_ifs
for raw in "$@"; do
	name=$(normalize_tenant "$raw")
	[ -n "$name" ] || continue
	if tenant_complete "$name"; then
		COMPLETE="${COMPLETE} ${name}"
	fi
done

echo "gateway tenants:${COMPLETE:- (none)}" >&2

append '{'
append '	admin off'
append '}'
append ''
append ":${LEDGER_GATEWAY_PORT:-8080} {"
append "	@authed header X-Ledger-Gateway-Secret ${LEDGER_GATEWAY_SECRET}"
append ''
append '	handle @authed {'
append "		@ledger host ${LEDGER_GATEWAY_HOSTNAME}"
append '		handle @ledger {'

for name in $COMPLETE; do
	upper=$(printf '%s' "$name" | tr '[:lower:]' '[:upper:]')
	up=$(env_val "${upper}_LEDGER_UPSTREAM")
	host=$(env_val "${upper}_LEDGER_UPSTREAM_HOST")
	append "			@${name}_ledger path /${name} /${name}/*"
	append "			handle @${name}_ledger {"
	append "				uri strip_prefix /${name}"
	append "				reverse_proxy ${up} {"
	append "					header_up Host ${host}"
	append '					header_up -X-Ledger-Gateway-Secret'
	append '				}'
	append '			}'
	append ''
done

append "			reverse_proxy ${LEDGER_UPSTREAM} {"
append "				header_up Host ${LEDGER_UPSTREAM_HOST}"
append '				header_up -X-Ledger-Gateway-Secret'
append '			}'
append '		}'
append ''
append "		@validator host ${VALIDATOR_GATEWAY_HOSTNAME}"
append '		handle @validator {'

for name in $COMPLETE; do
	upper=$(printf '%s' "$name" | tr '[:lower:]' '[:upper:]')
	up=$(env_val "${upper}_VALIDATOR_UPSTREAM")
	host=$(env_val "${upper}_VALIDATOR_UPSTREAM_HOST")
	append "			@${name}_validator path /${name} /${name}/*"
	append "			handle @${name}_validator {"
	append "				uri strip_prefix /${name}"
	append "				reverse_proxy ${up} {"
	append "					header_up Host ${host}"
	append '					header_up -X-Ledger-Gateway-Secret'
	append '				}'
	append '			}'
	append ''
done

append "			reverse_proxy ${VALIDATOR_UPSTREAM} {"
append "				header_up Host ${VALIDATOR_UPSTREAM_HOST}"
append '				header_up -X-Ledger-Gateway-Secret'
append '			}'
append '		}'
append ''
append "		@auth host ${AUTH_GATEWAY_HOSTNAME}"
append '		handle @auth {'

for name in $COMPLETE; do
	upper=$(printf '%s' "$name" | tr '[:lower:]' '[:upper:]')
	up=$(env_val "${upper}_AUTH_UPSTREAM")
	host=$(env_val "${upper}_AUTH_UPSTREAM_HOST")
	append "			@${name}_auth path /${name} /${name}/*"
	append "			handle @${name}_auth {"
	append "				uri strip_prefix /${name}"
	append "				@${name}_token {"
	append '					method POST'
	append "					path_regexp ${name}_token ^/auth/realms/[^/]+/protocol/openid-connect/token$"
	append '				}'
	append "				handle @${name}_token {"
	append "					reverse_proxy ${up} {"
	append "						header_up Host ${host}"
	append '						header_up -X-Ledger-Gateway-Secret'
	append '					}'
	append '				}'
	append '				respond "Not Found" 404'
	append '			}'
	append ''
done

append '			@token {'
append '				method POST'
append '				path_regexp token ^/auth/realms/[^/]+/protocol/openid-connect/token$'
append '			}'
append '			handle @token {'
append "				reverse_proxy ${AUTH_UPSTREAM} {"
append "					header_up Host ${AUTH_UPSTREAM_HOST}"
append '					header_up -X-Ledger-Gateway-Secret'
append '				}'
append '			}'
append '			respond "Not Found" 404'
append '		}'
append ''
append '		respond "Not Found" 404'
append '	}'
append ''
append '	handle_errors {'
append '		respond "upstream {http.error.status_code}: {http.error.message}" {http.error.status_code}'
append '	}'
append ''
append '	respond "Unauthorized" 401'
append '}'

echo "validating generated Caddyfile" >&2
caddy validate --config "$OUT" --adapter caddyfile >&2
exec caddy run --config "$OUT" --adapter caddyfile
