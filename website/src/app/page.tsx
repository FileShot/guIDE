import Hero from '@/components/Hero';
import HeroScreenshots from '@/components/HeroScreenshots';
import Features from '@/components/Features';
import PocketBanner from '@/components/PocketBanner';
import Showcase from '@/components/Showcase';
import Comparison from '@/components/Comparison';
import Pricing from '@/components/Pricing';

export default function Home() {
  return (
    <>
      <Hero />
      <HeroScreenshots />
      <Features />
      <PocketBanner />
      <Showcase />
      <Comparison />
      <Pricing />
    </>
  );
}
