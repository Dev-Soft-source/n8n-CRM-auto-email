const STORAGE_KEY = "n8n_lead_webhook_url";
const STORAGE_USE_PROXY = "n8n_lead_use_server_proxy";

const PROXY_PATH = "/api/submit-lead";

/** Same pattern as n8n Code node validation in the guide */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function $(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
}

function loadWebhookUrl() {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveWebhookUrl(url) {
  try {
    localStorage.setItem(STORAGE_KEY, url.trim());
  } catch {
    /* ignore */
  }
}

function loadUseProxy() {
  try {
    const v = localStorage.getItem(STORAGE_USE_PROXY);
    if (v === "0") return false;
    if (v === "1") return true;
  } catch {
    /* ignore */
  }
  if (typeof location !== "undefined") {
    const h = location.hostname;
    if (h === "localhost" || h === "127.0.0.1") return true;
  }
  return false;
}

function saveUseProxy(on) {
  try {
    localStorage.setItem(STORAGE_USE_PROXY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function validate(name, email) {
  const nameValid = name.trim().length > 0;
  const emailValid = EMAIL_RE.test(email.trim());
  let validationError = "";
  if (!nameValid) validationError = "Missing name";
  else if (!emailValid) validationError = "Invalid email";
  return { nameValid, emailValid, isValid: nameValid && emailValid, validationError };
}

function setFieldErrors(nameValid, emailValid) {
  const nameErr = $("nameError");
  const emailErr = $("emailError");
  if (!nameValid) {
    nameErr.textContent = "Name is required.";
    nameErr.hidden = false;
  } else {
    nameErr.hidden = true;
  }
  if (!emailValid) {
    emailErr.textContent = $("email").value.trim() ? "Invalid email format." : "Email is required.";
    emailErr.hidden = false;
  } else {
    emailErr.hidden = true;
  }
}

function showFormMessage(text, variant) {
  const box = $("formMessage");
  box.textContent = text;
  box.dataset.variant = variant;
  box.hidden = false;
}

function hideFormMessage() {
  const box = $("formMessage");
  box.hidden = true;
  box.textContent = "";
  delete box.dataset.variant;
}

/** n8n often returns an HTML help page (404 / “not listening”) instead of JSON */
function n8nHtmlErrorHint(bodyPreview) {
  if (!bodyPreview || typeof bodyPreview !== "string") return "";
  const head = bodyPreview.slice(0, 12000);
  if (!/<!DOCTYPE html/i.test(head) && !/<html[\s>]/i.test(head)) return "";
  const titleM = head.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleM ? titleM[1].replace(/\s+/g, " ").trim() : "";
  const looksListening =
    /isn['’]t listening|not listening|listen for test|waiting for test|test event|webhook.*listen/i.test(
      head
    );
  if (!looksListening && !/form trigger|webhook/i.test(head)) return "";

  const bits = [];
  if (title) bits.push(`(${title})`);
  bits.push(
    "Use the URL from a Webhook node (POST), not a Form Trigger. If the path contains webhook-test: in n8n open the workflow, select the Webhook node, and start “Listen for test event” before each test submit."
  );
  bits.push(
    "If the path contains /webhook/ (no -test): activate the workflow with the editor toggle, then use the production webhook URL from the node."
  );
  return " " + bits.join(" ");
}

function buildPayload() {
  return {
    name: $("name").value.trim(),
    email: $("email").value.trim().toLowerCase(),
    phone: $("phone").value.trim() || "",
    company: $("company").value.trim() || "",
    message: $("message").value.trim() || "",
    source: $("source").value.trim() || "Website Contact Form",
  };
}

function init() {
  const webhookInput = $("webhookUrl");
  const useProxyEl = $("useProxy");
  webhookInput.value = loadWebhookUrl();
  useProxyEl.checked = loadUseProxy();
  webhookInput.addEventListener("change", () => saveWebhookUrl(webhookInput.value));
  useProxyEl.addEventListener("change", () => saveUseProxy(useProxyEl.checked));

  $("fillSample").addEventListener("click", () => {
    $("name").value = "John Smith";
    $("email").value = "john@example.com";
    $("phone").value = "+15551234567";
    $("company").value = "ABC Company";
    $("message").value = "I want a quote";
    $("source").value = "Website Contact Form";
    hideFormMessage();
    setFieldErrors(true, true);
  });

  $("leadForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    hideFormMessage();

    if ($("website").value.trim() !== "") {
      showFormMessage("Submission ignored (spam check).", "info");
      return;
    }

    const payload = buildPayload();
    const { nameValid, emailValid, isValid, validationError } = validate(payload.name, payload.email);
    setFieldErrors(nameValid, emailValid);
    if (!isValid) {
      showFormMessage(validationError, "error");
      return;
    }

    const webhookUrl = webhookInput.value.trim();
    if (!webhookUrl) {
      showFormMessage("Set the n8n webhook URL above before submitting.", "error");
      webhookInput.focus();
      return;
    }

    let parsed;
    try {
      parsed = new URL(webhookUrl);
    } catch {
      showFormMessage("Webhook URL is not a valid URL.", "error");
      return;
    }
    if (!/^https?:$/i.test(parsed.protocol)) {
      showFormMessage("Webhook URL must start with http:// or https://.", "error");
      return;
    }

    const btn = $("submitBtn");
    const useProxy = useProxyEl.checked;
    btn.disabled = true;
    saveWebhookUrl(webhookUrl);
    saveUseProxy(useProxy);

    try {
      if (useProxy) {
        const response = await fetch(PROXY_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ webhookUrl, payload }),
        });

        const data = await response.json().catch(() => ({}));

        if (response.status === 404) {
          showFormMessage(
            `No proxy here (${response.status}). Run the app server from the test-web-app folder: npm start`,
            "error"
          );
        } else if (!response.ok) {
          const detail = data.error ? String(data.error) : JSON.stringify(data);
          showFormMessage(`Proxy error (${response.status}): ${detail}`, "error");
        } else if (data.error) {
          showFormMessage(`Proxy error: ${data.error}`, "error");
        } else if (data.ok) {
          let preview = data.bodyPreview ? String(data.bodyPreview).slice(0, 500) : "";
          if (data.truncated) preview += "…";
          showFormMessage(
            `Lead submitted successfully (n8n returned ${data.upstreamStatus}).` +
              (preview ? ` Response: ${preview}` : ""),
            "success"
          );
        } else {
          const raw = data.bodyPreview ? String(data.bodyPreview) : "";
          let preview = raw.slice(0, 500);
          if (data.truncated || raw.length > 500) preview += "…";
          const hint = n8nHtmlErrorHint(raw);
          showFormMessage(
            `n8n responded ${data.upstreamStatus} ${data.upstreamStatusText || ""}.` +
              (preview ? ` Body: ${preview}` : "") +
              hint,
            "error"
          );
        }
      } else {
        const response = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const rawText = await response.text();
        let preview = rawText.slice(0, 500);
        if (rawText.length > 500) preview += "…";

        if (response.ok) {
          showFormMessage(
            `Lead submitted successfully (${response.status}).` +
              (preview ? ` Response: ${preview}` : ""),
            "success"
          );
        } else {
          showFormMessage(
            `Request failed (${response.status} ${response.statusText}).` +
              (preview ? ` Body: ${preview}` : "") +
              n8nHtmlErrorHint(rawText),
            "error"
          );
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const hint = useProxy
        ? " Check that npm start is running and nothing blocks localhost."
        : " Typical fix: enable “server proxy” and run npm start in test-web-app (n8n webhooks rarely allow browser CORS). Also verify SSL and the webhook URL.";
      showFormMessage(`Network error: ${msg}.${hint}`, "error");
    } finally {
      btn.disabled = false;
    }
  });
}

init();
