"""Console Billing — reads per-site billing state that the Frappe Console pushes
into site_config.json via `bench set-config`, and exposes it to the desk.

Config keys (all optional; absence = feature off, site behaves normally):
    console_billing_status      "active" | "suspended" | ""   (explicit override)
    console_billing_end_date    "YYYY-MM-DD"   drives the countdown + auto-suspend
    console_billing_start_date  "YYYY-MM-DD"   informational
    console_billing_contact     free text shown on the suspended screen
    console_billing_hard_lock   0 | 1   when suspended, also block server-side

Suspension precedence (see get_state):
    status == "suspended"            -> suspended (explicit)
    status == "active"               -> NOT suspended (explicit grant, overrides date)
    else, end_date set and past      -> suspended (auto, no cron dependency)
    else                             -> active
"""

import frappe
from frappe.utils import getdate, nowdate


def _conf():
    # frappe.local.conf is the merged site + common config; may be missing very
    # early in a request, so guard the caller.
    return getattr(frappe.local, "conf", None) or {}


def get_state():
    conf = _conf()
    status = str(conf.get("console_billing_status") or "").strip().lower()
    end_raw = conf.get("console_billing_end_date")
    start_raw = conf.get("console_billing_start_date")
    contact = str(conf.get("console_billing_contact") or "").strip()
    hard_lock = bool(conf.get("console_billing_hard_lock"))

    end_date = None
    days_left = None
    if end_raw:
        try:
            end_date = getdate(end_raw)
            days_left = (end_date - getdate(nowdate())).days
        except Exception:
            end_date = None
            days_left = None

    if status == "suspended":
        suspended = True
    elif status == "active":
        suspended = False
    elif end_date is not None:
        suspended = days_left is not None and days_left < 0
    else:
        suspended = False

    return {
        # feature is only "on" once the console has pushed a date or status
        "enabled": bool(end_raw) or bool(status),
        "status": status,
        "start_date": str(getdate(start_raw)) if start_raw else None,
        "end_date": str(end_date) if end_date else None,
        "days_left": days_left,
        "suspended": suspended,
        "hard_lock": hard_lock,
        "contact": contact,
    }


def boot(bootinfo):
    """extend_bootinfo hook — expose billing state to the desk as
    frappe.boot.console_billing. Never breaks boot if something is off."""
    try:
        bootinfo.console_billing = get_state()
    except Exception:
        frappe.log_error(title="console_billing boot failed")


# Paths that must stay reachable even when hard-locked, so the operator/console
# can still recover the site and static assets can load.
_ALLOW_PREFIXES = (
    "/assets/",
    "/api/method/logout",
    "/api/method/frappe.utils.change_log",
    "/api/method/frappe.core.doctype.user.user.reset_password",
)


def enforce():
    """before_request hook — OPT-IN server-side hard lock. Only fires when the
    site is suspended AND console_billing_hard_lock is set. Uses Frappe's own
    SessionStopped path (a reliable 503), so it never 500s the request.

    Without hard_lock the desk still loads and the client-side overlay shows the
    custom 'Bill not Paid' message instead."""
    try:
        request = getattr(frappe.local, "request", None)
        if request is None:
            return
        state = get_state()
        if not (state["suspended"] and state["hard_lock"]):
            return
        path = request.path or ""
        if path.startswith(_ALLOW_PREFIXES):
            return
        raise frappe.SessionStopped("Site suspended — Bill not Paid")
    except frappe.SessionStopped:
        raise
    except Exception:
        # Enforcement must never itself break the site; fail open + log.
        frappe.log_error(title="console_billing enforce failed")
