try {
  document.documentElement.dataset.theme = localStorage.getItem("sideband.theme") || "night";
} catch {
  document.documentElement.dataset.theme = "night";
}
