(() => {
  const ACTIONS = Object.freeze({
    markdown: "Copy Markdown",
    notion: "Copy for Notion",
    pdf: "Export PDF"
  });
  let adapter = null;
  let enabled = false;
  let availableActions = Object.keys(ACTIONS);
  let defaultAction = "markdown";
  let onAction = null;
  let mounted = new Map();
  let frame = 0;
  let active = null;
  let lastObservation = statusObservation("MISSING", "not_configured");

  function configure(options = {}) {
    adapter = options.adapter || null;
    enabled = options.enabled === true;
    availableActions = sanitizeActions(options.actions);
    defaultAction = availableActions.includes(options.defaultAction) ? options.defaultAction : availableActions[0] || null;
    onAction = typeof options.onAction === "function" ? options.onAction : null;
    removeAll();
    if (enabled && availableActions.length > 0) scheduleReconcile();
    else lastObservation = statusObservation("MISSING", enabled ? "no_available_actions" : "disabled");
    return getStatus();
  }

  function updateSettings(options = {}) {
    enabled = options.enabled === true;
    availableActions = sanitizeActions(options.actions);
    defaultAction = availableActions.includes(options.defaultAction) ? options.defaultAction : availableActions[0] || null;
    if (!enabled || availableActions.length === 0) {
      removeAll();
      lastObservation = statusObservation("MISSING", enabled ? "no_available_actions" : "disabled");
    }
    else {
      removeAll();
      scheduleReconcile();
    }
    return getStatus();
  }

  function sanitizeActions(actions) {
    const input = Array.isArray(actions) ? actions : Object.keys(ACTIONS);
    return [...new Set(input.filter((action) => Object.hasOwn(ACTIONS, action)))];
  }

  function scheduleReconcile() {
    if (!enabled || frame || typeof requestAnimationFrame !== "function") return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      reconcile();
    });
  }

  function reconcile(doc = document) {
    if (!enabled || !adapter?.inspectAnswerActionTargets || availableActions.length === 0) {
      removeAll();
      lastObservation = statusObservation("MISSING", enabled ? "action_backend_unavailable" : "disabled");
      return getStatus();
    }
    const observation = adapter.inspectAnswerActionTargets(doc);
    if (observation?.evidenceClass !== "EXACT") {
      removeAll();
      lastObservation = statusObservation(observation?.evidenceClass || "MISSING", observation?.reason || "target_unavailable");
      return getStatus();
    }
    const targets = Array.isArray(observation.targets) ? observation.targets : [];
    const exactTargets = targets.filter((target) => validTarget(target, doc));
    const keys = new Set(exactTargets.map((target) => target.turnId));
    if (exactTargets.length !== targets.length || keys.size !== exactTargets.length) {
      removeAll();
      lastObservation = statusObservation("AMBIGUOUS", "target_revalidation_failed");
      return getStatus();
    }
    for (const [turnId, entry] of mounted) {
      if (!keys.has(turnId) || !entry.host.isConnected) removeEntry(turnId, entry);
    }
    for (const target of exactTargets) {
      const current = mounted.get(target.turnId);
      if (current && current.target.action === target.action && current.target.cluster === target.cluster && current.host.isConnected) continue;
      if (current) removeEntry(target.turnId, current);
      mountTarget(target, doc);
    }
    lastObservation = statusObservation("EXACT", "contract_match");
    return getStatus();
  }

  function validTarget(target, doc) {
    return target?.evidenceClass === "EXACT"
      && typeof target.turnId === "string"
      && target.turnId.length > 0
      && target.action instanceof HTMLElement
      && target.cluster instanceof HTMLElement
      && target.cluster.contains(target.action)
      && target.cluster.ownerDocument === doc
      && doc.contains(target.cluster);
  }

  function mountTarget(target, doc) {
    const host = doc.createElement("span");
    host.dataset.micaUi = "answer-actions";
    host.dataset.micaTurnId = target.turnId;
    const shadow = host.attachShadow({ mode: "open" });
    const style = doc.createElement("style");
    style.textContent = `
      :host{position:relative;display:inline-flex;vertical-align:middle;font:500 13px/1.25 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#202624}
      button{font:inherit;color:inherit}
      .trigger{display:grid;place-items:center;width:32px;height:32px;padding:0;border:0;border-radius:8px;background:transparent;cursor:pointer}
      .trigger:hover,.trigger[aria-expanded="true"]{background:rgba(127,127,127,.13)}
      .trigger:focus-visible,.menu button:focus-visible{outline:2px solid #0b766b;outline-offset:2px}
      .mark{font-size:12px;font-weight:750;letter-spacing:-.02em}
      .menu{position:absolute;z-index:2147483645;right:0;bottom:calc(100% + 6px);display:grid;min-width:172px;padding:5px;border:1px solid rgba(32,38,36,.16);border-radius:11px;background:#fff;box-shadow:0 12px 30px rgba(0,0,0,.16)}
      .menu[hidden]{display:none}
      .menu button{border:0;border-radius:7px;padding:8px 10px;background:transparent;text-align:left;cursor:pointer;white-space:nowrap}
      .menu button:hover{background:rgba(11,118,107,.09)}
      .status{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
      @media(prefers-color-scheme:dark){:host{color:#eef4f1}.menu{border-color:rgba(238,244,241,.2);background:#171d1b;box-shadow:0 12px 30px rgba(0,0,0,.42)}}
      @media(prefers-reduced-motion:reduce){*{transition:none!important}}
    `;
    const trigger = doc.createElement("button");
    trigger.type = "button";
    trigger.className = "trigger";
    trigger.title = "Mica actions";
    trigger.setAttribute("aria-label", "Mica actions");
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    const mark = doc.createElement("span");
    mark.className = "mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = "M";
    trigger.append(mark);
    const menu = doc.createElement("div");
    menu.className = "menu";
    menu.setAttribute("role", "menu");
    menu.hidden = true;
    const orderedActions = [defaultAction, ...availableActions].filter((value, index, values) => value && values.indexOf(value) === index);
    for (const action of orderedActions) {
      const button = doc.createElement("button");
      button.type = "button";
      button.dataset.action = action;
      button.setAttribute("role", "menuitem");
      button.textContent = ACTIONS[action];
      menu.append(button);
    }
    const status = doc.createElement("span");
    status.className = "status";
    status.setAttribute("role", "status");
    shadow.append(style, trigger, menu, status);
    const entry = { target, host, shadow, trigger, menu, status, doc };
    trigger.addEventListener("click", (event) => {
      if (!event.isTrusted) return;
      event.stopPropagation();
      if (menu.hidden) openMenu(entry);
      else closeMenu(entry, true);
    });
    menu.addEventListener("click", (event) => {
      if (!event.isTrusted) return;
      const button = event.target instanceof HTMLButtonElement && event.target.dataset.action ? event.target : null;
      if (!button || !menu.contains(button)) return;
      event.stopPropagation();
      const action = button.dataset.action;
      if (!availableActions.includes(action) || typeof onAction !== "function") return;
      const outcome = onAction({ turnId: target.turnId, action, evidenceClass: "EXACT" });
      closeMenu(entry, true);
      Promise.resolve(outcome).then((ok) => {
        status.textContent = ok === true ? `${ACTIONS[action]} complete.` : `${ACTIONS[action]} unavailable.`;
      }).catch(() => { status.textContent = `${ACTIONS[action]} unavailable.`; });
    });
    shadow.onkeydown = (event) => {
      if (event.key !== "Escape" || menu.hidden) return;
      event.preventDefault();
      event.stopPropagation();
      closeMenu(entry, true);
    };
    target.cluster.insertBefore(host, target.action.nextSibling);
    mounted.set(target.turnId, entry);
  }

  function openMenu(entry) {
    if (active && active !== entry) closeMenu(active, false);
    active = entry;
    entry.menu.hidden = false;
    entry.trigger.setAttribute("aria-expanded", "true");
    entry.doc.addEventListener("pointerdown", handleOutsidePointer, true);
    entry.menu.firstElementChild?.focus();
  }

  function handleOutsidePointer(event) {
    if (!active) return;
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    if (!path.includes(active.host)) closeMenu(active, true);
  }

  function closeMenu(entry, returnFocus) {
    if (!entry) return;
    entry.menu.hidden = true;
    entry.trigger.setAttribute("aria-expanded", "false");
    entry.doc.removeEventListener("pointerdown", handleOutsidePointer, true);
    if (active === entry) active = null;
    if (returnFocus && entry.host.isConnected) entry.trigger.focus();
  }

  function onContextChanged() {
    removeAll();
    lastObservation = statusObservation("MISSING", "context_changed");
    scheduleReconcile();
  }

  function removeEntry(turnId, entry) {
    if (active === entry) closeMenu(entry, false);
    entry.host.remove();
    mounted.delete(turnId);
  }

  function removeAll() {
    if (frame && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
    frame = 0;
    for (const [turnId, entry] of [...mounted]) removeEntry(turnId, entry);
  }

  function statusObservation(evidenceClass, reason) {
    return { evidenceClass, reason, textIncluded: false };
  }

  function getStatus() {
    return {
      enabled,
      availableActions: [...availableActions],
      defaultAction,
      evidenceClass: lastObservation.evidenceClass,
      reason: lastObservation.reason,
      mountedCount: mounted.size,
      permanentButtonsPerAnswer: 1,
      textIncluded: false
    };
  }

  globalThis.MicaAnswerActionsController = Object.freeze({ configure, updateSettings, scheduleReconcile, reconcile, onContextChanged, getStatus });
})();
