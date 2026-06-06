// Self-hosted @font-face. The font files live under the extension root at
// assets/fonts/ and are listed in web_accessible_resources. The extension id
// is unknown at build time, so the URL is interpolated at runtime from the
// baseUrl (chrome.runtime.getURL("")). CJK falls back to system PingFang/Noto
// via the --font stack in tokens.css; only the Latin faces are self-hosted.

export function fontFaceCss(baseUrl: string): string {
  const url = (file: string): string => `${baseUrl}assets/fonts/${file}`;
  return `
@font-face{
  font-family:"Space Grotesk";
  font-style:normal;
  font-weight:400 700;
  font-display:swap;
  src:url("${url("space-grotesk.woff2")}") format("woff2");
}
@font-face{
  font-family:"JetBrains Mono";
  font-style:normal;
  font-weight:400 700;
  font-display:swap;
  src:url("${url("jetbrains-mono.woff2")}") format("woff2");
}
`;
}
