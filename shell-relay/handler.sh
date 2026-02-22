#!/usr/bin/env sh
set -eu

TOKEN="${AGENT1C_RELAY_TOKEN:-}"
MAX_OUTPUT_CHARS="${AGENT1C_RELAY_MAX_OUTPUT_CHARS:-65536}"
DEFAULT_TIMEOUT_MS="${AGENT1C_RELAY_DEFAULT_TIMEOUT_MS:-30000}"
DEFAULT_FETCH_TIMEOUT_S="${AGENT1C_RELAY_FETCH_TIMEOUT_S:-25}"
HTTP_PROXY="${AGENT1C_RELAY_HTTP_PROXY:-}"
ALLOW_ORIGINS="${AGENT1C_RELAY_ALLOW_ORIGINS:-https://agent1c.me,https://www.agent1c.me,http://localhost:8000,http://127.0.0.1:8000}"
HOST="${AGENT1C_RELAY_HOST:-127.0.0.1}"
PORT="${AGENT1C_RELAY_PORT:-8765}"

TMP_DIR="${TMPDIR:-/tmp}/agent1c-relay.$$"
mkdir -p "$TMP_DIR"
cleanup(){ rm -rf "$TMP_DIR"; }
trap cleanup EXIT INT TERM

lower(){
  printf "%s" "$1" | tr "[:upper:]" "[:lower:]"
}

trim_cr(){
  printf "%s" "$1" | tr -d '\r'
}

in_allowlist(){
  origin="$1"
  [ -n "$origin" ] || return 1
  old_ifs="$IFS"
  IFS=','
  for allowed in $ALLOW_ORIGINS; do
    allowed_trimmed="$(printf "%s" "$allowed" | sed 's/^ *//; s/ *$//')"
    if [ "$origin" = "$allowed_trimmed" ]; then
      IFS="$old_ifs"
      return 0
    fi
  done
  IFS="$old_ifs"
  return 1
}

status_text(){
  case "$1" in
    200) printf "OK" ;;
    204) printf "No Content" ;;
    400) printf "Bad Request" ;;
    401) printf "Unauthorized" ;;
    403) printf "Forbidden" ;;
    404) printf "Not Found" ;;
    405) printf "Method Not Allowed" ;;
    *) printf "OK" ;;
  esac
}

send_json(){
  code="$1"
  body="$2"
  printf "HTTP/1.1 %s %s\r\n" "$code" "$(status_text "$code")"
  if [ -n "${ORIGIN:-}" ] && in_allowlist "$ORIGIN"; then
    printf "Access-Control-Allow-Origin: %s\r\n" "$ORIGIN"
    printf "Vary: Origin\r\n"
    printf "Access-Control-Allow-Headers: Content-Type, x-agent1c-token\r\n"
    printf "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
    printf "Access-Control-Allow-Private-Network: true\r\n"
  fi
  printf "Content-Type: application/json; charset=utf-8\r\n"
  printf "Content-Length: %s\r\n" "$(printf "%s" "$body" | wc -c | tr -d ' ')"
  printf "\r\n%s" "$body"
}

send_error(){
  code="$1"
  msg="$2"
  body="$(jq -nc --arg err "$msg" '{ok:false,error:$err}')"
  send_json "$code" "$body"
}

json_bool(){
  if [ "$1" = "1" ]; then printf "true"; else printf "false"; fi
}

truncate_file(){
  input="$1"
  output="$2"
  bytes="$(wc -c < "$input" | tr -d ' ')"
  if [ "$bytes" -gt "$MAX_OUTPUT_CHARS" ]; then
    head -c "$MAX_OUTPUT_CHARS" "$input" > "$output"
    printf "1"
  else
    cp "$input" "$output"
    printf "0"
  fi
}

run_curl(){
  if [ -n "$HTTP_PROXY" ]; then
    curl --proxy "$HTTP_PROXY" "$@"
  else
    curl "$@"
  fi
}

