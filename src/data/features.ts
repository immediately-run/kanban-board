// Repeated/structured content lives in src/data as typed arrays — never inside
// a component file (that would break the Fast Refresh rule). Components import
// these and `.map()` over them.

export interface Feature {
  /** Mono label shown above the title, e.g. "/no-build". */
  slug: string;
  title: string;
  body: string;
}

export const FEATURES: Feature[] = [
  {
    slug: '/no-build',
    title: 'No build step',
    body: 'Source loads from GitHub and transpiles in the browser. There is nothing to wire up.',
  },
  {
    slug: '/take-apart',
    title: 'Take it apart',
    body: 'Open the editor, change a line, and watch it update live while the app keeps running.',
  },
  {
    slug: '/share',
    title: 'Share the link',
    body: 'Hand someone the URL and they can run it, fork it, and take it apart too.',
  },
];
