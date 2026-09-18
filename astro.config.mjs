// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// Each library lives under its own subdirectory: one content dir
// (src/content/docs/<lib>/), one examples dir (examples/<lib>/), and one
// sidebar group below. Adding a library means adding those three things.
const libraries = [
  { label: 'darkcore', directory: 'darkcore' },
  { label: 'berylx', directory: 'berylx' },
];

export default defineConfig({
  site: 'https://lib.minamorl.com',
  trailingSlash: 'always',
  build: {
    format: 'directory',
  },
  integrations: [
    starlight({
      title: 'lib.minamorl.com',
      description: 'Introductions, guides, and worked examples for libraries by minamorl.',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/minamorl' }],
      editLink: {
        baseUrl: 'https://github.com/minamorl/lib-site/edit/main/',
      },
      lastUpdated: true,
      customCss: ['./src/styles/theme.css'],
      defaultLocale: 'root',
      locales: {
        root: { label: 'English', lang: 'en' },
        // Add further locales here, e.g. ja: { label: '日本語', lang: 'ja' },
        // and place translated content under src/content/docs/ja/.
      },
      sidebar: libraries.map(({ label, directory }) => ({
        label,
        items: [{ autogenerate: { directory } }],
      })),
    }),
  ],
});