run_shell_command(){
  command="$1"
  timeout_ms="$2"
  out_file="$TMP_DIR/stdout.txt"
  err_file="$TMP_DIR/stderr.txt"
  out_trim="$TMP_DIR/stdout.trim.txt"
  err_trim="$TMP_DIR/stderr.trim.txt"

  : > "$out_file"
  : > "$err_file"

  (
    sh -lc "$command"
  ) >"$out_file" 2>"$err_file" &
  cmd_pid="$!"

  timeout_s=$(( (timeout_ms + 999) / 1000 ))
  elapsed=0
  timed_out=0

  while kill -0 "$cmd_pid" 2>/dev/null; do
    if [ "$elapsed" -ge "$timeout_s" ]; then
      kill -TERM "$cmd_pid" 2>/dev/null || true
      sleep 1
      kill -KILL "$cmd_pid" 2>/dev/null || true
      timed_out=1
      break
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done

  exit_code=0
  if [ "$timed_out" -eq 1 ]; then
    wait "$cmd_pid" 2>/dev/null || true
    exit_code=-1
  else
    if wait "$cmd_pid"; then
      exit_code=0
    else
      exit_code="$?"
    fi
  fi

  out_trunc="$(truncate_file "$out_file" "$out_trim")"
  err_trunc="$(truncate_file "$err_file" "$err_trim")"
  truncated=0
  if [ "$out_trunc" = "1" ] || [ "$err_trunc" = "1" ]; then truncated=1; fi

  stdout="$(cat "$out_trim")"
  stderr="$(cat "$err_trim")"
  timed_out_json="$(json_bool "$timed_out")"
  truncated_json="$(json_bool "$truncated")"
  jq -nc \
    --argjson exitCode "$exit_code" \
    --argjson timedOut "$timed_out_json" \
    --argjson truncated "$truncated_json" \
    --arg stdout "$stdout" \
    --arg stderr "$stderr" \
    '{ok:true,exitCode:$exitCode,timedOut:$timedOut,truncated:$truncated,stdout:$stdout,stderr:$stderr}'
}

header_value(){
  file="$1"
  key="$2"
  grep -i "^${key}:" "$file" | tail -n 1 | cut -d: -f2- | sed 's/^ *//; s/ *$//'
}

