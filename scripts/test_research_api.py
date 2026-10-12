#!/usr/bin/env python3
"""Send a controlled multi-source research request to the deployed Serena API."""

from __future__ import annotations

import getpass
import json
import os
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

API_URL = "https://serena-imperiokdbs-projects.vercel.app/v1/research-tasks"


def main() -> int:
    api_key = os.environ.get("SERENA_API_KEY") or getpass.getpass(
        "Enter your SERENA_API_KEY (input hidden): "
    )
    if not api_key.strip():
        print("Error: no API key was provided.", file=sys.stderr)
        return 2

    payload = {
        "request": "Compare the information presented by these public sources.",
        "sources": [
            "https://example.com",
            "https://www.iana.org/domains/example",
        ],
        "timeoutMs": 15000,
    }
    request = Request(
        API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key.strip()}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=90) as response:
            body = response.read().decode("utf-8")
            print(f"HTTP {response.status}")
            print(json.dumps(json.loads(body), indent=2))
            return 0
    except HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        print(f"HTTP {error.code}")
        try:
            print(json.dumps(json.loads(body), indent=2))
        except json.JSONDecodeError:
            print(body)
        return 1
    except URLError as error:
        print(f"Network error: {error.reason}", file=sys.stderr)
        return 1
    except TimeoutError:
        print("Network error: request timed out.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
