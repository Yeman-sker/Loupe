import type { Metadata } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
// Canonical token layer — the single source of truth, shared verbatim from the
// design prototypes. Defines [data-theme="light|dark"] variables.
import "../../../docs/ui-ux/prototypes/loupe-tokens.css";
import "./globals.css";
import { LandingProvider } from "../components/context";

const sans = Space_Grotesk({ subsets: ["latin"], variable: "--ng-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--ng-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Loupe — Point at the DOM. The agent gets exactly that.",
  description:
    "Loupe turns 'this element, right here' into a structured, project-scoped task your AI coding agent reads over MCP — no lossy translation, no guessing.",
};

// Apply persisted theme before paint to avoid a flash; default is dark.
const noFlash = `(function(){try{var t=localStorage.getItem('loupe-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);var l=localStorage.getItem('loupe-lang');if(l==='en'||l==='zh')document.documentElement.setAttribute('lang',l);}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <script dangerouslySetInnerHTML={{ __html: noFlash }} />
        <LandingProvider>{children}</LandingProvider>
      </body>
    </html>
  );
}
