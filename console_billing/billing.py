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
    amount = str(conf.get("console_billing_amount") or "").strip()      # e.g. "30.00"
    currency = str(conf.get("console_billing_currency") or "").strip()  # e.g. "INR"
    renew_url = str(conf.get("console_billing_renew_url") or "").strip()  # pay/contact link

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
        "amount": amount,
        "currency": currency,
        "renew_url": renew_url,
    }


def boot(bootinfo):
    """extend_bootinfo hook — expose billing state to the desk as
    frappe.boot.console_billing. Never breaks boot if something is off."""
    try:
        bootinfo.console_billing = get_state()
    except Exception:
        frappe.log_error(title="console_billing boot failed")


@frappe.whitelist(allow_guest=True)
def public_state():
    """Guest-safe subset for the LOGIN page banner. Exposes only the expiry +
    the (already-public) renew link — never contact/amount/currency/hard_lock."""
    try:
        s = get_state()
        return {
            "enabled": s["enabled"],
            "suspended": s["suspended"],
            "end_date": s["end_date"],
            "days_left": s["days_left"],
            "renew_url": s["renew_url"],
        }
    except Exception:
        return {"enabled": False}


# Paths that must stay reachable when suspended, so a logged-out user can still
# see + submit the login page, reset a password, and load static assets.
_ALLOW_PREFIXES = (
    "/assets/",
    "/login",
    "/api/method/login",
    "/api/method/logout",
    "/api/method/frappe.core.doctype.user.user.reset_password",
    "/api/method/frappe.www.contact",
    "/update-password",
)


def enforce():
    """before_request hook — when the subscription is suspended/expired, log the
    signed-in user OUT. Frappe's own desk route then redirects Guests to /login
    (www/app.py), so an expired site can't be used and the user lands on login.

    Guests are left alone (the login page + login API must work), allow-listed
    paths are skipped, and any error fails OPEN so a bug can never lock a site."""
    try:
        request = getattr(frappe.local, "request", None)
        if request is None:
            return
        if not get_state()["suspended"]:
            return
        session = getattr(frappe, "session", None)
        user = getattr(session, "user", None) if session else None
        if not user or user == "Guest":
            return  # already blocked; let the login page + login proceed
        path = request.path or ""
        if path.startswith(_ALLOW_PREFIXES):
            return
        frappe.local.login_manager.logout()
        frappe.db.commit()
    except Exception:
        # Enforcement must never itself break the site; fail open + log.
        frappe.log_error(title="console_billing enforce (logout) failed")
