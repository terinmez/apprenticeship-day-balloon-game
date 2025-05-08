#!/bin/bash

# Configuration
BASE_URL="https://apprenticeship-day-balloon-game.tanju-cloudflare.workers.dev/balloon"
MAX_FILL_STATUS=100
RETRY_AFTER_BUFFER_SECONDS=0

# --- Check for userName argument ---
if [ -z "$1" ]; then
    echo "Usage: $0 <userName>"
    echo "Please provide a userName as the first argument."
    exit 1
fi

USERNAME="$1"
TOKEN="Bearer ${USERNAME}"

# Global variables that functions will modify
CURRENT_ETAG_VALUE=""
CURRENT_FILL_STATUS=""
SHOULD_CONTINUE_LOOP=true
HTTP_STATUS_CODE="" 

# Timing
SCRIPT_START_TIME=$(date +%s%N) # Nanoseconds for potentially more precision if needed later
                                # Or use date +%s for seconds

RESPONSE_HEADERS_FILE=$(mktemp /tmp/balloon_headers.XXXXXX)
RESPONSE_BODY_FILE=$(mktemp /tmp/balloon_body.XXXXXX)

# --- Cleanup function for temp files ---
cleanup_temp_files() {
    echo "Cleaning up temporary files..."
    rm -f "$RESPONSE_HEADERS_FILE" "$RESPONSE_BODY_FILE"
}
trap cleanup_temp_files EXIT INT TERM

# --- Helper function to extract header value ---
extract_header() {
    local header_name="$1"
    local headers_file="$2"
    grep -i "^${header_name}:" "$headers_file" | head -1 | awk -F': ' '{print $2}' | tr -d '\r\n'
}

# --- Helper function to extract fillStatus from simple JSON body ---
extract_fill_status_from_body() {
    local body_file="$1"
    local status_val=$(sed -n 's/.*"fillStatus"[[:space:]]*:[[:space:]]*\([0-9]\{1,\}\).*/\1/p' "$body_file")
    echo "$status_val"
}

# --- Function to get and format elapsed time ---
get_formatted_elapsed_time() {
    local current_time_s=$(date +%s)
    local start_time_s=$((SCRIPT_START_TIME / 1000000000)) # Convert nanoseconds to seconds
    
    local elapsed_seconds=$((current_time_s - start_time_s))
    
    # Pad with leading zeros to, for example, 5 digits. Adjust width as needed.
    printf "%05d" "$elapsed_seconds"
}


# --- Function to fetch balloon state (initial or refresh) ---
get_balloon_state() {
    local context_message="${1:-Fetching balloon state...}" # Default message
    echo "$context_message"

    # Reset SHOULD_CONTINUE_LOOP to true before attempting to fetch,
    # especially important if this function is called after a failure that might have set it to false.
    SHOULD_CONTINUE_LOOP=true

    local http_status
    http_status=$(curl --silent --show-error -X GET \
      "${BASE_URL}" \
      -H "Authorization: ${TOKEN}" \
      -D "${RESPONSE_HEADERS_FILE}" \
      -o "${RESPONSE_BODY_FILE}" \
      -w "%{http_code}")

    if [ "$http_status" -ne 200 ]; then
        echo "Error fetching balloon state: HTTP $http_status"
        cat "${RESPONSE_BODY_FILE}"
        SHOULD_CONTINUE_LOOP=false
        return
    fi

    local etag_header=$(extract_header "ETag" "${RESPONSE_HEADERS_FILE}")
    CURRENT_ETAG_VALUE=$(echo "$etag_header" | tr -d '"')
    CURRENT_FILL_STATUS=$(extract_fill_status_from_body "${RESPONSE_BODY_FILE}")

    if [ -z "$CURRENT_ETAG_VALUE" ]; then
        echo "Error: Could not extract ETag from GET response."
        cat "${RESPONSE_HEADERS_FILE}"
        SHOULD_CONTINUE_LOOP=false
    fi
    if [ -z "$CURRENT_FILL_STATUS" ]; then
        echo "Error: Could not extract fillStatus from GET response."
        cat "${RESPONSE_BODY_FILE}"
        SHOULD_CONTINUE_LOOP=false
    fi

    if [ "$SHOULD_CONTINUE_LOOP" = true ]; then
        echo "Current ETag: \\"${CURRENT_ETAG_VALUE}\\""
        echo "Current fillStatus: ${CURRENT_FILL_STATUS}"
    fi
}

# --- Function to make the PUT request ---
make_put_request() {
    local next_fill_status="$1"
    local etag_to_use="$2"
    local elapsed_str=$(get_formatted_elapsed_time)

    echo ""
    echo "[${elapsed_str}s] ----------------------------------------------------"
    echo "[${elapsed_str}s] Attempting PUT: fillStatus=${next_fill_status}, If-Match=\"${etag_to_use}\""
    echo "[${elapsed_str}s] ----------------------------------------------------"

    local request_body="{\"fillStatus\": ${next_fill_status}}"
    
    HTTP_STATUS_CODE=$(curl --silent --show-error -X PUT \
      "${BASE_URL}" \
      -H "Authorization: ${TOKEN}" \
      -H "If-Match: \"${etag_to_use}\"" \
      -H "Content-Type: application/json" \
      -d "${request_body}" \
      -D "${RESPONSE_HEADERS_FILE}" \
      -o "${RESPONSE_BODY_FILE}" \
      -w "%{http_code}")
}