run_http_fetch(){
  target_url="$1"
  mode="$2"
  max_bytes="$3"
  headers_file="$TMP_DIR/http.headers.txt"
  body_file="$TMP_DIR/http.body.bin"
  body_trim="$TMP_DIR/http.body.trim.bin"
  effective_file="$TMP_DIR/http.effective.txt"

  case "$target_url" in
    http://*|https://*) ;;
    *)
      jq -nc --arg err "invalid url" '{ok:false,error:$err}'
      return
      ;;
  esac

  : > "$headers_file"
  : > "$body_file"
  : > "$effective_file"

  curl_ok=1
  if [ "$mode" = "head" ]; then
    if run_curl -L -sS -I --max-time "$DEFAULT_FETCH_TIMEOUT_S" \
      -A "Agent1cRelay/1.0" \
      "$target_url" >"$headers_file" 2>/dev/null; then
      curl_ok=0
      printf "%s" "$target_url" > "$effective_file"
    fi
  else
    if run_curl -L -sS --max-time "$DEFAULT_FETCH_TIMEOUT_S" \
      -A "Agent1cRelay/1.0" \
      -D "$headers_file" \
      -o "$body_file" \
      -w "%{url_effective}" \
      "$target_url" >"$effective_file" 2>/dev/null; then
      curl_ok=0
    fi
  fi

  if [ "$curl_ok" -ne 0 ]; then
    jq -nc --arg err "fetch failed" '{ok:false,error:$err}'
    return
  fi

  status_code="$(awk 'BEGIN{code=0} /^HTTP\// {code=$2} END{print code}' "$headers_file")"
  [ -n "$status_code" ] || status_code=0
  content_type="$(header_value "$headers_file" "Content-Type")"
  xfo="$(header_value "$headers_file" "X-Frame-Options")"
  csp="$(header_value "$headers_file" "Content-Security-Policy")"
  final_url="$(cat "$effective_file")"
  [ -n "$final_url" ] || final_url="$target_url"

  if [ "$mode" = "head" ]; then
    jq -nc \
      --argjson status "$status_code" \
      --arg finalUrl "$final_url" \
      --arg contentType "$content_type" \
      --arg xFrameOptions "$xfo" \
      --arg csp "$csp" \
      --rawfile headers "$headers_file" \
      '{ok:true,mode:"head",status:$status,finalUrl:$finalUrl,contentType:$contentType,xFrameOptions:$xFrameOptions,csp:$csp,headers:$headers}'
    return
  fi

  bytes="$(wc -c < "$body_file" | tr -d ' ')"
  truncated=0
  if [ "$bytes" -gt "$max_bytes" ]; then
    head -c "$max_bytes" "$body_file" > "$body_trim"
    truncated=1
  else
    cp "$body_file" "$body_trim"
  fi

  truncated_json="$(json_bool "$truncated")"
  jq -nc \
    --argjson status "$status_code" \
    --arg finalUrl "$final_url" \
    --arg contentType "$content_type" \
    --arg xFrameOptions "$xfo" \
    --arg csp "$csp" \
    --argjson truncated "$truncated_json" \
    --rawfile headers "$headers_file" \
    --rawfile body "$body_trim" \
    '{ok:true,mode:"get",status:$status,finalUrl:$finalUrl,contentType:$contentType,xFrameOptions:$xFrameOptions,csp:$csp,truncated:$truncated,headers:$headers,body:$body}'
}

REQUEST_LINE=""
if ! IFS= read -r REQUEST_LINE; then
  exit 0
fi
REQUEST_LINE="$(trim_cr "$REQUEST_LINE")"
set -- $REQUEST_LINE
METHOD="${1:-}"
PATH_ONLY="${2:-/}"

CONTENT_LENGTH=0
ORIGIN=""
TOKEN_HEADER=""

while IFS= read -r line; do
  line="$(trim_cr "$line")"
  [ -n "$line" ] || break
  header_name="$(lower "$(printf "%s" "$line" | cut -d: -f1)")"
  header_value="$(printf "%s" "$line" | cut -d: -f2- | sed 's/^ *//')"
  case "$header_name" in
    content-length) CONTENT_LENGTH="${header_value:-0}" ;;
    origin) ORIGIN="$header_value" ;;
    x-agent1c-token) TOKEN_HEADER="$header_value" ;;
  esac
done

BODY_FILE="$TMP_DIR/body.json"
: > "$BODY_FILE"
if [ "${CONTENT_LENGTH:-0}" -gt 0 ]; then
  dd bs=1 count="$CONTENT_LENGTH" of="$BODY_FILE" 2>/dev/null || true
fi

if [ "$METHOD" = "OPTIONS" ]; then
  if ! in_allowlist "$ORIGIN"; then
    send_error 403 "origin not allowed"
    exit 0
  fi
  send_json 204 "{}"
  exit 0
fi

if ! in_allowlist "$ORIGIN"; then
  send_error 403 "origin not allowed"
  exit 0
fi

if [ -n "$TOKEN" ] && [ "$TOKEN" != "$TOKEN_HEADER" ]; then
  send_error 401 "invalid token"
  exit 0
fi

if [ "$METHOD" = "GET" ] && [ "$PATH_ONLY" = "/v1/health" ]; then
  transport_mode="direct"
  if [ -n "$HTTP_PROXY" ]; then transport_mode="proxy"; fi
  body="$(jq -nc --arg host "$HOST" --argjson port "$PORT" --arg transport "$transport_mode" --arg httpProxy "$HTTP_PROXY" '{ok:true,version:"sh-0.1",mode:"shell",host:$host,port:$port,transport:$transport,httpProxy:$httpProxy}')"
  send_json 200 "$body"
  exit 0
