// Login / website banner. When the subscription is suspended, show a red top
// banner explaining why the user was logged out, with a Renew link. Guest-safe:
// reads console_billing.billing.public_state (only expiry + the public renew URL).
(function () {
	function safeUrl(u) {
		return u && /^(https?|upi|tel|mailto):/i.test(u) ? u : "";
	}
	function fmtDate(iso) {
		try {
			var p = String(iso).split("-");
			return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
		} catch (e) {
			return iso;
		}
	}
	function show(cb) {
		if (!cb || !cb.enabled || !cb.suspended) return;
		if (document.getElementById("cb-web-banner")) return;
		var css = "#cb-web-banner{position:fixed;top:0;left:0;right:0;z-index:2147483000;background:#fdecec;"
			+ "color:#b42318;padding:12px 16px;text-align:center;font-size:14px;font-weight:600;font-family:inherit;"
			+ "box-shadow:0 1px 4px rgba(0,0,0,.12)}"
			+ "#cb-web-banner a{display:inline-block;margin-left:12px;padding:5px 14px;border-radius:8px;"
			+ "background:#0f7a3d;color:#fff;text-decoration:none;font-weight:600}";
		var st = document.createElement("style");
		st.textContent = css;
		document.head.appendChild(st);
		var msg = cb.end_date ? "Your subscription expired on " + fmtDate(cb.end_date) : "Your subscription has expired";
		var el = document.createElement("div");
		el.id = "cb-web-banner";
		el.textContent = msg + ". ";
		var url = safeUrl(cb.renew_url);
		if (url) {
			var a = document.createElement("a");
			a.textContent = "Renew Subscription";
			a.href = url;
			a.target = "_blank";
			a.rel = "noopener noreferrer";
			el.appendChild(a);
		}
		document.body.appendChild(el);
		document.body.style.paddingTop = (el.offsetHeight || 48) + "px";
	}
	// GET on a whitelisted allow_guest method — no CSRF needed.
	fetch("/api/method/console_billing.billing.public_state")
		.then(function (r) { return r.json(); })
		.then(function (d) { show(d && d.message); })
		.catch(function () {});
})();
