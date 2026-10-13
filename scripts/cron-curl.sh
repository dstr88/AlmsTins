#!/usr/bin/env bash
#
# cron-curl.sh: the one curl call each scheduled workflow makes to an /api/cron/* endpoint.
#
# Usage (from a workflow step, after checking out this file):
#   bash scripts/cron-curl.sh -sS --fail --max-time 600 -o "$RUNNER_TEMP/cron-response.json" \
#     -w 'HTTP %{http_code}\n' "$SYNC_URL/api/cron/<job>?secret=$CRON_SECRET" \
#     -H "x-cron-secret: $CRON_SECRET"
#
# Every argument goes to curl unchanged. The only thing added is a narrow retry:
#
#   Retried (up to 3 attempts in all, a short pause between them):
#     curl exit 6  could not resolve host
#     curl exit 7  failed to connect
#   In both cases the request never reached the server, so sending it again cannot repeat work.
#
#   Never retried: everything else, including
#     curl exit 22  HTTP error (from --fail). The endpoint ran and may have done part of its
#                   work (sent some drip or digest emails, written some rows) before failing.
#     curl exit 28  timeout. The endpoint may still be running.
#   Sending those again could send the same emails twice, so the job fails and the next
#   scheduled run picks up.
#
# Guards (the script exits 2 without calling curl):
#   --fail is required, so an HTTP error fails the job instead of passing green.
#   --max-time is required, so a hung endpoint cannot hold the runner for hours.
#   No --retry* flag is accepted. curl's own retries (--retry-all-errors in particular)
#   resend after HTTP errors and timeouts, which is exactly what this script exists to avoid.
#
# The script never prints its arguments: the URL and header carry CRON_SECRET, and this
# repository's Actions logs are public. Output is curl's own (-w and -sS errors) plus one line
# per retry. Exit status is curl's status from the last attempt.
#
# CRON_CURL_RETRY_DELAY (seconds, default 10) exists for the tests in tests/ci/cronCurl.test.ts.

set -euo pipefail

readonly MAX_ATTEMPTS=3

if [ "$#" -eq 0 ]; then
	echo "cron-curl: no curl arguments given." >&2
	exit 2
fi

delay="${CRON_CURL_RETRY_DELAY:-10}"
case "$delay" in
	'' | *[!0-9]*) delay=10 ;;
esac

has_fail=0
has_max_time=0
for arg in "$@"; do
	case "$arg" in
		--fail) has_fail=1 ;;
		--max-time | --max-time=*) has_max_time=1 ;;
		--retry*)
			echo "cron-curl: curl --retry flags are not allowed here; this script retries only when the request never reached the server." >&2
			exit 2
			;;
	esac
done
if [ "$has_fail" -ne 1 ]; then
	echo "cron-curl: pass --fail, so an HTTP error fails the job." >&2
	exit 2
fi
if [ "$has_max_time" -ne 1 ]; then
	echo "cron-curl: pass --max-time <seconds>, so a hung endpoint cannot hold the job." >&2
	exit 2
fi

attempt=1
while :; do
	rc=0
	curl "$@" || rc=$?
	case "$rc" in
		0)
			exit 0
			;;
		6 | 7)
			if [ "$attempt" -ge "$MAX_ATTEMPTS" ]; then
				echo "cron-curl: could not reach the server (curl exit $rc) after $MAX_ATTEMPTS attempts; giving up." >&2
				exit "$rc"
			fi
			echo "cron-curl: could not reach the server (curl exit $rc) on attempt $attempt of $MAX_ATTEMPTS; the request was not sent, retrying in ${delay}s." >&2
			sleep "$delay"
			attempt=$((attempt + 1))
			;;
		*)
			# Not retried: the request may have reached the server (see the header).
			exit "$rc"
			;;
	esac
done
