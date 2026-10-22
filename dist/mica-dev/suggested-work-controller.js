(() => {
  let adapter = null;
  let enabled = false;
  let frame = 0;
  let activeSurface = null;
  let originalState = null;
  let lastStatus = status("disabled", "feature_disabled");

  function configure(options = {}) {
    adapter = options.adapter || adapter;
    enabled = options.enabled === true;
    if (enabled) scheduleReconcile();
    else restoreActiveSurface("feature_disabled");
    return getStatus();
  }

  function updateSettings(options = {}) {
    enabled = options.enabled === true;
    if (enabled) scheduleReconcile();
    else restoreActiveSurface("feature_disabled");
    return getStatus();
  }

  function scheduleReconcile() {
    if (!enabled || frame || typeof requestAnimationFrame !== "function") return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      reconcile();
    });
  }

  function reconcile() {
    if (!enabled || !adapter?.inspectSuggestedWorkSurface) {
      restoreActiveSurface(enabled ? "adapter_unavailable" : "feature_disabled");
      return getStatus();
    }
    const observation = adapter.inspectSuggestedWorkSurface(document);
    const surface = observation?.evidenceClass === "EXACT" ? observation.surface : null;
    if (!(surface instanceof HTMLElement)) {
      restoreActiveSurface(observation?.reason || "contract_not_exact");
      lastStatus = status("native", observation?.reason || "contract_not_exact", {
        enabled: true,
        detected: Number(observation?.candidateCount) > 0,
        evidenceClass: observation?.evidenceClass || "MISSING",
        detectionSource: observation?.detectionSource || "none",
        variantId: observation?.variantId || "unproven-v1"
      });
      return getStatus();
    }
    if (activeSurface && activeSurface !== surface) restoreActiveSurface("surface_replaced");
    if (activeSurface !== surface) hideSurface(surface);
    lastStatus = status("hidden", "exact_contract_match", {
      enabled: true,
      detected: true,
      hidden: true,
      evidenceClass: "EXACT",
      detectionSource: observation.detectionSource,
      variantId: observation.variantId
    });
    return getStatus();
  }

  function hideSurface(surface) {
    originalState = {
      hidden: surface.hidden === true,
      hadHiddenAttribute: surface.hasAttribute("hidden"),
      hadInertAttribute: surface.hasAttribute("inert"),
      inertValue: surface.getAttribute("inert"),
      hadAriaHidden: surface.hasAttribute("aria-hidden"),
      ariaHiddenValue: surface.getAttribute("aria-hidden")
    };
    activeSurface = surface;
    surface.hidden = true;
    surface.setAttribute("hidden", "");
    surface.setAttribute("inert", "");
    surface.setAttribute("aria-hidden", "true");
    surface.setAttribute("data-mica-suggested-work-hidden", "true");
  }

  function restoreActiveSurface(reason = "restored") {
    if (activeSurface && originalState) {
      activeSurface.hidden = originalState.hidden;
      restoreAttribute(activeSurface, "hidden", originalState.hadHiddenAttribute, "");
      restoreAttribute(activeSurface, "inert", originalState.hadInertAttribute, originalState.inertValue);
      restoreAttribute(activeSurface, "aria-hidden", originalState.hadAriaHidden, originalState.ariaHiddenValue);
      activeSurface.removeAttribute("data-mica-suggested-work-hidden");
    }
    activeSurface = null;
    originalState = null;
    lastStatus = status(enabled ? "native" : "disabled", reason, { enabled });
  }

  function restoreAttribute(element, name, existed, value) {
    if (!existed) element.removeAttribute(name);
    else element.setAttribute(name, value ?? "");
  }

  function getStatus() {
    return { ...lastStatus };
  }

  function status(state, reason, extra = {}) {
    return {
      state,
      reason,
      enabled,
      detected: false,
      hidden: false,
      evidenceClass: "MISSING",
      detectionSource: "none",
      variantId: "unproven-v1",
      textIncluded: false,
      ...extra
    };
  }

  globalThis.MicaSuggestedWorkController = Object.freeze({ configure, updateSettings, scheduleReconcile, reconcile, getStatus });
})();
