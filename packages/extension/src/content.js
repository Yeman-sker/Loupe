const ROOT_ID = "loupe-phase-0-placeholder";

if (!document.getElementById(ROOT_ID)) {
  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.hidden = true;
  root.dataset.loupePhase = "phase_0_placeholder";
  root.dataset.exposesTokenToPage = "false";
  root.dataset.exposesPageWindowApi = "false";

  const shadow = root.attachShadow({ mode: "closed" });
  const marker = document.createElement("span");
  marker.textContent = "Loupe Phase 0 placeholder";
  shadow.append(marker);

  (document.documentElement ?? document).append(root);
}
