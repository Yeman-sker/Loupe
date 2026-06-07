import { TopBar } from "../components/Chrome";
import { Hero } from "../components/Hero";
import { AgentClose } from "../components/AgentClose";
import { Pain } from "../components/Pain";
import { Trust } from "../components/Trust";
import { Install } from "../components/Install";
import { Footer } from "../components/Footer";

// 6-act narrative arc: Hero (browser side) → Agent close → lossy handoff →
// why it's trustworthy → Install → Footer.
export default function Page() {
  return (
    <main className="page">
      <TopBar />
      <Hero />
      <AgentClose />
      <Pain />
      <Trust />
      <Install />
      <Footer />
    </main>
  );
}