fi

if [ "$METHOD" = "GET" ] && [ "$PATH_ONLY" = "/v1/tor/status" ]; then
  if [ -z "$HTTP_PROXY" ]; then
    body="$(jq -nc '{ok:true,proxyConfigured:false,isTor:false,transport:"direct"}')"
    send_json 200 "$body"
    exit 0
  fi
  tor_resp="$(run_curl -sS --max-time 12 https://check.torproject.org/api/ip 2>/dev/null || true)"
  if [ -z "$tor_resp" ]; then
    send_json 200 "$(jq -nc --arg proxy "$HTTP_PROXY" '{ok:false,proxyConfigured:true,isTor:false,transport:"proxy",httpProxy:$proxy,error:"tor check failed"}')"
    exit 0
  fi
  is_tor="$(printf "%s" "$tor_resp" | jq -r 'if has("IsTor") then .IsTor elif has("is_tor") then .is_tor else false end' 2>/dev/null || printf "false")"
  ip_addr="$(printf "%s" "$tor_resp" | jq -r '.IP // .ip // ""' 2>/dev/null || true)"
  body="$(jq -nc --arg proxy "$HTTP_PROXY" --arg ip "$ip_addr" --argjson isTor "$(printf "%s" "$is_tor" | tr '[:upper:]' '[:lower:]')" '{ok:true,proxyConfigured:true,transport:"proxy",httpProxy:$proxy,isTor:$isTor,ip:$ip}')"
  send_json 200 "$body"
  exit 0
fi

if [ "$METHOD" = "POST" ] && [ "$PATH_ONLY" = "/v1/shell/exec" ]; then
  if ! jq -e . "$BODY_FILE" >/dev/null 2>&1; then
    send_error 400 "invalid JSON body"
    exit 0
  fi
  command="$(jq -r '.command // ""' "$BODY_FILE")"
  timeout_ms="$(jq -r '.timeout_ms // empty' "$BODY_FILE")"
  [ -n "$timeout_ms" ] || timeout_ms="$DEFAULT_TIMEOUT_MS"
  if [ -z "$command" ]; then
    send_error 400 "missing command"
    exit 0
  fi
  case "$timeout_ms" in
    ''|*[!0-9]*) timeout_ms="$DEFAULT_TIMEOUT_MS" ;;
  esac
  if [ "$timeout_ms" -lt 1000 ]; then timeout_ms=1000; fi
  if [ "$timeout_ms" -gt 120000 ]; then timeout_ms=120000; fi
  body="$(run_shell_command "$command" "$timeout_ms")"
  send_json 200 "$body"
  exit 0
fi

if [ "$METHOD" = "POST" ] && [ "$PATH_ONLY" = "/v1/http/fetch" ]; then
  if ! jq -e . "$BODY_FILE" >/dev/null 2>&1; then
    send_error 400 "invalid JSON body"
    exit 0
  fi
  target_url="$(jq -r '.url // ""' "$BODY_FILE")"
  mode="$(jq -r '.mode // "get"' "$BODY_FILE")"
  max_bytes="$(jq -r '.max_bytes // 300000' "$BODY_FILE")"
  case "$mode" in
    head|get) ;;
    *) mode="get" ;;
  esac
  case "$max_bytes" in
    ''|*[!0-9]*) max_bytes=300000 ;;
  esac
  if [ "$max_bytes" -lt 4096 ]; then max_bytes=4096; fi
  if [ "$max_bytes" -gt 1000000 ]; then max_bytes=1000000; fi
  if [ -z "$target_url" ]; then
    send_error 400 "missing url"
    exit 0
  fi
  body="$(run_http_fetch "$target_url" "$mode" "$max_bytes")"
  send_json 200 "$body"
  exit 0
fi

send_error 404 "not found"
