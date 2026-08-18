// Console Billing — desk UI.
// Reads frappe.boot.console_billing (injected by console_billing.billing.boot):
//   { enabled, suspended, days_left, end_date, contact, ... }
// While active: a navbar pill showing the next billing date + days left.
// While suspended: a full-screen "Bill not Paid" block over the desk.
//
// This is the client-side layer (custom message). Un-bypassable enforcement is
// the console's job (console_billing_hard_lock / maintenance-mode), server-side.

(function () {
	function state() {
		return (frappe && frappe.boot && frappe.boot.console_billing) || null;
	}

	// Only allow safe schemes into an href — never javascript:/data:.
	function safeUrl(u) {
		return u && /^(https?|upi|tel|mailto):/i.test(u) ? u : "";
	}

	function money(cb) {
		if (!cb.amount) return "";
		var sym = {
			INR: "₹", USD: "$", EUR: "€", GBP: "£",
			AED: "AED ", SAR: "SAR ", QAR: "QAR ", OMR: "OMR ", KWD: "KWD ", BHD: "BHD ",
		}[String(cb.currency || "").toUpperCase()] || (cb.currency ? cb.currency + " " : "");
		return sym + cb.amount;
	}

	function fmtDate(iso) {
		// iso is "YYYY-MM-DD"; render as e.g. "12 Sep 2026"
		try {
			var d = frappe.datetime.str_to_obj(iso);
			return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
		} catch (e) {
			return iso;
		}
	}

	function ensureStyles() {
		if (document.getElementById("cb-styles")) return;
		var css = ""
			+ "#cb-pill{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;margin:0 8px;"
			+ "border-radius:13px;font-size:12px;font-weight:600;white-space:nowrap;line-height:1;"
			+ "background:var(--bg-green,#e6f4ea);color:var(--text-green,#0f7a3d);border:1px solid rgba(0,0,0,.06)}"
			+ "#cb-pill.cb-warn{background:#fef3e2;color:#9a5b00}"
			+ "#cb-pill.cb-danger{background:#fdecec;color:#b42318}"
			+ "#cb-renew-nav{display:inline-flex;align-items:center;height:26px;padding:0 12px;margin:0 4px;"
			+ "border-radius:13px;font-size:12px;font-weight:600;white-space:nowrap;line-height:1;text-decoration:none;"
			+ "background:#0f7a3d;color:#fff;cursor:pointer}"
			+ "#cb-renew-nav:hover{background:#0c6432;color:#fff}"
			+ "#cb-block{position:fixed;inset:0;z-index:2147483000;background:rgba(20,24,28,.94);"
			+ "display:flex;align-items:center;justify-content:center;padding:24px}"
			+ "#cb-block .cb-card{max-width:520px;width:100%;background:#fff;border-radius:16px;padding:36px 32px;"
			+ "text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.4);font-family:inherit}"
			+ "#cb-block h1{font-size:22px;margin:0 0 10px;color:#b42318}"
			+ "#cb-block p{font-size:15px;color:#3b4148;margin:6px 0;line-height:1.5}"
			+ "#cb-block .cb-contact{margin-top:18px;font-size:14px;color:#111}"
			+ "#cb-renew{display:inline-block;margin-top:22px;padding:11px 22px;border-radius:10px;"
			+ "background:#0f7a3d;color:#fff;font-size:15px;font-weight:600;text-decoration:none;cursor:pointer}"
			+ "#cb-renew:hover{background:#0c6432}"
			+ "#cb-pill.cb-link{cursor:pointer}";
		var s = document.createElement("style");
		s.id = "cb-styles";
		s.textContent = css;
		document.head.appendChild(s);
	}

	function showBlock(cb) {
		if (document.getElementById("cb-block")) return;
		ensureStyles();
		var contact = cb.contact
			? '<div class="cb-contact">Contact: ' + frappe.utils.escape_html(cb.contact) + "</div>"
			: "";
		var m = money(cb);
		var amountDue = m ? '<p class="cb-amount">Amount due: <strong>' + frappe.utils.escape_html(m) + "</strong></p>" : "";
		var el = document.createElement("div");
		el.id = "cb-block";
		el.innerHTML =
			'<div class="cb-card">' +
			"<h1>Site is suspended — Bill not Paid</h1>" +
			"<p>This site has been suspended because the subscription bill is unpaid.</p>" +
			amountDue +
			"<p>Please clear the outstanding payment to restore access.</p>" +
			contact +
			"</div>";
		document.body.appendChild(el);
		// Renew CTA — href set as a property (not innerHTML) after scheme check,
		// so a hostile URL can neither inject markup nor a javascript: scheme.
		var url = safeUrl(cb.renew_url);
		if (url) {
			var a = document.createElement("a");
			a.id = "cb-renew";
			a.textContent = "Renew Subscription";
			a.href = url;
			a.target = "_blank";
			a.rel = "noopener noreferrer";
			el.querySelector(".cb-card").appendChild(a);
		}
	}

	function removePill() {
		["cb-pill", "cb-renew-nav"].forEach(function (id) {
			var el = document.getElementById(id);
			if (el && el.parentNode) el.parentNode.removeChild(el);
		});
	}

	function pillLabel(cb) {
		var d = cb.days_left;
		if (d < 0) return "Your subscription expired on " + fmtDate(cb.end_date);
		if (d === 0) return "Your subscription expires today";
		return "Your subscription expires on " + fmtDate(cb.end_date) + " — " + d + (d === 1 ? " day remaining" : " days remaining");
	}

	function showPill(cb) {
		if (cb.days_left === null || cb.days_left === undefined) return;
		ensureStyles();
		var nav = document.querySelector("header.navbar .navbar-nav")
			|| document.querySelector("header.navbar .container")
			|| document.querySelector("header.navbar");
		if (!nav) return false;
		removePill();
		var cls = cb.days_left < 0 ? "cb-danger" : cb.days_left <= 7 ? "cb-warn" : "";
		var pill = document.createElement("span");
		pill.id = "cb-pill";
		if (cls) pill.className = cls;
		pill.textContent = pillLabel(cb);
		nav.insertBefore(pill, nav.firstChild);
		// "Renew Subscription" link right after the text (scheme-checked href).
		var url = safeUrl(cb.renew_url);
		if (url) {
			var a = document.createElement("a");
			a.id = "cb-renew-nav";
			a.textContent = "Renew Subscription";
			a.href = url;
			a.target = "_blank";
			a.rel = "noopener noreferrer";
			nav.insertBefore(a, pill.nextSibling);
		}
		return true;
	}

	function apply() {
		var cb = state();
		if (!cb || !cb.enabled) return;
		if (cb.suspended) {
			showBlock(cb);
			return;
		}
		// Retry a few times until the navbar exists (desk renders async).
		if (showPill(cb) === false) {
			var tries = 0;
			var t = setInterval(function () {
				tries++;
				if (showPill(cb) !== false || tries > 40) clearInterval(t);
			}, 250);
		}
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", apply);
	} else {
		apply();
	}
})();
