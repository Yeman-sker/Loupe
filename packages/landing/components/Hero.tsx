import { HeroAnimation } from "./HeroAnimation";

// Act 1 — full-bleed brand animation. The "Loupe" wordmark forges from a
// particle field and Selection frames roam it; no hero copy by design.
export function Hero() {
  return (
    <section className="hero" id="top">
      <HeroAnimation />
      <a className="hero-scroll" href="#demo" aria-label="See the live demo">
        <span className="hero-scroll-chev" />
      </a>
    </section>
  );
}
