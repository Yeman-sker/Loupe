import { TopBar } from "../components/Chrome";
import { Hero } from "../components/Hero";
import { Demo } from "../components/Demo";
import { AgentClose } from "../components/AgentClose";
import { Pain } from "../components/Pain";
import { Trust } from "../components/Trust";
import { Install } from "../components/Install";
import { Footer } from "../components/Footer";

// 7-act narrative arc: Hero (brand animation) → interactive Demo → Agent close
// → lossy handoff → why it's trustworthy → Install → Footer.
export default function Page() {
  return (
    <main className="page">
      <TopBar />
      <Hero />
      <Demo />
      <AgentClose />
      <Pain />
      <Trust />
      <Install />
      <Footer />
    </main>
  );
}
