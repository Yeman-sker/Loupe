// Locked "Optical Instrument" design tokens, lifted from
// docs/ui-ux/prototypes/loupe-tokens.css. Values are canonical (oklch is the
// source of truth; #hex notes in the design file are reference only).
//
// NOT byte-verbatim: the source scopes vars to :root / [data-theme="x"], which
// do not reach a shadow tree. Mechanical scope transform applied here —
//   :root            -> :host,.loupe
//   [data-theme="x"] -> :host([data-theme="x"]),.loupe[data-theme="x"]
// All values are preserved exactly. data-theme is set on both the shadow host
// and the .loupe wrapper, so either selector form resolves.

export const TOKENS_CSS = `
:host,.loupe{
  --font:"Space Grotesk","PingFang SC","Noto Sans SC",-apple-system,BlinkMacSystemFont,system-ui,sans-serif;
  --mono:"JetBrains Mono",ui-monospace,SFMono-Regular,"SF Mono",Menlo,monospace;
  --iris-h:286;
  --iris-c:.135;
  --r-lg:14px; --r-md:10px; --r-sm:7px; --r-pin:50%;
  --hair:1px;
  --ease:cubic-bezier(.22,.78,.18,1);
  --ease-out:cubic-bezier(.16,1,.3,1);
  --dur:.19s; --dur-fast:.12s; --dur-slow:.34s;
}

:host([data-theme="light"]),.loupe[data-theme="light"]{
  --paper:#eceae4; --stage:#e6e4dd; --grid:rgba(28,27,24,.045);
  --surface:#fbfaf7; --surface-2:#f4f2ec; --raised:#ffffff;
  --ink:#1c1b18; --ink-2:#55524b; --ink-3:#8d897e;
  --hairline:rgba(28,27,24,.12); --hairline-2:rgba(28,27,24,.20); --hairline-strong:rgba(28,27,24,.30);
  --field:#ffffff; --field-line:rgba(28,27,24,.22);
  --iris:oklch(.50 var(--iris-c) var(--iris-h));
  --iris-hi:oklch(.57 var(--iris-c) var(--iris-h));
  --iris-press:oklch(.44 var(--iris-c) var(--iris-h));
  --iris-fg:#fbfaf7;
  --iris-veil:oklch(.50 var(--iris-c) var(--iris-h) / .12);
  --iris-veil-2:oklch(.50 var(--iris-c) var(--iris-h) / .07);
  --ring:0 0 0 3px oklch(.50 var(--iris-c) var(--iris-h) / .26);
  --t-good:#3f7d52; --t-warn:#9a6a1a; --t-bad:#a64238; --t-open:#55524b; --t-neutral:#6a675f;
  --k-bug:oklch(.56 .14 27); --k-copy:oklch(.58 .10 70); --k-style:oklch(.56 .13 350);
  --k-layout:oklch(.55 .11 245); --k-question:oklch(.56 .09 195); --k-other:oklch(.58 .015 286);
  --shadow-xs:0 1px 1.5px rgba(28,27,24,.06);
  --shadow:0 1px 2px rgba(28,27,24,.05),0 6px 16px -8px rgba(28,27,24,.16);
  --shadow-pop:0 1px 2px rgba(28,27,24,.06),0 22px 50px -18px rgba(28,27,24,.30),0 8px 18px -10px rgba(28,27,24,.16);
}

:host([data-theme="dark"]),.loupe[data-theme="dark"]{
  --paper:#131316; --stage:#171719; --grid:rgba(255,255,255,.035);
  --surface:#1d1d21; --surface-2:#232328; --raised:#26262b;
  --ink:#eceae4; --ink-2:#a8a59d; --ink-3:#74726c;
  --hairline:rgba(255,255,255,.10); --hairline-2:rgba(255,255,255,.17); --hairline-strong:rgba(255,255,255,.28);
  --field:#161619; --field-line:rgba(255,255,255,.18);
  --iris:oklch(.70 var(--iris-c) var(--iris-h));
  --iris-hi:oklch(.77 var(--iris-c) var(--iris-h));
  --iris-press:oklch(.63 var(--iris-c) var(--iris-h));
  --iris-fg:#15151a;
  --iris-veil:oklch(.70 var(--iris-c) var(--iris-h) / .18);
  --iris-veil-2:oklch(.70 var(--iris-c) var(--iris-h) / .10);
  --ring:0 0 0 3px oklch(.70 var(--iris-c) var(--iris-h) / .30);
  --t-good:#6cc28a; --t-warn:#d3a24e; --t-bad:#e07f72; --t-open:#a8a59d; --t-neutral:#9a978f;
  --k-bug:oklch(.68 .14 27); --k-copy:oklch(.74 .10 75); --k-style:oklch(.70 .13 350);
  --k-layout:oklch(.70 .11 248); --k-question:oklch(.72 .09 195); --k-other:oklch(.66 .02 286);
  --shadow-xs:0 1px 1.5px rgba(0,0,0,.4);
  --shadow:0 1px 2px rgba(0,0,0,.4),0 8px 20px -8px rgba(0,0,0,.6);
  --shadow-pop:0 1px 2px rgba(0,0,0,.5),0 26px 56px -18px rgba(0,0,0,.7),0 10px 22px -10px rgba(0,0,0,.5);
}

[data-kind="bug"]{--k:var(--k-bug)} [data-kind="copy"]{--k:var(--k-copy)}
[data-kind="style"]{--k:var(--k-style)} [data-kind="layout"]{--k:var(--k-layout)}
[data-kind="question"]{--k:var(--k-question)} [data-kind="other"]{--k:var(--k-other)}

@media (prefers-reduced-motion:reduce){
  :host,.loupe{--dur:.001s;--dur-fast:.001s;--dur-slow:.001s}
}
`;
