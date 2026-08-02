(function initOfferApi(global) {
  function configuredBaseUrl() {
    return String(global.OFFER_API_BASE_URL || "").trim().replace(/\/+$/, "");
  }

  function apiUrl(path) {
    const normalizedPath = String(path || "");
    if (!normalizedPath.startsWith("/api/")) return normalizedPath;
    const baseUrl = configuredBaseUrl();
    return baseUrl ? `${baseUrl}${normalizedPath}` : normalizedPath;
  }

  function apiFetch(path, options) {
    return global.fetch(apiUrl(path), options);
  }

  global.offerApi = { apiUrl, apiFetch };
})(window);
