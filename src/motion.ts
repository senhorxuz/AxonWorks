import { useRef } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
gsap.registerPlugin(useGSAP);
export { gsap, useGSAP };
export function usePageEntrance(key: string, ready: boolean) {
  const root = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    if (!ready) return;
    const media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)', () => {
      const query = gsap.utils.selector(root);
      const timeline = gsap.timeline({ defaults: { ease: 'power4.out' } });
      const heading = query('.page-heading');
      const sections = query('.library-toolbar, .library-projects, .library-empty, .connection-grid, .guide-list, .workspace-grid');
      if (heading.length) timeline.from(heading, { y: 6, autoAlpha: 0, duration: .32 }, 0);
      if (sections.length) timeline.from(sections, { y: 8, autoAlpha: 0, duration: .36, stagger: .035 }, .05);
      const secondary = query('.continuity-explainer, .page-footer');
      if (secondary.length) timeline.from(secondary, { y: 8, autoAlpha: 0, duration: .3, stagger: .035 }, .12);
    }, root);
    return () => media.revert();
  }, { scope: root, dependencies: [key, ready], revertOnUpdate: true });
  return root;
}