# --- Function to handle a successful PUT (200 OK) ---
handle_successful_put() {
    echo "PUT successful."
    local new_etag_header=$(extract_header "ETag" "${RESPONSE_HEADERS_FILE}")
    local new_fill_status=$(extract_fill_status_from_body "${RESPONSE_BODY_FILE}")

    if [ -z "$new_etag_header" ]; then
        echo "Error: Could not extract ETag from 200 OK response."
        cat "${RESPONSE_HEADERS_FILE}"
        SHOULD_CONTINUE_LOOP=false
        return
    fi
    if [ -z "$new_fill_status" ]; then
        echo "Error: Could not extract fillStatus from 200 OK response."
        cat "${RESPONSE_BODY_FILE}"
        SHOULD_CONTINUE_LOOP=false
        return
    fi
    
    CURRENT_ETAG_VALUE=$(echo "$new_etag_header" | tr -d '"')
    CURRENT_FILL_STATUS="$new_fill_status"
    echo "Updated ETag: \"${CURRENT_ETAG_VALUE}\""
    echo "Updated fillStatus: ${CURRENT_FILL_STATUS}"
}

# --- Function to handle rate limiting (429) ---
handle_rate_limit() {
    local retry_after=$(extract_header "Retry-After" "${RESPONSE_HEADERS_FILE}")
    local actual_wait=10 

    if [ -n "$retry_after" ]; then 
        if [[ "$retry_after" =~ ^[0-9]+$ ]]; then
            actual_wait=$((retry_after + RETRY_AFTER_BUFFER_SECONDS)) # Use the config variable
            echo "Rate limited (429). Waiting for ${actual_wait} seconds (Retry-After: ${retry_after}s + ${RETRY_AFTER_BUFFER_SECONDS}s buffer)."
        else
            echo "Rate limited (429) but Retry-After value is not a valid number: '$retry_after'. Waiting ${actual_wait} seconds (default)."
        fi
    else
        echo "Rate limited (429) but no Retry-After header found. Waiting ${actual_wait} seconds (default)."
    fi

    sleep "${actual_wait}" &
    local sleep_pid=$!
    wait "${sleep_pid}" 2>/dev/null 
}

# --- Function to handle precondition failed (412) ---
handle_precondition_failed() {
    echo "Precondition Failed (412). ETag: \\"${CURRENT_ETAG_VALUE}\\" is stale."
    echo "Current response body from failed PUT:"
    cat "${RESPONSE_BODY_FILE}"
    echo "Attempting to re-fetch balloon's current state..."
    get_balloon_state "Re-fetching balloon state after 412 error..." # This will update ETag and fillStatus

    if [ "$SHOULD_CONTINUE_LOOP" = true ]; then
        echo "State refreshed successfully. New ETag: \\"${CURRENT_ETAG_VALUE}\\", New fillStatus: ${CURRENT_FILL_STATUS}. Will retry PUT in the next loop iteration."
    else
        echo "Failed to refresh balloon state after 412 error. Exiting."
        # SHOULD_CONTINUE_LOOP is already false if get_balloon_state failed.
    fi
}

# --- Function to handle other errors ---
handle_other_error() {
    local status_code="$1" 
    echo "Unhandled HTTP status: ${status_code}. Stopping."
    echo "Headers:"
    cat "${RESPONSE_HEADERS_FILE}"
    echo "Body:"
    cat "${RESPONSE_BODY_FILE}"
    SHOULD_CONTINUE_LOOP=false
}

# ===============================================
#                 MAIN SCRIPT LOGIC
# ===============================================

get_balloon_state "Fetching initial balloon state..."

if [ "$SHOULD_CONTINUE_LOOP" = false ]; then
    echo "Exiting due to error in initial state fetch."
    exit 1
fi

# === THE MAIN LOOP ===
while [ "$SHOULD_CONTINUE_LOOP" = true ]; do

    loop_start_elapsed_str=$(get_formatted_elapsed_time)

    if [ "$CURRENT_FILL_STATUS" -ge "$MAX_FILL_STATUS" ]; then
        echo "Balloon is full (or reached max configured status: $MAX_FILL_STATUS). Exiting."
        break 
    fi

    NEXT_FILL_STATUS=$((CURRENT_FILL_STATUS + 1))
    
    make_put_request "$NEXT_FILL_STATUS" "$CURRENT_ETAG_VALUE" 
    
    post_put_elapsed_str=$(get_formatted_elapsed_time)
    echo "PUT Response Status: ${HTTP_STATUS_CODE}"
    echo "Response Body:"
    if [ -f "$RESPONSE_BODY_FILE" ]; then
        cat "${RESPONSE_BODY_FILE}" 
    else
        echo "[No response body file found or curl failed before creating it]"
    fi
    echo ""

    case "$HTTP_STATUS_CODE" in
        "200") 
            handle_successful_put
            ;;
        "429")
            handle_rate_limit
            ;;
        "412")
            handle_precondition_failed
            ;;
        *)
            if [ -z "$HTTP_STATUS_CODE" ]; then
                echo "Error: curl command failed to produce an HTTP status code. Check curl output above."
                SHOULD_CONTINUE_LOOP=false
            else
                handle_other_error "$HTTP_STATUS_CODE"
            fi
            ;;
    esac
done
# === END OF MAIN LOOP ===

final_elapsed_str=$(get_formatted_elapsed_time)
echo "Script finished."
