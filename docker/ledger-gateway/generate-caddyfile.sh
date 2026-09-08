#!/bin/sh
# Generate a Caddyfile from env and exec Caddy.
# Unprefixed routes use LEDGER_*/VALIDATOR_*/AUTH_*.
# Path prefixes: GATEWAY_TENANTS=kairo,sanctum,mcph
# Incomplete tenants are skipped so the default Angelhack routes still start.
# *_UPSTREAM may include a path (e.g. /api/json-api); Caddy reverse_proxy only
# gets scheme/host/port and the path is rewritten onto the request.
set -eu

env_val() {
	eval "printf '%s' \"\${$1-}\""
}

normalize_tenant() {
	printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9'
}

split_upstream() {
	u=${1%/}
	case $u in
		*://*)
			scheme=${u%%://*}
			rest=${u#*://}
			hostport=${rest%%/*}
			_origin="${scheme}://${hostport}"
			if [ "$rest" = "$hostport" ]; then
				_prefix=""
			else
				_prefix=${rest#"$hostport"}
			fi
			;;
		*)
			echo "invalid upstream URL: $1" >&2
			exit 1
			;;
	esac
}

emit_proxy() {
	indent=$1
	split_upstream "$2"
	host=$3
	if [ -n "${_prefix}" ] && [ "${_prefix}" != "/" ]; then
		append "${indent}rewrite * ${_prefix}{uri}"
	fi
	append "${indent}reverse_proxy ${_origin} {"
	append "${indent}	header_up Host ${host}"
	append "${indent}	header_up -X-Ledger-Gateway-Secret"
	append "${indent}}"
}

# Ledger tenant + default proxies. suffix keeps Caddy matcher names unique
# when the same routes are emitted for ACS websocket (no secret) and HTTP (secret).
emit_ledger_proxies() {
	indent=$1
	suffix=$2
	inner="${indent}	"
	for name in $COMPLETE; do
		upper=$(printf '%s' "$name" | tr '[:lower:]' '[:upper:]')
		up=$(env_val "${upper}_LEDGER_UPSTREAM")
		host=$(env_val "${upper}_LEDGER_UPSTREAM_HOST")
		append "${indent}@${name}_ledger${suffix} path /${name} /${name}/*"
		append "${indent}handle @${name}_ledger${suffix} {"
		append "${inner}uri strip_prefix /${name}"
		emit_proxy "$inner" "$up" "$host"
		append "${indent}"'}'
		append ''
	done
	emit_proxy "$indent" "${LEDGER_UPSTREAM}" "${LEDGER_UPSTREAM_HOST}"
}

TOKEN_PATH_REGEXP='^/(auth/realms/[^/]+/protocol/openid-connect/token|oauth/token)$'

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
append "	@acs_ws {"
append "		host ${LEDGER_GATEWAY_HOSTNAME}"
append '		header Upgrade *websocket*'
append '		header Sec-WebSocket-Protocol *jwt.token*'
append '		path_regexp acs_ws ^(/[a-z0-9]+)?/v2/state/active-contracts$'
append '	}'
append '	handle @acs_ws {'
emit_ledger_proxies '		' '_ws'
append '	}'
append ''
append "	@authed header X-Ledger-Gateway-Secret ${LEDGER_GATEWAY_SECRET}"
append ''
append '	handle @authed {'
append "		@ledger host ${LEDGER_GATEWAY_HOSTNAME}"
append '		handle @ledger {'
emit_ledger_proxies '			' ''
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
	emit_proxy '				' "$up" "$host"
	append '			}'
	append ''
done

emit_proxy '			' "${VALIDATOR_UPSTREAM}" "${VALIDATOR_UPSTREAM_HOST}"
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
	append "					path_regexp ${name}_token ${TOKEN_PATH_REGEXP}"
	append '				}'
	append "				handle @${name}_token {"
	emit_proxy '					' "$up" "$host"
	append '				}'
	append '				respond "Not Found" 404'
	append '			}'
	append ''
done

append '			@token {'
append '				method POST'
append "				path_regexp token ${TOKEN_PATH_REGEXP}"
append '			}'
append '			handle @token {'
emit_proxy '				' "${AUTH_UPSTREAM}" "${AUTH_UPSTREAM_HOST}"
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

if [ "${CADDYFILE_GENERATE_ONLY:-}" = 1 ]; then
	cat "$OUT"
	exit 0
fi

echo "validating generated Caddyfile" >&2
caddy validate --config "$OUT" --adapter caddyfile >&2
exec caddy run --config "$OUT" --adapter caddyfile
